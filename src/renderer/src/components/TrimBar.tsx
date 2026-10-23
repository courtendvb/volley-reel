import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { playback } from '../playback'

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
  objectSpan: { from: number; to: number } | null // the selected object's show / hide times, drawn on the track
}

const CONTEXT_SEC = 4 // track shows this much beyond the clip and its default range

// IN/OUT editor for the active clip (design §3.5): drag the handles, press [ / ] at the playhead,
// or type seconds relative to the key play. The clip loops while this bar is shown.
export function TrimBar({ label, keyTime, range, def, durationSec, overrides, overlapLabels, onTrim, loop, onLoop, objectSpan }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(playback.current.time)
  const [paused, setPaused] = useState(playback.current.paused)
  const [drag, setDrag] = useState<'in' | 'out' | null>(null)
  useEffect(() => playback.subscribe(s => { setNow(s.time); setPaused(s.paused) }), [])

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
    if (!drag) return
    const t = timeAt(e.clientX)
    onTrim(drag, t)
    playback.seek(t) // show the frame under the handle
  }

  const rel = (t: number) => (t - keyTime).toFixed(1)
  const seconds = []
  for (let s = Math.ceil(lo - keyTime); s <= hi - keyTime; s++) seconds.push(s)

  return (
    <div className="trim">
      <div className="trim-head">
        <span className="trim-title">{label}</span>
        <span className="muted">{(range.out - range.in).toFixed(1)}秒</span>
        <label className="check muted" title="外すと OUT を過ぎても再生を続け、範囲の外も見られます">
          <input type="checkbox" checked={loop} onChange={e => onLoop(e.target.checked)} /> ループ再生{loop && !paused ? '中' : ''}</label>
        {overlapLabels.length > 0 && <span className="overlap" title={overlapLabels.join('\n')}>⚠ {overlapLabels.length} 本と範囲が重なっています</span>}
      </div>

      <div className="trim-track" ref={track} onPointerMove={onMove} onPointerUp={() => setDrag(null)}
        onPointerDown={e => playback.seek(timeAt(e.clientX))}>
        {seconds.map(s => (
          <span key={s} className={`tick${s === 0 ? ' zero' : ''}`} style={{ left: pct(keyTime + s) }}>{s % 2 === 0 ? (s > 0 ? `+${s}` : s) : ''}</span>
        ))}
        <div className="trim-default" style={{ left: pct(def.in), width: `calc(${pct(def.out)} - ${pct(def.in)})` }} title="初期値の範囲" />
        <div className="trim-range" style={{ left: pct(range.in), width: `calc(${pct(range.out)} - ${pct(range.in)})` }} />
        <div className="trim-key" style={{ left: pct(keyTime) }} title="キープレー" />
        <div className={`trim-handle in${drag === 'in' ? ' dragging' : ''}`} style={{ left: pct(range.in) }} onPointerDown={startDrag('in')} title="IN（ドラッグ）" />
        <div className={`trim-handle out${drag === 'out' ? ' dragging' : ''}`} style={{ left: pct(range.out) }} onPointerDown={startDrag('out')} title="OUT（ドラッグ）" />
        {objectSpan && (
          <div className="trim-object" style={{ left: pct(Math.max(lo, objectSpan.from)), width: `calc(${pct(Math.min(hi, objectSpan.to))} - ${pct(Math.max(lo, objectSpan.from))})` }}
            title={`選択中の図形の表示: ${rel(objectSpan.from)} 〜 ${rel(objectSpan.to)} 秒`} />
        )}
        {now >= lo && now <= hi && <div className="trim-playhead" style={{ left: pct(now) }} />}
      </div>

      <div className="trim-fields">
        <Edge name="IN" keyName="[" value={rel(range.in)} overridden={overrides.in}
          onSet={() => onTrim('in', playback.current.time)} onType={v => onTrim('in', keyTime + v)} onReset={() => onTrim('in', null)} />
        <Edge name="OUT" keyName="]" value={rel(range.out)} overridden={overrides.out}
          onSet={() => onTrim('out', playback.current.time)} onType={v => onTrim('out', keyTime + v)} onReset={() => onTrim('out', null)} />
        <span className="hint">秒はキープレーからの相対値。Space でループ再生、← → 0.5 秒、Shift+← → 1 フレーム</span>
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
      <button onClick={onSet} title={`再生位置を ${name} にする (${keyName})`}>{keyName} {name}</button>
      <input type="number" step={0.1} value={text} aria-label={`${name}（キープレーからの秒）`}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      {overridden ? <button className="link" onClick={onReset}>既定に戻す</button> : <span className="muted small">既定</span>}
    </span>
  )
}
