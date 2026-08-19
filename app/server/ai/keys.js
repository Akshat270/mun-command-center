// API key management.
//
// A key can be supplied two ways: `.env` (needs a restart) or Settings (takes
// effect immediately). Either way the value lives only in the server process
// and, if saved, in the local database on this laptop. It is never returned to
// the browser and never written to a log — Settings only ever sees presence,
// provenance, and a masked hint.

import { AI, AI_PROVIDERS, ENV_KEYS, MODELS, setAIKey, keyHint } from '../config.js'
import { getSetting, setSetting } from '../db/client.js'
import { probeCLI } from './claude-cli.js'

const SETTING = 'aiKeys'
const PROVIDER_SETTING = 'aiProvider'

/** Which backend the delegate chose: an API key, or their Claude subscription. */
export function loadStoredProvider() {
  const chosen = getSetting(PROVIDER_SETTING, null)
  if (chosen) AI.provider = chosen
  return AI.provider
}

export function setProvider(name) {
  setSetting(PROVIDER_SETTING, name)
  AI.provider = name
  return name
}

export { probeCLI }

const read = () => {
  const stored = getSetting(SETTING, {})
  return stored && typeof stored === 'object' ? stored : {}
}

/** Called once at boot, after the database is open. */
export function loadStoredKeys() {
  let loaded = 0
  for (const [provider, key] of Object.entries(read())) {
    if (AI_PROVIDERS.includes(provider) && key) { setAIKey(provider, key, 'saved'); loaded++ }
  }
  return loaded
}

export function saveKey(provider, key) {
  const stored = read()
  stored[provider] = key
  setSetting(SETTING, stored)
  return setAIKey(provider, key, 'saved')
}

export function clearKey(provider) {
  const stored = read()
  delete stored[provider]
  setSetting(SETTING, stored)
  return setAIKey(provider, '', 'saved')
}

export function keyStatus() {
  return AI_PROVIDERS.map((provider) => ({
    provider,
    configured: Boolean(AI.keys[provider]),
    source: AI.keySource[provider],          // 'env' | 'saved' | null
    hint: keyHint(provider),                 // masked, e.g. sk-ant-…4f2a
    envAlso: Boolean(ENV_KEYS[provider]),
  }))
}

/**
 * Verify a key against the provider with the smallest request that still proves
 * authentication. Three outcomes, because they need different UI:
 *   valid    — the key works, save it
 *   invalid  — the provider rejected it, do not save
 *   unknown  — we could not reach the provider (offline), let the delegate save
 *              anyway rather than block key setup on the venue's wifi
 */
export async function testKey(provider, key) {
  const value = (key || '').trim()
  if (!value) return { result: 'invalid', reason: 'No key was entered.' }

  try {
    let res
    if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': value,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          // Explicitly Anthropic's own smallest model: this probes an Anthropic
          // key, whatever backend happens to be selected right now.
          model: MODELS.anthropic.classify,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(20_000),
      })
    } else if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${value}` },
        signal: AbortSignal.timeout(20_000),
      })
    } else {
      // Header rather than ?key= — a URL ends up in logs and proxies.
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': value },
        signal: AbortSignal.timeout(20_000),
      })
    }

    if (res.status === 401 || res.status === 403) {
      return { result: 'invalid', reason: 'The provider rejected this key. Check for a stray space or a truncated paste.' }
    }
    // 429 means the key authenticated and then hit a limit — that is a working key.
    if (res.ok || res.status === 429) return { result: 'valid' }
    if (res.status === 400) {
      // Anthropic's probe is a real (tiny) completion request, so a 400 there
      // means authentication passed and the request body was refused. Google
      // and OpenAI are probed with a plain listing that has no body to refuse:
      // Google answers 400 INVALID_ARGUMENT for a malformed key, so treating
      // that as valid would save a mistyped key and report "AI is now
      // available" — the exact silent failure this check exists to prevent.
      if (provider === 'anthropic') return { result: 'valid' }
      let detail = ''
      try { detail = (await res.json())?.error?.message || '' } catch { /* body is optional */ }
      return {
        result: 'invalid',
        reason: detail
          ? `The provider rejected this key — ${detail}`
          : 'The provider rejected this key. Check for a stray space or a truncated paste.',
      }
    }
    return { result: 'unknown', reason: `The provider returned ${res.status}. The key was saved but not verified.` }
  } catch (err) {
    const offline = /fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|aborted|timed out/i
      .test(err?.message || '')
    return {
      result: 'unknown',
      reason: offline
        ? 'Could not reach the provider — no internet. The key was saved and will be used once you are online.'
        : `Could not verify the key — ${err?.message ?? 'unknown error'}. It was saved anyway.`,
    }
  }
}
