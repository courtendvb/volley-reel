// A setter's sets in one rotation, as a chart over the video: where each set was given (the scout's
// click), coloured by where it went (the zone the attack after it came from), and how that attack
// ended: filled for a kill, open for the ball staying in play, a cross for a point lost. Above the
// court, the share of sets to each place; below it, the kill rate there. The setter's own attacks
// (second-ball dumps) count as a place of their own. Pure: no DOM.
import { chartBox, type ChartCorner } from './chart'
import type { ClickPoint, Play } from './types'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export type SetTarget = 'left' | 'middle' | 'right' | 'back' | 'pipe' | 'dump'
export const SET_TARGETS: SetTarget[] = ['left', 'middle', 'right', 'back', 'pipe', 'dump']
// Zone 4 blue, zone 2 red and zone 1 a deeper red, the middle green, the pipe purple, the setter yellow.
export const SET_COLORS: Record<SetTarget, string> = { left: '#2563EB', middle: '#16A34A', right: '#EF4444', back: '#991B1B', pipe: '#9333EA', dump: '#EAB308' }

export type SetResult = 'kill' | 'play' | 'lost'
// at: x across, y from the end line (0) to the net (1), as the chart shows it; click: as the scout
// clicked it, seen by the team (for the court on the video); both null when the set was not clicked.
export interface SetDot { at: { x: number; y: number } | null; click: ClickPoint | null; target: SetTarget; result: SetResult; jersey?: number } // jersey: the attacker's, on slides made when the discs showed it (no longer drawn)
export interface SetChart {
  title: string; rotation: number | null; dots: SetDot[]
  rotLabel: string // the rotations in the title: S2, S1/S4, or All
  filtered: string // what else it is kept to (setter calls, the other team's rotations), for the title; '' for nothing
  total: number; kills: number; errors: number
  by: Record<SetTarget, { n: number; kills: number }>
}
// view: where each set was given as points (needs the sets' clicks), or only the places painted by
// their share (from the attacks' zones alone); auto: points when most sets have a click.
export type SetChartView = 'auto' | 'points' | 'zones'
// flip: the net at the top, seen from behind the setter's own end line (else at the bottom, seen across the net).
export interface SetChartStyle { corner: ChartCorner; scale: number; view?: SetChartView; flip?: boolean }
export const DEFAULT_SET_CHART: SetChartStyle = { corner: 'tl', scale: 1 }
// The setting as read back: anything missing or of the wrong kind takes the usual value.
export function cleanSetChart(x: unknown): SetChartStyle {
  const o = (x && typeof x === 'object' ? x : {}) as Partial<SetChartStyle>
  return {
    corner: o.corner === 'tr' || o.corner === 'bl' || o.corner === 'br' ? o.corner : 'tl',
    scale: typeof o.scale === 'number' && o.scale >= 0.5 && o.scale <= 1.5 ? o.scale : 1,
    ...(o.view === 'points' || o.view === 'zones' ? { view: o.view } : {}), ...(o.flip ? { flip: true } : {}),
  }
}
// The distribution laid on the court in the video: where the sets were given, or each place's share.
export type SetCourtLayer = 'spots' | 'shares'
export interface SetCourtStyle { layer: SetCourtLayer }
export const DEFAULT_SET_COURT: SetCourtStyle = { layer: 'shares' }
export const cleanSetCourt = (x: unknown): SetCourtStyle => ({ layer: (x as Partial<SetCourtStyle> | null)?.layer === 'spots' ? 'spots' : 'shares' })

// Where an attack came from, as a place to set to; the setter's own is a dump.
export function setTarget(attack: Pick<Play, 'startZone' | 'playerKey'>, setter: string): SetTarget | null {
  if (attack.playerKey === setter) return 'dump'
  const z = attack.startZone
  return z === 4 || z === 5 || z === 7 ? 'left' : z === 3 ? 'middle' : z === 2 ? 'right' : z === 1 || z === 9 ? 'back' : z === 8 || z === 6 ? 'pipe' : null
}
const resultOf = (effect: string): SetResult => (effect === '#' ? 'kill' : effect === '=' || effect === '/' ? 'lost' : 'play')
const rotationOf = (p: Play) => (p.side === '*' ? p.homeRot : p.awayRot)
const otherRotationOf = (p: Play) => (p.side === '*' ? p.awayRot : p.homeRot)
// A set's setter call (K1, KA...), from its code; '' when none was coded.
export const setterCall = (p: Pick<Play, 'code'>) => { const c = p.code.slice(6, 8); return /^[A-Z0-9]{2}$/i.test(c) ? c.toUpperCase() : '' }

