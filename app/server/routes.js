// All HTTP routes. Every handler returns plain JSON; errors are converted to
// a readable `error` string by the global handler in index.js — the UI never
// sees a stack trace.

import os from 'node:os'
import { all, get, run, tx, id, now, json, dbStatus, getSetting, setSetting, logEvent } from './db/client.js'
import { searchChunks, globalSearch, getChunkContext } from './search/index.js'
import { semanticStatus, buildSemanticIndex, clearSemanticIndex, lastBuildResult } from './search/vector.js'
import { scanFolder, importFile, importFolder, listDocuments, getDocument, updateDocument, deleteDocument } from './documents/import.js'
import { categoriesFor } from './documents/classify.js'
import { seed } from './db/seed.js'
import * as ai from './ai/service.js'
import { keyStatus, saveKey, clearKey, testKey, setProvider, probeCLI } from './ai/keys.js'
import { parseResolution, linesFromDocx, renderResolution } from './resolution/parse.js'
import { COMMITTEE, SOURCE_DIR, AI_PROVIDERS } from './config.js'
import { activeCommittee } from './committee.js'

const bool = (v) => (v ? 1 : 0)

/**
 * Collapse the home directory to `~` for display.
 *
 * The source folder is shown in Settings so the delegate can confirm which
 * folder is being read, and that is worth keeping. The full absolute path also
 * contains the operating-system account name, which ends up in every screenshot
 * shared to ask "is this set up right?" — `~\Desktop\MUN` answers the question
 * just as well without publishing the name.
 */
const displayPath = (abs) => {
  const home = os.homedir()
  return home && abs.toLowerCase().startsWith(home.toLowerCase())
    ? `~${abs.slice(home.length)}`
    : abs
}

