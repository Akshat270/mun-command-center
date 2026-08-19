// SQLite access via Node's built-in node:sqlite (no native build step).
// A single process owns the DB, so one synchronous connection is correct
// and avoids every async-pool failure mode under competition pressure.

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DB_PATH } from '../config.js'

const here = path.dirname(fileURLToPath(import.meta.url))

let db = null
let degraded = null // human-readable reason when the DB is unusable

export function getDB() {
  if (db) return db
  try {
    db = new DatabaseSync(DB_PATH)
    const schema = fs.readFileSync(path.join(here, 'schema.sql'), 'utf8')
    db.exec(schema)
    migrate(db)
    degraded = null
  } catch (err) {
    degraded = err.message
    db = null
    throw new Error(`Local storage unavailable — changes may not persist. (${err.message})`)
  }
  return db
}

/**
 * Migrations for databases created before a change landed.
 *
 * `schema.sql` uses CREATE TABLE IF NOT EXISTS, so it silently does nothing to
 * an existing table — a new column there would never reach a database that is
 * already in use, which is every database that matters.
 *
 * Two shapes are allowed, both chosen because they cannot lose a delegate's
 * work: adding a column, and renaming a value inside a known enum column.
 * Nothing is ever dropped, and no user-entered text is rewritten.
 */
function migrate(d) {
  const ADDITIONS = [
    // Hiding beats deleting for prepared material: a POI that is wrong for this
    // committee may be exactly right in the next session.
    ['pois', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
    ['qa', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
    ['speeches', 'hidden', 'INTEGER NOT NULL DEFAULT 0'],
  ]
  for (const [table, column, ddl] of ADDITIONS) {
    try {
      const cols = d.prepare(`PRAGMA table_info(${table})`).all()
      if (!cols.length) continue
      if (cols.some((c) => c.name === column)) continue
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
    } catch (err) {
      // A failed optional migration must not stop the app from starting.
      console.warn('[db] could not add %s.%s — %s', table, column, err.message)
    }
  }

  // `qa.kind` used to name one country, from when this app was written for a
  // single committee. It is an internal label the delegate never types, so
  // renaming it is safe — but existing rows still carry the old value, and a row
  // whose kind matches no tab is invisible in the UI rather than merely
  // mislabelled. Idempotent: after the first run there is nothing left to match.
  const RENAMES = [
    ['qa', 'kind', 'likely_to_canada', 'likely_to_us'],
  ]
  for (const [table, column, from, to] of RENAMES) {
    try {
      const cols = d.prepare(`PRAGMA table_info(${table})`).all()
      if (!cols.some((c) => c.name === column)) continue
      d.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`).run(to, from)
    } catch (err) {
      console.warn('[db] could not rename %s.%s value — %s', table, column, err.message)
    }
  }
}

export function dbStatus() {
  try {
    getDB()
    return { ok: true, path: DB_PATH }
  } catch {
    return { ok: false, path: DB_PATH, error: degraded }
  }
}

/** Run a SELECT and return all rows. */
export function all(sql, params = []) {
  return getDB().prepare(sql).all(...params)
}

/** Run a SELECT and return the first row, or undefined. */
export function get(sql, params = []) {
  return getDB().prepare(sql).get(...params)
}

/** Run an INSERT/UPDATE/DELETE. */
export function run(sql, params = []) {
  return getDB().prepare(sql).run(...params)
}

/** Wrap fn in a transaction. Rolls back and rethrows on error. */
export function tx(fn) {
  const d = getDB()
  d.exec('BEGIN')
  try {
    const out = fn()
    d.exec('COMMIT')
    return out
  } catch (err) {
    try { d.exec('ROLLBACK') } catch { /* already rolled back */ }
    throw err
  }
}

let counter = 0
/** Stable, sortable, collision-resistant enough for a single-user local app. */
export function id(prefix = '') {
  counter = (counter + 1) % 0xffff
  const t = Date.now().toString(36)
  const c = counter.toString(36).padStart(3, '0')
  const r = Math.random().toString(36).slice(2, 7)
  return `${prefix}${t}${c}${r}`
}

export const now = () => new Date().toISOString()

export function getSetting(key, fallback = null) {
  try {
    const row = get('SELECT value FROM settings WHERE key = ?', [key])
    return row ? JSON.parse(row.value) : fallback
  } catch {
    return fallback
  }
}

export function setSetting(key, value) {
  run(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)]
  )
  return value
}

/** Append to the recent-activity feed. Never throws — it is only telemetry. */
export function logEvent(type, label, payload = null) {
  try {
    run('INSERT INTO events(id, type, label, payload, at) VALUES(?,?,?,?,?)', [
      id('ev_'), type, label, payload ? JSON.stringify(payload) : null, now(),
    ])
  } catch { /* activity feed is best-effort */ }
}

export const json = {
  parse(value, fallback = null) {
    if (value == null || value === '') return fallback
    try { return JSON.parse(value) } catch { return fallback }
  },
  stringify(value) {
    return value == null ? null : JSON.stringify(value)
  },
}
