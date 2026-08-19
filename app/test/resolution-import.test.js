// Importing a draft resolution written in Word.
//
// The delegate will do this under time pressure, minutes before submission, so
// these tests care about two things above all: nothing is silently lost, and
// nothing is silently invented.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseResolution, linesFromDocx, renderResolution } from '../server/resolution/parse.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MUN_DIR = path.resolve(HERE, '..', '..')
const API = 'http://127.0.0.1:8788'

const DRAFT = `Draft Resolution 1.1
COMMITTEE: United Nations General Assembly
AGENDA: Legality and Ethics of State Surveillance in the Name of National Security
SPONSORS: Canada, Austria, Nepal
SIGNATORIES: Argentina, Japan, Kenya

The General Assembly,

Recalling Article 17 of the International Covenant on Civil and Political Rights,

Reaffirming that the same rights people have offline must also be protected online,

Deeply concerned by the proliferation of commercial spyware,

Noting with concern that metadata collection can reveal intimate details of private life,

1. Calls upon Member States to establish independent oversight bodies with binding review powers;

2. Urges Member States to adopt lifecycle safeguards governing the collection, retention, sharing and deletion of intercepted material;

3. Encourages the application of transfer parity, whereby data shared with a partner State enjoys no lower protection than at home;

4. Requests the Secretary-General to report on implementation within eighteen months.`

describe('resolution import — plain text', () => {
  const parsed = parseResolution(DRAFT)

  test('reads the header block', () => {
    assert.equal(parsed.title, 'Draft Resolution 1.1')
    assert.match(parsed.committee, /General Assembly/)
    assert.match(parsed.agenda, /State Surveillance/)
    assert.deepEqual(parsed.sponsors, ['Canada', 'Austria', 'Nepal'])
    assert.deepEqual(parsed.signatories, ['Argentina', 'Japan', 'Kenya'])
  })

  test('splits preambulatory from operative', () => {
    assert.equal(parsed.stats.preambulatory, 4)
    assert.equal(parsed.stats.operative, 4)
  })

  test('keeps the opener separate from the clause text', () => {
    const first = parsed.clauses[0]
    assert.equal(first.opener, 'Recalling')
    assert.match(first.text, /^Article 17/)
    assert.doesNotMatch(first.text, /Recalling/)
  })

  test('recognises multi-word and "Deeply" openers', () => {
    const openers = parsed.clauses.map((c) => c.opener)
    assert.ok(openers.includes('Deeply concerned'), `got ${openers.join(' | ')}`)
    assert.ok(openers.includes('Noting with concern'))
  })

  test('strips clause numbering and trailing punctuation', () => {
    const op = parsed.clauses.filter((c) => c.kind === 'OP')
    assert.equal(op[0].opener, 'Calls upon')
    assert.doesNotMatch(op[0].text, /^1\./)
    assert.doesNotMatch(op[0].text, /;$/)
  })

  test('loses no clause text', () => {
    for (const c of parsed.clauses) assert.ok(c.text.length > 10, `empty clause: ${JSON.stringify(c)}`)
    assert.equal(parsed.clauses.length, 8)
  })

  test('a draft with no header still parses', () => {
    const bare = parseResolution('Recalling Article 17,\n\n1. Urges Member States to act.')
    assert.equal(bare.clauses.length, 2)
    assert.equal(bare.clauses[1].kind, 'OP')
  })

  test('says so instead of inventing clauses when nothing is recognisable', () => {
    const junk = parseResolution('the quick brown fox\njumped over the lazy dog')
    assert.ok(junk.warnings.length > 0)
    assert.ok(junk.warnings.some((w) => /no clauses were recognised|no operative/i.test(w)))
  })

  test('round-trips back to Chair-ready text', () => {
    const text = renderResolution(
      { committee: 'UNGA', agenda: 'Surveillance', sponsors: ['Canada'], signatories: [] },
      parsed.clauses
    )
    assert.match(text, /The General Assembly,/)
    assert.match(text, /1\. Calls upon Member States/)
    assert.match(text, /Recalling Article 17/)
  })
})

