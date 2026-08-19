// Import pipeline: DOCUMENT -> EXTRACT -> CLEAN -> CHUNK -> METADATA -> INDEX.
// The original file is never modified, moved, or copied — only read.

import fs from 'node:fs/promises'
import path from 'node:path'
import { all, get, run, tx, id, now, logEvent } from '../db/client.js'
import { parseDocument, isSupported } from './parse.js'
import { chunkPages } from './chunk.js'
import { classifyDocument } from './classify.js'
import { SOURCE_DIR, DATA_DIR } from '../config.js'

/**
 * Folders this app is allowed to touch: the delegate's prep material, and its
 * own data directory.
 *
 * The import routes take a caller-supplied path, and the server listens on
 * localhost with no authentication — so without this, any page open in the
 * browser could ask it to scan `C:\Users\<name>\Documents` and then import any
 * PDF or DOCX on the machine, whose full text would land in the database and be
 * served straight back out by /api/documents/:id and /api/search.
 *
 * Enforced here rather than in the route so every caller is covered.
 */
const ROOTS = [SOURCE_DIR, DATA_DIR].map((r) => path.resolve(r))

// Windows paths are case-insensitive, and the drive letter's case in
// particular is not stable — `c:\Users\...` and `C:\Users\...` are the same
// folder, so comparing them exactly would 403 a perfectly legitimate scan.
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin'
const cmp = (p) => (CASE_INSENSITIVE ? p.toLowerCase() : p)

function assertInsideRoots(target) {
  const abs = path.resolve(target)
  const a = cmp(abs)
  // The trailing separator matters: without it "C:\munition" passes a
  // startsWith check against a root of "C:\mun".
  const ok = ROOTS.some((root) => a === cmp(root) || a.startsWith(cmp(root + path.sep)))
  if (!ok) {
    const err = new Error(
      `That path is outside the documents folder. This app only reads from ${SOURCE_DIR}.`
    )
    err.statusCode = 403
    throw err
  }
  return abs
}

/** List candidate files in a folder without importing them. */
export async function scanFolder(dir = SOURCE_DIR) {
  const abs = assertInsideRoots(dir)
  let entries
  try {
    entries = await fs.readdir(abs, { withFileTypes: true })
  } catch (err) {
    throw new Error(`Cannot read folder "${abs}" — ${err.code || err.message}`)
  }

  const files = []
  for (const e of entries) {
    if (!e.isFile()) continue
    if (e.name.startsWith('~$') || e.name.startsWith('.')) continue // Word lock files
    const full = path.join(abs, e.name)
    if (!isSupported(full)) continue
    const stat = await fs.stat(full).catch(() => null)
    const existing = get('SELECT id, hash, indexed_at FROM documents WHERE path = ?', [full])
    files.push({
      path: full,
      filename: e.name,
      bytes: stat?.size ?? 0,
      modified: stat?.mtime?.toISOString() ?? null,
      alreadyImported: Boolean(existing),
      suggestion: classifyDocument({ filename: e.name, folder: abs, text: '' }),
    })
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename))
}

/**
 * Import one file. Idempotent: re-importing an unchanged file is a no-op,
 * a changed file is re-chunked in place keeping its id and user metadata.
 * @returns {Promise<{status:string, document?:object, error?:string}>}
 */
