// Practice mode. The AI plays an opposing delegate and presses the real
// weaknesses in your position, then evaluates the answer. Optional, and
// entirely separate from the live tools.

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Panel, Empty, Spinner, AIBanner, useTimer, TimerDisplay } from '../components/ui'
import { AnalysisCard } from '../components/AnalysisCard'

/**
 * Opponents are the delegations you have researched, minus your own — the AI
 * plays one of them. `lead_topic` from the dossier becomes the note under the
 * picker, so the hint reflects your own research rather than a fixed opinion
 * about what each country argues.
 */
type Opponent = { code: string; name: string; flag?: string; note?: string }

// Shown only until the countries load, and if the delegate has not filled in any
// dossiers yet. Practice still works against a bare name.
const FALLBACK: Opponent[] = [{ code: '', name: 'An opposing delegation', note: 'Add countries to practise against your real opponents' }]

// Generic debate topics. The delegate can type their own — this select is a
// shortcut, not a fixed list, so it should not assume an agenda.
const TOPICS = ['Our strongest clause', 'Our weakest point', 'Implementation and cost',
  'Capacity and assistance', 'Timelines', 'Accountability and reporting',
  'Our delegation\'s own record', 'Scope of the mandate']

export function Practice() {
  const { aiAvailable, toast } = useApp()
  const [opponents, setOpponents] = useState<Opponent[]>(FALLBACK)
  const [opponent, setOpponent] = useState<Opponent>(FALLBACK[0])

  useEffect(() => {
    api.countries().then((list) => {
      const others = (list || [])
        .filter((c: any) => !c.is_ours)
        .map((c: any) => ({ code: c.code, name: c.name, flag: c.flag, note: c.lead_topic || undefined }))
      if (others.length) { setOpponents(others); setOpponent(others[0]) }
    }).catch(() => {})
  }, [])
  const [topic, setTopic] = useState('')
  const [difficulty, setDifficulty] = useState('medium')
  const [challenge, setChallenge] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [evaluation, setEvaluation] = useState<any>(null)
  const [busy, setBusy] = useState<'challenge' | 'evaluate' | null>(null)
  const timer = useTimer()

  const getChallenge = async () => {
    setBusy('challenge'); setChallenge(null); setEvaluation(null); setAnswer('')
    try {
      const res = await api.practiceChallenge({ opponentCountry: opponent.name, topic, difficulty })
      if (res.ok) { setChallenge(res.statement); timer.start(45) }
      else toast(res.reason, 'warn')
    } catch (e: any) { toast(e.message, 'bad') } finally { setBusy(null) }
  }

  const evaluate = async () => {
    if (!answer.trim() || !challenge) return
    setBusy('evaluate'); setEvaluation(null); timer.reset()
    try {
      const res = await api.practiceEvaluate({
        opponentCountry: opponent.name, opponentStatement: challenge, delegateAnswer: answer,
      })
      setEvaluation(res)
      if (!res.ok) toast(res.reason, 'warn')
    } catch (e: any) { toast(e.message, 'bad') } finally { setBusy(null) }
  }

  return (
    <div className="p-4 flex flex-col gap-3 max-w-[900px]">
      <Panel title="Practice — the AI plays an opposing delegate">
        <div className="p-3 flex flex-col gap-3">
          {!aiAvailable && <AIBanner reason="Practice mode needs an API key. All prepared speeches, POIs and defences work offline." />}

          <div>
            <div className="section-title mb-1.5">Opponent</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              {opponents.map((o) => (
                <button key={o.code} className="btn text-left"
                  style={opponent.code === o.code ? { borderColor: 'var(--color-accent)' } : {}}
                  onClick={() => setOpponent(o)} title={o.note}>
                  {o.flag} {o.name}
                </button>
              ))}
            </div>
            <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{opponent.note}</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <div className="section-title mb-1">Topic (optional)</div>
              <select className="select" value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">Any — let them choose</option>
                {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <div className="section-title mb-1">Difficulty</div>
              <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easy">Easy — a straightforward question</option>
                <option value="medium">Medium — a real challenge</option>
                <option value="hard">Hard — the sharpest attack they have</option>
              </select>
            </div>
          </div>

          <button className="btn btn-primary" onClick={getChallenge} disabled={busy !== null || !aiAvailable}>
            {busy === 'challenge' ? 'Thinking…' : `Get a challenge from ${opponent.name}`}
          </button>
        </div>
      </Panel>

      {busy === 'challenge' && <div className="p-3"><Spinner label="The opposing delegate is preparing…" /></div>}

      {challenge && (
        <>
          <Panel title={`${opponent.flag} ${opponent.name} says`} actions={<TimerDisplay t={timer} />}>
            <p className="px-3 py-3 text-[17px] leading-relaxed">“{challenge}”</p>
          </Panel>

          <Panel title="Your response" actions={
            <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
              Answer as you would out loud — then check it
            </span>
          }>
            <div className="p-3 flex flex-col gap-2">
              <textarea className="textarea text-[15px]" rows={5} value={answer} autoFocus
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Acknowledge the legitimate point → state your delegation's actual position → return to the mechanism…" />
              <div className="flex items-center gap-2">
                <button className="btn btn-primary" onClick={evaluate} disabled={!answer.trim() || busy !== null}>
                  {busy === 'evaluate' ? 'Evaluating…' : 'Evaluate my answer'}
                </button>
                <button className="btn" onClick={getChallenge}>New challenge</button>
                <div className="flex-1" />
                <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                  {answer.trim().split(/\s+/).filter(Boolean).length} words ·
                  ≈{Math.round(answer.trim().split(/\s+/).filter(Boolean).length / 2.5)}s spoken
                </span>
              </div>
            </div>
          </Panel>
        </>
      )}

      {busy === 'evaluate' && <div className="p-3"><Spinner label="Evaluating…" /></div>}
      {evaluation && <AnalysisCard result={evaluation} />}

      {!challenge && !busy && (
        <Empty icon="⟳" title="Practice before the conference"
          hint="Pick an opponent and get a real challenge. The AI presses the genuine weaknesses recorded in your country dossier — not strawmen." />
      )}
    </div>
  )
}
