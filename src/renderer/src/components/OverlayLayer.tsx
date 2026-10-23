import { useEffect, useRef, useState } from 'react'
import type { CaptionData, ClipOverlayOverride, OverlaySettings, ScoreboardData } from '../../../shared/overlay'
import { drawCaption, drawScoreboard, drawTitleCard } from '../../../shared/overlayDraw'
import { drawAnnotation } from '../../../shared/annotation'
import { assetImage, logoImage, subscribeAssets } from '../assets'
import { prepareCanvas } from '../canvas'
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
  // Redrawn when the playhead enters or leaves the clip or a card shows, not on every frame.
  const clipRef = useRef(clip)
  clipRef.current = clip
  const inClipAt = (t: number) => { const c = clipRef.current; return !!c && playback.attachedKey === c.key && t >= c.in - 0.05 && t <= c.out + 0.05 }
  const [st, setSt] = useState<{ inClip: boolean; card: PlaybackState['card'] }>({ inClip: inClipAt(playback.current.time), card: playback.current.card })
  useEffect(() => playback.subscribe(s => {
    const inClip = inClipAt(s.time)
    setSt(p => (p.inClip === inClip && p.card === s.card ? p : { inClip, card: s.card }))
  }), [])
  const [logoTick, setLogoTick] = useState(0) // redraw when a logo finishes loading
  useEffect(() => subscribeAssets(() => setLogoTick(n => n + 1)), [])

  const inClip = inClipAt(playback.current.time) || st.inClip
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, size.w, size.h)
    if (st.card) {
      drawTitleCard(ctx, size.w, size.h, st.card, settings.titleCard, settings.theme, logoImage(st.card.opp))
      for (const a of st.card.annotations ?? []) drawAnnotation(ctx, a, size.w, size.h, assetImage)
      return
    }
    if (!inClip) return
    if (scoreboard && settings.scoreboard.enabled && !override?.scoreboard?.hidden) drawScoreboard(ctx, size.w, size.h, scoreboard, settings.scoreboard, settings.theme)
    if (caption && settings.playerCaption.enabled && !override?.playerCaption?.hidden) drawCaption(ctx, size.w, size.h, caption, settings.playerCaption, settings.theme)
  }, [size.w, size.h, settings, scoreboard, caption, override, inClip, st.card, logoTick])

  return <canvas ref={canvas} className="overlay-layer" data-testid="overlay-canvas" style={{ width: size.w, height: size.h }} />
}
