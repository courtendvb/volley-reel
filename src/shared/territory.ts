// Defence territories (守備テリトリー): the floor of the receiving or defending team split among its
// players (a Voronoi diagram of their places), with no tracking of the picture: the places come from
// the rally's lineup (the DVW's P1–P6 at the serve), the roster's positions and liberos, and standard
// formations — three receivers for a serve, a perimeter defence around a two-man block (one against a
// middle attack) for an attack. On it, where the ball came down is judged:
// - on a seam: within 30 cm of the line between two players' areas (the hardest ball to take);
// - IN ZONE: played by the player whose area it came down in;
// - COVERED BY: played by another, who came into that area for it.
// Places here are in metres as the team sees its own half from behind its end line: x from its left
// (0) to its right (9), y from its end line (0) to the net (9).
import { homography, inPixels, nearSide, project, type CourtFit, type Ctx, type Pt } from './courtGeometry'
import type { ClickPoint, ParsedDVW, Play, PlayerRole, Side } from './types'

export const HALF_M = 9
export const SEAM_M = 0.3 // a ball this close to a line between two areas is on the seam
export interface Site { jersey: number; x: number; y: number; zone: number; role?: PlayerRole; libero?: boolean }
export type AttackFrom = 'left' | 'center' | 'right' // as the defending team sees it
export type Verdict = 'in' | 'covered'
export interface Territory {
  side: Side // the team whose floor it is
  near: boolean // that team is on the camera's side
  kind: 'reception' | 'dig'
  attack?: AttackFrom
  sites: Site[] // the players who own floor
  cells: Pt[][] // each site's area, a polygon in metres
  others: Site[] // the rest on court (blockers at the net, a setter by it): no floor of their own
  impact: Pt | null // where the ball came down, in metres
  owner: number | null // the site whose area that is
  seam: { a: number; b: number; edge: [Pt, Pt] } | null
  touch: { jersey: number; at: Pt | null } | null // who played it and from where (their place), null when nobody did
  verdict: Verdict | null
}

// The six rotational places: P1 right back, P2 right front, P3 middle front, P4 left front, P5 left back, P6 middle back.
const ZONE_AT: Record<number, Pt> = { 1: { x: 7.5, y: 2 }, 2: { x: 7.5, y: 7.5 }, 3: { x: 4.5, y: 7.5 }, 4: { x: 1.5, y: 7.5 }, 5: { x: 1.5, y: 2 }, 6: { x: 4.5, y: 2 } }
const FRONT = [2, 3, 4], BACK = [1, 6, 5]

// Where an attack comes from, seen by the defenders: the attacker's left (their zones 4, 5, 7) is the
// defenders' right; their right (2, 1, 9) the defenders' left; the middle (3, 6, 8, a pipe) the middle.
export function attackFrom(startZone: number | null): AttackFrom {
  if (startZone === 4 || startZone === 5 || startZone === 7) return 'right'
  if (startZone === 2 || startZone === 1 || startZone === 9) return 'left'
  return 'center'
}

// Perimeter defence (metres), by rotational place. Against an attack from the right the right back
// takes the line, the left back the deep cross, the middle back the deep middle, and the left front
// (off the block) the short cross and tips; from the left it is the mirror; against the middle both
// wings come off the net.
const DIG: Record<AttackFrom, { block: Record<number, Pt>; floor: Record<number, Pt> }> = {
  right: { block: { 2: { x: 7.7, y: 8.6 }, 3: { x: 6.7, y: 8.6 } }, floor: { 4: { x: 1.8, y: 6.0 }, 1: { x: 8.3, y: 3.5 }, 6: { x: 4.8, y: 1.0 }, 5: { x: 1.3, y: 3.2 } } },
  left: { block: { 4: { x: 1.3, y: 8.6 }, 3: { x: 2.3, y: 8.6 } }, floor: { 2: { x: 7.2, y: 6.0 }, 5: { x: 0.7, y: 3.5 }, 6: { x: 4.2, y: 1.0 }, 1: { x: 7.7, y: 3.2 } } },
  center: { block: { 3: { x: 4.5, y: 8.6 } }, floor: { 4: { x: 1.8, y: 6.2 }, 2: { x: 7.2, y: 6.2 }, 5: { x: 1.5, y: 2.8 }, 6: { x: 4.5, y: 1.2 }, 1: { x: 7.5, y: 2.8 } } },
}
// Serve reception: three in a line across the court, the middle one a little deeper.
const LANES: Pt[] = [{ x: 1.5, y: 3.1 }, { x: 4.5, y: 2.7 }, { x: 7.5, y: 3.1 }]

