import { useEffect, useState } from 'react'
import { playback } from '../playback'

// Through-play preview of the fade setting: black over the picture near the clip's IN and OUT, as
// the export does with ffmpeg's fade (title cards are not faded in the preview).
export function FadeLayer({ range, sec }: { range: { in: number; out: number }; sec: number }) {
  const [t, setT] = useState(playback.current.time)
  useEffect(() => playback.subscribe(s => setT(s.time)), [])
  const d = Math.min(sec, (range.out - range.in) / 3)
  const k = d > 0 ? Math.min(1, Math.max(0, Math.min(t - range.in, range.out - t) / d)) : 1
  return <div className="fade-layer" style={{ opacity: playback.current.card ? 0 : 1 - k }} aria-hidden />
}
