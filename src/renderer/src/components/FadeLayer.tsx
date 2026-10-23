import { useEffect, useRef, useState } from 'react'
import { playback } from '../playback'

// Through-play preview of the fade setting: black over the picture near the clip's IN and OUT, as
// the export does with ffmpeg's fade. A title card fades the same way over its own length; it has
// no video time to follow, so that fade runs as one animation started when the card comes up.
export function FadeLayer({ range, sec }: { range: { in: number; out: number } | null; sec: number }) {
  const opacityAt = (t: number) => {
    if (playback.current.card || !range) return 0
    const d = Math.min(sec, (range.out - range.in) / 3)
    const k = d > 0 ? Math.min(1, Math.max(0, Math.min(t - range.in, range.out - t) / d)) : 1
    return Math.round((1 - k) * 50) / 50 // steps of 0.02: no re-render while it stays clear
  }
  const [opacity, setOpacity] = useState(() => opacityAt(playback.current.time))
  const [card, setCard] = useState(playback.current.card)
  useEffect(() => playback.subscribe(s => { setOpacity(opacityAt(s.time)); setCard(s.card) }), [range?.in, range?.out, sec])
  const el = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const total = playback.current.cardSec
    if (!card || !el.current || total <= 0) return
    const p = Math.min(sec, total / 3) / total
    const a = el.current.animate([{ opacity: 1 }, { opacity: 0, offset: p }, { opacity: 0, offset: 1 - p }, { opacity: 1 }], { duration: total * 1000, fill: 'forwards' })
    return () => a.cancel()
  }, [card, sec])
  return <div ref={el} className="fade-layer" style={{ opacity }} aria-hidden />
}
