// POIs and the defence bank. Two tabs because in committee you are either
// asking a question or answering one, and you know which before you look.

import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, CopyButton, Spinner, Modal } from '../components/ui'

const TARGETS = [
  { code: 'all', label: 'All', flag: '' },
  { code: 'AT', label: 'Austria', flag: '🇦🇹' },
  { code: 'AR', label: 'Argentina', flag: '🇦🇷' },
  { code: 'NP', label: 'Nepal', flag: '🇳🇵' },
  { code: 'ANY', label: 'Any delegation', flag: '◇' },
]

const STRENGTH_COLOR: Record<string, string> = {
  strong: 'var(--color-good)', medium: 'var(--color-warn)', weak: 'var(--color-ink-500)',
}

export function POIs() {
  const [params, setParams] = useSearchParams()
  const { toast } = useApp()
  const [tab, setTab] = useState<'pois' | 'qa'>(params.get('tab') === 'qa' ? 'qa' : 'pois')
  const [pois, setPois] = useState<any[]>([])
  const [qa, setQa] = useState<any[]>([])
  const [speeches, setSpeeches] = useState<any[]>([])
  const [target, setTarget] = useState('all')
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  // One editor for both new and existing POIs — same fields, so the same form.
  const [poiDraft, setPoiDraft] = useState<any>(null)
  const [qaDraft, setQaDraft] = useState<any>(null)

  const blankPoi = () => ({
    id: null, question: '', target_country: target === 'all' ? 'ANY' : target,
    topic: '', purpose: '', expected_response: '', follow_up: '', strength: 'medium',
  })
  const blankQa = () => ({
    id: null, question: '', answer: '', kind: 'likely_to_us', speech_ids: [] as string[],
  })

  const [showHidden, setShowHidden] = useState(false)
  const [hiddenCount, setHiddenCount] = useState(0)

  const load = () => {
    Promise.all([
      api.pois(undefined, showHidden),
      api.qa(),
      api.get<{ hidden: number }>('/api/pois/hidden-count').catch(() => ({ hidden: 0 })),
      // Only for naming the speeches an answer is attached to.
      api.speeches().catch(() => []),
    ])
      .then(([p, a, h, s]) => { setPois(p); setQa(a); setHiddenCount(h.hidden); setSpeeches(s) })
      .catch(() => toast('Could not load POIs', 'bad'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [showHidden])

  const filteredPois = useMemo(() => {
    let list = target === 'all' ? pois : pois.filter((p) => p.target_country === target)
    if (q.trim()) {
      const needle = q.toLowerCase()
      list = list.filter((p) =>
        p.question.toLowerCase().includes(needle) ||
        (p.topic || '').toLowerCase().includes(needle) ||
        (p.purpose || '').toLowerCase().includes(needle))
    }
    return list
  }, [pois, target, q])

  const filteredQa = useMemo(() => {
    if (!q.trim()) return qa
    const needle = q.toLowerCase()
    return qa.filter((a) =>
      a.question.toLowerCase().includes(needle) || a.answer.toLowerCase().includes(needle))
  }, [qa, q])

  // Apply optimistically so the click feels instant, then reconcile with the row
  // the server actually wrote. `markAsked` is a command, not a column — without
  // translating it to `asked_at` here the card never changes and Un-ask looks dead.
  const patchPoi = async (p: any, patch: Record<string, unknown>) => {
    const local: Record<string, unknown> = { ...patch }
    if ('markAsked' in patch) {
      delete local.markAsked
      local.asked_at = patch.markAsked ? new Date().toISOString() : null
    }
    setPois((prev) => prev.map((x) => (x.id === p.id ? { ...x, ...local } : x)))
    const saved = await api.patch<any>(`/api/pois/${p.id}`, patch).catch(() => null)
    if (saved) setPois((prev) => prev.map((x) => (x.id === p.id ? saved : x)))
    else toast('Could not save — the change is shown but not stored.', 'bad')
  }

  // Move within the list you are actually looking at. Reordering a filtered
  // view only shuffles those POIs' own positions — the rest keep theirs.
  const move = async (p: any, dir: -1 | 1) => {
    const idx = filteredPois.findIndex((x) => x.id === p.id)
    const target = idx + dir
    if (idx === -1 || target < 0 || target >= filteredPois.length) return
    const reordered = [...filteredPois]
    ;[reordered[idx], reordered[target]] = [reordered[target], reordered[idx]]
    // Optimistic: the list jumps immediately, then the server confirms.
    const order = new Map(reordered.map((x, i) => [x.id, i]))
    setPois((prev) => [...prev].sort((a, b) =>
      (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity) || a.ordinal - b.ordinal))
    try {
      await api.reorderPois(reordered.map((x) => x.id))
      load()
    } catch (e: any) { toast(e.message, 'bad'); load() }
  }

  const toggleHidden = async (p: any) => {
    await api.patch(`/api/pois/${p.id}`, { hidden: !p.hidden }).catch(() => {})
    toast(p.hidden ? 'POI restored' : 'POI hidden — Show hidden brings it back', 'info')
    load()
  }

  const savePoi = async () => {
    if (!poiDraft?.question.trim()) { toast('A POI needs a question.', 'warn'); return }
    const { id, ...body } = poiDraft
    try {
      if (id) await api.patch(`/api/pois/${id}`, body)
      else await api.post('/api/pois', body)
      setPoiDraft(null); toast(id ? 'POI updated' : 'POI added', 'good'); load()
    } catch (e: any) { toast(e.message, 'bad') }
  }

  const deletePoi = async (p: any) => {
    if (!window.confirm(`Delete this POI?\n\n"${p.question.slice(0, 120)}"\n\nThis cannot be undone.`)) return
    await api.del(`/api/pois/${p.id}`).catch(() => {})
    setPoiDraft(null); toast('POI deleted', 'info'); load()
  }

  const saveQa = async () => {
    if (!qaDraft?.question.trim() || !qaDraft?.answer.trim()) {
      toast('An entry needs both the attack and your answer.', 'warn'); return
    }
    const { id, ...body } = qaDraft
    try {
      if (id) await api.patch(`/api/qa/${id}`, body)
      else await api.post('/api/qa', body)
      setQaDraft(null); toast(id ? 'Answer updated' : 'Answer added', 'good'); load()
    } catch (e: any) { toast(e.message, 'bad') }
  }

  const deleteQa = async (a: any) => {
    if (!window.confirm(`Delete this prepared answer?\n\n"${a.question.slice(0, 120)}"\n\nThis cannot be undone.`)) return
    await api.del(`/api/qa/${a.id}`).catch(() => {})
    setQaDraft(null); toast('Answer deleted', 'info'); load()
  }

  const askedCount = pois.filter((p) => p.asked_at).length

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <div className="flex gap-1">
          <button className="btn btn-sm"
            style={tab === 'pois' ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
            onClick={() => setTab('pois')}>POIs to ask ({pois.length})</button>
          <button className="btn btn-sm"
            style={tab === 'qa' ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
            onClick={() => setTab('qa')}>Defence bank ({qa.length})</button>
        </div>
        <input className="input max-w-xs" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex-1" />
        {tab === 'pois' ? (
          <>
            <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{askedCount} asked</span>
            {(hiddenCount > 0 || showHidden) && (
              <button className="btn btn-sm"
                style={showHidden ? { borderColor: 'var(--color-signal)' } : {}}
                onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Hide hidden' : `Show hidden (${hiddenCount})`}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setPoiDraft(blankPoi())}>+ New POI</button>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => setQaDraft(blankQa())}>+ New answer</button>
        )}
      </div>

      {tab === 'pois' && (
        <div className="flex gap-1.5 flex-wrap shrink-0">
          {TARGETS.map((t) => (
            <button key={t.code} className="btn btn-sm"
              style={target === t.code ? { borderColor: 'var(--color-signal)' } : {}}
              onClick={() => setTarget(t.code)}>
              {t.flag} {t.label}
              <span className="chip">{t.code === 'all' ? pois.length : pois.filter((p) => p.target_country === t.code).length}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 scroll-y">
        {loading ? <Spinner label="Loading…" /> : tab === 'pois' ? (
          filteredPois.length ? (
            <div className="flex flex-col gap-2">
              {filteredPois.map((p, i) => (
                <div key={p.id} className="panel p-3"
                  style={{
                    opacity: p.hidden ? 0.45 : p.asked_at ? 0.65 : 1,
                    borderStyle: p.hidden ? 'dashed' : undefined,
                  }}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                        <span className="chip">
                          {TARGETS.find((t) => t.code === p.target_country)?.flag} {p.target_country}
                        </span>
                        {p.topic && <span className="chip">{p.topic}</span>}
                        <span className="chip" style={{ color: STRENGTH_COLOR[p.strength], borderColor: STRENGTH_COLOR[p.strength] }}>
                          {p.strength}
                        </span>
                        {p.asked_at && <span className="chip" style={{ color: 'var(--color-good)' }}>✓ asked</span>}
                        {Boolean(p.hidden) && <span className="chip" style={{ color: 'var(--faint)' }}>hidden</span>}
                      </div>
                      <p className="text-[14px] leading-snug">{p.question}</p>
                      {p.purpose && (
                        <p className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>
                          <span className="section-title">Purpose</span> {p.purpose}
                        </p>
                      )}
                      {p.expected_response && (
                        <p className="text-[12px] mt-1" style={{ color: 'var(--faint)' }}>
                          <span className="section-title">Expect</span> {p.expected_response}
                        </p>
                      )}
                      {p.follow_up && (
                        <p className="text-[12px] mt-1" style={{ color: 'var(--color-signal)' }}>
                          <span className="section-title">Follow-up</span> {p.follow_up}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0 w-[132px]">
                      <CopyButton text={p.question} label="Copy" className="btn btn-sm" />
                      <button className="btn btn-sm" onClick={() => patchPoi(p, { markAsked: !p.asked_at })}>
                        {p.asked_at ? 'Un-ask' : 'Mark asked'}
                      </button>
                      <div className="flex gap-1">
                        <button className="btn btn-sm flex-1" title="Move up"
                          disabled={i === 0} onClick={() => move(p, -1)}>↑</button>
                        <button className="btn btn-sm flex-1" title="Move down"
                          disabled={i === filteredPois.length - 1} onClick={() => move(p, 1)}>↓</button>
                        <button className="btn btn-sm flex-1" title={p.pinned ? 'Unpin' : 'Pin'}
                          onClick={() => patchPoi(p, { pinned: !p.pinned })}>
                          {p.pinned ? '★' : '☆'}
                        </button>
                      </div>
                      <div className="flex gap-1">
                        <button className="btn btn-sm flex-1" onClick={() => setPoiDraft({
                          id: p.id, question: p.question, target_country: p.target_country,
                          topic: p.topic || '', purpose: p.purpose || '',
                          expected_response: p.expected_response || '', follow_up: p.follow_up || '',
                          strength: p.strength || 'medium',
                        })}>Edit</button>
                        <button className="btn btn-sm flex-1"
                          title={p.hidden ? 'Show this POI again' : 'Hide — keeps it, just out of the way'}
                          onClick={() => toggleHidden(p)}>{p.hidden ? 'Unhide' : 'Hide'}</button>
                        <button className="btn btn-sm" title="Delete permanently"
                          style={{ color: 'var(--color-bad)' }} onClick={() => deletePoi(p)}>✕</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty title="No POIs match" hint="Try a different target or clear the filter." />
        ) : (
          filteredQa.length ? (
            <div className="flex flex-col gap-2">
              {['likely_to_us', 'rapid_response', 'general'].map((kind) => {
                const items = filteredQa.filter((a) => a.kind === kind)
                if (!items.length) return null
                const label = kind === 'likely_to_us' ? 'Likely questions to us'
                  : kind === 'rapid_response' ? 'Rapid responses' : 'General'
                return (
                  <div key={kind}>
                    <div className="section-title mb-1.5 mt-2">{label}</div>
                    <div className="flex flex-col gap-2">
                      {items.map((a) => (
                        <details key={a.id} className="panel p-3" open={Boolean(a.pinned)}>
                          <summary className="cursor-pointer text-[14px] font-medium flex items-center gap-2">
                            {Boolean(a.pinned) && <span style={{ color: 'var(--color-warn)' }}>★</span>}
                            {a.question}
                          </summary>
                          <p className="mt-2 text-[13px] leading-relaxed whitespace-pre-wrap"
                            style={{ color: 'var(--muted)' }}>{a.answer}</p>
                          {/* Which speeches invite this question. Attached answers
                              show up under the speech itself, ready to read. */}
                          {a.speech_ids?.length > 0 && (
                            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                              <span className="section-title">After</span>
                              {a.speech_ids.map((sid: string) => {
                                const sp = speeches.find((s) => s.id === sid)
                                return (
                                  <Link key={sid} to={`/speeches?id=${sid}`} className="chip link">
                                    {sp ? sp.title : 'speech'}
                                  </Link>
                                )
                              })}
                            </div>
                          )}
                          <div className="mt-2 flex gap-1.5 flex-wrap">
                            <CopyButton text={a.answer} label="Copy answer" />
                            <button className="btn btn-sm" onClick={async () => {
                              await api.patch(`/api/qa/${a.id}`, { pinned: !a.pinned }).catch(() => {})
                              load()
                            }}>{a.pinned ? 'Unpin' : 'Pin'}</button>
                            <button className="btn btn-sm" onClick={() => setQaDraft({
                              id: a.id, question: a.question, answer: a.answer, kind: a.kind,
                              speech_ids: [...(a.speech_ids || [])],
                            })}>Edit</button>
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <Empty title="No answers match" />
        )}
      </div>

      {/* POI editor — new and existing use the same form. */}
      <Modal open={Boolean(poiDraft)} onClose={() => setPoiDraft(null)}
        title={poiDraft?.id ? 'Edit POI' : 'New POI'}>
        {poiDraft && (
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="section-title mb-1">Question</div>
              <textarea className="textarea" rows={3} value={poiDraft.question} autoFocus
                onChange={(e) => setPoiDraft({ ...poiDraft, question: e.target.value })}
                placeholder="To the distinguished delegate of…" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="section-title mb-1">Target</div>
                <select className="select" value={poiDraft.target_country}
                  onChange={(e) => setPoiDraft({ ...poiDraft, target_country: e.target.value })}>
                  {TARGETS.filter((t) => t.code !== 'all').map((t) => (
                    <option key={t.code} value={t.code}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="section-title mb-1">Topic</div>
                <input className="input" value={poiDraft.topic}
                  onChange={(e) => setPoiDraft({ ...poiDraft, topic: e.target.value })} />
              </div>
              <div>
                <div className="section-title mb-1">Strength</div>
                <select className="select" value={poiDraft.strength}
                  onChange={(e) => setPoiDraft({ ...poiDraft, strength: e.target.value })}>
                  <option value="strong">Strong</option>
                  <option value="medium">Medium</option>
                  <option value="weak">Weak</option>
                </select>
              </div>
            </div>
            <div>
              <div className="section-title mb-1">Purpose</div>
              <input className="input" value={poiDraft.purpose}
                onChange={(e) => setPoiDraft({ ...poiDraft, purpose: e.target.value })}
                placeholder="What does asking this achieve?" />
            </div>
            <div>
              <div className="section-title mb-1">Expected response</div>
              <input className="input" value={poiDraft.expected_response}
                onChange={(e) => setPoiDraft({ ...poiDraft, expected_response: e.target.value })}
                placeholder="What will they probably say?" />
            </div>
            <div>
              <div className="section-title mb-1">Follow-up</div>
              <input className="input" value={poiDraft.follow_up}
                onChange={(e) => setPoiDraft({ ...poiDraft, follow_up: e.target.value })}
                placeholder="Your comeback once they answer" />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={savePoi}>
                {poiDraft.id ? 'Save changes' : 'Add POI'}
              </button>
              {poiDraft.id && (
                <button className="btn" style={{ color: 'var(--color-bad)' }}
                  onClick={() => deletePoi(poiDraft)}>Delete</button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Defence bank editor. */}
      <Modal open={Boolean(qaDraft)} onClose={() => setQaDraft(null)}
        title={qaDraft?.id ? 'Edit prepared answer' : 'New prepared answer'}>
        {qaDraft && (
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="section-title mb-1">The attack, or the question you expect</div>
              <textarea className="textarea" rows={2} value={qaDraft.question} autoFocus
                onChange={(e) => setQaDraft({ ...qaDraft, question: e.target.value })}
                placeholder="An attack you expect to face — e.g. “Your own state has not met this commitment.”" />
            </div>
            <div>
              <div className="section-title mb-1">Your answer</div>
              <textarea className="textarea" rows={7} value={qaDraft.answer}
                onChange={(e) => setQaDraft({ ...qaDraft, answer: e.target.value })}
                placeholder="Write it the way you would say it out loud." />
            </div>
            <div>
              <div className="section-title mb-1">Section</div>
              <select className="select" value={qaDraft.kind}
                onChange={(e) => setQaDraft({ ...qaDraft, kind: e.target.value })}>
                <option value="likely_to_us">Likely questions to us</option>
                <option value="rapid_response">Rapid responses</option>
                <option value="general">General</option>
              </select>
            </div>
            {/* Attach to the speeches that invite this question. It then appears
                under the speech itself, so the answer is there when it lands. */}
            <div>
              <div className="section-title mb-1">Attach to speeches</div>
              {speeches.length ? (
                <div className="panel max-h-56 scroll-y divide-line">
                  {speeches.map((s) => {
                    const on = (qaDraft.speech_ids || []).includes(s.id)
                    return (
                      <label key={s.id} className="flex items-start gap-2.5 px-3 py-1.5 cursor-pointer text-[13px]">
                        <input type="checkbox" checked={on} className="mt-1 accent-[var(--color-accent)]"
                          onChange={() => setQaDraft({
                            ...qaDraft,
                            speech_ids: on
                              ? (qaDraft.speech_ids || []).filter((x: string) => x !== s.id)
                              : [...(qaDraft.speech_ids || []), s.id],
                          })} />
                        <span className="flex-1 min-w-0">{s.title}</span>
                        <span className="chip shrink-0">{s.category}</span>
                      </label>
                    )
                  })}
                </div>
              ) : (
                <p className="text-[12px]" style={{ color: 'var(--faint)' }}>No speeches saved yet.</p>
              )}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={saveQa}>
                {qaDraft.id ? 'Save changes' : 'Add answer'}
              </button>
              {qaDraft.id && (
                <button className="btn" style={{ color: 'var(--color-bad)' }}
                  onClick={() => deleteQa(qaDraft)}>Delete</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
