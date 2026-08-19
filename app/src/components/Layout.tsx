import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useApp } from '../lib/store'
import { useShortcuts, SHORTCUTS } from '../lib/shortcuts'
import { Palette } from './Palette'
import { Toasts, Modal, Kbd, useTimer, TimerDisplay } from './ui'
import { SourceViewer } from './SourceViewer'
import { ContextPanel } from './ContextPanel'

const NAV = [
  { to: '/', label: 'Dashboard', key: 'G', icon: '▣' },
  { to: '/live', label: 'Live Room', key: 'L', icon: '◉' },
  { to: '/speeches', label: 'Speeches', key: 'S', icon: '❝' },
  { to: '/pois', label: 'POIs & Q&A', key: 'P', icon: '?' },
  { to: '/research', label: 'Research', key: 'R', icon: '⌕' },
  { to: '/countries', label: 'Countries', key: 'C', icon: '⚑' },
  { to: '/resolution', label: 'Draft Resolution', key: 'D', icon: '§' },
  { to: '/notes', label: 'Notes', key: 'N', icon: '✎' },
  { to: '/motions', label: 'Motions & Rules', key: 'M', icon: '⚖' },
  { to: '/practice', label: 'Practice', key: '', icon: '⟳' },
  { to: '/settings', label: 'Settings', key: '', icon: '⚙' },
]

function Dot({ ok, title }: { ok: boolean; title: string }) {
  return (
    <span title={title} className="inline-block w-1.5 h-1.5 rounded-full"
      style={{ background: ok ? 'var(--color-good)' : 'var(--color-ink-500)' }} />
  )
}

function TopBar({ timer, onHelp }: { timer: ReturnType<typeof useTimer>; onHelp: () => void }) {
  const { status, aiAvailable, online, dbOk, session, setPalette } = useApp()
  const c = status?.committee
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => { const i = setInterval(() => setClock(new Date()), 10_000); return () => clearInterval(i) }, [])

  return (
    <header className="flex items-center gap-3 px-3 h-11 border-b shrink-0" style={{ background: 'var(--panel)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[15px]">{c?.flag ?? '🇨🇦'}</span>
        <span className="font-bold tracking-wide text-[13px]">MUN LIVE</span>
      </div>

      <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
        <span className="chip">{c?.country ?? 'Your delegation'}</span>
        <span className="chip">{c?.committee ?? 'UNGA'}</span>
        <span className="chip hidden md:inline-flex">{c?.dates ?? '14–15 Aug'}</span>
      </div>

      <button className="btn btn-sm btn-ghost ml-2 hidden lg:inline-flex" onClick={() => setPalette(true)}>
        <span style={{ color: 'var(--faint)' }}>⌕</span>
        <span style={{ color: 'var(--faint)' }}>Search everything</span>
        <Kbd>Ctrl K</Kbd>
      </button>

      <div className="flex-1" />

      {timer.running || timer.seconds > 0 ? (
        <button className="btn btn-sm" onClick={timer.toggle} title="Press T to start/stop">
          <TimerDisplay t={timer} />
          <span style={{ color: 'var(--faint)' }}>{timer.running ? '❙❙' : '▶'}</span>
        </button>
      ) : null}

      <div className="flex items-center gap-2.5 text-[11px]" style={{ color: 'var(--muted)' }}>
        {session && <span className="chip" style={{ borderColor: 'var(--color-good)' }}>SESSION LIVE</span>}
        <span className="flex items-center gap-1" title={aiAvailable ? 'AI configured' : 'AI unavailable — local knowledge base works'}>
          <Dot ok={aiAvailable} title="AI" /> AI
        </span>
        <span className="flex items-center gap-1" title={online ? 'Online' : 'Offline — documents and search still work'}>
          <Dot ok={online} title="Network" /> NET
        </span>
        <span className="flex items-center gap-1" title={dbOk ? 'Local database OK' : 'Local storage unavailable — changes may not persist'}>
          <Dot ok={dbOk} title="Database" /> DB
        </span>
        <span className="mono tabular-nums">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        <button className="btn btn-ghost btn-sm" onClick={onHelp} title="Keyboard shortcuts">?</button>
      </div>
    </header>
  )
}

function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <nav className={`shrink-0 border-r flex flex-col ${collapsed ? 'w-12' : 'w-[164px]'}`}
      style={{ background: 'var(--panel)' }}>
      <div className="flex-1 py-1.5 scroll-y">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-3 py-[7px] text-[13px] border-l-2 ${
                isActive ? 'font-medium' : ''
              }`}
            style={({ isActive }) => ({
              borderLeftColor: isActive ? 'var(--color-accent)' : 'transparent',
              background: isActive ? 'var(--panel-2)' : 'transparent',
              color: isActive ? 'var(--text)' : 'var(--muted)',
            })}
            title={collapsed ? n.label : undefined}>
            <span className="w-3.5 text-center opacity-70">{n.icon}</span>
            {!collapsed && <span className="flex-1 truncate">{n.label}</span>}
            {!collapsed && n.key && <span className="kbd">{n.key}</span>}
          </NavLink>
        ))}
      </div>
      <button className="btn btn-ghost btn-sm m-1.5 justify-center" onClick={() => setCollapsed((c) => !c)}>
        {collapsed ? '»' : '«'}
      </button>
    </nav>
  )
}

function HelpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between gap-3 py-1 border-b"
            style={{ borderColor: 'var(--line)' }}>
            <span className="text-[13px]">{s.label}</span>
            <span className="flex gap-1 shrink-0">
              {s.keys.split(' ').map((k) => <Kbd key={k}>{k}</Kbd>)}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs" style={{ color: 'var(--faint)' }}>
        Single-letter shortcuts are ignored while you are typing in a field, so they never
        interfere with note-taking.
      </p>
    </Modal>
  )
}

export function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setPalette, refreshStatus, paletteOpen } = useApp()
  const [help, setHelp] = useState(false)
  const timer = useTimer()

  useEffect(() => { refreshStatus() }, [refreshStatus])
  // Keep status fresh, but cheaply — this is a local call.
  useEffect(() => { const i = setInterval(refreshStatus, 30_000); return () => clearInterval(i) }, [refreshStatus])

  useShortcuts({
    'mod+k': (e) => { e.preventDefault(); setPalette(true) },
    escape: () => { setPalette(false); setHelp(false) },
    g: () => navigate('/'),
    l: () => navigate('/live'),
    s: () => navigate('/speeches'),
    p: () => navigate('/pois'),
    r: () => navigate('/research'),
    c: () => navigate('/countries'),
    d: () => navigate('/resolution'),
    n: () => navigate('/notes'),
    m: () => navigate('/motions'),
    t: () => (timer.running || timer.seconds > 0 ? timer.toggle() : timer.start()),
    '?': () => setHelp((h) => !h),
  }, [navigate, setPalette, timer.running, timer.seconds])

  // The Live Room and Speech view use the full width — no right panel.
  const fullWidth = ['/live', '/speeches'].some((p) => location.pathname.startsWith(p))

  return (
    <div className="h-full flex flex-col">
      <TopBar timer={timer} onHelp={() => setHelp(true)} />
      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 scroll-y">
          <Outlet context={{ timer }} />
        </main>
        {!fullWidth && <ContextPanel timer={timer} />}
      </div>
      {paletteOpen && <Palette />}
      <HelpModal open={help} onClose={() => setHelp(false)} />
      <SourceViewer />
      <Toasts />
    </div>
  )
}
