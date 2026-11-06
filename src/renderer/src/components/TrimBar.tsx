import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { snapTime } from '../../../shared/annotationEdit'
import { playback } from '../playback'
import { arrowSec, composing } from '../keys'
import { t } from '../../../shared/i18n'
import { SLOW_RATES, clipPlayedSec, type ClipTiming, type Hold, type Slow } from '../../../shared/timing'

interface Props {
  label: string
  keyTime: number // video time of the clip's key play; inputs are relative to it
  range: { in: number; out: number }
  def: { in: number; out: number }
  durationSec: number
  overrides: { in: boolean; out: boolean }
  overlapLabels: string[]
  onTrim: (edge: 'in' | 'out', t: number | null) => void
  speed: { value: number | null; usual: number | null } | null // a serve's speed for its flight, in km/h; null on other skills
  onSpeed: (kmh: number | null) => void
  skillTime: number | null // the red line, moved by hand from keyTime; null = on it
  onSkillTime: (t: number | null) => void
  loop: boolean // loop the clip (off: play on past OUT to see around it)
  onLoop: (on: boolean) => void
  // The clip's objects and when each shows (from / to are video times; set = not the whole clip).
  objects: TimelineObject[]
  selectedObjectId: string | null
  onSelectObject: (id: string) => void
  onObjectSpan: (id: string, edge: 'from' | 'to', t: number | null) => void // null = the clip's edge
  timing: ClipTiming | undefined // slow stretches and holds (video times)
  onTiming: (timing: ClipTiming) => void
  onFrameSlide: () => void // the picture on screen as a slide right after this clip
}

interface TimelineObject { id: string; label: string; from: number; to: number; set: boolean }

const CONTEXT_SEC = 4 // track shows this much beyond the clip and its default range

