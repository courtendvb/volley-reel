import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Annotation } from '../../../shared/annotation'
import { ZONE_NUMBERS, zoneCellQuad, type CourtFit, type ZoneCell, type ZoneDiv } from '../../../shared/court'
import { t } from '../../../shared/i18n'

type Painted = Extract<Annotation, { kind: 'polygon' }> & { cell: ZoneCell }
const isPainted = (a: Annotation): a is Painted => a.kind === 'polygon' && !!a.cell
const same = (a: ZoneCell, b: ZoneCell) => a.row === b.row && a.col === b.col && a.div === b.div

const CELL = 22 // px of a cell in 81 mode; the court is 9 × 18 of them
const W = CELL * 9, H = CELL * 18 // as the camera sees it: the far side at the top

// Painting court zones, in a dialog beside the video (which shows the result as it is painted): a small
// court as the camera sees it (far side at the top), cut into the 9
// zones of each half or into 81 (each zone in 9). Click or drag over cells to paint them in the colour
// chosen; a cell already that colour is cleared instead. Each painted cell is a filled polygon laid on
// the fitted court, under the other objects, so it can still be selected, faded or deleted like any.
export function ZonePainter({ annotations, onChange, court, color, picker, disabled, onClose }: {
  annotations: Annotation[]; onChange: (list: Annotation[]) => void; court: CourtFit['corners']; color: string
  picker: ReactNode // the colour swatches, set by the format panel
  disabled: boolean
  onClose: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [onClose])
  const [div, setDiv] = useState<ZoneDiv>(3)
  const [opacity, setOpacity] = useState(0.5)
  const stroke = useRef<{ erase: boolean; done: Set<string> } | null>(null)
  const painted = annotations.filter(isPainted)
  // The list as last changed here: a fast drag paints several cells before the new list comes back.
  const latest = useRef(annotations)
  latest.current = annotations
  const commit = (list: Annotation[]) => { latest.current = list; onChange(list) }

  const apply = (list: Annotation[], cell: ZoneCell, erase: boolean): Annotation[] => {
    const rest = list.filter(a => !(isPainted(a) && same(a.cell, cell)))
    if (erase) return rest
    const a: Painted = { id: crypto.randomUUID(), kind: 'polygon', color, width: 0, points: zoneCellQuad(court, cell), fill: color, fillOpacity: opacity, cell }
    const at = rest.findIndex(x => !isPainted(x)) // above the other painted cells, under everything else
    return at < 0 ? [...rest, a] : [...rest.slice(0, at), a, ...rest.slice(at)]
  }
  const key = (c: ZoneCell) => `${c.div}:${c.row}:${c.col}`
  const start = (cell: ZoneCell) => {
    if (disabled) return
    const was = painted.find(a => same(a.cell, cell))
    const erase = !!was && was.fill?.toUpperCase() === color.toUpperCase() && (was.fillOpacity ?? 1) === opacity
    stroke.current = { erase, done: new Set([key(cell)]) }
    commit(apply(latest.current, cell, erase))
  }
  const over = (cell: ZoneCell) => {
    const s = stroke.current
    if (!s || s.done.has(key(cell))) return
    s.done.add(key(cell))
    commit(apply(latest.current, cell, s.erase))
  }

  const rows = div * 2, size = W / div
  const cells: ZoneCell[] = []
  for (let row = 0; row < rows; row++) for (let col = 0; col < div; col++) cells.push({ row, col, div })
  const box = (c: ZoneCell) => { const s = W / c.div; return { x: c.col * s, y: c.row * s, w: s, h: s } }

  return (
    <div className="modal-backdrop zone-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="modal zone-dialog" role="dialog" aria-label={t('ゾーンを塗る')}
      onPointerUp={() => { stroke.current = null }} onPointerLeave={() => { stroke.current = null }}>
      <h2>{t('ゾーンを塗る')}</h2>
      <div className="zone-painter">
      <div className="zone-court-wrap">
      <span className="muted small">{t('奥のコート')}</span>
      <svg width={W + 2} height={H + 2} viewBox={`-1 -1 ${W + 2} ${H + 2}`} className="zone-court" role="grid" aria-label={t('ゾーンを塗るコート')}>
        <rect x={0} y={0} width={W} height={H} className="zc-floor" />
        {painted.map(a => { const b = box(a.cell); return <rect key={a.id} {...{ x: b.x, y: b.y, width: b.w, height: b.h }} fill={a.fill ?? a.color} fillOpacity={a.fillOpacity ?? 1} /> })}
        {div === 9 && Array.from({ length: 8 }, (_, i) => <line key={`v${i}`} x1={(i + 1) * CELL} y1={0} x2={(i + 1) * CELL} y2={H} className="zc-fine" />)}
        {div === 9 && Array.from({ length: 17 }, (_, i) => <line key={`h${i}`} x1={0} y1={(i + 1) * CELL} x2={W} y2={(i + 1) * CELL} className="zc-fine" />)}
        {[1, 2].map(i => <line key={`V${i}`} x1={i * W / 3} y1={0} x2={i * W / 3} y2={H} className="zc-zone" />)}
        {[1, 2, 4, 5].map(i => <line key={`H${i}`} x1={0} y1={i * H / 6} x2={W} y2={i * H / 6} className="zc-zone" />)}
        <line x1={-1} y1={H / 2} x2={W + 1} y2={H / 2} className="zc-net" />
        <rect x={0} y={0} width={W} height={H} className="zc-line" />
        {cells.map(c => (
          <rect key={key(c)} x={c.col * size} y={c.row * size} width={size} height={size} className="zc-hit"
            onPointerDown={e => { e.preventDefault(); start(c) }}
            onPointerEnter={() => over(c)} />
        ))}
        {ZONE_NUMBERS.map((r, ri) => r.map((z, ci) => (
          <text key={`${ri}-${ci}`} x={(ci + 0.5) * W / 3} y={(ri + 0.5) * H / 6} className="zc-num">{z}</text>
        )))}
      </svg>
      <span className="muted small">{t('手前のコート（カメラ側）')}</span>
      </div>
      <div className="zone-side">
        <div className="segmented" role="radiogroup" aria-label={t('ゾーンの分け方')}>
          {([3, 9] as const).map(d => (
            <button key={d} role="radio" aria-checked={div === d} className={div === d ? 'on' : ''} onClick={() => setDiv(d)} disabled={disabled}>
              {d === 3 ? t('9 分割') : t('81 分割')}</button>
          ))}
        </div>
        {picker}
        <label className="check fmt-pct">{t('濃さ')}
          <input type="range" aria-label={t('塗りの濃さ')} min={10} max={100} step={5} value={Math.round(opacity * 100)} disabled={disabled}
            onChange={e => setOpacity(+e.target.value / 100)} /><span>{Math.round(opacity * 100)}%</span></label>
        <p className="hint">{t('マスをクリック（ドラッグで続けて）すると、選んだ色で塗ります。同じ色・濃さのマスをもう一度押すと消えます。向きは動画と同じ（上が奥のコート）')}</p>
        {painted.length > 0 && (
          <button disabled={disabled} onClick={() => onChange(annotations.filter(a => !isPainted(a)))}>{t('塗ったゾーンをすべて消す（{0}）', painted.length)}</button>
        )}
        <span className="spacer" />
        <button className="primary" onClick={onClose}>{t('閉じる')}</button>
      </div>
      </div>
    </div>
    </div>
  )
}
