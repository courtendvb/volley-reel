// The court fitted to a video by its four corners (court.ts): the zones and sub-zones of each side,
// the mapping between the court and the picture, which side is near, and the cells a play's zones are in.
import type { Play, Side } from './types'

export interface Pt { x: number; y: number }

// Fitted once per match (the camera stays put). Corners are 0..1 over the video picture:
// far end line left / right, near end line left / right, as seen from the camera.
export interface CourtFit {
  corners: [Pt, Pt, Pt, Pt] // topLeft, topRight, bottomLeft, bottomRight
  nearSet1: Side // the team on the near side in set 1; sides change every set, and at 8 in set 5
}

export const DEFAULT_CORNERS: CourtFit['corners'] = [
  { x: 0.36, y: 0.28 }, { x: 0.64, y: 0.28 }, { x: 0.14, y: 0.9 }, { x: 0.86, y: 0.9 },
]

const COURT_W = 9 // metres
const COURT_L = 18
export const COLS = 3
export const ROWS = 6
export const HALF = ROWS / 2

// [row][col]: row 0 is the far end line, row 5 the near one; col 0 is the camera's left.
export const ZONE_NUMBERS: number[][] = [
  [1, 6, 5],
  [9, 8, 7],
  [2, 3, 4],
  [4, 3, 2],
  [7, 8, 9],
  [5, 6, 1],
]

// Sub-zones A–D: the middle of each quarter of a cell (du across, dv down), as seen from the
// camera. Each team's half reads the same from its own side, so the far half is the near one turned.
const SUB_NEAR: Record<string, [number, number]> = { A: [0.75, 0.75], B: [0.75, 0.25], C: [0.25, 0.25], D: [0.25, 0.75] }
const SUB_FAR: Record<string, [number, number]> = { A: [0.25, 0.25], B: [0.25, 0.75], C: [0.75, 0.75], D: [0.75, 0.25] }

// Serve start zones: behind the end line in five, 1-9-6-7-5 from the zone 1 side. In order from the
// camera's left: the far side has zone 1 on the left, the near side on the right. The strip is one
// zone row deep.
const SERVE_COLS = 5
const SERVE_FAR = [1, 9, 6, 7, 5]
const SERVE_NEAR = [5, 7, 6, 9, 1]

function subCenter(c: Cell, sub: string): [number, number] | null {
  return (c.row < HALF ? SUB_FAR : SUB_NEAR)[sub] ?? null
}

// ---- geometry -------------------------------------------------------------------------------

export interface Homography { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number }

// The unit square (u across, v from far to near) onto the four corners.
// Where a corner's handle goes: on the corner, or at the edge of the picture when the corner is
// outside it, so it can always be grabbed. margin in pixels.
export function handleAt(p: Pt, w: number, h: number, margin: number): Pt {
  const keep = (v: number, size: number) => Math.min(1 - margin / size, Math.max(margin / size, v))
  return { x: keep(p.x, w), y: keep(p.y, h) }
}

export function homography(corners: readonly [Pt, Pt, Pt, Pt]): Homography {
  const [p0, p1, p2, p3] = corners
  const dx1 = p1.x - p3.x, dx2 = p2.x - p3.x
  const dy1 = p1.y - p3.y, dy2 = p2.y - p3.y
  const sx = p0.x - p1.x + p3.x - p2.x
  const sy = p0.y - p1.y + p3.y - p2.y
  const den = dx1 * dy2 - dx2 * dy1
  if (Math.abs(den) < 1e-9) return { a: p1.x - p0.x, b: p2.x - p0.x, c: p0.x, d: p1.y - p0.y, e: p2.y - p0.y, f: p0.y, g: 0, h: 0 }
  const g = (sx * dy2 - dx2 * sy) / den
  const h = (dx1 * sy - sx * dy1) / den
  return {
    a: p1.x - p0.x + g * p1.x, b: p2.x - p0.x + h * p2.x, c: p0.x,
    d: p1.y - p0.y + g * p1.y, e: p2.y - p0.y + h * p2.y, f: p0.y,
    g, h,
  }
}

export function project(H: Homography, u: number, v: number): Pt {
  const w = H.g * u + H.h * v + 1
  return { x: (H.a * u + H.b * v + H.c) / w, y: (H.d * u + H.e * v + H.f) / w }
}

