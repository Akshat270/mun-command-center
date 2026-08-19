// Transcription abstraction: start / stop / pause behind one interface, so
// swapping providers later never touches the Live Room.
//
// Provider 1 — Web Speech API. Built into Edge/Chrome, free, near-real-time,
//              needs internet.
// Provider 2 — manual entry. Always available, always works, zero setup.
//
// Recording NEVER starts on its own. It starts only when the delegate presses
// the button, and the indicator is deliberately impossible to miss.
//
// ── Why this file is more careful than it looks ──────────────────────────────
//
// The original version restarted the *same* SpeechRecognition instance from
// `onend`. Chrome ends the stream every 30-60s on its own; restarting an
// instance that is still tearing down throws InvalidStateError, and that
// instance is then dead — no further onresult, no further onend. The UI kept
// showing ● RECORDING while every subsequent word was lost. That single bug is
// why "most of what people say is not detected".
//
// So: every restart builds a FRESH instance, a watchdog catches the case where
// Chrome stops calling us back entirely, and errors are split into recoverable
// and fatal — because an auto-restart loop on a denied microphone would spin
// forever.

export type Segment = {
  text: string
  isFinal: boolean
  at: string
}

export type TranscriptionState = 'idle' | 'listening' | 'reconnecting' | 'paused' | 'error'

export type TranscriptionHandlers = {
  onSegment: (s: Segment) => void
  onState: (s: TranscriptionState, detail?: string) => void
}

export type StartOptions = {
  lang?: string
  /** Applied to a finished utterance before it is handed over. */
  refine?: (text: string) => string
}

export interface TranscriptionProvider {
  readonly name: string
  readonly available: boolean
  readonly unavailableReason?: string
  start(handlers: TranscriptionHandlers, options?: StartOptions): void
  pause(): void
  resume(): void
  stop(): void
}

// ─────────────────────────────────────────────────────── utterance buffering

/**
 * Chrome emits a "final" result every few words, so a 60-second speech arrives
 * as ~15 fragments. Committed one by one they become 15 stub transcript rows,
 * each classified by the AI in isolation — worse analysis, 15x the cost, and a
 * transcript nobody can read back.
 *
 * This collects fragments into whole utterances. Deliberately pure and free of
 * timers so it can be unit-tested without a browser: the caller supplies the
 * clock via `now`, and asks for a flush decision on each fragment and on a
 * tick.
 */
export const UTTERANCE = {
  /** Silence after which a buffered utterance is considered finished. */
  silenceMs: 1500,
  /** Sentence-final punctuation only ends an utterance once it has some substance. */
  minWordsForPunctuation: 6,
  /** A speaker who never pauses still gets broken up eventually. */
  maxWords: 40,
}

const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

