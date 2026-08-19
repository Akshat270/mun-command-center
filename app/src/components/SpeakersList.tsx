// The chair's General Speakers List.
//
// This exists to answer one question, continuously, without being asked:
// *how long until it is my turn*. Everything else here is in service of that
// number staying correct — which is why the queue lives on the server and
// survives a reload, and why advancing is a single keystroke.
//
// It is also what makes the transcript attribute itself: the Live Room follows
// the current speaker, so recorded lines land against the right delegation
// without anyone typing a name mid-debate.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../lib/api'
import { findMemberState } from '../lib/member-states'
import { fmtTime } from './ui'

export type Speaker = {
  id: string
  name: string
  country_code: string | null
  ordinal: number
  status: 'waiting' | 'speaking' | 'done' | 'skipped'
  seconds: number | null
}

type Props = {
  sessionId: string
  /** Our own delegation, so "you are 4th" can be worked out. */
  ourCountry: string
  ourCode: string
  speakingSeconds: number
  /**
   * Seconds the current speaker has been going, from the Live Room's speech
   * timer. Used only for the "how long until my turn" estimate, which otherwise
   * ignores the speech actually in progress and reads 0:00 at the head of the
   * queue. Recorded durations do not come from here — the server measures those
   * from started_at, so they cannot depend on a timer that a reload reset.
   */
  currentElapsed?: number
  /** Bumped by the Live Room when it advances the floor by keyboard. */
  reloadKey?: number
  /** Raised whenever the floor changes, so the Live Room can follow along. */
  onFloorChange?: (current: Speaker | null, next: Speaker | null) => void
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th". */
function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const STATUS_COLOR: Record<string, string> = {
  speaking: 'var(--color-good)',
  waiting: 'var(--text)',
  done: 'var(--faint)',
  skipped: 'var(--faint)',
}

export function SpeakersList({
  sessionId, ourCountry, ourCode, speakingSeconds, currentElapsed = 0,
  reloadKey = 0, onFloorChange,
}: Props) {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!sessionId) return
    api.speakers(sessionId).then((s) => setSpeakers(Array.isArray(s) ? s : [])).catch(() => {})
  }, [sessionId])

  /**
   * Accept a mutation response only when it is actually a queue.
   *
   * Most of these endpoints answer with the rebuilt list, but not all of them
   * always do — deleting a speaker that is already gone answers `{ ok: true }`,
   * which is reachable by double-clicking ×. Assigning that to state made
   * `speakers.map` throw and took the whole Live Room down with it, mid-session.
   * Anything unexpected resyncs from the server instead.
   */
  const applySpeakers = useCallback((res: unknown) => {
    if (Array.isArray(res)) setSpeakers(res as Speaker[])
    else load()
  }, [load])

  useEffect(load, [load, reloadKey])

  const current = useMemo(() => speakers.find((s) => s.status === 'speaking') ?? null, [speakers])
  const upcoming = useMemo(() => speakers.filter((s) => s.status === 'waiting'), [speakers])

  // Report the floor upward. The parent decides what changed and what to do
  // about it; sending it on every load keeps the two in step after a reorder or
  // a delete, not only after an advance.
  const reported = useRef<string>('')
  useEffect(() => {
    const key = `${current?.id ?? ''}|${upcoming[0]?.id ?? ''}`
    if (key === reported.current) return
    reported.current = key
    onFloorChange?.(current, upcoming[0] ?? null)
  }, [current, upcoming, onFloorChange])

  const isUs = useCallback(
    (s: Speaker) =>
      (s.country_code && ourCode && s.country_code === ourCode) ||
      s.name.trim().toLowerCase() === ourCountry.trim().toLowerCase(),
    [ourCode, ourCountry]
  )

  /**
   * Where we are, and roughly how long that is. The estimate counts only the
   * speakers genuinely ahead of us and is explicitly approximate — a chair who
   * takes questions blows any exact figure apart, and a number presented as
   * precise would be trusted more than it deserves.
   */
  const ourTurn = useMemo(() => {
    if (current && isUs(current)) return { speaking: true, position: 0, seconds: 0 }
    const idx = upcoming.findIndex(isUs)
    if (idx < 0) return null
    // What is left of the speech happening right now, plus a full slot for each
    // delegation ahead of us. Counting only the delegations ahead made the head
    // of the queue read "about 0:00 away" while someone was still speaking —
    // precisely the moment the number matters most.
    const remainingNow = current ? Math.max(0, speakingSeconds - currentElapsed) : 0
    return { speaking: false, position: idx + 1, seconds: idx * speakingSeconds + remainingNow }
  }, [current, upcoming, isUs, speakingSeconds, currentElapsed])

  const addSpeaker = async () => {
    const name = draft.trim()
    if (!name || busy) return
    setBusy(true)
    setDraft('')
    try {
      const match = findMemberState(name)
      applySpeakers(await api.addSpeakers({
        session_id: sessionId,
        // Store the formal name when it is a member state, so "uk" and
        // "britain" do not become two different delegations in the queue.
        name: match?.name ?? name,
        country_code: match?.code ?? null,
      }))
    } catch { /* the field keeps working; the list reloads on next change */ }
    finally { setBusy(false) }
  }

  const advance = async (back = false, seconds?: number) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await api.advanceSpeaker({ session_id: sessionId, back, seconds: seconds ?? null })
      applySpeakers(res.speakers)
    } catch { /* ignored — the queue is still on screen and still correct */ }
    finally { setBusy(false) }
  }

  const setStatus = async (id: string, status: Speaker['status']) => {
    try { applySpeakers(await api.patchSpeaker(id, { status })) } catch { /* ignored */ }
  }

  const remove = async (id: string) => {
    try { applySpeakers(await api.removeSpeaker(id)) } catch { /* ignored */ }
  }

  const move = async (id: string, delta: number) => {
    const order = speakers.map((s) => s.id)
    const i = order.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    // Optimistic: reordering under time pressure must feel instant.
    setSpeakers(order.map((sid) => speakers.find((s) => s.id === sid)!))
    try { applySpeakers(await api.reorderSpeakers({ session_id: sessionId, ids: order })) }
    catch { load() }
  }

  return (
    <div className="flex flex-col gap-1.5 p-2" data-speakers-list>
      {/* The number this whole component exists to produce. */}
      {ourTurn && (
        <div className="panel panel-2 px-2 py-1.5 text-[12px]"
          style={{ borderColor: ourTurn.speaking ? 'var(--color-good)' : 'var(--color-warn)' }}>
          {ourTurn.speaking ? (
            <b style={{ color: 'var(--color-good)' }}>You have the floor</b>
          ) : (
            <>
              <b style={{ color: 'var(--color-warn)' }}>
                {ourTurn.position === 1 ? 'You are next' : `You are ${ordinal(ourTurn.position)} in the list`}
              </b>
              <div style={{ color: 'var(--muted)' }}>
                about {fmtTime(ourTurn.seconds)} away
                <span style={{ color: 'var(--faint)' }}> · estimate</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        {/* No duration passed: the server measures it from started_at. That is
            what makes this button and the `]` shortcut record the same figure. */}
        <button className="btn btn-sm btn-primary flex-1" onClick={() => advance(false)}
          disabled={busy || !speakers.length}>Next ]</button>
        <button className="btn btn-sm" onClick={() => advance(true)} disabled={busy || !speakers.length}
          title="Step back — the chair changed their mind">[</button>
      </div>

      <input className="input" list="speaker-options" placeholder="Add to list…" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') addSpeaker() }} />

      {speakers.length === 0 ? (
        <div className="text-[11px]" style={{ color: 'var(--faint)' }}>
          Type each delegation as the chair reads the list.
        </div>
      ) : (
        <ol className="flex flex-col gap-0.5">
          {speakers.map((s, i) => {
            const done = s.status === 'done' || s.status === 'skipped'
            const position = speakers.filter((x, xi) => xi < i && x.status === 'waiting').length
            return (
              <li key={s.id}
                className="flex items-center gap-1 text-[12px] px-1 py-0.5 rounded"
                style={{
                  background: s.status === 'speaking' ? 'var(--panel-2)' : 'transparent',
                  opacity: done ? 0.45 : 1,
                }}>
                <span className="mono" style={{ color: 'var(--faint)', minWidth: 16 }}>
                  {s.status === 'speaking' ? '▶' : done ? '✓' : position + 1}
                </span>
                <span className="flex-1 truncate"
                  style={{
                    color: STATUS_COLOR[s.status],
                    fontWeight: s.status === 'speaking' || isUs(s) ? 600 : 400,
                    textDecoration: s.status === 'skipped' ? 'line-through' : 'none',
                  }}
                  title={s.name}>
                  {s.name}{isUs(s) && ' ★'}
                </span>
                {s.seconds != null && (
                  <span className="mono" style={{ color: 'var(--faint)' }}>{fmtTime(s.seconds)}</span>
                )}
                <span className="flex gap-0.5">
                  <button className="btn btn-sm px-1" title="Move up" onClick={() => move(s.id, -1)}>↑</button>
                  <button className="btn btn-sm px-1" title="Move down" onClick={() => move(s.id, 1)}>↓</button>
                  {!done && (
                    <button className="btn btn-sm px-1" title="Yielded or skipped"
                      onClick={() => setStatus(s.id, 'skipped')}>⤼</button>
                  )}
                  <button className="btn btn-sm px-1" title="Remove" onClick={() => remove(s.id)}>×</button>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