// Where to lay a picture of the court (a heatmap, say): the whole court, or the near or far half,
// as corners of the picture (top-left, top-right, bottom-left, bottom-right). A half is laid with
// the net at the top of the picture for the near side and at the bottom for the far side.
export type CourtPart = 'full' | 'near' | 'far'
export function courtQuad(corners: CourtFit['corners'], part: CourtPart): [[number, number], [number, number], [number, number], [number, number]] {
  const H = homography(corners)
  const [v0, v1] = part === 'full' ? [0, 1] : part === 'near' ? [0.5, 1] : [0, 0.5]
  const at = (u: number, v: number): [number, number] => { const p = project(H, u, v); return [p.x, p.y] }
  return [at(0, v0), at(1, v0), at(0, v1), at(1, v1)]
}

// The camera behind the picture, recovered from the fitted corners of a 9 × 18 m court (w × h pixels,
// square pixels, the optical axis through the middle of the picture): where a point above the
// floor shows, u and v as court units and z in metres. Null when the corners can't tell (seen
// straight from above, say), and then there is no height to show.
export function courtCamera(corners: readonly [Pt, Pt, Pt, Pt], w: number, h: number): ((u: number, v: number, z: number) => Pt) | null {
  const cx = w / 2, cy = h / 2
  const H = homography(corners.map(p => ({ x: p.x - cx, y: p.y - cy })) as [Pt, Pt, Pt, Pt])
  // The floor's two axes in metres; rotated into the camera they are the same length and square.
  const c1 = [H.a / COURT_W, H.d / COURT_W, H.g / COURT_W], c2 = [H.b / COURT_L, H.e / COURT_L, H.h / COURT_L], c3 = [H.c, H.f, 1]
  const f2 = (c1[0] ** 2 + c1[1] ** 2 - c2[0] ** 2 - c2[1] ** 2) / (c2[2] ** 2 - c1[2] ** 2)
  if (!(f2 > 0) || !isFinite(f2)) return null
  const f = Math.sqrt(f2), inCam = (c: number[]) => [c[0] / f, c[1] / f, c[2]]
  const a = inCam(c1), b = inCam(c2), t0 = inCam(c3), s = 1 / Math.hypot(...a)
  const r1 = a.map(x => x * s), r2 = b.map(x => x * s), t = t0.map(x => x * s)
  const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]]
  const show = (u: number, v: number, z: number, up: number): Pt => {
    const p = [0, 1, 2].map(i => r1[i] * u * COURT_W + r2[i] * v * COURT_L + r3[i] * z * up + t[i])
    return { x: (p[0] / p[2]) * f + cx, y: (p[1] / p[2]) * f + cy }
  }
  const up = show(0.5, 0.5, 2, 1).y < show(0.5, 0.5, 0, 1).y ? 1 : -1 // up goes up the picture
  return (u, v, z) => show(u, v, z, up)
}

// The floor under a point of the picture (0..1), in court units; null above the horizon.
export function floorAt(fit: CourtFit | Pick<CourtFit, 'corners'>, p: Pt): Pt | null {
  const H = homography(fit.corners)
  const G = H.d * H.h - H.e * H.g, J = H.b * H.g - H.a * H.h, K = H.a * H.e - H.b * H.d
  const q = G * p.x + J * p.y + K, mid = project(H, 0.5, 0.5)
  if (q * (G * mid.x + J * mid.y + K) <= 1e-12) return null
  return {
    x: ((H.e - H.f * H.h) * p.x + (H.c * H.h - H.b) * p.y + (H.b * H.f - H.c * H.e)) / q,
    y: ((H.f * H.g - H.d) * p.x + (H.a - H.c * H.g) * p.y + (H.c * H.d - H.a * H.f)) / q,
  }
}

