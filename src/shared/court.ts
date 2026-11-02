// Court grid (from CourtEnd Vision): the whole court fitted to the video by its four corners and
// split 3 × 6 into zones 1–9 for each side (the DVW's zone layout), drawn with perspective. The
// selected play's DVW start and end zones — or their sub-zones A–D — are lit on it; a serve's start
// zone lies behind the end line, split in five. Pure: the draw function takes a canvas context, no DOM access.
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

export const COLS = 3
export const ROWS = 6
const HALF = ROWS / 2

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
export const SERVE_COLS = 5
const SERVE_FAR = [1, 9, 6, 7, 5]
const SERVE_NEAR = [5, 7, 6, 9, 1]

export function subCenter(c: Cell, sub: string): [number, number] | null {
  return (c.row < HALF ? SUB_FAR : SUB_NEAR)[sub] ?? null
}

// ---- geometry -------------------------------------------------------------------------------

export interface Homography { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number }

// The unit square (u across, v from far to near) onto the four corners.
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

// ---- which side, which cell -----------------------------------------------------------------

// The team on the near side for a rally: swapped every set up to set 4; set 5 starts on the same
// sides as set 4 and swaps once a team has 8 (the score is the one before the rally).
export function nearSide(fit: CourtFit, play: Pick<Play, 'setNum' | 'score'>): Side {
  let flip = (Math.min(play.setNum, 4) - 1) % 2 === 1
  if (play.setNum === 5 && Math.max(play.score.home, play.score.away) >= 8) flip = !flip
  return flip ? other(fit.nearSet1) : fit.nearSet1
}

const other = (s: Side): Side => (s === '*' ? 'a' : '*')

export interface Cell { row: number; col: number }

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
function spotArea(s: Spot, sub: boolean): { u0: number; v0: number; du: number; dv: number } {
  if (s.behind) return { u0: s.cell.col / SERVE_COLS, v0: s.cell.row / ROWS, du: 1 / SERVE_COLS, dv: 1 / ROWS }
  const m = sub && s.sub ? subCenter(s.cell, s.sub) : null
  const k = m ? 0.5 : 1
  return { u0: (s.cell.col + (m ? m[0] - 0.25 : 0)) / COLS, v0: (s.cell.row + (m ? m[1] - 0.25 : 0)) / ROWS, du: k / COLS, dv: k / ROWS }
}
export interface PlayZones {
  start: Spot | null
  end: Spot | null
}

type ZonePlay = Pick<Play, 'skill' | 'side' | 'startZone' | 'endZone' | 'startSub' | 'endSub' | 'setNum' | 'score' | 'rallyId'>
const spot = (zone: number | null, sub: string | null, near: boolean): Spot | null => {
  const cell = zone ? zoneCell(zone, near) : null
  return cell ? { cell, sub } : null
}

// Start and end on the court. Serve and attack go from the player's side to the other one;
// reception, dig and block are logged with the ball coming from the other side. A set is coded
// with where it was set from; where it went is the start of the attack that follows it (`next`,
// the rally's next play), when that is the same team's.
export function playZones(play: ZonePlay, fit: CourtFit, next?: ZonePlay | null): PlayZones {
  const ownNear = nearSide(fit, play) === play.side
  if (play.skill === 'E') {
    const hit = next && next.skill === 'A' && next.side === play.side && next.rallyId === play.rallyId ? next : null
    return { start: spot(play.endZone, play.endSub, ownNear), end: hit ? spot(hit.startZone, hit.startSub, ownNear) : null }
  }
  const startNear = play.skill === 'S' || play.skill === 'A' ? ownNear : !ownNear
  // A serve starts behind the end line, and so does the reception of it.
  const served = (play.skill === 'S' || play.skill === 'R') && play.startZone ? serveSpot(play.startZone, startNear) : null
  return { start: served ?? spot(play.startZone, play.startSub, startNear), end: spot(play.endZone, play.endSub, !startNear) }
}

