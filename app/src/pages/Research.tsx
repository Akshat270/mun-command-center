// Research = search + the document library. Two tabs: you are either looking
// for a passage or managing what is in the knowledge base.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Spinner, PriorityChip, CopyButton, Modal, CountryOptions } from '../components/ui'

// Starting points for someone who has just imported their documents and does
// not yet know what is in them. Deliberately generic: these are the shapes of
// thing worth searching for in any committee, not one agenda's vocabulary.
const SUGGESTIONS = ['position', 'precedent', 'obligations', 'implementation',
  'oversight', 'funding', 'capacity-building', 'remedy', 'proportionality', 'timeline']

export function Research() {
  const [params] = useSearchParams()
  const { viewSource, toast } = useApp()
  const [tab, setTab] = useState<'search' | 'library'>(params.get('doc') ? 'library' : 'search')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [meta, setMeta] = useState<any>(null)
  const [searching, setSearching] = useState(false)
  const [filterCountry, setFilterCountry] = useState('')
  const [filterCategory, setFilterCategory] = useState('')

  const [docs, setDocs] = useState<any[]>([])
  const [importing, setImporting] = useState(false)
  const [scanResult, setScanResult] = useState<any>(null)
  const [editDoc, setEditDoc] = useState<any>(null)
  const [categories, setCategories] = useState<string[]>([])

  // Categories come from the server rather than a copy kept here: the list now
  // includes the delegate's own researched countries, so it cannot be a constant
  // in the frontend without going stale the moment a country is added.
  const loadDocs = () => {
    api.documents().then((d) => {
      setDocs(d.documents)
      if (Array.isArray(d.categories)) setCategories(d.categories)
    }).catch(() => {})
  }
  useEffect(loadDocs, [])

  // Debounced live search.
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setMeta(null); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await api.search(q, { limit: 30, country: filterCountry, category: filterCategory })
        setResults(res.results); setMeta({ mode: res.mode, took: res.took, aliases: res.aliases })
      } catch (e: any) { toast(e.message, 'bad') } finally { setSearching(false) }
    }, 140)
    return () => clearTimeout(t)
  }, [q, filterCountry, filterCategory])

  const runImport = async () => {
    setImporting(true)
    try {
      const res = await api.importAll()
      const s = res.summary || {}
      toast(`Import complete — ${Object.entries(s).map(([k, v]) => `${v} ${k}`).join(', ')}`, 'good')
      setScanResult(res)
      loadDocs()
    } catch (e: any) { toast(e.message, 'bad') } finally { setImporting(false) }
  }

  const patchDoc = async (doc: any, patch: Record<string, unknown>) => {
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, ...patch } : d)))
    await api.patch(`/api/documents/${doc.id}`, patch).catch(() => {})
  }

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const d of docs) {
      if (!map.has(d.category)) map.set(d.category, [])
      map.get(d.category)!.push(d)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [docs])

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 shrink-0">
        <button className="btn btn-sm"
          style={tab === 'search' ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
          onClick={() => setTab('search')}>Search</button>
        <button className="btn btn-sm"
          style={tab === 'library' ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
          onClick={() => setTab('library')}>Library ({docs.length})</button>
        <div className="flex-1" />
        <button className="btn btn-sm btn-primary" onClick={runImport} disabled={importing}>
          {importing ? 'Importing…' : 'Import documents'}
        </button>
      </div>

      {tab === 'search' ? (
        <>
          <div className="flex gap-2 shrink-0">
            <input className="input text-[15px]" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search all documents — exact terms and concepts both work…" />
            <select className="select max-w-[150px]" value={filterCountry} onChange={(e) => setFilterCountry(e.target.value)}>
              <option value="">All countries</option>
              <CountryOptions />
            </select>
            <select className="select max-w-[170px]" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {!q && (
            <div className="flex gap-1.5 flex-wrap shrink-0">
              <span className="text-[11px] self-center" style={{ color: 'var(--faint)' }}>Try:</span>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn btn-sm" onClick={() => setQ(s)}>{s}</button>
              ))}
            </div>
          )}

          {meta && (
            <div className="text-[11px] flex items-center gap-2 shrink-0" style={{ color: 'var(--faint)' }}>
              <span>{results.length} passages · {meta.took}ms · {meta.mode}</span>
              {meta.aliases?.length > 0 && (
                <span>· also searched: {meta.aliases.slice(0, 5).join(', ')}</span>
              )}
            </div>
          )}

          <div className="flex-1 min-h-0 scroll-y flex flex-col gap-2">
            {searching && !results.length && <Spinner label="Searching…" />}
            {!searching && q.length >= 2 && !results.length && (
              <Empty title={`No passages match “${q}”`}
                hint="Nothing in the imported documents contains this. Try a broader term." />
            )}
            {results.map((r) => (
              <div key={r.chunkId} className="panel p-3">
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap text-[11px]">
                  <PriorityChip priority={r.priority} verified={r.verified} />
                  <span className="chip">{r.category}</span>
                  {r.country && <span className="chip">{r.country}</span>}
                  <span style={{ color: 'var(--faint)' }}>{r.documentTitle}</span>
                  <span style={{ color: 'var(--faint)' }}>· {r.pageLabel}</span>
                  {r.heading && <span style={{ color: 'var(--faint)' }}>· {r.heading}</span>}
                  <div className="flex-1" />
                  <button className="btn btn-sm" onClick={() => viewSource(r.chunkId)}>View source</button>
                  <CopyButton text={r.text} label="Copy" />
                </div>
                <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{r.snippet}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 scroll-y flex flex-col gap-3">
          {scanResult && (
            <Panel title="Last import">
              <div className="divide-line text-[12px] max-h-40 scroll-y">
                {scanResult.results?.map((r: any) => (
                  <div key={r.filename} className="px-3 py-1.5 flex items-center gap-2">
                    <span style={{
                      color: r.status === 'failed' ? 'var(--color-bad)'
                        : r.status === 'unchanged' ? 'var(--faint)' : 'var(--color-good)',
                    }}>
                      {r.status === 'failed' ? '✕' : r.status === 'unchanged' ? '=' : '✓'}
                    </span>
                    <span className="flex-1 truncate">{r.filename}</span>
                    <span className="chip">{r.status}</span>
                    {r.chunks != null && <span style={{ color: 'var(--faint)' }}>{r.chunks} passages</span>}
                    {r.error && <span style={{ color: 'var(--color-bad)' }}>{r.error}</span>}
                    {r.duplicateOf && <span className="chip" style={{ color: 'var(--color-warn)' }}>dupe of {r.duplicateOf}</span>}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {!docs.length ? (
            <Empty icon="📁" title="No documents imported yet"
              hint="Click Import documents to read every PDF, DOCX, TXT and Markdown file from your MUN folder. Originals are never modified." />
          ) : grouped.map(([category, items]) => (
            <Panel key={category} title={`${category} (${items.length})`}>
              <div className="divide-line">
                {items.map((d) => (
                  <div key={d.id} className="px-3 py-2 flex items-center gap-2 text-[13px]">
                    <PriorityChip priority={d.priority} verified={Boolean(d.verified)} />
                    <span className="flex-1 truncate" title={d.filename}>
                      {Boolean(d.pinned) && <span style={{ color: 'var(--color-warn)' }}>★ </span>}
                      {d.title}
                    </span>
                    {d.country && <span className="chip">{d.country}</span>}
                    <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                      {d.chunk_count} passages{d.page_count ? ` · ${d.page_count}pp` : ''}
                    </span>
                    {d.parse_status === 'failed' && (
                      <span className="chip" style={{ color: 'var(--color-bad)' }} title={d.parse_error}>parse failed</span>
                    )}
                    <button className="btn btn-sm" onClick={() => setEditDoc(d)}>Edit</button>
                  </div>
                ))}
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Modal open={Boolean(editDoc)} onClose={() => setEditDoc(null)} title={editDoc?.title}>
        {editDoc && (
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="section-title mb-1">Title</div>
              <input className="input" defaultValue={editDoc.title}
                onBlur={(e) => patchDoc(editDoc, { title: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="section-title mb-1">Category</div>
                <select className="select" defaultValue={editDoc.category}
                  onChange={(e) => patchDoc(editDoc, { category: e.target.value })}>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div className="section-title mb-1">Country</div>
                <select className="select" defaultValue={editDoc.country || ''}
                  onChange={(e) => patchDoc(editDoc, { country: e.target.value || null })}>
                  <option value="">None</option>
                  <CountryOptions />
                </select>
              </div>
            </div>
            <div>
              <div className="section-title mb-1">Source priority</div>
              <select className="select" defaultValue={editDoc.priority}
                onChange={(e) => patchDoc(editDoc, { priority: Number(e.target.value) })}>
                <option value={1}>1 — Competition material (highest)</option>
                <option value={2}>2 — Official / primary source</option>
                <option value={3}>3 — Research</option>
                <option value={4}>4 — AI-generated (lowest)</option>
              </select>
            </div>
            <div>
              <div className="section-title mb-1">Notes</div>
              <textarea className="textarea" rows={2} defaultValue={editDoc.notes || ''}
                onBlur={(e) => patchDoc(editDoc, { notes: e.target.value })} />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              <button className="btn" onClick={() => patchDoc(editDoc, { verified: !editDoc.verified })}>
                {editDoc.verified ? '✓ Verified' : 'Mark verified'}
              </button>
              <button className="btn" onClick={() => patchDoc(editDoc, { pinned: !editDoc.pinned })}>
                {editDoc.pinned ? '★ Pinned' : 'Pin'}
              </button>
              <button className="btn" onClick={() => { patchDoc(editDoc, { archived: !editDoc.archived }); setEditDoc(null); loadDocs() }}>
                {editDoc.archived ? 'Unarchive' : 'Archive'}
              </button>
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
              File on disk: <span className="mono">{editDoc.path}</span><br />
              The original is opened read-only and is never modified by this app.
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}
