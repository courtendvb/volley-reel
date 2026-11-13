// Court grid (from CourtEnd Vision): the whole court fitted to the video by its four corners and
// split 3 × 6 into zones 1–9 for each side (the DVW's zone layout), drawn with perspective. The
// selected play's DVW start and end zones — or their sub-zones A–D — are lit on it; a serve's start
// zone lies behind the end line, split in five. Pure: the draw function takes a canvas context, no DOM access.
import type { PlacedChart } from './board'
import { DEFAULT_SET_CHART, SET_AREAS, SET_COLORS, SET_NAMES, SET_TARGETS, drawSetChart, setChart, setChartBox, setExtremes, type SetChart, type SetCourtLayer } from './setChart'
import { LINE_OPACITY, chartBox, chartResult, chartStats, drawChart, type ChartDot, type ChartStyle, type DirectionChart } from './chart'
import type { ClickPoint, Play } from './types'
import { DEFAULT_GRID_STYLE, type GridStyle, markStyle } from './courtStyle'
import { COURT_L_M, COURT_W_M, HEAT_SUB_SIGMA_M, HEAT_ZONE_SIGMA_M, type SlideHeat, drawHeat } from './courtHeat'
import { COLS, type CourtFit, type Ctx, HALF, type Pt, ROWS, type Spot, courtCamera, homography, inPixels, nearSide, project, serveSpot, spotArea, zoneCell } from './courtGeometry'
export * from './courtGeometry'
export * from './courtStyle'
export * from './courtHeat'
export interface PlayZones {
  start: Spot | null
  end: Spot | null
  points?: PlayPoints // where the scout clicked, in court units (playMarks)
  player?: PlayerMarks // the player's other shots, for the court tab's heatmap and serve paths
  skill?: string // the play's, for the style of its player marks (markStyle)
}
interface ShotMarks extends SlideHeat { plays: Play[] } // points[i] is where plays[i] landed
interface PlayerMarks { heat?: ShotMarks; flights?: SlideFlights; landings?: ShotMarks; cones?: SlideCones; chart?: DirectionChart; setChart?: SetChart; setCourt?: SetCourt }
// The setter's distribution on the court in the picture, on their team's half (near: by the camera).
interface SetCourt { chart: SetChart; near: boolean; layer: SetCourtLayer }
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

// The chart of a serve's or attack's player: seen with them at the top, as the camera sees the far team.
export function directionChart(play: Pick<Play, 'skill' | 'playerKey' | 'code' | 'startZone'>, style: ChartStyle, plays: () => Play[], source?: ChartSource): DirectionChart {
  const from = style.scope === 'filter' && source?.filtered ? source.filtered() : plays()
  const skill = play.skill === 'S' ? 'S' : 'A', kind = shotKind(play)
  const mine = from.filter(p => p.skill === skill && p.playerKey === play.playerKey && (style.scope === 'zone' ? p.startZone === play.startZone : style.scope !== 'code' || skill === 'S' || shotKind(p) === kind))
  const on = clickOn(false)
  const dots = mine.flatMap((p, i): ChartDot[] => {
    const c = playClicks(p), rough = c.startRough || c.endRough
    const start = c.startRough ? scattered(c.start!, i) : c.start, end = c.endRough ? scattered(c.end!, i) : c.end
    // Each end spreads on its own, as on the court: a sub-zone's narrower than a whole zone's.
    const spread = (isRough: boolean | undefined, sub: string | null) => (isRough ? (sub ? HEAT_SUB_SIGMA_M : HEAT_ZONE_SIGMA_M) : 0)
    return end ? [{
      start: on(start), end: on(end), result: chartResult(p.effect), effect: p.effect,
      ...(rough ? { rough, endSpread: spread(c.endRough, p.endSub), ...(c.startRough ? { startSpread: spread(true, p.startSub) } : {}) } : {}), ...(c.startRough ? { startRough: true } : {}),
    }] : []
  })
  return { name: source?.name ?? '', skill, dots, stats: chartStats(mine, skill), look: { lines: style.lines, stats: style.stats, name: style.name, colors: style.colors, points: style.points !== false, heat: !!style.heat, ...(style.starts ? { starts: true } : {}), lineOpacity: style.lineOpacity ?? LINE_OPACITY } }
}

// The i-th rough point moved a little around its zone's middle, the same way every time.
const ROUGH_SCATTER_M = 1
function scattered(c: ClickPoint, i: number): ClickPoint {
  const r = ROUGH_SCATTER_M * Math.sqrt(((i % 16) + 0.5) / 16), turn = i * 2.4
  return { u: c.u + (r * Math.cos(turn)) / COURT_W_M, v: c.v + (r * Math.sin(turn)) / COURT_L_M }
}

