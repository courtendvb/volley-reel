// Court grid (from CourtEnd Vision): the whole court fitted to the video by its four corners and
// split 3 × 6 into zones 1–9 for each side (the DVW's zone layout), drawn with perspective. The
// selected play's DVW start and end zones — or their sub-zones A–D — are lit on it; a serve's start
// zone lies behind the end line, split in five. Pure: the draw function takes a canvas context, no DOM access.
import type { ClickPoint, Play, Side } from './types'

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
export function floorAt(fit: CourtFit, p: Pt): Pt | null {
  const H = homography(fit.corners)
  const G = H.d * H.h - H.e * H.g, J = H.b * H.g - H.a * H.h, K = H.a * H.e - H.b * H.d
  const q = G * p.x + J * p.y + K, mid = project(H, 0.5, 0.5)
  if (q * (G * mid.x + J * mid.y + K) <= 1e-12) return null
  return {
    x: ((H.e - H.f * H.h) * p.x + (H.c * H.h - H.b) * p.y + (H.b * H.f - H.c * H.e)) / q,
    y: ((H.f * H.g - H.d) * p.x + (H.a - H.c * H.g) * p.y + (H.c * H.d - H.a * H.f)) / q,
  }
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
interface Spot { cell: Cell; sub: string | null; behind?: true }

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
  points?: PlayPoints // where the scout clicked, in court units (playMarks)
  player?: PlayerMarks // the player's other shots, for the court tab's heatmap and serve paths
}
interface ShotMarks extends SlideHeat { plays: Play[] } // points[i] is where plays[i] landed
interface PlayerMarks { heat?: ShotMarks; flights?: SlideFlights; landings?: ShotMarks; cones?: SlideCones }
// x across, y far to near; outside 0–1 is off the court. startZ, endZ: the metres above those spots
// (a set ends at the hitter's hand; the rest land); arc: how far the ball's path rises above the
// straight line between them, in metres.
// startRough, endRough: the DVW has no click there, so the point is the middle of the coded zone.
interface PlayPoints { start: Pt | null; end: Pt | null; startZ?: number; endZ?: number; arc?: number; startRough?: boolean; endRough?: boolean }

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
  return zonesFrom(play, nearSide(fit, play) === play.side, next)
}

function zonesFrom(play: ZonePlay, ownNear: boolean, next?: ZonePlay | null): PlayZones {
  if (play.skill === 'E') {
    const hit = next && next.skill === 'A' && next.side === play.side && next.rallyId === play.rallyId ? next : null
    return { start: spot(play.endZone, play.endSub, ownNear), end: hit ? spot(hit.startZone, hit.startSub, ownNear) : null }
  }
  const startNear = play.skill === 'S' || play.skill === 'A' ? ownNear : !ownNear
  // A serve starts behind the end line, and so does the reception of it.
  const served = (play.skill === 'S' || play.skill === 'R') && play.startZone ? serveSpot(play.startZone, startNear) : null
  return { start: served ?? spot(play.startZone, play.startSub, startNear), end: spot(play.endZone, play.endSub, !startNear) }
}

// How high the ball is struck, in metres: a jump serve (Q), other serves, an attack, a set. `code` is
// the shot: the play itself, or what a reception or dig answers.
export const JUMP_SERVE_Z = 3.1
export const FLOAT_SERVE_Z = 3
export const ATTACK_Z = 3.15
export const SET_Z = 2.4
function strikeHeight(code: string): number {
  const skill = code.charAt(3)
  return skill === 'S' ? (code.charAt(4) === 'Q' ? JUMP_SERVE_Z : FLOAT_SERVE_Z) : skill === 'A' ? ATTACK_Z : skill === 'E' ? SET_Z : 0
}

