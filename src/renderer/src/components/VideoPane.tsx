import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Match } from '../../../shared/types'
import { playback, type PlaybackState } from '../playback'
import { formatTime } from '../format'
import { toggleMaximized, useMaximized } from '../maximize'
import { t } from '../../../shared/i18n'

// The video sits in a box with its exact aspect ratio, so an overlay (annotations) laid over the
// box lines up with the picture — normalized 0..1 coordinates map straight onto it.
// editMode: the edit mode's pencil, left of the maximize button: the stage alone, the side columns put away.
export function VideoPane({ match, overlay, editMode }: { match: Match; overlay?: (size: { w: number; h: number }) => ReactNode; editMode?: { on: boolean; onToggle: () => void } }) {
  const ref = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    playback.attach(ref.current, match.fps, match.id)
    return () => playback.attach(null, 0)
  }, [match.id, match.fps])

  useLayoutEffect(() => {
    const el = frame.current
    if (!el) return
    const ratio = match.width && match.height ? match.width / match.height : 16 / 9
    const fit = () => {
      const w = el.clientWidth, h = el.clientHeight
      setBox(w / h > ratio ? { w: Math.floor(h * ratio), h } : { w, h: Math.floor(w / ratio) })
    }
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    fit()
    return () => ro.disconnect()
  }, [match.width, match.height])

  // The frame is no taller than the picture at its width (it may be less, when the window is short):
  // height it would have spent on black bars goes to the work area under the tabs instead.
  const ratio = match.width && match.height ? match.width / match.height : 16 / 9
  return (
    <div className="video-pane">
      <div className="video-frame" ref={frame} style={{ aspectRatio: ratio }}>
        <div className="video-box" style={{ width: box.w, height: box.h }}>
          <video ref={ref} src={`media://${match.id}/video.mp4`} muted playsInline preload="auto" />
          {overlay && box.w > 0 && overlay(box)}
        </div>
      </div>
      <Transport editMode={editMode} />
    </div>
  )
}

// Play / step buttons, the seek bar and the time. The only part that changes every frame, so it
// subscribes on its own: the video box and the layers over it don't re-render as the video plays.
function Transport({ editMode }: { editMode?: { on: boolean; onToggle: () => void } }) {
  const [s, setS] = useState<PlaybackState>(playback.current)
  useEffect(() => playback.subscribe(setS), [])
  const max = useMaximized()
  return (
      <div className="transport">
        <button onClick={() => playback.toggle()} title={t('再生 / 一時停止 (Space)')}>{s.paused ? '▶' : '❚❚'}</button>
        <button onClick={() => playback.stepFrames(-1)} title={t('1フレーム戻る (Shift+←)')}>◀|</button>
        <button onClick={() => playback.stepFrames(1)} title={t('1フレーム進む (Shift+→)')}>|▶</button>
        <input
          type="range" min={0} max={s.duration || 0} step={0.01} value={s.time}
          onChange={e => playback.seek(+e.target.value)}
          aria-label={t('再生位置')}
        />
        <span className="time">{formatTime(s.time, true)} / {formatTime(s.duration)}</span>
        {max && s.seq && <button onClick={() => playback.stopSequence()} title={t('通し再生を止める')}>■</button>}
        {editMode && <button className={`focus-edit-btn${editMode.on ? ' on' : ''}`} aria-pressed={editMode.on} onClick={editMode.onToggle}
          title={editMode.on ? t('編集モードを終えて、左右の欄を戻す') : t('編集モード: 左右の欄をしまって、動画（スライド）と編集の欄だけを大きく出す')}>✎</button>}
        <button className="maximize" aria-pressed={max} onClick={() => void toggleMaximized()} title={max ? t('元の大きさに戻す (M / Esc)') : t('動画を最大化 (M)')}>{max ? '🗗' : '⛶'}</button>
      </div>
  )
}
