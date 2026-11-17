// Heatmaps of where shots landed (court.ts), drawn on the floor of the fitted court.
import { type CourtFit, type Ctx, type Pt, homography, inPixels, project } from './courtGeometry'
export interface SlideHeat { fit: CourtFit; points: Pt[]; rough?: number[] }
export const COURT_W_M = 9, COURT_L_M = 18
const HEAT_CELL_M = 0.25, HEAT_SIGMA_M = 0.8, HEAT_MARGIN_M = 3
// Measured on a season's files against their clicks: 1 m fits best with a sub-zone, whose middle is
// about 0.6 m off; the wider one is for a whole zone, about 1.5 m off.
export const HEAT_SUB_SIGMA_M = 1, HEAT_ZONE_SIGMA_M = 1.4
export const HEAT_OPACITY = 0.6 // the heatmap at its thickest, unless GridStyle.heatOpacity says otherwise
const HEAT_RAMP: [number, [number, number, number]][] = [[0, [37, 99, 235]], [0.3, [6, 182, 212]], [0.5, [34, 197, 94]], [0.72, [250, 204, 21]], [1, [220, 38, 38]]]

// The colour for a thickness of 0–1.
export function heatColor(v: number): [number, number, number] {
  const hi = Math.max(1, HEAT_RAMP.findIndex(([at]) => at >= v))
  const [a, ca] = HEAT_RAMP[hi - 1], [b, cb] = HEAT_RAMP[hi]
  const s = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return [ca[0] + (cb[0] - ca[0]) * s, ca[1] + (cb[1] - ca[1]) * s, ca[2] + (cb[2] - ca[2]) * s]
}

interface HeatGrid { cols: number; rows: number; data: Float32Array } // 0–1, the thickest spot is 1
export function heatGrid(points: Pt[], rough?: number[]): HeatGrid {
  const cols = Math.round((COURT_W_M + 2 * HEAT_MARGIN_M) / HEAT_CELL_M) + 1, rows = Math.round((COURT_L_M + 2 * HEAT_MARGIN_M) / HEAT_CELL_M) + 1
  const data = new Float32Array(cols * rows)
  // A rough point spreads wider and so thinner: still one shot's worth.
  for (const [i, p] of points.entries()) {
    const sigma = rough?.[i] || HEAT_SIGMA_M, weight = (HEAT_SIGMA_M / sigma) ** 2, reach = Math.ceil((3 * sigma) / HEAT_CELL_M)
    const cx = (p.x * COURT_W_M + HEAT_MARGIN_M) / HEAT_CELL_M, cy = (p.y * COURT_L_M + HEAT_MARGIN_M) / HEAT_CELL_M
    for (let r = Math.max(0, Math.ceil(cy - reach)); r <= Math.min(rows - 1, Math.floor(cy + reach)); r++) {
      for (let c = Math.max(0, Math.ceil(cx - reach)); c <= Math.min(cols - 1, Math.floor(cx + reach)); c++) {
        const d2 = ((c - cx) ** 2 + (r - cy) ** 2) * HEAT_CELL_M ** 2
        data[r * cols + c] += weight * Math.exp(-d2 / (2 * sigma ** 2))
      }
    }
  }
  const top = data.reduce((m, v) => Math.max(m, v), 0)
  if (top > 0) for (let i = 0; i < data.length; i++) data[i] /= top
  return { cols, rows, data }
}

// The grid at a place on the court (units as Pt), blended between cells; 0 off the grid.
export function heatAt({ cols, rows, data }: HeatGrid, x: number, y: number): number {
  const cx = (x * COURT_W_M + HEAT_MARGIN_M) / HEAT_CELL_M, cy = (y * COURT_L_M + HEAT_MARGIN_M) / HEAT_CELL_M
  const c = Math.floor(cx), r = Math.floor(cy)
  if (c < 0 || r < 0 || c >= cols - 1 || r >= rows - 1) return 0
  const fx = cx - c, fy = cy - r, i = r * cols + c
  return (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + cols] * (1 - fx) + data[i + cols + 1] * fx) * fy
}

