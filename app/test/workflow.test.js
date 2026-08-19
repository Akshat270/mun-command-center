// End-to-end committee workflow, run against the real corpus.
// Mirrors the §56 quality bar: roll call → GSL → speech → mod caucus →
// attack → response → POI → unmod → drafting → amendment → voting → summary.
//
// Run: npm test   (server must be running on PORT)

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'

const BASE = `http://127.0.0.1:${process.env.PORT || 8788}`

async function call(path, init) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
  })
  const text = await res.text()
  const body = text ? JSON.parse(text) : null
  return { status: res.status, body }
}

const get = (p) => call(p)
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) })
const patch = (p, b) => call(p, { method: 'PATCH', body: JSON.stringify(b ?? {}) })
const put = (p, b) => call(p, { method: 'PUT', body: JSON.stringify(b ?? {}) })

let sessionId = null
let scratchDraftId = null

describe('MUN Command Center — end to end', () => {
  before(async () => {
    const { status } = await get('/api/status')
    assert.equal(status, 200, `Server must be running on ${BASE}`)
  })

  // ─────────────────────────────────────────────────────── infrastructure

  test('status reports a healthy local database', async () => {
    const { body } = await get('/api/status')
    assert.equal(body.db.ok, true, 'database must be writable')
    // Structural, not literal: the committee is configurable, so asserting a
    // particular country would fail for every delegate but one.
    assert.ok(body.committee.country, 'a country must be configured')
    assert.ok(body.committee.committee, 'a committee must be configured')
    assert.ok(!body.db.path.includes('OneDrive'), 'database must live outside OneDrive')
  })

  test('all 11 prep documents are imported and chunked', async () => {
    const { body } = await get('/api/documents')
    assert.ok(body.documents.length >= 11, `expected >=11 documents, got ${body.documents.length}`)
    const failed = body.documents.filter((d) => d.parse_status === 'failed')
    assert.equal(failed.length, 0, `parse failures: ${failed.map((f) => f.filename).join(', ')}`)
    const totalChunks = body.documents.reduce((n, d) => n + d.chunk_count, 0)
    assert.ok(totalChunks > 400, `expected >400 passages, got ${totalChunks}`)
  })

  test('the PDF background guide retained real page numbers', async () => {
    const { body } = await get('/api/search?q=General%20Assembly&limit=20')
    const withPages = body.results.filter((r) => r.page != null)
    assert.ok(withPages.length > 0, 'at least one result should carry a page number')
    const unknown = body.results.filter((r) => r.page == null)
    for (const r of unknown) {
      assert.equal(r.pageLabel, 'Page unavailable', 'unknown pages must say so, never guess')
    }
  })

  // ────────────────────────────────────────────────────────────── search

  test('exact-term lookups find the right passage', async () => {
    for (const [q, expect] of [
      ['Article 17', /article 17/i],
      ['NSIRA', /nsira/i],
      ['Law 25.520', /25\.520/],
      ['Pegasus', /pegasus/i],
      ['transfer parity', /transfer parity/i],
    ]) {
      const { body } = await get(`/api/search?q=${encodeURIComponent(q)}&limit=5`)
      assert.ok(body.results.length > 0, `"${q}" returned nothing`)
      const hit = body.results.some((r) => expect.test(r.text))
      assert.ok(hit, `"${q}" did not surface a passage containing it`)
    }
  })

  test('conceptual queries work via alias expansion', async () => {
    const { body } = await get('/api/search?q=Canada%20position%20on%20metadata&limit=5')
    assert.ok(body.results.length > 0)
    assert.ok(body.aliases.includes('communications data'),
      'metadata should expand to communications data')
  })

  test('search is fast enough to use mid-debate', async () => {
    const { body } = await get('/api/search?q=Five%20Eyes&limit=20')
    assert.ok(body.took < 250, `search took ${body.took}ms — too slow for live use`)
  })

  test('a zero-result query returns an empty list, not an error', async () => {
    const { status, body } = await get('/api/search?q=zzqqxxnothing&limit=5')
    assert.equal(status, 200)
    assert.deepEqual(body.results, [])
  })

  test('global search groups results across every record type', async () => {
    const { body } = await get('/api/search/global?q=metadata')
    const labels = body.groups.map((g) => g.label)
    assert.ok(labels.includes('Documents'))
    assert.ok(labels.includes('Speeches'))
    assert.ok(body.took < 400, `global search took ${body.took}ms`)
  })

  test('View source resolves a chunk with its neighbours', async () => {
    const { body: search } = await get('/api/search?q=transfer%20parity&limit=1')
    const chunkId = search.results[0].chunkId
    const { status, body } = await get(`/api/search/source/${chunkId}`)
    assert.equal(status, 200)
    assert.ok(body.context.length >= 1)
    assert.ok(body.context.some((c) => c.id === chunkId), 'the cited chunk must be present')
    assert.ok(body.pageLabel, 'a page label is always present')
  })

  // ───────────────────────────────────────────────── prepared content

  test('speeches are seeded and include the 30-second opening', async () => {
    const { body } = await get('/api/speeches')
    assert.ok(body.length >= 10, `expected >=10 speeches, got ${body.length}`)
    const opening = body.find((s) => s.category === 'opening')
    assert.ok(opening, 'the 30-second opening must exist')
    assert.match(opening.body, /false choice/i)
    assert.ok(opening.memory_hook, 'the opening carries a memory hook')
  })

  test('POIs can be filtered to a specific country', async () => {
    const { body: austria } = await get('/api/pois?target=AT')
    assert.ok(austria.length >= 5, `expected >=5 Austria POIs, got ${austria.length}`)
    assert.ok(austria.every((p) => ['AT', 'ANY'].includes(p.target_country)))
    assert.ok(austria.some((p) => /independent authorisation/i.test(p.question)))
  })

  test('the defence bank covers the Five Eyes attack', async () => {
    const { body } = await get('/api/qa')
    assert.ok(body.length >= 15)
    const fiveEyes = body.find((q) => /five eyes/i.test(q.question))
    assert.ok(fiveEyes, 'the Five Eyes question must have a prepared answer')
    assert.match(fiveEyes.answer, /transfer parity/i)
  })

  // The delegate sits down and Austria immediately raises the Five Eyes point.
  // The answer has to already be under that speech — not somewhere searchable.
  test('a prepared answer attaches to the speech that invites it', async () => {
    const { body: speeches } = await get('/api/speeches')
    const { body: qa } = await get('/api/qa')
    const opening = speeches.find((s) => s.category === 'opening')
    const fiveEyes = qa.find((q) => /five eyes/i.test(q.question))
    assert.ok(Array.isArray(opening.qa_ids), 'every speech carries its attached answer ids')

    const restore = opening.qa_ids
    // The unknown id stands for a stale checkbox: it is dropped, and the rest of
    // the selection must still be saved.
    const { status } = await put(`/api/speeches/${opening.id}/qa`,
      { ids: [fiveEyes.id, 'qa_does_not_exist'] })
    assert.equal(status, 200)

    const { body: after } = await get('/api/speeches')
    assert.deepEqual(after.find((s) => s.id === opening.id).qa_ids, [fiveEyes.id])

    const { body: qaAfter } = await get('/api/qa')
    assert.ok(qaAfter.find((q) => q.id === fiveEyes.id).speech_ids.includes(opening.id),
      'the link reads the same way from the defence bank')

    await put(`/api/speeches/${opening.id}/qa`, { ids: restore })
  })

  test('all four country dossiers are complete', async () => {
    const { body } = await get('/api/countries')
    assert.equal(body.length, 4)
    for (const c of body) {
      assert.ok(c.facts.length >= 5, `${c.name} needs facts`)
      assert.ok(c.vulnerabilities.length >= 4, `${c.name} needs vulnerabilities`)
      assert.ok(c.attacks_defenses.length >= 4, `${c.name} needs attack→defense pairs`)
    }
    const canada = body.find((c) => c.code === 'CA')
    assert.equal(canada.is_ours, 1)
    assert.ok(canada.facts.length >= 10, 'Canada must be the most detailed')
  })

  test('unverified developments carry their caution across', async () => {
    const { body } = await get('/api/countries/AR')
    assert.match(body.caution, /941\/2025/, 'the Decree 941/2025 caution must survive seeding')
    assert.match(body.caution, /unverified/i)
  })

  test('every procedure card is labelled by authority', async () => {
    const { body } = await get('/api/procedure')
    assert.ok(body.rules.length >= 15)
    for (const r of body.rules) {
      assert.ok(['RPS_CONFIRMED', 'GENERAL_PRACTICE', 'NOT_SPECIFIED'].includes(r.source))
    }
    // RPSIS rules are unknown, so nothing may claim to be confirmed by default.
    const confirmed = body.rules.filter((r) => r.source === 'RPS_CONFIRMED')
    assert.equal(confirmed.length, 0, 'nothing may claim RPS confirmation until the Chair speaks')
    assert.ok(body.ungaPowers.cannot.some((p) => /bind member states/i.test(p)))
  })

  // ─────────────────────────────────────── the live committee workflow

  test('1. roll call — a session starts with no answer pre-selected', async () => {
    const { body } = await post('/api/sessions', { name: 'Workflow test' })
    sessionId = body.id
    assert.ok(sessionId)
    assert.equal(body.phase, 'roll_call')
    assert.equal(body.roll_call, null, 'the app must never pre-select Present vs Present and Voting')
  })

  test('2. the delegate records what they actually said', async () => {
    const { body } = await patch(`/api/sessions/${sessionId}`, { roll_call: 'Present' })
    assert.equal(body.roll_call, 'Present')
  })

  test('3. GSL — phase and topic are tracked', async () => {
    const { body } = await patch(`/api/sessions/${sessionId}`, {
      phase: 'gsl', topic: 'Independent oversight and authorisation',
    })
    assert.equal(body.phase, 'gsl')
    assert.match(body.topic, /oversight/i)
  })

  test('4. a speech is marked used and the count increments', async () => {
    const { body: speeches } = await get('/api/speeches')
    const opening = speeches.find((s) => s.category === 'opening')
    const before = opening.use_count
    const { body } = await patch(`/api/speeches/${opening.id}`, { markUsed: true })
    assert.equal(body.use_count, before + 1)
    assert.ok(body.used_at)
  })

  test('5. moderated caucus — a timer topic is set', async () => {
    const { body } = await patch(`/api/sessions/${sessionId}`, {
      phase: 'moderated', caucus_type: 'Cross-border intelligence sharing',
    })
    assert.equal(body.caucus_type, 'Cross-border intelligence sharing')
  })

  test('6. Austria attacks Canada — the segment is classified as an ATTACK', async () => {
    const { body } = await post('/api/transcript', {
      session_id: sessionId, speaker: 'Austria', country: 'AT',
      text: 'Canada is hypocritical: it participates in Five Eyes intelligence sharing yet lectures this committee on safeguards.',
    })
    assert.equal(body.classification, 'ATTACK', `classified as ${body.classification}`)
    assert.ok(body.relevance >= 0.9, 'an attack must be highly relevant')
    assert.equal(body.classifiedVia, 'local', 'local rules should catch this without an API call')
  })

  test('7. a question is classified as a QUESTION', async () => {
    const { body } = await post('/api/transcript', {
      session_id: sessionId, speaker: 'Nepal', country: 'NP',
      text: 'Would the delegate of Canada support technical assistance for oversight bodies?',
    })
    assert.equal(body.classification, 'QUESTION')
  })

  test('8. a motion is classified as a MOTION', async () => {
    const { body } = await post('/api/transcript', {
      session_id: sessionId, speaker: 'Chair',
      text: 'Motion for a ten-minute moderated caucus with forty-five seconds per speaker.',
    })
    assert.equal(body.classification, 'MOTION')
  })

  test('9. procedural chatter is deprioritised, not alerted on', async () => {
    const { body } = await post('/api/transcript', {
      session_id: sessionId, speaker: 'Chair',
      text: 'The chair recognises the delegate. Time remaining is thirty seconds.',
    })
    assert.equal(body.classification, 'PROCEDURAL')
    assert.ok(body.relevance < 0.5, 'procedural lines must not trigger alerts at default sensitivity')
  })

  test('10. AI responds, or degrades with a readable message', async () => {
    const { status, body } = await post('/api/ai/respond', {
      statement: 'Canada is hypocritical on Five Eyes.', sessionId,
    })
    assert.equal(status, 200, 'the endpoint must never 500')
    if (body.ok) {
      // With a key configured: enforce the response contract.
      assert.ok(body.sections.ASSESSMENT, 'ASSESSMENT section required')
      assert.ok(body.sections.RESPONSE, 'RESPONSE section required')
      assert.ok(body.sections.CANADA, 'CANADA section required')
      assert.ok(['High', 'Medium', 'Low'].includes(body.confidence))
      assert.equal(body.fabricatedCitations.length, 0, 'no citation may reference a source not supplied')
      for (const c of body.citations) {
        assert.ok(c.chunkId, 'every citation must resolve to a real chunk')
        assert.ok(c.pageLabel, 'every citation carries a page label')
      }
    } else {
      // Without a key: the exact promised message, and no crash.
      assert.match(body.reason, /AI unavailable/i)
      assert.match(body.reason, /local knowledge base remains available/i)
    }
  })

  test('11. a POI is marked asked', async () => {
    const { body: pois } = await get('/api/pois?target=AT')
    const poi = pois[0]
    const { body } = await patch(`/api/pois/${poi.id}`, { markAsked: true })
    assert.ok(body.asked_at, 'asked timestamp recorded')
  })

  test('12. unmoderated caucus — bloc notes are recorded', async () => {
    await patch(`/api/sessions/${sessionId}`, { phase: 'unmoderated' })
    const { body } = await call('/api/bloc/AT', {
      method: 'PUT',
      body: JSON.stringify({ agreed: 'Clause 3 on prior authorisation', status: 'strong_ally' }),
    })
    assert.match(body.agreed, /Clause 3/)
    assert.equal(body.status, 'strong_ally')
  })

  test('13. drafting — clauses are added and counted', async () => {
    // Never write into the delegate's own draft: a test run must not leave
    // clauses behind in the resolution they are actually taking to committee.
    const { body: scratch } = await post('/api/resolutions', {
      title: 'Test scratch draft', active: false,
    })
    scratchDraftId = scratch.id
    await post('/api/clauses', {
      resolution_id: scratchDraftId, kind: 'OP', opener: 'Calls upon',
      text: 'Member States to require prior independent authorisation for highly intrusive surveillance;',
    })
    await post('/api/clauses', {
      resolution_id: scratchDraftId, kind: 'PRE', opener: 'Recalling',
      text: 'Article 17 of the International Covenant on Civil and Political Rights,',
    })
    const { body } = await get(`/api/resolutions/${scratchDraftId}`)
    assert.equal(body.stats.operative, 1)
    assert.equal(body.stats.preambulatory, 1)
  })

  test('14. duplicate clauses are detected offline, with no AI', async () => {
    await post('/api/clauses', {
      resolution_id: scratchDraftId, kind: 'OP', opener: 'Urges',
      text: 'Member States to require prior independent authorisation for highly intrusive surveillance measures;',
    })
    const { body } = await get(`/api/resolutions/${scratchDraftId}`)
    assert.ok(body.duplicates.length >= 1, 'near-identical clauses must be flagged')
    assert.ok(body.duplicates[0].similarity > 60)
  })

  test('15. clause reordering persists', async () => {
    const { body: res } = await get(`/api/resolutions/${scratchDraftId}`)
    const ops = res.clauses.filter((c) => c.kind === 'OP')
    if (ops.length < 2) return
    const reversed = [...ops].reverse().map((c) => c.id)
    await post('/api/clauses/reorder', { ids: reversed })
    const { body: after } = await get(`/api/resolutions/${scratchDraftId}`)
    const afterOps = after.clauses.filter((c) => c.kind === 'OP')
    assert.equal(afterOps[0].id, reversed[0], 'the reordered clause is now first')
  })

  test('16. voting phase is recorded without the app choosing a vote', async () => {
    const { body } = await patch(`/api/sessions/${sessionId}`, { phase: 'voting' })
    assert.equal(body.phase, 'voting')
    // There is deliberately no vote field the app can set on the delegate's behalf.
    assert.ok(!('vote' in body), 'the app must never record a vote it chose itself')
  })

  test('17. notes are linked to the session and carry claim badges', async () => {
    await post('/api/notes', {
      body: 'Austria will accept a functional standard if refusal power is real.',
      badge: 'ARGUMENT', country: 'AT', session_id: sessionId,
    })
    const { body } = await get(`/api/notes?session=${sessionId}`)
    assert.ok(body.length >= 1)
    assert.equal(body[0].badge, 'ARGUMENT')
  })

  test('18. the session exports everything needed afterwards', async () => {
    const { status, body } = await get(`/api/export/${sessionId}`)
    assert.equal(status, 200)
    assert.ok(body.session)
    assert.ok(body.transcript.length >= 4, 'transcript exported')
    assert.ok(body.notes.length >= 1, 'notes exported')
    assert.ok(body.poisAsked.length >= 1, 'asked POIs exported')
    assert.ok(body.speechesUsed.length >= 1, 'used speeches exported')
    assert.ok(body.resolution, 'resolution exported')
    assert.ok(body.bloc.length >= 1, 'bloc board exported')
    assert.ok(body.committee.country, 'the export must name the delegation')
  })

  // ────────────────────────────────────────────────────── robustness

  test('a malformed search query cannot take search down', async () => {
    for (const q of ['"""', '((', 'a AND OR NOT', '*', '^^^']) {
      const { status } = await get(`/api/search?q=${encodeURIComponent(q)}`)
      assert.equal(status, 200, `query ${q} returned ${status}`)
    }
  })

  test('unknown endpoints return a readable error, never a stack trace', async () => {
    const { status, body } = await get('/api/does-not-exist')
    assert.equal(status, 404)
    assert.ok(body.error)
    assert.ok(!body.stack, 'no stack trace may reach the client')
  })

  test('a missing document returns 404 with a message', async () => {
    const { status, body } = await get('/api/documents/nope')
    assert.equal(status, 404)
    assert.match(body.error, /not found/i)
  })

  test('an empty AI statement is rejected without calling the model', async () => {
    const { status, body } = await post('/api/ai/respond', { statement: '   ' })
    assert.equal(status, 200)
    assert.equal(body.ok, false)
  })

  after(async () => {
    if (sessionId) await patch(`/api/sessions/${sessionId}`, { end: true })
    // Take the scratch draft and its clauses back out of the database.
    if (scratchDraftId) await call(`/api/resolutions/${scratchDraftId}`, { method: 'DELETE' })
  })
})
