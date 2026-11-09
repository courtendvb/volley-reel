// A match report from one DVW: for each team its players' points, serve, reception, attack and block
// numbers with the sets they played, the team's totals and set by set, side-out and break-point
// efficiency, the score difference in each rotation, and the first attack after a good or a poor
// reception and after a dig. Pure: the screen and the PDF draw it (reportHtml.ts).
import type { MatchInfo, ParsedDVW, Play, Side } from './types'

export interface Counts { tot: number; err: number }
// poss: serves after which their team got an attack of its own (a possibility); brk: rallies their team won on the serve (break points)
export interface ServeLine extends Counts { pts: number; poss: number; brk: number }
export interface RecLine extends Counts { pos: number; exc: number; ovr: number } // # and + / # / overpasses (/)
export interface AttackLine extends Counts { blo: number; pts: number }
export interface StatLine { points: number; bp: number; wl: number; serve: ServeLine; rec: RecLine; att: AttackLine; blk: number }
// onCourt: the rallies they were on court for (a libero: those they played a ball in, as lineups leave liberos out);
// played: in a report of several matches, those rallies of all the team's rallies (in place of sets), and the sets
// they played of all the team's sets (what a libero's share is told by, as the lineups leave them out)
export interface PlayerLine extends StatLine { key: string; jersey: number; name: string; libero: boolean; sets: (number | '*' | null)[]; onCourt: number; played?: { rallies: number; of: number; sets: number; setsOf: number } }
export interface SetLine extends StatLine { set: number; label?: string; won: { ser: number; atk: number; blo: number; opErr: number } } // label: a match, in a report of several
export interface TeamReport {
  side: Side; code: string; name: string; setsWon: number; coach: string; assistant: string; rallies: number // rallies played to a point
  players: PlayerLine[]; total: StatLine; sets: SetLine[]
  so: { receptions: number; points: number }; bp: { serves: number; points: number }
  rotations: { rot: number; diff: number }[] // points won minus lost in each of the team's rotations
  kill: { pos: AttackLine; neg: AttackLine; dig: AttackLine } // the first attack after a #/+ or -/! reception, and after a dig
}
// matches: in a report of several matches (one team over a season), each match, its rows standing in for sets
export interface MatchReport { date: string | null; time: string | null; info: MatchInfo | null; teams: [TeamReport, TeamReport]; matches?: { label: string; date: string | null; score: string; won: boolean }[] }

const zero = (): StatLine => ({ points: 0, bp: 0, wl: 0, serve: { tot: 0, err: 0, pts: 0, poss: 0, brk: 0 }, rec: { tot: 0, err: 0, pos: 0, exc: 0, ovr: 0 }, att: { tot: 0, err: 0, blo: 0, pts: 0 }, blk: 0 })
const attackZero = (): AttackLine => ({ tot: 0, err: 0, blo: 0, pts: 0 })

// One play into a line. serving: whether the play's team served the rally (for break points); won: whether it won the rally.
function add(l: StatLine, p: Play, serving: boolean, won: boolean): void {
  const point = p.effect === '#' && (p.skill === 'S' || p.skill === 'A' || p.skill === 'B')
  if (point) { l.points++; if (serving) l.bp++ }
  // Won minus lost: a point scored, or an error that gave the point away (a blocked attack too).
  if (point) l.wl++
  if (p.effect === '=' || (p.skill === 'A' && p.effect === '/')) l.wl--
  if (p.skill === 'S') { l.serve.tot++; if (p.effect === '=') l.serve.err++; if (p.effect === '#') l.serve.pts++; if (p.possibility) l.serve.poss++; if (won) l.serve.brk++ }
  if (p.skill === 'R') { l.rec.tot++; if (p.effect === '=') l.rec.err++; if (p.effect === '#' || p.effect === '+') l.rec.pos++; if (p.effect === '#') l.rec.exc++; if (p.effect === '/') l.rec.ovr++ }
  if (p.skill === 'A') addAttack(l.att, p)
  if (p.skill === 'B' && p.effect === '#') l.blk++
}
function addAttack(a: AttackLine, p: Play): void {
  a.tot++
  if (p.effect === '=') a.err++
  if (p.effect === '/') a.blo++
  if (p.effect === '#') a.pts++
}

