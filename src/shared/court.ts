// Court grid (from CourtEnd Vision): the whole court fitted to the video by its four corners and
// split 3 × 6 into zones 1–9 for each side, drawn with perspective. The selected play's DVW start
// and end zones are lit on it. Pure: the draw function takes a canvas context, no DOM access.
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

// Sub-zones A–D: where each letter sits in a cell (du, dv), as players on that side see it.
const SUB_NEAR: Record<string, [number, number]> = { A: [0.75, 0.75], B: [0.75, 0.25], C: [0.25, 0.25], D: [0.25, 0.75] }
const SUB_FAR: Record<string, [number, number]> = { A: [0.25, 0.25], B: [0.25, 0.75], C: [0.75, 0.75], D: [0.75, 0.25] }

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

// ---- which side, which cell -----------------------------------------------------------------

// The team on the near side for a rally: swapped every set, and in set 5 once a team has 8.
export function nearSide(fit: CourtFit, play: Pick<Play, 'setNum' | 'score'>): Side {
  let flip = (play.setNum - 1) % 2 === 1
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

export interface PlayZones {
  start: Cell | null
  end: Cell | null
  endSub: string | null // A–D within the end cell
}

// Start and end zones on the court. Serve and attack go from the player's side to the other one;
// reception, dig and block are logged with the ball coming from the other side. A set stays on
// the player's side, so only its start is shown.
export function playZones(play: Pick<Play, 'code' | 'skill' | 'side' | 'startZone' | 'endZone' | 'setNum' | 'score'>, fit: CourtFit): PlayZones {
  const ownNear = nearSide(fit, play) === play.side
  const fromOwn = play.skill === 'S' || play.skill === 'A' || play.skill === 'E'
  const startNear = fromOwn ? ownNear : !ownNear
  const start = play.startZone ? zoneCell(play.startZone, startNear) : null
  if (play.skill === 'E') return { start, end: null, endSub: null }
  const end = play.endZone ? zoneCell(play.endZone, !startNear) : null
  const sub = play.code.charAt(11).toUpperCase()
  return { start, end, endSub: end && 'ABCD'.includes(sub) && sub ? sub : null }
}

// ---- drawing ---------------------------------------------------------------------------------

export type SubZones = 'off' | 'lines' | 'labels'

export interface GridStyle {
  grid: boolean
  color: string
  opacity: number // 0..1
  lineWidth: number
  zoneNumbers: boolean
  subZones: SubZones
  playZones: boolean
}

export const DEFAULT_GRID_STYLE: GridStyle = {
  grid: true, color: '#FFFFFF', opacity: 0.7, lineWidth: 2, zoneNumbers: false, subZones: 'off', playZones: true,
}

const START_COLOR = '#22C55E'
const END_COLOR = '#EF4444'

// The grid and the play's zones over a w × h picture.
export function drawCourt(ctx: CanvasRenderingContext2D, w: number, h: number, fit: CourtFit, style: GridStyle, zones: PlayZones | null): void {
  const H = homography(fit.corners.map(p => ({ x: p.x * w, y: p.y * h })) as [Pt, Pt, Pt, Pt])
  const at = (u: number, v: number) => project(H, u, v)
  const cellPath = (c: Cell, du0 = 0, dv0 = 0, du1 = 1, dv1 = 1) => {
    const u0 = (c.col + du0) / COLS, u1 = (c.col + du1) / COLS, v0 = (c.row + dv0) / ROWS, v1 = (c.row + dv1) / ROWS
    const pts = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y)
    ctx.closePath()
  }
  const cellHeight = (c: Cell) => { const u = (c.col + 0.5) / COLS, a = at(u, c.row / ROWS), b = at(u, (c.row + 1) / ROWS); return Math.hypot(b.x - a.x, b.y - a.y) }
  const line = (a: Pt, b: Pt) => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke() }

  if (style.playZones && zones) {
    ctx.save()
    if (zones.start) { ctx.globalAlpha = 0.35; ctx.fillStyle = START_COLOR; cellPath(zones.start); ctx.fill() }
    if (zones.end) {
      ctx.globalAlpha = 0.3; ctx.fillStyle = END_COLOR; cellPath(zones.end); ctx.fill()
      const s = zones.endSub ? subOffset(zones.end, zones.endSub) : null
      if (s) { ctx.globalAlpha = 0.45; cellPath(zones.end, s[0] - 0.25, s[1] - 0.25, s[0] + 0.25, s[1] + 0.25); ctx.fill() }
    }
    ctx.restore()
  }

  if (style.grid) {
    ctx.save()
    ctx.globalAlpha = style.opacity
    ctx.strokeStyle = style.color
    ctx.fillStyle = style.color
    ctx.lineCap = 'round'
    ctx.lineWidth = style.lineWidth
    for (let col = 0; col <= COLS; col++) line(at(col / COLS, 0), at(col / COLS, 1))
    for (let row = 0; row <= ROWS; row++) {
      const net = row === HALF
      ctx.lineWidth = net ? style.lineWidth * 2.5 : style.lineWidth
      ctx.setLineDash(net ? [12, 6] : [])
      line(at(0, row / ROWS), at(1, row / ROWS))
    }
    ctx.setLineDash([])
    if (style.subZones !== 'off') {
      ctx.lineWidth = Math.max(0.5, style.lineWidth * 0.5)
      ctx.setLineDash([5, 4])
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          line(at((col + 0.5) / COLS, row / ROWS), at((col + 0.5) / COLS, (row + 1) / ROWS))
          line(at(col / COLS, (row + 0.5) / ROWS), at((col + 1) / COLS, (row + 0.5) / ROWS))
        }
      }
      ctx.setLineDash([])
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const c = { row, col }, ch = cellHeight(c)
        if (style.zoneNumbers) {
          const p = at((col + 0.5) / COLS, (row + 0.5) / ROWS)
          ctx.font = `bold ${Math.max(14, Math.min(102, ch * 0.5 + 2))}px 'Segoe UI', Arial, sans-serif`
          ctx.fillText(String(ZONE_NUMBERS[row][col]), p.x, p.y)
        }
        if (style.subZones === 'labels') {
          ctx.font = `${Math.max(8, Math.min(36, ch * 0.22))}px 'Segoe UI', Arial, sans-serif`
          for (const letter of 'ABCD') {
            const [du, dv] = subOffset(c, letter)!
            const p = at((col + du) / COLS, (row + dv) / ROWS)
            ctx.fillText(letter, p.x, p.y)
          }
        }
      }
    }
    ctx.restore()
  }

  if (style.playZones && zones?.start && zones.end) {
    const s = zones.endSub ? subOffset(zones.end, zones.endSub) : null
    const a = at((zones.start.col + 0.5) / COLS, (zones.start.row + 0.5) / ROWS)
    const b = at((zones.end.col + (s ? s[0] : 0.5)) / COLS, (zones.end.row + (s ? s[1] : 0.5)) / ROWS)
    drawArrow(ctx, a, b, Math.max(3, w / 320))
  }
}

function subOffset(c: Cell, letter: string): [number, number] | null {
  return (c.row < HALF ? SUB_FAR : SUB_NEAR)[letter] ?? null
}

function drawArrow(ctx: CanvasRenderingContext2D, a: Pt, b: Pt, width: number): void {
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
