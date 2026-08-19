// Central configuration. Nothing here is ever sent to the browser except
// via /api/settings, which reports key *presence* only — never key values.

import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const APP_ROOT = path.resolve(here, '..')

function defaultDataDir() {
  // Keep the live SQLite file out of OneDrive: a syncing folder can lock or
  // corrupt an open database. LOCALAPPDATA is never synced.
  const base =
    process.env.LOCALAPPDATA ||
    (process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : path.join(os.homedir(), '.local', 'share'))
  return path.join(base, 'mun-command-center')
}

export const DATA_DIR = process.env.MUN_DATA_DIR
  ? path.resolve(process.env.MUN_DATA_DIR)
  : defaultDataDir()

export const DB_PATH = path.join(DATA_DIR, 'mun.db')
export const CACHE_DIR = path.join(DATA_DIR, 'cache')
export const RECORDINGS_DIR = path.join(DATA_DIR, 'recordings')

// Where the delegate's original prep documents live. Read-only, always.
export const SOURCE_DIR = path.resolve(
  APP_ROOT,
  process.env.MUN_SOURCE_DIR || '..'
)

for (const dir of [DATA_DIR, CACHE_DIR, RECORDINGS_DIR]) {
  fs.mkdirSync(dir, { recursive: true })
}

export const PORT = Number(process.env.PORT || 8788)
export const HOST = process.env.HOST || '127.0.0.1'
export const IS_PROD = process.env.NODE_ENV === 'production'

/**
 * Your committee assignment.
 *
 * Set these in `app/.env` (copy `.env.example`) and restart. They are read once
 * at startup.
 *
 * A stored `committee` row in the settings table takes precedence over all of
 * them — see committee.js. Nothing in the UI writes that row yet, but the API
 * accepts it (`PATCH /api/settings`) and every screen and AI prompt already
 * reads through it, so an in-app committee editor is a self-contained addition
 * that needs no server changes.
 *
 * The defaults are deliberately generic. This app is not written for one country
 * or one agenda: nothing below is special-cased anywhere in the codebase, and
 * every screen and AI prompt reads whichever values are active.
 *
 * `allies` is a list of ISO-3166 alpha-2 codes for delegations you are
 * coordinating with — classmates holding other countries in the same committee.
 * The AI is told to treat them as coordination partners and never to speak for
 * them. Leave it empty if you have none.
 */
