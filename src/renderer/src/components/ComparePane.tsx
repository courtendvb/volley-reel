import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Match, Side as TeamSide } from '../../../shared/types'
import { MAX_ZOOM, MIN_ZOOM, type CompareSource, type ComparePane as PaneState, type PaneGesture, type Side } from '../../../shared/videoCompare'
import { currentPlay, filterPlayRows, isNear, NO_FILTER, playerChoices, type PlayJumpFilter, type PlayJumpRow } from '../../../shared/comparePlays'
import { formatTime } from '../format'
import { cap, t } from '../../../shared/i18n'
import { skillName } from '../../../shared/labels'
import type { VideoLook } from '../../../shared/videoLook'
import { LookFilter, lookStyle } from './VideoLook'

// What a side plays: a library match's video or a chosen file, once it is playable.
export interface PaneMedia { src: string; fps: number; width: number; height: number; label: string; look?: VideoLook } // look: a match's picture correction

// Whom a gesture moves: this side, or (the overlay: one stage, two layers) the sides whose switch is on.
export type GestureTarget = 'self' | 'switched'

export interface PaneProps {
  side: Side
  title: string
  layer: 'over' | 'under' | null // the overlay layout: laid over the other side (see-through), or under it
  alpha: number // how much of the 'over' layer shows
  active: boolean // the side being worked on (framed)
  onActivate: () => void
  moving: boolean // the overlay: this layer moves and zooms with the stage's wheel and drag
  onMoving: (on: boolean) => void
  pane: PaneState
  media: PaneMedia | null
  loading: boolean // a file being prepared
  matches: Match[]
  plays: PlayJumpRow[] | null // the match's plays, when it has a DVW
  nearSet1: TeamSide | null // the team near the camera in set 1, when the match's court is fitted
  onJumpPlay: (sec: number) => void
  onSource: (s: CompareSource) => void
  onPickFile: () => void
  onGesture: (g: PaneGesture, target: GestureTarget) => void
  onVideo: (el: HTMLVideoElement | null) => void
  onReady: (el: HTMLVideoElement) => void // metadata loaded: where it was left can be restored
  onSeek: (sec: number) => void
  onStep: (frames: number) => void
  onToggle: () => void
}

interface Clock { time: number; duration: number; paused: boolean }

// The side's own playhead, from the <video> it shows (frame-accurate where the browser can say).
function useClock(el: HTMLVideoElement | null): Clock {
  const [c, setC] = useState<Clock>({ time: 0, duration: 0, paused: true })
  useEffect(() => {
    if (!el) return
    const sync = () => setC({ time: el.currentTime, duration: el.duration || 0, paused: el.paused })
    const events = ['loadedmetadata', 'seeked', 'play', 'pause', 'ended', 'durationchange', 'emptied']
    events.forEach(ev => el.addEventListener(ev, sync))
    let handle = 0
    const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      setC(p => ({ ...p, time: meta.mediaTime, paused: el.paused }))
      handle = el.requestVideoFrameCallback(onFrame)
    }
    handle = el.requestVideoFrameCallback(onFrame)
    sync()
    return () => { events.forEach(ev => el.removeEventListener(ev, sync)); el.cancelVideoFrameCallback(handle) }
  }, [el])
  return c
}