describe('resolution import — real Word file', () => {
  test('reads a genuine .docx without throwing', async () => {
    const file = path.join(MUN_DIR, 'Output 5.docx')
    if (!fs.existsSync(file)) return              // source docs are optional here
    const lines = await linesFromDocx(fs.readFileSync(file))
    assert.ok(lines.length > 10, 'no lines extracted from the Word file')
    assert.ok(lines.some((l) => l.text.trim().length > 20))
  })
})

describe('resolution import — over the API', () => {
  test('preview writes nothing', async () => {
    const before = await (await fetch(`${API}/api/resolutions`)).json()
    const active = before.find((r) => r.is_active) || before[0]
    const detailBefore = await (await fetch(`${API}/api/resolutions/${active.id}`)).json()

    const res = await fetch(`${API}/api/resolutions/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: DRAFT, preview: true }),
    })
    const preview = await res.json()
    assert.equal(preview.preview, true)
    assert.equal(preview.clauses.length, 8)

    const detailAfter = await (await fetch(`${API}/api/resolutions/${active.id}`)).json()
    assert.equal(detailAfter.clauses.length, detailBefore.clauses.length,
      'preview must not modify the draft')
  })

  test('imports into a separate new draft, leaving the original alone', async () => {
    const before = await (await fetch(`${API}/api/resolutions`)).json()
    const original = before.find((r) => r.is_active) || before[0]
    const originalCount =
      (await (await fetch(`${API}/api/resolutions/${original.id}`)).json()).clauses.length

    const result = await (await fetch(`${API}/api/resolutions/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: DRAFT, mode: 'new' }),
    })).json()

    assert.equal(result.ok, true)
    assert.equal(result.imported, 8)

    const created = await (await fetch(`${API}/api/resolutions/${result.resolutionId}`)).json()
    assert.equal(created.clauses.length, 8)
    assert.deepEqual(created.sponsors, ['Canada', 'Austria', 'Nepal'])
    assert.equal(created.stats.operative, 4)

    const untouched = await (await fetch(`${API}/api/resolutions/${original.id}`)).json()
    assert.equal(untouched.clauses.length, originalCount)

    // Clean up and hand the flag back to the draft that was active before.
    await fetch(`${API}/api/resolutions/${result.resolutionId}`, { method: 'DELETE' })
    await fetch(`${API}/api/resolutions/${original.id}/activate`, { method: 'POST' })
  })

  test('rejects an empty import with a readable message', async () => {
    const res = await fetch(`${API}/api/resolutions/import`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '   ' }),
    })
    assert.equal(res.status, 400)
    const body = await res.json()
    assert.match(body.error, /paste text or choose/i)
  })

  test('exports the active draft as text', async () => {
    const list = await (await fetch(`${API}/api/resolutions`)).json()
    const active = list.find((r) => r.is_active) || list[0]
    const out = await (await fetch(`${API}/api/resolutions/${active.id}/text`)).json()
    assert.match(out.text, /The General Assembly,/)
  })
})

describe('API keys', () => {
  test('key status reports presence only — never a value', async () => {
    const res = await (await fetch(`${API}/api/ai/keys`)).json()
    assert.ok(Array.isArray(res.providers))
    for (const p of res.providers) {
      assert.ok(['anthropic', 'openai', 'google'].includes(p.provider))
      assert.equal(typeof p.configured, 'boolean')
      // A hint is masked or absent. It must never be long enough to be a key.
      if (p.hint) assert.ok(p.hint.length <= 20, `hint looks like a key: ${p.hint}`)
      assert.ok(!('key' in p), 'the key value must never be returned')
    }
  })

  test('an obviously invalid key is refused, not stored', async () => {
    const res = await fetch(`${API}/api/ai/key`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', key: '' }),
    })
    assert.equal(res.status, 400)
    const after = await (await fetch(`${API}/api/ai/keys`)).json()
    assert.equal(after.providers.find((p) => p.provider === 'anthropic').configured, false)
  })

  test('keys cannot be written through the general settings endpoint', async () => {
    await fetch(`${API}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aiKeys: { anthropic: 'sk-ant-injected' } }),
    })
    const after = await (await fetch(`${API}/api/ai/keys`)).json()
    assert.equal(after.providers.find((p) => p.provider === 'anthropic').configured, false)
  })
})

describe('parameterless requests', () => {
  // These endpoints take no arguments. Declaring a JSON content-type with no
  // body made Fastify reject them outright, which is how "Build semantic index"
  // and "Test AI" both failed with an error about an empty body.
  for (const path of ['/api/ai/test', '/api/search/semantic/build']) {
    test(`POST ${path} accepts an empty JSON body`, async () => {
      const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      assert.notEqual(res.status, 400, await res.text())
    })
  }

  test('malformed JSON still gets a readable error, not a stack trace', async () => {
    const res = await fetch(`${API}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, /not valid JSON/i)
  })
})

