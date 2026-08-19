// LIVE ROOM — the screen that stays open during committee.
//
// Three panes: transcript · analysis · quick actions. Everything the delegate
// needs mid-debate is reachable without opening another window.
//
// Recording is explicit, obvious, and never automatic.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { useShortcuts } from '../lib/shortcuts'
import { Panel, Empty, Spinner, AIBanner, useTimer, TimerDisplay, Modal, CopyButton } from '../components/ui'
import { AnalysisCard } from '../components/AnalysisCard'
import { MicCheck } from '../components/MicCheck'
import { SpeakersList, type Speaker } from '../components/SpeakersList'
import { getTranscriptionProvider, resolveTranscription, type TranscriptionState } from '../lib/transcription'
import { applyVocabulary, countryTerms } from '../lib/vocabulary'
import { MEMBER_STATE_NAMES, findMemberState } from '../lib/member-states'

const PHASES = [
  { key: 'roll_call', label: 'Roll call' },
  { key: 'gsl', label: 'GSL' },
  { key: 'moderated', label: 'Moderated' },
  { key: 'unmoderated', label: 'Unmoderated' },
  { key: 'drafting', label: 'Drafting' },
  { key: 'voting', label: 'Voting' },
]

// Labels that are not a member state. Every actual country comes from the
// database and is appended to these — a committee is not four countries, and
// typing a name that is not on any list has to work too.
const FIXED_SPEAKERS = ['Unknown', 'Speaker A', 'Speaker B', 'Speaker C', 'Chair']

const CLASS_COLOR: Record<string, string> = {
  ATTACK: 'var(--color-bad)', QUESTION: 'var(--color-warn)', PROPOSAL: 'var(--color-signal)',
  MOTION: '#a06ee0', FACTUAL_CLAIM: 'var(--color-good)', PROCEDURAL: 'var(--faint)', IRRELEVANT: 'var(--faint)',
}

// Alert sensitivity -> minimum relevance before an alert is raised.
const SENSITIVITY_THRESHOLD: Record<string, number> = { low: 0.9, medium: 0.75, high: 0.5 }

// Optimistic rows need a unique React key. Date.now() collided whenever two
// utterances were committed inside the same millisecond.
let tmpCounter = 0
const nextTmpId = () => `${Date.now()}_${++tmpCounter}`