export function ComparePane(p: PaneProps) {
  const [el, setEl] = useState<HTMLVideoElement | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const clock = useClock(el)
  const view = p.pane.view
  const viewRef = useRef(view)
  viewRef.current = view
  const onGesture = useRef(p.onGesture)
  onGesture.current = p.onGesture
  // On the overlay's one stage the wheel and drag move the layers whose switch is on.
  const target: GestureTarget = p.layer === null ? 'self' : 'switched'
  const targetRef = useRef(target)
  targetRef.current = target
  const onVideo = useRef(p.onVideo)
  onVideo.current = p.onVideo
  // One stable ref callback: a new one each render would be called with null and the element every time.
  const setVideo = useCallback((v: HTMLVideoElement | null) => { setEl(v); onVideo.current(v) }, [])

  // Wheel zooms around the pointer. A native listener, because React's wheel is passive.
  useEffect(() => {
    const b = box.current
    if (!b) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = b.getBoundingClientRect()
      onGesture.current({ kind: 'zoom', factor: Math.exp(-e.deltaY * 0.0015), cx: (e.clientX - r.left) / r.width - 0.5, cy: (e.clientY - r.top) / r.height - 0.5 }, targetRef.current)
    }
    b.addEventListener('wheel', wheel, { passive: false })
    return () => b.removeEventListener('wheel', wheel)
  }, [])

  const drag = useRef<{ x: number; y: number } | null>(null)
  const zoomBy = (factor: number) => p.onGesture({ kind: 'zoom', factor, cx: 0, cy: 0 }, 'self')
  const m = p.media

  return (
    <section className={`cmp-pane cmp-${p.side}${p.active ? ' active' : ''}`} onPointerDownCapture={p.onActivate} onFocusCapture={p.onActivate}>
      <header className="cmp-head">
        <b className="cmp-title">{p.title}</b>
        <SourceMenu label={m?.label ?? null} matches={p.matches} onSource={p.onSource} onPickFile={p.onPickFile} />
        {p.plays && <PlayMenu rows={p.plays} nearSet1={p.nearSet1} time={clock.time} onJump={p.onJumpPlay} />}
        <span className="spacer" />
        <button className="small" onClick={() => zoomBy(1 / 1.25)} disabled={view.zoom <= MIN_ZOOM} title={t('縮小')} aria-label={t('縮小')}>−</button>
        <span className="cmp-zoom" title={t('ホイールで拡大・縮小、ドラッグで動かす')}>{Math.round(view.zoom * 100)}%</span>
        <button className="small" onClick={() => zoomBy(1.25)} disabled={view.zoom >= MAX_ZOOM} title={t('拡大')} aria-label={t('拡大')}>＋</button>
        <button className="small" onClick={() => p.onGesture({ kind: 'reset' }, 'self')} disabled={view.zoom === 1} title={t('ぜんたいを見る（ダブルクリックでも）')}>{t('全体')}</button>
      </header>
      <div className={`cmp-box${view.zoom > 1 || p.layer === 'over' ? ' zoomed' : ''}${p.layer ? ` ${p.layer}` : ''}`} ref={box}
        onDoubleClick={() => p.onGesture({ kind: 'reset' }, target)}
        onPointerDown={e => { if (e.button !== 0 || (p.layer === null && view.zoom <= 1)) return; drag.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => {
          const d = drag.current
          if (!d) return
          const r = e.currentTarget.getBoundingClientRect()
          p.onGesture({ kind: 'pan', dx: (e.clientX - d.x) / r.width, dy: (e.clientY - d.y) / r.height }, target)
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
        {m ? (
          <>
          <LookFilter id={`look-cmp-${p.side}`} look={m.look} />
          <video ref={setVideo} src={m.src} muted playsInline preload="auto"
            style={{ transform: `translate(${view.x * 100}%, ${view.y * 100}%) scale(${view.zoom})`, ...(p.layer === 'over' ? { opacity: p.alpha } : {}), ...lookStyle(`look-cmp-${p.side}`, m.look) }}
            onLoadedMetadata={e => p.onReady(e.currentTarget)} />
          </>
        ) : (
          <div className="cmp-empty muted">{p.loading ? t('再生できる形にしています…') : t('動画を選んでください')}</div>
        )}
      </div>
      <div className="transport cmp-transport">
        {p.layer && (
          <button className={`cmp-tswitch${p.moving ? ' on' : ''}`} aria-pressed={p.moving} onClick={() => p.onMoving(!p.moving)}
            title={t('オンの側だけが、動画の上のホイール（拡大・縮小）とドラッグ（移動）で動く')}>{p.title}{p.layer === 'over' ? t('（上）') : t('（下）')} {p.moving ? t('動かす') : t('固定')}</button>
        )}
        <button onClick={p.onToggle} disabled={!m} title={t('再生 / 一時停止')}>{clock.paused ? '▶' : '❚❚'}</button>
        <button onClick={() => p.onStep(-1)} disabled={!m} title={t('1フレーム戻る')}>◀|</button>
        <button onClick={() => p.onStep(1)} disabled={!m} title={t('1フレーム進む')}>|▶</button>
        <input type="range" min={0} max={clock.duration || 0} step={0.01} value={clock.time} disabled={!m}
          onChange={e => p.onSeek(+e.target.value)} aria-label={t('再生位置')} />
        <span className="time">{formatTime(clock.time, true)} / {formatTime(clock.duration)}</span>
      </div>
    </section>
  )
}

// Where a side's video comes from: a match of the library, or any video file.
function SourceMenu({ label, matches, onSource, onPickFile }: { label: string | null; matches: Match[]; onSource: (s: CompareSource) => void; onPickFile: () => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const words = q.toUpperCase().split(/\s+/).filter(Boolean)
  const shown = matches.filter(m => {
    const hay = `${m.name} ${m.date ?? ''} ${m.teams[0].code} ${m.teams[1].code}`.toUpperCase()
    return words.every(w => hay.includes(w))
  })
  return (
    <div className="cmp-source" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} title={label ?? ''}>{label ?? t('動画を選ぶ')} ▾</button>
      {open && (
        <div className="cmp-menu" role="menu">
          <button className="primary" onClick={() => { setOpen(false); onPickFile() }}>{t('ファイルから選ぶ…')}</button>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('倉庫の試合を絞り込み（例: HTH 2026-10）')} aria-label={t('試合の絞り込み')} autoFocus />
          <div className="cmp-list">
            {shown.map(m => (
              <button key={m.id} role="menuitem" onClick={() => { setOpen(false); setQ(''); onSource({ kind: 'match', matchId: m.id }) }}>{m.name}</button>
            ))}
            {!shown.length && <p className="muted small">{matches.length ? t('該当する試合がありません') : t('倉庫に試合がありません')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

const SKILL_FILTERS = ['S', 'R', 'A', 'B', 'D', 'E']

// The plays of a match with a DVW: a jump puts this side's timeline just before the one picked.
// Which side of the court is near the camera comes from the match's fitted court; where it isn't fitted
// yet, it is asked here (only for this list, nothing is saved).
function PlayMenu({ rows, nearSet1, time, onJump }: { rows: PlayJumpRow[]; nearSet1: TeamSide | null; time: number; onJump: (sec: number) => void }) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState<PlayJumpFilter>(NO_FILTER)
  const [asked, setAsked] = useState<TeamSide | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const near = nearSet1 ?? asked
  const sets = useMemo(() => [...new Set(rows.map(r => r.setNum))].sort((a, b) => a - b), [rows])
  const teams = useMemo(() => ({ '*': rows.find(r => r.side === '*')?.team ?? '', a: rows.find(r => r.side === 'a')?.team ?? '' }), [rows])
  const players = useMemo(() => (open ? playerChoices(rows, f.side) : []), [open, rows, f.side])
  const shown = useMemo(() => (open ? filterPlayRows(rows, f, near) : []), [open, rows, f, near])
  const set = (patch: Partial<PlayJumpFilter>) => setF(p => ({ ...p, ...patch }))
  // The play the playhead is at, shown on the button and marked in the list (to a quarter second, not every frame).
  const quarter = Math.floor(time * 4)
  const cur = useMemo(() => currentPlay(rows, quarter / 4), [rows, quarter])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) listRef.current?.querySelector('.cur')?.scrollIntoView({ block: 'center' }) }, [open])
  return (
    <div className="cmp-source" ref={ref}>
      <button className="cmp-playbtn" onClick={() => setOpen(o => !o)} aria-expanded={open} title={cur ? t('いまのプレー: {0}', playText(cur)) : t('プレーを選んで、その少し前へ移る')}>{cur ? playText(cur) : cap(t('プレー'))} ▾</button>
      {open && (
        <div className="cmp-menu cmp-plays">
          <div className="cmp-filters">
            <label>{t('セット')}
              <select value={f.setNum ?? ''} onChange={e => set({ setNum: e.target.value ? +e.target.value : null })}>
                <option value="">{t('すべて')}</option>
                {sets.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>{t('チーム')}
              <select value={f.side ?? ''} onChange={e => set({ side: (e.target.value || null) as PlayJumpFilter['side'], playerKey: null })}>
                <option value="">{t('すべて')}</option>
                {teams['*'] && <option value="*">{teams['*']}</option>}
                {teams.a && <option value="a">{teams.a}</option>}
              </select>
            </label>
            <label>{t('選手')}
              <select value={f.playerKey ?? ''} onChange={e => set({ playerKey: e.target.value || null })}>
                <option value="">{t('すべて')}</option>
                {players.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
            <label>{t('プレーの種類')}
              <select value={f.skill ?? ''} onChange={e => set({ skill: e.target.value || null })}>
                <option value="">{t('すべて')}</option>
                {SKILL_FILTERS.map(k => <option key={k} value={k}>{skillName(k)}</option>)}
              </select>
            </label>
          </div>
          <div className="cmp-position">
            <span>{t('コートの位置')}</span>
            <div className="segmented" role="radiogroup" aria-label={t('コートの位置')}>
              {([[null, t('すべて')], ['near', t('手前')], ['far', t('奥')]] as const).map(([v, l]) => (
                <button key={l} role="radio" aria-checked={f.position === v} className={f.position === v ? 'on' : ''} disabled={v !== null && !near} onClick={() => set({ position: v })}>{l}</button>
              ))}
            </div>
            {!nearSet1 && (
              <label className="cmp-near-ask" title={t('この試合のコートはまだ合わせていないため、手前・奥で絞るには、第1セットで手前だったチームを選びます')}>
                {t('第1セットの手前')}
                <select value={asked ?? ''} onChange={e => { setAsked((e.target.value || null) as TeamSide | null); if (!e.target.value) set({ position: null }) }}>
                  <option value="">{t('未選択')}</option>
                  {teams['*'] && <option value="*">{teams['*']}</option>}
                  {teams.a && <option value="a">{teams.a}</option>}
                </select>
              </label>
            )}
          </div>
          <p className="muted small">{shown.length} / {rows.length}</p>
          <div className="cmp-list" ref={listRef}>
            {shown.map(r => (
              <button key={r.id} className={r.id === cur?.id ? 'cur' : ''} aria-current={r.id === cur?.id} onClick={() => { setOpen(false); onJump(r.sec) }} title={formatTime(r.sec)}>
                <span className="muted">S{r.setNum} {r.score}</span> <b>{r.team}</b> {r.who} · {r.what}
                {near && <span className="muted"> · {isNear(r, near) ? t('手前') : t('奥')}</span>}
              </button>
            ))}
            {!shown.length && <p className="muted small">{t('該当するプレーがありません')}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

// A play in a line: set, score, team, player, what.
const playText = (r: PlayJumpRow) => `S${r.setNum} ${r.score} ${r.team} ${r.who} ${r.what}`