interface Player { jersey: number; zone: number; role?: PlayerRole; libero?: boolean }

// The team on court for the rally, P1 to P6, the libero in for the back-row middle blocker when the
// roster says who that is. The libero is the team's one who received or dug most in that set.
export function onCourt(dvw: ParsedDVW, play: Pick<Play, 'rallyId' | 'setNum'>, side: Side): Player[] | null {
  const rally = play.rallyId !== null ? dvw.rallies[play.rallyId] : null
  const six = rally?.court ? (side === '*' ? rally.court.home : rally.court.away) : null
  if (!six || six.length !== 6) return null
  const info = (j: number) => dvw.players[`${side}${j}`]
  const team: Player[] = six.map((jersey, i) => ({ jersey, zone: i + 1, ...(info(jersey)?.role ? { role: info(jersey)!.role } : {}) }))
  const liberos = Object.values(dvw.players).filter(p => p.side === side && (p.libero || p.role === 'L'))
  if (!liberos.length) return team
  const touches = (j: number) => dvw.plays.filter(p => p.side === side && p.jersey === j && p.setNum === play.setNum && (p.skill === 'R' || p.skill === 'D')).length
  const libero = liberos.map(p => p.jersey).sort((a, b) => touches(b) - touches(a))[0]
  const mb = team.find(p => BACK.includes(p.zone) && p.role === 'MB')
  return mb ? team.map(p => (p === mb ? { jersey: libero, zone: p.zone, role: 'L' as const, libero: true } : p)) : team
}

// The receivers and their lanes: the libero and the two outside hitters when the roster tells them
// apart (the libero in the middle, the hitters left and right as they stand in the rotation), else
// the three in the back row. The rest stay where the rotation puts them, off the floor.
export function receptionSites(team: Player[]): { sites: Site[]; others: Site[] } {
  const lib = team.find(p => p.libero), oh = team.filter(p => p.role === 'OH')
  const byX = (a: Player, b: Player) => ZONE_AT[a.zone].x - ZONE_AT[b.zone].x || Number(FRONT.includes(b.zone)) - Number(FRONT.includes(a.zone))
  let lanes: Player[]
  if (lib && oh.length === 2) { const [l, r] = [...oh].sort(byX); lanes = [l, lib, r] }
  else lanes = team.filter(p => BACK.includes(p.zone)).sort(byX)
  const site = (p: Player, at: Pt): Site => ({ jersey: p.jersey, x: at.x, y: at.y, zone: p.zone, ...(p.role ? { role: p.role } : {}), ...(p.libero ? { libero: true } : {}) })
  return { sites: lanes.map((p, i) => site(p, LANES[i])), others: team.filter(p => !lanes.includes(p)).map(p => site(p, ZONE_AT[p.zone])) }
}

export function digSites(team: Player[], from: AttackFrom): { sites: Site[]; others: Site[] } {
  const f = DIG[from]
  const site = (p: Player, at: Pt): Site => ({ jersey: p.jersey, x: at.x, y: at.y, zone: p.zone, ...(p.role ? { role: p.role } : {}), ...(p.libero ? { libero: true } : {}) })
  return { sites: team.filter(p => f.floor[p.zone]).map(p => site(p, f.floor[p.zone])), others: team.filter(p => f.block[p.zone]).map(p => site(p, f.block[p.zone])) }
}

