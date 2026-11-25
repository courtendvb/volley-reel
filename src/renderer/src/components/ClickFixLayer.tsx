import { useEffect, useRef, useState } from 'react'
import { floorUnder, homography, project, shownAbove } from '../../../shared/courtGeometry'
import { cellOf, pointOf } from '../../../shared/codeEdit'
import type { CourtFit } from '../../../shared/court'
import { t } from '../../../shared/i18n'

type XY = { x: number; y: number }

// Over the video, while a play's clicks are being corrected on the fitted court. Its points as they are now show
// (green the start, red the end): drag one to move it alone, or drag anywhere else from where the play starts to
// where it ends to put both. The points are the ball, at the heights its code gives (clickHeights: struck in the
// air, landing on the floor...): each goes on the floor under it (the camera worked out from the court's corners),
// and a dotted line drops from the ball to that spot, so it can be checked against the player's feet. The spots
// become the scout's cells for the play's own half (near: the play's team is on the camera's side). It stays on
// for another try; Enter or ↓ goes to the next play, ↑ the one before; Esc or the Edit tab's button ends it.
export function ClickFixLayer({ size, fit, near, cells, heights, onDone, onMove, onCancel }: {
  size: { w: number; h: number }
  fit: CourtFit
  near: boolean
  cells: { start: string; end: string } | undefined // the play's clicks now
  heights: { start: number; end: number } // metres above the floor of the ball at each click
  onDone: (start: string, end: string) => void
  onMove: (dir: 1 | -1) => void
  onCancel: () => void
}) {
  const [drag, setDrag] = useState<{ which: 'start' | 'end' | 'both'; a: XY; b: XY } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus({ preventScroll: true }) }, []) // so the keys reach it
  const local = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  const H = homography(fit.corners)
  // Court units (u across, v far to near as the camera sees it) of a cell, and back.
  const courtOf = (cell: string | undefined): XY | null => {
    const p = pointOf(cell)
    return p ? (near ? { x: p.u, y: 1 - p.v } : { x: 1 - p.u, y: p.v }) : null
  }
  const px = (q: XY): XY => ({ x: q.x * size.w, y: q.y * size.h })
  const ball = (c: XY | null, z: number): XY | null => (c ? px(shownAbove(fit.corners, size.w, size.h, c.x, c.y, z)) : null)
  const floorOf = (p: XY, z: number): XY | null => floorUnder(fit.corners, size.w, size.h, { x: p.x / size.w, y: p.y / size.h }, z)
  const foot = (p: XY | null, z: number): XY | null => { const f = p && floorOf(p, z); return f ? px(project(H, f.x, f.y)) : null }
  const cell = (p: XY, z: number): string | null => {
    const f = floorOf(p, z)
    if (!f) return null
    return cellOf(near ? { u: f.x, v: 1 - f.y } : { u: 1 - f.x, v: f.y })
  }
  const s0 = ball(courtOf(cells?.start), heights.start), e0 = ball(courtOf(cells?.end), heights.end)
  const close = (a: XY | null, p: XY) => !!a && Math.hypot(a.x - p.x, a.y - p.y) < 14
  // What shows: the points as they are, or as the drag moves them.
  const shownStart = !drag ? s0 : drag.which === 'start' ? drag.b : drag.which === 'end' ? s0 : drag.a
  const shownEnd = !drag ? e0 : drag.which === 'start' ? e0 : drag.b
  const drop = (p: XY | null, z: number, k: string) => {
    const f = z > 0 ? foot(p, z) : null
    return p && f && (
      <g key={k}>
        <line x1={p.x} y1={p.y} x2={f.x} y2={f.y} className="cf-drop" />
        <ellipse cx={f.x} cy={f.y} rx={9} ry={4} className="cf-foot" />
      </g>
    )
  }
  return (
    <div ref={box} className="click-fix" style={{ width: size.w, height: size.h }} tabIndex={-1}
      onPointerDown={ev => {
        ev.stopPropagation(); ev.currentTarget.setPointerCapture(ev.pointerId)
        const p = local(ev)
        if (close(e0, p)) setDrag({ which: 'end', a: e0!, b: p })
        else if (close(s0, p)) setDrag({ which: 'start', a: s0!, b: p })
        else setDrag({ which: 'both', a: p, b: p })
      }}
      onPointerMove={ev => { if (drag) setDrag({ ...drag, b: local(ev) }) }}
      onPointerUp={ev => {
        if (!drag) return
        const p = local(ev), d = drag
        setDrag(null)
        const start = d.which === 'end' ? cells?.start ?? '' : cell(d.which === 'start' ? p : d.a, heights.start)
        const end = d.which === 'start' ? cells?.end ?? '' : cell(p, heights.end)
        if (start !== null && end !== null) onDone(start, end)
      }}
      onKeyDown={ev => {
        if (ev.key === 'Escape') { ev.stopPropagation(); onCancel() }
        else if (ev.key === 'Enter' || ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); onMove(1) }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); onMove(-1) }
      }}>
      <svg width={size.w} height={size.h}>
        {drop(shownStart, heights.start, 's')}
        {drop(shownEnd, heights.end, 'e')}
        {shownStart && shownEnd && <line x1={shownStart.x} y1={shownStart.y} x2={shownEnd.x} y2={shownEnd.y} className="cf-path" />}
        {shownStart && <circle cx={shownStart.x} cy={shownStart.y} r={8} className="cf-start" />}
        {shownEnd && <circle cx={shownEnd.x} cy={shownEnd.y} r={8} className="cf-end" />}
      </svg>
      <div className="click-fix-tip">
        {t('ボールの位置で、始まりから終わりへドラッグ（高さ {0} m → {1} m）。点線の下が選手の足元に来れば合っています。Enter 次のプレー · Esc 終わる', heights.start.toFixed(1), heights.end.toFixed(1))}
      </div>
    </div>
  )
}
