import { useEffect, useState } from 'react'
import { playback } from '../playback'

// Through-play preview of the fade setting: black over the picture near the clip's IN and OUT, as
// the export does with ffmpeg's fade (title cards are not faded in the preview).
export function FadeLayer({ range, sec }: { range: { in: number; out: number }; sec: number }) {
  const opacityAt = (t: number) => {
    if (playback.current.card) return 0
    const d = Math.min(sec, (range.out - range.in) / 3)
    const k = d > 0 ? Math.min(1, Math.max(0, Math.min(t - range.in, range.out - t) / d)) : 1
    return Math.round((1 - k) * 50) / 50 // steps of 0.02: no re-render while it stays clear
  }
  const [opacity, setOpacity] = useState(() => opacityAt(playback.current.time))
  useEffect(() => playback.subscribe(s => setOpacity(opacityAt(s.time))), [range.in, range.out, sec])
  return <div className="fade-layer" style={{ opacity }} aria-hidden />
}