export default async function routes(app) {
  // ───────────────────────────────────────────────────────────── status

  app.get('/api/status', async () => ({
    // The stored committee, not the environment default. `committee` is a
    // writable setting, so these two can disagree — and the AI layer already
    // resolves it this way. Returning the raw default here would put one
    // delegation in the prompts and a different one in the top bar, the
    // dashboard and the speakers list.
    committee: activeCommittee(),
    db: dbStatus(),
    ai: ai.aiStatus(),
    semantic: semanticStatus(),
    sourceDir: displayPath(SOURCE_DIR),
    counts: {
      documents: get('SELECT COUNT(*) AS n FROM documents WHERE archived = 0')?.n ?? 0,
      chunks: get('SELECT COUNT(*) AS n FROM chunks')?.n ?? 0,
      speeches: get('SELECT COUNT(*) AS n FROM speeches')?.n ?? 0,
      pois: get('SELECT COUNT(*) AS n FROM pois')?.n ?? 0,
      notes: get('SELECT COUNT(*) AS n FROM notes')?.n ?? 0,
    },
  }))

  app.get('/api/settings', async () => ({
    alertSensitivity: getSetting('alertSensitivity', 'medium'),
    fontScale: getSetting('fontScale', 1),
    theme: getSetting('theme', 'dark'),
    transcriptionProvider: getSetting('transcriptionProvider', 'webspeech'),
    transcriptionLang: getSetting('transcriptionLang', 'en-GB'),
    // Repairing country and procedure names in recognised text. Switchable,
    // because a wrong "correction" is worse than none.
    transcriptionAutocorrect: getSetting('transcriptionAutocorrect', true),
    // Per-speaker time the chair set, used to estimate how long until your turn.
    speakingSeconds: getSetting('speakingSeconds', 60),
    // Reading size for speech text, independent of the app-wide font scale: a
    // long speech has to fit on screen, a 30-second one wants to be huge.
    speechScale: getSetting('speechScale', 1),
    speechFocusScale: getSetting('speechFocusScale', 1),
    recordingConsentAck: getSetting('recordingConsentAck', false),
    committee: getSetting('committee', COMMITTEE),
    ungaPowers: getSetting('ungaPowers', null),
    openingMoments: getSetting('openingMoments', []),
    negotiationLines: getSetting('negotiationLines', []),
    ai: ai.aiStatus(),
    semantic: semanticStatus(),
  }))

  /**
   * Settings this endpoint may write. A whitelist, not a blacklist: the old
   * code refused exactly one key (`aiKeys`) and wrote everything else
   * unvalidated, which meant `aiProvider` could be set to anything here while
   * /api/ai/provider carefully validated it — and any secret added later would
   * have been writable by default.
   *
   * Secrets and the AI backend go through /api/ai/key and /api/ai/provider,
   * which validate and never echo a value back.
   */
  const WRITABLE_SETTINGS = new Set([
    'alertSensitivity', 'fontScale', 'theme',
    'transcriptionProvider', 'transcriptionLang', 'transcriptionAutocorrect',
    'speakingSeconds',
    'speechScale', 'speechFocusScale', 'recordingConsentAck',
    'committee', 'ungaPowers', 'openingMoments', 'negotiationLines',
  ])

  app.patch('/api/settings', async (req, reply) => {
    const entries = Object.entries(req.body || {})
    const rejected = entries.filter(([k]) => !WRITABLE_SETTINGS.has(k)).map(([k]) => k)
    if (rejected.length) {
      return reply.code(400).send({
        error: `Not a writable setting: ${rejected.join(', ')}. API keys go through Settings → AI.`,
      })
    }
    for (const [k, v] of entries) setSetting(k, v)
    return { ok: true }
  })

  // ─────────────────────────────────────────────────────────── documents

  app.get('/api/documents', async (req) => ({
    documents: listDocuments({ includeArchived: req.query.archived === '1' }),
    categories: categoriesFor(),
  }))

  app.get('/api/documents/scan', async (req) => ({
    folder: req.query.dir || SOURCE_DIR,
    files: await scanFolder(req.query.dir || SOURCE_DIR),
  }))

  app.post('/api/documents/import', async (req) => {
    const { path: file, dir, ...overrides } = req.body || {}
    if (file) return importFile(file, overrides)
    return importFolder(dir || SOURCE_DIR)
  })

  app.get('/api/documents/:id', async (req, reply) => {
    const doc = getDocument(req.params.id)
    if (!doc) return reply.code(404).send({ error: 'Document not found.' })
    return doc
  })

  app.patch('/api/documents/:id', async (req) => updateDocument(req.params.id, req.body || {}))
  app.delete('/api/documents/:id', async (req) => deleteDocument(req.params.id))

  // ────────────────────────────────────────────────────────────── search

  app.get('/api/search', async (req) =>
    searchChunks(req.query.q || '', {
      limit: Number(req.query.limit) || 20,
      country: req.query.country || null,
      category: req.query.category || null,
    })
  )

  app.get('/api/search/global', async (req) => globalSearch(req.query.q || ''))

  app.get('/api/search/source/:chunkId', async (req, reply) => {
    const ctx = getChunkContext(req.params.chunkId, Number(req.query.radius) || 1)
    if (!ctx) return reply.code(404).send({ error: 'Source not found.' })
    return ctx
  })

  app.post('/api/search/semantic/build', async (req) =>
    buildSemanticIndex({ wait: (req.body || {}).wait === true }))
  /** Polled while a build runs — carries live progress and the last outcome. */
  app.get('/api/search/semantic', async () => ({ ...semanticStatus(), last: lastBuildResult() }))
  app.delete('/api/search/semantic', async () => clearSemanticIndex())

  // ──────────────────────────────────────────────────────────── speeches

  /**
   * Group the speech ⇄ defence-bank links once, so neither list pays a query
   * per row. Returns a Map keyed by `keyCol` holding arrays of the other id in
   * link order.
   */
  const linkMap = (keyCol, valueCol) => {
    const m = new Map()
    for (const row of all(`SELECT speech_id, qa_id FROM speech_qa ORDER BY ordinal, created_at`)) {
      const key = row[keyCol]
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(row[valueCol])
    }
    return m
  }

  /**
   * Replace the whole set of links on one side — `side` is which end owns the
   * list being sent. Unknown ids are dropped rather than erroring, because a
   * stale checkbox must not cost the delegate the rest of the selection.
   *
   * `ordinal` always means reading order within a speech: setting a speech's
   * list numbers it outright, while attaching one answer to several speeches
   * appends to the end of each. Returns the ids stored, or null if the owner
   * does not exist.
   */
  const setLinks = (side, ownerId, ids) => {
    const isSpeech = side === 'speech'
    const ownerTable = isSpeech ? 'speeches' : 'qa'
    if (!get(`SELECT 1 AS x FROM ${ownerTable} WHERE id = ?`, [ownerId])) return null
    const otherTable = isSpeech ? 'qa' : 'speeches'
    const known = (Array.isArray(ids) ? ids : [])
      .filter((v, i, a) => typeof v === 'string' && a.indexOf(v) === i)
      .filter((oid) => get(`SELECT 1 AS x FROM ${otherTable} WHERE id = ?`, [oid]))
    tx(() => {
      run(`DELETE FROM speech_qa WHERE ${isSpeech ? 'speech_id' : 'qa_id'} = ?`, [ownerId])
      known.forEach((oid, i) => {
        const [speechId, qaId] = isSpeech ? [ownerId, oid] : [oid, ownerId]
        const ordinal = isSpeech ? i
          : (get('SELECT MAX(ordinal) AS m FROM speech_qa WHERE speech_id = ?', [speechId])?.m ?? -1) + 1
        run('INSERT INTO speech_qa(speech_id, qa_id, ordinal, created_at) VALUES(?,?,?,?)',
          [speechId, qaId, ordinal, now()])
      })
    })
    return known
  }

  app.get('/api/speeches', async () => {
    const links = linkMap('speech_id', 'qa_id')
    return all('SELECT * FROM speeches ORDER BY pinned DESC, ordinal, title').map((s) => ({
      ...s, tags: json.parse(s.tags, []), qa_ids: links.get(s.id) ?? [],
    }))
  })

  app.post('/api/speeches', async (req) => {
    const b = req.body || {}
    const sid = id('sp_')
    run(`INSERT INTO speeches(id,title,category,duration_s,body,memory_hook,tags,pinned,ordinal,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [sid, b.title || 'Untitled', b.category || '30s', b.duration_s ?? null, b.body || '',
       b.memory_hook ?? null, json.stringify(b.tags ?? []), bool(b.pinned), b.ordinal ?? 99, now()])
    return get('SELECT * FROM speeches WHERE id = ?', [sid])
  })

  app.patch('/api/speeches/:id', async (req) => {
    const b = req.body || {}
    const cols = { title: 'title', body: 'body', category: 'category', duration_s: 'duration_s',
                   memory_hook: 'memory_hook', pinned: 'pinned' }
    const sets = [], vals = []
    for (const [k, col] of Object.entries(cols)) {
      if (b[k] !== undefined) { sets.push(`${col}=?`); vals.push(typeof b[k] === 'boolean' ? bool(b[k]) : b[k]) }
    }
    if (b.markUsed) { sets.push('used_at=?', 'use_count = use_count + 1'); vals.push(now()) }
    // Undo, because a speech gets marked used by mistake and the delegate needs
    // the list to tell the truth about what has actually been delivered.
    if (b.clearUsed) sets.push('used_at=NULL', 'use_count=0')
    if (sets.length) run(`UPDATE speeches SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    if (b.markUsed) logEvent('speech', 'Speech marked used')
    return get('SELECT * FROM speeches WHERE id = ?', [req.params.id])
  })

  app.delete('/api/speeches/:id', async (req) => {
    run('DELETE FROM speeches WHERE id = ?', [req.params.id]); return { ok: true }
  })

  /**
   * Replace the prepared answers attached to one speech — the questions a
   * delegation is likely to put to us after we deliver it. Body: { ids: [...] }
   * in reading order; GET /api/speeches carries them back as `qa_ids`.
   */
  app.put('/api/speeches/:id/qa', async (req, reply) => {
    const ids = setLinks('speech', req.params.id, (req.body || {}).ids)
    if (ids === null) return reply.code(404).send({ error: 'Speech not found.' })
    return { ok: true, qa_ids: ids }
  })

  // ──────────────────────────────────────────────────────────────── POIs

  // Ordered by `ordinal` alone, so the list is exactly the order the delegate
  // arranged with the move buttons. Pinning marks importance; it no longer
  // silently reshuffles the list out from under a manual ordering.
  app.get('/api/pois', async (req) => {
    const target = req.query.target
    const showHidden = req.query.hidden === '1'
    const where = ['1=1']
    const params = []
    if (target && target !== 'all') { where.push('target_country IN (?, ?)'); params.push(target, 'ANY') }
    if (!showHidden) where.push('hidden = 0')
    return all(`SELECT * FROM pois WHERE ${where.join(' AND ')} ORDER BY ordinal, created_at`, params)
  })

  app.get('/api/pois/hidden-count', async () =>
    ({ hidden: get('SELECT COUNT(*) AS n FROM pois WHERE hidden = 1')?.n ?? 0 }))

  /**
   * Reorder. Body: { ids: [...] } — the ids in their new relative order.
   *
   * Only the ordinal slots those ids already occupy are reused, so reordering a
   * filtered view (say, Austria only) cannot disturb where every other POI sits.
   */
  app.post('/api/pois/reorder', async (req) => {
    const { ids = [] } = req.body || {}
    if (!ids.length) return { ok: true, moved: 0 }

    tx(() => {
      // Seeded and hand-added POIs can share an ordinal. Duplicate slots make
      // "move up" a no-op, so normalise to a strict sequence first.
      const every = all('SELECT id, ordinal FROM pois ORDER BY ordinal, created_at')
      const duplicated = new Set(every.map((r) => r.ordinal)).size !== every.length
      if (duplicated) every.forEach((r, i) => run('UPDATE pois SET ordinal=? WHERE id=?', [i, r.id]))

      const known = ids.filter((pid) => get('SELECT 1 AS x FROM pois WHERE id = ?', [pid]))
      const slots = known
        .map((pid) => get('SELECT ordinal FROM pois WHERE id = ?', [pid]).ordinal)
        .sort((a, b) => a - b)
      known.forEach((pid, i) => run('UPDATE pois SET ordinal = ? WHERE id = ?', [slots[i], pid]))
    })
    return { ok: true, moved: ids.length }
  })

  app.post('/api/pois', async (req) => {
    const b = req.body || {}
    const pid = id('poi_')
    run(`INSERT INTO pois(id,target_country,topic,question,purpose,expected_response,follow_up,strength,pinned,ordinal,created_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, b.target_country || 'ANY', b.topic ?? null, b.question || '', b.purpose ?? null,
       b.expected_response ?? null, b.follow_up ?? null, b.strength || 'medium', bool(b.pinned),
       (get('SELECT MAX(ordinal) AS m FROM pois')?.m ?? -1) + 1, now()])
    return get('SELECT * FROM pois WHERE id = ?', [pid])
  })

  app.patch('/api/pois/:id', async (req) => {
    const b = req.body || {}
    const cols = { question: 'question', purpose: 'purpose', topic: 'topic', strength: 'strength',
                   outcome: 'outcome', pinned: 'pinned', hidden: 'hidden', ordinal: 'ordinal',
                   target_country: 'target_country',
                   expected_response: 'expected_response', follow_up: 'follow_up' }
    const sets = [], vals = []
    for (const [k, col] of Object.entries(cols)) {
      if (b[k] !== undefined) { sets.push(`${col}=?`); vals.push(typeof b[k] === 'boolean' ? bool(b[k]) : b[k]) }
    }
    if (b.markAsked !== undefined) { sets.push('asked_at=?'); vals.push(b.markAsked ? now() : null) }
    if (sets.length) run(`UPDATE pois SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    if (b.markAsked) logEvent('poi', 'POI asked')
    return get('SELECT * FROM pois WHERE id = ?', [req.params.id])
  })

  app.delete('/api/pois/:id', async (req) => { run('DELETE FROM pois WHERE id=?', [req.params.id]); return { ok: true } })

  // ───────────────────────────────────────────────────────────────── Q&A

  app.get('/api/qa', async (req) => {
    const kind = req.query.kind
    const links = linkMap('qa_id', 'speech_id')
    const rows = kind && kind !== 'all'
      ? all('SELECT * FROM qa WHERE kind = ? ORDER BY pinned DESC, ordinal', [kind])
      : all('SELECT * FROM qa ORDER BY pinned DESC, ordinal')
    return rows.map((a) => ({ ...a, speech_ids: links.get(a.id) ?? [] }))
  })

  app.post('/api/qa', async (req) => {
    const b = req.body || {}
    const qid = id('qa_')
    const max = get('SELECT MAX(ordinal) AS m FROM qa')?.m ?? 0
    run(`INSERT INTO qa(id,question,answer,kind,pinned,ordinal,created_at) VALUES(?,?,?,?,?,?,?)`,
      [qid, b.question || '', b.answer || '', b.kind || 'likely_to_us', bool(b.pinned), max + 1, now()])
    // Attaching on create matters: the answer is usually written *because* of the
    // speech that invites the question, and a second round trip would be lost.
    const speechIds = setLinks('qa', qid, b.speech_ids) ?? []
    return { ...get('SELECT * FROM qa WHERE id = ?', [qid]), speech_ids: speechIds }
  })

  app.patch('/api/qa/:id', async (req) => {
    const b = req.body || {}
    const sets = [], vals = []
    for (const k of ['question', 'answer', 'kind']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]) }
    }
    if (b.pinned !== undefined) { sets.push('pinned=?'); vals.push(bool(b.pinned)) }
    if (sets.length) run(`UPDATE qa SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    if (b.speech_ids !== undefined) setLinks('qa', req.params.id, b.speech_ids)
    const row = get('SELECT * FROM qa WHERE id = ?', [req.params.id])
    return row ? { ...row, speech_ids: linkMap('qa_id', 'speech_id').get(row.id) ?? [] } : row
  })

  app.delete('/api/qa/:id', async (req) => { run('DELETE FROM qa WHERE id=?', [req.params.id]); return { ok: true } })

  /** Replace the speeches this answer is attached to. Body: { ids: [...] }. */
  app.put('/api/qa/:id/speeches', async (req, reply) => {
    const ids = setLinks('qa', req.params.id, (req.body || {}).ids)
    if (ids === null) return reply.code(404).send({ error: 'Prepared answer not found.' })
    return { ok: true, speech_ids: ids }
  })

  // ─────────────────────────────────────────────────────────── countries

  const hydrateCountry = (c) => ({
    ...c,
    facts: json.parse(c.facts, []),
    legal_refs: json.parse(c.legal_refs, []),
    strengths: json.parse(c.strengths, []),
    vulnerabilities: json.parse(c.vulnerabilities, []),
    attacks_defenses: json.parse(c.attacks_defenses, []),
    questions_to_ask: json.parse(c.questions_to_ask, []),
    should_lead_on: json.parse(c.should_lead_on, []),
  })

  app.get('/api/countries', async () =>
    all('SELECT * FROM countries ORDER BY is_ours DESC, name').map(hydrateCountry))

  app.get('/api/countries/:code', async (req, reply) => {
    const c = get('SELECT * FROM countries WHERE code = ?', [req.params.code.toUpperCase()])
    if (!c) return reply.code(404).send({ error: 'Country not found.' })
    return hydrateCountry(c)
  })

  app.patch('/api/countries/:code', async (req) => {
    const b = req.body || {}
    if (b.bloc_status) {
      run('UPDATE countries SET bloc_status=?, updated_at=? WHERE code=?', [b.bloc_status, now(), req.params.code])
      run(`INSERT INTO bloc_members(country_code,status,updated_at) VALUES(?,?,?)
           ON CONFLICT(country_code) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at`,
        [req.params.code, b.bloc_status, now()])
    }
    return hydrateCountry(get('SELECT * FROM countries WHERE code = ?', [req.params.code]))
  })

  // ─────────────────────────────────────────────────────────── bloc board

  app.get('/api/bloc', async () =>
    all(`SELECT b.*, c.name, c.flag, c.lead_topic FROM bloc_members b
         LEFT JOIN countries c ON c.code = b.country_code ORDER BY c.is_ours DESC, c.name`))

  app.put('/api/bloc/:code', async (req) => {
    const b = req.body || {}
    run(`INSERT INTO bloc_members(country_code,status,agreed,disagreed,proposed,promises,concerns,contact,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?)
         ON CONFLICT(country_code) DO UPDATE SET
           status=COALESCE(excluded.status,status), agreed=COALESCE(excluded.agreed,agreed),
           disagreed=COALESCE(excluded.disagreed,disagreed), proposed=COALESCE(excluded.proposed,proposed),
           promises=COALESCE(excluded.promises,promises), concerns=COALESCE(excluded.concerns,concerns),
           contact=COALESCE(excluded.contact,contact), updated_at=excluded.updated_at`,
      [req.params.code, b.status ?? null, b.agreed ?? null, b.disagreed ?? null, b.proposed ?? null,
       b.promises ?? null, b.concerns ?? null, b.contact ?? null, now()])
    return get('SELECT * FROM bloc_members WHERE country_code = ?', [req.params.code])
  })

  // ─────────────────────────────────────────────────────────────── notes

  app.get('/api/notes', async (req) => {
    const s = req.query.session
    return s
      ? all('SELECT * FROM notes WHERE session_id = ? ORDER BY pinned DESC, created_at DESC', [s])
      : all('SELECT * FROM notes ORDER BY pinned DESC, created_at DESC LIMIT 300')
  })

  app.post('/api/notes', async (req) => {
    const b = req.body || {}
    const nid = id('n_')
    run('INSERT INTO notes(id,body,badge,country,tags,pinned,session_id,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [nid, b.body || '', b.badge || 'FACT', b.country ?? null, json.stringify(b.tags ?? []),
       bool(b.pinned), b.session_id ?? null, now()])
    logEvent('note', b.body?.slice(0, 60) || 'Note added')
    return get('SELECT * FROM notes WHERE id = ?', [nid])
  })

  app.patch('/api/notes/:id', async (req) => {
    const b = req.body || {}
    const sets = [], vals = []
    for (const k of ['body', 'badge', 'country', 'pinned']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(typeof b[k] === 'boolean' ? bool(b[k]) : b[k]) }
    }
    if (sets.length) run(`UPDATE notes SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    return get('SELECT * FROM notes WHERE id = ?', [req.params.id])
  })

  app.delete('/api/notes/:id', async (req) => { run('DELETE FROM notes WHERE id=?', [req.params.id]); return { ok: true } })

  // ───────────────────────────────────────────────────────── procedure

  app.get('/api/procedure', async () => ({
    rules: all('SELECT * FROM procedure_rules ORDER BY ordinal, topic'),
    plays: all('SELECT * FROM caucus_plays ORDER BY ordinal'),
    ungaPowers: getSetting('ungaPowers', null),
    openingMoments: getSetting('openingMoments', []),
  }))

  app.patch('/api/procedure/:id', async (req) => {
    const b = req.body || {}
    const sets = [], vals = []
    for (const k of ['body', 'wording', 'source', 'title']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]) }
    }
    sets.push('updated_at=?'); vals.push(now())
    run(`UPDATE procedure_rules SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    return get('SELECT * FROM procedure_rules WHERE id = ?', [req.params.id])
  })

  app.post('/api/procedure', async (req) => {
    const b = req.body || {}
    const pid = id('pr_')
    run('INSERT INTO procedure_rules(id,topic,title,body,wording,source,ordinal,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [pid, b.topic || 'Custom', b.title || 'Untitled', b.body || '', b.wording ?? null,
       b.source || 'RPS_CONFIRMED', b.ordinal ?? 99, now()])
    return get('SELECT * FROM procedure_rules WHERE id = ?', [pid])
  })

  // ──────────────────────────────────────────────────────── priorities

  app.get('/api/priorities', async () => all('SELECT * FROM priorities ORDER BY done, ordinal'))
  app.post('/api/priorities', async (req) => {
    const pid = id('pri_')
    const max = get('SELECT MAX(ordinal) AS m FROM priorities')?.m ?? 0
    run('INSERT INTO priorities(id,text,done,ordinal) VALUES(?,?,0,?)', [pid, req.body?.text || '', max + 1])
    return get('SELECT * FROM priorities WHERE id = ?', [pid])
  })
  app.patch('/api/priorities/:id', async (req) => {
    const b = req.body || {}
    if (b.done !== undefined) run('UPDATE priorities SET done=? WHERE id=?', [bool(b.done), req.params.id])
    if (b.text !== undefined) run('UPDATE priorities SET text=? WHERE id=?', [b.text, req.params.id])
    return get('SELECT * FROM priorities WHERE id = ?', [req.params.id])
  })
  app.delete('/api/priorities/:id', async (req) => { run('DELETE FROM priorities WHERE id=?', [req.params.id]); return { ok: true } })

  // ───────────────────────────────────────────────────────────── events

  app.get('/api/events', async (req) =>
    all('SELECT * FROM events ORDER BY at DESC LIMIT ?', [Number(req.query.limit) || 25]))

  // ─────────────────────────────────────────────────────────── sessions

  app.get('/api/sessions', async () => all('SELECT * FROM sessions ORDER BY started_at DESC'))

  app.get('/api/sessions/active', async () => {
    const s = get('SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1')
    return s ?? null
  })

  app.post('/api/sessions', async (req) => {
    const sid = id('ses_')
    run('INSERT INTO sessions(id,name,phase,started_at) VALUES(?,?,?,?)',
      [sid, req.body?.name || `Session ${new Date().toLocaleString()}`, req.body?.phase || 'roll_call', now()])
    logEvent('session', 'Session started')
    return get('SELECT * FROM sessions WHERE id = ?', [sid])
  })

  app.patch('/api/sessions/:id', async (req) => {
    const b = req.body || {}
    const cols = { name: 'name', phase: 'phase', topic: 'topic', caucus_type: 'caucus_type',
                   current_speaker: 'current_speaker', roll_call: 'roll_call' }
    const sets = [], vals = []
    for (const [k, col] of Object.entries(cols)) {
      if (b[k] !== undefined) { sets.push(`${col}=?`); vals.push(b[k]) }
    }
    if (b.end) { sets.push('ended_at=?'); vals.push(now()) }
    if (sets.length) run(`UPDATE sessions SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    return get('SELECT * FROM sessions WHERE id = ?', [req.params.id])
  })

  // ───────────────────────────────────────────────────── speakers list

  const speakersOf = (sessionId) =>
    all('SELECT * FROM speakers_list WHERE session_id = ? ORDER BY ordinal', [sessionId])

  /**
   * Keep `sessions.current_speaker` equal to whoever is marked 'speaking'.
   * Always called inside the same transaction as the change that caused it, so
   * the queue and the session can never tell the delegate two different things.
   */
  const syncCurrentSpeaker = (sessionId) => {
    const speaking = get(
      "SELECT name FROM speakers_list WHERE session_id = ? AND status = 'speaking' ORDER BY ordinal LIMIT 1",
      [sessionId]
    )
    run('UPDATE sessions SET current_speaker = ? WHERE id = ?', [speaking?.name ?? null, sessionId])
  }

  app.get('/api/speakers/:sessionId', async (req) => speakersOf(req.params.sessionId))

  /** Append one speaker, or a whole list the chair just read out. */
  app.post('/api/speakers', async (req, reply) => {
    const b = req.body || {}
    const sessionId = b.session_id
    if (!sessionId) return reply.code(400).send({ error: 'A session is required.' })

    const incoming = (Array.isArray(b.speakers) ? b.speakers : [b])
      .map((s) => ({ name: String(s.name ?? '').trim(), country_code: s.country_code ?? null }))
      .filter((s) => s.name)
    if (!incoming.length) return reply.code(400).send({ error: 'A speaker name is required.' })

    tx(() => {
      let next = (get('SELECT MAX(ordinal) AS m FROM speakers_list WHERE session_id = ?',
        [sessionId])?.m ?? -1) + 1
      for (const s of incoming) {
        run(`INSERT INTO speakers_list(id, session_id, name, country_code, ordinal, status)
             VALUES(?,?,?,?,?,'waiting')`,
          [id('spk_'), sessionId, s.name, s.country_code, next++])
      }
    })
    return speakersOf(sessionId)
  })

  app.patch('/api/speakers/:id', async (req, reply) => {
    const b = req.body || {}
    const row = get('SELECT * FROM speakers_list WHERE id = ?', [req.params.id])
    if (!row) return reply.code(404).send({ error: 'No such speaker.' })

    const sets = [], vals = []
    for (const k of ['name', 'country_code', 'status', 'note', 'seconds']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]) }
    }
    if (sets.length) {
      tx(() => {
        run(`UPDATE speakers_list SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
        syncCurrentSpeaker(row.session_id)
      })
    }
    return speakersOf(row.session_id)
  })

  app.delete('/api/speakers/:id', async (req) => {
    const row = get('SELECT * FROM speakers_list WHERE id = ?', [req.params.id])
    if (!row) return { ok: true }
    tx(() => {
      run('DELETE FROM speakers_list WHERE id = ?', [req.params.id])
      // Removing whoever held the floor must not strand the session pointing at
      // a speaker that no longer exists.
      syncCurrentSpeaker(row.session_id)
    })
    return speakersOf(row.session_id)
  })

  /** Explicit order, as sent. The chair re-reads the list often enough. */
  app.post('/api/speakers/reorder', async (req, reply) => {
    const { session_id: sessionId, ids = [] } = req.body || {}
    if (!sessionId || !ids.length) return reply.code(400).send({ error: 'A session and an order are required.' })
    tx(() => {
      ids.forEach((sid, i) =>
        run('UPDATE speakers_list SET ordinal=? WHERE id=? AND session_id=?', [i, sid, sessionId]))
    })
    return speakersOf(sessionId)
  })

  /**
   * Close whoever is speaking and open the next one waiting.
   *
   * `back: true` steps the other way, for the routine case of the chair
   * correcting themselves a second after moving on.
   */
  app.post('/api/speakers/advance', async (req, reply) => {
    const { session_id: sessionId, seconds = null, back = false } = req.body || {}
    if (!sessionId) return reply.code(400).send({ error: 'A session is required.' })

    tx(() => {
      const queue = speakersOf(sessionId)
      const currentIdx = queue.findIndex((s) => s.status === 'speaking')

      if (back) {
        // Reopen the most recent finished speaker; the current one goes back to
        // waiting rather than being marked done it never was.
        const prev = [...queue.slice(0, currentIdx < 0 ? queue.length : currentIdx)]
          .reverse().find((s) => s.status === 'done' || s.status === 'skipped')
        if (currentIdx >= 0) {
          run("UPDATE speakers_list SET status='waiting', started_at=NULL WHERE id=?", [queue[currentIdx].id])
        }
        if (prev) {
          run("UPDATE speakers_list SET status='speaking', ended_at=NULL, seconds=NULL WHERE id=?", [prev.id])
        }
      } else {
        if (currentIdx >= 0) {
          // The client's stopwatch is the delegate's own view of the speech and
          // is preferred when it has one. But it is not always trustworthy: it
          // is not running after a page reload, and it is reset by the speaking-
          // time buttons that share it — both of which recorded a confident
          // `0:00` against a speech that really happened. `started_at` is on the
          // row and survives all of that, so it is the fallback.
          const row = queue[currentIdx]
          let measured = Number.isFinite(seconds) && seconds > 0 ? seconds : null
          if (measured == null && row.started_at) {
            const began = Date.parse(row.started_at)
            if (Number.isFinite(began)) {
              measured = Math.max(0, Math.round((Date.now() - began) / 1000))
            }
          }
          run("UPDATE speakers_list SET status='done', ended_at=?, seconds=? WHERE id=?",
            [now(), measured, row.id])
        }
        const next = queue.find((s, i) => i > currentIdx && s.status === 'waiting')
        if (next) run("UPDATE speakers_list SET status='speaking', started_at=? WHERE id=?", [now(), next.id])
      }

      syncCurrentSpeaker(sessionId)
    })

    const queue = speakersOf(sessionId)
    const currentIdx = queue.findIndex((s) => s.status === 'speaking')
    return {
      speakers: queue,
      current: currentIdx >= 0 ? queue[currentIdx] : null,
      next: queue.find((s, i) => i > currentIdx && s.status === 'waiting') ?? null,
    }
  })

  // ────────────────────────────────────────────────────────── transcript

  app.get('/api/transcript/:sessionId', async (req) =>
    all('SELECT * FROM transcript_segments WHERE session_id = ? ORDER BY ts', [req.params.sessionId]))

  app.post('/api/transcript', async (req) => {
    const b = req.body || {}
    const segId = id('seg_')
    const cls = b.classification
      ? { classification: b.classification, relevance: 0.6 }
      : await ai.classifySegment(b.text || '')
    run(`INSERT INTO transcript_segments(id,session_id,speaker,country,text,ts,source,classification,relevance)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      [segId, b.session_id, b.speaker || 'Unknown', b.country ?? null, b.text || '',
       b.ts || now(), b.source || 'manual', cls.classification, cls.relevance])
    return { ...get('SELECT * FROM transcript_segments WHERE id = ?', [segId]), classifiedVia: cls.via }
  })

  app.patch('/api/transcript/:id', async (req) => {
    const b = req.body || {}
    const sets = [], vals = []
    for (const k of ['speaker', 'country', 'text', 'classification', 'pinned']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(typeof b[k] === 'boolean' ? bool(b[k]) : b[k]) }
    }
    if (sets.length) run(`UPDATE transcript_segments SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    return get('SELECT * FROM transcript_segments WHERE id = ?', [req.params.id])
  })

  /** Rename every segment from one speaker label — "Speaker A" -> "Austria". */
  app.post('/api/transcript/rename-speaker', async (req) => {
    const { session_id, from, to, country } = req.body || {}
    run('UPDATE transcript_segments SET speaker=?, country=? WHERE session_id=? AND speaker=?',
      [to, country ?? null, session_id, from])
    return { ok: true }
  })

  app.delete('/api/transcript/:id', async (req) => {
    run('DELETE FROM transcript_segments WHERE id=?', [req.params.id]); return { ok: true }
  })

  // ─────────────────────────────────────────────────────────────── AI

  app.get('/api/ai/status', async () => ai.aiStatus())

  app.post('/api/ai/respond', async (req) => {
    const b = req.body || {}
    if (!b.statement?.trim()) return { ok: false, reason: 'No statement provided.' }
    return ai.respondToThis(b)
  })

  app.post('/api/ai/defense', async (req) => ai.defenseMode(req.body || {}))
  app.post('/api/ai/clause', async (req) => ai.checkClause(req.body || {}))
  app.post('/api/ai/summary', async (req) => ai.sessionSummary(req.body || {}))
  app.post('/api/ai/practice/challenge', async (req) => ai.practiceChallenge(req.body || {}))
  app.post('/api/ai/practice/evaluate', async (req) => ai.practiceEvaluate(req.body || {}))

  // ────────────────────────────────────────────────────────── API keys
  //
  // The key value travels one way only: browser → server, over localhost, once.
  // It is stored in the local database on this laptop and is never sent back —
  // every response below reports presence, provenance and a masked hint.

  app.get('/api/ai/keys', async () => ({
    providers: keyStatus(),
    status: ai.aiStatus(),
    claudeCli: await probeCLI(),
  }))

  /** Choose the backend: 'anthropic' | 'claude-cli' | 'openai' | 'google'. */
  app.post('/api/ai/provider', async (req, reply) => {
    const name = (req.body || {}).provider
    if (!['anthropic', 'claude-cli', 'openai', 'google'].includes(name)) {
      return reply.code(400).send({ error: `Unknown provider: ${name}` })
    }
    setProvider(name)
    logEvent('settings', `AI backend set to ${name}`)
    return { ok: true, status: ai.aiStatus() }
  })

  /** One real round trip, so "it works" is proven rather than assumed. */
  app.post('/api/ai/test', async () => {
    const t0 = Date.now()
    const res = await ai.testRoundTrip()
    return { ...res, elapsedMs: Date.now() - t0 }
  })

  app.post('/api/ai/key', async (req, reply) => {
    const { provider = 'anthropic', key = '' } = req.body || {}
    if (!AI_PROVIDERS.includes(provider)) {
      return reply.code(400).send({ error: `Unknown provider: ${provider}` })
    }
    const value = String(key).trim()
    if (!value) return reply.code(400).send({ error: 'No key was entered.' })

    const test = await testKey(provider, value)
    // A rejected key is never stored — otherwise the app would claim to have AI
    // and then fail on the one analysis that mattered.
    if (test.result === 'invalid') return reply.code(400).send({ error: test.reason })

    saveKey(provider, value)
    logEvent('settings', `${provider} API key saved`)
    return {
      ok: true,
      verified: test.result === 'valid',
      note: test.result === 'valid' ? 'Key verified and saved.' : test.reason,
      providers: keyStatus(),
      status: ai.aiStatus(),
    }
  })

  app.delete('/api/ai/key/:provider', async (req, reply) => {
    if (!AI_PROVIDERS.includes(req.params.provider)) {
      return reply.code(400).send({ error: 'Unknown provider.' })
    }
    clearKey(req.params.provider)
    logEvent('settings', `${req.params.provider} API key removed`)
    return { ok: true, providers: keyStatus(), status: ai.aiStatus() }
  })

  app.get('/api/ai/analyses', async (req) =>
    all('SELECT * FROM ai_analyses ORDER BY created_at DESC LIMIT ?', [Number(req.query.limit) || 20])
      .map((a) => ({ ...a, output: json.parse(a.output_json, {}), citations: json.parse(a.citations, []) })))

  // ─────────────────────────────────────────────────────── resolutions

  app.get('/api/resolutions', async () =>
    all('SELECT * FROM resolutions ORDER BY is_active DESC, created_at DESC').map((r) => ({
      ...r,
      sponsors: json.parse(r.sponsors, []),
      signatories: json.parse(r.signatories, []),
      open_issues: json.parse(r.open_issues, []),
    })))

  app.get('/api/resolutions/:id', async (req, reply) => {
    const r = get('SELECT * FROM resolutions WHERE id = ?', [req.params.id])
    if (!r) return reply.code(404).send({ error: 'Resolution not found.' })
    const clauses = all('SELECT * FROM clauses WHERE resolution_id = ? ORDER BY kind DESC, ordinal', [req.params.id])
    return {
      ...r,
      sponsors: json.parse(r.sponsors, []),
      signatories: json.parse(r.signatories, []),
      open_issues: json.parse(r.open_issues, []),
      clauses: clauses.map((c) => ({ ...c, flags: json.parse(c.flags_json, null) })),
      stats: {
        preambulatory: clauses.filter((c) => c.kind === 'PRE').length,
        operative: clauses.filter((c) => c.kind === 'OP').length,
        sponsors: json.parse(r.sponsors, []).length,
        signatories: json.parse(r.signatories, []).length,
        openIssues: json.parse(r.open_issues, []).length,
      },
      duplicates: findDuplicateClauses(clauses),
    }
  })

  app.post('/api/resolutions', async (req) => {
    const b = req.body || {}
    const rid = id('res_')
    if (b.active !== false) run('UPDATE resolutions SET is_active = 0')
    run(`INSERT INTO resolutions(id,title,committee,agenda,sponsors,signatories,open_issues,is_active,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [rid, b.title || 'Untitled draft resolution', b.committee || COMMITTEE.committee,
       b.agenda ?? COMMITTEE.agenda, json.stringify(b.sponsors ?? []), json.stringify(b.signatories ?? []),
       json.stringify(b.open_issues ?? []), b.active === false ? 0 : 1, now(), now()])
    return get('SELECT * FROM resolutions WHERE id = ?', [rid])
  })

  /**
   * Import a draft written in Word, or pasted as plain text, into structured
   * clauses. Local and deterministic — no AI, works offline.
   *
   * Body: { text } | { docxBase64, filename }, plus
   *       { mode: 'replace' | 'append' | 'new', resolutionId, preview: true }
   *
   * `preview: true` parses and returns without writing anything, so the delegate
   * always sees what the import will do before it touches their draft.
   */
  app.post('/api/resolutions/import', async (req, reply) => {
    const b = req.body || {}
    let source
    try {
      if (b.docxBase64) {
        const buf = Buffer.from(b.docxBase64, 'base64')
        if (!buf.length) return reply.code(400).send({ error: 'The uploaded file was empty.' })
        source = await linesFromDocx(buf)
      } else if (typeof b.text === 'string' && b.text.trim()) {
        source = b.text
      } else {
        return reply.code(400).send({ error: 'Nothing to import — paste text or choose a .docx file.' })
      }
    } catch (err) {
      return reply.code(400).send({
        error: `Could not read that file — ${err?.message ?? 'unknown error'}. ` +
               'If it is a .doc or PDF, open it in Word and use Save As → .docx, or paste the text instead.',
      })
    }

    const parsed = parseResolution(source)
    if (b.preview) return { preview: true, ...parsed }
    if (!parsed.clauses.length) {
      return reply.code(400).send({ error: parsed.warnings[0] || 'No clauses were recognised.' })
    }

    const mode = b.mode || 'replace'
    let rid = b.resolutionId
    if (mode === 'new' || !rid) {
      rid = id('res_')
      run('UPDATE resolutions SET is_active = 0')
      run(`INSERT INTO resolutions(id,title,committee,agenda,sponsors,signatories,open_issues,is_active,created_at,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?)`,
        [rid, parsed.title || b.filename || 'Imported draft resolution',
         parsed.committee || COMMITTEE.committee, parsed.agenda ?? COMMITTEE.agenda,
         json.stringify(parsed.sponsors), json.stringify(parsed.signatories),
         json.stringify([]), 1, now(), now()])
    } else {
      if (!get('SELECT id FROM resolutions WHERE id = ?', [rid])) {
        return reply.code(404).send({ error: 'Resolution not found.' })
      }
      if (mode === 'replace') run('DELETE FROM clauses WHERE resolution_id = ?', [rid])
      const sets = [], vals = []
      if (parsed.sponsors.length) { sets.push('sponsors=?'); vals.push(json.stringify(parsed.sponsors)) }
      if (parsed.signatories.length) { sets.push('signatories=?'); vals.push(json.stringify(parsed.signatories)) }
      if (parsed.agenda) { sets.push('agenda=?'); vals.push(parsed.agenda) }
      sets.push('updated_at=?'); vals.push(now())
      run(`UPDATE resolutions SET ${sets.join(',')} WHERE id=?`, [...vals, rid])
    }

    const base = { PRE: 0, OP: 0 }
    if (mode === 'append') {
      for (const kind of ['PRE', 'OP']) {
        base[kind] = (get('SELECT MAX(ordinal) AS m FROM clauses WHERE resolution_id=? AND kind=?',
          [rid, kind])?.m ?? -1) + 1
      }
    }
    const counters = { PRE: base.PRE, OP: base.OP }
    for (const c of parsed.clauses) {
      run(`INSERT INTO clauses(id,resolution_id,kind,ordinal,parent_id,opener,text,note,created_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        [id('cl_'), rid, c.kind, counters[c.kind]++, null, c.opener, c.text, null, now()])
    }
    logEvent('resolution', `Imported ${parsed.clauses.length} clauses${b.filename ? ` from ${b.filename}` : ''}`)
    return { ok: true, resolutionId: rid, imported: parsed.clauses.length, ...parsed }
  })

  /** Plain text of a resolution, for download or handing to the Chair. */
  app.get('/api/resolutions/:id/text', async (req, reply) => {
    const r = get('SELECT * FROM resolutions WHERE id = ?', [req.params.id])
    if (!r) return reply.code(404).send({ error: 'Resolution not found.' })
    const clauses = all('SELECT * FROM clauses WHERE resolution_id = ? ORDER BY kind DESC, ordinal', [req.params.id])
    return {
      title: r.title,
      text: renderResolution({
        ...r, sponsors: json.parse(r.sponsors, []), signatories: json.parse(r.signatories, []),
      }, clauses),
    }
  })

  app.delete('/api/resolutions/:id', async (req) => {
    run('DELETE FROM clauses WHERE resolution_id=?', [req.params.id])
    run('DELETE FROM resolutions WHERE id=?', [req.params.id])
    const next = get('SELECT id FROM resolutions ORDER BY created_at DESC LIMIT 1')
    if (next) run('UPDATE resolutions SET is_active=1 WHERE id=?', [next.id])
    return { ok: true }
  })

  app.post('/api/resolutions/:id/activate', async (req) => {
    run('UPDATE resolutions SET is_active = 0')
    run('UPDATE resolutions SET is_active = 1 WHERE id=?', [req.params.id])
    return { ok: true }
  })

  app.patch('/api/resolutions/:id', async (req) => {
    const b = req.body || {}
    const sets = [], vals = []
    for (const k of ['title', 'agenda', 'committee']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]) }
    }
    for (const k of ['sponsors', 'signatories', 'open_issues']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(json.stringify(b[k])) }
    }
    sets.push('updated_at=?'); vals.push(now())
    run(`UPDATE resolutions SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    return { ok: true }
  })

  app.post('/api/clauses', async (req) => {
    const b = req.body || {}
    const cid = id('cl_')
    const max = get('SELECT MAX(ordinal) AS m FROM clauses WHERE resolution_id=? AND kind=?',
      [b.resolution_id, b.kind || 'OP'])?.m ?? -1
    run(`INSERT INTO clauses(id,resolution_id,kind,ordinal,parent_id,opener,text,note,created_at)
         VALUES(?,?,?,?,?,?,?,?,?)`,
      [cid, b.resolution_id, b.kind || 'OP', max + 1, b.parent_id ?? null,
       b.opener ?? null, b.text || '', b.note ?? null, now()])
    return get('SELECT * FROM clauses WHERE id = ?', [cid])
  })

  app.patch('/api/clauses/:id', async (req) => {
    const b = req.body || {}
    const sets = [], vals = []
    for (const k of ['text', 'opener', 'note', 'ordinal', 'kind', 'parent_id']) {
      if (b[k] !== undefined) { sets.push(`${k}=?`); vals.push(b[k]) }
    }
    if (b.flags !== undefined) { sets.push('flags_json=?'); vals.push(json.stringify(b.flags)) }
    if (sets.length) run(`UPDATE clauses SET ${sets.join(',')} WHERE id=?`, [...vals, req.params.id])
    return get('SELECT * FROM clauses WHERE id = ?', [req.params.id])
  })

  app.delete('/api/clauses/:id', async (req) => { run('DELETE FROM clauses WHERE id=?', [req.params.id]); return { ok: true } })

  /** Reorder within a kind. Body: { ids: [...] } in the new order. */
  app.post('/api/clauses/reorder', async (req) => {
    const { ids = [] } = req.body || {}
    ids.forEach((cid, i) => run('UPDATE clauses SET ordinal=? WHERE id=?', [i, cid]))
    return { ok: true }
  })

  app.get('/api/clause-library', async () =>
    all('SELECT * FROM clause_library ORDER BY kind DESC, priority, ordinal'))

  // ───────────────────────────────────────────────────────────── export

  app.get('/api/export/:sessionId', async (req) => {
    const s = get('SELECT * FROM sessions WHERE id = ?', [req.params.sessionId])
    const resolution = get('SELECT * FROM resolutions WHERE is_active = 1')
    return {
      exportedAt: now(),
      committee: COMMITTEE,
      session: s,
      transcript: all('SELECT * FROM transcript_segments WHERE session_id=? ORDER BY ts', [req.params.sessionId]),
      notes: all('SELECT * FROM notes WHERE session_id=? ORDER BY created_at', [req.params.sessionId]),
      analyses: all('SELECT * FROM ai_analyses WHERE session_id=? ORDER BY created_at', [req.params.sessionId])
        .map((a) => ({ ...a, output: json.parse(a.output_json, {}) })),
      poisAsked: all('SELECT * FROM pois WHERE asked_at IS NOT NULL'),
      speechesUsed: all('SELECT title, category, used_at, use_count FROM speeches WHERE used_at IS NOT NULL'),
      bloc: all('SELECT * FROM bloc_members'),
      resolution: resolution
        ? { ...resolution, clauses: all('SELECT * FROM clauses WHERE resolution_id=? ORDER BY kind DESC, ordinal', [resolution.id]) }
        : null,
    }
  })

  // ─────────────────────────────────────────────────────────────── seed

  app.post('/api/seed', async (req) => seed({ force: req.body?.force }))
}

/** Cheap lexical duplicate detection — no AI needed, works offline. */
function findDuplicateClauses(clauses) {
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter((w) => w.length > 3)
  const out = []
  for (let i = 0; i < clauses.length; i++) {
    for (let j = i + 1; j < clauses.length; j++) {
      const a = new Set(norm(clauses[i].text))
      const b = new Set(norm(clauses[j].text))
      if (a.size < 4 || b.size < 4) continue
      const overlap = [...a].filter((w) => b.has(w)).length
      const score = overlap / Math.min(a.size, b.size)
      if (score > 0.6) {
        out.push({
          a: clauses[i].id, b: clauses[j].id,
          aLabel: `${clauses[i].kind}${clauses[i].ordinal + 1}`,
          bLabel: `${clauses[j].kind}${clauses[j].ordinal + 1}`,
          similarity: Math.round(score * 100),
        })
      }
    }
  }
  return out
}
