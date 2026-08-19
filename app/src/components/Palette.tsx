// Ctrl+K global search. Searches every record type at once and never touches
// the network — this is the fastest path to any prepared material.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { pushOverlay } from '../lib/shortcuts'

type Group = { label: string; kind: string; items: any[] }

const ROUTE: Record<string, (item: any) => string> = {
  document: (i) => `/research?doc=${i.documentId}&chunk=${i.chunkId}`,
  speech: (i) => `/speeches?id=${i.id}`,
  poi: (i) => `/pois?id=${i.id}`,
  qa: (i) => `/pois?tab=qa&id=${i.id}`,
  country: (i) => `/countries/${i.code}`,
  note: (i) => `/notes?id=${i.id}`,
  procedure: (i) => `/motions?id=${i.id}`,
  clause: (i) => `/resolution?clause=${i.id}`,
  clause_idea: () => `/resolution?tab=library`,
  transcript: (i) => `/live?segment=${i.id}`,
}

function itemTitle(kind: string, item: any): string {
  switch (kind) {
    case 'document': return item.documentTitle
    case 'speech': return item.title
    case 'poi': return item.question
    case 'qa': return item.question
    case 'country': return `${item.flag || ''} ${item.name}`
    case 'note': return item.body
    case 'procedure': return item.title
    case 'clause': return `${item.kind}${item.ordinal + 1}. ${item.opener || ''} ${item.text}`
    case 'clause_idea': return `${item.opener || ''} ${item.text}`
    case 'transcript': return `${item.country || item.speaker}: ${item.text}`
    default: return String(item.title || item.name || '')
  }
}

function itemSub(kind: string, item: any): string {
  switch (kind) {
    case 'document': return `${item.category} · ${item.pageLabel}${item.heading ? ` · ${item.heading}` : ''}`
    case 'speech': return `${item.category}${item.duration_s ? ` · ${item.duration_s}s` : ''}`
    case 'poi': return `Target: ${item.target_country}${item.topic ? ` · ${item.topic}` : ''}`
    case 'qa': return item.kind === 'rapid_response' ? 'Rapid response' : 'Likely question to us'
    case 'country': return item.identity || ''
    case 'note': return item.badge
    case 'procedure': return `${item.topic} · ${item.source === 'RPS_CONFIRMED' ? 'RPS confirmed' : 'General practice'}`
    case 'clause': return item.resolution || ''
    case 'clause_idea': return item.topic || ''
    case 'transcript': return item.classification || ''
    default: return ''
  }
}

export function Palette() {
  const { paletteOpen, setPalette } = useApp()
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState<Group[]>([])
  const [meta, setMeta] = useState<{ took: number; mode?: string } | null>(null)
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  const flat = useMemo(
    () => groups.flatMap((g) => g.items.map((item) => ({ kind: g.kind, item }))),
    [groups]
  )

  useEffect(() => {
    if (!paletteOpen) { setQ(''); setGroups([]); setMeta(null); return }
    setTimeout(() => inputRef.current?.focus(), 10)
    setCursor(0)
    return pushOverlay()
  }, [paletteOpen])

  // Debounced so typing stays responsive on a laptop under load.
  useEffect(() => {
    if (!paletteOpen) return
    if (q.trim().length < 2) { setGroups([]); setMeta(null); return }
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.globalSearch(q)
        setGroups(res.groups || [])
        setMeta({ took: res.took, mode: res.mode })
        setCursor(0)
      } catch {
        setGroups([])
      } finally { setLoading(false) }
    }, 130)
    return () => clearTimeout(t)
  }, [q, paletteOpen])

  const go = (entry: { kind: string; item: any }) => {
    const to = ROUTE[entry.kind]?.(entry.item)
    if (to) navigate(to)
    setPalette(false)
  }

  if (!paletteOpen) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[10vh] px-4"
      style={{ background: '#000c' }} onMouseDown={() => setPalette(false)}>
      <div className="panel fade-in w-full max-w-2xl flex flex-col max-h-[72vh]"
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
          <span style={{ color: 'var(--faint)' }}>⌕</span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything — documents, speeches, POIs, countries, notes, clauses…"
            className="flex-1 bg-transparent outline-none text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setPalette(false) }
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, flat.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
              if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); go(flat[cursor]) }
            }} />
          {loading && <span className="text-xs" style={{ color: 'var(--faint)' }}>…</span>}
          <span className="kbd">Esc</span>
        </div>

        <div className="scroll-y min-h-0 flex-1">
          {q.trim().length < 2 ? (
            <div className="px-4 py-6 text-[13px]" style={{ color: 'var(--faint)' }}>
              Try <code className="mono">Article 17</code>, <code className="mono">Five Eyes</code>,{' '}
              <code className="mono">metadata</code>, <code className="mono">transfer parity</code>,{' '}
              <code className="mono">Pegasus</code>, <code className="mono">present and voting</code>
            </div>
          ) : !groups.length && !loading ? (
            <div className="px-4 py-6 text-[13px]" style={{ color: 'var(--faint)' }}>
              No results for “{q}”. Nothing in the knowledge base matches — try a different term.
            </div>
          ) : (
            groups.map((g) => {
              let idx = flat.findIndex((f) => f.kind === g.kind)
              return (
                <div key={g.kind}>
                  <div className="px-3 pt-2.5 pb-1 section-title sticky top-0"
                    style={{ background: 'var(--panel)' }}>{g.label}</div>
                  {g.items.map((item, i) => {
                    const active = idx + i === cursor
                    return (
                      <button key={item.id || item.code || item.chunkId || i}
                        className="w-full text-left px-3 py-2 flex flex-col gap-0.5"
                        style={{ background: active ? 'var(--panel-2)' : 'transparent' }}
                        onMouseEnter={() => setCursor(idx + i)}
                        onClick={() => go({ kind: g.kind, item })}>
                        <div className="text-[13px] line-clamp-2">{itemTitle(g.kind, item)}</div>
                        <div className="text-[11px] flex items-center gap-2" style={{ color: 'var(--faint)' }}>
                          {g.kind === 'document' && <span className={`chip prio-${item.priority}`}>P{item.priority}</span>}
                          <span className="truncate">{itemSub(g.kind, item)}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>

        {meta && (
          <div className="px-3 py-1.5 border-t text-[11px] flex items-center justify-between shrink-0"
            style={{ color: 'var(--faint)' }}>
            <span>{flat.length} results · {meta.took}ms · {meta.mode}</span>
            <span className="flex gap-1.5 items-center">
              <span className="kbd">↑↓</span> navigate <span className="kbd">↵</span> open
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
