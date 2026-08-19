// The General Speakers List.
//
// The one thing that must never be wrong here is the answer to "whose turn is
// it": the queue and `sessions.current_speaker` are two records of the same
// fact, and a delegate who is told the wrong position misses their speech.
// Every test below is really checking that those two agree.
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
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

const get = (p) => call(p)
const post = (p, b) => call(p, { method: 'POST', body: JSON.stringify(b ?? {}) })
const patch = (p, b) => call(p, { method: 'PATCH', body: JSON.stringify(b ?? {}) })
const del = (p) => call(p, { method: 'DELETE' })

let sessionId = null

/** The invariant, asserted after every mutation. */
async function assertConsistent(label) {
  const { body: queue } = await get(`/api/speakers/${sessionId}`)
  const { body: session } = await get('/api/sessions/active')
  const speaking = queue.filter((s) => s.status === 'speaking')

  assert.ok(speaking.length <= 1, `${label}: two delegations held the floor at once`)
  assert.equal(
    session.current_speaker ?? null,
    speaking[0]?.name ?? null,
    `${label}: the session and the queue disagree about who is speaking`
  )
  return queue
}

const names = (queue) => queue.map((s) => s.name)

describe('speakers list', () => {
  before(async () => {
    const { body } = await post('/api/sessions', { name: 'GSL test session' })
    sessionId = body.id
  })

  after(async () => {
    if (sessionId) await patch(`/api/sessions/${sessionId}`, { end: true })
  })

  test('a list read out by the chair is entered in one go, in order', async () => {
    const { status, body } = await post('/api/speakers', {
      session_id: sessionId,
      speakers: [{ name: 'Brazil' }, { name: 'Canada' }, { name: 'Japan' }],
    })
    assert.equal(status, 200)
    assert.deepEqual(names(body), ['Brazil', 'Canada', 'Japan'])
  })

  test('appending later continues the order rather than colliding', async () => {
    const { body } = await post('/api/speakers', { session_id: sessionId, name: 'Kenya' })
    assert.deepEqual(names(body), ['Brazil', 'Canada', 'Japan', 'Kenya'])
    const ordinals = body.map((s) => s.ordinal)
    assert.equal(new Set(ordinals).size, ordinals.length, 'ordinals must stay unique')
  })

  test('a nameless speaker is rejected rather than added blank', async () => {
    const { status } = await post('/api/speakers', { session_id: sessionId, name: '   ' })
    assert.equal(status, 400)
  })

  test('advancing opens the first speaker', async () => {
    await post('/api/speakers/advance', { session_id: sessionId })
    const queue = await assertConsistent('first advance')
    assert.equal(queue[0].status, 'speaking')
    assert.equal(queue[0].name, 'Brazil')
  })

  test('advancing closes the current speaker and records the time spoken', async () => {
    const { body } = await post('/api/speakers/advance', { session_id: sessionId, seconds: 47 })
    assert.equal(body.current.name, 'Canada')
    assert.equal(body.next.name, 'Japan')

    const queue = await assertConsistent('second advance')
    assert.equal(queue[0].status, 'done')
    assert.equal(queue[0].seconds, 47)
  })

  test('stepping back reopens the previous speaker', async () => {
    const { body } = await post('/api/speakers/advance', { session_id: sessionId, back: true })
    assert.equal(body.current.name, 'Brazil')

    const queue = await assertConsistent('step back')
    // Canada never finished, so it must return to waiting rather than be
    // recorded as having spoken.
    assert.equal(queue.find((s) => s.name === 'Canada').status, 'waiting')
  })

  test('a skipped delegation is passed over, not spoken', async () => {
    const queue = await get(`/api/speakers/${sessionId}`)
    const japan = queue.body.find((s) => s.name === 'Japan')
    await patch(`/api/speakers/${japan.id}`, { status: 'skipped' })

    await post('/api/speakers/advance', { session_id: sessionId })   // Brazil -> Canada
    const { body } = await post('/api/speakers/advance', { session_id: sessionId })
    assert.equal(body.current.name, 'Kenya', 'a skipped delegation must not take the floor')
    await assertConsistent('after skip')
  })

  test('advancing past the last speaker ends cleanly', async () => {
    const { body } = await post('/api/speakers/advance', { session_id: sessionId })
    assert.equal(body.current, null)
    assert.equal(body.next, null)

    const queue = await assertConsistent('end of list')
    assert.ok(queue.every((s) => s.status !== 'waiting'), 'nobody should still be waiting')

    // Repeating it must stay harmless — the chair presses it twice.
    await post('/api/speakers/advance', { session_id: sessionId })
    await assertConsistent('advance past the end, twice')
  })

  test('reordering persists', async () => {
    const { body: before } = await get(`/api/speakers/${sessionId}`)
    const reversed = [...before].reverse().map((s) => s.id)
    const { body: after } = await post('/api/speakers/reorder', { session_id: sessionId, ids: reversed })
    assert.deepEqual(names(after), names(before).reverse())

    const { body: refetched } = await get(`/api/speakers/${sessionId}`)
    assert.deepEqual(names(refetched), names(after))
  })

  test('deleting the delegation holding the floor does not strand the session', async () => {
    await post('/api/speakers', { session_id: sessionId, name: 'Norway' })
    await post('/api/speakers/advance', { session_id: sessionId })

    const { body: queue } = await get(`/api/speakers/${sessionId}`)
    const speaking = queue.find((s) => s.status === 'speaking')
    assert.ok(speaking, 'expected someone to hold the floor')

    await del(`/api/speakers/${speaking.id}`)
    await assertConsistent('after deleting the current speaker')
  })

  test('the queue belongs to its session and disappears with it', async () => {
    const { body: other } = await post('/api/sessions', { name: 'Unrelated session' })
    const { body: empty } = await get(`/api/speakers/${other.id}`)
    assert.deepEqual(empty, [], 'a new session must start with an empty list')
    await patch(`/api/sessions/${other.id}`, { end: true })
  })
})
