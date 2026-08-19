// Provider abstraction: generate / stream / classify / embed.
//
// The app must never be coupled to one vendor, and must never break when the
// vendor is unreachable. Every call returns a structured result; failures come
// back as { ok:false, reason } so the UI can show
// "AI unavailable — local knowledge base remains available" and carry on.

import { AI, hasAnyAIKey, modelsFor, modelFor, rememberModel } from '../config.js'
import { ClaudeCLIProvider } from './claude-cli.js'

class AIUnavailable extends Error {
  constructor(reason) { super(reason); this.name = 'AIUnavailable'; this.userMessage = reason }
}

/**
 * Pull the provider's own error text out of a failed response.
 *
 * "Google returned 404." tells you nothing you can act on; "model
 * gemini-9-ultra is not found for API version v1beta" tells you exactly what to
 * change. Never throws — a diagnostic must not become the failure.
 */
async function describeFailure(res, label) {
  let detail = ''
  try {
    const body = await res.text()
    const data = JSON.parse(body)
    detail = data?.error?.message || data?.error?.type || body.slice(0, 300)
  } catch { /* a non-JSON body is not worth a second failure */ }
  const base =
    res.status === 401 || res.status === 403
      ? `${label} rejected the API key`
    : res.status === 429 ? `${label} rate limited this key`
    : res.status === 404 ? `${label} does not have that model for this key`
    : `${label} returned ${res.status}`
  return detail ? `${base} — ${detail}` : `${base}.`
}

// ───────────────────────────────────────────────────────────────── Anthropic

class AnthropicProvider {
  name = 'anthropic'
  #client = null

  get configured() { return Boolean(AI.keys.anthropic) }

  async #sdk() {
    if (this.#client) return this.#client
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    this.#client = new Anthropic({ apiKey: AI.keys.anthropic, maxRetries: 1, timeout: 60_000 })
    return this.#client
  }

  async generate({ system, messages, model, role = 'live', maxTokens, effort = 'medium' }) {
    const client = await this.#sdk()
    const res = await client.messages.create({
      model: model || modelFor(role, 'anthropic'),
      max_tokens: maxTokens || AI.maxTokens,
      // Cache the stable system prompt: it is identical across every call in a
      // session, so repeat input bills at ~10%.
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort },
      messages,
    })
    if (res.stop_reason === 'refusal') {
      throw new AIUnavailable('The model declined this request. Rephrase, or use the local knowledge base.')
    }
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    return {
      text,
      model: res.model,
      usage: {
        input: res.usage?.input_tokens ?? 0,
        output: res.usage?.output_tokens ?? 0,
        cacheRead: res.usage?.cache_read_input_tokens ?? 0,
      },
    }
  }

  async *stream({ system, messages, model, role = 'live', maxTokens, effort = 'medium' }) {
    const client = await this.#sdk()
    const s = client.messages.stream({
      model: model || modelFor(role, 'anthropic'),
      max_tokens: maxTokens || AI.maxTokens,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { effort },
      messages,
    })
    for await (const event of s) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'delta', text: event.delta.text }
      }
    }
    const final = await s.finalMessage()
    if (final.stop_reason === 'refusal') {
      yield { type: 'error', message: 'The model declined this request.' }
      return
    }
    yield {
      type: 'done',
      model: final.model,
      usage: {
        input: final.usage?.input_tokens ?? 0,
        output: final.usage?.output_tokens ?? 0,
        cacheRead: final.usage?.cache_read_input_tokens ?? 0,
      },
    }
  }
}

// ─────────────────────────────────────────────────── OpenAI / Google (opt-in)

