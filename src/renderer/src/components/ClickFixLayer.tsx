import { useEffect, useRef, useState } from 'react'
import { floorAt, homography, project } from '../../../shared/courtGeometry'
import { cellOf, pointOf } from '../../../shared/codeEdit'
import type { CourtFit } from '../../../shared/court'
import { t } from '../../../shared/i18n'

type XY = { x: number; y: number }

// Over the video, while a play's clicks are being corrected on the fitted court. Its points as they are now show
// (green the start, red the end): drag one to move it alone, or drag anywhere else from where the play starts to
// where it ends to put both. Points go on the floor (the court grid's perspective) and become the scout's cells
// for the play's own half (near: the play's team is on the camera's side). It stays on for another try; Esc or
// the Edit tab's button ends it.
export function ClickFixLayer({ size, fit, near, cells, onDone, onCancel }: {
  size: { w: number; h: number }
  fit: CourtFit
  near: boolean
  cells: { start: string; end: string } | undefined // the play's clicks now
  onDone: (start: string, end: string) => void
  onCancel: () => void
}) {
  const [drag, setDrag] = useState<{ which: 'start' | 'end' | 'both'; a: XY; b: XY } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus() }, []) // so Esc reaches it
  const local = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  // A cell as a point of the picture (px), and back.
  const H = homography(fit.corners)
  const onPicture = (cell: string | undefined): XY | null => {
    const p = pointOf(cell)
    if (!p) return null
    const c = near ? { x: p.u, y: 1 - p.v } : { x: 1 - p.u, y: p.v }
    const q = project(H, c.x, c.y)
    return { x: q.x * size.w, y: q.y * size.h }
  }
  const cell = (p: XY): string | null => {
    const f = floorAt(fit, { x: p.x / size.w, y: p.y / size.h })
    if (!f) return null
    return cellOf(near ? { u: f.x, v: 1 - f.y } : { u: 1 - f.x, v: f.y })
  }
  const s0 = onPicture(cells?.start), e0 = onPicture(cells?.end)
  const close = (a: XY | null, p: XY) => !!a && Math.hypot(a.x - p.x, a.y - p.y) < 14
  // What shows: the points as they are, or as the drag moves them.
  const shownStart = !drag ? s0 : drag.which === 'start' ? drag.b : drag.which === 'end' ? s0 : drag.a
  const shownEnd = !drag ? e0 : drag.which === 'start' ? e0 : drag.b
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
        const start = d.which === 'end' ? cells?.start ?? '' : cell(d.which === 'start' ? p : d.a)
        const end = d.which === 'start' ? cells?.end ?? '' : cell(p)
        if (start !== null && end !== null) onDone(start, end)
      }}
      onKeyDown={ev => { if (ev.key === 'Escape') { ev.stopPropagation(); onCancel() } }}>
      <svg width={size.w} height={size.h}>
        {shownStart && shownEnd && <line x1={shownStart.x} y1={shownStart.y} x2={shownEnd.x} y2={shownEnd.y} className="cf-path" />}
        {shownStart && <circle cx={shownStart.x} cy={shownStart.y} r={8} className="cf-start" />}
        {shownEnd && <circle cx={shownEnd.x} cy={shownEnd.y} r={8} className="cf-end" />}
      </svg>
      <div className="click-fix-tip">{t('点をドラッグして動かすか、始まりから終わりへドラッグし直してください（Esc で終わる）')}</div>
    </div>
  )
}
