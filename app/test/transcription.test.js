// Speech-to-text plumbing.
//
// This exists because of a real failure: most of what was said in committee
// never reached the transcript. Two causes are pinned down here — the browser
// emits a "final" result every few words, so a speech arrived as a pile of
// three-word stubs; and it spells member states phonetically, so a position got
// attributed to a country that does not exist.
//
// The recognizer itself cannot be tested without a browser. These are the parts
// that were deliberately kept pure so that they can be.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { createUtteranceBuffer, UTTERANCE } from '../src/lib/transcription.ts'
import { applyVocabulary } from '../src/lib/vocabulary.ts'

/** Collects what the buffer decides to emit. */
function collector() {
  const out = []
  const buffer = createUtteranceBuffer((text, startedAt) => out.push({ text, startedAt }))
  return { buffer, out, texts: () => out.map((o) => o.text) }
}

describe('fragments become whole utterances', () => {
  test('a sentence arriving in pieces is emitted once, not five times', () => {
    const { buffer, texts } = collector()
    const t = 1000
    for (const [i, part] of ['Canada believes', 'that mass', 'surveillance', 'must remain', 'proportionate.'].entries()) {
      buffer.add(part, t + i * 100)
    }
    assert.deepEqual(texts(), ['Canada believes that mass surveillance must remain proportionate.'])
  })

  test('nothing is emitted while the speaker is still going', () => {
    const { buffer, out } = collector()
    buffer.add('Canada believes', 1000)
    buffer.add('that surveillance', 1100)
    assert.equal(out.length, 0)
  })

  test('silence flushes what is held', () => {
    const { buffer, texts } = collector()
    buffer.add('a point of order', 1000)
    buffer.tick(1000 + UTTERANCE.silenceMs - 1)
    assert.deepEqual(texts(), [], 'flushed too early')
    buffer.tick(1000 + UTTERANCE.silenceMs)
    assert.deepEqual(texts(), ['a point of order'])
  })

  test('an abbreviation mid-sentence does not end the utterance', () => {
    // The word floor exists for exactly this: "Mr. Chair" is not a sentence.
    const { buffer, out } = collector()
    buffer.add('Mr. Chair', 1000)
    assert.equal(out.length, 0)
  })

  test('a speaker who never pauses is still broken up', () => {
    const { buffer, out } = collector()
    for (let i = 0; i < UTTERANCE.maxWords + 5; i++) buffer.add(`word${i}`, 1000 + i)
    assert.equal(out.length, 1)
    assert.ok(out[0].text.split(/\s+/).length >= UTTERANCE.maxWords)
  })

  test('stopping mid-sentence does not lose the words', () => {
    const { buffer, texts } = collector()
    buffer.add('we reserve the right', 1000)
    buffer.flush()
    assert.deepEqual(texts(), ['we reserve the right'])
  })

  test('flushing twice does not emit twice', () => {
    const { buffer, out } = collector()
    buffer.add('quorum is present', 1000)
    buffer.flush()
    buffer.flush()
    assert.equal(out.length, 1)
  })

  test('the timestamp is when speech began, not when it was committed', () => {
    const { buffer, out } = collector()
    buffer.add('Canada', 5000)
    buffer.add('objects', 5400)
    buffer.flush()
    assert.equal(out[0].startedAt, 5000)
  })
})

describe('domain vocabulary is repaired', () => {
  test('mangled procedure terms are corrected', () => {
    assert.equal(applyVocabulary('I raise a point of ordre'), 'I raise a point of order')
    assert.equal(applyVocabulary('motion for an unmoderated cawcus'), 'motion for an unmoderated caucus')
  })

  test('a correctly heard member state is left alone', () => {
    assert.equal(
      applyVocabulary('the delegate of Argentina disagrees', ['Argentina', 'Austria']),
      'the delegate of Argentina disagrees'
    )
  })

  test('a misheard single word is NOT guessed into a country', () => {
    // Deliberate. One word carries no context to disambiguate it, and member
    // states sit within an edit of each other, so guessing risks recording a
    // position against a delegation that never took it. Leaving the odd word
    // as heard is the cheaper mistake.
    assert.equal(
      applyVocabulary('the delegate of Argentia disagrees', ['Argentina', 'Austria']),
      'the delegate of Argentia disagrees'
    )
  })

  test('correct text is left exactly alone', () => {
    const ok = 'Canada supports proportionate lawful interception under the ICCPR.'
    assert.equal(applyVocabulary(ok, ['Canada']), ok)
  })

  test('ordinary words are never rewritten into jargon', () => {
    // Short terms get no fuzzy matching at all — otherwise "and" becomes "UNGA"
    // and the transcript says something nobody said.
    for (const sentence of ['and so we agree', 'we met a quota', 'it was a plan']) {
      assert.equal(applyVocabulary(sentence), sentence)
    }
  })

  test('a term already spelled correctly is not duplicated or reflowed', () => {
    const s = 'point of information for the delegate'
    assert.equal(applyVocabulary(s), s)
  })

  test('trailing punctuation survives a repair', () => {
    assert.equal(applyVocabulary('I yield to the chare.'), 'I yield to the chair.')
  })

  test('empty and blank input is returned untouched', () => {
    assert.equal(applyVocabulary(''), '')
    assert.equal(applyVocabulary('   '), '   ')
  })
})

describe('one country is never rewritten into another', () => {
  // The worst failure this code could produce. Member-state names cluster
  // within a single edit of each other, so a loose match attributes a position
  // to a delegation that never took it — and it looks completely plausible in
  // the transcript afterwards.
  const NEIGHBOURS = [
    ['Zambia', 'Gambia'],
    ['Ireland', 'Iceland'],
    ['Austria', 'Australia'],
    ['Niger', 'Nigeria'],
    ['Mali', 'Malta'],
    ['Chad', 'Chile'],
    ['India', 'Indonesia'],
    ['Slovakia', 'Slovenia'],
  ]

  for (const [a, b] of NEIGHBOURS) {
    test(`"${a}" survives alongside "${b}"`, () => {
      const names = NEIGHBOURS.flat()
      assert.equal(
        applyVocabulary(`the delegate of ${a} objects`, names),
        `the delegate of ${a} objects`
      )
    })
  }

  test('a real word is not rewritten into the country it resembles', () => {
    assert.equal(applyVocabulary('Israeli forces', ['Israel']), 'Israeli forces')
    assert.equal(applyVocabulary('the chile was cold', ['Chile']), 'the chile was cold')
  })

  test('multi-word phrases are still repaired, because they do not collide', () => {
    // "unmoderated caucus" resembles nothing else said in a committee room, so
    // fuzzy matching is safe there in a way it never is for a lone word.
    assert.equal(
      applyVocabulary('motion for an unmoderated cawcus'),
      'motion for an unmoderated caucus'
    )
    assert.equal(
      applyVocabulary('a point of ordre', ['Argentina']),
      'a point of order'
    )
  })
})