describe('semantic search stays honest', () => {
  // Cosine similarity always returns *something*. Once the semantic index is
  // built, a query with no real match must still come back empty — a plausible
  // looking irrelevant passage mid-debate is worse than an empty result.
  const NONSENSE = ['zzqqxxnothing', 'qwertyuiop asdf', 'banana bread recipe']

  test('nonsense queries return nothing even with the index built', async () => {
    const status = await (await fetch(`${API}/api/search/semantic`)).json()
    for (const q of NONSENSE) {
      const res = await (await fetch(`${API}/api/search?q=${encodeURIComponent(q)}&limit=5`)).json()
      assert.deepEqual(
        res.results, [],
        `"${q}" returned ${res.results.length} results (index built: ${status.built})`
      )
    }
  })

  test('a genuine conceptual query with no shared keywords still finds the passage', async () => {
    const status = await (await fetch(`${API}/api/search/semantic`)).json()
    if (!status.built) return   // keyword-only install: nothing to assert here

    const res = await (await fetch(
      `${API}/api/search?q=${encodeURIComponent('who checks the checkers')}&limit=5`)).json()
    assert.ok(res.results.length > 0, 'semantic search should match on meaning, not words')
    assert.equal(res.mode, 'hybrid')
  })

  test('the build endpoint reports progress rather than hanging', async () => {
    const res = await (await fetch(`${API}/api/search/semantic/build`, { method: 'POST' })).json()
    // Either it starts in the background or there is nothing left to do; it
    // must never block the caller for the length of a model download.
    assert.ok(['started', 'up-to-date', 'already-running', 'unavailable'].includes(res.status),
      `unexpected status: ${res.status}`)
  })
})

describe('POI list management', () => {
  const create = (question) => fetch(`${API}/api/pois`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, target_country: 'ANY' }),
  }).then((r) => r.json())

  const patch = (id, body) => fetch(`${API}/api/pois/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json())

  test('a hidden POI leaves the list but is not destroyed', async () => {
    const p = await create('Hide me?')
    const visibleBefore = await (await fetch(`${API}/api/pois`)).json()
    assert.ok(visibleBefore.some((x) => x.id === p.id))

    await patch(p.id, { hidden: true })

    const visible = await (await fetch(`${API}/api/pois`)).json()
    assert.ok(!visible.some((x) => x.id === p.id), 'hidden POI must leave the default list')

    const withHidden = await (await fetch(`${API}/api/pois?hidden=1`)).json()
    assert.ok(withHidden.some((x) => x.id === p.id), 'hidden POI must still exist')

    const { hidden } = await (await fetch(`${API}/api/pois/hidden-count`)).json()
    assert.ok(hidden >= 1)

    await patch(p.id, { hidden: false })
    const back = await (await fetch(`${API}/api/pois`)).json()
    assert.ok(back.some((x) => x.id === p.id), 'unhiding must restore it')

    await fetch(`${API}/api/pois/${p.id}`, { method: 'DELETE' })
  })

  test('reordering moves a POI and survives a reload', async () => {
    const a = await create('Reorder A?')
    const b = await create('Reorder B?')

    const order = (list) => list.filter((x) => [a.id, b.id].includes(x.id)).map((x) => x.id)
    const before = order(await (await fetch(`${API}/api/pois`)).json())
    assert.deepEqual(before, [a.id, b.id])

    await fetch(`${API}/api/pois/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [b.id, a.id] }),
    })

    const after = order(await (await fetch(`${API}/api/pois`)).json())
    assert.deepEqual(after, [b.id, a.id], 'the swap must persist')

    await fetch(`${API}/api/pois/${a.id}`, { method: 'DELETE' })
    await fetch(`${API}/api/pois/${b.id}`, { method: 'DELETE' })
  })

  test('reordering a filtered view leaves other POIs where they were', async () => {
    const full = await (await fetch(`${API}/api/pois`)).json()
    const austria = full.filter((p) => p.target_country === 'AT')
    if (austria.length < 2) return

    const untouched = full.filter((p) => p.target_country !== 'AT').map((p) => p.id)
    const swapped = [austria[1].id, austria[0].id, ...austria.slice(2).map((p) => p.id)]

    await fetch(`${API}/api/pois/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: swapped }),
    })

    const after = await (await fetch(`${API}/api/pois`)).json()
    assert.deepEqual(
      after.filter((p) => p.target_country !== 'AT').map((p) => p.id),
      untouched,
      'reordering one filter must not shuffle everything else'
    )

    await fetch(`${API}/api/pois/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: austria.map((p) => p.id) }),
    })
  })
})