export function matchReport(d: ParsedDVW): MatchReport {
  // Who served each rally.
  const server = new Map<number, Side>()
  for (const p of d.plays) if (p.skill === 'S' && p.rallyId !== null && !server.has(p.rallyId)) server.set(p.rallyId, p.side)
  const winner = new Map(d.rallies.map(r => [r.id, r.wonBy]))
  const team = (side: Side, i: 0 | 1): TeamReport => {
    const lines = new Map<number, PlayerLine>()
    for (const pl of Object.values(d.players).filter(x => x.side === side).sort((a, b) => a.jersey - b.jersey)) {
      lines.set(pl.jersey, { ...zero(), onCourt: 0, key: pl.key, jersey: pl.jersey, name: [pl.lastName, pl.firstName].filter(Boolean).join(' '), libero: !!pl.libero, sets: pl.sets ?? [] })
    }
    const total = zero(), bySet = new Map<number, SetLine>()
    const setLine = (n: number) => bySet.get(n) ?? (bySet.set(n, { ...zero(), set: n, won: { ser: 0, atk: 0, blo: 0, opErr: 0 } }), bySet.get(n)!)
    const kill = { pos: attackZero(), neg: attackZero(), dig: attackZero() }
    for (const p of d.plays) {
      if (p.side !== side) continue
      const serving = p.rallyId !== null && server.get(p.rallyId) === side, won = p.rallyId !== null && winner.get(p.rallyId) === side
      const pl = lines.get(p.jersey)
      if (pl) add(pl, p, serving, won)
      add(total, p, serving, won)
      add(setLine(p.setNum), p, serving, won)
      if (p.skill === 'A') {
        if (p.phase === 't') addAttack(kill.dig, p)
        else if (p.phase === 'r' && (p.recEffect === '#' || p.recEffect === '+')) addAttack(kill.pos, p)
        else if (p.phase === 'r' && (p.recEffect === '-' || p.recEffect === '!')) addAttack(kill.neg, p)
      }
    }
    // The rallies: how each point was won (its last play), side-out and break, the rotations.
    const so = { receptions: total.rec.tot, points: 0 }, bp = { serves: total.serve.tot, points: 0 }
    const rot = new Map<number, number>()
    let rallies = 0
    for (const r of d.rallies) {
      if (!r.wonBy) continue
      rallies++
      // On court: the lineup at the serve; a libero when they played a ball in the rally.
      const onCourt = new Set(side === '*' ? r.court?.home ?? [] : r.court?.away ?? [])
      for (const p of d.plays) if (p.rallyId === r.id && p.side === side && lines.get(p.jersey)?.libero) onCourt.add(p.jersey)
      for (const j of onCourt) { const l = lines.get(j); if (l) l.onCourt++ }
      const served = server.get(r.id)
      if (!served) continue
      const mine = d.plays.filter(p => p.rallyId === r.id)
      const first = mine[0], myRot = first ? (side === '*' ? first.homeRot : first.awayRot) : null
      const won = r.wonBy === side
      if (myRot) rot.set(myRot, (rot.get(myRot) ?? 0) + (won ? 1 : -1))
      if (!won) continue
      if (served === side) bp.points++; else so.points++
      const last = [...mine].reverse().find(p => p.side === side && p.effect === '#' && 'SAB'.includes(p.skill))
      const s = setLine(r.setNum)
      if (!last) s.won.opErr++
      else if (last.skill === 'S') s.won.ser++
      else if (last.skill === 'A') s.won.atk++
      else s.won.blo++
    }
    return {
      side, code: d.teams[i].code, name: d.teams[i].name, setsWon: d.info?.setsWon[i] ?? 0, rallies,
      coach: d.info?.staff[i].coach ?? '', assistant: d.info?.staff[i].assistant ?? '',
      players: [...lines.values()], total, sets: [...bySet.values()].sort((a, b) => a.set - b.set),
      so, bp, rotations: [1, 2, 3, 4, 5, 6].map(r => ({ rot: r, diff: rot.get(r) ?? 0 })), kill,
    }
  }
  return { date: d.date, time: d.info?.time ?? null, info: d.info ?? null, teams: [team('*', 0), team('a', 1)] }
}