// A serve's or attack's player, from `plays` (every match of the project), on the side of the court
// this play is on: where their shots of the same kind landed (shotKind), all their serves' flights,
// and the landings as points: all their serves, or their attacks of the same code.
// source: for the direction chart, the plays of the search and the player's name.
export interface ChartSource { filtered?: () => Play[]; name?: string; setterName?: (set: Play) => string } // setterName: the set chart's title
export function playerMarks(play: Pick<Play, 'skill' | 'playerKey' | 'code'> & ZonePlay, fit: CourtFit, style0: GridStyle, plays: () => Play[], source?: ChartSource): PlayerMarks | null {
  const style = markStyle(style0, play.skill)
  // A set, or an attack after one: the setter's distribution in that rotation.
  const setsAll = (style.setChart || style.setCourt) && (play.skill === 'E' || play.skill === 'A') ? setChart(play as Play, plays(), source?.setterName, style.setFilter) : null
  const setMarks: PlayerMarks = setsAll ? {
    ...(style.setChart ? { setChart: setsAll } : {}),
    ...(style.setCourt ? { setCourt: { chart: setsAll, near: nearSide(fit, play) === play.side, layer: style.setCourt.layer } } : {}),
  } : {}
  const sets = Object.keys(setMarks).length ? setMarks : null
  if (play.skill !== 'S' && play.skill !== 'A') return sets
  const heatOn = !!style.heat, flightsOn = !!style.serveFlights && play.skill === 'S'
  const landingsOn = !!style.landings, conesOn = !!style.cones && play.skill === 'A', chartOn = !!style.chart && (play.skill === 'A' || play.skill === 'S')
  if (!heatOn && !flightsOn && !landingsOn && !conesOn && !chartOn) return sets
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
    ...(chartOn ? { chart: directionChart(play, style.chart!, plays, source) } : {}),
    ...(sets ?? {}),
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
export function playMarks(play: Play, fit: CourtFit, next?: ZonePlay | null, style?: GridStyle, plays?: () => Play[], source?: ChartSource): PlayZones {
  const player = style && plays ? playerMarks(play, fit, style, plays, source) : null
  return { ...playZones(play, fit, next), points: playPoints(play, fit), skill: play.skill, ...(player ? { player } : {}) }
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
// A serve with its reception's touch marked (touchSec) flies from the hit to the touch.
export function flightTiming(play: FlightPlay, offsetSec: number, clip?: { skillSec?: number; speedKmh?: number; touchSec?: number } | null): Flight {
  const metres = play.skill === 'S' ? serveMetres(play) : null
  const t = clip?.skillSec ?? play.time + offsetSec
  const touched = metres && clip?.touchSec !== undefined && clip.touchSec > t ? clip.touchSec - t : null
  const sec = touched ?? (metres && clip?.speedKmh ? metres / (clip.speedKmh / 3.6) : shotPath(play.shotCode ?? play.code, play.setTo).sec)
  return { startSec: play.shotCode ? t - sec : t, sec }
}

// A serve's average speed from the hit to the reception's touch (video times marked by hand), in
// km/h over the floor distance between the two clicks; null without both clicks or with the touch
// not after the hit.
export function measuredSpeed(play: ClickPlay, hitSec: number, touchSec: number | undefined | null): number | null {
  const metres = play.skill === 'S' ? serveMetres(play) : null
  if (!metres || touchSec === undefined || touchSec === null || touchSec <= hitSec) return null
  return Math.round((metres / (touchSec - hitSec)) * 3.6)
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
  const r = Math.max(2.2, w / 333)
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
// setCharts: a setter's set charts placed on the slide (a rotation slide), x / y / h as 0..1 of the picture.
export interface PlacedSetChart { chart: SetChart; x: number; y: number; h: number; rich?: boolean } // rich: jersey discs, no title (drawSetChart)
export interface SlideMarks { heat?: SlideHeat; landings?: SlideHeat; zones?: SlideZones; cones?: SlideCones; chart?: DirectionChart; charts?: PlacedChart[]; setCharts?: PlacedSetChart[] }
export function drawSlideMarks(ctx: Ctx, w: number, h: number, s: SlideMarks, heatOpacity?: number): void {
  if (s.heat) drawHeat(ctx, w, h, s.heat, heatOpacity)
  if (s.cones) drawCones(ctx, w, h, s.cones)
  if (s.zones) drawCourt(ctx, w, h, s.zones.fit, { ...DEFAULT_GRID_STYLE, grid: false, playZones: true, detail: s.zones.detail }, s.zones.zones, 1)
  if (s.landings) drawLandings(ctx, w, h, s.landings)
  if (s.chart) drawChart(ctx, s.chart, chartBox(w, h, 'center', 1, s.chart.look.name))
  for (const c of s.charts ?? []) drawChart(ctx, c.chart, { x: c.x * w, y: c.y * h, h: c.h * h })
  for (const c of s.setCharts ?? []) drawSetChart(ctx, c.chart, { x: c.x * w, y: c.y * h, h: c.h * h }, 'auto', false, !!c.rich)
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
// A serve or attack goes away from the player's side; every other play (a reception, dig, block,
// freeball, and a set, which doesn't cross the net) is counted coming to it: down the screen on the
// near court, up it on the far one.
export type PlayDir = 'up' | 'down'
export function playDirection(play: ZonePlay, fit: CourtFit): PlayDir | null {
  const ownNear = nearSide(fit, play) === play.side
  if (play.skill === 'S' || play.skill === 'A') return ownNear ? 'up' : 'down'
  return ownNear ? 'down' : 'up'
}

// ---- drawing ---------------------------------------------------------------------------------
const START_COLOR = '#22C55E'
const END_COLOR = '#EF4444'


// flight: how far the curve has gone (hasFlight), or null to leave it out (the export draws it on its own layers).
export function drawCourt(ctx: Ctx, w: number, h: number, fit: CourtFit, style0: GridStyle, zones: PlayZones | null, flight: number | null = 1): void {
  const style = markStyle(style0, zones?.skill)
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
  if (zones?.player?.setCourt) drawSetCourt(ctx, w, h, fit, zones.player.setCourt)
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
  if (zones?.player?.setChart) drawSetChart(ctx, zones.player.setChart, setChartBox(w, h, style.setChart ?? DEFAULT_SET_CHART), style.setChart?.view, !!style.setChart?.flip)
  if (zones?.player?.chart) drawChart(ctx, zones.player.chart, chartBox(w, h, style.chart?.corner ?? 'tr', style.chart?.scale, zones.player.chart.look.name))
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

// The setter's distribution on the court in the picture, on their team's half: where each set was
// given (coloured by where it went: filled a kill, open in play, a cross a point lost), or each place
// painted by its share with its name and share, the most set to framed red and the least blue.
function drawSetCourt(ctx: Ctx, w: number, h: number, fit: CourtFit, s: SetCourt): void {
  const H = homography(inPixels(fit, w, h))
  // The team's view (u from its left, v from its end line) as court units, then the picture.
  const on = (u: number, v: number) => (s.near ? project(H, u, 1 - v) : project(H, 1 - u, v))
  const c = s.chart
  ctx.save()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (s.layer === 'spots') {
    const r = Math.max(3, w / 170)
    for (const d of c.dots) {
      if (!d.click) continue
      const p = on(d.click.u, d.click.v), color = SET_COLORS[d.target]
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.5, r * 0.45)
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      if (d.result === 'kill') ctx.fill(); else { ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill(); ctx.stroke() }
      if (d.result === 'lost') {
        const k = r * 0.7
        ctx.beginPath(); ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y + k); ctx.moveTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); ctx.stroke()
      }
    }
    ctx.restore()
    return
  }
  const top = Math.max(...SET_TARGETS.map(k => c.by[k].n), 1), { most, least } = setExtremes(c)
  for (const k of SET_TARGETS) {
    const a = SET_AREAS[k], n = c.by[k].n
    if (!a || !n) continue
    const ring = [on(a.u[0], a.v[0]), on(a.u[1], a.v[0]), on(a.u[1], a.v[1]), on(a.u[0], a.v[1])]
    ctx.beginPath(); ring.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath()
    ctx.globalAlpha = 0.2 + 0.45 * (n / top); ctx.fillStyle = SET_COLORS[k]; ctx.fill(); ctx.globalAlpha = 1
    if (k === most || k === least) { ctx.strokeStyle = k === most ? '#DC2626' : '#2563EB'; ctx.lineWidth = Math.max(3.5, w / 220); ctx.stroke() }
    const mid = on((a.u[0] + a.u[1]) / 2, (a.v[0] + a.v[1]) / 2), fs = Math.max(11, w / 55)
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2.5, fs * 0.18); ctx.strokeStyle = '#000000'; ctx.fillStyle = '#FFFFFF'
    ctx.font = `bold ${fs * 0.8}px sans-serif`
    ctx.strokeText(SET_NAMES[k], mid.x, mid.y - fs * 0.55); ctx.fillText(SET_NAMES[k], mid.x, mid.y - fs * 0.55)
    ctx.font = `bold ${fs}px sans-serif`
    const share = `${Math.round((n / c.total) * 100)}%`
    ctx.strokeText(share, mid.x, mid.y + fs * 0.45); ctx.fillText(share, mid.x, mid.y + fs * 0.45)
  }
  ctx.restore()
}