// Each site's area: the half court cut by the line halfway to every other site.
export function cellsOf(sites: Pt[]): Pt[][] {
  return sites.map((a, i) => {
    let poly: Pt[] = [{ x: 0, y: 0 }, { x: HALF_M, y: 0 }, { x: HALF_M, y: HALF_M }, { x: 0, y: HALF_M }]
    sites.forEach((b, j) => { if (j !== i) poly = clip(poly, a, b) })
    return poly
  })
}
// Keeps the part of the polygon nearer a than b.
function clip(poly: Pt[], a: Pt, b: Pt): Pt[] {
  const nx = b.x - a.x, ny = b.y - a.y, c = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2
  const side = (p: Pt) => c - (p.x * nx + p.y * ny) // > 0: nearer a
  const out: Pt[] = []
  poly.forEach((p, k) => {
    const q = poly[(k + 1) % poly.length], sp = side(p), sq = side(q)
    if (sp >= 0) out.push(p)
    if ((sp >= 0) !== (sq >= 0)) { const s = sp / (sp - sq); out.push({ x: p.x + (q.x - p.x) * s, y: p.y + (q.y - p.y) * s }) }
  })
  return out
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)

// The area the ball came down in, and whether it came down on the seam with the next nearest one.
export function judgePoint(sites: Site[], cells: Pt[][], p: Pt): { owner: number; seam: Territory['seam'] } | null {
  if (!sites.length) return null
  const order = sites.map((s, i) => i).sort((i, j) => dist(sites[i], p) - dist(sites[j], p))
  const [a, b] = order
  if (b === undefined || p.x < 0 || p.x > HALF_M || p.y < 0 || p.y > HALF_M) return { owner: a, seam: null }
  const A = sites[a], B = sites[b]
  const off = (dist(B, p) ** 2 - dist(A, p) ** 2) / (2 * dist(A, B)) // how far from the line halfway between them
  if (off > SEAM_M) return { owner: a, seam: null }
  const onLine = cells[a].filter(q => Math.abs(dist(q, A) - dist(q, B)) < 1e-5)
  return { owner: a, seam: onLine.length >= 2 ? { a, b, edge: [onLine[0], onLine[1]] } : null }
}

type TerritoryPlay = Pick<Play, 'id' | 'skill' | 'side' | 'jersey' | 'rallyId' | 'setNum' | 'score' | 'startZone'>
type Clicks = (p: Play) => { start: ClickPoint | null; end: ClickPoint | null }
const otherSide = (s: Side): Side => (s === '*' ? 'a' : '*')

// The territory for a play: a serve or its reception (the receiving team), an attack or its dig (the
// defending team). Null for other plays, or without the rally's lineup.
export function buildTerritory(play: TerritoryPlay, dvw: ParsedDVW, fit: CourtFit, clicks: Clicks): Territory | null {
  const plays = dvw.plays, inRally = (p: Play | undefined) => !!p && p.rallyId === play.rallyId
  let ball: Play | undefined, touch: Play | undefined, side: Side, kind: Territory['kind']
  const after = (from: Play, skill: string, by: Side) => {
    for (let i = from.id + 1; i < plays.length && i <= from.id + 3 && inRally(plays[i]); i++) {
      if (plays[i].side !== by) return undefined
      if (plays[i].skill === skill) return plays[i]
    }
    return undefined
  }
  const before = (from: TerritoryPlay, skill: string, by: Side) => {
    for (let i = from.id - 1; i >= 0 && i >= from.id - 3 && inRally(plays[i]); i--) if (plays[i].side === by && plays[i].skill === skill) return plays[i]
    return undefined
  }
  const self = plays[play.id]
  if (play.skill === 'S' || play.skill === 'A') { ball = self; side = otherSide(play.side); kind = play.skill === 'S' ? 'reception' : 'dig'; touch = ball && after(ball, play.skill === 'S' ? 'R' : 'D', side) }
  else if (play.skill === 'R' || play.skill === 'D') { side = play.side; kind = play.skill === 'R' ? 'reception' : 'dig'; ball = before(play, play.skill === 'R' ? 'S' : 'A', otherSide(side)); touch = self }
  else return null
  if (!ball) return null
  const team = onCourt(dvw, play, side)
  if (!team) return null
  const attack = kind === 'dig' ? attackFrom(ball.startZone) : undefined
  const { sites, others } = kind === 'reception' ? receptionSites(team) : digSites(team, attack!)
  const cells = cellsOf(sites)
  // The ball's end as its hitter clicked it, on their far side: turned round to the defenders' view.
  const end = clicks(ball).end
  const impact = end ? { x: HALF_M * (1 - end.u), y: 2 * HALF_M * (1 - end.v) } : null
  const judged = impact ? judgePoint(sites, cells, impact) : null
  const toucher = touch ? [...sites, ...others].find(s => s.jersey === touch!.jersey) ?? null : null
  const verdict: Verdict | null = touch && judged ? (sites[judged.owner].jersey === touch.jersey ? 'in' : 'covered') : null
  return {
    side, near: nearSide(fit, play) === side, kind, ...(attack ? { attack } : {}), sites, cells, others, impact,
    owner: judged?.owner ?? null, seam: judged?.seam ?? null,
    touch: touch ? { jersey: touch.jersey, at: toucher ? { x: toucher.x, y: toucher.y } : null } : null, verdict,
  }
}

