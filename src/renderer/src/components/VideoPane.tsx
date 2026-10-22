import { useEffect, useRef, useState } from 'react'
import type { Match } from '../../../shared/types'
import { playback, type PlaybackState } from '../playback'
import { formatTime } from '../format'

export function VideoPane({ match }: { match: Match }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [s, setS] = useState<PlaybackState>(playback.current)

  useEffect(() => {
    playback.attach(ref.current, match.fps, match.id)
    return () => playback.attach(null, 0)
  }, [match.id, match.fps])
  useEffect(() => playback.subscribe(setS), [])

  return (
    <div className="video-pane">
      <div className="video-frame">
        <video ref={ref} src={`media://${match.id}/video.mp4`} muted playsInline preload="auto" />
      </div>
      <div className="transport">
        <button onClick={() => playback.toggle()} title="再生 / 一時停止 (Space)">{s.paused ? '▶' : '❚❚'}</button>
        <button onClick={() => playback.stepFrames(-1)} title="1フレーム戻る (Shift+←)">◀|</button>
        <button onClick={() => playback.stepFrames(1)} title="1フレーム進む (Shift+→)">|▶</button>
        <input
          type="range" min={0} max={s.duration || 0} step={0.01} value={s.time}
          onChange={e => playback.seek(+e.target.value)}
          aria-label="再生位置"
        />
        <span className="time">{formatTime(s.time, true)} / {formatTime(s.duration)}</span>
      </div>
    </div>
  )
}
