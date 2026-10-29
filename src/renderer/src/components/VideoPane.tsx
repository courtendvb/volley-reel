import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Match } from '../../../shared/types'
import { playback, type PlaybackState } from '../playback'
import { formatTime } from '../format'
import { t } from '../../../shared/i18n'

// The video sits in a box with its exact aspect ratio, so an overlay (annotations) laid over the
// box lines up with the picture — normalized 0..1 coordinates map straight onto it.
export function VideoPane({ match, overlay }: { match: Match; overlay?: (size: { w: number; h: number }) => ReactNode }) {
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

  return (
    <div className="video-pane">
      <div className="video-frame" ref={frame}>
        <div className="video-box" style={{ width: box.w, height: box.h }}>
          <video ref={ref} src={`media://${match.id}/video.mp4`} muted playsInline preload="auto" />
          {overlay && box.w > 0 && overlay(box)}
        </div>
      </div>
      <Transport />
    </div>
  )
}

// Play / step buttons, the seek bar and the time. The only part that changes every frame, so it
// subscribes on its own: the video box and the layers over it don't re-render as the video plays.
function Transport() {
  const [s, setS] = useState<PlaybackState>(playback.current)
  useEffect(() => playback.subscribe(setS), [])
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
      </div>
  )
}
