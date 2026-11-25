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

// Something flat (a text) lying on the floor: its four corners in the picture (top-left, top-right,
// bottom-left, bottom-right of the thing), so it shows in the court's perspective. Worked in metres
// on the floor: a rectangle about the point c, its width along the unit direction e and its top
// toward -n (n points the way that goes down the picture, so it reads from the camera).
type FloorQuad = [[number, number], [number, number], [number, number], [number, number]]
function floorRectQuad(corners: CourtFit['corners'], c: Pt, e: Pt, wm: number, hm: number, down?: Pt): FloorQuad {
  const H = homography(corners)
  const shown = (p: Pt) => project(H, p.x / COURT_W, p.y / COURT_L)
  let n = { x: -e.y, y: e.x }
  if (down ? n.x * down.x + n.y * down.y < 0 : shown({ x: c.x + n.x * 0.1, y: c.y + n.y * 0.1 }).y < shown(c).y) n = { x: -n.x, y: -n.y }
  const at = (i: number, j: number): [number, number] => {
    const p = shown({ x: c.x + e.x * wm * i / 2 + n.x * hm * j / 2, y: c.y + e.y * wm * i / 2 + n.y * hm * j / 2 })
    return [p.x, p.y]
  }
  return [at(-1, -1), at(1, -1), at(-1, 1), at(1, 1)]
}
const toMetres = (p: Pt): Pt => ({ x: p.x * COURT_W, y: p.y * COURT_L })

// Laid where it shows: as wide on the floor as from `left` to `right` (points of the picture, the
// middles of its left and right sides), aspect its width / height. Null off the floor.
export function floorQuad(corners: CourtFit['corners'], left: Pt, right: Pt, aspect: number): FloorQuad | null {
  const a = floorAt({ corners }, left), b = floorAt({ corners }, right)
  if (!a || !b || !(aspect > 0)) return null
  const A = toMetres(a), B = toMetres(b), wm = Math.hypot(B.x - A.x, B.y - A.y)
  if (!(wm > 1e-6) || wm > 100) return null
  return floorRectQuad(corners, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, { x: (B.x - A.x) / wm, y: (B.y - A.y) / wm }, wm, wm / aspect)
}

// Laid in the middle of the near or far half (a team's logo, say), square to the lines and reading
// from the camera: as wide as `share` of the court's width, aspect its width / height, but never longer
// than most of the half.
export function halfFloorQuad(corners: CourtFit['corners'], part: 'near' | 'far', aspect: number, share = 0.7): FloorQuad | null {
  if (!(aspect > 0)) return null
  const hm = Math.min((COURT_W * share) / aspect, (COURT_L / 2) * 0.8)
  return floorRectQuad(corners, { x: COURT_W / 2, y: part === 'near' ? COURT_L * 0.75 : COURT_L * 0.25 }, { x: 1, y: 0 }, hm * aspect, hm)
}

// Laid again where it lies, for a new aspect (its text was changed): same middle and way on the
// floor, its height times `scale` (its font size changed), its width from the aspect. Null when its
// corners are off the floor.
export function refloorQuad(corners: CourtFit['corners'], quad: FloorQuad, aspect: number, scale = 1): FloorQuad | null {
  const f = quad.map(([x, y]) => floorAt({ corners }, { x, y }))
  if (f.some(p => !p) || !(aspect > 0)) return null
  const [tl, tr, bl, br] = (f as Pt[]).map(toMetres)
  const mid = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
  const l = mid(tl, bl), r = mid(tr, br), t = mid(tl, tr), b = mid(bl, br)
  const wm = Math.hypot(r.x - l.x, r.y - l.y), h0 = Math.hypot(b.x - t.x, b.y - t.y), hm = h0 * scale
  if (!(wm > 1e-6 && h0 > 1e-6 && hm > 1e-6)) return null
  // Its own way up is kept (one turned to read from the far side stays so).
  return floorRectQuad(corners, mid(l, r), { x: (r.x - l.x) / wm, y: (r.y - l.y) / wm }, hm * aspect, hm, { x: (b.x - t.x) / h0, y: (b.y - t.y) / h0 })
}

// Something flat standing upright on the floor, like a board: its bottom edge on the floor from
// `left` to `right` (points of the picture, 0..1), its height on the floor's scale from aspect (width /
// height). W × H: the picture in pixels, for the camera. Null off the floor or when the corners
// can't tell the camera.
export function standQuad(corners: CourtFit['corners'], W: number, H: number, left: Pt, right: Pt, aspect: number): FloorQuad | null {
  const a = floorAt({ corners }, left), b = floorAt({ corners }, right)
  if (!a || !b || !(aspect > 0)) return null
  const A = toMetres(a), B = toMetres(b), wm = Math.hypot(B.x - A.x, B.y - A.y)
  if (!(wm > 1e-6) || wm > 100) return null
  return standOn(corners, W, H, { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }, { x: (B.x - A.x) / wm, y: (B.y - A.y) / wm }, wm, wm / aspect)
}

function standOn(corners: CourtFit['corners'], W: number, H: number, c: Pt, e: Pt, wm: number, hm: number): FloorQuad | null {
  const cam = courtCamera(corners.map(p => ({ x: p.x * W, y: p.y * H })) as [Pt, Pt, Pt, Pt], W, H)
  if (!cam) return null
  const at = (i: number, z: number): [number, number] => {
    const p = cam((c.x + e.x * wm * i / 2) / COURT_W, (c.y + e.y * wm * i / 2) / COURT_L, z)
    return [p.x / W, p.y / H]
  }
  return [at(-1, hm), at(1, hm), at(-1, 0), at(1, 0)]
}