class OpenAIProvider {
  name = 'openai'
  get configured() { return Boolean(AI.keys.openai) }
  async generate({ system, messages, model, role = 'live', maxTokens }) {
    const m = model || modelFor(role, 'openai')
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${AI.keys.openai}` },
      body: JSON.stringify({
        model: m,
        max_tokens: maxTokens || AI.maxTokens,
        messages: [{ role: 'system', content: system }, ...messages.map((msg) => ({
          role: msg.role, content: typeof msg.content === 'string' ? msg.content : msg.content.map((c) => c.text).join(''),
        }))],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new AIUnavailable(await describeFailure(res, 'OpenAI'))
    const data = await res.json()
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: data.model || m,
      usage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
        cacheRead: 0,
      },
    }
  }
  async *stream(opts) { const r = await this.generate(opts); yield { type: 'delta', text: r.text }; yield { type: 'done', model: r.model, usage: r.usage } }
}

const GOOGLE_API = 'https://generativelanguage.googleapis.com/v1beta'

// Room for Gemini 2.5's thinking tokens on top of the answer we actually want.
const THINKING_HEADROOM = 4096

class GoogleProvider {
  name = 'google'
  get configured() { return Boolean(AI.keys.google) }

  #headers() {
    // The key goes in a header, not the query string: a URL ends up in logs,
    // proxies and error messages, and this one is a credential.
    return { 'content-type': 'application/json', 'x-goog-api-key': AI.keys.google }
  }

  /**
   * Model ids this key can actually call, newest-looking first.
   *
   * Which Gemini models a key may use varies by account, region and how new the
   * key is, so the configured id is a starting guess rather than a guarantee.
   */
  async #available() {
    const res = await fetch(`${GOOGLE_API}/models`, {
      headers: this.#headers(), signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new AIUnavailable(await describeFailure(res, 'Google'))
    const data = await res.json()
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter((n) => n.startsWith('gemini') && !/embedding|aqa|vision/i.test(n))
  }

  /**
   * The closest usable substitute for a model this key cannot reach. Prefers the
   * same speed class — a "flash" role must not silently become the pro model,
   * which is far slower and dearer per call.
   */
  async #substitute(role, wanted) {
    const names = await this.#available()
    if (!names.length) throw new AIUnavailable('This Google key has no Gemini models available to it.')
    if (names.includes(wanted)) return wanted
    const wantLite = role === 'classify'
    const wantPro = role === 'deep'
    const score = (n) => {
      let s = 0
      if (wantPro && /pro/.test(n)) s += 4
      if (!wantPro && /flash/.test(n)) s += 4
      if (wantLite && /lite/.test(n)) s += 2
      if (!wantLite && /lite/.test(n)) s -= 1
      if (/preview|exp/.test(n)) s -= 3        // prefer stable ids
      const version = Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0)
      return s + version
    }
    return [...names].sort((a, b) => score(b) - score(a))[0]
  }

  async #call(model, { system, messages, maxTokens }) {
    return fetch(`${GOOGLE_API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          // Gemini 2.5 spends "thinking" tokens out of this same budget, and on
          // the pro model thinking cannot be turned off. Budgeting only for the
          // answer means the model can think past the cap and return a
          // MAX_TOKENS candidate with no text at all — a silent empty answer
          // exactly when the deep analysis is wanted. The headroom is a ceiling,
          // not an allocation: an answer that stops early still costs its own
          // length.
          maxOutputTokens: (maxTokens || AI.maxTokens) + THINKING_HEADROOM,
        },
        contents: messages.map((msg) => ({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: typeof msg.content === 'string' ? msg.content : msg.content.map((c) => c.text).join('') }],
        })),
      }),
      signal: AbortSignal.timeout(60_000),
    })
  }

  async generate({ system, messages, model, role = 'live', maxTokens }) {
    let m = model || modelFor(role, 'google')
    let res = await this.#call(m, { system, messages, maxTokens })

    // 404 means this key cannot reach that id — ask what it *can* reach and use
    // that, rather than failing mid-committee over a name that drifted.
    if (res.status === 404) {
      // Read the 404 now: it is the most actionable message we have, and an
      // unread body would leak the connection when `res` is reassigned below.
      const original = await describeFailure(res, 'Google')
      let fallback = null
      try {
        fallback = await this.#substitute(role, m)
      } catch {
        // Listing models can fail for its own reasons — a rate limit, a key
        // without that permission. None of them is more useful to report than
        // the 404 that sent us here.
        throw new AIUnavailable(original)
      }
      if (!fallback || fallback === m) throw new AIUnavailable(original)
      console.warn('[ai] google: %s unavailable for this key, using %s', m, fallback)
      m = rememberModel('google', role, fallback)
      res = await this.#call(m, { system, messages, maxTokens })
    }
    if (!res.ok) throw new AIUnavailable(await describeFailure(res, 'Google'))

    const data = await res.json()
    const candidate = data.candidates?.[0]
    const text = candidate?.content?.parts?.map((p) => p.text).filter(Boolean).join('') ?? ''
    if (!text) {
      // A blocked prompt returns 200 with no text. Say which, so it is not
      // mistaken for the app being broken.
      const why = data.promptFeedback?.blockReason || candidate?.finishReason
      throw new AIUnavailable(
        why === 'MAX_TOKENS'
          ? 'Gemini spent its whole output budget thinking and wrote nothing. Try a shorter statement, or switch to the flash model in Settings.'
          : `Gemini returned no text${why ? ` (${why})` : ''}.`)
    }
    return {
      text,
      model: m,
      usage: {
        input: data.usageMetadata?.promptTokenCount ?? 0,
        output: data.usageMetadata?.candidatesTokenCount ?? 0,
        cacheRead: data.usageMetadata?.cachedContentTokenCount ?? 0,
      },
    }
  }

  async *stream(opts) { const r = await this.generate(opts); yield { type: 'delta', text: r.text }; yield { type: 'done', model: r.model, usage: r.usage } }
}

