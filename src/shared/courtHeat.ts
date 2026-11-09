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

const grids = new WeakMap<SlideHeat, HeatGrid>()

// Painted pixel by pixel from the picture back onto the floor, at half size and smoothed up.
export function drawHeat(ctx: Ctx, w: number, h: number, heat: SlideHeat, opacity = HEAT_OPACITY): void {
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
      const v = heatAt(grid, (A * x + B * y + C) / q, (D * x + E * y + F) / q)
      if (v < 0.04) continue
      const c = heatColor(v)
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]
      px[i + 3] = 255 * opacity * Math.min(1, v * 5)
    }
  }
  out.putImageData(image, 0, 0)
  ctx.drawImage(off, 0, 0, w, h)
}

// Which way the ball goes on screen in a play: 'up' from the near side toward the far one, 'down'
// the other way. A serve or an attack leaves the player's side; a reception, dig, block or freeball
// comes to it. A set has no way (null).
