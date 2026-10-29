import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { snapTime } from '../../../shared/annotationEdit'
import { playback } from '../playback'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

interface Props {
  label: string
  keyTime: number // video time of the clip's key play; inputs are relative to it
  range: { in: number; out: number }
  def: { in: number; out: number }
  durationSec: number
  overrides: { in: boolean; out: boolean }
  overlapLabels: string[]
  onTrim: (edge: 'in' | 'out', t: number | null) => void
  loop: boolean // loop the clip (off: play on past OUT to see around it)
  onLoop: (on: boolean) => void
  // The clip's objects and when each shows (from / to are video times; set = not the whole clip).
  objects: TimelineObject[]
  selectedObjectId: string | null
  onSelectObject: (id: string) => void
  onObjectSpan: (id: string, edge: 'from' | 'to', t: number | null) => void // null = the clip's edge
}

export interface TimelineObject { id: string; label: string; from: number; to: number; set: boolean }

const CONTEXT_SEC = 4 // track shows this much beyond the clip and its default range

// IN/OUT editor for the active clip (design §3.5): drag the handles, press [ / ] at the playhead,
// or type seconds relative to the key play. The clip loops while this bar is shown.
export function TrimBar({ label, keyTime, range, def, durationSec, overrides, overlapLabels, onTrim, loop, onLoop, objects, selectedObjectId, onSelectObject, onObjectSpan }: Props) {
  const [lanesOpen, setLanesOpen] = useState(false)
  // While a show / hide time sticks to another time: that time, drawn as a guide line.
  const [snapGuide, setSnapGuide] = useState<number | null>(null)
  // Dragging an object's start or end, on the main track or on its own lane (same scale).
  const objDrag = useRef<{ id: string; edge: 'from' | 'to'; rect: DOMRect } | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<'in' | 'out' | null>(null)

  const lo = Math.max(0, Math.min(range.in, def.in) - CONTEXT_SEC)
  const hi = Math.min(durationSec || Infinity, Math.max(range.out, def.out) + CONTEXT_SEC)
  const pct = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return lo + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (hi - lo)
  }

  const startDrag = (edge: 'in' | 'out') => (e: PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(edge)
    playback.pause()
  }
  const onMove = (e: PointerEvent) => {
    const od = objDrag.current
    if (od) {
      const raw = lo + Math.max(0, Math.min(1, (e.clientX - od.rect.left) / od.rect.width)) * (hi - lo)
      // Sticks to the other objects' times, IN / OUT and the key play within 6 px (Alt: free).
      const targets = [range.in, range.out, keyTime, ...objects.filter(o => o.id !== od.id).flatMap(o => [o.from, o.to])]
      const sn = e.altKey ? { t: raw, snapped: null } : snapTime(raw, targets, (6 / od.rect.width) * (hi - lo))
      setSnapGuide(sn.snapped)
      const clamped = Math.max(range.in, Math.min(range.out, sn.t))
      const atEdge = od.edge === 'from' ? clamped <= range.in + 0.05 : clamped >= range.out - 0.05
      onObjectSpan(od.id, od.edge, atEdge ? null : Math.round(clamped * 100) / 100)
      playback.seek(clamped)
      return
    }
    if (!drag) return
    const t = timeAt(e.clientX)
    onTrim(drag, t)
    playback.seek(t) // show the frame under the handle
  }

  const rel = (t: number) => (t - keyTime).toFixed(1)
  const selected = objects.find(o => o.id === selectedObjectId) ?? null
  // An object's span with grips at both ends; dragging a grip sets that time.
  const span = (o: TimelineObject, main: boolean) => {
    const grab = (edge: 'from' | 'to') => (e: PointerEvent) => {
      e.stopPropagation()
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
      const host = (main ? track.current : (e.currentTarget as HTMLElement).parentElement?.parentElement) as HTMLElement
      objDrag.current = { id: o.id, edge, rect: host.getBoundingClientRect() }
      onSelectObject(o.id)
      playback.pause()
    }
    return (
      <div className={`trim-object${main ? ' main' : ''}${o.set ? '' : ' whole'}`}
        style={{ left: pct(Math.max(lo, o.from)), width: `calc(${pct(Math.min(hi, o.to))} - ${pct(Math.max(lo, o.from))})` }}
        title={t('{0}: {1} 〜 {2} 秒', o.label, rel(o.from), rel(o.to))}>
        <span className="obj-grip from" onPointerDown={grab('from')} onPointerMove={onMove} onPointerUp={() => { objDrag.current = null; setSnapGuide(null) }} title={t('出る時刻（ドラッグ）')} />
        <span className="obj-grip to" onPointerDown={grab('to')} onPointerMove={onMove} onPointerUp={() => { objDrag.current = null; setSnapGuide(null) }} title={t('消える時刻（ドラッグ）')} />
      </div>
    )
  }
  const seconds = []
  for (let s = Math.ceil(lo - keyTime); s <= hi - keyTime; s++) seconds.push(s)

  return (
    <div className="trim">
      <div className="trim-head">
        <span className="trim-title">{label}</span>
        <span className="muted">{(range.out - range.in).toFixed(1)}{t('秒')}</span>
        <label className="check muted" title={t('外すと OUT を過ぎても再生を続け、範囲の外も見られます')}>
          <input type="checkbox" checked={loop} onChange={e => onLoop(e.target.checked)} /> {t('ループ再生')}{loop && <Playing />}</label>
        {overlapLabels.length > 0 && <span className="overlap" title={overlapLabels.join('\n')}>⚠ {overlapLabels.length} {t('本と範囲が重なっています')}</span>}
      </div>

      <div className="trim-track" ref={track} onPointerMove={onMove} onPointerUp={() => { setDrag(null); objDrag.current = null; setSnapGuide(null) }}
        onPointerDown={e => playback.seek(timeAt(e.clientX))}>
        {seconds.map(s => (
          <span key={s} className={`tick${s === 0 ? ' zero' : ''}`} style={{ left: pct(keyTime + s) }}>{s % 2 === 0 ? (s > 0 ? `+${s}` : s) : ''}</span>
        ))}
        <div className="trim-default" style={{ left: pct(def.in), width: `calc(${pct(def.out)} - ${pct(def.in)})` }} title={t('初期値の範囲')} />
        <div className="trim-range" style={{ left: pct(range.in), width: `calc(${pct(range.out)} - ${pct(range.in)})` }} />
        <div className="trim-key" style={{ left: pct(keyTime) }} title={t('キープレー')} />
        <div className={`trim-handle in${drag === 'in' ? ' dragging' : ''}`} style={{ left: pct(range.in) }} onPointerDown={startDrag('in')} title={t('IN（ドラッグ）')} />
        <div className={`trim-handle out${drag === 'out' ? ' dragging' : ''}`} style={{ left: pct(range.out) }} onPointerDown={startDrag('out')} title={t('OUT（ドラッグ）')} />
        {selected && span(selected, true)}
        <Playhead lo={lo} hi={hi} />
        {snapGuide !== null && <div className="trim-snap" style={{ left: pct(snapGuide) }} />}
      </div>

      <div className="trim-lanes-head">
        <button className="link" aria-expanded={lanesOpen} onClick={() => setLanesOpen(o => !o)} disabled={!objects.length}>
          {lanesOpen ? '▾' : '▸'} {t('図形の表示時間（{0}）', objects.length)}</button>
        <span className="muted small">{selected ? t('橙の線の両端をドラッグで、出る時刻・消える時刻') : t('図形を選ぶと、その表示時間がバーに出ます')}</span>
      </div>
      {lanesOpen && (
        <div className="trim-lanes">
          {objects.map(o => (
            <div key={o.id} className={`trim-lane-row${o.id === selectedObjectId ? ' on' : ''}`} onClick={() => onSelectObject(o.id)}>
              <span className="trim-lane-label" title={o.label}>{o.label}</span>
              <div className="trim-lane" onPointerMove={onMove} onPointerUp={() => { objDrag.current = null; setSnapGuide(null) }}>
                <div className="trim-lane-clip" style={{ left: pct(range.in), width: `calc(${pct(range.out)} - ${pct(range.in)})` }} />
                {span(o, false)}
                {snapGuide !== null && <div className="trim-snap" style={{ left: pct(snapGuide) }} />}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="trim-fields">
        <Edge name="IN" keyName="[" value={rel(range.in)} overridden={overrides.in}
          onSet={() => onTrim('in', playback.current.time)} onType={v => onTrim('in', keyTime + v)} onReset={() => onTrim('in', null)} />
        <Edge name="OUT" keyName="]" value={rel(range.out)} overridden={overrides.out}
          onSet={() => onTrim('out', playback.current.time)} onType={v => onTrim('out', keyTime + v)} onReset={() => onTrim('out', null)} />
        <span className="hint">{t('秒はキープレーからの相対値。Space でループ再生、← → 0.5 秒、Shift+← → 1 フレーム')}</span>
      </div>
    </div>
  )
}

function Edge({ name, keyName, value, overridden, onSet, onType, onReset }: {
  name: string; keyName: string; value: string; overridden: boolean
  onSet: () => void; onType: (v: number) => void; onReset: () => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => { const v = parseFloat(text); if (isFinite(v)) onType(v); else setText(value) }
  return (
    <span className="trim-edge">
      <button onClick={onSet} title={t('再生位置を {0} にする ({1})', name, keyName)}>{keyName} {name}</button>
      <input type="number" step={0.1} value={text} aria-label={t('{0}（キープレーからの秒）', name)}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter' && !composing(e)) commit() }} />
      {overridden ? <button className="link" onClick={onReset}>{t('既定に戻す')}</button> : <span className="muted small">{t('既定')}</span>}
    </span>
  )
}

// The parts that follow the video every frame are their own small components, so the bar (with
// its lanes) doesn't re-render as the video plays.
function Playhead({ lo, hi }: { lo: number; hi: number }) {
  const [now, setNow] = useState(playback.current.time)
  useEffect(() => playback.subscribe(st => setNow(st.time)), [])
  if (now < lo || now > hi) return null
  return <div className="trim-playhead" style={{ left: `${((now - lo) / (hi - lo)) * 100}%` }} />
}

function Playing() {
  const [paused, setPaused] = useState(playback.current.paused)
  useEffect(() => playback.subscribe(st => setPaused(st.paused)), [])
  return paused ? null : <>{t('中')}</>
}
