// 先読み (the forecast): what the court shows before a serve or an attack happens, so the clip tells
// from its first frame what comes next. Times are seconds from the moment the ball leaves (t; negative
// before it), `dur` the ball's time in the air, so t = dur is the landing. The landing's own effect
// (the ripple, lock, flash, trail) is left as it is: the forecast hands over to it and fades out.
//   ghost  the whole flight as a faint dashed line, its dashes running toward the landing
//   zone   the zone it will land in, glowing softly and a little more as the ball nears
//   target a ring with four ticks on the floor at the landing, pulsing and drawing in as the ball comes
//   count  a ring closing on the hit point just before the ball is struck
import type { Ctx, Pt } from './courtGeometry'

export const FORECAST_RAMP_SEC = 2 // the ghost grows clearer over the last 2 s before the hit
export const FORECAST_COUNT_SEC = 0.7 // the count-in ring closes over this long, ending at the hit
export const FORECAST_FADE_SEC = 0.3 // everything fades this long after the landing
const COUNT_FADE_SEC = 0.2 // the count-in ring's fade after the hit

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3

export interface ForecastPhase {
  ghost: number // 0..1 opacity of the dashed line
  zone: number // opacity of the landing zone's glow
  target: number // opacity of the landing ring
  reach: number // the landing ring's size, 1 at the landing and wider before it
  count: { size: number; alpha: number } | null // size: 1 at the hit, wider before it
}

// What shows at time t, or null when nothing does (after the fade).
export function forecastPhase(t: number, dur: number): ForecastPhase | null {
  const hold = t <= dur ? 1 : 1 - (t - dur) / FORECAST_FADE_SEC
  if (hold <= 0) return null
  const ramp = clamp01(1 + t / FORECAST_RAMP_SEC), pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.2 * t)
  const near = dur > 0 ? clamp01(t / dur) : 1 // how far the ball has gone
  let count: ForecastPhase['count'] = null
  if (t >= -FORECAST_COUNT_SEC && t < COUNT_FADE_SEC) {
    const p = clamp01((t + FORECAST_COUNT_SEC) / FORECAST_COUNT_SEC)
    count = { size: 1 + 2.4 * (1 - easeOutCubic(p)), alpha: (0.25 + 0.75 * p) * (t > 0 ? 1 - t / COUNT_FADE_SEC : 1) }
  }
  return {
    ghost: hold * (0.45 + 0.35 * ramp),
    zone: hold * (0.1 + 0.08 * pulse + 0.14 * near),
    target: hold * (0.6 + 0.25 * pulse),
    reach: 1 + 0.7 * clamp01((dur - t) / 0.6),
    count,
  }
}

// The moments the export draws (each its own layer): [from, to) seconds from the hit, and the time
// drawn. Coarse while the ghost waits, fine around the hit, medium through the flight. The first
// stretch has no start: it covers the clip from its first frame.
export function forecastSteps(dur: number): { from: number; to: number; t: number }[] {
  const end = dur + FORECAST_FADE_SEC, out: { from: number; to: number; t: number }[] = [{ from: -Infinity, to: -FORECAST_RAMP_SEC, t: -FORECAST_RAMP_SEC }]
  const run = (a: number, b: number, step: number) => {
    const n = Math.max(1, Math.round((Math.min(b, end) - a) / step))
    for (let i = 0; i < n && a < end; i++) { const from = a + ((Math.min(b, end) - a) * i) / n, to = a + ((Math.min(b, end) - a) * (i + 1)) / n; out.push({ from, to, t: (from + to) / 2 }) }
  }
  run(-FORECAST_RAMP_SEC, -FORECAST_COUNT_SEC, 0.25)
  run(-FORECAST_COUNT_SEC, COUNT_FADE_SEC, 0.07)
  run(COUNT_FADE_SEC, end, 0.15)
  return out
}

export function drawForecastZone(ctx: Ctx, quad: Pt[], phase: ForecastPhase, color: string): void {
  ctx.save()
  ctx.globalAlpha = phase.zone
  ctx.fillStyle = color
  ctx.beginPath(); quad.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill()
  ctx.restore()
}

// The flight as a dashed line over `path` (the picture's points from the hit to the landing); the
// dashes run along it as time goes, one dash length a second.
export function drawForecastGhost(ctx: Ctx, path: Pt[], phase: ForecastPhase, w: number, t: number): void {
  if (path.length < 2) return
  const lw = Math.max(2.5, w / 330), dash = w / 100
  ctx.save()
  ctx.globalAlpha = phase.ghost
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = lw * 1.5
  ctx.setLineDash([dash, dash * 1.2]); ctx.lineDashOffset = -t * dash
  ctx.beginPath(); path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke()
  ctx.restore()
}

// The landing ring: `at(mx, my)` is the picture's point mx, my metres from the landing on the floor.
export function drawForecastTarget(ctx: Ctx, at: (mx: number, my: number) => Pt, phase: ForecastPhase, w: number, color: string): void {
  const r = 0.75 * phase.reach, tick = 0.4
  const ring = Array.from({ length: 40 }, (_, i) => at(r * Math.cos((i / 40) * Math.PI * 2), r * Math.sin((i / 40) * Math.PI * 2)))
  ctx.save()
  ctx.globalAlpha = phase.target
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(2, w / 380); ctx.lineCap = 'round'
  ctx.shadowColor = color; ctx.shadowBlur = w / 160
  ctx.beginPath(); ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.stroke()
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, s = at((r - tick * 0.5) * Math.cos(a), (r - tick * 0.5) * Math.sin(a)), e = at((r + tick) * Math.cos(a), (r + tick) * Math.sin(a))
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke()
  }
  const c = at(0, 0)
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(2, w / 520), 0, Math.PI * 2); ctx.fill()
  ctx.restore()
}

// The count-in: a ring closing on the hit point `p` (in the air, in the picture) down to the point's own size.
export function drawForecastCount(ctx: Ctx, p: Pt, phase: ForecastPhase, w: number): void {
  const c = phase.count
  if (!c) return
  const r0 = Math.max(4, w / 160)
  ctx.save()
  ctx.globalAlpha = c.alpha
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(2.5, w / 300)
  ctx.shadowColor = '#FACC15'; ctx.shadowBlur = w / 130
  ctx.beginPath(); ctx.arc(p.x, p.y, r0 * (1.5 + 3.2 * (c.size - 1)), 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}
