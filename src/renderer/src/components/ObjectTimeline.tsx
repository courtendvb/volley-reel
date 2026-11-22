import { useRef, useState, type PointerEvent } from 'react'
import { snapTime } from '../../../shared/annotationEdit'
import { playback } from '../playback'
import { t } from '../../../shared/i18n'
import { Playhead, type TimelineObject } from './TrimBar'

interface Props {
  range: { in: number; out: number } // the clip (video times); the timeline spans it
  objects: TimelineObject[]
  selectedId: string | null
  onSelect: (id: string) => void
  onSpan: (id: string, span: { from?: number | null; to?: number | null }) => void // null = the clip's edge
  disabled: boolean
}

// When each of the clip's objects shows, on the 図形 tab itself so drawing and timing need no trip to
// 編集: one lane per object over the clip, IN to OUT. Click the scale to move the playhead; drag a bar's
// ends for when it comes and goes (they stick to IN / OUT, the playhead and the other objects' times
// within 6 px, Alt: free), or its middle to move it whole. Seconds are from IN, as in the fields above.
export function ObjectTimeline({ range, objects, selectedId, onSelect, onSpan, disabled }: Props) {
  const [snapGuide, setSnapGuide] = useState<number | null>(null)
  const drag = useRef<{ id: string; edge: 'from' | 'to' | 'both'; rect: DOMRect; at: number; from: number; to: number } | null>(null)
  const scale = useRef<HTMLDivElement>(null)
  const lo = range.in, hi = Math.max(range.out, range.in + 0.1)
  const pct = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const timeAt = (clientX: number, r: DOMRect) => lo + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (hi - lo)
  const round = (v: number) => Math.round(v * 100) / 100

  const grab = (o: TimelineObject, edge: 'from' | 'to' | 'both') => (e: PointerEvent) => {
    if (disabled) return
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
    const lane = (e.currentTarget as HTMLElement).closest('.otl-lane') as HTMLElement
    const rect = lane.getBoundingClientRect()
    drag.current = { id: o.id, edge, rect, at: timeAt(e.clientX, rect), from: o.from, to: o.to }
    onSelect(o.id)
    playback.pause()
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const raw = timeAt(e.clientX, d.rect)
    const targets = [range.in, range.out, playback.current.time, ...objects.filter(o => o.id !== d.id).flatMap(o => [o.from, o.to])]
    const tol = (6 / d.rect.width) * (hi - lo)
    const at = (edge: 'from' | 'to', v: number) => ((edge === 'from' ? v <= range.in + 0.05 : v >= range.out - 0.05) ? null : round(v))
    if (d.edge === 'both') {
      // The whole bar: keeps its length, and its start (or else its end) sticks.
      const len = d.to - d.from
      let from = Math.max(range.in, Math.min(range.out - len, d.from + raw - d.at))
      const a = e.altKey ? { t: from, snapped: null } : snapTime(from, targets, tol)
      const b = e.altKey || a.snapped !== null ? { t: from + len, snapped: null } : snapTime(from + len, targets, tol)
      if (a.snapped !== null) from = a.t
      else if (b.snapped !== null) from = b.t - len
      from = Math.max(range.in, Math.min(range.out - len, from))
      setSnapGuide(a.snapped ?? b.snapped)
      onSpan(d.id, { from: at('from', from), to: at('to', from + len) })
      playback.seek(from)
      return
    }
    const sn = e.altKey ? { t: raw, snapped: null } : snapTime(raw, targets, tol)
    setSnapGuide(sn.snapped)
    const v = Math.max(range.in, Math.min(range.out, sn.t))
    onSpan(d.id, { [d.edge]: at(d.edge, v) })
    playback.seek(v)
  }
  const end = () => { drag.current = null; setSnapGuide(null) }

  const ticks: number[] = []
  for (let s = 0; s <= hi - lo + 1e-6; s++) ticks.push(s)

  return (
    <div className={`otl${disabled ? ' disabled' : ''}`}>
      <div className="otl-row">
        <span className="otl-label muted">{t('表示時間')}</span>
        <div className="otl-scale" ref={scale} onPointerDown={e => playback.seek(timeAt(e.clientX, e.currentTarget.getBoundingClientRect()))}
          title={t('クリックで再生位置を動かす')}>
          {ticks.map(s => <span key={s} className="tick" style={{ left: pct(lo + s) }}>{s % 2 === 0 ? s : ''}</span>)}
          <Playhead lo={lo} hi={hi} />
        </div>
      </div>
      {!objects.length && <p className="hint">{t('図形を描くと、ここで出る時刻・消える時刻をドラッグで決められます')}</p>}
      <div className="otl-lanes">
        {objects.map(o => (
          <div key={o.id} className={`otl-row${o.id === selectedId ? ' on' : ''}`} onClick={() => onSelect(o.id)}>
            <span className="otl-label" title={o.label}>{o.label}</span>
            <div className="otl-lane" onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
              <div className={`otl-bar${o.set ? '' : ' whole'}`} onPointerDown={grab(o, 'both')}
                style={{ left: pct(Math.max(lo, o.from)), width: `calc(${pct(Math.min(hi, o.to))} - ${pct(Math.max(lo, o.from))})` }}
                title={t('{0}: {1} 〜 {2} 秒（両端をドラッグで出る・消える時刻、中をドラッグで丸ごと動かす）', o.label, (o.from - lo).toFixed(1), (o.to - lo).toFixed(1))}>
                <span className="obj-grip from" onPointerDown={grab(o, 'from')} />
                <span className="obj-grip to" onPointerDown={grab(o, 'to')} />
              </div>
              <Playhead lo={lo} hi={hi} />
              {snapGuide !== null && <div className="trim-snap" style={{ left: pct(snapGuide) }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
