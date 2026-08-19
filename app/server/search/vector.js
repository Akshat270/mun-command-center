// Optional semantic tier.
//
// Keyword + alias search (Tier 1) is the guaranteed product and works offline
// with zero extra dependencies. This adds concept matching on top, using a
// LOCAL embedding model so that once the model is cached the feature keeps
// working with the network unplugged — important for the committee room.
//
// The embedding library is an OPTIONAL dependency, imported lazily. If it is
// not installed, every function here degrades quietly and search stays on
// Tier 1. Nothing in this file may ever throw into the request path.

import { all, get, run, tx } from '../db/client.js'
import { CACHE_DIR } from '../config.js'

const MODEL = 'Xenova/all-MiniLM-L6-v2' // ~23 MB quantised, 384 dims
const DIM = 384

// Cosine similarity is defined for every pair of texts, so without a floor a
// nonsense query still returns the "closest" passages — which mid-committee
// reads as a real answer. Measured on this corpus:
//   nonsense ("zzqqxxnothing", "banana bread recipe")  0.15 – 0.23
//   weak but genuine ("what stops onward sharing")     0.33 – 0.36
//   strong ("oversight of intelligence agencies")      0.57 – 0.62
// 0.30 sits in the gap: no result beats saying nothing matches.
const MIN_SIM = 0.3

let pipe = null
let loadError = null
let building = null // { done, total, startedAt }

/**
 * Load the embedding pipeline.
 *
 * `force` retries even after a previous failure. This matters: the failure a
 * delegate actually hits is "not installed", they then install it, and a cached
 * error would keep reporting the same message until the server restarted —
 * with the fix already applied on disk. An explicit "Build index" click must
 * always try again for real.
 */
async function getPipeline({ force = false } = {}) {
  if (pipe) return pipe
  if (loadError && !force) return null
  loadError = null
  try {
    const { pipeline, env } = await import('@huggingface/transformers')
    env.allowRemoteModels = true
    // Cache the model outside node_modules so reinstalling dependencies cannot
    // silently delete the one thing that makes this work offline.
    env.cacheDir = CACHE_DIR
    pipe = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    return pipe
  } catch (err) {
    loadError =
      err.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find package/i.test(err.message || '')
        ? 'Semantic search is not installed. In the app folder run: npm install @huggingface/transformers'
        : /fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|network/i.test(err.message || '')
          ? 'Could not download the embedding model — no internet. Keyword search is unaffected.'
          : `Semantic model unavailable — ${err.message}`
    return null
  }
}

const toBlob = (arr) => Buffer.from(new Float32Array(arr).buffer)
const fromBlob = (buf) =>
  new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)

function cosine(a, b) {
  let dot = 0
  // Vectors are L2-normalised at write time, so the dot product is the cosine.
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

function normalise(vec) {
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return Array.from(vec, (v) => v / norm)
}

async function embed(texts) {
  const p = await getPipeline()
  if (!p) return null
  const out = await p(texts, { pooling: 'mean', normalize: true })
  const data = out.data
  const rows = []
  for (let i = 0; i < texts.length; i++) {
    rows.push(normalise(data.slice(i * DIM, (i + 1) * DIM)))
  }
  return rows
}

export function semanticStatus() {
  let indexed = 0
  let total = 0
  try {
    indexed = get('SELECT COUNT(*) AS n FROM embeddings')?.n ?? 0
    total = get('SELECT COUNT(*) AS n FROM chunks')?.n ?? 0
  } catch { /* DB degraded; report zeros */ }
  return {
    built: indexed > 0,
    indexed,
    total,
    coverage: total ? Math.round((indexed / total) * 100) : 0,
    model: MODEL,
    available: !loadError,
    error: loadError,
    building: building ? { ...building } : null,
    note: building
      ? building.total
        ? `${building.phase} ${building.done} of ${building.total} passages.`
        : building.phase
      : indexed
        ? 'Semantic search active. Works offline now that the model is cached.'
        : 'Semantic index not built. Keyword search is active and fully offline.',
  }
}

/**
 * Build (or top up) the semantic index. Run this BEFORE the competition, while
 * internet is available — the model downloads once, then works offline.
 */
export async function buildSemanticIndex({ wait = false } = {}) {
  if (building) return { status: 'already-running', ...semanticStatus() }

  // The first run downloads ~23 MB and then embeds every passage — a minute or
  // more on venue wifi. Holding the HTTP request open for that long looks like
  // a hang and can time out, so the work runs in the background and progress is
  // read from /api/search/semantic. `wait` is for tests and scripts.
  building = { done: 0, total: 0, startedAt: Date.now(), phase: 'Loading the embedding model…' }
  lastResult = null
  const job = runBuild()
  if (wait) return job
  return { status: 'started', ...semanticStatus() }
}

let lastResult = null

async function runBuild() {
  try {
    // Explicit user action: always retry the load, never trust a cached failure.
    const p = await getPipeline({ force: true })
    if (!p) return (lastResult = { status: 'unavailable', error: loadError })

    const pending = all(
      `SELECT c.id, c.text, c.heading FROM chunks c
        LEFT JOIN embeddings e ON e.chunk_id = c.id
        WHERE e.chunk_id IS NULL`
    )
    if (!pending.length) return (lastResult = { status: 'up-to-date' })

    building.total = pending.length
    building.phase = 'Indexing passages…'
    const BATCH = 32
    for (let i = 0; i < pending.length; i += BATCH) {
      const batch = pending.slice(i, i + BATCH)
      const texts = batch.map((c) => (c.heading ? `${c.heading}. ${c.text}` : c.text))
      const vecs = await embed(texts)
      if (!vecs) break
      tx(() => {
        batch.forEach((c, j) => {
          run(
            `INSERT INTO embeddings(chunk_id, vec, dim, model) VALUES(?,?,?,?)
             ON CONFLICT(chunk_id) DO UPDATE SET vec=excluded.vec, model=excluded.model`,
            [c.id, toBlob(vecs[j]), DIM, MODEL]
          )
        })
      })
      building.done = Math.min(i + BATCH, pending.length)
    }
    return (lastResult = { status: 'built' })
  } catch (err) {
    return (lastResult = { status: 'failed', error: err.message })
  } finally {
    building = null
    // Merge the outcome into the status the UI polls for.
    if (lastResult) lastResult = { ...lastResult, ...semanticStatus() }
  }
}

export const lastBuildResult = () => lastResult

export function clearSemanticIndex() {
  run('DELETE FROM embeddings')
  return semanticStatus()
}

/**
 * Brute-force cosine over all embeddings. At a few thousand chunks this is
 * well under 10 ms — a vector database would be pure overhead here.
 * Returns [] whenever the tier is unavailable, so callers never branch on errors.
 */
export async function semanticSearch(query, limit = 20) {
  let rows
  try {
    rows = all(
      `SELECT e.chunk_id, e.vec, c.document_id, c.ordinal, c.text, c.page, c.heading, c.section,
              d.title AS doc_title, d.category, d.country, d.priority, d.verified
         FROM embeddings e
         JOIN chunks    c ON c.id = e.chunk_id
         JOIN documents d ON d.id = c.document_id
        WHERE d.archived = 0`
    )
  } catch { return [] }
  if (!rows.length) return []

  const qvec = await embed([query]).catch(() => null)
  if (!qvec) return []
  const q = Float32Array.from(qvec[0])

  return rows
    .map((r) => ({ ...r, id: r.chunk_id, sim: cosine(q, fromBlob(r.vec)) }))
    .filter((r) => r.sim >= MIN_SIM)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, limit)
}

export const semanticFloor = () => MIN_SIM
