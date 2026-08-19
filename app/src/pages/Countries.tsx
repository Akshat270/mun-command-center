// Country intelligence + the bloc board on one screen. During an unmoderated
// caucus this is the page that stays open.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Spinner, InlineEdit } from '../components/ui'

export const BLOC_STATUS = [
  { key: 'strong_ally', label: 'Strong ally', dot: '🟢', color: 'var(--color-good)' },
  { key: 'potential_ally', label: 'Potential ally', dot: '🟡', color: 'var(--color-warn)' },
  { key: 'neutral', label: 'Neutral', dot: '🔵', color: 'var(--color-signal)' },
  { key: 'opposed', label: 'Opposed', dot: '🟠', color: '#e08a3e' },
  { key: 'strongly_opposed', label: 'Strongly opposed', dot: '🔴', color: 'var(--color-bad)' },
]

export function Countries() {
  const navigate = useNavigate()
  const { toast } = useApp()
  const [countries, setCountries] = useState<any[]>([])
  const [bloc, setBloc] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    Promise.all([api.countries(), api.bloc()])
      .then(([c, b]) => { setCountries(c); setBloc(b) })
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const setStatus = async (code: string, status: string) => {
    setCountries((prev) => prev.map((c) => (c.code === code ? { ...c, bloc_status: status } : c)))
    setBloc((prev) => prev.map((b) => (b.country_code === code ? { ...b, status } : b)))
    await api.patch(`/api/countries/${code}`, { bloc_status: status }).catch(() => {})
  }

  const saveBloc = async (code: string, field: string, value: string) => {
    setBloc((prev) => prev.map((b) => (b.country_code === code ? { ...b, [field]: value } : b)))
    await api.put(`/api/bloc/${code}`, { [field]: value }).catch(() => toast('Could not save', 'bad'))
  }

  if (loading) return <div className="p-4"><Spinner label="Loading country intelligence…" /></div>

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1100px]">
      <Panel title="Country intelligence">
        <div className="divide-line">
          {countries.map((c) => (
            <button key={c.code} onClick={() => navigate(`/countries/${c.code}`)}
              className="w-full text-left px-3 py-2.5 flex items-start gap-3">
              <span className="text-lg shrink-0">{c.flag}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-[14px]">{c.name}</span>
                  {Boolean(c.is_ours) && <span className="chip" style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}>OUR COUNTRY</span>}
                  <span className="chip">{BLOC_STATUS.find((s) => s.key === c.bloc_status)?.dot} {BLOC_STATUS.find((s) => s.key === c.bloc_status)?.label}</span>
                </div>
                <p className="text-[12px] mt-0.5 line-clamp-2" style={{ color: 'var(--muted)' }}>{c.identity}</p>
                <div className="flex gap-3 mt-1 text-[11px]" style={{ color: 'var(--faint)' }}>
                  <span><b>Leads:</b> {c.lead_topic}</span>
                  <span><b>Vulnerable:</b> {c.main_vulnerability}</span>
                </div>
              </div>
              <span style={{ color: 'var(--faint)' }}>›</span>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Bloc board" actions={
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Click any field to edit</span>
      }>
        <div className="grid md:grid-cols-2 gap-px" style={{ background: 'var(--line)' }}>
          {countries.map((c) => {
            const b = bloc.find((x) => x.country_code === c.code) || {}
            const status = BLOC_STATUS.find((s) => s.key === c.bloc_status)
            return (
              <div key={c.code} className="p-3 flex flex-col gap-2" style={{ background: 'var(--panel)' }}>
                <div className="flex items-center gap-2">
                  <span>{c.flag}</span>
                  <span className="font-medium text-[13px] flex-1">{c.name}</span>
                  <select className="select max-w-[150px] text-[11px] py-1"
                    value={c.bloc_status} onChange={(e) => setStatus(c.code, e.target.value)}
                    style={{ color: status?.color }}>
                    {BLOC_STATUS.map((s) => <option key={s.key} value={s.key}>{s.dot} {s.label}</option>)}
                  </select>
                </div>
                <BlocField label="Agreed to" value={b.agreed} onSave={(v) => saveBloc(c.code, 'agreed', v)} />
                <BlocField label="Disagrees on" value={b.disagreed} onSave={(v) => saveBloc(c.code, 'disagreed', v)} />
                <BlocField label="Proposed clauses" value={b.proposed} onSave={(v) => saveBloc(c.code, 'proposed', v)} />
                <BlocField label="Promises made" value={b.promises} onSave={(v) => saveBloc(c.code, 'promises', v)} />
                <BlocField label="Concerns" value={b.concerns} onSave={(v) => saveBloc(c.code, 'concerns', v)} />
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

function BlocField({ label, value, onSave }: { label: string; value?: string; onSave: (v: string) => void }) {
  return (
    <div>
      <div className="section-title">{label}</div>
      <InlineEdit value={value || ''} onSave={onSave} multiline
        placeholder="—" className="text-[12px] leading-snug" />
    </div>
  )
}
