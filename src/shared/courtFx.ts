import { COURT_L_M, COURT_W_M, RIPPLE_COLOR, RIPPLE_END_SEC, drawRipplePin } from './courtHeat'
import { type CourtFit, type Ctx, type Pt, homography, inPixels, project } from './courtGeometry'

// Other landing effects beside the ripple (着弾の演出): all lines and points laid on the floor in the
// court's perspective, each over seconds from the landing, then gone. Like the ripple they leave the
// heatmap as it is.
//   lock  (ロックオン): four corner brackets close in on the landing, turning, and snap onto it.
//   flash (閃光): a white flash with spikes at the moment of the landing, and a short glow.
//   trail (軌跡の残光): the ball's track on the floor to the landing, a comet with its head on the mark,
//                       dissolving from its tail.
export type LandingFx = 'ripple' | 'lock' | 'flash' | 'trail'
export const LANDING_FX: LandingFx[] = ['ripple', 'lock', 'flash', 'trail']
export const isLandingFx = (x: unknown): x is LandingFx => LANDING_FX.includes(x as LandingFx)

const FX_END_SEC: Record<LandingFx, number> = { ripple: RIPPLE_END_SEC, lock: 3.0, flash: 0.8, trail: 2.6 }
// When the effect is over, seconds from the landing.
export const landingFxEnd = (fx: LandingFx): number => FX_END_SEC[fx]
// The moment a still picture shows (the editor with no clock, an effect that has not got going).
export const landingFxStill: Record<LandingFx, number> = { ripple: 1.55, lock: 1.2, flash: 0.06, trail: 0.7 }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x))
const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : RIPPLE_COLOR.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const rgba = (hex: string, a: number) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})` }
const fadeOut = (sec: number, from: number, end: number) => 1 - clamp01((sec - from) / (end - from))

// The track the ball made on the floor: from `start` to `impact` (court units), or null without a start.
export interface FxTrack { start: Pt }

export function drawLandingFx(ctx: Ctx, w: number, h: number, fit: CourtFit, fx: LandingFx, impact: Pt, sec: number, color = RIPPLE_COLOR, track?: FxTrack | null): void {
  if (fx === 'ripple' || sec < 0 || sec >= FX_END_SEC[fx]) return
  const H = homography(inPixels(fit, w, h)), unit = w / 1280
  const at = (mx: number, my: number): Pt => project(H, impact.x + mx / COURT_W_M, impact.y + my / COURT_L_M) // metres from the landing
  const poly = (pts: Pt[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))) }
  const disc = (r: number) => Array.from({ length: 36 }, (_, i) => at(r * Math.cos((i / 36) * Math.PI * 2), r * Math.sin((i / 36) * Math.PI * 2)))
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowColor = color; ctx.shadowBlur = 8 * unit

  if (fx === 'lock') {
    // Brackets from 4 m out, turning a quarter-turn less as they close to 0.75 m in 0.45 s, then a ring pulse as they snap.
    const p = easeOutCubic(clamp01(sec / 0.45)), half = 0.75 + 3.25 * (1 - p), turn = (1 - p) * 0.9, arm = 0.5 + 0.8 * (1 - p) * 0.4
    const fade = fadeOut(sec, 2.3, FX_END_SEC.lock), cs = Math.cos(turn), sn = Math.sin(turn)
    const rot = (x: number, y: number): Pt => at(x * cs - y * sn, x * sn + y * cs)
    ctx.globalAlpha = fade * Math.min(1, 0.35 + p)
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, 3 * unit)
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      poly([rot(sx * half, sy * (half - arm)), rot(sx * half, sy * half), rot(sx * (half - arm), sy * half)])
      ctx.stroke()
    }
    if (sec >= 0.4) { // the snap: a ring that opens and thins out, and the mark stays as a dot
      const s = clamp01((sec - 0.4) / 0.5)
      ctx.globalAlpha = fade * (1 - s) * 0.9
      ctx.lineWidth = Math.max(1.5, 2 * unit)
      poly([...disc(0.9 + 2.2 * easeOutExpo(s)), at(0.9 + 2.2 * easeOutExpo(s), 0)]); ctx.stroke()
    }
    ctx.globalAlpha = fade * clamp01(sec / 0.3)
    ctx.fillStyle = color
    poly(disc(0.2 + 0.1 * Math.sin(sec * 6))); ctx.fill()
    ctx.restore()
    return
  }

  if (fx === 'flash') {
    // A hot white disc and four spikes for a blink, then a glow that shrinks away.
    const k = clamp01(sec / 0.14), blink = 1 - k, glow = fadeOut(sec, 0, FX_END_SEC.flash)
    ctx.fillStyle = rgba(color, 0.35 * glow)
    poly(disc(0.8 + 1.4 * (1 - glow))); ctx.fill()
    ctx.fillStyle = rgba(color, 0.5 * glow)
    poly(disc(0.4 + 0.5 * glow)); ctx.fill()
    if (blink > 0) {
      ctx.fillStyle = `rgba(255,255,255,${blink})`
      poly(disc(0.5 + 1.2 * easeOutExpo(k))); ctx.fill()
      ctx.strokeStyle = `rgba(255,255,255,${blink})`; ctx.lineWidth = Math.max(1.5, 2.5 * unit)
      const reach = 1 + 3 * easeOutExpo(k)
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; poly([at(0.4 * Math.cos(a), 0.4 * Math.sin(a)), at(reach * Math.cos(a), reach * Math.sin(a))]); ctx.stroke() }
    }
    ctx.restore()
    return
  }

  // trail: the last stretch of the track, thick at the landing and thin toward the tail; it draws itself in
  // over 0.25 s, then the tail dissolves toward the landing.
  if (track) {
    const sx = (track.start.x - impact.x) * COURT_W_M, sy = (track.start.y - impact.y) * COURT_L_M, len = Math.hypot(sx, sy)
    if (len > 0.5) {
      const L = Math.min(len, 9), ux = sx / len, uy = sy / len, nx = -uy, ny = ux
      const drawn = easeOutCubic(clamp01(sec / 0.25)), cut = clamp01((sec - 0.7) / 1.5) // how far the head has come, how much of the tail is gone
      const lo = 0, hi = Math.min(L * drawn, L * (1 - cut)) // the distances from the landing that show
      const N = 24, fade = fadeOut(sec, 1.6, FX_END_SEC.trail)
      const side = (sign: number) => Array.from({ length: N + 1 }, (_, i) => {
        const d = lo + ((hi - lo) * i) / N, wd = 0.34 * (1 - d / L) + 0.03
        return at(ux * d + nx * wd * sign, uy * d + ny * wd * sign)
      })
      if (hi > 0.05) {
      const a = side(-1), b = side(1), head = at(0, 0), tail = at(ux * hi, uy * hi)
      const g = ctx.createLinearGradient(head.x, head.y, tail.x, tail.y)
      g.addColorStop(0, rgba(color, 0.95)); g.addColorStop(1, rgba(color, 0))
      ctx.globalAlpha = fade
      ctx.fillStyle = g
      poly([...a, ...b.reverse()]); ctx.closePath(); ctx.fill()
      }
    }
  }
  drawRipplePin(ctx, w, h, fit, impact, Math.min(sec, 2.4), color)
  ctx.restore()
}
