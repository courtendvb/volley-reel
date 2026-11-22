import { useRef, useState } from 'react'
import { t } from '../../../shared/i18n'

export interface Clicks { start: { u: number; v: number } | null; end: { u: number; v: number } | null }

// A court seen from above, the play's own half at the bottom (as the scout clicks it: u across, v from its own end
// line up, the net at v 0.5). Drag from where the play starts to where it ends to put both clicks; drag a point
// to move it. Green is the start, red the end.
const W = 180, H = 360, M = 36 // the court and the room around it (serves start behind the end line)
const toXY = (p: { u: number; v: number }) => ({ x: M + p.u * W, y: M + (1 - p.v) * H })
const toUV = (x: number, y: number) => ({ u: (x - M) / W, v: 1 - (y - M) / H })

export function CourtPicker({ value, onChange }: { value: Clicks; onChange: (c: Clicks) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<'start' | 'end' | null>(null)
  const at = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * (W + 2 * M), y = ((e.clientY - r.top) / r.height) * (H + 2 * M)
    const p = toUV(Math.max(0, Math.min(W + 2 * M, x)), Math.max(0, Math.min(H + 2 * M, y)))
    return { u: Math.round(p.u * 1000) / 1000, v: Math.round(p.v * 1000) / 1000 }
  }
  const near = (p: { u: number; v: number } | null, e: React.PointerEvent) => {
    if (!p) return false
    const a = toXY(p), r = svg.current!.getBoundingClientRect(), k = (W + 2 * M) / r.width
    return Math.hypot(a.x - (e.clientX - r.left) * k, a.y - (e.clientY - r.top) * k) < 12
  }
  const s = value.start && toXY(value.start), en = value.end && toXY(value.end)
  const lines = [...[1, 2].map(i => ({ x1: M + (W / 3) * i, y1: M, x2: M + (W / 3) * i, y2: M + H })), ...[1, 2, 4, 5].map(i => ({ x1: M, y1: M + (H / 6) * i, x2: M + W, y2: M + (H / 6) * i }))]
  return (
    <svg ref={svg} className="court-picker" viewBox={`0 0 ${W + 2 * M} ${H + 2 * M}`} role="img" aria-label={t('コートの座標')}
      onPointerDown={e => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = at(e)
        if (near(value.end, e)) setDrag('end')
        else if (near(value.start, e)) setDrag('start')
        else { onChange({ start: p, end: p }); setDrag('end') }
      }}
      onPointerMove={e => { if (drag) onChange({ ...value, [drag]: at(e) }) }}
      onPointerUp={() => setDrag(null)}>
      <rect x={M} y={M} width={W} height={H} className="cp-floor" />
      {lines.map((l, i) => <line key={i} {...l} className="cp-zone" />)}
      <line x1={M - 10} y1={M + H / 2} x2={M + W + 10} y2={M + H / 2} className="cp-net" />
      <text x={12} y={M + H * 0.75} className="cp-label" textAnchor="middle" transform={`rotate(-90 12 ${M + H * 0.75})`}>{t('自チーム側')}</text>
      {s && en && <line x1={s.x} y1={s.y} x2={en.x} y2={en.y} className="cp-path" />}
      {s && <circle cx={s.x} cy={s.y} r={6} className="cp-start" />}
      {en && <circle cx={en.x} cy={en.y} r={6} className="cp-end" />}
    </svg>
  )
}