describe('editable prepared material', () => {
  test('a POI can be created, edited, un-asked and deleted', async () => {
    const created = await (await fetch(`${API}/api/pois`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Test POI?', target_country: 'AT', strength: 'strong' }),
    })).json()
    assert.ok(created.id)

    const asked = await (await fetch(`${API}/api/pois/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markAsked: true }),
    })).json()
    assert.ok(asked.asked_at, 'marking asked must set asked_at')

    const unasked = await (await fetch(`${API}/api/pois/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markAsked: false }),
    })).json()
    assert.equal(unasked.asked_at, null, 'un-ask must clear asked_at')

    const edited = await (await fetch(`${API}/api/pois/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Edited POI?', follow_up: 'And then?' }),
    })).json()
    assert.equal(edited.question, 'Edited POI?')
    assert.equal(edited.follow_up, 'And then?')

    await fetch(`${API}/api/pois/${created.id}`, { method: 'DELETE' })
    const list = await (await fetch(`${API}/api/pois`)).json()
    assert.ok(!list.some((p) => p.id === created.id), 'deleted POI is gone')
  })

  test('a prepared answer can be created, edited and deleted', async () => {
    const created = await (await fetch(`${API}/api/qa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Test attack?', answer: 'Test answer.', kind: 'rapid_response' }),
    })).json()
    assert.ok(created.id)

    const edited = await (await fetch(`${API}/api/qa/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ answer: 'Better answer.', kind: 'general' }),
    })).json()
    assert.equal(edited.answer, 'Better answer.')
    assert.equal(edited.kind, 'general')

    await fetch(`${API}/api/qa/${created.id}`, { method: 'DELETE' })
    const list = await (await fetch(`${API}/api/qa`)).json()
    assert.ok(!list.some((q) => q.id === created.id))
  })

  test('a speech can be created, edited, un-marked and deleted', async () => {
    const created = await (await fetch(`${API}/api/speeches`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test GSL', category: '45s', duration_s: 45, body: 'Words.' }),
    })).json()
    assert.ok(created.id)

    const edited = await (await fetch(`${API}/api/speeches/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Test GSL v2', category: 'moderated', duration_s: 60, body: 'New words.' }),
    })).json()
    assert.equal(edited.title, 'Test GSL v2')
    assert.equal(edited.category, 'moderated')
    assert.equal(edited.duration_s, 60)
    assert.equal(edited.body, 'New words.')

    await fetch(`${API}/api/speeches/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ markUsed: true }),
    })
    const cleared = await (await fetch(`${API}/api/speeches/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clearUsed: true }),
    })).json()
    assert.equal(cleared.used_at, null, 'clearing the used mark must reset used_at')
    assert.equal(cleared.use_count, 0)

    await fetch(`${API}/api/speeches/${created.id}`, { method: 'DELETE' })
    const list = await (await fetch(`${API}/api/speeches`)).json()
    assert.ok(!list.some((s) => s.id === created.id))
  })
})