// What the setter's sets are kept to. rot: the rotations (missing or empty: the selected play's; 'all':
// every one); calls: the setter calls (none: all, dumps too); oppRots: the other team's rotations;
// phases: after their own reception or in transition; recs: the evaluation of the reception the set
// came from (so the reception phase only); scores: the setter's team's points before the rally, in
// bands. Anything missing or empty: all.
export type SetPhase = 'r' | 't'
export type ScoreBand = 'early' | 'mid' | 'late'
export const SCORE_BANDS: { band: ScoreBand; label: string }[] = [{ band: 'early', label: '0–9' }, { band: 'mid', label: '10–19' }, { band: 'late', label: '20–' }]
export const REC_EFFECTS = ['#', '+', '!', '-', '/', '=']
const bandOf = (points: number): ScoreBand => (points >= 20 ? 'late' : points >= 10 ? 'mid' : 'early')
export interface SetFilter { rot?: 'all' | number[]; calls?: string[]; oppRots?: number[]; phases?: SetPhase[]; recs?: string[]; scores?: ScoreBand[] }
const rotList = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= 6))].sort() : [])
export function cleanSetFilter(x: unknown): SetFilter {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const rot = o.rot === 'all' ? 'all' : rotList(o.rot), calls = Array.isArray(o.calls) ? o.calls.filter((c): c is string => typeof c === 'string' && /^[A-Z0-9]{2}$/.test(c)) : []
  const opp = rotList(o.oppRots)
  const pick = <T extends string>(x: unknown, of: readonly T[]): T[] => (Array.isArray(x) ? of.filter(v => x.includes(v)) : [])
  const phases = pick(o.phases, ['r', 't'] as const), recs = pick(o.recs, REC_EFFECTS), scores = pick(o.scores, ['early', 'mid', 'late'] as const)
  return {
    ...(rot === 'all' || rot.length ? { rot } : {}), ...(calls.length ? { calls } : {}), ...(opp.length ? { oppRots: opp } : {}),
    ...(phases.length ? { phases } : {}), ...(recs.length ? { recs } : {}), ...(scores.length ? { scores } : {}),
  }
}
export const setFilterCount = (f: SetFilter | undefined) =>
  [f?.rot, f?.calls?.length, f?.oppRots?.length, f?.phases?.length, f?.recs?.length, f?.scores?.length].filter(Boolean).length

// The same team's next contact after play i, when it is an attack in the same rally.
function nextAttack(plays: Play[], i: number): Play | null {
  const set = plays[i]
  for (let k = i + 1; k < plays.length; k++) {
    const q = plays[k]
    if (q.rallyId !== set.rallyId || q.setNum !== set.setNum) return null
    if (q.side === set.side) return q.skill === 'A' ? q : null
  }
  return null
}
// The set right before an attack: the same team's contact before it in the rally.
function setBeforeAt(plays: Play[], i: number): Play | null {
  const attack = plays[i]
  for (let k = i - 1; k >= 0; k--) {
    const q = plays[k]
    if (q.rallyId !== attack.rallyId || q.setNum !== attack.setNum) return null
    if (q.side === attack.side) return q.skill === 'E' ? q : null
  }
  return null
}
export const setBefore = (plays: Play[], attack: Play): Play | null => setBeforeAt(plays, plays.indexOf(attack))
// The attack a setter's contact at i led to: after a set, the team's next contact if it is an attack;
// the setter's own attack not after a set of the team (a dump) is its own. Null otherwise.
export function attackOfContact(plays: Play[], i: number): Play | null {
  const p = plays[i]
  return p.skill === 'E' ? nextAttack(plays, i) : p.skill === 'A' && !setBeforeAt(plays, i) ? p : null
}

