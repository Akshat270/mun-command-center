// Full country dossier + Defense Mode. When a country attacks your delegation, this
// is the page you open.

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Spinner, CopyButton, AIBanner } from '../components/ui'
import { AnalysisCard } from '../components/AnalysisCard'

export function CountryDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const { aiAvailable, session, toast } = useApp()
  const [c, setC] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [defense, setDefense] = useState<any>(null)
  const [defenseLoading, setDefenseLoading] = useState(false)
  const [attackText, setAttackText] = useState('')

  useEffect(() => {
    setLoading(true); setDefense(null)
    api.country(code!).then(setC).catch(() => setC(null)).finally(() => setLoading(false))
  }, [code])

  const runDefense = async () => {
    setDefenseLoading(true); setDefense(null)
    try {
      const res = await api.defense({ country: code, statement: attackText, sessionId: session?.id })
      setDefense(res)
      if (!res.ok) toast(res.reason, 'warn')
    } catch (e: any) { toast(e.message, 'bad') } finally { setDefenseLoading(false) }
  }

  if (loading) return <div className="p-4"><Spinner label="Loading dossier…" /></div>
  if (!c) return <div className="p-4"><Empty title="Country not found" /></div>

  return (
    <div className="p-4 flex flex-col gap-4 max-w-[1000px]">
      <div className="flex items-center gap-3">
        <button className="btn btn-sm" onClick={() => navigate('/countries')}>← All countries</button>
        <span className="text-2xl">{c.flag}</span>
        <h1 className="text-lg font-semibold">{c.name}</h1>
        {Boolean(c.is_ours) && (
          <span className="chip" style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent)' }}>
            OUR COUNTRY
          </span>
        )}
      </div>

      <Panel title="Identity">
        <p className="px-3 py-2.5 text-[14px] leading-relaxed">{c.identity}</p>
        <div className="grid sm:grid-cols-3 gap-px border-t" style={{ background: 'var(--line)' }}>
          <Field label="Leads on" value={c.lead_topic} />
          <Field label="Main vulnerability" value={c.main_vulnerability} />
          <Field label="Resolution fit" value={c.resolution_fit} />
        </div>
      </Panel>

      {c.caution && (
        <div className="panel px-3 py-2.5 text-[13px]" style={{ borderColor: 'var(--color-warn)' }}>
          <div className="section-title mb-1" style={{ color: 'var(--color-warn)' }}>⚠ Caution — do not treat as settled fact</div>
          <p style={{ color: 'var(--muted)' }}>{c.caution}</p>
        </div>
      )}

      {/* Defense Mode */}
      <Panel title="Defense mode" actions={
        <button className="btn btn-sm btn-primary" onClick={runDefense}
          disabled={defenseLoading || !aiAvailable}>
          {defenseLoading ? 'Preparing…' : `Prepare defense vs ${c.name}`}
        </button>
      }>
        <div className="p-3 flex flex-col gap-2">
          {!aiAvailable && <AIBanner reason="Defense mode needs an API key. The attack→defense table below is available offline." />}
          <textarea className="textarea" rows={2} value={attackText}
            onChange={(e) => setAttackText(e.target.value)}
            placeholder={`Optional: paste exactly what ${c.name} said, for a sharper defense…`} />
          {defenseLoading && <Spinner label="Building defense — usually under 10 seconds…" />}
          {defense && <AnalysisCard result={defense} />}
        </div>
      </Panel>

      {/* Attack -> defense table: the offline version of the above */}
      <Panel title="Likely attacks → prepared answers">
        <div className="divide-line">
          {c.attacks_defenses.map((d: any, i: number) => (
            <div key={i} className="px-3 py-2.5">
              <div className="text-[13px] font-medium" style={{ color: 'var(--color-bad)' }}>“{d.attack}”</div>
              <div className="text-[13px] mt-1 flex gap-2">
                <span style={{ color: 'var(--color-good)' }}>→</span>
                <span style={{ color: 'var(--muted)' }}>{d.defense}</span>
                <CopyButton text={d.defense} label="Copy" className="btn btn-sm shrink-0 ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid md:grid-cols-2 gap-4">
        <ListPanel title="Facts to know" items={c.facts} numbered />
        <ListPanel title="Legal references" items={c.legal_refs} />
        <ListPanel title="Strengths" items={c.strengths} tone="var(--color-good)" />
        <ListPanel title="Vulnerabilities" items={c.vulnerabilities} tone="var(--color-bad)" />
        {c.should_lead_on?.length > 0 && <ListPanel title="Should lead on" items={c.should_lead_on} />}
        {c.questions_to_ask?.length > 0 && <ListPanel title="Questions this country asks" items={c.questions_to_ask} />}
      </div>

      <Panel title="Coalition">
        <div className="grid sm:grid-cols-2 gap-px" style={{ background: 'var(--line)' }}>
          <Field label="Likely allies" value={c.likely_allies} />
          <Field label="Likely opponents" value={c.likely_opponents} />
          <Field label="How we work together" value={c.cooperation} wide />
        </div>
      </Panel>

      <div className="flex gap-2">
        <button className="btn" onClick={() => navigate(`/pois?target=${c.code}`)}>
          POIs targeting {c.name}
        </button>
        <button className="btn" onClick={() => navigate(`/research?q=${encodeURIComponent(c.name)}`)}>
          Search documents for {c.name}
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className={`px-3 py-2 ${wide ? 'sm:col-span-2' : ''}`} style={{ background: 'var(--panel)' }}>
      <div className="section-title">{label}</div>
      <div className="text-[13px] mt-0.5">{value || '—'}</div>
    </div>
  )
}

function ListPanel({ title, items, numbered, tone }: {
  title: string; items: string[]; numbered?: boolean; tone?: string
}) {
  if (!items?.length) return null
  return (
    <Panel title={title}>
      <ol className="px-3 py-2 flex flex-col gap-1.5 text-[13px]">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0" style={{ color: tone || 'var(--faint)' }}>
              {numbered ? `${i + 1}.` : '•'}
            </span>
            <span style={{ color: 'var(--muted)' }}>{t}</span>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