// The shot's path: seconds in the air, and how far it rises above the straight line. A tip or soft
// attack (T, P) loops; a hard one goes straight down. A set goes by its tempo and by the attack it
// is for (setTo): to a quick (Q) it goes straight; to a slower one in front (M, U) it is quicker,
// and as high as gravity makes it in that time. Rising to the hitter's hand puts its top past halfway.
const FAST_SET = 0.85, GRAVITY = 9.8
function shotPath(code: string, setTo?: string): { sec: number; arc: number } {
  const skill = code.charAt(3), type = code.charAt(4)
  if (skill === 'A') return code.charAt(12) === 'T' || code.charAt(12) === 'P' ? { sec: 0.9, arc: 0.8 } : { sec: 0.5, arc: 0 }
  if (skill === 'E') {
    const set = type === 'H' ? { sec: 1.3, arc: 3 } : type === 'Q' ? { sec: 0.6, arc: 0.5 } : { sec: 1, arc: 1.5 }
    if (setTo === 'Q') return { ...set, arc: 0 }
    if (setTo !== 'M' && setTo !== 'U') return set
    const sec = set.sec * FAST_SET
    return { sec, arc: (GRAVITY * sec * sec) / 8 }
  }
  return { sec: type === 'Q' ? 1 : 1.4, arc: 1.2 }
}

// Where a setter stands when the DVW doesn't say: a metre off the net, between zones 2 and 3, from
// the team's own end line (as a click).
const SETTER_SPOT: ClickPoint = { u: 0.6, v: 0.444 }

// The play's clicks on the court. They are seen from the play's team, whose end line is on the near
// side (v 0 is the bottom) or the far one (turned round). Many DVWs click where a set went but not
// where it left: its coded zone stands in, and without one the usual setter's spot.
export function playPoints(play: ClickPlay & Pick<Play, 'code' | 'shotCode' | 'setTo'>, fit: CourtFit): PlayPoints {
  const near = nearSide(fit, play) === play.side
  const on = clickOn(near), clicks = playClicks(play)
  const end = on(clicks.end)
  const coded = play.skill === 'E' ? spot(play.endZone, play.endSub, near) : null
  const middle = coded ? spotArea(coded, true) : null
  const setFrom = !end || play.skill !== 'E' ? null : middle ? { x: middle.u0 + middle.du / 2, y: middle.v0 + middle.dv / 2 } : on(SETTER_SPOT)
  const shot = play.shotCode ?? play.code, start = on(clicks.start) ?? setFrom, z = strikeHeight(shot)
  return {
    start, end, ...(start && z ? { startZ: z, arc: shotPath(shot, play.setTo).arc } : {}), ...(play.skill === 'E' ? { endZ: ATTACK_Z } : {}),
    ...(clicks.startRough ? { startRough: true } : {}), ...(clicks.endRough ? { endRough: true } : {}),
  }
}

// A play's clicks, or where its coded zones say when the DVW has none: the middle of the zone or
// sub-zone, seen from the play's team like a click. A set's zones say too little, so it keeps to
// playPoints' own guess.
type ClickPlay = ZonePlay & Pick<Play, 'startClick' | 'endClick'>
interface Clicks { start: ClickPoint | null; end: ClickPoint | null; startRough?: boolean; endRough?: boolean }
export function playClicks(play: ClickPlay): Clicks {
  const start = play.startClick ?? null, end = play.endClick ?? null
  if ((start && end) || play.skill === 'E') return { start, end }
  const zones = zonesFrom(play, true)
  const middle = (s: Spot | null): ClickPoint | null => { if (!s) return null; const a = spotArea(s, true); return { u: a.u0 + a.du / 2, v: 1 - (a.v0 + a.dv / 2) } }
  const roughStart = start ? null : middle(zones.start), roughEnd = end ? null : middle(zones.end)
  return { start: start ?? roughStart, end: end ?? roughEnd, ...(roughStart ? { startRough: true } : {}), ...(roughEnd ? { endRough: true } : {}) }
}

// A click on the court, for a team whose end line is near or far.
const clickOn = (near: boolean) => (c: ClickPoint | null | undefined): Pt | null => (c ? (near ? { x: c.u, y: 1 - c.v } : { x: 1 - c.u, y: c.v }) : null)

// The tell of a shot that a heatmap keeps to: a serve's start zone, an attack's code (P1, X5...).
const shotKind = (p: Pick<Play, 'skill' | 'startZone' | 'code'>) => (p.skill === 'S' ? p.startZone : p.code.slice(6, 8))