export async function importFile(file, overrides = {}) {
  const abs = assertInsideRoots(file)
  const filename = path.basename(abs)
  const existing = get('SELECT * FROM documents WHERE path = ?', [abs])

  let parsed
  try {
    parsed = await parseDocument(abs)
  } catch (err) {
    // Record the failure so the library shows *why*, rather than hiding the file.
    const docId = existing?.id ?? id('doc_')
    const meta = classifyDocument({ filename, folder: path.dirname(abs), text: '' })
    run(
      `INSERT INTO documents(id, path, filename, title, category, country, source_type,
         priority, parse_status, parse_error, added_at)
       VALUES(?,?,?,?,?,?,?,?,'failed',?,?)
       ON CONFLICT(path) DO UPDATE SET parse_status='failed', parse_error=excluded.parse_error`,
      [docId, abs, filename, meta.title, meta.category, meta.country, meta.sourceType,
       meta.priority, err.message, now()]
    )
    return { status: 'failed', error: err.message, filename }
  }

  if (existing && existing.hash === parsed.hash && existing.indexed_at) {
    return { status: 'unchanged', document: existing }
  }

  // Duplicate content under a different filename — flag, don't silently merge.
  const dupe = get('SELECT id, filename FROM documents WHERE hash = ? AND path != ?', [parsed.hash, abs])

  const auto = classifyDocument({ filename, folder: path.dirname(abs), text: parsed.text })
  const meta = {
    title: overrides.title ?? existing?.title ?? auto.title,
    category: overrides.category ?? existing?.category ?? auto.category,
    country: overrides.country ?? existing?.country ?? auto.country,
    sourceType: overrides.sourceType ?? existing?.source_type ?? auto.sourceType,
    priority: overrides.priority ?? existing?.priority ?? auto.priority,
  }

  const chunks = chunkPages(parsed.pages)
  const docId = existing?.id ?? id('doc_')

  tx(() => {
    if (existing) {
      run('DELETE FROM chunks WHERE document_id = ?', [docId])
      run(
        `UPDATE documents SET filename=?, title=?, category=?, country=?, source_type=?,
           priority=?, hash=?, page_count=?, char_count=?, parse_status='ok',
           parse_error=NULL, indexed_at=? WHERE id=?`,
        [filename, meta.title, meta.category, meta.country, meta.sourceType, meta.priority,
         parsed.hash, parsed.meta.pageCount ?? null, parsed.text.length, now(), docId]
      )
    } else {
      run(
        `INSERT INTO documents(id, path, filename, title, category, country, source_type,
           priority, hash, page_count, char_count, parse_status, added_at, indexed_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'ok',?,?)`,
        [docId, abs, filename, meta.title, meta.category, meta.country, meta.sourceType,
         meta.priority, parsed.hash, parsed.meta.pageCount ?? null, parsed.text.length, now(), now()]
      )
    }
    for (const c of chunks) {
      run(
        `INSERT INTO chunks(id, document_id, ordinal, text, page, heading, section, char_count)
         VALUES(?,?,?,?,?,?,?,?)`,
        [id('ch_'), docId, c.ordinal, c.text, c.page, c.heading, c.section, c.text.length]
      )
    }
  })

  logEvent('import', `Imported ${meta.title}`, { chunks: chunks.length })

  return {
    status: existing ? 'updated' : 'imported',
    duplicateOf: dupe ? dupe.filename : null,
    document: get('SELECT * FROM documents WHERE id = ?', [docId]),
    chunks: chunks.length,
    autoClassified: auto,
  }
}

/** Import every supported file in a folder. Never throws on a single bad file. */
export async function importFolder(dir = SOURCE_DIR) {
  const files = await scanFolder(dir)
  const results = []
  for (const f of files) {
    try {
      results.push({ filename: f.filename, ...(await importFile(f.path)) })
    } catch (err) {
      results.push({ filename: f.filename, status: 'failed', error: err.message })
    }
  }
  const summary = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {})
  return { folder: path.resolve(dir), results, summary }
}

export function listDocuments({ includeArchived = false } = {}) {
  return all(
    `SELECT d.*, (SELECT COUNT(*) FROM chunks c WHERE c.document_id = d.id) AS chunk_count
     FROM documents d
     ${includeArchived ? '' : 'WHERE d.archived = 0'}
     ORDER BY d.pinned DESC, d.priority ASC, d.title ASC`
  )
}

export function getDocument(docId) {
  const doc = get('SELECT * FROM documents WHERE id = ?', [docId])
  if (!doc) return null
  return { ...doc, chunks: all('SELECT * FROM chunks WHERE document_id = ? ORDER BY ordinal', [docId]) }
}

export function updateDocument(docId, patch) {
  const allowed = {
    title: 'title', category: 'category', country: 'country', notes: 'notes',
    priority: 'priority', verified: 'verified', pinned: 'pinned',
    archived: 'archived', sourceType: 'source_type',
  }
  const sets = []
  const vals = []
  for (const [key, col] of Object.entries(allowed)) {
    if (patch[key] !== undefined) {
      sets.push(`${col} = ?`)
      vals.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : patch[key])
    }
  }
  if (!sets.length) return get('SELECT * FROM documents WHERE id = ?', [docId])
  run(`UPDATE documents SET ${sets.join(', ')} WHERE id = ?`, [...vals, docId])
  return get('SELECT * FROM documents WHERE id = ?', [docId])
}

/** Removes the record and its chunks. The original file on disk is untouched. */
export function deleteDocument(docId) {
  run('DELETE FROM documents WHERE id = ?', [docId])
  return { ok: true, note: 'Record removed. The original file on disk was not modified.' }
}