// The landing ripple (着弾の波紋): from the landing, a ring of golden light bursts over the floor and
// the player's heatmap shows behind it; it stays, then fades out. Seconds from the landing.
// The ring flies out at once and slows to a stop (an exponential ease), brightest and thinnest at the
// start, wider and dimmer as it goes, with a fainter echo a moment behind; the floor just behind it
// glows gold for a moment, as if lit by it.
export const RIPPLE_REVEAL_SEC = 0.8, RIPPLE_HOLD_SEC = 2.3, RIPPLE_END_SEC = 3.0
export const RIPPLE_COLOR = '#FFC23D' // gold: the glow, the pin's ring
const RIPPLE_CORE = '#FFF6D5' // the ring's hot middle, nearly white
const RIPPLE_REACH_M = 12, RIPPLE_EDGE_M = 0.8, RIPPLE_ECHO_SEC = 0.14
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x))
const easeOutBack = (x: number) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2
const hexRgb = (hex: string): [number, number, number] => { const n = parseInt(/^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : RIPPLE_COLOR.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
interface Ring { radius: number; strength: number; core: number; glow: number } // metres; 0–1; the core's and the glow's half widths in metres
export interface RipplePhase { radius: number; ring: number; fade: number; rings: Ring[] }
const ringAt = (sec: number, strength: number): Ring | null => {
  const p = sec / RIPPLE_REVEAL_SEC
  if (p < 0 || p >= 1) return null
  return { radius: RIPPLE_REACH_M * easeOutExpo(p), strength: strength * (1 - p) ** 1.4, core: 0.16 + 0.2 * p, glow: 0.5 + 1.1 * p }
}
// How far the ring has gone (metres), how strong it is, how much of everything is left, and the rings
// to draw (the ring and its echo); null when nothing shows.
export function ripplePhase(sec: number): RipplePhase | null {
  if (sec < 0 || sec >= RIPPLE_END_SEC) return null
  const p = Math.min(1, sec / RIPPLE_REVEAL_SEC)
  const main = ringAt(sec, 1), rings = [main, ringAt(sec - RIPPLE_ECHO_SEC, 0.45)].filter((r): r is Ring => !!r)
  return { radius: RIPPLE_REACH_M * easeOutExpo(p), ring: main?.strength ?? 0, fade: sec < RIPPLE_HOLD_SEC ? 1 : 1 - (sec - RIPPLE_HOLD_SEC) / (RIPPLE_END_SEC - RIPPLE_HOLD_SEC), rings }
}
// The moments the export draws (each its own layer): [from, to) seconds from the landing, and the time
// drawn. The burst is quick, so the steps are short at first and longer as the ring slows.
export function rippleSteps(): { from: number; to: number; at: number }[] {
  const out: { from: number; to: number; at: number }[] = [], N = 16
  for (let k = 0; k < N; k++) { const from = RIPPLE_REVEAL_SEC * (k / N) ** 2, to = RIPPLE_REVEAL_SEC * ((k + 1) / N) ** 2; out.push({ from, to, at: (from + to) / 2 }) }
  out.push({ from: RIPPLE_REVEAL_SEC, to: RIPPLE_HOLD_SEC, at: (RIPPLE_REVEAL_SEC + RIPPLE_HOLD_SEC) / 2 })
  for (let k = 0; k < 7; k++) { const from = RIPPLE_HOLD_SEC + 0.1 * k, to = Math.min(RIPPLE_END_SEC, from + 0.1); out.push({ from, to, at: (from + to) / 2 }) }
  return out
}

// The landing's mark on the floor: a white flash as it lands, the mark popping up past its size and
// settling, then a slow golden pulse.
export function drawRipplePin(ctx: Ctx, w: number, h: number, fit: CourtFit, impact: Pt, sec: number, color = RIPPLE_COLOR): void {
  const rp = ripplePhase(sec)
  if (!rp) return
  const H = homography(inPixels(fit, w, h))
  const POP = 0.3, flash = sec < 0.18 ? 1 - sec / 0.18 : 0
  const scale = sec < POP ? Math.max(0.05, easeOutBack(sec / POP)) : 1 + 0.05 * Math.sin((sec - POP) * 3 * Math.PI)
  const circle = (m: number) => Array.from({ length: 40 }, (_, i) => project(H, impact.x + (m * scale * Math.cos((i / 40) * Math.PI * 2)) / COURT_W_M, impact.y + (m * scale * Math.sin((i / 40) * Math.PI * 2)) / COURT_L_M))
  const path = (pts: Pt[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath() }
  ctx.save()
  ctx.globalAlpha = rp.fade
  ctx.shadowColor = color; ctx.shadowBlur = (w / 90) * (1 + 3 * flash)
  if (flash > 0) { ctx.globalAlpha = rp.fade * flash * 0.8; ctx.fillStyle = RIPPLE_CORE; path(circle(1.4)); ctx.fill(); ctx.globalAlpha = rp.fade }
  ctx.strokeStyle = RIPPLE_CORE; ctx.lineWidth = Math.max(2, w / 400)
  path(circle(0.55)); ctx.stroke()
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.5, w / 600)
  path(circle(0.85)); ctx.stroke()
  ctx.fillStyle = color
  path(circle(0.22)); ctx.fill()
  ctx.restore()
}

const grids = new WeakMap<SlideHeat, HeatGrid>()

// Painted pixel by pixel from the picture back onto the floor, at half size and smoothed up.
export function drawHeat(ctx: Ctx, w: number, h: number, heat: SlideHeat, opacity = HEAT_OPACITY, ripple?: { sec: number; impact: Pt; color?: string }): void {
  const rp = ripple ? ripplePhase(ripple.sec) : null
  if (ripple && !rp) return
  const [gr, gg, gb] = hexRgb(ripple?.color ?? RIPPLE_COLOR), [cr, cg, cb] = hexRgb(RIPPLE_CORE)
  const grid = grids.get(heat) ?? heatGrid(heat.points, heat.rough)
  grids.set(heat, grid)
  const sw = Math.ceil(w / 2), sh = Math.ceil(h / 2)
  const H = homography(inPixels(heat.fit, sw, sh))
  // The inverse of the homography (its adjugate); `side` tells the floor from what is above the horizon.
  const A = H.e - H.f * H.h, B = H.c * H.h - H.b, C = H.b * H.f - H.c * H.e
  const D = H.f * H.g - H.d, E = H.a - H.c * H.g, F = H.c * H.d - H.a * H.f
  const G = H.d * H.h - H.e * H.g, J = H.b * H.g - H.a * H.h, K = H.a * H.e - H.b * H.d
  const mid = project(H, 0.5, 0.5), side = Math.sign(G * mid.x + J * mid.y + K)
  const off = new OffscreenCanvas(sw, sh), out = off.getContext('2d')!, image = out.createImageData(sw, sh), px = image.data
  for (let y = 0, i = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++, i += 4) {
      const q = G * x + J * y + K
      if (q * side <= 1e-9) continue
      const fx = (A * x + B * y + C) / q, fy = (D * x + E * y + F) / q
      const v = heatAt(grid, fx, fy)
      let a = 0, r = 0, g = 0, b = 0 // the heat, then (with a ripple) the ring over it
      if (v >= 0.04) {
        const c = heatColor(v)
        r = c[0]; g = c[1]; b = c[2]
        a = 255 * opacity * Math.min(1, v * 5)
      }
      if (rp && ripple) {
        const d = Math.hypot((fx - ripple.impact.x) * COURT_W_M, (fy - ripple.impact.y) * COURT_L_M)
        a *= Math.max(0, Math.min(1, (rp.radius - d) / RIPPLE_EDGE_M)) * rp.fade // only what the ring has passed
        // Light over the heat: each ring's gold glow and hot core, and the floor just behind the ring lit gold.
        let glow = 0, core = 0
        for (const rg of rp.rings) {
          const dr = d - rg.radius
          glow += rg.strength * Math.exp(-((dr / rg.glow) ** 2)) * 0.75
          core += rg.strength * Math.exp(-((dr / rg.core) ** 2))
          if (dr < 0) glow += rg.strength * 0.3 * Math.exp(-((dr / 2.2) ** 2))
        }
        glow = Math.min(1, glow) * 255; core = Math.min(1, core) * 255
        if (glow > 1) { const under = a * (1 - glow / 255), sum = glow + under; r = (r * under + gr * glow) / sum; g = (g * under + gg * glow) / sum; b = (b * under + gb * glow) / sum; a = sum }
        if (core > 1) { const under = a * (1 - core / 255), sum = core + under; r = (r * under + cr * core) / sum; g = (g * under + cg * core) / sum; b = (b * under + cb * core) / sum; a = sum }
      }
      if (a < 1) continue
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a
    }
  }
  out.putImageData(image, 0, 0)
  ctx.drawImage(off, 0, 0, w, h)
}

// Which way the ball goes on screen in a play: 'up' from the near side toward the far one, 'down'
// the other way. A serve or an attack leaves the player's side; a reception, dig, block or freeball
// comes to it. A set has no way (null).