// A board standing on the floor, read back from its corners: the middle of its foot and the way
// along it (metres on the floor), its width along the foot and its height (found by halving: how far
// up from the middle of its foot the middle of its top shows). Null off the floor.
function standParts(corners: CourtFit['corners'], W: number, H: number, quad: FloorQuad): { c: Pt; e: Pt; wm: number; hm: number } | null {
  const fl = floorAt({ corners }, { x: quad[2][0], y: quad[2][1] }), fr = floorAt({ corners }, { x: quad[3][0], y: quad[3][1] })
  const cam = courtCamera(corners.map(p => ({ x: p.x * W, y: p.y * H })) as [Pt, Pt, Pt, Pt], W, H)
  if (!fl || !fr || !cam) return null
  const A = toMetres(fl), B = toMetres(fr), wm = Math.hypot(B.x - A.x, B.y - A.y)
  if (!(wm > 1e-6)) return null
  const c = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 }
  const topY = ((quad[0][1] + quad[1][1]) / 2) * H, foot = (z: number) => cam(c.x / COURT_W, c.y / COURT_L, z).y
  let lo = 0, hi = 50
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (foot(m) > topY) lo = m; else hi = m }
  const hm = (lo + hi) / 2
  return hm > 1e-3 ? { c, e: { x: (B.x - A.x) / wm, y: (B.y - A.y) / wm }, wm, hm } : null
}

// Stood again where it stands, for a new aspect: same foot, its height times `scale`, its width from the aspect.
export function restandQuad(corners: CourtFit['corners'], W: number, H: number, quad: FloorQuad, aspect: number, scale = 1): FloorQuad | null {
  const s = standParts(corners, W, H, quad)
  if (!s || !(aspect > 0) || !(scale > 0)) return null
  return standOn(corners, W, H, s.c, s.e, s.hm * scale * aspect, s.hm * scale)
}

// Made larger or smaller from corner i (0..3: top-left, top-right, bottom-left, bottom-right) dragged
// to `to` (a point of the picture, 0..1): the same shape and way on the floor, the opposite corner
// staying where it is (stood up: the foot on the other side). Null off the floor.
export function resizeOnFloor(corners: CourtFit['corners'], W: number, H: number, quad: FloorQuad, stand: boolean, i: number, to: Pt): FloorQuad | null {
  const o = 3 - i, MIN = 0.05
  if (stand) {
    const s = standParts(corners, W, H, quad)
    if (!s) return null
    // How far along the diagonal, in the picture: as the corner shows from the opposite one.
    const dx = (quad[i][0] - quad[o][0]) * W, dy = (quad[i][1] - quad[o][1]) * H, d2 = dx * dx + dy * dy
    if (!(d2 > 1e-9)) return null
    const k = Math.max(MIN, ((to.x - quad[o][0]) * W * dx + (to.y - quad[o][1]) * H * dy) / d2)
    const side = i % 2 === 0 ? 1 : -1 // dragging a left corner keeps the right foot
    const foot = { x: s.c.x + side * s.e.x * s.wm / 2, y: s.c.y + side * s.e.y * s.wm / 2 }
    const c = { x: foot.x - side * s.e.x * s.wm * k / 2, y: foot.y - side * s.e.y * s.wm * k / 2 }
    return standOn(corners, W, H, c, s.e, s.wm * k, s.hm * k)
  }
  const hom = homography(corners)
  const f = quad.map(([x, y]) => floorAt({ corners }, { x, y }))
  const p = floorAt({ corners }, to)
  if (f.some(q => !q) || !p) return null
  const m = (f as Pt[]).map(toMetres), O = m[o], C = m[i], P = toMetres(p)
  const dx = C.x - O.x, dy = C.y - O.y, d2 = dx * dx + dy * dy
  if (!(d2 > 1e-9)) return null
  const k = Math.max(MIN, ((P.x - O.x) * dx + (P.y - O.y) * dy) / d2)
  const out = m.map(q => { const r = project(hom, (O.x + (q.x - O.x) * k) / COURT_W, (O.y + (q.y - O.y) * k) / COURT_L); return [r.x, r.y] as [number, number] })
  return [out[0], out[1], out[2], out[3]]
}

// Moved over the floor by dx, dy of the picture (0..1): the point under its middle (a board: the
// middle of its foot) goes there, and it is drawn again as the floor shows it there, the same size
// and way on the floor. So it changes shape as it goes: wider near the camera, slanted at the sides.
// Null when it would leave the floor.
export function moveOnFloor(corners: CourtFit['corners'], W: number, H: number, quad: FloorQuad, stand: boolean, dx: number, dy: number): FloorQuad | null {
  const hom = homography(corners)
  const shown = (p: Pt): [number, number] => { const q = project(hom, p.x / COURT_W, p.y / COURT_L); return [q.x, q.y] }
  const floorOf = (x: number, y: number) => { const p = floorAt({ corners }, { x, y }); return p && toMetres(p) }
  if (stand) {
    const s = standParts(corners, W, H, quad)
    if (!s) return null
    const [fx, fy] = shown(s.c), to = floorOf(fx + dx, fy + dy)
    return to ? standOn(corners, W, H, to, s.e, s.wm, s.hm) : null
  }
  const f = quad.map(([x, y]) => floorOf(x, y))
  if (f.some(p => !p)) return null
  const pts = f as Pt[], c = { x: pts.reduce((a, p) => a + p.x, 0) / 4, y: pts.reduce((a, p) => a + p.y, 0) / 4 }
  const [sx, sy] = shown(c), to = floorOf(sx + dx, sy + dy)
  if (!to) return null
  const moved = pts.map(p => shown({ x: p.x + to.x - c.x, y: p.y + to.y - c.y }))
  return [moved[0], moved[1], moved[2], moved[3]]
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