// ---- Drawing ----

const SEAM_COLOR = '#EF4444', ZONE_COLOR = '#3B82F6', LINE_COLOR = '#FFFFFF'
// The judgement's moments, seconds from the landing: the seam blinks for 2 s (a quarter second on, a
// quarter off) and its ripple spreads in the first second; the zone fills and the arrow grows in 0.4 s.
export const JUDGE_BLINK_SEC = 2, JUDGE_STEP_SEC = 0.25
export const judgeBoundaries = (): number[] => Array.from({ length: JUDGE_BLINK_SEC / JUDGE_STEP_SEC + 1 }, (_, i) => i * JUDGE_STEP_SEC)

// sec: seconds since the landing for the judgement (before it: none); undefined shows it as it ends
// up; null leaves it out (the export draws it on its own layers).
export function drawTerritory(ctx: Ctx, w: number, h: number, fit: CourtFit, t: Territory, sec?: number | null, lines = true): void {
  const H = homography(inPixels(fit, w, h))
  const on = (p: Pt) => (t.near ? project(H, p.x / HALF_M, 1 - p.y / (2 * HALF_M)) : project(H, 1 - p.x / HALF_M, p.y / (2 * HALF_M)))
  const path = (pts: Pt[]) => { ctx.beginPath(); pts.forEach((p, i) => { const q = on(p); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y) }); ctx.closePath() }
  const lw = Math.max(1.5, w / 640), fs = Math.max(11, w / 70)
  ctx.save()
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  if (lines) {
    // The areas: a faint light line round each, and each player's number where they stand.
    ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = lw * 3
    ctx.strokeStyle = LINE_COLOR; ctx.globalAlpha = 0.75; ctx.lineWidth = lw
    for (const c of t.cells) { path(c); ctx.stroke() }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1
    const badge = (s: Site, floor: boolean) => {
      const p = on(s), r = fs * 0.85
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = floor ? (s.libero ? 'rgba(250,204,21,0.9)' : 'rgba(15,23,42,0.78)') : 'rgba(100,116,139,0.7)'; ctx.fill()
      ctx.strokeStyle = LINE_COLOR; ctx.lineWidth = Math.max(1, lw * 0.8); ctx.stroke()
      ctx.fillStyle = floor && s.libero ? '#0F172A' : '#FFFFFF'; ctx.font = `bold ${fs}px sans-serif`
      ctx.fillText(String(s.jersey), p.x, p.y + fs * 0.04)
    }
    for (const s of t.others) badge(s, false)
    for (const s of t.sites) badge(s, true)
  }
  if (sec !== null && (sec === undefined || sec >= 0) && t.impact) drawJudgement(ctx, w, t, on, path, sec ?? JUDGE_BLINK_SEC + 1, lw, fs)
  ctx.restore()
}

