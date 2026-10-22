import { useEffect, useRef, useState } from 'react'
import type { CaptionData, ClipOverlayOverride, OverlaySettings, ScoreboardData } from '../../../shared/overlay'
import { drawCaption, drawScoreboard, drawTitleCard } from '../../../shared/overlayDraw'
import { playback, type PlaybackState } from '../playback'

interface Props {
  size: { w: number; h: number }
  settings: OverlaySettings
  clip: { key: string; in: number; out: number } | null
  scoreboard: ScoreboardData | null
  caption: CaptionData | null
  override?: ClipOverlayOverride
}

// Scoreboard and caption for the clip on screen, and title cards during a through-play.
// Drawn with the same functions the export will use. Sits under the annotation layer.
export function OverlayLayer({ size, settings, clip, scoreboard, caption, override }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [st, setSt] = useState<Pick<PlaybackState, 'time' | 'card'>>({ time: playback.current.time, card: playback.current.card })
  useEffect(() => playback.subscribe(s => setSt(p => (p.time === s.time && p.card === s.card ? p : { time: s.time, card: s.card }))), [])

  const inClip = !!clip && playback.attachedKey === clip.key && st.time >= clip.in - 0.05 && st.time <= clip.out + 0.05
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    if (st.card) { drawTitleCard(ctx, size.w, size.h, st.card, settings.titleCard, settings.theme); return }
    if (!inClip) return
    if (scoreboard && settings.scoreboard.enabled && !override?.scoreboard?.hidden) drawScoreboard(ctx, size.w, size.h, scoreboard, settings.scoreboard, settings.theme)
    if (caption && settings.playerCaption.enabled && !override?.playerCaption?.hidden) drawCaption(ctx, size.w, size.h, caption, settings.playerCaption, settings.theme)
  }, [size.w, size.h, settings, scoreboard, caption, override, inClip, st.card])

  return <canvas ref={canvas} className="overlay-layer" data-testid="overlay-canvas" style={{ width: size.w, height: size.h }} />
}
