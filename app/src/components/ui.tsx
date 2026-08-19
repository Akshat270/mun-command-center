import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../lib/store'
import { api } from '../lib/api'
import { pushOverlay } from '../lib/shortcuts'

// ───────────────────────────────────────────────────────────── primitives

/**
 * `<option>` elements for every delegation the user has researched, read from
 * the countries table.
 *
 * These lists used to be four hardcoded `<option>` tags naming one committee's
 * countries, repeated in three places — which meant a delegate in any other
 * committee could not file a note or a document against their own delegation
 * without editing the source. Sharing one component also keeps the three lists
 * from drifting apart.
 *
 * The fetch is deliberately unguarded: on failure the select degrades to just
 * its fixed options, which is correct — a country filter that cannot load is
 * not worth an error state in the middle of a committee session.
 */
export function CountryOptions() {
  const [countries, setCountries] = useState<any[]>([])
  useEffect(() => { api.countries().then((c) => setCountries(c || [])).catch(() => {}) }, [])
  return (
    <>
      {countries.map((c) => (
        <option key={c.code} value={c.code}>{c.name}</option>
      ))}
    </>
  )
}

export function Panel({ title, actions, children, className = '', bodyClass = '' }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string
}) {
  return (
    <section className={`panel flex flex-col min-h-0 min-w-0 ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-x-3 gap-y-1.5 flex-wrap px-3 py-2 border-b shrink-0">
          {/* shrink-0, not flex-1: the title must keep its width and push the
              actions onto a second line when they no longer fit. Letting it
              shrink instead collapsed it to a single character per line and
              rendered the heading vertically down the side of the panel. */}
          <h2 className="section-title shrink-0 max-w-full truncate leading-[1.35]">{title}</h2>
          {actions && <div className="flex flex-1 items-center justify-end gap-1.5 flex-wrap min-w-0">{actions}</div>}
        </header>
      )}
      <div className={`min-h-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  )
}

export function Empty({ icon = '—', title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-10 px-6 text-center">
      <div className="text-2xl opacity-30">{icon}</div>
      <div className="text-[13px]" style={{ color: 'var(--muted)' }}>{title}</div>
      {hint && <div className="text-xs max-w-sm" style={{ color: 'var(--faint)' }}>{hint}</div>}
    </div>
  )
}

export function Badge({ kind }: { kind: string }) {
  return <span className={`chip badge-${kind}`}>{kind}</span>
}

/** Source priority: 1 competition · 2 official · 3 research · 4 AI. */
export function PriorityChip({ priority, verified }: { priority: number; verified?: boolean }) {
  const label = { 1: 'COMPETITION', 2: 'OFFICIAL', 3: 'RESEARCH', 4: 'AI' }[priority] || 'RESEARCH'
  return (
    <span className={`chip prio-${priority}`} title={`Source priority ${priority}`}>
      {verified ? '✓ ' : ''}{label}
    </span>
  )
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
      <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
      {label}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>
}

// ───────────────────────────────────────────────────── AI unavailable banner

export function AIBanner({ reason }: { reason?: string }) {
  const online = useApp((s) => s.online)
  return (
    <div className="panel panel-2 px-3 py-2 text-[13px] flex items-start gap-2"
      style={{ borderColor: 'var(--color-warn)' }}>
      <span style={{ color: 'var(--color-warn)' }}>▲</span>
      <div>
        <div style={{ color: 'var(--color-warn)' }} className="font-medium">
          {online ? 'AI unavailable' : 'Offline'} — local knowledge base remains available
        </div>
        <div style={{ color: 'var(--muted)' }} className="mt-0.5">
          {reason || 'Search, speeches, POIs, countries, notes, timers, procedure and the resolution editor all still work.'}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────── modal

export function Modal({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    // Registering as an overlay stops bare-letter navigation shortcuts firing
    // behind the dialog and discarding whatever is being typed in it.
    const release = pushOverlay()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); release() }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh] px-4"
      style={{ background: '#000a' }} onMouseDown={onClose}>
      <div className={`panel fade-in w-full ${wide ? 'max-w-4xl' : 'max-w-2xl'} max-h-[82vh] flex flex-col`}
        onMouseDown={(e) => e.stopPropagation()}>
        {title && (
          <header className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Esc</button>
          </header>
        )}
        <div className="scroll-y p-4 min-h-0">{children}</div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────── toasts

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  if (!toasts.length) return null
  const tone: Record<string, string> = {
    info: 'var(--color-signal)', good: 'var(--color-good)',
    warn: 'var(--color-warn)', bad: 'var(--color-bad)',
  }
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <button key={t.id} onClick={() => dismissToast(t.id)}
          className="panel fade-in px-3 py-2 text-left text-[13px]"
          style={{ borderColor: tone[t.tone] }}>
          {t.text}
        </button>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────── copy-to-clipboard

export function CopyButton({ text, label = 'Copy', className = 'btn btn-sm' }: {
  text: string; label?: string; className?: string
}) {
  const [done, setDone] = useState(false)
  const toast = useApp((s) => s.toast)
  return (
    <button className={className} onClick={async () => {
      try {
        await navigator.clipboard.writeText(text)
        setDone(true); setTimeout(() => setDone(false), 1400)
      } catch { toast('Could not copy — select the text manually.', 'warn') }
    }}>{done ? '✓ Copied' : label}</button>
  )
}

// ───────────────────────────────────────────────────────── inline editing

export function InlineEdit({ value, onSave, multiline, placeholder, className = '' }: {
  value: string; onSave: (v: string) => void; multiline?: boolean; placeholder?: string; className?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  const commit = () => { setEditing(false); if (draft !== value) onSave(draft) }

  if (!editing) {
    return (
      <div className={`cursor-text whitespace-pre-wrap ${className}`} onClick={() => setEditing(true)}
        title="Click to edit">
        {value || <span style={{ color: 'var(--faint)' }}>{placeholder || 'Click to add…'}</span>}
      </div>
    )
  }
  const Tag: any = multiline ? 'textarea' : 'input'
  return (
    <Tag ref={ref} className={multiline ? 'textarea' : 'input'} value={draft}
      onChange={(e: any) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e: any) => {
        if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) commit()
      }} />
  )
}

// ────────────────────────────────────────────────────────────── timer

export function useTimer() {
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [limit, setLimit] = useState<number | null>(null)
  const ref = useRef<number | null>(null)

  useEffect(() => {
    if (!running) return
    ref.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => { if (ref.current) window.clearInterval(ref.current) }
  }, [running])

  const start = (secs?: number) => { setSeconds(0); setLimit(secs ?? null); setRunning(true) }
  const toggle = () => setRunning((r) => !r)
  const reset = () => { setRunning(false); setSeconds(0) }

  const remaining = limit != null ? Math.max(0, limit - seconds) : null
  const overrun = limit != null && seconds > limit

  return { seconds, running, limit, remaining, overrun, start, toggle, reset, setLimit }
}

export const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`

export function TimerDisplay({ t, big }: { t: ReturnType<typeof useTimer>; big?: boolean }) {
  const value = t.remaining != null ? t.remaining : t.seconds
  const colour = t.overrun ? 'var(--color-bad)'
    : t.remaining != null && t.remaining <= 10 ? 'var(--color-warn)'
    : 'var(--text)'
  return (
    <span className={`mono tabular-nums font-semibold ${big ? 'text-5xl' : 'text-lg'}`}
      style={{ color: colour, fontFamily: 'var(--font-mono)' }}>
      {t.overrun ? '+' : ''}{fmtTime(t.overrun ? t.seconds - (t.limit || 0) : value)}
    </span>
  )
}