function drawJudgement(ctx: Ctx, w: number, t: Territory, on: (p: Pt) => Pt, path: (pts: Pt[]) => void, sec: number, lw: number, fs: number): void {
  const grow = Math.min(1, sec / 0.4), impact = t.impact!
  // Played in the area it came down in, or by one who came over: that player's area lights blue.
  const lit = t.verdict === 'in' ? t.owner : t.verdict === 'covered' && t.touch ? t.sites.findIndex(s => s.jersey === t.touch!.jersey) : -1
  if (lit !== null && lit >= 0) { ctx.globalAlpha = 0.32 * grow; ctx.fillStyle = ZONE_COLOR; path(t.cells[lit]); ctx.fill(); ctx.globalAlpha = 1 }
  if (t.verdict === 'covered' && t.owner !== null) { ctx.globalAlpha = 0.18 * grow; ctx.fillStyle = '#FFFFFF'; path(t.cells[t.owner]); ctx.fill(); ctx.globalAlpha = 1 }
  // On the seam: the line between the two areas blinks red, and a red ring spreads from the ball.
  if (t.seam) {
    const blink = sec >= JUDGE_BLINK_SEC || Math.floor(sec / JUDGE_STEP_SEC) % 2 === 0
    const a = on(t.seam.edge[0]), b = on(t.seam.edge[1])
    ctx.strokeStyle = SEAM_COLOR; ctx.globalAlpha = blink ? 1 : 0.35; ctx.lineWidth = lw * 3; ctx.shadowColor = SEAM_COLOR; ctx.shadowBlur = lw * 6
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    if (sec < 1) {
      const r = 0.3 + 1.7 * (1 - (1 - sec) ** 3)
      ctx.globalAlpha = 1 - sec; ctx.lineWidth = lw * 2
      path(Array.from({ length: 32 }, (_, i) => ({ x: impact.x + r * Math.cos((i / 32) * Math.PI * 2), y: impact.y + r * Math.sin((i / 32) * Math.PI * 2) }))); ctx.stroke()
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1
  }
  // Came over for it: an arrow of light from where that player stands to the ball.
  const from = t.verdict === 'covered' ? t.touch?.at : null
  if (from) {
    const a = on(from), b0 = on(impact), b = { x: a.x + (b0.x - a.x) * grow, y: a.y + (b0.y - a.y) * grow }
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len > 2) {
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len, head = Math.min(len * 0.4, lw * 7)
      ctx.strokeStyle = '#7DD3FC'; ctx.fillStyle = '#7DD3FC'; ctx.lineWidth = lw * 2.2; ctx.lineCap = 'round'; ctx.shadowColor = '#38BDF8'; ctx.shadowBlur = lw * 5
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x - ux * head * 0.6, b.y - uy * head * 0.6); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - ux * head - uy * head * 0.55, b.y - uy * head + ux * head * 0.55); ctx.lineTo(b.x - ux * head + uy * head * 0.55, b.y - uy * head - ux * head * 0.55); ctx.closePath(); ctx.fill()
      ctx.shadowBlur = 0
    }
  }
  // The ball, and what it was.
  const p = on(impact)
  ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(3, w / 220), 0, Math.PI * 2); ctx.fillStyle = t.seam ? SEAM_COLOR : '#FACC15'; ctx.fill(); ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = lw; ctx.stroke()
  const label = [t.seam ? 'SEAM' : '', t.verdict === 'in' ? `IN ZONE (#${t.touch!.jersey})` : t.verdict === 'covered' ? `COVERED BY #${t.touch!.jersey}!` : ''].filter(Boolean).join('  ')
  if (label && grow > 0) {
    ctx.globalAlpha = grow; ctx.font = `bold ${fs * 1.15}px sans-serif`; ctx.lineWidth = Math.max(3, fs * 0.22); ctx.strokeStyle = '#000000'
    ctx.fillStyle = t.seam ? '#FECACA' : t.verdict === 'covered' ? '#BAE6FD' : '#BFDBFE'
    const y = p.y - fs * 1.6
    ctx.strokeText(label, p.x, y); ctx.fillText(label, p.x, y); ctx.globalAlpha = 1
  }
}