// The i-th rough point moved a little around its zone's middle, the same way every time.
const ROUGH_SCATTER_M = 1
function scattered(c: ClickPoint, i: number): ClickPoint {
  const r = ROUGH_SCATTER_M * Math.sqrt(((i % 16) + 0.5) / 16), turn = i * 2.4
  return { u: c.u + (r * Math.cos(turn)) / COURT_W_M, v: c.v + (r * Math.sin(turn)) / COURT_L_M }
}

// A serve's or attack's player, from `plays` (every match of the project), on the side of the court
// this play is on: where their shots of the same kind landed (shotKind), all their serves' flights,
// and the landings as points: all their serves, or their attacks of the same code.
export function playerMarks(play: Pick<Play, 'skill' | 'playerKey' | 'code'> & ZonePlay, fit: CourtFit, style: GridStyle, plays: () => Play[]): PlayerMarks | null {
  if (play.skill !== 'S' && play.skill !== 'A') return null
  const heatOn = !!style.heat, flightsOn = !!style.serveFlights && play.skill === 'S'
  const landingsOn = !!style.landings, conesOn = !!style.cones && play.skill === 'A'
  if (!heatOn && !flightsOn && !landingsOn && !conesOn) return null
  const on = clickOn(nearSide(fit, play) === play.side)
  const shots = plays().filter(p => p.skill === play.skill && p.playerKey === play.playerKey && playClicks(p).end)
  const flying = shots.filter(p => playClicks(p).start), kind = shotKind(play)
  const same = shots.filter(p => shotKind(p) === kind)
  // A heatmap spreads a rough point over its zone; as points they are scattered, so they can be told apart.
  const marks = (list: Play[], scatter: boolean): ShotMarks => {
    const clicks = list.map(playClicks), rough = clicks.map((c, i) => (c.endRough ? (list[i].endSub ? HEAT_SUB_SIGMA_M : HEAT_ZONE_SIGMA_M) : 0))
    return { fit, points: clicks.map((c, i) => on(scatter && c.endRough ? scattered(c.end!, i) : c.end)!), plays: list, ...(rough.some(Boolean) ? { rough } : {}) }
  }
  const path = (p: Play, i: number): PlayPoints => {
    const c = playClicks(p)
    return {
      start: on(c.startRough ? scattered(c.start!, i) : c.start), end: on(c.endRough ? scattered(c.end!, i) : c.end), startZ: strikeHeight(p.code), arc: shotPath(p.code).arc,
      ...(c.startRough ? { startRough: true } : {}), ...(c.endRough ? { endRough: true } : {}),
    }
  }
  return {
    ...(heatOn ? { heat: marks(same, false) } : {}),
    ...(landingsOn ? { landings: marks(play.skill === 'S' ? shots : same, true) } : {}),
    ...(flightsOn ? { flights: { fit, paths: flying.map(path) } } : {}),
    ...(conesOn ? coneMark(fit, style.coneColor, same.flatMap(p => { const c = playClicks(p), start = on(c.start), end = on(c.end); return start && end ? [{ start, end }] : [] })) : {}),
  }
}

// A serve's flight coming down the court toward the camera whichever end it came from, so serves
// from either side and from other matches lie on one picture, the landings on the larger half of
// it; null without both clicks.
export function servePath(play: Pick<Play, 'startClick' | 'endClick' | 'code'>): PlayPoints | null {
  const a = play.startClick, b = play.endClick
  if (!a || !b) return null
  return { start: { x: 1 - a.u, y: a.v }, end: { x: 1 - b.u, y: b.v }, startZ: strikeHeight(play.code), arc: shotPath(play.code).arc }
}

// What is drawn for a play: its zones, and its clicks for the 座標 detail.
// plays and style: for the player's other shots (playerMarks), when the court tab shows them.
export function playMarks(play: Play, fit: CourtFit, next?: ZonePlay | null, style?: GridStyle, plays?: () => Play[]): PlayZones {
  const player = style && plays ? playerMarks(play, fit, style, plays) : null
  return { ...playZones(play, fit, next), points: playPoints(play, fit), ...(player ? { player } : {}) }
}

