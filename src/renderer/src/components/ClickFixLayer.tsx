import { useState } from 'react'
import { floorAt } from '../../../shared/courtGeometry'
import { cellOf } from '../../../shared/codeEdit'
import type { CourtFit } from '../../../shared/court'
import { t } from '../../../shared/i18n'

// Over the video, while a play's clicks are being corrected on the fitted court: drag from where the play starts
// to where it ends. The points are put on the floor (the court grid's perspective) and turned into the scout's
// cells for the play's own half (near: the play's team is on the camera's side).
export function ClickFixLayer({ size, fit, near, onDone, onCancel }: {
  size: { w: number; h: number }
  fit: CourtFit
  near: boolean
  onDone: (start: string, end: string) => void
  onCancel: () => void
}) {
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null)
  const local = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }
  // A point of the picture as the scout's cell: the floor under it, seen from the play's own end line.
  const cell = (p: { x: number; y: number }): string | null => {
    const f = floorAt(fit, { x: p.x / size.w, y: p.y / size.h })
    if (!f) return null
    return cellOf(near ? { u: f.x, v: 1 - f.y } : { u: 1 - f.x, v: f.y })
  }
  return (
    <div className="click-fix" style={{ width: size.w, height: size.h }}
      onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); const p = local(e); setDrag({ a: p, b: p }) }}
      onPointerMove={e => { if (drag) setDrag({ ...drag, b: local(e) }) }}
      onPointerUp={e => {
        if (!drag) return
        const s = cell(drag.a), en = cell(local(e))
        setDrag(null)
        if (s && en) onDone(s, en)
      }}
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }} tabIndex={-1}>
      <svg width={size.w} height={size.h}>
        {drag && <>
          <line x1={drag.a.x} y1={drag.a.y} x2={drag.b.x} y2={drag.b.y} className="cf-path" />
          <circle cx={drag.a.x} cy={drag.a.y} r={7} className="cf-start" />
          <circle cx={drag.b.x} cy={drag.b.y} r={7} className="cf-end" />
        </>}
      </svg>
      <div className="click-fix-tip">{t('コートの上で、プレーの始まりから終わりへドラッグしてください（Esc でやめる）')}</div>
    </div>
  )
}
