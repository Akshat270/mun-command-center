// Speech view. The whole point is glanceability: huge text, minimal chrome,
// one keystroke to open a length. The delegate reads this while standing up.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { useShortcuts } from '../lib/shortcuts'
import { Panel, Empty, CopyButton, Spinner, Modal, useTimer, TimerDisplay } from '../components/ui'

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'opening', label: 'Opening' },
  { key: '30s', label: '30 sec' },
  { key: '45s', label: '45 sec' },
  { key: '60s', label: '60 sec' },
  { key: 'moderated', label: 'Mod caucus' },
  { key: 'closing', label: 'Closing' },
  { key: 'emergency', label: 'Emergency' },
]

// Defence-bank sections, in the order they are useful under pressure.
const QA_KIND_LABELS: Record<string, string> = {
  likely_to_us: 'Likely questions to us',
  rapid_response: 'Rapid responses',
  general: 'General',
}

// Sensible default clock for each kind, so a new speech starts with the right
// timer without the delegate having to think about it.
const DEFAULT_SECONDS: Record<string, number> = {
  opening: 30, '30s': 30, '45s': 45, '60s': 60,
  moderated: 45, closing: 60, emergency: 20,
}

// Reading sizes, from "the whole speech fits on one screen" to "readable from
// standing". Steps rather than a slider: mid-committee you want to hit it once
// and be right, not aim at a handle.
const SCALES = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2]
const BASE_READ = 21    // px at scale 1, reading view
const BASE_FOCUS = 30   // px at scale 1, focus mode

const stepScale = (current: number, dir: -1 | 1) => {
  const i = SCALES.indexOf(current)
  const from = i === -1 ? SCALES.findIndex((s) => s >= current) : i
  return SCALES[Math.min(SCALES.length - 1, Math.max(0, (from === -1 ? 4 : from) + dir))]
}

function SizeControl({ value, onChange, label }: {
  value: number; onChange: (v: number) => void; label?: string
}) {
  return (
    <span className="flex items-center gap-0.5" title="Speech text size">
      {label && <span className="text-[11px] mr-1" style={{ color: 'var(--faint)' }}>{label}</span>}
      <button className="btn btn-sm" disabled={value <= SCALES[0]}
        onClick={() => onChange(stepScale(value, -1))} aria-label="Smaller text">A−</button>
      <span className="text-[11px] tabular-nums w-9 text-center" style={{ color: 'var(--faint)' }}>
        {Math.round(value * 100)}%
      </span>
      <button className="btn btn-sm" disabled={value >= SCALES[SCALES.length - 1]}
        onClick={() => onChange(stepScale(value, 1))} aria-label="Larger text">A+</button>
    </span>
  )
}

/**
 * One attached answer, collapsed to the question until that question is actually
 * put to us. Scan the list, tap the one you heard, read the answer.
 */
function AttachedAnswer({ item, size, onDetach }: {
  item: any; size: number; onDetach?: () => void
}) {
  return (
    <details className="panel panel-2 px-3 py-2">
      <summary className="cursor-pointer font-medium flex items-start gap-2"
        style={{ fontSize: `${size}px`, lineHeight: 1.35 }}>
        <span style={{ color: 'var(--color-signal)' }}>?</span>
        <span className="flex-1">{item.question}</span>
      </summary>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed"
        style={{ fontSize: `${Math.round(size * 0.95)}px`, color: 'var(--muted)' }}>
        {item.answer}
      </p>
      <div className="mt-2 flex gap-1.5">
        <CopyButton text={item.answer} label="Copy answer" />
        {onDetach && <button className="btn btn-sm" title="Remove from this speech"
          onClick={onDetach}>Detach</button>}
      </div>
    </details>
  )
}