// IN/OUT editor for the active clip (design §3.5): drag the handles, press [ / ] at the playhead,
// or type seconds relative to the key play. The clip loops while this bar is shown.
export function TrimBar({ label, keyTime, range, def, durationSec, overrides, overlapLabels, onTrim, speed, onSpeed, skillTime, onSkillTime, loop, onLoop, objects, selectedObjectId, onSelectObject, onObjectSpan, timing, onTiming, onFrameSlide }: Props) {
  const [lanesOpen, setLanesOpen] = useState(false)
  // While a show / hide time sticks to another time: that time, drawn as a guide line.
  const [snapGuide, setSnapGuide] = useState<number | null>(null)
  // Dragging an object's start or end, on the main track or on its own lane (same scale).
  const objDrag = useRef<{ id: string; edge: 'from' | 'to'; rect: DOMRect } | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<'in' | 'out' | 'skill' | null>(null)
  const skillAt = skillTime ?? keyTime

  const lo = Math.max(0, Math.min(range.in, def.in) - CONTEXT_SEC)
  const hi = Math.min(durationSec || Infinity, Math.max(range.out, def.out) + CONTEXT_SEC)
  const pct = (t: number) => `${((t - lo) / (hi - lo)) * 100}%`
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return lo + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (hi - lo)
  }

  const startDrag = (edge: 'in' | 'out' | 'skill') => (e: PointerEvent) => {
    e.stopPropagation()
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* synthetic events have no active pointer */ }
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
    if (drag === 'skill') {
      // Back on the DVW's time within 6 px (Alt: free), so it can be put back by hand.
      const sn = e.altKey ? { t, snapped: null } : snapTime(t, [keyTime], (6 / track.current!.getBoundingClientRect().width) * (hi - lo))
      setSnapGuide(sn.snapped)
      onSkillTime(sn.snapped !== null ? null : Math.round(sn.t * 100) / 100)
      playback.seek(sn.t)
      return
    }
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
        <span className="muted">{(range.out - range.in).toFixed(1)}{t('秒')}{timing?.slows?.length || timing?.holds?.length ? t('（再生 {0} 秒）', clipPlayedSec(range, timing).toFixed(1)) : ''}</span>
        <label className="check muted" title={t('外すと OUT を過ぎても再生を続け、範囲の外も見られます')}>
          <input type="checkbox" checked={loop} onChange={e => onLoop(e.target.checked)} /> {t('ループ再生')}{loop && <Playing />}</label>
        <button onClick={onFrameSlide} title={t('動画の今のコマを、このクリップのすぐ後ろのスライドにします。矢印などを描けます')}>{t('＋ 今の画面をスライドに')}</button>
        {overlapLabels.length > 0 && <span className="overlap" title={overlapLabels.join('\n')}>⚠ {overlapLabels.length} {t('本と範囲が重なっています')}</span>}
      </div>

      <div className="trim-track" ref={track} onPointerMove={onMove} onPointerUp={() => { setDrag(null); objDrag.current = null; setSnapGuide(null) }}
        onPointerDown={e => playback.seek(timeAt(e.clientX))}>
        {seconds.map(s => (
          <span key={s} className={`tick${s === 0 ? ' zero' : ''}`} style={{ left: pct(keyTime + s) }}>{s % 2 === 0 ? (s > 0 ? `+${s}` : s) : ''}</span>
        ))}
        <div className="trim-default" style={{ left: pct(def.in), width: `calc(${pct(def.out)} - ${pct(def.in)})` }} title={t('初期値の範囲')} />
        <div className="trim-range" style={{ left: pct(range.in), width: `calc(${pct(range.out)} - ${pct(range.in)})` }} />
        <div className={`trim-key${drag === 'skill' ? ' dragging' : ''}`} style={{ left: pct(skillAt) }} onPointerDown={startDrag('skill')}
          title={t('スキルの起点（ドラッグ）。軌道はここから動きます')} />
        <div className={`trim-handle in${drag === 'in' ? ' dragging' : ''}`} style={{ left: pct(range.in) }} onPointerDown={startDrag('in')} title={t('IN（ドラッグ）')} />
        <div className={`trim-handle out${drag === 'out' ? ' dragging' : ''}`} style={{ left: pct(range.out) }} onPointerDown={startDrag('out')} title={t('OUT（ドラッグ）')} />
        {(timing?.slows ?? []).map((s, k) => (
          <div key={`s${k}`} className="trim-slow" style={{ left: pct(Math.max(lo, s.from)), width: `calc(${pct(Math.min(hi, s.to))} - ${pct(Math.max(lo, s.from))})` }}
            title={t('スロー ×{0}: {1} 〜 {2} 秒', s.rate, rel(s.from), rel(s.to))}>×{s.rate}</div>
        ))}
        {(timing?.holds ?? []).map((h, k) => (
          <div key={`h${k}`} className="trim-hold" style={{ left: pct(h.at) }} title={t('停止 {0} 秒（{1} 秒の位置）', h.sec, rel(h.at))} />
        ))}
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

      <SlowHold timing={timing} onTiming={onTiming} range={range} rel={rel} keyTime={keyTime} />

      <div className="trim-fields">
        <Edge name="IN" keyName="[" value={rel(range.in)} overridden={overrides.in}
          onSet={() => onTrim('in', playback.current.time)} onType={v => onTrim('in', keyTime + v)} onReset={() => onTrim('in', null)} />
        <Edge name="OUT" keyName="]" value={rel(range.out)} overridden={overrides.out}
          onSet={() => onTrim('out', playback.current.time)} onType={v => onTrim('out', keyTime + v)} onReset={() => onTrim('out', null)} />
        <Edge name={t('起点')} keyName="◎" value={rel(skillAt)} overridden={skillTime !== null}
          onSet={() => onSkillTime(Math.round(playback.current.time * 100) / 100)} onType={v => onSkillTime(v ? Math.round((keyTime + v) * 100) / 100 : null)} onReset={() => onSkillTime(null)} />
        {speed?.usual && <Speed value={speed.value} usual={speed.usual} onChange={onSpeed} />}
        <span className="hint">{t('秒はキープレーからの相対値。Space でループ再生、← → {0} 秒、Shift+← → 1 フレーム', arrowSec())}</span>
      </div>
    </div>
  )
}

