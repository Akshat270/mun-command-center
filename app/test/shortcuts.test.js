// Keyboard dispatch rules.
//
// This exists because of a real failure: every single-letter navigation
// shortcut fired while the delegate was typing. Writing the word "and" in a
// note jumped to Dashboard, then Notes, then the Draft. Mid-committee that is
// worse than having no shortcuts at all, so the rule is pinned down here.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveShortcut } from '../src/lib/shortcuts.ts'

// Exactly what Layout registers.
const NAV = ['mod+k', 'escape', 'g', 'l', 's', 'p', 'r', 'c', 'd', 'n', 'm', 't', '?']

describe('typing must never trigger navigation', () => {
  for (const key of ['n', 'd', 'g', 's', 'm', 't', 'a', 'r', 'c', 'l', 'p']) {
    test(`"${key}" does nothing while typing`, () => {
      assert.equal(resolveShortcut({ key, typing: true }, NAV), null)
    })
  }

  test('the word "and" types cleanly instead of navigating three times', () => {
    const fired = [...'and'].map((key) => resolveShortcut({ key, typing: true }, NAV))
    assert.deepEqual(fired, [null, null, null])
  })

  test('digits do not open speeches while typing', () => {
    for (const key of ['1', '2', '3']) {
      assert.equal(resolveShortcut({ key, typing: true }, ['1', '2', '3']), null)
    }
  })

  test('shift held for a capital letter still does not navigate', () => {
    assert.equal(resolveShortcut({ key: 'N', shift: true, typing: true }, NAV), null)
  })
})

describe('shortcuts still work when not typing', () => {
  test('bare letters navigate', () => {
    assert.equal(resolveShortcut({ key: 'n' }, NAV), 'n')
    assert.equal(resolveShortcut({ key: 'd' }, NAV), 'd')
  })

  test('capitals navigate too', () => {
    assert.equal(resolveShortcut({ key: 'N', shift: true }, NAV), 'n')
  })

  test('an unregistered key does nothing', () => {
    assert.equal(resolveShortcut({ key: 'z' }, NAV), null)
  })
})

describe('modifier combos', () => {
  test('Ctrl+K opens search even while typing', () => {
    assert.equal(resolveShortcut({ key: 'k', ctrl: true, typing: true }, NAV), 'mod+k')
  })

  test('Cmd+K works the same way', () => {
    assert.equal(resolveShortcut({ key: 'k', meta: true, typing: true }, NAV), 'mod+k')
  })

  // The original bug in one line: Ctrl+D must not resolve to the bare "d".
  test('a modified key never falls through to its bare handler', () => {
    assert.equal(resolveShortcut({ key: 'd', ctrl: true }, NAV), null)
    assert.equal(resolveShortcut({ key: 'n', ctrl: true }, NAV), null)
    assert.equal(resolveShortcut({ key: 'a', ctrl: true, typing: true }, NAV), null,
      'Ctrl+A must select all, not trigger Analyze')
  })
})

describe('overlays', () => {
  test('a letter does not navigate out from under an open dialog', () => {
    assert.equal(resolveShortcut({ key: 'd', overlay: true }, NAV), null)
  })

  test('Escape still works while typing and under an overlay', () => {
    assert.equal(resolveShortcut({ key: 'Escape', typing: true }, NAV), 'escape')
    assert.equal(resolveShortcut({ key: 'Escape', overlay: true }, NAV), 'escape')
  })
})