// An attacker's cones: from where they hit, five equal angles over the other half, each with its share
// of the shots. The fan runs from one sideline to the other at the attack line, so a line shot, a
// cross and a sharp cross each fall in a cone from any place along the net. A shot outside the fan
// (a tip by the net) counts in the cone nearest it. apex: the shots' mean start; angles in radians
// on the floor, measured from straight across the court.
export interface SlideCones { fit: CourtFit; apex: Pt; rays: number[]; shares: number[]; color?: string }
const CONES = 5
export function attackCones(fit: CourtFit, shots: { start: Pt; end: Pt }[]): SlideCones | null {
  if (!shots.length) return null
  const apex = { x: shots.reduce((s, p) => s + p.start.x, 0) / shots.length, y: shots.reduce((s, p) => s + p.start.y, 0) / shots.length }
  const away = apex.y > 0.5 ? 1 : -1 // up the picture, or down it
  const across = (apex.y - (0.5 - away / ROWS)) * away * COURT_L_M, x = apex.x * COURT_W_M
  const lo = Math.atan2(-x, across), hi = Math.atan2(COURT_W_M - x, across), step = (hi - lo) / CONES
  const counts = new Array<number>(CONES).fill(0)
  for (const { end } of shots) {
    const a = Math.atan2((end.x - apex.x) * COURT_W_M, (apex.y - end.y) * away * COURT_L_M)
    counts[Math.max(0, Math.min(CONES - 1, Math.floor((a - lo) / step)))]++
  }
  return { fit, apex, rays: counts.concat(0).map((_, i) => lo + step * i), shares: counts.map(n => n / shots.length) }
}
const coneMark = (fit: CourtFit, color: string | undefined, shots: { start: Pt; end: Pt }[]): { cones?: SlideCones } => {
  const cones = attackCones(fit, shots)
  return cones ? { cones: { ...cones, ...(color ? { color } : {}) } } : {}
}

// Where a ray from the apex goes through the other half: into it and out of it, in court units.
function coneSpan({ apex }: SlideCones, angle: number): [Pt, Pt] | null {
  const away = apex.y > 0.5 ? 1 : -1, ax = apex.x * COURT_W_M, ay = apex.y * COURT_L_M
  const dx = Math.sin(angle), dy = -Math.cos(angle) * away
  const [y0, y1] = away > 0 ? [0, COURT_L_M / 2] : [COURT_L_M / 2, COURT_L_M]
  let t0 = 0, t1 = Infinity
  for (const [p, q] of [[-dx, ax], [dx, COURT_W_M - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return null; continue }
    const r = q / p
    if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r)
  }
  if (t0 >= t1) return null
  const at = (t: number): Pt => ({ x: (ax + dx * t) / COURT_W_M, y: (ay + dy * t) / COURT_L_M })
  return [at(t0), at(t1)]
}

