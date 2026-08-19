// Procedure reference. Every card is labelled by its authority: GENERAL
// PRACTICE until the Chair actually announces the rule, at which point the
// delegate promotes it to RPS CONFIRMED. Guessing here loses committees.

import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Spinner, CopyButton, Modal } from '../components/ui'

const SOURCE_META: Record<string, { label: string; color: string; note: string }> = {
  RPS_CONFIRMED: { label: 'CONFIRMED FROM RPS MATERIAL', color: 'var(--color-good)', note: 'The Chair announced this.' },
  GENERAL_PRACTICE: { label: 'GENERAL MUN PRACTICE', color: 'var(--color-warn)', note: 'Typical practice — confirm with your Chair.' },
  NOT_SPECIFIED: { label: 'NOT SPECIFIED', color: 'var(--color-ink-500)', note: 'Unknown for this conference.' },
}

export function Motions() {
  const { toast } = useApp()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<any>(null)
  const [draft, setDraft] = useState({ body: '', wording: '', source: 'GENERAL_PRACTICE' })

  const load = () => { api.procedure().then(setData).catch(() => {}).finally(() => setLoading(false)) }
  useEffect(load, [])

  const rules = useMemo(() => {
    if (!data?.rules) return []
    if (!q.trim()) return data.rules
    const needle = q.toLowerCase()
    return data.rules.filter((r: any) =>
      r.title.toLowerCase().includes(needle) ||
      r.body.toLowerCase().includes(needle) ||
      (r.wording || '').toLowerCase().includes(needle))
  }, [data, q])

  const openEdit = (r: any) => {
    setEditing(r)
    setDraft({ body: r.body, wording: r.wording || '', source: r.source })
  }

  const save = async () => {
    await api.patch(`/api/procedure/${editing.id}`, draft).catch(() => toast('Could not save', 'bad'))
    setEditing(null); toast('Rule updated', 'good'); load()
  }

  if (loading) return <div className="p-4"><Spinner label="Loading procedure…" /></div>

  const confirmedCount = data.rules.filter((r: any) => r.source === 'RPS_CONFIRMED').length

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[980px]">
      <div className="panel px-3 py-2.5 text-[13px]" style={{ borderColor: 'var(--color-warn)' }}>
        <div className="section-title mb-1" style={{ color: 'var(--color-warn)' }}>Authority labels</div>
        <p style={{ color: 'var(--muted)' }}>
          RPSIS rules were not supplied, so every card starts as <b>GENERAL MUN PRACTICE</b>.
          When the Chair announces a rule, edit the card and mark it <b>CONFIRMED FROM RPS MATERIAL</b>.
          If the Chair gives a different rule, follow the Chair.
          {confirmedCount > 0 && ` (${confirmedCount} confirmed so far.)`}
        </p>
      </div>

      {/* Opening moments — the exact wording, in order */}
      {data.openingMoments?.length > 0 && (
        <Panel title="Start of committee — exact wording">
          <div className="divide-line">
            {data.openingMoments.map((m: any, i: number) => (
              <div key={i} className="px-3 py-2 flex items-start gap-3 text-[13px]">
                <span className="chip shrink-0">{m.moment}</span>
                <span className="flex-1" style={{ color: 'var(--muted)' }}>{m.action}</span>
                <div className="flex items-center gap-1.5 shrink-0 max-w-[46%]">
                  <span className="mono text-[12px] truncate" style={{ color: 'var(--color-signal)' }}
                    title={m.wording}>“{m.wording}”</span>
                  <CopyButton text={m.wording} label="⧉" className="btn btn-sm" />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Caucus decision matrix */}
      {data.plays?.length > 0 && (
        <Panel title="If the room is… → motion for">
          <div className="divide-line">
            {data.plays.map((p: any) => (
              <div key={p.id} className="px-3 py-2 grid md:grid-cols-[1fr_1fr_1fr] gap-2 text-[13px]">
                <span>{p.room_state}</span>
                <span style={{ color: 'var(--color-signal)' }}>→ {p.motion}</span>
                <span className="flex items-center gap-2" style={{ color: 'var(--muted)' }}>
                  {p.objective}
                  {p.lead && <span className="chip shrink-0">{p.lead}</span>}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* UNGA powers */}
      {data.ungaPowers && (
        <Panel title="What UNGA can and cannot do">
          <div className="grid md:grid-cols-2 gap-px" style={{ background: 'var(--line)' }}>
            <div className="p-3" style={{ background: 'var(--panel)' }}>
              <div className="section-title mb-1.5" style={{ color: 'var(--color-good)' }}>✓ Can</div>
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{data.ungaPowers.can.join(' · ')}</p>
              <div className="section-title mt-2.5 mb-1">Safe operative verbs</div>
              <div className="flex flex-wrap gap-1">
                {data.ungaPowers.verbs_ok.map((v: string) => <span key={v} className="chip" style={{ color: 'var(--color-good)' }}>{v}</span>)}
              </div>
            </div>
            <div className="p-3" style={{ background: 'var(--panel)' }}>
              <div className="section-title mb-1.5" style={{ color: 'var(--color-bad)' }}>✕ Cannot</div>
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>{data.ungaPowers.cannot.join(' · ')}</p>
              <div className="section-title mt-2.5 mb-1">Verbs to avoid</div>
              <div className="flex flex-wrap gap-1">
                {data.ungaPowers.verbs_avoid.map((v: string) => <span key={v} className="chip" style={{ color: 'var(--color-bad)' }}>{v}</span>)}
              </div>
            </div>
          </div>
        </Panel>
      )}

      <input className="input max-w-md" placeholder="Filter procedure…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="flex flex-col gap-2">
        {rules.length ? rules.map((r: any) => {
          const meta = SOURCE_META[r.source]
          return (
            <div key={r.id} className="panel p-3">
              <div className="flex items-start gap-2 mb-1.5">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="chip">{r.topic}</span>
                    <span className="chip" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>
                  </div>
                  <h3 className="text-[14px] font-medium mt-1">{r.title}</h3>
                </div>
                <button className="btn btn-sm shrink-0" onClick={() => openEdit(r)}>Edit</button>
              </div>
              <p className="text-[13px] whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--muted)' }}>{r.body}</p>
              {r.wording && (
                <div className="mt-2 flex items-center gap-2 panel panel-2 px-2.5 py-1.5">
                  <span className="section-title shrink-0">Say</span>
                  <span className="mono text-[12px] flex-1" style={{ color: 'var(--color-signal)' }}>“{r.wording}”</span>
                  <CopyButton text={r.wording} label="Copy" />
                </div>
              )}
            </div>
          )
        }) : <Empty title="No procedure cards match" />}
      </div>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.title}>
        <div className="flex flex-col gap-2.5">
          <div>
            <div className="section-title mb-1">Authority</div>
            <select className="select" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
              <option value="RPS_CONFIRMED">CONFIRMED FROM RPS MATERIAL — the Chair announced this</option>
              <option value="GENERAL_PRACTICE">GENERAL MUN PRACTICE — typical, unconfirmed</option>
              <option value="NOT_SPECIFIED">NOT SPECIFIED — unknown for this conference</option>
            </select>
            <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{SOURCE_META[draft.source].note}</p>
          </div>
          <div>
            <div className="section-title mb-1">Body</div>
            <textarea className="textarea" rows={7} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          </div>
          <div>
            <div className="section-title mb-1">Exact wording to say</div>
            <input className="input" value={draft.wording} onChange={(e) => setDraft({ ...draft, wording: e.target.value })} />
          </div>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </Modal>
    </div>
  )
}
