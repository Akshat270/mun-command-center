// "View source" — opens the exact chunk an AI answer or search hit came from,
// with its neighbours for context. This is what makes citations checkable
// rather than decorative.

import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Modal, PriorityChip, Spinner, CopyButton } from './ui'

export function SourceViewer() {
  const { sourceChunkId, viewSource } = useApp()
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!sourceChunkId) { setData(null); setError(null); return }
    setLoading(true); setError(null)
    api.source(sourceChunkId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [sourceChunkId])

  return (
    <Modal open={Boolean(sourceChunkId)} onClose={() => viewSource(null)} wide
      title={data ? data.doc_title : 'Source'}>
      {loading && <Spinner label="Opening source…" />}
      {error && <div className="text-[13px]" style={{ color: 'var(--color-bad)' }}>{error}</div>}
      {data && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            <PriorityChip priority={data.priority} />
            <span className="chip">{data.category}</span>
            <span className="chip">{data.pageLabel}</span>
            {data.heading && <span className="chip">{data.heading}</span>}
            <span className="mono truncate" title={data.path}>{data.filename}</span>
          </div>

          <div className="flex flex-col gap-2">
            {data.context.map((c: any) => {
              const isTarget = c.id === sourceChunkId
              return (
                <div key={c.id} className="panel p-3 text-[13px] whitespace-pre-wrap leading-relaxed"
                  style={{
                    borderColor: isTarget ? 'var(--color-signal)' : 'var(--line)',
                    background: isTarget ? 'var(--panel-2)' : 'transparent',
                    opacity: isTarget ? 1 : 0.62,
                  }}>
                  {isTarget && (
                    <div className="section-title mb-1.5" style={{ color: 'var(--color-signal)' }}>
                      Cited passage
                    </div>
                  )}
                  {c.text}
                </div>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
              The original file on disk is never modified.
            </span>
            <CopyButton text={data.text} label="Copy passage" />
          </div>
        </div>
      )}
    </Modal>
  )
}
