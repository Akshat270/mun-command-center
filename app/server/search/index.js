// Hybrid retrieval.
//
// TIER 1  FTS5 + BM25 over chunks, plus an alias pass (always available, offline)
// TIER 2  local embeddings, if the semantic index has been built (optional)
// FUSION  Reciprocal Rank Fusion, then a source-priority rerank so competition
//         material outranks general research at equal relevance.
//
// Tier 1 alone is a complete product. If Tier 2 is missing the API says so in
// `mode` and results still come back.

import { all, get } from '../db/client.js'
import { buildQuery, isExactLookup } from './expand.js'
import { semanticSearch, semanticStatus } from './vector.js'

const RRF_K = 60          // standard RRF damping
const ALIAS_WEIGHT = 0.55 // alias hits are real but weaker than a direct hit

/** Source priority 1..4 -> multiplier. Competition material wins ties. */
const PRIORITY_BOOST = { 1: 1.35, 2: 1.18, 3: 1.0, 4: 0.85 }

function ftsSearch(match, limit) {
  if (!match) return []
  try {
    return all(
      `SELECT c.id, c.document_id, c.ordinal, c.text, c.page, c.heading, c.section,
              d.title AS doc_title, d.category, d.country, d.priority, d.verified,
              bm25(chunks_fts, 4.0, 2.0) AS score
         FROM chunks_fts
         JOIN chunks    c ON c.rowid = chunks_fts.rowid
         JOIN documents d ON d.id = c.document_id
        WHERE chunks_fts MATCH ? AND d.archived = 0
        ORDER BY score
        LIMIT ?`,
      [match, limit]
    )
  } catch {
    // A malformed MATCH expression must never take search down.
    return []
  }
}

function fuse(lists) {
  const scores = new Map()
  const byId = new Map()
  for (const { rows, weight } of lists) {
    rows.forEach((row, rank) => {
      byId.set(row.id, row)
      const add = (weight * 1) / (RRF_K + rank + 1)
      scores.set(row.id, (scores.get(row.id) || 0) + add)
    })
  }
  return [...scores.entries()]
    .map(([id, score]) => {
      const row = byId.get(id)
      return { ...row, score: score * (PRIORITY_BOOST[row.priority] ?? 1) }
    })
    .sort((a, b) => b.score - a.score)
}

function snippet(text, terms, len = 320) {
  if (!terms.length) return text.slice(0, len)
  const lower = text.toLowerCase()
  let at = -1
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i !== -1 && (at === -1 || i < at)) at = i
  }
  if (at === -1) return text.slice(0, len)
  const start = Math.max(0, at - 90)
  return (start > 0 ? '…' : '') + text.slice(start, start + len) + (start + len < text.length ? '…' : '')
}

/**
 * Search the document knowledge base.
 * @returns {Promise<{results:object[], mode:string, aliases:string[], took:number}>}
 */
export async function searchChunks(query, { limit = 20, country = null, category = null } = {}) {
  const t0 = performance.now()
  const { match, strictMatch, aliasMatch, terms, aliases } = buildQuery(query)
  if (!match) return { results: [], mode: 'empty', aliases: [], took: 0 }

  const pool = Math.max(limit * 3, 40)
  let keyword = ftsSearch(match, pool)

  // On a multi-word query, a hit that exists only because of the trailing
  // prefix wildcard is not a real match — see the note in expand.js. If no
  // whole term matched, drop the keyword tier entirely rather than present
  // plausible-looking passages the delegate never asked for.
  if (keyword.length && terms.length > 1 && strictMatch && !ftsSearch(strictMatch, 1).length) {
    keyword = []
  }

  const lists = [{ rows: keyword, weight: 1 }]

  // Alias pass only helps conceptual queries; an exact lookup wants literal hits.
  if (aliasMatch && !isExactLookup(query)) {
    lists.push({ rows: ftsSearch(aliasMatch, pool), weight: ALIAS_WEIGHT })
  }

  const sem = await semanticSearch(query, pool).catch(() => null)
  if (sem?.length) lists.push({ rows: sem, weight: 0.9 })

  let results = fuse(lists)
  if (country) results = results.filter((r) => r.country === country)
  if (category) results = results.filter((r) => r.category === category)

  const status = semanticStatus()
  const mode = sem?.length ? 'hybrid' : status.built ? 'keyword (semantic idle)' : 'keyword'

  return {
    results: results.slice(0, limit).map((r) => ({
      chunkId: r.id,
      documentId: r.document_id,
      documentTitle: r.doc_title,
      category: r.category,
      country: r.country,
      priority: r.priority,
      verified: Boolean(r.verified),
      page: r.page,
      pageLabel: r.page ? `Page ${r.page}` : 'Page unavailable',
      heading: r.heading,
      section: r.section,
      ordinal: r.ordinal,
      snippet: snippet(r.text, terms),
      text: r.text,
      score: Number(r.score.toFixed(5)),
    })),
    mode,
    aliases,
    took: Math.round(performance.now() - t0),
  }
}