// The chart of the setter of `play` (a set, or an attack: the set before it) in the rotation it was
// in, from `plays` (every match, each match's plays together and in order).
// filter: other rotations than the play's, only some setter calls, only some of the other team's rotations.
export function setChart(play: Play, plays: Play[], nameOf: (set: Play) => string = () => '', filter: SetFilter = {}): SetChart | null {
  const set = play.skill === 'E' ? play : play.skill === 'A' ? setBefore(plays, play) : null
  if (!set) return null
  const setter = set.playerKey, rotation = rotationOf(set)
  const rots = filter.rot === 'all' ? null : filter.rot?.length ? filter.rot : rotation !== null ? [rotation] : null
  const calls = filter.calls?.length ? filter.calls : null, opp = filter.oppRots?.length ? filter.oppRots : null
  const phases = filter.phases?.length ? filter.phases : null, recs = filter.recs?.length ? filter.recs : null, scores = filter.scores?.length ? filter.scores : null
  const by = Object.fromEntries(SET_TARGETS.map(k => [k, { n: 0, kills: 0 }])) as SetChart['by']
  const dots: SetDot[] = []
  let kills = 0, errors = 0
  plays.forEach((p, i) => {
    if (p.playerKey !== setter) return
    const r = rotationOf(p), o = otherRotationOf(p)
    if (rots && (r === null || !rots.includes(r))) return
    if (opp && (o === null || !opp.includes(o))) return
    // A dump has no call: with calls asked for, only sets of those calls.
    if (calls && (p.skill !== 'E' || !calls.includes(setterCall(p)))) return
    if (phases && (!p.phase || !phases.includes(p.phase))) return
    if (recs && (p.phase !== 'r' || !p.recEffect || !recs.includes(p.recEffect))) return
    if (scores && !scores.includes(bandOf(p.side === '*' ? p.score.home : p.score.away))) return
    // A set and the attack after it, or the setter attacking themself (not after a set of their own).
    const attack = attackOfContact(plays, i)
    if (!attack) return
    const target = setTarget(attack, setter)
    if (!target) return
    const result = resultOf(attack.effect)
    by[target].n++
    if (result === 'kill') { by[target].kills++; kills++ }
    if (result === 'lost') errors++
    // Where the set was given from (a set's first click); a setter's own attack: where it was hit.
    // A set known only by where it went has no point (it still counts in the shares).
    const click = p.skill === 'E' ? p.startClick ?? null : p.startClick ?? p.endClick ?? null, at = spot(click)
    dots.push({ at, click: at ? click : null, target, result })
  })
  const total = dots.length
  const rotLabel = !rots ? 'All' : rots.map(r => `S${r}`).join('/')
  const filtered = [
    calls ? calls.join(' ') : '', opp ? `Opp ${opp.map(r => `R${r}`).join('/')}` : '',
    phases ? phases.map(x => (x === 'r' ? 'Rec' : 'Trans')).join('/') : '', recs ? `R ${recs.join('')}` : '',
    scores ? `Pts ${scores.map(b => SCORE_BANDS.find(x => x.band === b)!.label).join(', ')}` : '',
  ].filter(Boolean).join(' · ')
  return total ? { title: nameOf(set), rotation, rotLabel, filtered, dots, total, kills, errors, by } : null
}

// A click as seen across the net: the team's half with its end line at the top and the net at the
// bottom, so the setter's right (zone 2) is on the left, as the camera sees the far team.
const spot = (c: ClickPoint | null) => (c && c.v >= -0.1 && c.v <= 0.6 ? { x: 1 - c.u, y: Math.min(1, Math.max(0, c.v * 2)) } : null)

const pct = (n: number, of: number) => `${of ? Math.round((n / of) * 100) : 0}%`
const TEXT = '#0F172A'
export const setChartWidth = (h: number) => h * 0.78

