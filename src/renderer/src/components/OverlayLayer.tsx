import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { followAt, lookTheme, type CaptionData, type ClipOverlayOverride, type FollowWindow, type OverlaySettings, type ScoreboardData } from '../../../shared/overlay'
import { drawCaption, drawCard, drawScoreboard, drawServeSpeed } from '../../../shared/overlayDraw'
import { drawAnnotation } from '../../../shared/annotation'
import { drawFlights, drawSlideMarks, flightsProgress } from '../../../shared/court'
import { assetImage, logoImage, packPhotoImage, subscribeAssets } from '../assets'
import { prepareCanvas } from '../canvas'
import { playback, type PlaybackState } from '../playback'

interface Props {
  size: { w: number; h: number }
  settings: OverlaySettings
  clip: { key: string; in: number; out: number } | null
  scoreboard: ScoreboardData | null
  caption: CaptionData | null
  override?: ClipOverlayOverride
  heatOpacity?: number // of a slide's heatmap
  speed?: { key: string; from: number; to: number; kmh: number } | null // a serve's speed plate and when it shows (video times)
  // No clip on screen: the display follows the playhead over these plays' windows (shared/overlay.ts
  // followWindows), each with its own scoreboard and caption. Ignored while there is a clip.
  follow?: { key: string; windows: FollowWindow[]; data: (playId: number) => { scoreboard: ScoreboardData; caption: CaptionData } | null } | null
}

// Scoreboard and caption for the clip on screen, and title cards and slides during a through-play.
// Drawn with the same functions the export will use. Sits under the annotation layer.
export function OverlayLayer({ size, settings, clip, scoreboard, caption, override, heatOpacity, speed, follow }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // Redrawn when the playhead enters or leaves the clip or a card shows, not on every frame.
  const clipRef = useRef(clip)
  clipRef.current = clip
  const inClipAt = (t: number) => { const c = clipRef.current; return !!c && playback.attachedKey === c.key && t >= c.in - 0.05 && t <= c.out + 0.05 }
  const followRef = useRef(follow)
  followRef.current = clip ? null : follow
  const followIdx = (t: number) => { const f = followRef.current; return f && playback.attachedKey === f.key ? followAt(f.windows, t) : -1 }
  const speedRef = useRef(speed)
  speedRef.current = speed
  const inSpeedAt = (t: number) => { const s = speedRef.current; return !!s && playback.attachedKey === s.key && t >= s.from - 0.01 && t <= s.to }
  // Whether the plate is on the canvas now: it can come up on a render (a touch marked while paused),
  // so leaving it has to redraw even when the state already said "out".
  const speedShown = useRef(false)
  const [st, setSt] = useState<{ inClip: boolean; inSpeed: boolean; card: PlaybackState['card']; idx: number }>({ inClip: inClipAt(playback.current.time), inSpeed: inSpeedAt(playback.current.time), card: playback.current.card, idx: followIdx(playback.current.time) })
  useEffect(() => playback.subscribe(s => {
    const inClip = inClipAt(s.time), inSpeed = inSpeedAt(s.time), idx = followIdx(s.time)
    setSt(p => (p.inClip === inClip && p.inSpeed === inSpeed && inSpeed === speedShown.current && p.card === s.card && p.idx === idx ? p : { inClip, inSpeed, card: s.card, idx }))
  }), [])
  const [logoTick, setLogoTick] = useState(0) // redraw when a logo finishes loading
  useEffect(() => subscribeAssets(() => setLogoTick(n => n + 1)), [])

  // A slide's flights: how far they have gone since the slide came up, in steps while they fly.
  const flights = st.card?.slide?.flights ?? null
  const [progress, setProgress] = useState(1)
  useLayoutEffect(() => {
    if (!flights) return
    const from = performance.now()
    let raf = 0
    const tick = () => {
      const p = Math.round(flightsProgress((performance.now() - from) / 1000) * 60) / 60
      setProgress(p)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [st.card])

  const inSpeed = inSpeedAt(playback.current.time)
  // Following: the window under the playhead now (a render can come before the subscription's).
  const f = clip ? null : follow ?? null
  const idx = f ? followIdx(playback.current.time) : -1
  const shown = f ? (idx >= 0 ? f.data(f.windows[idx].playId) : null) : null
  const inClip = f ? !!shown : inClipAt(playback.current.time) || st.inClip
  if (f) { scoreboard = shown?.scoreboard ?? null; caption = shown?.caption ?? null; override = undefined }
  speedShown.current = inSpeed
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = prepareCanvas(c, size.w, size.h)
    if (st.card) {
      drawCard(ctx, size.w, size.h, st.card, settings.titleCard, settings.theme, logoImage(st.card.opp), assetImage)
      if (st.card.slide) drawSlideMarks(ctx, size.w, size.h, st.card.slide, heatOpacity)
      for (const a of st.card.annotations ?? []) drawAnnotation(ctx, a, size.w, size.h, assetImage)
      if (flights) drawFlights(ctx, size.w, size.h, flights, progress)
      return
    }
    if (speed && settings.serveSpeed.enabled && inSpeed) drawServeSpeed(ctx, size.w, size.h, speed.kmh, settings.serveSpeed, lookTheme(settings))
    if (!inClip) return
    if (scoreboard && settings.scoreboard.enabled && !override?.scoreboard?.hidden) drawScoreboard(ctx, size.w, size.h, scoreboard, settings.scoreboard, lookTheme(settings))
    if (caption && settings.playerCaption.enabled && !override?.playerCaption?.hidden) drawCaption(ctx, size.w, size.h, caption, settings.playerCaption, lookTheme(settings), packPhotoImage(caption.photo))
  }, [size.w, size.h, settings, scoreboard, caption, override, inClip, inSpeed, speed, st.card, logoTick, flights, progress, heatOpacity, st.idx])

  return <canvas ref={canvas} className="overlay-layer" data-testid="overlay-canvas" style={{ width: size.w, height: size.h }} />
}
