// Every backend must be sent its OWN model ids.
//
// The bug this locks down: a single shared model map held Claude ids, and every
// call site passed one literally, so selecting Gemini asked Google for
// `claude-sonnet-5` and got a 404 on every request. A friend with a working
// Gemini key saw nothing but "AI unavailable".
//
// Pure unit test — a fake fetch stands in for the provider, so no key, no
// network and no running server are needed.

import { test, describe, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { AI, MODELS, AI_PROVIDERS, modelFor, setAIKey, discoveredModels, forgetDiscoveredModels } from '../server/config.js'
import { safeGenerate, aiStatus } from '../server/ai/provider.js'
import { testKey } from '../server/ai/keys.js'

const realFetch = globalThis.fetch
const before = { provider: AI.provider, keys: { ...AI.keys } }

afterEach(() => {
  globalThis.fetch = realFetch
  AI.provider = before.provider
  AI.keys = { ...before.keys }
  forgetDiscoveredModels()
})

/** Records every request and answers as the given provider would. */
function fakeGoogle({ unavailable = [] } = {}) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const u = String(url)
    calls.push({ url: u, init })
    if (u.endsWith('/models')) {
      return new Response(JSON.stringify({
        models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']
          .map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })),
      }), { status: 200 })
    }
    const model = (u.match(/models\/([^:]+):/) || [])[1] || ''
    if (!model.startsWith('gemini') || unavailable.includes(model)) {
      return new Response(JSON.stringify({
        error: { message: `models/${model} is not found for API version v1beta` },
      }), { status: 404 })
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'READY' }] } }],
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1 },
    }), { status: 200 })
  }
  return calls
}

const ask = (role) =>
  safeGenerate({ role, system: 'sys', messages: [{ role: 'user', content: 'hi' }] })

describe('AI model selection', () => {
  test('no backend is configured with another vendor\'s model ids', () => {
    const shape = { anthropic: /^claude-/, 'claude-cli': /^claude-/, openai: /^gpt-/, google: /^gemini-/ }
    for (const [provider, pattern] of Object.entries(shape)) {
      for (const role of ['live', 'deep', 'classify']) {
        const id = MODELS[provider][role]
        assert.match(id, pattern, `${provider}.${role} must be a ${pattern} id, got ${id}`)
      }
    }
  })

  test('every provider defines every role', () => {
    for (const provider of [...AI_PROVIDERS, 'claude-cli']) {
      for (const role of ['live', 'deep', 'classify']) {
        assert.ok(modelFor(role, provider), `${provider} has no model for ${role}`)
      }
    }
  })

  test('a Gemini key is never sent a Claude model id', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-test'
    const calls = fakeGoogle()

    for (const role of ['live', 'deep', 'classify']) {
      const res = await ask(role)
      assert.equal(res.ok, true, `${role} failed: ${res.reason}`)
    }
    const urls = calls.map((c) => c.url).join(' ')
    assert.ok(!/claude/i.test(urls), 'a Claude model id reached Google')
    assert.ok(!/gpt-/i.test(urls), 'an OpenAI model id reached Google')
  })

  test('the API key travels in a header, never the query string', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-secret'
    const calls = fakeGoogle()
    await ask('live')
    assert.equal(calls[0].init.headers['x-goog-api-key'], 'AIza-secret')
    assert.ok(!calls.some((c) => c.url.includes('key=')), 'the key must not appear in a URL')
  })

  test('a model this key cannot reach is replaced with one it can', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-test'
    // Simulate a key without access to the configured deep model.
    const calls = fakeGoogle({ unavailable: [MODELS.google.deep] })

    const res = await ask('deep')
    assert.equal(res.ok, true, res.reason)
    assert.notEqual(res.model, MODELS.google.deep)
    assert.match(res.model, /^gemini-/)
    assert.ok(calls.some((c) => c.url.endsWith('/models')), 'it must ask what the key can use')
  })

  test('a provider failure reports the provider\'s own words', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-bad'
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { message: 'API key not valid. Please pass a valid API key.' },
    }), { status: 400 })

    const res = await ask('live')
    assert.equal(res.ok, false)
    assert.match(res.reason, /API key not valid/,
      'a bare status code gives the delegate nothing to act on')
  })

  test('status reports the models of the backend actually in use', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-test'
    const status = aiStatus()
    assert.equal(status.provider, 'google')
    for (const role of ['live', 'deep', 'classify']) {
      assert.match(status.models[role], /^gemini-/,
        'Settings must not show Claude model names to a Gemini user')
    }
  })

  test('a listing failure does not hide the 404 that caused it', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-test'
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/models')) {
        // The retry path's own request fails for an unrelated reason.
        return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 })
      }
      return new Response(JSON.stringify({
        error: { message: 'models/gemini-x is not found for API version v1beta' },
      }), { status: 404 })
    }

    const res = await ask('live')
    assert.equal(res.ok, false)
    assert.match(res.reason, /not found for API version/,
      'the actionable 404 must survive a failure while looking for a substitute')
  })

  test('Gemini gets an output budget above its thinking spend', async () => {
    AI.provider = 'google'
    AI.keys.google = 'AIza-test'
    let sent = null
    globalThis.fetch = async (url, init) => {
      sent = JSON.parse(init.body)
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      }), { status: 200 })
    }

    await safeGenerate({ role: 'deep', system: 's', maxTokens: 1600, messages: [{ role: 'user', content: 'hi' }] })
    assert.ok(sent.generationConfig.maxOutputTokens > 1600,
      'thinking tokens come out of this budget, so the answer needs room beyond it')
  })

  test('what one key could reach is forgotten when the key changes', async () => {
    AI.provider = 'google'
    setAIKey('google', 'AIza-first')
    fakeGoogle({ unavailable: [MODELS.google.deep] })

    const first = await ask('deep')
    assert.equal(first.ok, true, first.reason)
    assert.ok(Object.keys(discoveredModels()).length > 0, 'the substitution should be remembered')

    setAIKey('google', 'AIza-second')
    assert.deepEqual(discoveredModels(), {},
      'a new key may reach different models — the old key\'s limits must not stick')
  })

  test('a key the provider rejects with 400 is not saved as valid', async () => {
    // Google answers 400 INVALID_ARGUMENT for a malformed key, unlike the
    // 401/403 most providers use.
    globalThis.fetch = async () => new Response(JSON.stringify({
      error: { message: 'API key not valid. Please pass a valid API key.' },
    }), { status: 400 })

    const google = await testKey('google', 'not-a-real-key')
    assert.equal(google.result, 'invalid', 'a rejected Gemini key must never report as working')
    assert.match(google.reason, /API key not valid/)

    // Anthropic's probe is a real completion request, so its 400 still means
    // "authenticated, tiny request refused" and remains valid.
    const anthropic = await testKey('anthropic', 'sk-ant-whatever')
    assert.equal(anthropic.result, 'valid')
  })

  test('selecting a backend with no key never falls through to another one', async () => {
    AI.provider = 'anthropic'
    AI.keys = { anthropic: '', openai: '', google: 'AIza-test' }
    globalThis.fetch = async () => { throw new Error('no request should be made') }

    const res = await ask('live')
    assert.equal(res.ok, false)
    assert.match(res.reason, /no API key configured/i)
  })
})