/** Fetch a chunk plus its neighbours — powers "View source". */
export function getChunkContext(chunkId, radius = 1) {
  const c = get(
    `SELECT c.*, d.title AS doc_title, d.filename, d.path, d.category, d.priority
       FROM chunks c JOIN documents d ON d.id = c.document_id
      WHERE c.id = ?`,
    [chunkId]
  )
  if (!c) return null
  const around = all(
    `SELECT id, ordinal, text, page, heading FROM chunks
      WHERE document_id = ? AND ordinal BETWEEN ? AND ? ORDER BY ordinal`,
    [c.document_id, c.ordinal - radius, c.ordinal + radius]
  )
  return {
    ...c,
    pageLabel: c.page ? `Page ${c.page}` : 'Page unavailable',
    context: around,
  }
}

// --------------------------------------------------------------- global search

const like = (q) => `%${q.replace(/[%_]/g, '')}%`

/**
 * Ctrl+K. Searches every record type, grouped, and never touches the network.
 */
export async function globalSearch(query, { perGroup = 5 } = {}) {
  const q = String(query || '').trim()
  if (q.length < 2) return { groups: [], took: 0 }
  const t0 = performance.now()
  const L = like(q)

  const groups = []
  const push = (label, kind, items) => { if (items.length) groups.push({ label, kind, items }) }

  push('Speeches', 'speech', all(
    `SELECT id, title, category, duration_s, substr(body,1,160) AS preview FROM speeches
      WHERE title LIKE ? OR body LIKE ? ORDER BY pinned DESC, ordinal LIMIT ?`, [L, L, perGroup]))

  push('POIs', 'poi', all(
    `SELECT id, question, target_country, topic, strength FROM pois
      WHERE question LIKE ? OR topic LIKE ? OR purpose LIKE ?
      ORDER BY pinned DESC, ordinal LIMIT ?`, [L, L, L, perGroup]))

  push('Q&A / Defenses', 'qa', all(
    `SELECT id, question, kind, substr(answer,1,160) AS preview FROM qa
      WHERE question LIKE ? OR answer LIKE ? ORDER BY pinned DESC, ordinal LIMIT ?`, [L, L, perGroup]))

  push('Countries', 'country', all(
    `SELECT code, name, flag, identity, bloc_status FROM countries
      WHERE name LIKE ? OR identity LIKE ? OR position LIKE ? OR lead_topic LIKE ? LIMIT ?`,
    [L, L, L, L, perGroup]))

  push('Notes', 'note', all(
    `SELECT id, body, badge, created_at FROM notes
      WHERE body LIKE ? ORDER BY pinned DESC, created_at DESC LIMIT ?`, [L, perGroup]))

  push('Procedure', 'procedure', all(
    `SELECT id, title, topic, source, substr(body,1,160) AS preview FROM procedure_rules
      WHERE title LIKE ? OR body LIKE ? OR wording LIKE ? ORDER BY ordinal LIMIT ?`,
    [L, L, L, perGroup]))

  push('Resolution clauses', 'clause', all(
    `SELECT cl.id, cl.kind, cl.ordinal, cl.opener, cl.text, r.title AS resolution
       FROM clauses cl JOIN resolutions r ON r.id = cl.resolution_id
      WHERE cl.text LIKE ? ORDER BY cl.kind, cl.ordinal LIMIT ?`, [L, perGroup]))

  push('Clause library', 'clause_idea', all(
    `SELECT id, opener, text, topic FROM clause_library
      WHERE text LIKE ? OR topic LIKE ? ORDER BY priority, ordinal LIMIT ?`, [L, L, perGroup]))

  push('Transcript', 'transcript', all(
    `SELECT id, speaker, country, text, ts, classification FROM transcript_segments
      WHERE text LIKE ? ORDER BY ts DESC LIMIT ?`, [L, perGroup]))

  const docs = await searchChunks(q, { limit: perGroup })
  if (docs.results.length) {
    groups.unshift({ label: 'Documents', kind: 'document', items: docs.results })
  }

  return { groups, took: Math.round(performance.now() - t0), mode: docs.mode }
}
