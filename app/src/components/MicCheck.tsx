// Is sound actually reaching the app?
//
// The Web Speech API always uses the Windows *default* input device and gives
// no way to choose another and no feedback about what it is hearing. A laptop
// that has defaulted to a webcam array mic, or to a Bluetooth headset left
// paired from yesterday, produces a perfectly healthy-looking recording session
// that transcribes nothing at all.
//
// This is the only way to see that from inside the app: open the same default
// device with getUserMedia, measure it, and say so plainly.

import { useEffect, useRef, useState } from 'react'

/** Below this RMS there is effectively nothing on the input. */
const FLOOR = 0.012
/** Silence for this long while recording is worth warning about. */
const SILENCE_WARN_MS = 10_000

type Props = {
  /** Only warn about silence while the delegate believes it is recording. */
  listening?: boolean
  /** Compact form for a panel header; the full form is used in Settings. */
  compact?: boolean
}

export function MicCheck({ listening = false, compact = false }: Props) {
  const [level, setLevel] = useState(0)
  const [device, setDevice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [silent, setSilent] = useState(false)

  const raf = useRef<number | null>(null)
  const lastSoundAt = useRef(Date.now())
  const listeningRef = useRef(listening)
  listeningRef.current = listening

  useEffect(() => {
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    let cancelled = false

    async function open() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }

        // The label is only populated once permission has been granted, which
        // is why this runs after getUserMedia rather than before it.
        setDevice(stream.getAudioTracks()[0]?.label || null)

        ctx = new AudioContext()
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        ctx.createMediaStreamSource(stream).connect(analyser)

        const data = new Float32Array(analyser.fftSize)
        lastSoundAt.current = Date.now()
        let lastPaint = 0
        let peak = 0

        const tick = () => {
          analyser.getFloatTimeDomainData(data)
          let sum = 0
          for (const v of data) sum += v * v
          const rms = Math.sqrt(sum / data.length)
          if (rms > peak) peak = rms

          if (rms > FLOOR) lastSoundAt.current = Date.now()

          // Measure every frame, but repaint ~12x a second. Calling setLevel on
          // each frame re-rendered this component 60 times a second for the
          // whole of committee, for a bar that cannot show that detail anyway.
          const now = Date.now()
          if (now - lastPaint >= 80) {
            lastPaint = now
            setLevel(peak)
            peak = 0
            setSilent(listeningRef.current && now - lastSoundAt.current > SILENCE_WARN_MS)
          }

          raf.current = requestAnimationFrame(tick)
        }
        tick()
      } catch (err: any) {
        setError(
          err?.name === 'NotAllowedError'
            ? 'Microphone blocked — allow access to see the input level.'
            : 'No microphone available.'
        )
      }
    }

    // requestAnimationFrame is suspended while the tab is hidden, so no sound
    // is observed for however long the delegate was on another tab. Without
    // this the clock keeps running and coming back shows an instant, false
    // "no sound is reaching the app".
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        lastSoundAt.current = Date.now()
        setSilent(false)
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    open()
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (raf.current) cancelAnimationFrame(raf.current)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close().catch(() => {})
    }
  }, [])

  // Log scale: speech sits far below full scale, and a linear bar barely moves.
  const pct = Math.min(100, Math.round((Math.log10(Math.max(level, 1e-4)) + 4) * 28))
  const bar = (
    <div title={device || 'Input level'}
      style={{ width: compact ? 46 : 120, height: 6, borderRadius: 3, background: 'var(--panel-2)', overflow: 'hidden' }}>
      <div style={{
        width: `${pct}%`, height: '100%',
        background: silent ? 'var(--color-bad)' : level > FLOOR ? 'var(--color-good)' : 'var(--faint)',
        transition: 'width 80ms linear',
      }} />
    </div>
  )

  if (compact) {
    return (
      <span className="flex items-center gap-1.5" title={
        error || (silent ? 'No sound is reaching the app' : device ? `Input: ${device}` : 'Input level')
      }>
        {bar}
        {silent && <span style={{ color: 'var(--color-bad)', fontSize: 11 }}>no sound</span>}
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <div className="flex items-center gap-2">
        {bar}
        <span style={{ color: 'var(--faint)' }}>{error || device || 'Detecting input device…'}</span>
      </div>
      {silent && (
        <div style={{ color: 'var(--color-bad)' }}>
          No sound is reaching the app. Windows is probably using the wrong microphone —
          check Settings → System → Sound → Input.
        </div>
      )}
      <div style={{ color: 'var(--faint)' }}>
        Browser speech recognition always uses the Windows default input device and cannot be
        pointed at another one. Change it in Windows Sound settings, then start listening again.
      </div>
    </div>
  )
}
