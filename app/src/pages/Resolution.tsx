// Draft resolution workspace. Structured clauses rather than a rich-text blob,
// so reordering, duplicate detection and per-clause AI review are all possible.
// AI FLAGS clauses — it never silently rewrites the delegate's text.

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Spinner, CopyButton, Modal, AIBanner } from '../components/ui'
import { AnalysisCard } from '../components/AnalysisCard'

const PRE_OPENERS = ['Recalling', 'Reaffirming', 'Recognising', 'Noting', 'Concerned', 'Emphasising',
  'Bearing in mind', 'Welcoming', 'Deeply concerned', 'Guided by']
const OP_OPENERS = ['Calls upon', 'Urges', 'Encourages', 'Invites', 'Requests', 'Recommends',
  'Affirms', 'Recognises', 'Decides', 'Further requests']

export function Resolution() {
  const [params] = useSearchParams()
  const { aiAvailable, session, toast } = useApp()
  const [res, setRes] = useState<any>(null)
  const [library, setLibrary] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'draft' | 'library'>(params.get('tab') === 'library' ? 'library' : 'draft')
  const [adding, setAdding] = useState<'PRE' | 'OP' | null>(null)
  const [newClause, setNewClause] = useState({ opener: '', text: '' })
  const [checking, setChecking] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<any>(null)
  const [editingMeta, setEditingMeta] = useState(false)

  // Import from Word / pasted text.
  const [importing, setImporting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [file, setFile] = useState<{ name: string; base64: string } | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [mode, setMode] = useState<'replace' | 'append' | 'new'>('replace')
  const [working, setWorking] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await api.resolutions()
      const active = list.find((r: any) => r.is_active) || list[0]
      if (active) setRes(await api.resolution(active.id))
      setLibrary(await api.clauseLibrary())
    } catch { toast('Could not load the resolution', 'bad') } finally { setLoading(false) }
  }, [toast])

  useEffect(() => { load() }, [load])

  const addClause = async (kind: 'PRE' | 'OP', opener: string, text: string) => {
    if (!text.trim() || !res) return
    await api.post('/api/clauses', { resolution_id: res.id, kind, opener, text }).catch(() => {})
    setAdding(null); setNewClause({ opener: '', text: '' }); load()
  }

  const patchClause = async (id: string, patch: Record<string, unknown>) => {
    await api.patch(`/api/clauses/${id}`, patch).catch(() => {})
    load()
  }

  const removeClause = async (id: string) => {
    await api.del(`/api/clauses/${id}`).catch(() => {})
    load()
  }

  const move = async (clause: any, dir: -1 | 1) => {
    const siblings = res.clauses.filter((c: any) => c.kind === clause.kind)
    const idx = siblings.findIndex((c: any) => c.id === clause.id)
    const target = idx + dir
    if (target < 0 || target >= siblings.length) return
    const reordered = [...siblings]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]
    await api.post('/api/clauses/reorder', { ids: reordered.map((c: any) => c.id) }).catch(() => {})
    load()
  }

  const importPayload = () =>
    file ? { docxBase64: file.base64, filename: file.name } : { text: pasted }

  const pickFile = async (f: File | null) => {
    if (!f) { setFile(null); return }
    setPreview(null)
    if (/\.(txt|md)$/i.test(f.name)) {
      setPasted(await f.text()); setFile(null)
      toast(`Read ${f.name}`, 'good')
      return
    }
    if (!/\.docx$/i.test(f.name)) {
      toast('Word .docx, .txt or .md only. In Word use Save As → .docx, or paste the text below.', 'warn')
      return
    }
    const buf = new Uint8Array(await f.arrayBuffer())
    let binary = ''
    for (let i = 0; i < buf.length; i += 8192) {
      binary += String.fromCharCode(...buf.subarray(i, i + 8192))
    }
    setFile({ name: f.name, base64: btoa(binary) })
    setPasted('')
  }

  // Always preview before writing: the delegate sees exactly which clauses were
  // found and what could not be parsed before anything touches the draft.
  const runPreview = async () => {
    setWorking(true); setPreview(null)
    try {
      setPreview(await api.importResolution({ ...importPayload(), preview: true }))
    } catch (e: any) { toast(e.message, 'bad') } finally { setWorking(false) }
  }

  const runImport = async () => {
    setWorking(true)
    try {
      const result = await api.importResolution({
        ...importPayload(), mode, resolutionId: mode === 'new' ? undefined : res.id,
      })
      toast(`Imported ${result.imported} clauses (${result.stats.preambulatory} preambulatory, ${result.stats.operative} operative)`, 'good')
      setImporting(false); setPreview(null); setFile(null); setPasted('')
      if (mode === 'new') setRes(await api.resolution(result.resolutionId))
      else await load()
    } catch (e: any) { toast(e.message, 'bad') } finally { setWorking(false) }
  }

  const checkClause = async (clause: any) => {
    setChecking(clause.id); setCheckResult(null)
    try {
      const result = await api.checkClause({
        clauseText: `${clause.opener ? clause.opener + ' ' : ''}${clause.text}`,
        resolutionId: res.id, sessionId: session?.id,
      })
      setCheckResult(result)
      if (result.ok) await patchClause(clause.id, { flags: result.sections })
      else toast(result.reason, 'warn')
    } catch (e: any) { toast(e.message, 'bad') } finally { setChecking(null) }
  }

  const exportText = () => {
    if (!res) return ''
    const pre = res.clauses.filter((c: any) => c.kind === 'PRE')
    const op = res.clauses.filter((c: any) => c.kind === 'OP')
    return [
      `COMMITTEE: ${res.committee}`,
      `AGENDA: ${res.agenda}`,
      `SPONSORS: ${res.sponsors.join(', ') || '—'}`,
      `SIGNATORIES: ${res.signatories.join(', ') || '—'}`,
      '',
      'The General Assembly,',
      '',
      ...pre.map((c: any) => `${c.opener ? `${c.opener} ` : ''}${c.text}`),
      '',
      ...op.map((c: any, i: number) => `${i + 1}. ${c.opener ? `${c.opener} ` : ''}${c.text}`),
    ].join('\n')
  }

  // Word opens an HTML file with a .doc extension without complaint, and it
  // keeps the clause structure — good enough to hand to a Chair who wants Word,
  // and it needs no library.
  const download = (kind: 'doc' | 'txt') => {
    const text = exportText()
    const safe = (res.title || 'resolution').replace(/[^\w -]+/g, '').trim() || 'resolution'
    const body = kind === 'txt'
      ? text
      : `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">` +
        `<title>${escapeHtml(res.title)}</title></head><body style="font-family:Calibri,serif;font-size:12pt">` +
        text.split('\n').map((l) => `<p>${escapeHtml(l) || '&nbsp;'}</p>`).join('') +
        `</body></html>`
    const blob = new Blob([body], {
      type: kind === 'txt' ? 'text/plain;charset=utf-8' : 'application/msword;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${safe}.${kind}`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toast(`Downloaded ${safe}.${kind}`, 'good')
  }

  if (loading) return <div className="p-4"><Spinner label="Loading resolution…" /></div>
  if (!res) return <div className="p-4"><Empty title="No resolution yet" /></div>

  const pre = res.clauses.filter((c: any) => c.kind === 'PRE')
  const op = res.clauses.filter((c: any) => c.kind === 'OP')

  return (
    <div className="p-4 flex flex-col gap-3 max-w-[980px]">
      {/* Status */}
      <Panel title={res.title} actions={
        <>
          <button className="btn btn-sm" onClick={() => setImporting(true)}>Import from Word</button>
          <button className="btn btn-sm" onClick={() => download('doc')}>Download .doc</button>
          <button className="btn btn-sm" onClick={() => download('txt')}>.txt</button>
          <button className="btn btn-sm" onClick={() => setEditingMeta(true)}>Sponsors</button>
          <CopyButton text={exportText()} label="Copy full text" />
        </>
      }>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-px" style={{ background: 'var(--line)' }}>
          <Stat label="Preambulatory" value={res.stats.preambulatory} />
          <Stat label="Operative" value={res.stats.operative} />
          <Stat label="Sponsors" value={res.stats.sponsors} />
          <Stat label="Signatories" value={res.stats.signatories} />
          <Stat label="Duplicates" value={res.duplicates.length}
            tone={res.duplicates.length ? 'var(--color-warn)' : undefined} />
        </div>
        {res.duplicates.length > 0 && (
          <div className="px-3 py-2 border-t text-[12px]" style={{ color: 'var(--color-warn)' }}>
            ⚠ Possible duplicates: {res.duplicates.map((d: any) => `${d.aLabel} ≈ ${d.bLabel} (${d.similarity}%)`).join(', ')}
          </div>
        )}
      </Panel>

      <div className="flex gap-1.5">
        <button className="btn btn-sm"
          style={tab === 'draft' ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
          onClick={() => setTab('draft')}>Draft</button>
        <button className="btn btn-sm"
          style={tab === 'library' ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
          onClick={() => setTab('library')}>Clause library ({library.length})</button>
      </div>

      {tab === 'library' ? (
        <Panel title="Your priority clauses — click to add to the draft">
          <div className="divide-line">
            {library.map((c) => (
              <div key={c.id} className="px-3 py-2 flex items-start gap-2 text-[13px]">
                <span className="chip shrink-0">{c.kind}</span>
                {c.topic && <span className="chip shrink-0">{c.topic}</span>}
                <p className="flex-1">
                  <span style={{ color: 'var(--color-signal)' }}>{c.opener} </span>{c.text}
                </p>
                <button className="btn btn-sm shrink-0"
                  onClick={() => addClause(c.kind, c.opener, c.text)}>Add</button>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <>
          <ClauseSection
            title="Preambulatory clauses" kind="PRE" clauses={pre} openers={PRE_OPENERS}
            onAdd={() => setAdding('PRE')} onMove={move} onPatch={patchClause}
            onRemove={removeClause} onCheck={checkClause} checking={checking} aiAvailable={aiAvailable}
            duplicates={res.duplicates} />
          <ClauseSection
            title="Operative clauses" kind="OP" clauses={op} openers={OP_OPENERS} numbered
            onAdd={() => setAdding('OP')} onMove={move} onPatch={patchClause}
            onRemove={removeClause} onCheck={checkClause} checking={checking} aiAvailable={aiAvailable}
            duplicates={res.duplicates} />
        </>
      )}

      {checkResult && (
        <Panel title="Clause review" actions={<button className="btn btn-sm" onClick={() => setCheckResult(null)}>Dismiss</button>}>
          <div className="p-2">
            <AnalysisCard result={checkResult} />
            <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--faint)' }}>
              Flags only — nothing was changed in your draft. Apply any wording yourself.
            </p>
          </div>
        </Panel>
      )}

      {/* Add clause */}
      <Modal open={Boolean(adding)} onClose={() => setAdding(null)}
        title={adding === 'PRE' ? 'New preambulatory clause' : 'New operative clause'}>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="section-title mb-1">Opener</div>
            <div className="flex flex-wrap gap-1">
              {(adding === 'PRE' ? PRE_OPENERS : OP_OPENERS).map((o) => (
                <button key={o} className="btn btn-sm"
                  style={newClause.opener === o ? { borderColor: 'var(--color-signal)' } : {}}
                  onClick={() => setNewClause({ ...newClause, opener: o })}>{o}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="section-title mb-1">Text</div>
            <textarea className="textarea" rows={4} value={newClause.text} autoFocus
              onChange={(e) => setNewClause({ ...newClause, text: e.target.value })}
              placeholder={adding === 'OP'
                ? 'Member States to… (keep it recommendatory — UNGA cannot bind)'
                : 'that…'} />
          </div>
          {adding === 'OP' && /\b(shall|must|require[sd]?|mandate[sd]?|oblige[sd]?)\b/i.test(newClause.text) && (
            <div className="text-[12px]" style={{ color: 'var(--color-warn)' }}>
              ⚠ Binding language detected. UNGA resolutions are recommendatory — prefer
              “Calls upon”, “Urges”, “Encourages”.
            </div>
          )}
          <button className="btn btn-primary" onClick={() => addClause(adding!, newClause.opener, newClause.text)}>
            Add clause
          </button>
        </div>
      </Modal>

      {/* Import from Word */}
      <Modal open={importing} onClose={() => setImporting(false)} title="Import a draft resolution" wide>
        <div className="flex flex-col gap-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="section-title mb-1">From a Word file</div>
              <input type="file" accept=".docx,.txt,.md" className="input text-[12px]"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
              {file && <div className="text-[12px] mt-1" style={{ color: 'var(--color-good)' }}>✓ {file.name}</div>}
              <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                <span className="mono">.docx</span> keeps Word's numbering. Older{' '}
                <span className="mono">.doc</span> files: open in Word, Save As → .docx.
              </p>
            </div>
            <div>
              <div className="section-title mb-1">Or paste the text</div>
              <textarea className="textarea text-[12px]" rows={5} value={pasted}
                onChange={(e) => { setPasted(e.target.value); setFile(null); setPreview(null) }}
                placeholder={'The General Assembly,\n\nRecalling Article 17 of the ICCPR,\n\n1. Calls upon Member States to…'} />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-primary" disabled={working || (!file && !pasted.trim())}
              onClick={runPreview}>{working && !preview ? 'Reading…' : 'Preview'}</button>
            <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
              Nothing is written until you confirm. Parsing runs on this laptop — no internet, no AI.
            </span>
          </div>

          {preview && (
            <div className="panel panel-2 p-3 flex flex-col gap-2">
              <div className="flex gap-1.5 flex-wrap text-[12px]">
                <span className="chip">{preview.stats.preambulatory} preambulatory</span>
                <span className="chip">{preview.stats.operative} operative</span>
                {preview.sponsors?.length > 0 && <span className="chip">sponsors: {preview.sponsors.join(', ')}</span>}
                {preview.agenda && <span className="chip">agenda found</span>}
              </div>

              {preview.warnings?.map((w: string, i: number) => (
                <div key={i} className="text-[12px]" style={{ color: 'var(--color-warn)' }}>⚠ {w}</div>
              ))}

              <div className="max-h-64 scroll-y divide-line">
                {preview.clauses.map((c: any, i: number) => (
                  <div key={i} className="py-1.5 text-[12px] flex gap-2">
                    <span className="chip shrink-0">{c.kind}</span>
                    <span className="flex-1 whitespace-pre-wrap">
                      <span style={{ color: 'var(--color-signal)' }}>{c.opener} </span>{c.text}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <div className="section-title mb-1">Where does this go?</div>
                <div className="flex gap-1.5 flex-wrap">
                  {([
                    ['replace', `Replace the ${res.clauses.length} clauses in "${res.title}"`],
                    ['append', 'Add to the end of the current draft'],
                    ['new', 'Create a separate new draft'],
                  ] as const).map(([m, label]) => (
                    <button key={m} className="btn btn-sm"
                      style={mode === m ? { borderColor: 'var(--color-signal)' } : {}}
                      onClick={() => setMode(m)}>{label}</button>
                  ))}
                </div>
              </div>

              {mode === 'replace' && res.clauses.length > 0 && (
                <div className="text-[12px]" style={{ color: 'var(--color-warn)' }}>
                  ⚠ This deletes the {res.clauses.length} clauses currently in the draft. Download a
                  copy first if you are not sure.
                </div>
              )}

              <button className="btn btn-primary" disabled={working} onClick={runImport}>
                {working ? 'Importing…' : `Import ${preview.clauses.length} clauses`}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* Sponsors */}
      <Modal open={editingMeta} onClose={() => setEditingMeta(false)} title="Sponsors & signatories">
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="section-title mb-1">Title</div>
            <input className="input" defaultValue={res.title}
              onBlur={(e) => api.patch(`/api/resolutions/${res.id}`, { title: e.target.value }).then(load)} />
          </div>
          <div>
            <div className="section-title mb-1">Sponsors (comma separated)</div>
            <input className="input" defaultValue={res.sponsors.join(', ')}
              onBlur={(e) => api.patch(`/api/resolutions/${res.id}`, {
                sponsors: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              }).then(load)} />
          </div>
          <div>
            <div className="section-title mb-1">Signatories (comma separated)</div>
            <input className="input" defaultValue={res.signatories.join(', ')}
              onBlur={(e) => api.patch(`/api/resolutions/${res.id}`, {
                signatories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
              }).then(load)} />
          </div>
          <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
            A signature does not necessarily mean a yes vote — ask the Chair what your conference requires.
          </p>
        </div>
      </Modal>
    </div>
  )
}

const escapeHtml = (s: string) =>
  (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="px-3 py-2" style={{ background: 'var(--panel)' }}>
      <div className="section-title">{label}</div>
      <div className="text-lg font-semibold mt-0.5" style={{ color: tone }}>{value}</div>
    </div>
  )
}

function ClauseSection({ title, kind, clauses, openers, numbered, onAdd, onMove, onPatch, onRemove, onCheck, checking, aiAvailable, duplicates }: any) {
  return (
    <Panel title={`${title} (${clauses.length})`} actions={
      <button className="btn btn-sm btn-primary" onClick={onAdd}>+ Add</button>
    }>
      {clauses.length ? (
        <div className="divide-line">
          {clauses.map((c: any, i: number) => {
            const isDupe = duplicates.some((d: any) => d.a === c.id || d.b === c.id)
            return (
              <div key={c.id} className="px-3 py-2"
                style={{ borderLeft: isDupe ? '2px solid var(--color-warn)' : undefined }}>
                <div className="flex items-start gap-2">
                  <span className="mono shrink-0 pt-0.5" style={{ color: 'var(--faint)' }}>
                    {numbered ? `${i + 1}.` : '•'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-1.5 flex-wrap">
                      <select className="select max-w-[150px] py-0.5 text-[12px]" value={c.opener || ''}
                        onChange={(e) => onPatch(c.id, { opener: e.target.value })}>
                        <option value="">(no opener)</option>
                        {openers.map((o: string) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <textarea className="textarea mt-1 text-[13px]" rows={2} defaultValue={c.text}
                      onBlur={(e) => e.target.value !== c.text && onPatch(c.id, { text: e.target.value })} />
                    {c.flags?.VERDICT && (
                      <div className="mt-1 text-[12px] panel panel-2 px-2 py-1.5">
                        <span className="section-title">AI review</span>{' '}
                        <span style={{ color: /sound/i.test(c.flags.VERDICT) ? 'var(--color-good)' : 'var(--color-warn)' }}>
                          {c.flags.VERDICT}
                        </span>
                        {c.flags.FLAGS && c.flags.FLAGS !== 'None' && (
                          <div className="mt-0.5 whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{c.flags.FLAGS}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button className="btn btn-sm" onClick={() => onMove(c, -1)} disabled={i === 0}>↑</button>
                    <button className="btn btn-sm" onClick={() => onMove(c, 1)} disabled={i === clauses.length - 1}>↓</button>
                    <button className="btn btn-sm" onClick={() => onCheck(c)} disabled={!aiAvailable || checking === c.id}
                      title={aiAvailable ? 'Check with AI' : 'Needs an API key — add one in Settings'}>
                      {checking === c.id ? '…' : '✓?'}
                    </button>
                    <button className="btn btn-sm" onClick={() => onRemove(c.id)}>✕</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <Empty title={`No ${kind === 'PRE' ? 'preambulatory' : 'operative'} clauses yet`}
          hint="Add one, or pull from the clause library tab." />
      )}
    </Panel>
  )
}