// The sets as plain discs (no jersey: it crowded the plot), in the colour of where the attack came from: filled
// for a kill, white for the ball staying in play, white with a dark mark at its corner for a point
// lost. Discs that would cover each other are moved apart, kept on the court.
function drawSetDiscs(ctx: Ctx, list: { x: number; y: number; d: SetDot }[], r: number, court: { x: number; y: number; w: number }): void {
  const ps = list.map(p => ({ ...p }))
  for (let pass = 0; pass < 12; pass++) for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const a = ps[i], b = ps[j], dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), min = r * 1.9
    if (dist >= min) continue
    const [ux, uy] = dist > 1e-6 ? [dx / dist, dy / dist] : [Math.cos(j * 2.4), Math.sin(j * 2.4)], push = (min - dist) / 2
    a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push
    for (const p of [a, b]) { p.x = Math.min(court.x + court.w - r, Math.max(court.x + r, p.x)); p.y = Math.min(court.y + court.w - r, Math.max(court.y + r, p.y)) }
  }
  for (const { x, y, d } of ps) {
    const color = SET_COLORS[d.target], kill = d.result === 'kill'
    ctx.beginPath(); ctx.arc(x, y + r * 0.14, r, 0, Math.PI * 2); ctx.fillStyle = 'rgba(15,23,42,0.25)'; ctx.fill() // its shadow
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = kill ? color : '#FFFFFF'; ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, r * 0.22); ctx.stroke()
    if (d.result === 'lost') {
      const k = r * 0.38, cx = x + r * 0.75, cy = y - r * 0.75
      ctx.beginPath(); ctx.arc(cx, cy, k * 1.2, 0, Math.PI * 2); ctx.fillStyle = TEXT; ctx.fill()
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = Math.max(1, k * 0.35)
      ctx.beginPath(); ctx.moveTo(cx - k * 0.6, cy - k * 0.6); ctx.lineTo(cx + k * 0.6, cy + k * 0.6); ctx.moveTo(cx + k * 0.6, cy - k * 0.6); ctx.lineTo(cx - k * 0.6, cy + k * 0.6); ctx.stroke()
    }
  }
}

