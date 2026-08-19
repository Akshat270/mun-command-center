// Right-hand quick context: current topic, timer, pinned facts, recent activity.
// Always visible except in the Live Room and the speech view, which use the
// full width.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Badge, TimerDisplay, type useTimer } from './ui'

const CAUCUS_PRESETS = [
  { label: '30s', s: 30 }, { label: '45s', s: 45 }, { label: '60s', s: 60 },
  { label: '90s', s: 90 }, { label: '10m', s: 600 }, { label: '15m', s: 900 },
]

export function ContextPanel({ timer }: { timer: ReturnType<typeof useTimer> }) {
  const { session, status } = useApp()
  const navigate = useNavigate()
  const [pinned, setPinned] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [open, setOpen] = useState(true)

  const refresh = () => {
    api.notes().then((n) => setPinned(n.filter((x: any) => x.pinned).slice(0, 5))).catch(() => {})
    api.events(8).then(setEvents).catch(() => {})
  }
  useEffect(() => { refresh(); const i = setInterval(refresh, 20_000); return () => clearInterval(i) }, [])

  if (!open) {
    return (
      <button className="w-8 shrink-0 border-l flex items-start justify-center pt-3"
        style={{ background: 'var(--panel)', color: 'var(--faint)' }}
        onClick={() => setOpen(true)} title="Show quick context">«</button>
    )
  }

  return (
    <aside className="w-[248px] shrink-0 border-l flex flex-col scroll-y"
      style={{ background: 'var(--panel)' }}>
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="section-title">Quick context</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} title="Collapse">»</button>
      </div>

      {/* Timer */}
      <div className="px-3 py-2.5 border-b">
        <div className="flex items-center justify-between mb-1.5">
          <span className="section-title">Timer</span>
          <TimerDisplay t={timer} />
        </div>
        <div className="flex flex-wrap gap-1">
          {CAUCUS_PRESETS.map((p) => (
            <button key={p.label} className="btn btn-sm" onClick={() => timer.start(p.s)}>{p.label}</button>
          ))}
        </div>
        <div className="flex gap-1 mt-1">
          <button className="btn btn-sm flex-1" onClick={timer.toggle}>
            {timer.running ? 'Pause' : 'Start'}
          </button>
          <button className="btn btn-sm flex-1" onClick={timer.reset}>Reset</button>
        </div>
      </div>

      {/* Session state */}
      <div className="px-3 py-2.5 border-b">
        <div className="section-title mb-1.5">Committee</div>
        {session ? (
          <div className="flex flex-col gap-1 text-[12px]">
            <Row label="Phase" value={String(session.phase || '—').replace(/_/g, ' ')} />
            {session.topic && <Row label="Topic" value={session.topic} />}
            {session.caucus_type && <Row label="Caucus" value={session.caucus_type} />}
            {session.current_speaker && <Row label="Speaker" value={session.current_speaker} />}
            {session.roll_call && <Row label="Roll call" value={session.roll_call} />}
          </div>
        ) : (
          <button className="btn btn-sm w-full" onClick={() => navigate('/live')}>
            Open Live Room to start
          </button>
        )}
      </div>

      {/* Pinned facts */}
      <div className="px-3 py-2.5 border-b">
        <div className="flex items-center justify-between mb-1.5">
          <span className="section-title">Pinned</span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/notes')}>All</button>
        </div>
        {pinned.length ? (
          <div className="flex flex-col gap-1.5">
            {pinned.map((n) => (
              <div key={n.id} className="text-[12px] leading-snug">
                <Badge kind={n.badge} />
                <div className="mt-0.5 line-clamp-3" style={{ color: 'var(--muted)' }}>{n.body}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px]" style={{ color: 'var(--faint)' }}>
            Nothing pinned. Pin a note to keep it here during committee.
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="px-3 py-2.5 flex-1">
        <div className="section-title mb-1.5">Recent activity</div>
        {events.length ? (
          <div className="flex flex-col gap-1">
            {events.map((e) => (
              <div key={e.id} className="text-[11px] flex gap-1.5" style={{ color: 'var(--faint)' }}>
                <span className="mono shrink-0">
                  {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="truncate" title={e.label}>{e.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[12px]" style={{ color: 'var(--faint)' }}>No activity yet.</div>
        )}
      </div>

      <div className="px-3 py-2 border-t text-[11px]" style={{ color: 'var(--faint)' }}>
        {status?.counts?.documents ?? 0} docs · {status?.counts?.chunks ?? 0} passages indexed
      </div>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-14" style={{ color: 'var(--faint)' }}>{label}</span>
      <span className="truncate capitalize" title={value}>{value}</span>
    </div>
  )
}
