import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryInfo, ParsedDVW } from '../../../shared/types'
import { jumpTime, playJumpRows } from '../../../shared/comparePlays'
import { alignCourts } from '../../../shared/compareFit'
import { applyGesture, emptyPane, offsetFor, other, partnerTime, stepTime, withZoom, type CompareFile, type CompareLayout, type CompareSession, type CompareSource, type ComparePane as PaneState, type PaneGesture, type Side } from '../../../shared/videoCompare'
import { ComparePane, type GestureTarget, type PaneMedia } from './ComparePane'
import { errorText } from '../format'
import { t } from '../../../shared/i18n'

const api = window.api
const SIDES: Side[] = ['left', 'right']
const SAVE_DELAY_MS = 500

interface Props {
  initial: CompareSession
  library: LibraryInfo | null
  onExit: (s: CompareSession) => void
  onError: (message: string) => void
}

// Two videos side by side (design: apart from projects). Each side has its own timeline and zoom;
// "sync" ties the timelines together through an offset (the same moment marked on both).
export function CompareView({ initial, library, onExit, onError }: Props) {
  const [s, setS] = useState(initial)
  const sRef = useRef(s)
  sRef.current = s
  const [files, setFiles] = useState<Record<string, CompareFile>>({})
  const tried = useRef(new Set<string>())
  const vids = useRef<Record<Side, HTMLVideoElement | null>>({ left: null, right: null })
  const matches = library?.matches ?? []
  // The DVW of a side that plays a library match, for jumping to its plays.
  const [dvws, setDvws] = useState<Record<string, ParsedDVW>>({})
  const dvwTried = useRef(new Set<string>())
  useEffect(() => {
    for (const side of SIDES) {
      const src = s[side].source
      if (src?.kind !== 'match' || dvwTried.current.has(src.matchId)) continue
      dvwTried.current.add(src.matchId)
      const id = src.matchId
      api.parseCompareMatch(id).then(d => setDvws(p => ({ ...p, [id]: d })), () => { /* no readable DVW: no play list */ })
    }
  }, [s.left.source, s.right.source])

  const update = useCallback((fn: (s: CompareSession) => CompareSession) => setS(p => ({ ...fn(p), updatedAt: new Date().toISOString() })), [])
  const patchPane = useCallback((side: Side, fn: (p: PaneState) => PaneState) => update(p => ({ ...p, [side]: fn(p[side]) })), [update])

  // Files chosen earlier (a saved comparison) are made playable again when they come into view.
  useEffect(() => {
    for (const side of SIDES) {
      const src = s[side].source
      if (src?.kind !== 'file' || files[src.path] || tried.current.has(src.path)) continue
      tried.current.add(src.path)
      api.openCompareVideo(src.path).then(f => setFiles(p => ({ ...p, [f.path]: f })), e => onError(errorText(e)))
    }
  }, [s.left.source, s.right.source, files, onError])

  const mediaOf = (src: CompareSource | null): PaneMedia | null => {
    if (src?.kind === 'match') {
      const m = matches.find(x => x.id === src.matchId)
      return m ? { src: `media://${m.id}/video.mp4`, fps: m.fps, width: m.width, height: m.height, label: m.name } : null
    }
    const f = src?.kind === 'file' ? files[src.path] : null
    return f ? { src: `media://${f.token}/video.mp4`, fps: f.fps, width: f.width, height: f.height, label: f.name } : null
  }
  const media = { left: useMemo(() => mediaOf(s.left.source), [s.left.source, files, library]), right: useMemo(() => mediaOf(s.right.source), [s.right.source, files, library]) } // eslint-disable-line react-hooks/exhaustive-deps
  const playRows = (src: CompareSource | null) => {
    const m = src?.kind === 'match' ? matches.find(x => x.id === src.matchId) : null
    const d = m ? dvws[m.id] : null
    return m && d ? playJumpRows(d, m.offsetSec) : null
  }
  const plays = { left: useMemo(() => playRows(s.left.source), [s.left.source, dvws, library]), right: useMemo(() => playRows(s.right.source), [s.right.source, dvws, library]) } // eslint-disable-line react-hooks/exhaustive-deps
  const nearOf = (src: CompareSource | null) => (src?.kind === 'match' ? matches.find(x => x.id === src.matchId)?.court?.nearSet1 ?? null : null)
  const loading = (side: Side) => { const src = s[side].source; return src?.kind === 'file' && !files[src.path] }

  // ---- saving: the state as it is, with where each side was left
  const snapshot = useCallback((): CompareSession => {
    const cur = sRef.current
    // a video not loaded yet reports 0: keep the saved place until it can say where it is
    const at = (side: Side) => { const v = vids.current[side]; return v && v.readyState >= 1 ? v.currentTime : cur[side].time }
    return { ...cur, left: { ...cur.left, time: at('left') }, right: { ...cur.right, time: at('right') } }
  }, [])
  // Saves itself, as a project does: shortly after each change, and every few seconds for where the sides are.
  // Only what differs from the last save is written.
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved')
  const savedJson = useRef('')
  const save = useCallback(async () => {
    const snap = snapshot(), json = JSON.stringify(snap)
    if (json === savedJson.current) { setSaveState(p => (p === 'pending' ? 'saved' : p)); return }
    try { await api.saveCompare(snap); savedJson.current = json; setSaveState('saved') } catch (e) { setSaveState('error'); onError(errorText(e)) }
  }, [snapshot, onError])
  useEffect(() => {
    setSaveState('pending')
    const id = setTimeout(() => void save(), SAVE_DELAY_MS)
    return () => clearTimeout(id)
  }, [s, save])
  useEffect(() => { const id = setInterval(() => void save(), 3000); return () => clearInterval(id) }, [save])
  useEffect(() => api.onFlushRequest(() => save()), [save])
  const exit = async () => {
    for (const side of SIDES) vids.current[side]?.pause()
    await save()
    onExit(snapshot())
  }

  // ---- playhead
  const vid = (side: Side) => vids.current[side]
  const dur = (side: Side) => vid(side)?.duration || 0
  const setTime = (side: Side, sec: number) => { const v = vid(side); if (v && Number.isFinite(sec)) v.currentTime = sec }
  // Moves one side, and the other with it while synced.
  const seek = (side: Side, sec: number) => {
    setTime(side, sec)
    if (!sRef.current.synced) return
    const o = other(side)
    const pt = partnerTime(side, sec, sRef.current.offsetSec, dur(o))
    if (pt !== null) setTime(o, pt)
  }
  const step = (side: Side, frames: number) => {
    const v = vid(side)
    if (!v) return
    v.pause()
    seek(side, stepTime(v.currentTime, frames, media[side]?.fps ?? 30, v.duration || 0))
  }
  // One side's own play button plays that side alone (the other keeps as it is); 両方再生 plays both.
  const play = (side: Side) => {
    const v = vid(side)
    if (!v) return
    if (v.paused) void v.play().catch(() => {}); else v.pause()
  }
  // The side last worked on, shown by a frame.
  const [active, setActive] = useState<Side | null>(null)
  const playAll = () => {
    const vs = SIDES.map(vid).filter((v): v is HTMLVideoElement => !!v)
    const anyPlaying = vs.some(v => !v.paused)
    if (!anyPlaying && sRef.current.synced && vid('left')) seek('left', vid('left')!.currentTime)
    for (const v of vs) { if (anyPlaying) v.pause(); else void v.play().catch(() => {}) }
  }
  const stepBoth = (frames: number) => {
    for (const side of SIDES) { const v = vid(side); if (v) { v.pause(); setTime(side, stepTime(v.currentTime, frames, media[side]?.fps ?? 30, v.duration || 0)) } }
  }

  // Both back by seconds; by no more than either has behind it, so they stay at the same moment.
  const skipBack = (sec: number) => {
    const vs = SIDES.map(sd => [sd, vid(sd)] as const).filter((x): x is readonly [Side, HTMLVideoElement] => !!x[1])
    if (!vs.length) return
    const back = Math.min(sec, ...vs.map(([, v]) => v.currentTime))
    for (const [sd, v] of vs) setTime(sd, v.currentTime - back)
  }

  // ---- scale: the courts' corners laid on each other (zoom and move only; a different camera angle stays)
  const courtOf = (side: Side) => { const src = s[side].source, m = src?.kind === 'match' ? matches.find(x => x.id === src.matchId) : null; return m?.court && m.width && m.height ? m : null }
  const [fitNote, setFitNote] = useState<string | null>(null)
  const fitCourts = () => {
    const L = courtOf('left'), R = courtOf('right'), box = vid('left')?.parentElement?.getBoundingClientRect()
    if (!L?.court || !R?.court || !box || !box.height) return
    const a = alignCourts({ corners: L.court.corners, aspect: L.width / L.height, view: s.left.view }, { corners: R.court.corners, aspect: R.width / R.height, view: s.right.view }, box.width / box.height)
    update(p => ({ ...p, left: { ...p.left, view: a.left }, right: { ...p.right, view: a.right } }))
    setFitNote(a.offBy < 0.01 ? t('コートが重なりました') : t('合わせました。カメラの角度の違いによるずれが残っています（約 {0}%）', Math.round(a.offBy * 100)))
  }
  useEffect(() => { if (!fitNote) return; const id = setTimeout(() => setFitNote(null), 8000); return () => clearTimeout(id) }, [fitNote])

  // ---- sync: the moment both sides show now becomes the same moment
  const syncHere = () => {
    const l = vid('left'), r = vid('right')
    if (!l || !r) return
    update(p => ({ ...p, synced: true, offsetSec: offsetFor(l.currentTime, r.currentTime) }))
  }
  const nudge = (frames: number) => {
    const off = sRef.current.offsetSec + frames / (media.right?.fps ?? 30)
    update(p => ({ ...p, offsetSec: off }))
    const l = vid('left')
    if (l) { const pt = partnerTime('left', l.currentTime, off, dur('right')); if (pt !== null) setTime('right', pt) }
  }

  // ---- view
  // The overlay: which layers the stage's wheel and drag move (both, to start with).
  const [moving, setMoving] = useState<Record<Side, boolean>>({ left: true, right: true })
  // One gesture on a picture: to this side, or the layers switched on (each by its own view, so a difference stays).
  // Outside the overlay, a linked zoom makes any gesture go to both.
  const gesture = (side: Side, g: PaneGesture, target: GestureTarget) => {
    const to: Side[] = sRef.current.layout !== 'overlay' ? (sRef.current.zoomLocked ? SIDES : [side]) : target === 'switched' ? SIDES.filter(sd => moving[sd]) : [side]
    update(p => { const n = { ...p }; for (const sd of to) n[sd] = { ...p[sd], view: applyGesture(p[sd].view, g) }; return n })
  }
  const lockZoom = (on: boolean) => update(p => on ? { ...p, zoomLocked: true, right: { ...p.right, view: withZoom(p.right.view, p.left.view.zoom) } } : { ...p, zoomLocked: false })

  const setSource = (side: Side, source: CompareSource) => patchPane(side, () => ({ ...emptyPane(), source }))
  const pickFile = async (side: Side) => {
    try {
      const f = await api.pickCompareVideo()
      if (!f) return
      tried.current.add(f.path)
      setFiles(p => ({ ...p, [f.path]: f }))
      setSource(side, { kind: 'file', path: f.path, name: f.name })
    } catch (e) { onError(errorText(e)) }
  }

  // Space plays both; Shift+←/→ steps both a frame.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if ((el instanceof HTMLInputElement && el.type !== 'range' && el.type !== 'checkbox') || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return
      if (e.code === 'Space') { e.preventDefault(); playAll() }
      else if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); stepBoth(e.key === 'ArrowLeft' ? -1 : 1) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  // ---- MP4: the moment both sides show now is the point; some seconds before it and after it are written
  const [before, setBefore] = useState(5)
  const [after, setAfter] = useState(5)
  const exportMp4 = async () => {
    const l = s.left.source, r = s.right.source
    if (!l || !r) return
    try {
      for (const side of SIDES) vid(side)?.pause()
      const out = await api.chooseCompareExportPath(s.name || t('比較'))
      if (!out) return
      // Both sides start the same time before their point (never before either video's start), so they stay together.
      const lt = vid('left')?.currentTime ?? 0, rt = vid('right')?.currentTime ?? 0
      const lead = Math.min(before, lt, rt)
      await api.exportCompare({
        left: { source: l, view: s.left.view, startSec: lt - lead },
        right: { source: r, view: s.right.view, startSec: rt - lead },
        layout: s.layout, overlayAlpha: s.overlayAlpha, durationSec: lead + after, outPath: out,
      })
    } catch (e) { onError(errorText(e)) }
  }

  const off = s.offsetSec
  const paneProps = (side: Side) => ({
    side, layer: s.layout === 'overlay' ? (side === 'right' ? 'over' as const : 'under' as const) : null, alpha: s.overlayAlpha,
    active: s.layout !== 'overlay' && active === side, onActivate: () => setActive(side),
    moving: moving[side], onMoving: (on: boolean) => setMoving(p => ({ ...p, [side]: on })),
    title: side === 'left' ? t('左') : t('右'),
    pane: s[side], media: media[side], loading: loading(side), matches,
    plays: plays[side],
    nearSet1: nearOf(s[side].source),
    onJumpPlay: (sec: number) => seek(side, jumpTime(sec)),
    onSource: (src: CompareSource) => setSource(side, src),
    onPickFile: () => void pickFile(side),
    onGesture: (g: PaneGesture, target: GestureTarget) => gesture(side, g, target),
    onVideo: (el: HTMLVideoElement | null) => { vids.current[side] = el },
    onReady: (el: HTMLVideoElement) => { el.currentTime = sRef.current[side].time },
    onSeek: (sec: number) => seek(side, sec),
    onStep: (n: number) => step(side, n),
    onToggle: () => play(side),
  })

  return (
    <main className="compare">
      <div className="compare-bar">
        <button onClick={() => void exit()} title={t('倉庫とプロジェクトの一覧に戻る')}>{t('ホーム')}</button>
        <input className="compare-name" value={s.name} onChange={e => update(p => ({ ...p, name: e.target.value }))} aria-label={t('比較の名前')} />
        <span className={`save-state ${saveState}`} title={t('比較は自動で保存されます')}>{saveState === 'saved' ? t('保存済み') : saveState === 'pending' ? t('保存中…') : t('保存に失敗')}</span>
        <span className="spacer" />
        <div className="segmented" role="radiogroup" aria-label={t('並べ方')}>
          {([['side', t('左右')], ['stack', t('上下')], ['overlay', t('重ねる')]] as const satisfies readonly (readonly [CompareLayout, string])[]).map(([v, l]) => (
            <button key={v} role="radio" aria-checked={s.layout === v} className={s.layout === v ? 'on' : ''} onClick={() => update(p => ({ ...p, layout: v }))}>{l}</button>
          ))}
        </div>
        {s.layout === 'overlay' ? (
          <label className="compare-alpha" title={t('右の動画を、左の動画の上にどれだけ見せるか。動画の位置と大きさは、下のタイムラインの左・右のスイッチを入れた側が、ホイールとドラッグで動きます')}>
            {t('重ね具合')}
            <input type="range" min={0} max={100} step={5} value={Math.round(s.overlayAlpha * 100)} onChange={e => update(p => ({ ...p, overlayAlpha: +e.target.value / 100 }))} />
            <span className="muted">{Math.round(s.overlayAlpha * 100)}%</span>
          </label>
        ) : (
          <label className="check" title={t('片方を拡大・移動すると、もう片方も同じにする')}>
            <input type="checkbox" checked={s.zoomLocked} onChange={e => lockZoom(e.target.checked)} />{t('拡大を連動')}
          </label>
        )}
        <span className="compare-fit">
          <button onClick={fitCourts} disabled={!courtOf('left') || !courtOf('right')} title={courtOf('left') && courtOf('right') ? t('コートの四隅が重なるように、右と左の拡大・位置を自動で合わせる（カメラの角度の違いは直せません）') : t('両方が倉庫の試合で、どちらもコートのグリッドを合わせてあるときに使えます')}>{t('コートで縮尺を合わせる')}</button>
          {fitNote && <span className="muted" role="status">{fitNote}</span>}
        </span>
        <span className="compare-sync">
          {s.synced ? (
            <>
              <b className="sync-on">{t('同期中')}</b>
              <span className="muted" title={t('右の時刻 = 左の時刻 + この値')}>{t('右 = 左')} {off >= 0 ? '+' : '−'}{Math.abs(off).toFixed(2)}s</span>
              <button className="small" onClick={() => nudge(-1)} title={t('右を1フレーム前にずらす')}>−1f</button>
              <button className="small" onClick={() => nudge(1)} title={t('右を1フレーム後ろにずらす')}>+1f</button>
              <button className="small" onClick={() => update(p => ({ ...p, synced: false }))}>{t('同期を解除')}</button>
            </>
          ) : (
            <button onClick={syncHere} disabled={!media.left || !media.right} title={t('左右それぞれを同じ瞬間（例: サーブを打つ瞬間）に合わせてから押すと、以後は一緒に動きます')}>{t('いまの位置で同期')}</button>
          )}
        </span>
        <button onClick={() => skipBack(5)} disabled={!media.left && !media.right} title={t('両方を5秒戻す')}>−5s</button>
        <button onClick={() => skipBack(2)} disabled={!media.left && !media.right} title={t('両方を2秒戻す')}>−2s</button>
        <button onClick={() => stepBoth(-1)} title={t('両方を1フレーム戻る (Shift+←)')}>◀|</button>
        <button className="primary" onClick={playAll} title={t('両方を再生 / 一時停止 (Space)')}>{t('両方再生')}</button>
        <button onClick={() => stepBoth(1)} title={t('両方を1フレーム進む (Shift+→)')}>|▶</button>
        <span className="compare-export">
          {t('前')}<input type="number" min={0} max={300} step={1} value={before} onChange={e => setBefore(Math.min(300, Math.max(0, Math.round(+e.target.value) || 0)))} aria-label={t('ポイントより前の長さ（秒）')} />
          {t('後')}<input type="number" min={1} max={300} step={1} value={after} onChange={e => setAfter(Math.min(300, Math.max(1, Math.round(+e.target.value) || 1)))} aria-label={t('ポイントより後の長さ（秒）')} />{t('秒')}
          <button onClick={() => void exportMp4()} disabled={!media.left || !media.right} title={t('いまの左右の位置を同じポイントにして、その前後を、見えているとおりの拡大のまま1本の MP4 に書き出す（音声なし）')}>{t('MP4に書き出し')}</button>
        </span>
      </div>
      <div className={`compare-panes ${s.layout}`}>
        <ComparePane {...paneProps('left')} />
        <ComparePane {...paneProps('right')} />
      </div>
    </main>
  )
}