// A provider that is always "available" and always honest about it.
class NoProvider {
  name = 'none'
  get configured() { return false }
  async generate() {
    throw new AIUnavailable('AI unavailable — no API key configured. The local knowledge base remains available.')
  }
  async *stream() {
    yield { type: 'error', message: 'AI unavailable — no API key configured. The local knowledge base remains available.' }
  }
}

const PROVIDERS = {
  anthropic: new AnthropicProvider(),
  'claude-cli': new ClaudeCLIProvider(),
  openai: new OpenAIProvider(),
  google: new GoogleProvider(),
  none: new NoProvider(),
}

/**
 * Only the selected backend is ever used.
 *
 * This deliberately does NOT fall through to some other configured provider.
 * Silent fall-through means a key sitting in the database — one the delegate
 * forgot about, or that a password manager autofilled — could quietly receive
 * the delegate's committee material and answer in their name. Saying "AI
 * unavailable" is always better than using a backend nobody chose.
 */
export function getProvider(name = AI.provider) {
  const p = PROVIDERS[name]
  return p?.configured ? p : PROVIDERS.none
}

export function aiStatus() {
  const active = getProvider()
  const viaSubscription = active.name === 'claude-cli'
  const configured = Object.fromEntries(
    Object.entries(PROVIDERS).filter(([k]) => k !== 'none').map(([k, v]) => [k, v.configured])
  )
  // Credentials that exist but are not the chosen backend. Surfaced so an
  // unexpected one is visible rather than dormant.
  const unused = Object.entries(configured)
    .filter(([k, ok]) => ok && k !== AI.provider && k !== 'claude-cli')
    .map(([k]) => k)

  return {
    available: active.name !== 'none',
    provider: active.name,
    selected: AI.provider,
    viaSubscription,
    // The models of the backend actually in use — showing Claude ids to someone
    // running on a Gemini key is how "it isn't working" goes unnoticed.
    models: {
      live: modelFor('live', active.name === 'none' ? AI.provider : active.name),
      deep: modelFor('deep', active.name === 'none' ? AI.provider : active.name),
      classify: modelFor('classify', active.name === 'none' ? AI.provider : active.name),
    },
    configured,
    unusedKeys: unused,
    hasKey: hasAnyAIKey(),
    // Presence only. A key value is never sent to the browser.
    message:
      viaSubscription
        ? 'AI ready via Claude Code — billed to your Claude subscription, not per token. Slower than an API key.'
      : active.name !== 'none'
        ? `AI ready via ${active.name}.`
      : AI.provider === 'claude-cli'
        ? 'AI unavailable — Claude Code was not found or is not logged in. The local knowledge base remains available.'
        : `AI unavailable — no key configured for ${AI.provider}. The local knowledge base remains available.`,
  }
}

/**
 * Wrap any provider call so route handlers never see a raw stack trace.
 *
 * Callers pass `role` (live / deep / classify); the id for that role on the
 * backend that is actually selected is resolved here. Passing a literal model
 * id was the bug that made every non-Anthropic key fail: a Gemini key was asked
 * for `claude-sonnet-5` and answered 404.
 */
export async function safeGenerate(opts) {
  const t0 = Date.now()
  try {
    const provider = getProvider()
    const res = await provider.generate({
      ...opts,
      model: opts.model || modelFor(opts.role || 'live', provider.name),
    })
    return { ok: true, ...res, provider: provider.name, latencyMs: Date.now() - t0 }
  } catch (err) {
    const reason =
      err instanceof AIUnavailable ? err.userMessage
      : err?.status === 401 ? 'AI unavailable — the API key was rejected.'
      : err?.status === 429 ? 'AI rate limited — try again in a moment.'
      : /fetch failed|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED/i.test(err?.message || '')
        ? 'AI unavailable — no internet connection. The local knowledge base remains available.'
      : `AI unavailable — ${err?.message ?? 'unknown error'}`
    console.warn('[ai] %s (%dms)', reason, Date.now() - t0)
    return { ok: false, reason, latencyMs: Date.now() - t0 }
  }
}

export { AIUnavailable }