// ---- several matches -------------------------------------------------------------------------
// One team over several matches: its players added up (each with the share of the team's rallies
// they were on court for), a row per match in place of the sets, and the opponents together as the other side.
export interface ReportMatch { d: ParsedDVW; label: string; side: Side } // side: the team's in this match

const sumInto = <T extends object>(a: T, b: T): T => {
  for (const k of Object.keys(b) as (keyof T)[]) {
    const v = b[k] as unknown
    if (typeof v === 'number') (a[k] as unknown as number) += v
    else if (v && typeof v === 'object' && !Array.isArray(v)) sumInto(a[k] as object, v as object)
  }
  return a
}
const statOf = (l: StatLine): StatLine => ({ points: l.points, bp: l.bp, wl: l.wl, serve: { ...l.serve }, rec: { ...l.rec }, att: { ...l.att }, blk: l.blk })

export function seasonReport(list: ReportMatch[]): MatchReport | null {
  if (!list.length) return null
  const sides = list.map(m => { const r = matchReport(m.d), i = m.side === '*' ? 0 : 1; return { m, r, mine: r.teams[i], them: r.teams[1 - i], i } })
  const players = new Map<string, PlayerLine>()
  let ofRallies = 0, ofSets = 0
  for (const { m, mine } of sides) {
    const setsHere = m.d.info?.sets.length || Math.max(1, ...m.d.plays.map(p => p.setNum))
    ofRallies += mine.rallies; ofSets += setsHere
    for (const p of mine.players) {
      const had = players.get(p.key) ?? { ...zero(), onCourt: 0, key: p.key, jersey: p.jersey, name: p.name, libero: p.libero, sets: [], played: { rallies: 0, of: 0, sets: 0, setsOf: 0 } }
      sumInto<StatLine>(had, statOf(p))
      had.played!.rallies += p.onCourt
      had.played!.sets += p.sets.slice(0, setsHere).filter(v => v !== null && v !== undefined).length
      had.libero = had.libero || p.libero
      had.onCourt += p.onCourt
      had.jersey = p.jersey
      players.set(p.key, had)
    }
  }
  for (const p of players.values()) { p.played!.of = ofRallies; p.played!.setsOf = ofSets }
  const side = (pick: (x: typeof sides[number]) => TeamReport, name: string, withPlayers: boolean): TeamReport => {
    const first = pick(sides[0]), total = zero(), so = { receptions: 0, points: 0 }, bp = { serves: 0, points: 0 }
    const rot = new Map<number, number>(), kill = { pos: attackZero(), neg: attackZero(), dig: attackZero() }
    const rows: SetLine[] = sides.map((x, k) => {
      const t = pick(x)
      sumInto(total, statOf(t.total)); sumInto(so, t.so); sumInto(bp, t.bp); sumInto(kill, t.kill)
      for (const r of t.rotations) rot.set(r.rot, (rot.get(r.rot) ?? 0) + r.diff)
      const won = { ser: 0, atk: 0, blo: 0, opErr: 0 }
      for (const s of t.sets) sumInto(won, s.won)
      return { ...statOf(t.total), set: k + 1, label: x.m.label, won }
    })
    return {
      side: first.side, code: first.code, name, setsWon: 0, rallies: sides.reduce((s, x) => s + pick(x).rallies, 0), coach: withPlayers ? first.coach : '', assistant: withPlayers ? first.assistant : '',
      players: withPlayers ? [...players.values()].sort((a, b) => a.jersey - b.jersey) : [], total, sets: rows, so, bp,
      rotations: [1, 2, 3, 4, 5, 6].map(r => ({ rot: r, diff: rot.get(r) ?? 0 })), kill,
    }
  }
  const mineName = sides[0].mine.name
  const matches = sides.map(({ m, mine, them }) => ({ label: m.label, date: m.d.date, score: `${mine.setsWon}-${them.setsWon}`, won: mine.setsWon > them.setsWon }))
  const us = side(x => x.mine, mineName, true), them = side(x => x.them, 'Opponents', false)
  us.setsWon = matches.filter(x => x.won).length; them.setsWon = matches.length - us.setsWon
  return { date: null, time: null, info: null, teams: [us, them], matches }
}

// Shares as whole percents ('' when there is nothing to share).
export const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '')
// How many receptions (or serves) one point took, to two places.
export const per = (n: number, points: number) => (points ? (n / points).toFixed(2) : '–')