export function LiveRoom() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { session, setSession, startSession, aiAvailable, settings, saveSetting, toast, status } = useApp()
  const timer = useTimer()

  const [segments, setSegments] = useState<any[]>([])
  const [manual, setManual] = useState('')
  const [manualSpeaker, setManualSpeaker] = useState('Unknown')
  const [analysis, setAnalysis] = useState<any>(null)
  const [analysing, setAnalysing] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [alerts, setAlerts] = useState<any[]>([])

  // transcription
  const [recState, setRecState] = useState<TranscriptionState>('idle')
  const [recError, setRecError] = useState<string | null>(null)
  const [interim, setInterim] = useState('')
  const [consentOpen, setConsentOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')

  // Speakers list. Held here rather than inside the component because the
  // status strip, the speech timer and the transcript speaker all follow it.
  const [currentSpeaker, setCurrentSpeaker] = useState<Speaker | null>(null)
  const [nextSpeaker, setNextSpeaker] = useState<Speaker | null>(null)
  // Bumped when the keyboard advances the floor, so the queue on screen
  // reloads from the same endpoint and the two cannot drift apart.
  const [speakersEpoch, setSpeakersEpoch] = useState(0)
  const speakingSeconds = Number(settings?.speakingSeconds) || 60
  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // `settings` is null on the first render, so this ref cannot be the last word
  // on which provider to use — resolving it once at mount pinned the app to
  // browser speech recognition even for a delegate who had chosen "Manual entry
  // only", because their choice had not loaded yet. The effect below re-resolves
  // it once settings arrive, and again whenever the setting is changed.
  const providerName = settings?.transcriptionProvider || 'webspeech'
  const providerRef = useRef(getTranscriptionProvider(providerName))
  useEffect(() => {
    const next = getTranscriptionProvider(providerName)
    if (next === providerRef.current) return
    // Stop the outgoing provider first: swapping while it is live would leave a
    // microphone open with nothing listening to it.
    providerRef.current.stop()
    providerRef.current = next
    setRecState('idle')
    setInterim('')
  }, [providerName])

  // The provider outlives any single render, so anything it needs at flush time
  // is held in a ref. `manualSpeaker` used to be captured in the closure passed
  // to start(), which froze the speaker at whatever it was when the button was
  // pressed — changing it mid-session then did nothing.
  const speakerRef = useRef(manualSpeaker)
  speakerRef.current = manualSpeaker

  // Same reasoning as speakerRef: anything the running provider calls has to be
  // read at flush time, never captured when start() was pressed.
  const autocorrectRef = useRef(true)
  autocorrectRef.current = settings?.transcriptionAutocorrect !== false

  // Every member state, used three ways: to repair the recognizer's phonetic
  // spellings, to offer any of them as a speaker, and to resolve a typed name
  // back to its country code.
  // The `countries` table holds only the delegations with research briefs. The
  // speaker list must not be limited to those.
  const [countries, setCountries] = useState<any[]>([])
  const vocabRef = useRef<string[]>([])
  useEffect(() => {
    api.countries().then((c) => setCountries(c || [])).catch(() => {})
  }, [])

  // Every member state, so the recogniser's phonetic spellings get repaired —
  // not just the four with briefs.
  useEffect(() => {
    vocabRef.current = [...new Set([...countryTerms(countries), ...MEMBER_STATE_NAMES])]
  }, [countries])

  /**
   * Match a typed speaker to a country code — first against the delegations
   * with briefs, then against the full UN roster and its everyday aliases
   * ("UK", "Russia", "South Korea").
   *
   * A name that matches neither is kept exactly as typed with no code. That is
   * the point: an unlisted delegation, a guest speaker or an observer is still
   * someone worth recording.
   */
  const codeForSpeaker = useCallback((speaker: string): string | null => {
    const key = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
    const k = key(speaker)
    if (!k) return null
    const brief = countries.find((c) => key(c.name) === k || key(c.code) === k)
    if (brief) return brief.code
    return findMemberState(speaker)?.code ?? null
  }, [countries])

  // Suggestions only — the field is free text. Delegations with a brief come
  // first, then every other member state.
  const speakerOptions = useMemo(() => {
    const withBriefs = countries.map((c) => c.name).filter(Boolean)
    return [...new Set([...FIXED_SPEAKERS, ...withBriefs, ...MEMBER_STATE_NAMES])]
  }, [countries])

  const sensitivity = settings?.alertSensitivity || 'medium'
  const threshold = SENSITIVITY_THRESHOLD[sensitivity] ?? 0.75

  const loadTranscript = useCallback(() => {
    if (!session?.id) return
    api.transcript(session.id).then(setSegments).catch(() => {})
  }, [session?.id])

  useEffect(loadTranscript, [loadTranscript])
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ block: 'end' }) }, [segments.length, interim])

  // ────────────────────────────────────────────────── committing a segment

  const commitSegment = useCallback(async (text: string, speaker: string, source = 'manual', at?: string) => {
    const clean = text.trim()
    if (!clean || !session?.id) return null
    const country = codeForSpeaker(speaker)

    // The moment the words were spoken. Without this the server stamps its own
    // insert time, and because each POST waits on an AI classification, two
    // utterances in quick succession can be stored out of spoken order — the
    // transcript then reorders itself on the next reload.
    const ts = at || new Date().toISOString()

    // Optimistic insert so the transcript never lags the room.
    const optimistic = {
      id: `tmp_${nextTmpId()}`, speaker, country, text: clean,
      ts, classification: null, pending: true,
    }
    setSegments((s) => [...s, optimistic])

    try {
      const saved = await api.addSegment({ session_id: session.id, speaker, country, text: clean, source, ts })
      setSegments((s) => s.map((x) => (x.id === optimistic.id ? saved : x)))

      // Raise an alert only if the classifier says it matters at this sensitivity.
      if (saved.relevance >= threshold && saved.classification !== 'IRRELEVANT') {
        setAlerts((a) => [{ ...saved, at: Date.now() }, ...a].slice(0, 3))
      }
      return saved
    } catch {
      setSegments((s) => s.map((x) => (x.id === optimistic.id ? { ...x, pending: false, failed: true } : x)))
      toast('Could not save that line — it is still shown locally.', 'warn')
      return null
    }
  }, [session?.id, threshold, toast, codeForSpeaker])

  // Kept current so the running transcription provider always commits through
  // the latest version — see the note in startListening.
  const commitSegmentRef = useRef(commitSegment)
  commitSegmentRef.current = commitSegment

  // ─────────────────────────────────────────────────────────── recording

  const beginListening = () => {
    if (!settings?.recordingConsentAck) { setConsentOpen(true); return }
    startListening()
  }

  const startListening = () => {
    setRecError(null)

    // Ask for the configured provider, but find out whether we actually got it.
    // The resolver falls back to manual entry when browser recognition is
    // missing, and the manual provider is always "available" — so checking the
    // resolved provider told us nothing, and Safari/Firefox got a Start button
    // that did precisely nothing with no message anywhere.
    const { provider, fellBack, reason } = resolveTranscription(providerName)
    providerRef.current = provider
    if (fellBack) {
      setRecError(reason || 'Speech recognition is unavailable in this browser. Type statements below instead.')
      return
    }

    provider.start({
      // Finals now arrive as whole utterances, not three-word fragments.
      onSegment: (seg) => {
        if (seg.isFinal) {
          setInterim('')
          // Through a ref, not the closure. The provider outlives this call, so
          // a captured commitSegment would keep using the alert threshold and
          // session id that were current when Start was pressed — changing Alert
          // sensitivity mid-session then did nothing until you stopped and
          // started again.
          commitSegmentRef.current(seg.text, speakerRef.current, 'webspeech', seg.at)
        } else setInterim(seg.text)
      },
      onState: (state, detail) => {
        setRecState(state)
        if (state === 'error' && detail) { setRecError(detail); setInterim('') }
      },
    }, {
      lang: settings?.transcriptionLang || 'en-GB',
      // Also via a ref, for the same reason: toggling autocorrect should take
      // effect on the next utterance, not the next session.
      refine: (text) => (autocorrectRef.current ? applyVocabulary(text, vocabRef.current) : text),
    })
  }

  const stopListening = () => { providerRef.current.stop(); setRecState('idle'); setInterim('') }
  const pauseListening = () => { providerRef.current.pause(); setRecState('paused'); setInterim('') }

  useEffect(() => () => { providerRef.current.stop() }, [])  // always stop on unmount

  // ──────────────────────────────────────────────────────────── analysis

  const analyse = useCallback(async (seg: any) => {
    if (!seg) return
    setSelected(seg); setAnalysing(true); setAnalysis(null)
    setAlerts((a) => a.filter((x) => x.id !== seg.id))
    try {
      const res = await api.respond({
        statement: seg.text, sessionId: session?.id, country: seg.country, segmentId: seg.id,
      })
      setAnalysis(res)
      if (!res.ok) toast(res.reason, 'warn')
    } catch (e: any) { toast(e.message, 'bad') } finally { setAnalysing(false) }
  }, [session?.id, toast])

  const analyseManual = async () => {
    const text = manual.trim()
    if (!text) return
    setManual('')
    const saved = await commitSegment(text, manualSpeaker)
    await analyse(saved || { text, country: null, id: null })
  }

  /**
   * The floor changed. Three things follow from it, and doing them here rather
   * than inside SpeakersList keeps that component about the queue alone:
   *   · the speech timer restarts at the chair's speaking time
   *   · the transcript speaker follows, so recorded lines are attributed to the
   *     right delegation without anyone typing mid-debate
   *   · the status strip updates
   * The speaker field stays editable — this is a default, never a lock.
   */
  // Who held the floor last time this fired. A ref rather than reading state,
  // because the decision has to be made before the state update and must not
  // live inside the updater: React may invoke an updater more than once (it does
  // in StrictMode), and `setManualSpeaker`/`timer.start` are side effects that
  // must happen exactly once per real floor change.
  const lastFloorIdRef = useRef<string | null>(null)
  // False until the first callback establishes a baseline.
  const floorSeenRef = useRef(false)

  const handleFloorChange = useCallback((speaker: Speaker | null, next: Speaker | null) => {
    setNextSpeaker(next)
    setCurrentSpeaker(speaker)

    const id = speaker?.id ?? null
    const moved = id !== lastFloorIdRef.current
    lastFloorIdRef.current = id

    // The first callback is the queue loading, not the floor moving. A speech
    // may already be part-way through; restarting its timer would put a wrong
    // number on screen at the one moment it is being watched. The previous guard
    // compared against `prev`, which is null on mount, so it never caught this.
    const first = !floorSeenRef.current
    floorSeenRef.current = true

    if (speaker && moved) {
      // Attribution is safe to set on first load — it is a default the delegate
      // can still edit, and it makes recorded lines land on the right delegation.
      setManualSpeaker(speaker.name)
      if (!first) timer.start(speakingSeconds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speakingSeconds])

  const advanceFloor = useCallback((back: boolean) => {
    if (!session?.id) return
    // No duration from here. The client stopwatch is a display: it reads 0 after
    // a reload and is reset by the speaking-time buttons that share it, both of
    // which wrote a confident but false 0:00. The server measures from the row's
    // started_at instead, which is correct in every case and identical whether
    // the floor was advanced by this shortcut or by the button in the queue.
    api.advanceSpeaker({ session_id: session.id, back, seconds: null })
      .catch(() => {})
      .finally(() => setSpeakersEpoch((n) => n + 1))
  }, [session?.id, timer.seconds])

  useShortcuts({
    a: () => { const last = segments.at(-1); if (last) analyse(last) },
    ']': () => advanceFloor(false),
    '[': () => advanceFloor(true),
  }, [segments, analyse, advanceFloor])

  const updateSession = async (patch: Record<string, unknown>) => {
    if (!session?.id) return
    setSession({ ...session, ...patch })
    await api.patch(`/api/sessions/${session.id}`, patch).catch(() => {})
  }

  const renameSpeaker = async (from: string, to: string, country: string | null) => {
    if (!session?.id) return
    await api.post('/api/transcript/rename-speaker', { session_id: session.id, from, to, country }).catch(() => {})
    setRenaming(null); setRenameTo(''); loadTranscript(); toast(`${from} → ${to}`, 'good')
  }

  const applyRename = () => {
    const to = renameTo.trim()
    if (!to || !renaming) return
    // The code is looked up from the typed name, so renaming to a member state
    // still links the lines to that country's brief.
    renameSpeaker(renaming, to, codeForSpeaker(to))
  }

  // Our own delegation and its allies, the names most often needed.
  const quickPicks = useMemo(() => {
    const ours = countries.filter((c) => c.is_ours || c.bloc_status === 'strong_ally')
      .map((c) => c.name).filter(Boolean)
    return [...new Set([...ours, 'Chair'])].slice(0, 6)
  }, [countries])

  // Every speaker in the transcript, not just the placeholder labels. Now that
  // the speaker field is free text, a typo is the most likely thing needing a
  // rename — and filtering to "Speaker*"/"Unknown" made exactly that
  // uncorrectable.
  const distinctSpeakers = useMemo(
    () => [...new Set(segments.map((s) => s.speaker).filter(Boolean))],
    [segments]
  )

  // ───────────────────────────────────────────────────────────── no session

  if (!session) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4 h-full">
        <Empty icon="◉" title="No active session"
          hint="Start a session to record the transcript, take linked notes, and export everything afterwards." />
        <button className="btn btn-primary btn-lg" onClick={() => startSession()}>Start session</button>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Status strip */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 flex-wrap"
        style={{ background: 'var(--panel)' }}>
        <div className="flex gap-1">
          {PHASES.map((p) => (
            <button key={p.key} className="btn btn-sm"
              style={session.phase === p.key
                ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
              onClick={() => updateSession({ phase: p.key })}>{p.label}</button>
          ))}
        </div>

        <input className="input max-w-[280px]" placeholder="Current topic…" defaultValue={session.topic || ''}
          onBlur={(e) => updateSession({ topic: e.target.value })} />

        <div className="flex-1" />

        {/* Who holds the floor, always visible. */}
        {(currentSpeaker || nextSpeaker) && (
          <div className="text-[12px] flex items-center gap-2 whitespace-nowrap">
            {currentSpeaker && (
              <span>
                <span style={{ color: 'var(--faint)' }}>Now </span>
                <b style={{ color: 'var(--color-good)' }}>{currentSpeaker.name}</b>
              </span>
            )}
            {nextSpeaker && (
              <span style={{ color: 'var(--muted)' }}>
                <span style={{ color: 'var(--faint)' }}>Next </span>{nextSpeaker.name}
              </span>
            )}
          </div>
        )}

        <TimerDisplay t={timer} />
        <div className="flex gap-1">
          {[30, 45, 60, 90].map((s) => (
            <button key={s} className="btn btn-sm" onClick={() => timer.start(s)}>{s}s</button>
          ))}
          <button className="btn btn-sm" onClick={timer.toggle}>{timer.running ? '❙❙' : '▶'}</button>
        </div>
      </div>

      {/* Roll call — never pre-selected */}
      {session.phase === 'roll_call' && (
        <div className="px-3 py-2 border-b flex items-center gap-3 shrink-0" style={{ background: 'var(--panel-2)' }}>
          <span className="section-title">Roll call — {status?.committee?.country ?? 'your delegation'}</span>
          <div className="flex gap-1.5">
            {['Present', 'Present and Voting'].map((v) => (
              <button key={v} className="btn btn-sm"
                style={session.roll_call === v
                  ? { background: 'var(--color-good)', borderColor: 'var(--color-good)', color: '#04160f' } : {}}
                onClick={() => updateSession({ roll_call: v })}>{v}</button>
            ))}
          </div>
          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
            Record what you actually said. “Present” usually preserves the ability to abstain — this app will not choose for you.
          </span>
        </div>
      )}

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="px-3 py-1.5 border-b flex flex-col gap-1 shrink-0" style={{ background: 'var(--panel-2)' }}>
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[12px] fade-in">
              <span style={{ color: 'var(--color-warn)' }}>⚡</span>
              <span className="chip" style={{ color: CLASS_COLOR[a.classification], borderColor: CLASS_COLOR[a.classification] }}>
                {a.classification}
              </span>
              <span className="flex-1 truncate">{a.country || a.speaker}: {a.text}</span>
              <button className="btn btn-sm btn-primary" onClick={() => analyse(a)}>Analyze</button>
              <button className="btn btn-sm" onClick={() => setAlerts((x) => x.filter((y) => y.id !== a.id))}>Ignore</button>
              <button className="btn btn-sm" onClick={async () => {
                await api.patch(`/api/transcript/${a.id}`, { pinned: true }).catch(() => {})
                setAlerts((x) => x.filter((y) => y.id !== a.id)); toast('Pinned', 'good')
              }}>Pin</button>
            </div>
          ))}
        </div>
      )}

      {/* Three panes */}
      {/* Third column widened from 190px: it now carries the speakers list, and
          a country name plus a control does not fit in 190. */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(300px,1.1fr)_minmax(340px,1.3fr)_248px] gap-2 p-2 min-h-0">
        {/* Transcript */}
        <Panel
          title={`Transcript (${segments.length})`}
          actions={
            <>
              {distinctSpeakers.length > 0 && (
                <button className="btn btn-sm" title="Rename a speaker"
                  onClick={() => setRenaming(distinctSpeakers[0])}>Rename</button>
              )}
              {recState === 'listening' || recState === 'reconnecting' ? (
                <>
                  <MicCheck compact listening />
                  {recState === 'reconnecting' ? (
                    // Chrome ends the audio stream every 30-60s and we rebuild
                    // it. Saying so beats a ● RECORDING chip that might be lying.
                    <span className="chip" style={{ color: 'var(--color-warn)', borderColor: 'var(--color-warn)' }}>
                      ◐ RECONNECTING
                    </span>
                  ) : (
                    <span className="chip rec-dot" style={{ color: 'var(--color-bad)', borderColor: 'var(--color-bad)' }}>
                      ● RECORDING
                    </span>
                  )}
                  <button className="btn btn-sm" onClick={pauseListening}>Pause</button>
                  <button className="btn btn-sm" onClick={stopListening}>Stop</button>
                </>
              ) : recState === 'paused' ? (
                <>
                  <span className="chip" style={{ color: 'var(--color-warn)' }}>PAUSED</span>
                  <button className="btn btn-sm btn-primary" onClick={startListening}>Resume</button>
                  <button className="btn btn-sm" onClick={stopListening}>Stop</button>
                </>
              ) : (
                <button className="btn btn-sm btn-primary" onClick={beginListening}>🎧 Start listening</button>
              )}
            </>
          }
          bodyClass="flex flex-col min-h-0">
          {recError && (
            <div className="px-3 py-2 text-[12px] border-b" style={{ color: 'var(--color-warn)' }}>
              {recError}
              <div style={{ color: 'var(--faint)' }}>Manual transcript mode is enabled below — type what you hear.</div>
            </div>
          )}

          <div className="flex-1 scroll-y min-h-0 divide-line">
            {segments.length === 0 && !interim ? (
              <Empty icon="◉" title="Nothing recorded yet"
                hint="Press Start listening, or type a statement below and press Analyze." />
            ) : segments.map((s) => (
              <button key={s.id} onClick={() => analyse(s)}
                className="w-full text-left px-3 py-2 block"
                style={{ background: selected?.id === s.id ? 'var(--panel-2)' : 'transparent', opacity: s.pending ? 0.6 : 1 }}>
                <div className="flex items-center gap-1.5 mb-0.5 text-[11px]">
                  <span className="mono" style={{ color: 'var(--faint)' }}>
                    {new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium" style={{ color: 'var(--color-signal)' }}>{s.speaker}</span>
                  {s.classification && s.classification !== 'IRRELEVANT' && (
                    <span className="chip" style={{ color: CLASS_COLOR[s.classification], borderColor: CLASS_COLOR[s.classification] }}>
                      {s.classification}
                    </span>
                  )}
                  {Boolean(s.pinned) && <span style={{ color: 'var(--color-warn)' }}>★</span>}
                  {s.failed && <span className="chip" style={{ color: 'var(--color-bad)' }}>not saved</span>}
                </div>
                <p className="text-[13px] leading-snug">{s.text}</p>
              </button>
            ))}
            {interim && (
              <div className="px-3 py-2 text-[13px] italic" style={{ color: 'var(--faint)' }}>{interim}…</div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Manual entry — always available, the permanent fallback */}
          <div className="border-t p-2 flex flex-col gap-1.5 shrink-0">
            <div className="flex gap-1.5">
              {/* Free text with suggestions, not a dropdown: any delegation can
                  take the floor, including one nobody listed in advance. */}
              <input className="input max-w-[150px]" list="speaker-options" placeholder="Speaker…"
                value={manualSpeaker} onChange={(e) => setManualSpeaker(e.target.value)}
                title={codeForSpeaker(manualSpeaker) ? `Recognised: ${codeForSpeaker(manualSpeaker)}` : 'Not a listed member state — recorded by name only'} />
              <datalist id="speaker-options">
                {speakerOptions.map((s) => <option key={s} value={s} />)}
              </datalist>
              <input className="input" placeholder="Type what was said…" value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') analyseManual() }} />
            </div>
            <div className="flex gap-1.5">
              <button className="btn btn-sm flex-1" onClick={() => { commitSegment(manual, manualSpeaker); setManual('') }}
                disabled={!manual.trim()}>Add to transcript</button>
              <button className="btn btn-sm btn-primary flex-1" onClick={analyseManual} disabled={!manual.trim()}>
                Add & Analyze
              </button>
            </div>
          </div>
        </Panel>

        {/* Analysis */}
        <Panel title="Current analysis" actions={
          selected && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>press <span className="kbd">A</span> for latest</span>
        } bodyClass="scroll-y">
          <div className="p-2 flex flex-col gap-2">
            {!aiAvailable && <AIBanner reason="Add your API key in Settings → AI. The transcript, notes, speeches, POIs and search all work without it." />}
            {selected && (
              <div className="panel panel-2 px-2.5 py-2 text-[12px]">
                <div className="section-title mb-0.5">Selected statement</div>
                <p>{selected.text}</p>
              </div>
            )}
            {analysing && (
              <div className="p-3"><Spinner label="Analysing — target is under 10 seconds…" /></div>
            )}
            {analysis && <AnalysisCard result={analysis} />}
            {!analysing && !analysis && (
              <Empty icon="⚡" title="No analysis yet"
                hint="Click any transcript line, or type a statement and press Add & Analyze." />
            )}
          </div>
        </Panel>

        {/* Speakers list above quick actions — it is checked far more often */}
        <div className="flex flex-col gap-2 min-h-0">
          {/* Capped so a long queue scrolls inside its own panel rather than
              pushing Quick actions off the bottom of the screen. */}
          <Panel title="Speakers list" className="shrink-0 max-h-[60%]" bodyClass="scroll-y">
            <SpeakersList
              sessionId={session.id}
              ourCountry={status?.committee?.country ?? 'Your delegation'}
              ourCode={status?.committee?.countryCode ?? ''}
              speakingSeconds={speakingSeconds}
              currentElapsed={timer.seconds}
              reloadKey={speakersEpoch}
              onFloorChange={handleFloorChange}
            />
          </Panel>

        <Panel title="Quick actions" className="flex-1 min-h-0" bodyClass="scroll-y">
          <div className="p-2 flex flex-col gap-1.5">
            <button className="btn" onClick={() => navigate('/speeches')}>🎤 Speech</button>
            <button className="btn" onClick={() => navigate('/pois')}>❓ POI</button>
            <button className="btn" onClick={() => navigate('/research')}>🔎 Search</button>
            <button className="btn" onClick={() => navigate('/notes?new=1')}>📝 Note</button>
            <button className="btn" onClick={() => navigate('/resolution')}>🧾 Resolution</button>
            <button className="btn" onClick={() => navigate('/countries')}>⚑ Defense</button>
            <button className="btn" onClick={() => navigate('/motions')}>⚖ Procedure</button>

            <div className="section-title mt-2 mb-0.5">Alert sensitivity</div>
            <select className="select" value={sensitivity} onChange={(e) => saveSetting('alertSensitivity', e.target.value)}>
              <option value="low">Low — only strong signals</option>
              <option value="medium">Medium (default)</option>
              <option value="high">High — alert often</option>
            </select>

            <div className="section-title mt-2 mb-0.5">Session</div>
            <button className="btn btn-sm" onClick={async () => {
              const data = await api.exportSession(session.id).catch(() => null)
              if (!data) { toast('Export failed', 'bad'); return }
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
              const a = document.createElement('a')
              a.href = URL.createObjectURL(blob)
              a.download = `mun-session-${session.id}.json`
              a.click(); URL.revokeObjectURL(a.href)
              toast('Session exported', 'good')
            }}>Export session</button>
            <button className="btn btn-sm" onClick={async () => {
              // Stop listening first. Without this the microphone stays open with
              // no RECORDING indicator anywhere on screen, and every utterance it
              // still hears is silently dropped by commitSegment's session guard —
              // recording someone with nothing to show for it.
              stopListening()
              await api.patch(`/api/sessions/${session.id}`, { end: true }).catch(() => {})
              setSession(null); toast('Session ended', 'good')
            }}>End session</button>

            <div className="section-title mt-2 mb-0.5">Speaking time</div>
            <select className="select" value={speakingSeconds}
              onChange={(e) => saveSetting('speakingSeconds', Number(e.target.value))}>
              {[30, 45, 60, 90, 120].map((s) => <option key={s} value={s}>{s}s per speaker</option>)}
            </select>
          </div>
        </Panel>
        </div>
      </div>

      {/* Consent gate — recording is never silent */}
      <Modal open={consentOpen} onClose={() => setConsentOpen(false)} title="Before you start listening">
        <div className="flex flex-col gap-3 text-[13px]">
          <p>
            This will use your microphone to transcribe what is said in the room. A red{' '}
            <span className="chip" style={{ color: 'var(--color-bad)', borderColor: 'var(--color-bad)' }}>● RECORDING</span>{' '}
            indicator stays visible the whole time, and you can pause or stop at any moment.
          </p>
          <div className="panel panel-2 p-3" style={{ borderColor: 'var(--color-warn)' }}>
            <div className="section-title mb-1" style={{ color: 'var(--color-warn)' }}>
              Your microphone audio leaves this computer
            </div>
            <p style={{ color: 'var(--muted)' }}>
              Transcription uses your browser's speech recognition. In Chrome and Edge that runs on
              Google's servers, not on this machine — so while you are listening, the audio from the
              room is sent to Google to be turned into text. That is also why it needs internet.
            </p>
            <p className="mt-2" style={{ color: 'var(--muted)' }}>
              Choose <b>Manual entry only</b> in Settings to send nothing anywhere and type what was
              said instead.
            </p>
          </div>
          <div className="panel panel-2 p-3" style={{ borderColor: 'var(--color-warn)' }}>
            <div className="section-title mb-1" style={{ color: 'var(--color-warn)' }}>Your responsibility</div>
            <p style={{ color: 'var(--muted)' }}>
              Recording and transcription are subject to your conference's rules and to applicable
              law, which in many places requires the consent of the people being recorded. Obtain any
              permission that is required before recording in the committee room. If in doubt, ask the
              Chair, and use manual transcript entry instead.
            </p>
          </div>
          <ul className="flex flex-col gap-1" style={{ color: 'var(--muted)' }}>
            <li>• The transcript text and your notes stay on this computer.</li>
            <li>• Audio is streamed to the browser's speech service while listening.</li>
            <li>• No audio file is ever saved or uploaded by this app.</li>
            <li>• You can delete any line, or the whole session, at any time.</li>
          </ul>
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={() => {
              saveSetting('recordingConsentAck', true); setConsentOpen(false); startListening()
            }}>I understand — start listening</button>
            <button className="btn" onClick={() => setConsentOpen(false)}>Cancel</button>
          </div>
        </div>
      </Modal>

      {/* Speaker renaming */}
      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} title="Rename speaker">
        <div className="flex flex-col gap-2.5">
          <select className="select" value={renaming || ''} onChange={(e) => setRenaming(e.target.value)}>
            {distinctSpeakers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div className="section-title">Rename every line from this speaker to</div>
          {/* Was six fixed buttons, one of which literally renamed the speaker
              to "Other". Any delegation can hold the floor, so this takes a name. */}
          <input className="input" list="speaker-options" autoFocus placeholder="Type a country or name…"
            value={renameTo} onChange={(e) => setRenameTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') applyRename() }} />
          <div className="flex flex-wrap gap-1.5">
            {quickPicks.map((name) => (
              <button key={name} className="btn btn-sm" onClick={() => setRenameTo(name)}>{name}</button>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button className="btn btn-primary flex-1" disabled={!renameTo.trim()} onClick={applyRename}>
              Rename every line
            </button>
            <button className="btn" onClick={() => setRenaming(null)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
