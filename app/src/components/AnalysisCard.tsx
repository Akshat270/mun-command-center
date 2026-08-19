// Renders a structured AI analysis.
//
// Three things this component must always do:
//   1. label the output as AI-generated and as a *possible* response
//   2. make every citation clickable back to the exact source passage
//   3. surface low confidence loudly, and any fabricated citation louder still

import { useApp } from '../lib/store'
import { Badge, CopyButton, AIBanner } from './ui'

const CONFIDENCE_COLOR: Record<string, string> = {
  High: 'var(--color-good)', Medium: 'var(--color-warn)',
  Low: 'var(--color-bad)', Unknown: 'var(--faint)',
}

// Headings the delegate acts on directly get emphasis; the rest are supporting.
const PRIMARY = new Set(['RESPONSE', 'OUR_STRONGEST_ANSWER', 'STRONGER_VERSION', 'SUGGESTED_REWORDING'])
const WARNING = new Set(['DO_NOT_SAY', 'FLAGS', 'LIKELY_FOLLOW-UP_ATTACK', 'WHAT_YOU_EXPOSED'])

function prettyHeading(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export function AnalysisCard({ result, compact }: { result: any; compact?: boolean }) {
  const viewSource = useApp((s) => s.viewSource)

  if (!result) return null
  if (!result.ok) return <AIBanner reason={result.reason} />

  const { sections = {}, citations = [], confidence, fabricatedCitations = [], latencyMs, model } = result
  const order = Object.keys(sections).filter((k) => k !== '_preamble' && k !== 'CONFIDENCE')

  return (
    <div className="panel fade-in" style={{ borderColor: 'var(--color-ink-600)' }}>
      <header className="flex items-center gap-2 px-3 py-1.5 border-b flex-wrap">
        <Badge kind="AI" />
        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Possible response — you decide what to say</span>
        <div className="flex-1" />
        {confidence && (
          <span className="chip" style={{ color: CONFIDENCE_COLOR[confidence], borderColor: CONFIDENCE_COLOR[confidence] }}>
            {confidence} confidence
          </span>
        )}
        {latencyMs != null && <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{(latencyMs / 1000).toFixed(1)}s</span>}
      </header>

      {confidence === 'Low' && (
        <div className="px-3 py-1.5 text-[12px] border-b"
          style={{ background: '#d4544a18', color: 'var(--color-bad)' }}>
          ⚠ Low confidence — verify before using.
        </div>
      )}

      {fabricatedCitations.length > 0 && (
        <div className="px-3 py-1.5 text-[12px] border-b"
          style={{ background: '#d4544a18', color: 'var(--color-bad)' }}>
          ⚠ {fabricatedCitations.length} citation{fabricatedCitations.length > 1 ? 's' : ''} referenced a source that was
          not provided and {fabricatedCitations.length > 1 ? 'have' : 'has'} been removed. Treat the surrounding
          claim as unsupported.
        </div>
      )}

      <div className="divide-line">
        {order.map((key) => {
          const body = sections[key]
          const isPrimary = PRIMARY.has(key)
          const isWarning = WARNING.has(key)
          return (
            <div key={key} className="px-3 py-2">
              <div className="flex items-center gap-2 mb-1">
                <span className="section-title" style={{ color: isWarning ? 'var(--color-bad)' : undefined }}>
                  {prettyHeading(key)}
                </span>
                {isPrimary && <CopyButton text={body} label="Copy" className="btn btn-sm ml-auto" />}
              </div>
              <p className={`whitespace-pre-wrap leading-relaxed ${isPrimary ? 'text-[15px]' : 'text-[13px]'}`}
                style={{ color: isPrimary ? 'var(--text)' : 'var(--muted)' }}>
                {body}
              </p>
            </div>
          )
        })}
      </div>

      {citations.length > 0 && (
        <div className="px-3 py-2 border-t">
          <div className="section-title mb-1.5">Sources</div>
          <div className="flex flex-col gap-1">
            {citations.map((c: any) => (
              <button key={c.label} onClick={() => viewSource(c.chunkId)}
                className="text-left text-[12px] flex items-start gap-2 hover:underline">
                <span className={`chip prio-${c.priority} shrink-0`}>{c.label}</span>
                <span className="flex-1 min-w-0">
                  <span style={{ color: 'var(--color-signal)' }}>{c.documentTitle}</span>
                  <span style={{ color: 'var(--faint)' }}>
                    {c.heading ? ` — ${c.heading}` : ''} · {c.pageLabel}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!compact && model && (
        <div className="px-3 py-1 border-t text-[10px]" style={{ color: 'var(--faint)' }}>
          {model} · {result.provider}
        </div>
      )}
    </div>
  )
}