export function createUtteranceBuffer(emit: (text: string, startedAt: number) => void) {
  let parts: string[] = []
  let startedAt = 0
  let lastAt = 0

  const text = () => parts.join(' ').replace(/\s+/g, ' ').trim()

  const flush = () => {
    const out = text()
    parts = []
    const began = startedAt
    startedAt = 0
    lastAt = 0
    if (out) emit(out, began)
    return out
  }

  return {
    /** Feed one final fragment. Flushes when the utterance looks complete. */
    add(fragment: string, now: number) {
      const clean = fragment.trim()
      if (!clean) return
      if (!parts.length) startedAt = now
      parts.push(clean)
      lastAt = now

      const current = text()
      // A full stop mid-thought ("Mr. Chair") must not end the utterance, hence
      // the word floor.
      const endsSentence = /[.!?]["')\]]?$/.test(current) && wordCount(current) >= UTTERANCE.minWordsForPunctuation
      if (endsSentence || wordCount(current) >= UTTERANCE.maxWords) flush()
    },

    /** Call periodically; flushes an utterance that has gone quiet. */
    tick(now: number) {
      if (parts.length && now - lastAt >= UTTERANCE.silenceMs) flush()
    },

    /** Force out whatever is held — on pause, stop, reload or tab hide. */
    flush,

    get pending() { return text() },
  }
}

// ──────────────────────────────────────────────────────────── web speech

type SR = any

function getSpeechRecognition(): SR | null {
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

// Errors that restarting cannot fix. Retrying these would spin the CPU forever
// on what is really a one-line instruction to the user.
const FATAL_ERRORS: Record<string, string> = {
  'not-allowed': 'Microphone permission denied. Allow microphone access in your browser, then start again.',
  'service-not-allowed': 'Speech service blocked by the browser or OS.',
  'audio-capture': 'No microphone found. Check that one is connected and selected as the Windows input device.',
}

// Routine and silent: Chrome raises these constantly during normal use.
const IGNORED_ERRORS = new Set(['no-speech', 'aborted'])

// Restart as fast as the browser allows. Every millisecond in here is a
// millisecond the microphone is dead, and a delegate who starts speaking during
// one loses their opening words.
const RESTART_DELAYS = [120, 250, 500, 1000, 2000]
const NETWORK_RETRY_LIMIT = 5

/**
 * Last resort only.
 *
 * Chrome legitimately says nothing at all while the room is quiet, so this must
 * be far longer than any natural pause between speakers. At 12s it fired during
 * ordinary silence, aborted a healthy recognizer, and — because a silent
 * recycle counted as a failed run — escalated the restart backoff to four
 * seconds. The app then spent seconds at a time completely deaf, which is worse
 * than the bug it was written to catch.
 */
const WATCHDOG_MS = 45_000

class WebSpeechProvider implements TranscriptionProvider {
  name = 'Browser speech recognition'

  private rec: SR = null
  private handlers: TranscriptionHandlers | null = null
  private options: StartOptions = {}

  // What the delegate asked for, as distinct from what the recognizer is doing.
  // The old code used one `stopping` boolean for both pause and stop, so `onend`
  // overwrote the paused state with idle a moment after Pause was pressed.
  private desired: 'stopped' | 'running' | 'paused' = 'stopped'

  private buffer = createUtteranceBuffer(() => {})
  private restarts = 0
  private networkRetries = 0
  private lastCallbackAt = 0
  private restartTimer: any = null
  private tickTimer: any = null
  private wakeLock: any = null

  // A `network` error arrives on `onerror` but is acted on in `onend`, which
  // runs immediately afterwards. Without this flag `onend` cannot tell a network
  // failure from Chrome's routine end-of-stream, and would restart on the
  // shortest delay — burning every retry in well under a second and turning a
  // brief wifi drop into a permanent stop.
  private networkErrorPending = false

  // Invalidates an in-flight wake-lock request. `requestWakeLock` is async and
  // is deliberately not awaited, so a stop() can land while the browser is still
  // resolving the request; without this the late resolution would assign a lock
  // that nothing will ever release, holding the screen awake for good.
  private wakeLockToken = 0

  get available() { return Boolean(getSpeechRecognition()) }
  get unavailableReason() {
    return this.available ? undefined
      : 'This browser has no built-in speech recognition. Use Chrome or Edge, or type statements manually.'
  }

  start(handlers: TranscriptionHandlers, options: StartOptions = {}) {
    if (!getSpeechRecognition()) { handlers.onState('error', this.unavailableReason); return }

    // Starting while something is already running would leave two recognizers
    // alive, both feeding the same buffer — every phrase committed twice — and
    // would leak the previous wake lock. Reachable by pressing "Start
    // listening" again from the error state.
    this.desired = 'stopped'
    this.teardown()
    this.flushBuffer()

    this.handlers = handlers
    this.options = options
    this.desired = 'running'
    this.restarts = 0
    this.networkRetries = 0
    this.networkErrorPending = false

    this.buffer = createUtteranceBuffer((text, startedAt) => {
      const refined = this.options.refine ? this.options.refine(text) : text
      if (!refined.trim()) return
      handlers.onSegment({
        text: refined,
        isFinal: true,
        // The time speech BEGAN, not the time it was committed. The server
        // stamps its own `now()` otherwise, and two utterances racing through
        // an AI classification can land out of spoken order.
        at: new Date(startedAt || Date.now()).toISOString(),
      })
    })

    this.attachLifecycle()
    this.requestWakeLock()
    this.startTicking()
    this.spawn()
  }

  pause() {
    this.desired = 'paused'
    this.teardown()
    this.flushBuffer()
    this.handlers?.onState('paused')
  }

  resume() {
    if (!this.handlers) return
    this.start(this.handlers, this.options)
  }

  stop() {
    this.desired = 'stopped'
    this.teardown()
    this.flushBuffer()
    this.detachLifecycle()
    this.handlers?.onState('idle')
  }

  // ───────────────────────────────────────────────────────────── internals

  /** Build a brand new recognizer. Never reuse one that has ended. */
  private spawn() {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition || this.desired !== 'running') return

    const rec = new SpeechRecognition()
    rec.continuous = true
    rec.interimResults = true
    // en-GB is the default because it is what this app used before the setting
    // existed, and changing someone's acoustic model underneath them is not a
    // safe default — en-IN helps many Indian speakers and hurts others. It is
    // one click away in Settings, which is where that choice belongs.
    rec.lang = this.options.lang || 'en-GB'
    rec.maxAlternatives = 1

    this.lastCallbackAt = Date.now()

    rec.onstart = () => {
      this.lastCallbackAt = Date.now()
      if (this.desired === 'running') this.handlers?.onState('listening')
    }

    rec.onresult = (event: any) => {
      this.lastCallbackAt = Date.now()
      this.restarts = 0
      this.networkRetries = 0
      this.networkErrorPending = false

      // One interim string per event, not one per result index. The Live Room
      // renders the latest interim it is given, so emitting each index
      // separately meant only the last one survived and the on-screen text
      // jumped and truncated.
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0]?.transcript?.trim()
        if (!text) continue
        if (result.isFinal) this.buffer.add(text, Date.now())
        else interim = interim ? `${interim} ${text}` : text
      }

      // Include what is waiting in the buffer. A finalised fragment leaves the
      // interim string but is not committed until the utterance completes, so
      // showing only `interim` makes finished words disappear off the screen
      // for a second or two — exactly the "it isn't hearing me" feeling this
      // whole change set exists to remove.
      const pending = this.buffer.pending
      const shown = [pending, interim].filter(Boolean).join(' ')
      this.handlers?.onSegment({ text: shown, isFinal: false, at: new Date().toISOString() })
    }

    rec.onerror = (e: any) => {
      this.lastCallbackAt = Date.now()
      const code = e?.error

      if (IGNORED_ERRORS.has(code)) return

      if (FATAL_ERRORS[code]) {
        this.desired = 'stopped'
        this.teardown()
        this.flushBuffer()
        this.handlers?.onState('error', FATAL_ERRORS[code])
        return
      }

      if (code === 'network') {
        this.networkRetries++
        if (this.networkRetries > NETWORK_RETRY_LIMIT) {
          this.desired = 'stopped'
          this.teardown()
          this.flushBuffer()
          this.handlers?.onState('error',
            'Speech recognition needs internet and could not reconnect. Manual transcript mode is enabled.')
          return
        }
        // Let onend do the restart, but tell it this was a failure so the delay
        // actually grows. The retry budget is only worth having if it is spread
        // over enough time for the network to come back.
        this.networkErrorPending = true
        return
      }

      // Anything not explicitly known to be recoverable is treated as fatal.
      // The recoverable cases are enumerated above, so an unrecognised code
      // (`language-not-supported`, reachable from the language setting, or
      // `bad-grammar`) would otherwise restart forever behind an error message
      // the delegate cannot clear.
      this.desired = 'stopped'
      this.teardown()
      this.flushBuffer()
      this.handlers?.onState('error',
        `Transcription stopped — ${code}. Check the recognition language in Settings, or type statements manually.`)
    }

    rec.onend = () => {
      this.lastCallbackAt = Date.now()
      if (this.rec !== rec) return              // superseded by a newer instance
      this.rec = null
      if (this.desired !== 'running') return
      const afterNetworkError = this.networkErrorPending
      this.networkErrorPending = false
      this.scheduleRestart(afterNetworkError)
    }

    this.rec = rec
    try {
      rec.start()
    } catch {
      // Already starting, or the previous instance has not fully released the
      // microphone yet. Both are transient — back off and build another. This
      // is the one case that genuinely warrants a growing delay.
      this.rec = null
      this.scheduleRestart(true)
    }
  }

  /**
   * @param failed true only when the browser refused to start. Silence is not
   *   a failure: counting a quiet room as one escalated the backoff until the
   *   microphone was off for seconds at a time.
   */
  private scheduleRestart(failed = false) {
    if (this.desired !== 'running' || this.restartTimer) return

    this.restarts = failed ? Math.min(this.restarts + 1, RESTART_DELAYS.length - 1) : 0
    const delay = RESTART_DELAYS[this.restarts]

    // Only announce a wobble if it will actually be visible. Chrome ends the
    // stream every 30-60s as a matter of course, and flashing RECONNECTING on
    // every one of those makes healthy operation look broken.
    if (failed) this.handlers?.onState('reconnecting')

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawn()
    }, delay)
  }

  /** Flushes gone-quiet utterances, and catches a fully wedged recognizer. */
  private startTicking() {
    clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => {
      const now = Date.now()
      this.buffer.tick(now)

      if (this.desired !== 'running' || this.restartTimer) return
      // Never interrupt someone mid-sentence to check on the recognizer.
      if (this.buffer.pending) return
      if (now - this.lastCallbackAt > WATCHDOG_MS) {
        // No onresult, no onend, no onerror for 45 seconds. Chrome has stopped
        // talking to us and will never call onend, so nothing else would ever
        // recover this.
        this.recycle()
      }
    }, 500)
  }

  private recycle() {
    const dead = this.rec
    this.rec = null
    // Detach first, exactly as teardown() does. A wedged recognizer can still
    // emit a late onerror after we have given up on it, and that error would be
    // applied to its healthy replacement — a stray `network` escalating the
    // backoff, or an unknown code stopping transcription outright.
    if (dead) {
      dead.onend = null; dead.onresult = null; dead.onerror = null; dead.onstart = null
    }
    // stop() first: it delivers whatever has already been recognised, where
    // abort() throws that audio away. abort() is only the fallback.
    try { dead?.stop?.() } catch { /* already gone */ }
    try { dead?.abort?.() } catch { /* already gone */ }
    this.lastCallbackAt = Date.now()
    this.scheduleRestart()
  }

  private teardown() {
    clearTimeout(this.restartTimer); this.restartTimer = null
    clearInterval(this.tickTimer); this.tickTimer = null
    const dead = this.rec
    this.rec = null
    if (dead) {
      dead.onend = null; dead.onresult = null; dead.onerror = null; dead.onstart = null
      try { dead.abort?.() } catch { /* not running */ }
      try { dead.stop?.() } catch { /* not running */ }
    }
    this.releaseWakeLock()
  }

  private flushBuffer() { this.buffer.flush() }

  // A closing lid or a reload must not swallow the sentence still in the buffer.
  private onHide = () => { if (document.visibilityState === 'hidden') this.flushBuffer() }
  private onUnload = () => this.flushBuffer()

  private attachLifecycle() {
    document.addEventListener('visibilitychange', this.onHide)
    window.addEventListener('beforeunload', this.onUnload)
  }

  private detachLifecycle() {
    document.removeEventListener('visibilitychange', this.onHide)
    window.removeEventListener('beforeunload', this.onUnload)
  }

  // A laptop that sleeps mid-committee stops recognising, silently — the same
  // class of failure as the bug this file exists to fix.
  private async requestWakeLock() {
    const token = ++this.wakeLockToken
    try {
      const lock = await (navigator as any).wakeLock?.request('screen')
      if (!lock) return
      // A stop(), pause() or restart landed while the browser was resolving this
      // request. That caller already ran releaseWakeLock and found nothing to
      // release, so releasing here is the only thing that can free it.
      if (token !== this.wakeLockToken) { try { lock.release?.() } catch { /* already gone */ } return }
      this.wakeLock = lock
    } catch { /* unsupported, or refused because the page is hidden */ }
  }

  private releaseWakeLock() {
    // Bumping the token first invalidates any request still in flight.
    this.wakeLockToken++
    try { this.wakeLock?.release?.() } catch { /* already released */ }
    this.wakeLock = null
  }
}

