import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Badge, Spinner, AIBanner } from '../components/ui'

const QUICK = [
  { icon: '🎤', label: 'Speech', to: '/speeches', hint: 'S' },
  { icon: '⚡', label: 'Respond', to: '/live?focus=respond', hint: 'L' },
  { icon: '❓', label: 'Find POI', to: '/pois', hint: 'P' },
  { icon: '🔎', label: 'Search Research', to: '/research', hint: 'R' },
  { icon: '📝', label: 'Add Note', to: '/notes?new=1', hint: 'N' },
  { icon: '🧾', label: 'Draft Clause', to: '/resolution', hint: 'D' },
  { icon: '⏱️', label: 'Caucus Timer', to: '/live', hint: 'T' },
  { icon: '🎧', label: 'Live Listening', to: '/live?listen=1', hint: '' },
]

export function Dashboard() {
  const navigate = useNavigate()
  const { status, session, aiAvailable, startSession, toast } = useApp()
  const [priorities, setPriorities] = useState<any[]>([])
  const [events, setEvents] = useState<any[]>([])
  const [analyses, setAnalyses] = useState<any[]>([])
  const [newPriority, setNewPriority] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => {
    Promise.all([
      api.priorities().catch(() => []),
      api.events(12).catch(() => []),
      api.analyses(4).catch(() => []),
    ]).then(([p, e, a]) => { setPriorities(p); setEvents(e); setAnalyses(a) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const togglePriority = async (p: any) => {
    setPriorities((prev) => prev.map((x) => (x.id === p.id ? { ...x, done: p.done ? 0 : 1 } : x)))
    await api.patch(`/api/priorities/${p.id}`, { done: !p.done }).catch(() => {})
  }

  const addPriority = async () => {
    const text = newPriority.trim()
    if (!text) return
    setNewPriority('')
    const created = await api.post<any>('/api/priorities', { text }).catch(() => null)
    if (created) setPriorities((p) => [...p, created])
  }

  const c = status?.committee

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1100px]">
      {/* Committee status */}
      <Panel title="Committee status" actions={
        session ? (
          <button className="btn btn-sm" onClick={() => navigate('/live')}>Open Live Room</button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={async () => {
            await startSession(); navigate('/live')
          }}>Start session</button>
        )
      }>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ background: 'var(--line)' }}>
          <Stat label="Country" value={`${c?.flag ?? ''} ${c?.country ?? 'Your delegation'}`} />
          <Stat label="Committee" value={c?.committee ?? 'UNGA'} />
          <Stat label="Conference" value={c?.conference ?? 'RPSIS MUN 2026'} />
          <Stat label="Dates" value={c?.dates ?? '14–15 August 2026'} />
          <Stat label="Session" value={session ? String(session.phase).replace(/_/g, ' ') : 'Not started'} wide />
          <Stat label="Current topic" value={session?.topic || '—'} wide />
        </div>
        <div className="px-3 py-2 border-t text-[12px]" style={{ color: 'var(--muted)' }}>
          <span className="section-title">Agenda</span>
          <div className="mt-0.5">{c?.agenda}</div>
        </div>
      </Panel>

      {!aiAvailable && (
        <AIBanner reason="Add your Anthropic API key in Settings → AI to enable AI analysis. Everything else is ready now." />
      )}

      {/* Quick actions */}
      <Panel title="Quick actions">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px" style={{ background: 'var(--line)' }}>
          {QUICK.map((q) => (
            <button key={q.label} onClick={() => navigate(q.to)}
              className="flex flex-col items-center gap-1 py-4 px-2"
              style={{ background: 'var(--panel)' }}>
              <span className="text-xl">{q.icon}</span>
              <span className="text-[12px] font-medium">{q.label}</span>
              {q.hint && <span className="kbd">{q.hint}</span>}
            </button>
          ))}
        </div>
      </Panel>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Priorities */}
        <Panel title="Today's priorities">
          <div className="divide-line">
            {priorities.map((p) => (
              <label key={p.id} className="flex items-start gap-2.5 px-3 py-2 cursor-pointer text-[13px]">
                <input type="checkbox" checked={Boolean(p.done)} onChange={() => togglePriority(p)}
                  className="mt-0.5 accent-[var(--color-accent)]" />
                <span style={{
                  color: p.done ? 'var(--faint)' : 'var(--text)',
                  textDecoration: p.done ? 'line-through' : 'none',
                }}>{p.text}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-1.5 p-2 border-t">
            <input className="input" placeholder="Add a priority…" value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPriority()} />
            <button className="btn" onClick={addPriority}>Add</button>
          </div>
        </Panel>

        {/* Recent activity */}
        <Panel title="Recent activity" actions={
          <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        }>
          {loading ? (
            <div className="p-4"><Spinner label="Loading…" /></div>
          ) : events.length ? (
            <div className="divide-line max-h-[280px] scroll-y">
              {events.map((e) => (
                <div key={e.id} className="px-3 py-1.5 flex items-baseline gap-2 text-[12px]">
                  <span className="mono shrink-0" style={{ color: 'var(--faint)' }}>
                    {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="chip shrink-0">{e.type}</span>
                  <span className="truncate">{e.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="No activity yet" hint="Import documents, take a note, or start a session." />
          )}
        </Panel>
      </div>

      {/* Recent AI responses */}
      {analyses.length > 0 && (
        <Panel title="Recent AI analyses">
          <div className="divide-line">
            {analyses.map((a) => (
              <div key={a.id} className="px-3 py-2 text-[12px]">
                <div className="flex items-center gap-2 mb-0.5">
                  <Badge kind="AI" />
                  <span className="chip">{a.kind}</span>
                  <span className="chip">{a.confidence}</span>
                  <span style={{ color: 'var(--faint)' }}>{a.latency_ms}ms</span>
                </div>
                <div className="line-clamp-2" style={{ color: 'var(--muted)' }}>{a.input_text}</div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Readiness */}
      <Panel title="Pre-competition checklist">
        <div className="divide-line text-[13px]">
          <Check ok={(status?.counts?.documents ?? 0) > 0}
            label={`Documents imported (${status?.counts?.documents ?? 0} files, ${status?.counts?.chunks ?? 0} passages)`}
            action={() => navigate('/research')} actionLabel="Import" />
          <Check ok={(status?.counts?.speeches ?? 0) > 0}
            label={`Speeches ready (${status?.counts?.speeches ?? 0})`}
            action={() => navigate('/speeches')} actionLabel="Open" />
          <Check ok={(status?.counts?.pois ?? 0) > 0}
            label={`POIs ready (${status?.counts?.pois ?? 0})`}
            action={() => navigate('/pois')} actionLabel="Open" />
          <Check ok={Boolean(status?.semantic?.built)}
            label="Semantic index built (optional — do this before the 14th, while online)"
            action={() => navigate('/settings')} actionLabel="Settings" />
          <Check ok={aiAvailable} label="AI connection configured (optional)"
            action={() => navigate('/settings')} actionLabel="Settings" />
          <Check ok={Boolean(status?.db?.ok)} label="Local database writable" />
        </div>
      </Panel>
    </div>
  )
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`px-3 py-2 ${wide ? 'col-span-2' : ''}`} style={{ background: 'var(--panel)' }}>
      <div className="section-title">{label}</div>
      <div className="text-[13px] mt-0.5 truncate capitalize" title={value}>{value}</div>
    </div>
  )
}

function Check({ ok, label, action, actionLabel }: {
  ok: boolean; label: string; action?: () => void; actionLabel?: string
}) {
  return (
    <div className="px-3 py-2 flex items-center gap-2.5">
      <span style={{ color: ok ? 'var(--color-good)' : 'var(--color-ink-500)' }}>{ok ? '✓' : '○'}</span>
      <span className="flex-1" style={{ color: ok ? 'var(--text)' : 'var(--muted)' }}>{label}</span>
      {!ok && action && <button className="btn btn-sm" onClick={action}>{actionLabel}</button>}
    </div>
  )
}