// Which way the ball goes on screen in a play: 'up' from the near side toward the far one, 'down'
// the other way. A serve or an attack leaves the player's side; a reception, dig, block or freeball
// comes to it. A set has no way (null).
export type PlayDir = 'up' | 'down'
export function playDirection(play: ZonePlay, fit: CourtFit): PlayDir | null {
  const ownNear = nearSide(fit, play) === play.side
  if (play.skill === 'S' || play.skill === 'A') return ownNear ? 'up' : 'down'
  if ('RDBF'.includes(play.skill)) return ownNear ? 'down' : 'up'
  return null
}

// ---- drawing ---------------------------------------------------------------------------------

export interface GridStyle {
  grid: boolean
  color: string
  opacity: number // 0..1
  lineWidth: number // px at 720p, scaled with the picture like the annotations
  playZones: boolean
  detail: 'zone' | 'sub' // the play's zones as whole zones, or their sub-zones where the DVW has them
}

export const DEFAULT_GRID_STYLE: GridStyle = {
  grid: true, color: '#FFFFFF', opacity: 0.7, lineWidth: 2, playZones: true, detail: 'zone',
}

const START_COLOR = '#22C55E'
const END_COLOR = '#EF4444'

// The grid and the play's zones over a w × h picture.
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function drawCourt(ctx: Ctx, w: number, h: number, fit: CourtFit, style: GridStyle, zones: PlayZones | null): void {
  const H = homography(fit.corners.map(p => ({ x: p.x * w, y: p.y * h })) as [Pt, Pt, Pt, Pt])
  const at = (u: number, v: number) => project(H, u, v)
  const area = (s: Spot) => spotArea(s, style.detail === 'sub')
  const spotPath = (s: Spot) => {
    const { u0, v0, du, dv } = area(s), u1 = u0 + du, v1 = v0 + dv
    const pts = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.closePath()
  }
  const line = (a: Pt, b: Pt) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }

  if (style.playZones && zones) {
    ctx.save()
    if (zones.start) { ctx.globalAlpha = 0.35; ctx.fillStyle = START_COLOR; spotPath(zones.start); ctx.fill() }
    if (zones.end) { ctx.globalAlpha = 0.35; ctx.fillStyle = END_COLOR; spotPath(zones.end); ctx.fill() }
    ctx.restore()
  }

  if (style.grid) {
    ctx.save()
    ctx.globalAlpha = style.opacity
    ctx.strokeStyle = style.color
    ctx.lineCap = 'round'
    const lw = (style.lineWidth * h) / 720
    ctx.lineWidth = lw
    for (let col = 0; col <= COLS; col++) line(at(col / COLS, 0), at(col / COLS, 1))
    for (let row = 0; row <= ROWS; row++) {
      const net = row === HALF
      ctx.lineWidth = net ? lw * 2.5 : lw
      ctx.setLineDash(net ? [12, 6] : [])
      line(at(0, row / ROWS), at(1, row / ROWS))
    }
    ctx.setLineDash([])
    ctx.restore()
  }

  if (style.playZones && zones?.start && zones.end) {
    // From the middle of the lit zone or sub-zone to the middle of the other.
    const mid = (s: Spot) => { const { u0, v0, du, dv } = area(s); return at(u0 + du / 2, v0 + dv / 2) }
    const a = mid(zones.start), b = mid(zones.end)
    drawArrow(ctx, a, b, Math.max(3, w / 320))
  }
}

function drawArrow(ctx: Ctx, a: Pt, b: Pt, width: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1) return
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, head = Math.min(len * 0.4, width * 5)
  const base = { x: b.x - ux * head, y: b.y - uy * head }
  ctx.save()
  ctx.strokeStyle = '#FACC15'
  ctx.fillStyle = '#FACC15'
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.6)'
  ctx.shadowBlur = width * 1.5
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(base.x, base.y); ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(b.x, b.y)
  ctx.lineTo(base.x - uy * head * 0.6, base.y + ux * head * 0.6)
  ctx.lineTo(base.x + uy * head * 0.6, base.y - ux * head * 0.6)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}