export function Speeches() {
  const [params, setParams] = useSearchParams()
  const { toast, settings, saveSetting } = useApp()
  const [speeches, setSpeeches] = useState<any[]>([])
  const [qa, setQa] = useState<any[]>([])       // defence bank, for attached answers
  const [loading, setLoading] = useState(true)
  const [cat, setCat] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'))
  const [focus, setFocus] = useState(false)
  const [focusPois, setFocusPois] = useState(false) // focus mode showing answers, not the speech
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [meta, setMeta] = useState<any>(null)   // new-speech / edit-details editor
  const [linking, setLinking] = useState<any>(null) // { speech, ids } attach editor
  const [linkFilter, setLinkFilter] = useState('')
  const [newAnswer, setNewAnswer] = useState<any>(null) // write-and-attach editor
  const timer = useTimer()

  // Reading and focus sizes are remembered separately — you want a long GSL
  // speech small enough to read seated, and the 30-second opening huge.
  const scale = Number(settings?.speechScale ?? 1)
  const focusScale = Number(settings?.speechFocusScale ?? 1)
  const setScale = (v: number) => saveSetting('speechScale', v)
  const setFocusScale = (v: number) => saveSetting('speechFocusScale', v)

  const load = () => {
    Promise.all([api.speeches(), api.qa().catch(() => [])])
      .then(([s, a]) => { setSpeeches(s); setQa(a) })
      .catch(() => toast('Could not load speeches', 'bad'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const filtered = useMemo(
    () => (cat === 'all' ? speeches : speeches.filter((s) => s.category === cat)),
    [speeches, cat]
  )

  const selected = useMemo(
    () => speeches.find((s) => s.id === selectedId) || filtered[0] || null,
    [speeches, selectedId, filtered]
  )

  // The answers attached to this speech, in the order they were attached. The
  // join is local because the whole defence bank is already loaded for the
  // picker, and mid-committee a second request is a second thing to fail.
  const attached = useMemo(() => {
    const byId = new Map(qa.map((a) => [a.id, a]))
    return ((selected?.qa_ids as string[]) || []).map((qid) => byId.get(qid)).filter(Boolean)
  }, [qa, selected])

  // The picker list. Unknown kinds still get a group, so no prepared answer can
  // become unreachable just because it was written with a different section.
  const linkVisible = useMemo(() => {
    const needle = linkFilter.trim().toLowerCase()
    if (!needle) return qa
    return qa.filter((a) =>
      a.question.toLowerCase().includes(needle) || a.answer.toLowerCase().includes(needle))
  }, [qa, linkFilter])

  const linkKinds = useMemo(() => {
    const order = Object.keys(QA_KIND_LABELS)
    return [...new Set(linkVisible.map((a) => a.kind))].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b)
      return (ia === -1 ? order.length : ia) - (ib === -1 ? order.length : ib) || a.localeCompare(b)
    })
  }, [linkVisible])

  useEffect(() => { if (selected) setDraft(selected.body) }, [selected?.id])
  // A different speech means different questions — never show the last one's.
  useEffect(() => { setFocusPois(false) }, [selected?.id])
  // A stale filter would hide most of the bank next time the picker opens.
  useEffect(() => { if (linking) setLinkFilter('') }, [linking?.speech?.id])

  const openLength = (seconds: number) => {
    const key = `${seconds}s`
    const match = speeches.find((s) => s.category === key) ||
                  speeches.find((s) => s.duration_s === seconds)
    if (match) { setCat(key); setSelectedId(match.id); timer.start(seconds) }
    else toast(`No ${seconds}-second speech saved yet.`, 'warn')
  }

  // − and + resize whichever view is showing, so a long speech can be made to
  // fit without leaving the page.
  const bumpSize = (dir: -1 | 1) =>
    focus ? setFocusScale(stepScale(focusScale, dir)) : setScale(stepScale(scale, dir))

  useShortcuts({
    '1': () => openLength(30),
    '2': () => openLength(45),
    '3': () => openLength(60),
    f: () => setFocus((v) => !v),
    // A POI has just landed. From the reading view this goes straight to the
    // attached answers full-screen; in focus mode it swaps back and forth.
    q: () => {
      if (!attached.length) { toast('No answers attached to this speech.', 'warn'); return }
      if (focus) setFocusPois((v) => !v)
      else { setFocus(true); setFocusPois(true) }
    },
    '-': () => bumpSize(-1),
    '_': () => bumpSize(-1),
    '=': () => bumpSize(1),
    '+': () => bumpSize(1),
  }, [speeches, focus, scale, focusScale, attached])

  const markUsed = async () => {
    if (!selected) return
    await api.patch(`/api/speeches/${selected.id}`, { markUsed: true }).catch(() => {})
    toast('Marked as used', 'good')
    load()
  }

  const clearUsed = async () => {
    if (!selected) return
    await api.patch(`/api/speeches/${selected.id}`, { clearUsed: true }).catch(() => {})
    toast('Used mark cleared', 'info')
    load()
  }

  const togglePin = async (s: any) => {
    await api.patch(`/api/speeches/${s.id}`, { pinned: !s.pinned }).catch(() => {})
    load()
  }

  const saveBody = async () => {
    if (!selected) return
    try {
      await api.patch(`/api/speeches/${selected.id}`, { body: draft })
      setEditing(false); toast('Speech saved', 'good'); load()
    } catch (e: any) { toast(e.message, 'bad') }
  }

  const saveMeta = async () => {
    if (!meta?.title.trim()) { toast('Give the speech a title.', 'warn'); return }
    const { id, ...body } = meta
    try {
      if (id) {
        await api.patch(`/api/speeches/${id}`, body)
        toast('Speech updated', 'good')
      } else {
        const created = await api.post<any>('/api/speeches', body)
        setCat(created.category); setSelectedId(created.id)
        toast('Speech created', 'good')
      }
      setMeta(null); load()
    } catch (e: any) { toast(e.message, 'bad') }
  }

  const deleteSpeech = async (s: any) => {
    if (!window.confirm(`Delete "${s.title}"?\n\nThis cannot be undone. (Reload curated content in Settings restores the shipped speeches.)`)) return
    await api.del(`/api/speeches/${s.id}`).catch(() => {})
    setMeta(null); setSelectedId(null); toast('Speech deleted', 'info'); load()
  }

  // Answers are attached, never copied: the defence bank stays the single place
  // an answer is written, and one answer can follow several speeches.
  const saveLinks = async () => {
    if (!linking) return
    try {
      await api.linkSpeechQa(linking.speech.id, linking.ids)
      setLinking(null)
      toast(linking.ids.length
        ? `${linking.ids.length} answer${linking.ids.length === 1 ? '' : 's'} attached`
        : 'All answers detached', 'good')
      load()
    } catch (e: any) { toast(e.message, 'bad') }
  }

  // Optimistic — this gets pressed while reading, so it must not stall.
  const detach = async (qaId: string) => {
    if (!selected) return
    const ids = ((selected.qa_ids as string[]) || []).filter((x) => x !== qaId)
    setSpeeches((prev) => prev.map((s) => (s.id === selected.id ? { ...s, qa_ids: ids } : s)))
    try { await api.linkSpeechQa(selected.id, ids) }
    catch { toast('Could not detach — reloading', 'bad'); load() }
  }

  const createAndAttach = async () => {
    if (!newAnswer?.question.trim() || !newAnswer?.answer.trim()) {
      toast('An answer needs both the question and your reply.', 'warn'); return
    }
    const { speechId, ...body } = newAnswer
    try {
      await api.post('/api/qa', { ...body, speech_ids: [speechId] })
      setNewAnswer(null); toast('Answer added and attached', 'good'); load()
    } catch (e: any) { toast(e.message, 'bad') }
  }

  // Focus mode: everything except the words disappears.
  if (focus && selected) {
    return (
      <div className="fixed inset-0 z-40 flex flex-col p-8" style={{ background: 'var(--bg)' }}>
        <div className="flex items-center justify-between mb-6 shrink-0">
          <div>
            <div className="section-title">{selected.category}</div>
            <h1 className="text-lg font-semibold">{selected.title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <SizeControl value={focusScale} onChange={setFocusScale} />
            <TimerDisplay t={timer} big />
            <button className="btn" onClick={timer.toggle}>{timer.running ? 'Pause' : 'Start'}</button>
            {/* The moment the speech ends, the POIs start. One press swaps the
                words for the prepared answers, without leaving focus mode. */}
            {attached.length > 0 && (
              <button className="btn" style={focusPois
                ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' }
                : {}}
                onClick={() => setFocusPois((v) => !v)}>
                {focusPois ? 'Speech (Q)' : `Answers · ${attached.length} (Q)`}
              </button>
            )}
            <button className="btn" onClick={() => setFocus(false)}>Exit (F)</button>
          </div>
        </div>
        <div className="flex-1 scroll-y">
          {focusPois ? (
            <div className="flex flex-col gap-2 max-w-4xl">
              <div className="section-title">If they ask you</div>
              {attached.map((a: any) => (
                <AttachedAnswer key={a.id} item={a} size={Math.round(20 * focusScale)} />
              ))}
            </div>
          ) : (
            <>
              <p className="leading-[1.45] max-w-4xl whitespace-pre-wrap"
                style={{ fontSize: `${Math.round(BASE_FOCUS * focusScale)}px` }}>
                {selected.body}
              </p>
              {selected.memory_hook && (
                <p className="mt-8" style={{
                  color: 'var(--color-warn)',
                  fontSize: `${Math.round(18 * focusScale)}px`,
                }}>
                  ▸ {selected.memory_hook}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        {CATEGORIES.map((c) => (
          <button key={c.key} className="btn btn-sm"
            style={cat === c.key ? { background: 'var(--color-accent)', borderColor: 'var(--color-accent)', color: '#fff' } : {}}
            onClick={() => setCat(c.key)}>{c.label}</button>
        ))}
        <div className="flex-1" />
        <button className="btn btn-sm btn-primary" onClick={() => setMeta({
          id: null, title: '', category: cat === 'all' ? '60s' : cat,
          duration_s: DEFAULT_SECONDS[cat === 'all' ? '60s' : cat] ?? 60,
          body: '', memory_hook: '',
        })}>+ New speech</button>
        <span className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--faint)' }}>
          <span className="kbd">1</span>30s <span className="kbd">2</span>45s <span className="kbd">3</span>60s
          <span className="kbd">F</span>focus <span className="kbd">Q</span>answers
          <span className="kbd">−</span><span className="kbd">+</span>size
        </span>
      </div>

      <div className="flex-1 grid lg:grid-cols-[300px_1fr] gap-3 min-h-0">
        <Panel title={`Speeches (${filtered.length})`} bodyClass="scroll-y">
          {loading ? <div className="p-3"><Spinner label="Loading…" /></div>
            : filtered.length ? (
              <div className="divide-line">
                {filtered.map((s) => (
                  <button key={s.id} onClick={() => setSelectedId(s.id)}
                    className="w-full text-left px-3 py-2"
                    style={{ background: selected?.id === s.id ? 'var(--panel-2)' : 'transparent' }}>
                    <div className="flex items-center gap-1.5">
                      {Boolean(s.pinned) && <span style={{ color: 'var(--color-warn)' }}>★</span>}
                      <span className="text-[13px] flex-1 truncate">{s.title}</span>
                      {/* Which speeches still have no prepared defence — the one
                          thing worth seeing without opening each in turn. */}
                      {s.qa_ids?.length > 0 && (
                        <span className="chip" title={`${s.qa_ids.length} prepared answer(s) attached`}
                          style={{ color: 'var(--color-signal)' }}>?{s.qa_ids.length}</span>
                      )}
                      {s.duration_s && <span className="chip">{s.duration_s}s</span>}
                    </div>
                    {s.used_at && (
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-good)' }}>
                        ✓ used {s.use_count > 1 ? `${s.use_count}×` : ''}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : <Empty title="No speeches in this category" />}
        </Panel>

        {selected ? (
          <Panel
            title={selected.title}
            actions={
              <>
                <SizeControl value={scale} onChange={setScale} />
                <TimerDisplay t={timer} />
                <button className="btn btn-sm btn-primary"
                  onClick={() => timer.start(selected.duration_s || 60)}>Start timer</button>
                <button className="btn btn-sm" onClick={() => setFocus(true)}>Focus</button>
                <button className="btn btn-sm"
                  title="Attach prepared answers — the questions other delegations may put to you after this speech"
                  onClick={() => setLinking({ speech: selected, ids: [...(selected.qa_ids || [])] })}>
                  Answers{attached.length ? ` · ${attached.length}` : ''}
                </button>
                <CopyButton text={selected.body} />
                <button className="btn btn-sm" onClick={() => setEditing((e) => !e)}>
                  {editing ? 'Cancel' : 'Edit'}
                </button>
                <button className="btn btn-sm" onClick={() => setMeta({
                  id: selected.id, title: selected.title, category: selected.category,
                  duration_s: selected.duration_s ?? DEFAULT_SECONDS[selected.category] ?? 60,
                  body: selected.body, memory_hook: selected.memory_hook || '',
                })}>Details</button>
                <button className="btn btn-sm" onClick={() => togglePin(selected)}>
                  {selected.pinned ? '★ Pinned' : '☆ Pin'}
                </button>
                <button className="btn btn-sm" onClick={selected.used_at ? clearUsed : markUsed}>
                  {selected.used_at ? 'Clear used' : 'Mark used'}
                </button>
              </>
            }
            bodyClass="scroll-y">
            <div className="p-5">
              {editing ? (
                <div className="flex flex-col gap-2">
                  <textarea className="textarea text-[16px] leading-relaxed" rows={14}
                    value={draft} onChange={(e) => setDraft(e.target.value)} />
                  <div className="flex gap-2">
                    <button className="btn btn-primary" onClick={saveBody}>Save</button>
                    <button className="btn" onClick={() => { setDraft(selected.body); setEditing(false) }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="leading-[1.55] whitespace-pre-wrap max-w-3xl"
                    style={{ fontSize: `${Math.round(BASE_READ * scale)}px` }}>
                    {selected.body}
                  </p>
                  {selected.memory_hook && (
                    <div className="mt-6 panel panel-2 px-3 py-2 max-w-3xl">
                      <div className="section-title mb-0.5">Memory hook</div>
                      <div className="text-[14px]" style={{ color: 'var(--color-warn)' }}>
                        {selected.memory_hook}
                      </div>
                    </div>
                  )}
                  {/* The point of attaching: after this speech, a delegation
                      raises one of these — the answer is already on screen. */}
                  <div className="mt-6 max-w-3xl">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="section-title">If they ask you ({attached.length})</div>
                      <div className="flex-1" />
                      <button className="btn btn-sm" onClick={() => setNewAnswer({
                        speechId: selected.id, question: '', answer: '', kind: 'likely_to_us',
                      })}>+ Write one</button>
                      <button className="btn btn-sm"
                        onClick={() => setLinking({ speech: selected, ids: [...(selected.qa_ids || [])] })}>
                        Attach from bank
                      </button>
                    </div>
                    {attached.length ? (
                      <div className="flex flex-col gap-1.5">
                        {attached.map((a: any) => (
                          <AttachedAnswer key={a.id} item={a} size={14}
                            onDetach={() => detach(a.id)} />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px]" style={{ color: 'var(--faint)' }}>
                        Nothing attached yet. Attach the questions this speech invites and
                        they are one press of <span className="kbd">Q</span> away while you speak.
                      </p>
                    )}
                  </div>

                  <div className="mt-6 flex flex-wrap gap-1.5 text-[11px]" style={{ color: 'var(--faint)' }}>
                    <span className="chip">{selected.category}</span>
                    {selected.duration_s && <span className="chip">{selected.duration_s} seconds</span>}
                    <span className="chip">{selected.body.trim().split(/\s+/).length} words</span>
                    <span className="chip">
                      ≈{Math.round(selected.body.trim().split(/\s+/).length / 2.5)}s at speaking pace
                    </span>
                  </div>
                </>
              )}
            </div>
          </Panel>
        ) : (
          <Panel><Empty title="No speech selected"
            hint="Pick one on the left, or create a new one." /></Panel>
        )}
      </div>

      {/* Attach answers from the defence bank. Attaching, not copying: the bank
          stays the one place an answer is written and kept current. */}
      <Modal open={Boolean(linking)} onClose={() => setLinking(null)} wide
        title={linking ? `Answers for “${linking.speech.title}”` : ''}>
        {linking && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input className="input flex-1 min-w-[12rem]" autoFocus value={linkFilter}
                placeholder="Filter the defence bank…"
                onChange={(e) => setLinkFilter(e.target.value)} />
              <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                {linking.ids.length} attached
              </span>
              <button className="btn btn-sm" disabled={!linking.ids.length}
                onClick={() => setLinking({ ...linking, ids: [] })}>Clear</button>
              <button className="btn btn-sm btn-primary" onClick={saveLinks}>Save</button>
            </div>

            {qa.length === 0 ? (
              <Empty title="The defence bank is empty"
                hint="Write answers on the POIs page, or use “+ Write one” to add one here." />
            ) : linkKinds.length === 0 ? (
              <Empty title="No prepared answer matches that filter" />
            ) : linkKinds.map((kind) => (
              <div key={kind}>
                <div className="section-title mb-1 mt-1.5">{QA_KIND_LABELS[kind] || kind}</div>
                <div className="flex flex-col gap-1">
                  {linkVisible.filter((a: any) => a.kind === kind).map((a: any) => {
                    const on = linking.ids.includes(a.id)
                    return (
                      <label key={a.id} className="panel px-3 py-2 flex items-start gap-2.5 cursor-pointer"
                        style={on ? { borderColor: 'var(--color-accent)' } : {}}>
                        <input type="checkbox" checked={on} className="mt-1 accent-[var(--color-accent)]"
                          onChange={() => setLinking({
                            ...linking,
                            ids: on ? linking.ids.filter((x: string) => x !== a.id)
                                    : [...linking.ids, a.id],
                          })} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13px]">{a.question}</span>
                          <span className="block text-[11px] mt-0.5 line-clamp-2"
                            style={{ color: 'var(--muted)' }}>{a.answer}</span>
                          {/* One answer serving several speeches is normal — say so,
                              so detaching it here is not mistaken for deleting it. */}
                          {a.speech_ids?.length > (on ? 1 : 0) && (
                            <span className="chip mt-1" style={{ color: 'var(--faint)' }}>
                              also on {a.speech_ids.length - (on ? 1 : 0)} other
                              speech{a.speech_ids.length - (on ? 1 : 0) === 1 ? '' : 'es'}
                            </span>
                          )}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Write a new prepared answer and attach it in one step. It lands in the
          defence bank too — this is a shortcut, not a separate store. */}
      <Modal open={Boolean(newAnswer)} onClose={() => setNewAnswer(null)}
        title="New prepared answer">
        {newAnswer && (
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="section-title mb-1">The question they will ask</div>
              <textarea className="textarea" rows={2} value={newAnswer.question} autoFocus
                onChange={(e) => setNewAnswer({ ...newAnswer, question: e.target.value })}
                placeholder="An attack you expect to face — e.g. “Your own state has not met this commitment.”" />
            </div>
            <div>
              <div className="section-title mb-1">Your answer</div>
              <textarea className="textarea" rows={7} value={newAnswer.answer}
                onChange={(e) => setNewAnswer({ ...newAnswer, answer: e.target.value })}
                placeholder="Write it the way you would say it out loud." />
            </div>
            <div>
              <div className="section-title mb-1">Section</div>
              <select className="select" value={newAnswer.kind}
                onChange={(e) => setNewAnswer({ ...newAnswer, kind: e.target.value })}>
                {Object.entries(QA_KIND_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" onClick={createAndAttach}>
              Add and attach to this speech
            </button>
          </div>
        )}
      </Modal>

      {/* Speech editor — title, kind, clock, text and memory hook. */}
      <Modal open={Boolean(meta)} onClose={() => setMeta(null)}
        title={meta?.id ? 'Speech details' : 'New speech'} wide>
        {meta && (
          <div className="flex flex-col gap-2.5">
            <div>
              <div className="section-title mb-1">Title</div>
              <input className="input" value={meta.title} autoFocus
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                placeholder="e.g. GSL — metadata is not harmless" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="section-title mb-1">Used in</div>
                <select className="select" value={meta.category}
                  onChange={(e) => setMeta({
                    ...meta, category: e.target.value,
                    duration_s: DEFAULT_SECONDS[e.target.value] ?? meta.duration_s,
                  })}>
                  {CATEGORIES.filter((c) => c.key !== 'all').map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="section-title mb-1">Speaking time (seconds)</div>
                <input className="input" type="number" min={5} max={600} value={meta.duration_s ?? 60}
                  onChange={(e) => setMeta({ ...meta, duration_s: Number(e.target.value) })} />
              </div>
            </div>
            <div>
              <div className="section-title mb-1">Text</div>
              <textarea className="textarea text-[15px] leading-relaxed" rows={10} value={meta.body}
                onChange={(e) => setMeta({ ...meta, body: e.target.value })}
                placeholder="Write it the way you will say it." />
              <div className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                {meta.body.trim() ? meta.body.trim().split(/\s+/).length : 0} words ·
                ≈{Math.round((meta.body.trim() ? meta.body.trim().split(/\s+/).length : 0) / 2.5)}s at
                speaking pace{meta.duration_s ? ` · target ${meta.duration_s}s` : ''}
              </div>
            </div>
            <div>
              <div className="section-title mb-1">Memory hook</div>
              <input className="input" value={meta.memory_hook}
                onChange={(e) => setMeta({ ...meta, memory_hook: e.target.value })}
                placeholder="The four words you need if you lose your place" />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary flex-1" onClick={saveMeta}>
                {meta.id ? 'Save changes' : 'Create speech'}
              </button>
              {meta.id && (
                <button className="btn" style={{ color: 'var(--color-bad)' }}
                  onClick={() => deleteSpeech(meta)}>Delete</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
