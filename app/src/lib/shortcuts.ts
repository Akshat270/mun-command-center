import { useEffect } from 'react'

export const SHORTCUTS = [
  { keys: 'Ctrl K', label: 'Global search', where: 'Anywhere' },
  { keys: 'L', label: 'Live Room', where: 'Navigation' },
  { keys: 'S', label: 'Speeches', where: 'Navigation' },
  { keys: 'P', label: 'POIs', where: 'Navigation' },
  { keys: 'R', label: 'Research', where: 'Navigation' },
  { keys: 'N', label: 'Notes', where: 'Navigation' },
  { keys: 'D', label: 'Draft Resolution', where: 'Navigation' },
  { keys: 'C', label: 'Countries', where: 'Navigation' },
  { keys: 'M', label: 'Motions & Procedure', where: 'Navigation' },
  { keys: 'G', label: 'Dashboard', where: 'Navigation' },
  { keys: 'T', label: 'Start / stop timer', where: 'Anywhere' },
  { keys: 'A', label: 'Analyze current statement', where: 'Live Room' },
  { keys: '1 / 2 / 3', label: '30s / 45s / 60s speech', where: 'Speeches' },
  { keys: 'F', label: 'Focus mode', where: 'Speeches' },
  { keys: 'Q', label: 'Answers attached to this speech', where: 'Speeches' },
  { keys: 'Esc', label: 'Close overlay', where: 'Anywhere' },
]

/** True when the user is typing — single-letter shortcuts must not fire then. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable === true) return true
  // Focus can sit on a wrapper inside an editable region.
  return Boolean(el.closest?.('input, textarea, select, [contenteditable="true"]'))
}

/**
 * Overlay depth, kept on the document so any component can raise it without a
 * store subscription. While a dialog is open a bare letter must not navigate:
 * pressing "d" with a half-written POI on screen should do nothing, not throw
 * the draft away and jump to the resolution.
 */
export function pushOverlay(): () => void {
  const depth = Number(document.body.dataset.overlay || '0') + 1
  document.body.dataset.overlay = String(depth)
  return () => {
    const next = Number(document.body.dataset.overlay || '1') - 1
    if (next > 0) document.body.dataset.overlay = String(next)
    else delete document.body.dataset.overlay
  }
}

export const overlayOpen = () => Number(document.body.dataset.overlay || '0') > 0

// Keys that must work even while typing, because they are how you get out.
const ALWAYS_ALLOWED = new Set(['escape'])

export type KeyState = {
  key: string
  ctrl?: boolean
  meta?: boolean
  alt?: boolean
  shift?: boolean
  typing?: boolean
  overlay?: boolean
}

/**
 * Which registered handler, if any, a keypress should invoke. Pure, so the rule
 * can be tested without a DOM.
 *
 * The rule this exists to protect: a bare letter must NEVER fire while the
 * delegate is typing. An earlier version built a combo string that collapsed to
 * the bare letter when no modifier was held, matched it first, and returned —
 * so pressing "n" mid-sentence in a note navigated away to the Notes page.
 */
export function resolveShortcut(s: KeyState, registered: readonly string[]): string | null {
  const key = s.key.toLowerCase()
  const has = (name: string) => (registered.includes(name) ? name : null)

  if (s.ctrl || s.meta || s.alt) {
    const combo = [
      s.ctrl || s.meta ? 'mod' : '',
      s.alt ? 'alt' : '',
      s.shift ? 'shift' : '',
      key,
    ].filter(Boolean).join('+')
    return has(combo)          // a modified key never falls through to a bare one
  }

  if (ALWAYS_ALLOWED.has(key)) return has(key)
  if (s.typing || s.overlay) return null
  return has(key)
}

type Handlers = Record<string, (e: KeyboardEvent) => void>

/**
 * Global keyboard handling.
 * Single letters only fire when not typing and no modifier is held, so they
 * never interfere with note-taking mid-committee.
 */
export function useShortcuts(handlers: Handlers, deps: unknown[] = []) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // IME composition produces keydown events for characters being composed.
      if (e.isComposing || e.keyCode === 229) return

      const match = resolveShortcut(
        {
          key: e.key,
          ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey,
          typing: isTyping(e.target),
          overlay: overlayOpen(),
        },
        Object.keys(handlers)
      )
      if (match) handlers[match](e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