class ManualProvider implements TranscriptionProvider {
  name = 'Manual entry'
  available = true
  start(handlers: TranscriptionHandlers) { handlers.onState('idle') }
  pause() {}
  resume() {}
  stop() {}
}

export const providers: Record<string, TranscriptionProvider> = {
  webspeech: new WebSpeechProvider(),
  manual: new ManualProvider(),
}

/**
 * The provider to use, together with what was lost in getting there.
 *
 * `getTranscriptionProvider` falls back to manual entry so there is always
 * something that works. That fallback is right, but it also means the returned
 * provider's `available` is always true — so a caller checking `provider.available`
 * learns nothing, and `unavailableReason` can never be shown. On Safari and
 * Firefox that turned "Start listening" into a silent no-op with no explanation
 * anywhere on screen.
 *
 * Callers that want to tell the delegate why should use this instead.
 */
export function resolveTranscription(name = 'webspeech'): {
  provider: TranscriptionProvider
  fellBack: boolean
  reason?: string
} {
  const requested = providers[name]
  const provider = requested?.available ? requested : providers.manual
  return {
    provider,
    fellBack: Boolean(requested) && provider !== requested,
    reason: requested && !requested.available ? requested.unavailableReason : undefined,
  }
}

export function getTranscriptionProvider(name = 'webspeech'): TranscriptionProvider {
  const p = providers[name]
  return p?.available ? p : providers.manual
}

/** Offered in Settings. Web Speech ignores anything outside this shape. */
export const RECOGNITION_LANGUAGES = [
  { value: 'en-IN', label: 'English (India) — best for Indian accents' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-US', label: 'English (US)' },
]