// A rectangle lying on the floor, square to the court's lines, from one point of the picture to the
// other (0..1): its four corners in the picture, so it shows in the court's perspective (a trapezoid,
// usually). Null when a point is above the horizon.
// Painting zones: the court cut into the 9 zones of each half (div 3: 3 across, 6 down) or each zone
// into 9 again (div 9: 9 across, 18 down). Row 0 is the far end line, col 0 the camera's left, as in
// ZONE_NUMBERS. A cell's corners in the picture (0..1), for a polygon laid on the fitted court.
export type ZoneDiv = 3 | 9
export interface ZoneCell { row: number; col: number; div: ZoneDiv }
export function zoneCellQuad(corners: CourtFit['corners'], c: ZoneCell): [number, number][] {
  const H = homography(corners), rows = c.div * 2
  return ([[c.col, c.row], [c.col + 1, c.row], [c.col + 1, c.row + 1], [c.col, c.row + 1]] as const)
    .map(([u, v]) => { const p = project(H, u / c.div, v / rows); return [p.x, p.y] as [number, number] })
}
// The zone number (1–9) a cell lies in.
export const zoneOfCell = (c: ZoneCell): number => {
  const k = c.div / COLS
  return ZONE_NUMBERS[Math.floor(c.row / k)][Math.floor(c.col / k)]
}

export function floorRect(corners: CourtFit['corners'], from: Pt, to: Pt): [number, number][] | null {
  const a = floorAt({ corners }, from), b = floorAt({ corners }, to)
  if (!a || !b) return null
  const H = homography(corners)
  return ([[a.x, a.y], [b.x, a.y], [b.x, b.y], [a.x, b.y]] as const).map(([u, v]) => { const p = project(H, u, v); return [p.x, p.y] as [number, number] })
}

// The zone a point of the floor is in; null off the court.
export function zoneAt(p: Pt): number | null {
  const row = Math.floor(p.y * ROWS), col = Math.floor(p.x * COLS)
  return row >= 0 && row < ROWS && col >= 0 && col < COLS ? ZONE_NUMBERS[row][col] : null
}

// The points nearest to one, as indexes, measured in metres on the floor.
export function nearestShots(points: Pt[], to: Pt, count: number): number[] {
  const away = (p: Pt) => Math.hypot((p.x - to.x) * COURT_W, (p.y - to.y) * COURT_L)
  return points.map((_, i) => i).sort((a, b) => away(points[a]) - away(points[b])).slice(0, count)
}

// ---- which side, which cell -----------------------------------------------------------------

// The team on the near side for a rally: swapped every set up to set 4; set 5 starts on the same
// sides as set 4 and swaps once a team has 8 (the score is the one before the rally).
export function nearSide(fit: CourtFit, play: Pick<Play, 'setNum' | 'score'>): Side {
  let flip = (Math.min(play.setNum, 4) - 1) % 2 === 1
  if (play.setNum === 5 && Math.max(play.score.home, play.score.away) >= 8) flip = !flip
  return flip ? other(fit.nearSet1) : fit.nearSet1
}

const other = (s: Side): Side => (s === '*' ? 'a' : '*')

interface Cell { row: number; col: number }

export function zoneCell(zone: number, near: boolean): Cell | null {
  const rows = near ? [3, 4, 5] : [0, 1, 2]
  for (const row of rows) {
    const col = ZONE_NUMBERS[row].indexOf(zone)
    if (col >= 0) return { row, col }
  }
  return null
}

// sub: A–D when known. behind: a serve zone behind the end line (row -1 far, ROWS near; col 0–4 of SERVE_COLS).
export interface Spot { cell: Cell; sub: string | null; behind?: true }

export function serveSpot(zone: number, near: boolean): Spot | null {
  const col = (near ? SERVE_NEAR : SERVE_FAR).indexOf(zone)
  return col >= 0 ? { cell: { row: near ? ROWS : -1, col }, sub: null, behind: true } : null
}

// A spot's area in court units (u across, v far to near), its quarter when the sub-zone is shown.
export function spotArea(s: Spot, sub: boolean): { u0: number; v0: number; du: number; dv: number } {
  if (s.behind) return { u0: s.cell.col / SERVE_COLS, v0: s.cell.row / ROWS, du: 1 / SERVE_COLS, dv: 1 / ROWS }
  const m = sub && s.sub ? subCenter(s.cell, s.sub) : null
  const k = m ? 0.5 : 1
  return { u0: (s.cell.col + (m ? m[0] - 0.25 : 0)) / COLS, v0: (s.cell.row + (m ? m[1] - 0.25 : 0)) / ROWS, du: k / COLS, dv: k / ROWS }
}

// The grid and the play's zones over a w × h picture.
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// A fit's corners in pixels of a w × h picture.
export const inPixels = (fit: CourtFit, w: number, h: number) => fit.corners.map(c => ({ x: c.x * w, y: c.y * h })) as [Pt, Pt, Pt, Pt]