// On the floor, thicker where more shots go: the fill, the rays, and each cone's share.
export const CONE_COLOR = '#DC2626'
const CONE_STEPS = 16
export function drawCones(ctx: Ctx, w: number, h: number, cones: SlideCones): void {
  const H = homography(inPixels(cones.fit, w, h)), top = Math.max(...cones.shares), color = cones.color ?? CONE_COLOR
  const show = (p: Pt) => project(H, p.x, p.y)
  ctx.save()
  cones.shares.forEach((share, i) => {
    const from = cones.rays[i], to = cones.rays[i + 1]
    const spans = Array.from({ length: CONE_STEPS + 1 }, (_, k) => coneSpan(cones, from + ((to - from) * k) / CONE_STEPS)).filter(s => !!s)
    if (spans.length < 2) return
    const outline = [...spans.map(s => s[0]), ...spans.map(s => s[1]).reverse()].map(show)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.08 + (0.6 * share) / (top || 1)
    ctx.beginPath()
    outline.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
    ctx.closePath()
    ctx.fill()
  })
  ctx.globalAlpha = 0.9
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.5, w / 640)
  for (const angle of cones.rays) {
    const s = coneSpan(cones, angle)
    if (!s) continue
    const a = show(s[0]), b = show(s[1])
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.font = `bold ${Math.max(13, Math.round(w / 55))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(3, w / 320)
  cones.shares.forEach((share, i) => {
    const s = coneSpan(cones, (cones.rays[i] + cones.rays[i + 1]) / 2)
    if (!s) return
    const p = show({ x: s[0].x + (s[1].x - s[0].x) * 0.62, y: s[0].y + (s[1].y - s[0].y) * 0.62 }), text = `${Math.round(share * 100)}%`
    ctx.strokeStyle = '#FFFFFF'
    ctx.strokeText(text, p.x, p.y)
    ctx.fillStyle = color
    ctx.fillText(text, p.x, p.y)
  })
  ctx.restore()
}

// The ball's flight, for the moving curve. DVW times are whole seconds, so this shows the shot rather
// than following the real ball: a serve or attack leaves at the play's time, and a reception or dig
// is reached at its time. `sec`: see shotPath. A clip can put its own time on the play, moved by hand
// (skillSec, in place of the DVW's), and on a serve its speed (speedKmh), which sets the time in the air.
export interface Flight { startSec: number; sec: number }
type FlightPlay = ClickPlay & Pick<Play, 'time' | 'code' | 'shotCode' | 'setTo'>
export function flightTiming(play: FlightPlay, offsetSec: number, clip?: { skillSec?: number; speedKmh?: number } | null): Flight {
  const metres = play.skill === 'S' ? serveMetres(play) : null
  const sec = metres && clip?.speedKmh ? metres / (clip.speedKmh / 3.6) : shotPath(play.shotCode ?? play.code, play.setTo).sec
  const t = clip?.skillSec ?? play.time + offsetSec
  return { startSec: play.shotCode ? t - sec : t, sec }
}

// How far a serve goes along the floor, in metres, from its zones without clicks; null without both ends.
function serveMetres(play: ClickPlay): number | null {
  const { start: a, end: b } = playClicks(play)
  return a && b ? Math.hypot((a.u - b.u) * COURT_W_M, (a.v - b.v) * COURT_L_M) : null
}

// The speed a serve flies at when the clip doesn't set one, in km/h, for the field to show.
export function serveSpeed(play: FlightPlay): number | null {
  const metres = serveMetres(play)
  return metres ? Math.round((metres / flightTiming(play, 0).sec) * 3.6) : null
}

// Which flights can be drawn: the points are shown with the curve on, and the play has both ends and a height.
export function hasFlight(style: GridStyle, zones: PlayZones | null | undefined): boolean {
  const p = zones?.points
  return !!(style.playZones && style.detail === 'point' && style.flight && p?.start && p.end && p.startZ)
}

// Whether the curves grow with the play (the play's own, the player's serves): else they are simply shown whole.
export function flightMoves(style: GridStyle, zones: PlayZones | null | undefined): boolean {
  return (hasFlight(style, zones) || !!zones?.player?.flights) && !style.flightStill
}

// Height along the flight, s from 0 to 1: the straight line between the ends, plus the arc. Always a
// parabola, as a ball under gravity flies.
export function flightZ(p: PlayPoints, s: number): number {
  return (p.startZ ?? 0) * (1 - s) + (p.endZ ?? 0) * s + 4 * (p.arc ?? 0) * s * (1 - s)
}
const FLIGHT_STEPS = 32

const inPixels = (fit: CourtFit, w: number, h: number) => fit.corners.map(c => ({ x: c.x * w, y: c.y * h })) as [Pt, Pt, Pt, Pt]

// The flight up to `progress` (0–1): the point in the air and its mark on the floor, the curve so
// far with the ball at its tip, and the landing point once it is there.
export function drawFlight(ctx: Ctx, w: number, h: number, fit: CourtFit, zones: PlayZones, progress: number, lift = true): void {
  const p = zones.points
  if (!p?.start || !p.end || !p.startZ) return
  const camera = courtCamera(inPixels(fit, w, h), w, h)
  if (!camera) return
  const H = homography(inPixels(fit, w, h))
  const a = p.start, b = p.end
  const at = (s: number) => camera(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, flightZ(p, s))
  const air = at(0), lineW = Math.max(3, w / 320), done = Math.min(1, Math.max(0, progress)), rough = p.startRough || p.endRough
  if (lift) drawLift(ctx, project(H, a.x, a.y), air, w)
  if (done > 0) {
    const n = Math.max(1, Math.ceil(FLIGHT_STEPS * done))
    ctx.save()
    ctx.strokeStyle = '#FACC15'
    ctx.lineWidth = lineW
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = lineW * 1.5
    if (rough) ctx.setLineDash(ROUGH_DASH(lineW))
    ctx.beginPath()
    ctx.moveTo(air.x, air.y)
    for (let i = 1; i <= n; i++) { const q = at((done * i) / n); ctx.lineTo(q.x, q.y) }
    ctx.stroke()
    ctx.restore()
  }
  drawPoint(ctx, air, START_COLOR, w, p.startRough)
  if (lift && done >= 1 && p.endZ) drawLift(ctx, project(H, b.x, b.y), at(1), w)
  if (done >= 1) drawPoint(ctx, at(1), END_COLOR, w, p.endRough)
  else if (done > 0) drawPoint(ctx, at(done), '#FFFFFF', w)
}

// Where shots came down, as points on the floor.
function drawLandings(ctx: Ctx, w: number, h: number, { fit, points, rough }: SlideHeat): void {
  const camera = courtCamera(inPixels(fit, w, h), w, h)
  if (!camera) return
  const r = Math.max(2.5, w / 300)
  ctx.save()
  ctx.fillStyle = END_COLOR
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = Math.max(1, w / 900)
  points.forEach((p, i) => {
    const q = camera(p.x, p.y, 0)
    ctx.beginPath()
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2)
    ringOr(ctx, !!rough?.[i], END_COLOR)
  })
  ctx.restore()
}

// What a slide keeps of the court: the shots' marks and a play's zones, fixed when they were put on.
export interface SlideZones { fit: CourtFit; zones: PlayZones; detail: GridStyle['detail'] }
export interface SlideMarks { heat?: SlideHeat; landings?: SlideHeat; zones?: SlideZones; cones?: SlideCones }
export function drawSlideMarks(ctx: Ctx, w: number, h: number, s: SlideMarks, heatOpacity?: number): void {
  if (s.heat) drawHeat(ctx, w, h, s.heat, heatOpacity)
  if (s.cones) drawCones(ctx, w, h, s.cones)
  if (s.zones) drawCourt(ctx, w, h, s.zones.fit, { ...DEFAULT_GRID_STYLE, grid: false, playZones: true, detail: s.zones.detail }, s.zones.zones, 1)
  if (s.landings) drawLandings(ctx, w, h, s.landings)
}

// Many flights at once on a slide: they leave together after a moment and then stay. `progress` as
// in drawFlight; the more there are, the thinner and fainter each is, so the pattern shows.
export interface SlideFlights { fit: CourtFit; paths: PlayPoints[] }
export const FLIGHTS_LEAD_SEC = 0.5, FLIGHTS_SEC = 1.5
export const flightsProgress = (sec: number) => Math.max(0, Math.min(1, (sec - FLIGHTS_LEAD_SEC) / FLIGHTS_SEC))
export function drawFlights(ctx: Ctx, w: number, h: number, { fit, paths }: SlideFlights, progress: number): void {
  const camera = courtCamera(inPixels(fit, w, h), w, h)
  if (!camera) return
  const done = Math.min(1, Math.max(0, progress)), many = paths.length > 12
  const at = (p: PlayPoints, s: number) => camera(p.start!.x + (p.end!.x - p.start!.x) * s, p.start!.y + (p.end!.y - p.start!.y) * s, flightZ(p, s))
  const dot = (q: Pt, color: string, rough?: boolean) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(q.x, q.y, Math.max(2.5, w / (many ? 320 : 240)), 0, Math.PI * 2)
    if (rough) { ctx.strokeStyle = color; ctx.stroke() } else ctx.fill()
  }
  const drawn = paths.filter(p => p.start && p.end)
  ctx.save()
  ctx.strokeStyle = '#FACC15'
  ctx.lineWidth = Math.max(1, w / (many ? 900 : 480))
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = many ? Math.max(0.35, 12 / paths.length) : 0.95
  if (done > 0) for (const p of drawn) {
    const n = Math.max(1, Math.ceil(FLIGHT_STEPS * done)), o = at(p, 0)
    ctx.setLineDash(p.startRough || p.endRough ? ROUGH_DASH(ctx.lineWidth as number) : [])
    ctx.beginPath()
    ctx.moveTo(o.x, o.y)
    for (let i = 1; i <= n; i++) { const q = at(p, (done * i) / n); ctx.lineTo(q.x, q.y) }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  ctx.setLineDash([])
  for (const p of drawn) {
    dot(at(p, 0), START_COLOR, p.startRough)
    if (done >= 1) dot(at(p, 1), END_COLOR, p.endRough)
    else if (done > 0) dot(at(p, done), '#FFFFFF')
  }
  ctx.restore()
}

// A heatmap on the floor: how thick the landings are, in metres so the spread is the same both ways
// along the court. Coloured like a thermal camera, blue through to red as the count rises; the
// thinnest parts fade out so the floor shows.
// rough: for points that only know their zone, how wide the heatmap spreads them, in metres; 0 for a click.
export interface SlideHeat { fit: CourtFit; points: Pt[]; rough?: number[] }
const COURT_W_M = 9, COURT_L_M = 18
const HEAT_CELL_M = 0.25, HEAT_SIGMA_M = 0.8, HEAT_MARGIN_M = 3
// Measured on a season's files against their clicks: 1 m fits best with a sub-zone, whose middle is
// about 0.6 m off; the wider one is for a whole zone, about 1.5 m off.
const HEAT_SUB_SIGMA_M = 1, HEAT_ZONE_SIGMA_M = 1.4
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
  flight?: boolean // with the points: the ball's path as a curve
  flightStill?: boolean // the whole curve shown for the clip, instead of growing as the play goes
  heat?: boolean // on a serve or attack: a heatmap of where the player's shots of that skill landed
  heatOpacity?: number // 0..1, the heatmap at its thickest; on slides too
  noLift?: boolean // no dashed line from the floor up to a point in the air
  serveFlights?: boolean // on a serve: all the player's serves flying with it
  landings?: boolean // on a serve or attack: where the player's shots landed, as points
  cones?: boolean // on an attack: the player's shots of that code as cones across the court
  coneColor?: string // their colour, unless the usual one
  detail: 'zone' | 'sub' | 'point' // the play's zones as whole zones, their sub-zones, or the scout's clicks as points; each falls back to the zone where the DVW lacks it
}

export const DEFAULT_GRID_STYLE: GridStyle = {
  grid: true, color: '#FFFFFF', opacity: 0.7, lineWidth: 2, playZones: true, detail: 'zone',
}

const START_COLOR = '#22C55E'
const END_COLOR = '#EF4444'

// The grid and the play's zones over a w × h picture.
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// flight: how far the curve has gone (hasFlight), or null to leave it out (the export draws it on its own layers).
export function drawCourt(ctx: Ctx, w: number, h: number, fit: CourtFit, style: GridStyle, zones: PlayZones | null, flight: number | null = 1): void {
  const H = homography(inPixels(fit, w, h))
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

  if (zones?.player?.heat) drawHeat(ctx, w, h, zones.player.heat, style.heatOpacity) // on the floor, under everything
  if (zones?.player?.cones) drawCones(ctx, w, h, zones.player.cones)
  const pts = style.detail === 'point' ? zones?.points : null // a click, where the DVW has one, takes the zone's place
  if (style.playZones && zones) {
    ctx.save()
    if (zones.start && (!pts?.start || pts.startRough)) { ctx.globalAlpha = 0.35; ctx.fillStyle = START_COLOR; spotPath(zones.start); ctx.fill() }
    if (zones.end && (!pts?.end || pts.endRough)) { ctx.globalAlpha = 0.35; ctx.fillStyle = END_COLOR; spotPath(zones.end); ctx.fill() }
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

  if (zones?.player?.landings) drawLandings(ctx, w, h, zones.player.landings)
  if (zones?.player?.flights && flight !== null) drawFlights(ctx, w, h, zones.player.flights, flight)
  if (hasFlight(style, zones) && courtCamera(inPixels(fit, w, h), w, h)) {
    if (flight !== null) drawFlight(ctx, w, h, fit, zones!, flight, !style.noLift)
  } else if (style.playZones && zones) {
    // From the click, or the middle of the lit zone or sub-zone, to the other.
    const mid = (s: Spot) => { const { u0, v0, du, dv } = area(s); return at(u0 + du / 2, v0 + dv / 2) }
    const place = (p: Pt | null | undefined, s: Spot | null) => (p ? at(p.x, p.y) : s ? mid(s) : null)
    // A struck ball starts in the air, over the spot on the floor (marked, with a line up to it).
    const ground = pts?.start ? at(pts.start.x, pts.start.y) : null
    const camera = pts?.start && pts.startZ ? courtCamera(inPixels(fit, w, h), w, h) : null
    const air = camera && pts?.start ? camera(pts.start.x, pts.start.y, pts.startZ!) : null
    if (ground && air && !style.noLift) drawLift(ctx, ground, air, w)
    const endAir = camera && pts?.end && pts.endZ ? camera(pts.end.x, pts.end.y, pts.endZ) : null
    if (pts?.end && endAir && !style.noLift) drawLift(ctx, at(pts.end.x, pts.end.y), endAir, w)
    const a = air ?? place(pts?.start, zones.start), b = endAir ?? place(pts?.end, zones.end)
    if (a && b) drawArrow(ctx, a, b, Math.max(3, w / 320))
    if (air ?? ground) drawPoint(ctx, (air ?? ground)!, START_COLOR, w, pts?.startRough)
    if (pts?.end) drawPoint(ctx, endAir ?? at(pts.end.x, pts.end.y), END_COLOR, w, pts.endRough)
  }
}

// A small ring on the floor and a thin dashed line up to the point in the air.
function drawLift(ctx: Ctx, ground: Pt, air: Pt, w: number): void {
  ctx.save()
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = Math.max(1, w / 900)
  ctx.globalAlpha = 0.9
  ctx.setLineDash([w / 200, w / 240])
  ctx.beginPath(); ctx.moveTo(ground.x, ground.y); ctx.lineTo(air.x, air.y); ctx.stroke()
  ctx.setLineDash([])
  ctx.beginPath(); ctx.ellipse(ground.x, ground.y, w / 200, w / 420, 0, 0, Math.PI * 2); ctx.stroke()
  ctx.restore()
}

// A point from a zone rather than a click: a ring, and a flight's line dashed, here and in the export.
function drawPoint(ctx: Ctx, p: Pt, color: string, w: number, rough?: boolean): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = '#FFFFFF'
  ctx.lineWidth = Math.max(1.5, w / 640)
  ctx.beginPath()
  ctx.arc(p.x, p.y, Math.max(4, w / 160), 0, Math.PI * 2)
  ringOr(ctx, !!rough, color)
  ctx.restore()
}

const ROUGH_DASH = (width: number) => [width * 3, width * 2.5]
function ringOr(ctx: Ctx, rough: boolean, color: string): void {
  if (!rough) { ctx.fill(); ctx.stroke(); return }
  const width = ctx.lineWidth as number
  ctx.lineWidth = width * 3; ctx.stroke() // the white edge, for any floor
  ctx.lineWidth = width * 1.6; ctx.strokeStyle = color; ctx.stroke()
  ctx.lineWidth = width; ctx.strokeStyle = '#FFFFFF'
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