// Slow stretches and holds of the clip: added at the playhead, then their times (seconds from the key
// play, or the playhead), the rate and the hold's seconds set here. They play in the loop and the
// through-play, and go into the export.
function SlowHold({ timing, onTiming, range, rel, keyTime }: {
  timing: ClipTiming | undefined; onTiming: (t: ClipTiming) => void; range: { in: number; out: number }; rel: (t: number) => string; keyTime: number
}) {
  const slows = timing?.slows ?? [], holds = timing?.holds ?? []
  const now = () => Math.max(range.in, Math.min(range.out, Math.round(playback.current.time * 100) / 100))
  const put = (s: Slow[], h: Hold[]) => onTiming({ ...(s.length ? { slows: s } : {}), ...(h.length ? { holds: h } : {}) })
  const setSlow = (k: number, p: Partial<Slow>) => put(slows.map((s, i) => { if (i !== k) return s; const n = { ...s, ...p }; return n.to > n.from ? n : s }), holds)
  const setHold = (k: number, p: Partial<Hold>) => put(slows, holds.map((h, i) => (i === k ? { ...h, ...p } : h)))
  const at = (v: number) => Math.max(range.in, Math.min(range.out, keyTime + v))
  return (
    <div className="trim-timing">
      <span className="field-label">{t('スロー・停止')}</span>
      <button onClick={() => { const a = now(); put([...slows, { from: a, to: Math.min(range.out, a + 1), rate: 0.5 }], holds) }}
        title={t('再生位置から 1 秒を 0.5 倍で。範囲と速さは下で変えられます')}>{t('＋ スロー')}</button>
      <button onClick={() => put(slows, [...holds, { at: now(), sec: 2 }])} title={t('再生位置のコマで 2 秒止める。秒数は下で変えられます')}>{t('＋ 停止')}</button>
      {slows.map((s, k) => (
        <span key={`s${k}`} className="trim-timing-item">
          {t('スロー')}
          <SecField value={rel(s.from)} label={t('スローの始め（キープレーからの秒）')} onType={v => setSlow(k, { from: at(v) })} onNow={() => setSlow(k, { from: now() })} />〜
          <SecField value={rel(s.to)} label={t('スローの終わり（キープレーからの秒）')} onType={v => setSlow(k, { to: at(v) })} onNow={() => setSlow(k, { to: now() })} />
          <select value={s.rate} aria-label={t('スローの速さ')} onChange={e => setSlow(k, { rate: Number(e.target.value) })}>
            {SLOW_RATES.map(r => <option key={r} value={r}>×{r}</option>)}
          </select>
          <button className="link" aria-label={t('このスローを外す')} onClick={() => put(slows.filter((_, i) => i !== k), holds)}>×</button>
        </span>
      ))}
      {holds.map((h, k) => (
        <span key={`h${k}`} className="trim-timing-item">
          {t('停止')}
          <SecField value={rel(h.at)} label={t('止める位置（キープレーからの秒）')} onType={v => setHold(k, { at: at(v) })} onNow={() => setHold(k, { at: now() })} />
          <input type="number" min={0.5} max={30} step={0.5} value={h.sec} aria-label={t('止める秒数')}
            onChange={e => { const n = parseFloat(e.target.value); if (n >= 0.5 && n <= 30) setHold(k, { sec: n }) }} />{t('秒')}
          <button className="link" aria-label={t('この停止を外す')} onClick={() => put(slows, holds.filter((_, i) => i !== k))}>×</button>
        </span>
      ))}
    </div>
  )
}

// A serve's speed through the air: the flight takes as long as its distance at this speed. Empty
// goes back to the usual time, whose speed shows in the field.
function Speed({ value, usual, onChange }: { value: number | null; usual: number; onChange: (kmh: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value))
  useEffect(() => setText(value === null ? '' : String(value)), [value])
  const commit = () => {
    const v = parseFloat(text)
    if (!text.trim()) onChange(null)
    else if (v >= 20 && v <= 160) onChange(v)
    else setText(value === null ? '' : String(value))
  }
  return (
    <span className="trim-edge" title={t('動画のボールに軌道が合うように、サーブの平均の速さを入れます。空にすると既定に戻ります')}>
      {t('速度')}
      <input type="number" min={20} max={160} step={1} value={text} placeholder={String(usual)} aria-label={t('サーブの速度（km/h）')}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter' && !composing(e)) commit() }} /> km/h
    </span>
  )
}

// Seconds from the key play, typed or set to the playhead (◎).
function SecField({ value, label, onType, onNow }: { value: string; label: string; onType: (v: number) => void; onNow: () => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => { const v = parseFloat(text); if (isFinite(v)) onType(v); else setText(value) }
  return (
    <span className="sec-field">
      <input type="number" step={0.1} value={text} aria-label={label} onChange={e => setText(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' && !composing(e)) commit() }} />
      <button className="link" onClick={onNow} title={t('再生位置にする')} aria-label={t('{0}を再生位置にする', label)}>◎</button>
    </span>
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