export const COMMITTEE = {
  country: process.env.MUN_COUNTRY || 'Your Delegation',
  countryCode: (process.env.MUN_COUNTRY_CODE || 'ZZ').toUpperCase(),
  flag: process.env.MUN_FLAG || '\u{1F3F3}',
  committee: process.env.MUN_COMMITTEE || 'UNGA',
  agenda: process.env.MUN_AGENDA || 'Set MUN_AGENDA in app/.env',
  conference: process.env.MUN_CONFERENCE || 'Your Conference',
  dates: process.env.MUN_DATES || '',
  allies: (process.env.MUN_ALLIES || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
}

// Keys supplied through the environment, kept separately so the app can always
// tell the delegate *where* a key came from and what removing one will do.
export const ENV_KEYS = {
  anthropic: (process.env.ANTHROPIC_API_KEY || '').trim(),
  openai: (process.env.OPENAI_API_KEY || '').trim(),
  google: (process.env.GOOGLE_API_KEY || '').trim(),
}

/**
 * Model ids per backend, by role.
 *
 * Every call site asks for a ROLE — live, deep or classify — and never a
 * literal id. A single shared model map was a Claude-only map, so selecting
 * Gemini asked Google for `claude-sonnet-5` and got a 404 on every request.
 *
 *   live      fast and cheap; Respond To This, transcript classification
 *   deep      quality over latency; defence, clause review, summary, practice
 *   classify  tiny first-pass classifier, only for segments local rules miss
 */
export const MODELS = {
  // Sonnet 5 for live work: ~2.5x cheaper than Opus and fast enough for the
  // <10s live target. Opus 5 where quality matters more than latency.
  // Haiku 4.5 for the cheap first-pass segment classifier.
  anthropic:    { live: 'claude-sonnet-5',  deep: 'claude-opus-5',  classify: 'claude-haiku-4-5' },
  'claude-cli': { live: 'claude-sonnet-5',  deep: 'claude-opus-5',  classify: 'claude-haiku-4-5' },
  openai:       { live: 'gpt-4o',           deep: 'gpt-4o',         classify: 'gpt-4o-mini' },
  google:       { live: 'gemini-2.5-flash', deep: 'gemini-2.5-pro', classify: 'gemini-2.5-flash-lite' },
}

export const AI = {
  provider: process.env.MUN_AI_PROVIDER || 'anthropic',
  maxTokens: 1600,
  keys: { ...ENV_KEYS },
  // 'env' | 'saved' | null — drives what Settings offers to do about each key.
  keySource: Object.fromEntries(
    Object.entries(ENV_KEYS).map(([k, v]) => [k, v ? 'env' : null])
  ),
}

export const AI_PROVIDERS = ['anthropic', 'openai', 'google']

/** The role→id map for one backend, falling back to the Claude ids. */
export function modelsFor(provider = AI.provider) {
  return MODELS[provider] || MODELS.anthropic
}

/**
 * The id to send for one role on one backend. A model discovered at runtime
 * (see `rememberModel`) wins: it is proof of what this key can actually reach,
 * which beats anything hardcoded here.
 */
export function modelFor(role, provider = AI.provider) {
  const table = modelsFor(provider)
  return DISCOVERED[`${provider}:${role}`] || table[role] || table.live
}

// Models proven to work for this key, learned when the configured id is not
// available to it. Never persisted: a substitution is a fact about one key at
// one moment, so it dies with the process — and with the key that taught it.
const DISCOVERED = Object.create(null)

export function rememberModel(provider, role, id) {
  DISCOVERED[`${provider}:${role}`] = id
  return id
}

/**
 * Forget what was learned for a provider — its key changed, so what that key
 * could reach says nothing about the new one. Without this, a substitution
 * learned from a limited key would quietly downgrade a role forever, and
 * replacing the key would look like it had not helped.
 */
export function forgetDiscoveredModels(provider) {
  for (const key of Object.keys(DISCOVERED)) {
    if (!provider || key.startsWith(`${provider}:`)) delete DISCOVERED[key]
  }
}

export function discoveredModels() {
  return { ...DISCOVERED }
}

/**
 * Set a key for the running process. A key saved from Settings wins over one in
 * `.env`: saving is the later, more deliberate act, and silently ignoring it in
 * favour of a stale environment variable would be the worst kind of surprise.
 */
export function setAIKey(provider, key, source = 'saved') {
  if (!AI_PROVIDERS.includes(provider)) throw new Error(`Unknown AI provider: ${provider}`)
  const value = (key || '').trim()
  // A different key may reach different models, so nothing learned about the
  // old one survives the swap.
  if (value !== AI.keys[provider]) forgetDiscoveredModels(provider)
  if (value) {
    AI.keys[provider] = value
    AI.keySource[provider] = source
  } else {
    // Removing a saved key falls back to the environment if one is set there.
    AI.keys[provider] = ENV_KEYS[provider]
    AI.keySource[provider] = ENV_KEYS[provider] ? 'env' : null
  }
  return AI.keySource[provider]
}

/**
 * A display hint, never the key. The leading `sk-ant-` style prefix is public
 * and the last four characters are how the delegate recognises which key this
 * is — the same shape the provider consoles show. The secret middle never
 * leaves the server.
 */
export function keyHint(provider) {
  const v = AI.keys[provider] || ''
  if (!v) return null
  if (v.length <= 12) return '••••'
  return `${v.slice(0, 7)}…${v.slice(-4)}`
}

export function hasAnyAIKey() {
  return AI_PROVIDERS.some((p) => Boolean(AI.keys[p]))
}