// The key to the set discs: kill, in play, lost.
function drawKey(ctx: Ctx, cx: number, cy: number, size: number, maxW: number): void {
  const items: [string, SetResult][] = [['Kill', 'kill'], ['In play', 'play'], ['Lost', 'lost']]
  ctx.font = `${size}px sans-serif`
  const r = size * 0.5, each = items.map(([t]) => r * 2.6 + ctx.measureText(t).width), total = Math.min(maxW, each.reduce((a, b) => a + b, 0) + size * 1.5 * (items.length - 1))
  let x = cx - total / 2
  items.forEach(([label, kind], i) => {
    ctx.beginPath(); ctx.arc(x + r, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = kind === 'kill' ? '#475569' : '#FFFFFF'; ctx.fill(); ctx.strokeStyle = '#475569'; ctx.lineWidth = Math.max(1, r * 0.3); ctx.stroke()
    if (kind === 'lost') { ctx.beginPath(); ctx.arc(x + r * 1.7, cy - r * 0.7, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = TEXT; ctx.fill() }
    ctx.fillStyle = '#475569'; ctx.textAlign = 'left'; ctx.fillText(label, x + r * 2.6, cy)
    x += each[i] + size * 1.5
  })
  ctx.textAlign = 'center'
}

// The places' names, in the scout's terms on every screen.
export const SET_NAMES: Record<SetTarget, string> = { left: 'Zone4', middle: 'Zone3', right: 'Zone2', back: 'Zone1', pipe: 'Pipe', dump: 'SD' }

// The places most and least set to (of those set to at all), for the red and blue frames.
export function setExtremes(c: SetChart): { most: SetTarget | null; least: SetTarget | null } {
  const used = SET_TARGETS.filter(k => c.by[k].n > 0).sort((a, b) => c.by[b].n - c.by[a].n)
  return { most: used[0] ?? null, least: used.length > 1 && c.by[used[used.length - 1]].n < c.by[used[0]].n ? used[used.length - 1] : null }
}

// Each place's area as the team sees its own half: u across from its left, v from its end line (0)
// to the net (0.5). The front row by the net, the back row's attacks just behind the attack line.
// A dump has none.
const FRONT = [1 / 3, 0.5], BACK = [1 / 6, 1 / 3]
export const SET_AREAS: Partial<Record<SetTarget, { u: [number, number]; v: [number, number] }>> = {
  left: { u: [0, 1 / 3], v: [FRONT[0], FRONT[1]] }, middle: { u: [1 / 3, 2 / 3], v: [FRONT[0], FRONT[1]] }, right: { u: [2 / 3, 1], v: [FRONT[0], FRONT[1]] },
  pipe: { u: [1 / 3, 2 / 3], v: [BACK[0], BACK[1]] }, back: { u: [2 / 3, 1], v: [BACK[0], BACK[1]] },
}

// Where the chart goes in a w × h picture: in its corner, its size as a direction chart's height.
export function setChartBox(w: number, h: number, s: SetChartStyle): { x: number; y: number; h: number } {
  const b = chartBox(w, h, s.corner, s.scale), cw = setChartWidth(b.h), edge = h * 0.02
  return { x: s.corner === 'tl' || s.corner === 'bl' ? edge : w - cw - edge, y: b.y, h: b.h }
}

// Points or zones: as asked, or points when at least half the sets have a click to put them at.
export const setChartShows = (c: SetChart, view: SetChartView = 'auto'): 'points' | 'zones' =>
  view !== 'auto' ? view : c.dots.filter(d => d.at).length * 2 >= c.dots.length ? 'points' : 'zones'

// The panel: the setter and rotation, K% and ERR% of the attacks after the sets, then their half court
// with each place's share written on it away from the net, and the sets as points (or the places
// painted). flip: the net at the top, seen from the setter's side. rich (a rotation slide, whose
// heading is drawn apart): no title or totals; each set a disc, the discs
// moved apart where they would cover each other, and a key to the marks under the court.
export function drawSetChart(ctx: Ctx, c: SetChart, { x, y, h }: { x: number; y: number; h: number }, view: SetChartView = 'auto', flip = false, rich = false): void {
  const w = setChartWidth(h), f = h / 24
  ctx.save()
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  // The labels: the front row's places on the end line, the back row's beyond it (outside the court).
  const fs = f * 0.9, bh = fs * 2.6, gap = fs * 0.3
  const more = c.filtered && !rich ? f * 1.3 : 0 // a line for what the sets are kept to
  const head = rich ? f * 0.4 : f * 4.4, key = rich ? f * 1.8 : 0
  const side = Math.min(w * 0.9, h - head - f * 0.6 - more - bh * 2 - gap - key), cl = x + (w - side) / 2
  const ct = y + head + more + (flip ? bh / 2 : bh * 1.5 + gap)
  const ph = ct + side + (flip ? bh * 1.5 + gap : f * 0.6) + key - y
  ctx.fillStyle = 'rgba(255,255,255,0.94)'; ctx.fillRect(x, y, w, ph)
  if (!rich) {
    // Title and the totals.
    ctx.fillStyle = '#E2E8F0'; ctx.fillRect(x, y, w, f * 2.2)
    ctx.fillStyle = TEXT; ctx.font = `bold ${f * 1.25}px sans-serif`
    ctx.fillText(`${c.title}  ${c.rotLabel}`, x + w / 2, y + f * 1.1, w * 0.96)
    ctx.font = `${f}px sans-serif`
    ctx.fillText(`K: ${pct(c.kills, c.total)} | ERR: ${pct(c.errors, c.total)} | n: ${c.total}`, x + w / 2, y + f * 3.2, w * 0.96)
    if (c.filtered) { ctx.fillStyle = '#475569'; ctx.font = `${f * 0.85}px sans-serif`; ctx.fillText(c.filtered, x + w / 2, y + f * 4.5, w * 0.96) }
  }
  // A point of the chart (x across, y from the end line to the net) on the panel: flipped, turned round.
  const at = (px: number, py: number) => (flip ? { x: cl + (1 - px) * side, y: ct + (1 - py) * side } : { x: cl + px * side, y: ct + py * side })
  // rich: the points wherever any set was clicked (those without a click are only in the shares).
  const zones = rich ? !c.dots.some(d => d.at) : setChartShows(c, view) === 'zones'
  if (zones) {
    // Only where the sets went: each place painted the stronger the more sets went there.
    const top = Math.max(...SET_TARGETS.map(k => c.by[k].n), 1)
    for (const k of SET_TARGETS) {
      const a = SET_AREAS[k], b = c.by[k]
      if (!a || !b.n) continue
      // The team's view (u from its left, v to the net at 0.5) as the chart's (across the net).
      const p1 = at(1 - a.u[1], a.v[0] * 2), p2 = at(1 - a.u[0], a.v[1] * 2)
      ctx.globalAlpha = 0.18 + 0.6 * (b.n / top); ctx.fillStyle = SET_COLORS[k]
      ctx.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y)); ctx.globalAlpha = 1
    }
  }
  // The court: its lines, the attack line, and the net thick.
  ctx.strokeStyle = TEXT; ctx.lineWidth = Math.max(1, f / 12)
  ctx.strokeRect(cl, ct, side, side)
  const across = (py: number, width: number, reach = 0) => { const a = at(0, py), b = at(1, py); ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(Math.min(a.x, b.x) - reach, a.y); ctx.lineTo(Math.max(a.x, b.x) + reach, a.y); ctx.stroke() }
  across(2 / 3, Math.max(1, f / 12))
  across(1, Math.max(2, f / 4), side * 0.05)
  if (!zones && rich) drawSetDiscs(ctx, c.dots.flatMap(d => (d.at ? [{ ...at(d.at.x, d.at.y), d }] : [])), side / 60, { x: cl, y: ct, w: side })
  if (rich) drawKey(ctx, x + w / 2, ct + side + (flip ? bh * 1.5 + gap : f * 0.6) + key / 2, f * 0.8, w * 0.96)
  if (!zones && !rich) {
    const r = Math.max(2.5, side / 45)
    for (const d of c.dots) {
      if (!d.at) continue
      const p = at(d.at.x, d.at.y), color = SET_COLORS[d.target]
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1.2, r * 0.4)
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      if (d.result === 'kill') ctx.fill(); else ctx.stroke()
      if (d.result === 'lost') {
        const k = r * 0.7
        ctx.beginPath(); ctx.moveTo(p.x - k, p.y - k); ctx.lineTo(p.x + k, p.y + k); ctx.moveTo(p.x + k, p.y - k); ctx.lineTo(p.x - k, p.y + k); ctx.stroke()
      }
    }
  }
  // The shares on the end line, each above its place as it lies across the court: Zone2, Zone3 and
  // Zone4 on the line, Zone1 (behind Zone2), Pipe (behind Zone3) and SD beyond it. The most set to is
  // framed red, the least blue. Turned round, the columns change sides.
  const { most, least } = setExtremes(c), cell = side / 3
  const colOf: Record<SetTarget, number> = { right: 0, back: 0, middle: 1, pipe: 1, left: 2, dump: 2 }
  const endY = flip ? ct + side : ct, out = flip ? 1 : -1
  for (const k of SET_TARGETS) {
    const col = flip ? 2 - colOf[k] : colOf[k], cx = cl + cell * (col + 0.5)
    const front = k === 'left' || k === 'middle' || k === 'right'
    const cy = front ? endY : endY + out * (bh + gap)
    const bw = cell * 0.82, top = cy - bh / 2
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillRect(cx - bw / 2, top, bw, bh)
    ctx.strokeStyle = k === most ? '#DC2626' : k === least ? '#2563EB' : '#CBD5E1'; ctx.lineWidth = k === most || k === least ? Math.max(1.5, f / 6) : 1
    ctx.strokeRect(cx - bw / 2, top, bw, bh)
    ctx.fillStyle = SET_COLORS[k]; ctx.font = `bold ${fs}px sans-serif`; ctx.fillText(SET_NAMES[k], cx, top + bh * 0.3, bw * 0.94)
    ctx.fillStyle = TEXT; ctx.font = `${fs * 1.1}px sans-serif`; ctx.fillText(pct(c.by[k].n, c.total), cx, top + bh * 0.72, bw * 0.94)
  }
  ctx.restore()
}
