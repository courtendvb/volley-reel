import { useEffect, useRef, useState } from 'react'
import { drawCourt, flightMoves, handleAt, type CourtFit, type Flight, type GridStyle, type PlayZones, type Pt } from '../../../shared/court'
import { playback } from '../playback'
import { prepareCanvas } from '../canvas'

interface Props {
  size: { w: number; h: number }
  fit: CourtFit
  style: GridStyle
  zones: PlayZones | null
  flight: Flight | null // when the selected play's ball flies (the moving curve)
  fitting: boolean // the corners can be dragged; clicks don't reach the layers underneath
  onCorners: (corners: CourtFit['corners']) => void // when a drag ends
  onPoint?: (p: Pt) => boolean // a click on the picture (0..1); true when it was for the court
}

const HANDLE = 10
const HIT = 18

// The court grid (CourtEnd Vision) and the selected play's zones. Under the scoreboard and the
// annotations; while fitting it sits on top and the four corners are dragged onto the court.
export function CourtLayer({ size, fit, style, zones, flight, fitting, onCorners, onPoint }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drag, setDrag] = useState<{ i: number; corners: CourtFit['corners'] } | null>(null)
  const corners = drag?.corners ?? fit.corners

  // How far the curve has gone, in steps, so the layer redraws only while the ball is flying.
  const flies = !fitting && !!flight && flightMoves(style, zones)
  const [progress, setProgress] = useState(1)
  useEffect(() => {
    if (!flies || !flight) { setProgress(1); return }
    return playback.subscribe(s => setProgress(Math.round(Math.max(0, Math.min(1, (s.time - flight.startSec) / flight.sec)) * 40) / 40))
  }, [flies, flight?.startSec, flight?.sec])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, size.w, size.h)
    // While fitting the grid is always drawn, so the lines can be laid on the court's.
    drawCourt(ctx, size.w, size.h, { ...fit, corners }, fitting ? { ...style, grid: true } : style, fitting ? null : zones, flies ? progress : 1)
    if (!fitting) return
    for (const p of corners) {
      const at = handleAt(p, size.w, size.h, HANDLE + 2), x = at.x * size.w, y = at.y * size.h
      ctx.beginPath(); ctx.arc(x, y, HANDLE + 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fill()
      ctx.beginPath(); ctx.arc(x, y, HANDLE, 0, Math.PI * 2); ctx.fillStyle = style.color; ctx.fill()
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill()
    }
  }, [size.w, size.h, fit, corners, style, zones, fitting, flies, progress])

  // Clicks are looked at before the layers above see them, and pass on when they aren't for the court.
  const point = useRef(onPoint)
  point.current = onPoint
  useEffect(() => {
    const box = canvas.current?.parentElement
    if (!box) return
    const click = (e: MouseEvent) => {
      if (!point.current || (e.target as Element).closest('.shot-pick')) return
      const r = canvas.current!.getBoundingClientRect()
      if (point.current({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height })) { e.stopPropagation(); e.preventDefault() }
    }
    box.addEventListener('click', click, true)
    return () => box.removeEventListener('click', click, true)
  }, [])

  const pointAt = (e: React.PointerEvent): Pt => {
    const r = canvas.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const hit = (p: Pt) => {
    let best = -1, bestD = HIT
    corners.forEach((c, i) => { const at = handleAt(c, size.w, size.h, HANDLE + 2), d = Math.hypot((at.x - p.x) * size.w, (at.y - p.y) * size.h); if (d < bestD) { best = i; bestD = d } })
    return best
  }

  return (
    <canvas
      ref={canvas} className="court-layer" data-testid="court-canvas"
      style={{ width: size.w, height: size.h, pointerEvents: fitting ? 'auto' : 'none', cursor: drag ? 'grabbing' : undefined }}
      onPointerDown={e => {
        const i = hit(pointAt(e))
        if (i < 0) return
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
        setDrag({ i, corners })
      }}
      onPointerMove={e => {
        const p = pointAt(e)
        if (!drag) { e.currentTarget.style.cursor = hit(p) >= 0 ? 'grab' : ''; return }
        const next = [...drag.corners] as CourtFit['corners']
        next[drag.i] = p
        setDrag({ ...drag, corners: next })
      }}
      onPointerUp={() => { if (drag) { onCorners(drag.corners); setDrag(null) } }}
      onPointerCancel={() => setDrag(null)}
    />
  )
}
