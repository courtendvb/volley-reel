// Analysis reports: what a team is really like over the project's matches. Pure: the 分析 window
// draws them (AnalysisDialog.tsx). More reports go in ANALYSIS_REPORTS as they are added.
import { matchReport, type ReportMatch } from './report'
import type { ParsedDVW, Play, Side } from './types'

export const ANALYSIS_REPORTS = ['pointError', 'sideOut', 'recAttack', 'runs'] as const
export type AnalysisReportId = typeof ANALYSIS_REPORTS[number]

// ---- point % and error % ---------------------------------------------------------------------
// One row per match (and a total) for the team and for its opponents: attempts, errors (=) and
// points (#) on the serve, reception, attack and block, and the rallies each side won.
// A block is coded only when the ball was touched, so the block column counts touches (every B).
export interface PointErrorCounts {
  serve: number; serveErr: number; serveWin: number // serves, errors (=), aces (#)
  rec: number; recErr: number // receptions, errors (=)
  attack: number; attackErr: number; attackWin: number // attacks, errors (=; a blocked attack is not one), kills (#)
  block: number; blockWin: number // block touches, block points (#)
  won: number; lost: number // rallies the side won and lost (its points and the other side's)
}
export interface PointErrorRow extends PointErrorCounts { label: string }
export interface PointErrorSide { rows: PointErrorRow[]; total: PointErrorRow }
export interface PointErrorReport { team: PointErrorSide; opponents: PointErrorSide }

const zero = (): PointErrorCounts => ({ serve: 0, serveErr: 0, serveWin: 0, rec: 0, recErr: 0, attack: 0, attackErr: 0, attackWin: 0, block: 0, blockWin: 0, won: 0, lost: 0 })

export function pointErrorReport(list: ReportMatch[], totalLabel = 'TOTAL'): PointErrorReport {
  const team: PointErrorRow[] = [], opponents: PointErrorRow[] = []
  for (const m of list) {
    const r = matchReport(m.d), i = m.side === '*' ? 0 : 1
    const won = m.d.rallies.filter(x => x.wonBy === m.side).length
    const lost = m.d.rallies.filter(x => x.wonBy !== null && x.wonBy !== m.side).length
    for (const [k, out] of [[i, team], [1 - i, opponents]] as const) {
      const t = r.teams[k].total, mine = k === i
      out.push({
        label: m.label,
        serve: t.serve.tot, serveErr: t.serve.err, serveWin: t.serve.pts,
        rec: t.rec.tot, recErr: t.rec.err,
        attack: t.att.tot, attackErr: t.att.err, attackWin: t.att.pts,
        block: m.d.plays.filter(p => p.skill === 'B' && p.side === r.teams[k].side).length, blockWin: t.blk,
        won: mine ? won : lost, lost: mine ? lost : won,
      })
    }
  }
  const sum = (rows: PointErrorRow[]): PointErrorSide => {
    const total: PointErrorRow = { ...zero(), label: totalLabel }
    for (const r of rows) for (const k of Object.keys(zero()) as (keyof PointErrorCounts)[]) total[k] += r[k]
    return { rows, total }
  }
  return { team: sum(team), opponents: sum(opponents) }
}

// The derived columns. Errors: serve + reception + attack attempts against their errors.
// Points: serves + block touches + attack attempts against aces, block and attack kills.
export const errorTries = (c: PointErrorCounts) => c.serve + c.rec + c.attack
export const errors = (c: PointErrorCounts) => c.serveErr + c.recErr + c.attackErr
export const pointTries = (c: PointErrorCounts) => c.serve + c.block + c.attack
export const points = (c: PointErrorCounts) => c.serveWin + c.blockWin + c.attackWin

// n of `of` as a percent: whole (12%) or to one place (8.9); '' when there is nothing to share.
export const percent = (n: number, of: number, places = 0) => (of ? `${((n / of) * 100).toFixed(places)}${places ? '' : '%'}` : '')

// ---- what the reports below share -------------------------------------------------------------
// Each rally played to a point: who served, who won, both teams' rotations, each team's reception
// and its first attack in the reception phase (the attack the reception was set for).
interface RallyFact { set: number; server: Side | null; wonBy: Side; rot: Record<Side, number | null>; rec: Partial<Record<Side, Play>>; first: Partial<Record<Side, Play>> }
function rallyFacts(d: ParsedDVW): RallyFact[] {
  const by = new Map<number, Play[]>()
  for (const p of d.plays) if (p.rallyId !== null) by.set(p.rallyId, [...(by.get(p.rallyId) ?? []), p])
  return d.rallies.flatMap((r): RallyFact[] => {
    if (!r.wonBy) return []
    const ps = by.get(r.id) ?? [], rec: RallyFact['rec'] = {}, first: RallyFact['first'] = {}
    for (const p of ps) {
      if (p.skill === 'R' && !rec[p.side]) rec[p.side] = p
      if (p.skill === 'A' && p.phase === 'r' && !first[p.side]) first[p.side] = p
    }
    return [{ set: r.setNum, server: ps.find(p => p.skill === 'S')?.side ?? null, wonBy: r.wonBy, rot: { '*': ps[0]?.homeRot ?? null, a: ps[0]?.awayRot ?? null }, rec, first }]
  })
}
const other = (s: Side): Side => (s === '*' ? 'a' : '*')

// Adds b's numbers into a, through nested objects (arrays of numbers too).
function addInto<T>(a: T, b: T): T {
  for (const k of Object.keys(b as object) as (keyof T)[]) {
    const v = b[k] as unknown
    if (typeof v === 'number') (a[k] as unknown as number) += v
    else if (v && typeof v === 'object') addInto(a[k], v as T[keyof T])
  }
  return a
}

// Reception evaluations as DataVolley codes them: # perfect, + positive, ! fair, - poor, / overpass, = error.
export const GRADES = ['#', '+', '!', '-', '/', '='] as const
export type Grade = typeof GRADES[number]
const isGrade = (e: string): e is Grade => (GRADES as readonly string[]).includes(e)
const byGrade = <T,>(make: () => T) => Object.fromEntries(GRADES.map(g => [g, make()])) as Record<Grade, T>

// An attack's outcome: attempts, kills (#), errors (=), blocked (/).
export interface AttackCount { att: number; kill: number; err: number; blo: number }
const attackZero = (): AttackCount => ({ att: 0, kill: 0, err: 0, blo: 0 })
function addAttack(c: AttackCount, p: Play): void { c.att++; if (p.effect === '#') c.kill++; if (p.effect === '=') c.err++; if (p.effect === '/') c.blo++ }
// Efficiency: kills minus errors and blocked, of the attempts.
export const efficiency = (c: AttackCount) => percent(c.kill - c.err - c.blo, c.att)

type Labeled<C> = C & { label: string }
export interface Sides<R> { team: { rows: R[]; total: R }; opponents: { rows: R[]; total: R } }
// One row per match for the team and its opponents, and a total of each.
function perMatch<C extends object>(list: ReportMatch[], zeroOf: () => C, count: (facts: RallyFact[], side: Side) => C, totalLabel: string): Sides<Labeled<C>> {
  const team: Labeled<C>[] = [], opponents: Labeled<C>[] = []
  for (const m of list) {
    const facts = rallyFacts(m.d)
    team.push({ ...count(facts, m.side), label: m.label })
    opponents.push({ ...count(facts, other(m.side)), label: m.label })
  }
  const sum = (rows: Labeled<C>[]) => {
    const total = { ...zeroOf(), label: totalLabel } as Labeled<C>
    for (const r of rows) { const { label: _l, ...nums } = r; addInto(total as object, nums as object) }
    return { rows, total }
  }
  return { team: sum(team), opponents: sum(opponents) }
}

// ---- side-out and break point -------------------------------------------------------------------
// Side-out: rallies won on the other team's serve (its serve errors too); break point: rallies won
// on the team's own serve. From reception: the rallies the team received, won, and won with the kill
// of its first attack (first-ball side-out); and the side-out after each reception evaluation.
export interface SideOutCounts {
  oppServe: number; soWon: number
  rec: number; recWon: number; firstKill: number
  serve: number; bpWon: number
  grades: Record<Grade, { n: number; won: number }>
}
export type SideOutRow = Labeled<SideOutCounts>
const sideOutZero = (): SideOutCounts => ({ oppServe: 0, soWon: 0, rec: 0, recWon: 0, firstKill: 0, serve: 0, bpWon: 0, grades: byGrade(() => ({ n: 0, won: 0 })) })

export function sideOutReport(list: ReportMatch[], totalLabel = 'TOTAL'): Sides<SideOutRow> {
  return perMatch(list, sideOutZero, (facts, s) => {
    const c = sideOutZero()
    for (const f of facts) {
      const won = f.wonBy === s
      if (f.server === s) { c.serve++; if (won) c.bpWon++ }
      if (f.server !== other(s)) continue
      c.oppServe++; if (won) c.soWon++
      const r = f.rec[s]
      if (!r) continue
      c.rec++; if (won) c.recWon++
      if (f.first[s]?.effect === '#') c.firstKill++
      if (isGrade(r.effect)) { c.grades[r.effect].n++; if (won) c.grades[r.effect].won++ }
    }
    return c
  }, totalLabel)
}

// ---- reception and the attack after it ----------------------------------------------------------
// For each reception evaluation: receptions, side-outs and the first attack after it, for the team
// and its opponents over all the matches. Then the team's players: each receiver's receptions by
// evaluation and the side-out after them; each attacker's first attacks after each evaluation.
export interface RecGradeLine { n: number; won: number; attack: AttackCount }
export interface ReceiverLine { key: string; name: string; n: number; won: number; grades: Record<Grade, number> }
export interface AttackerLine { key: string; name: string; all: AttackCount; grades: Record<Grade, AttackCount> }
export interface RecAttackReport { team: Record<Grade, RecGradeLine>; opponents: Record<Grade, RecGradeLine>; receivers: ReceiverLine[]; attackers: AttackerLine[] }

const playerName = (d: ParsedDVW, p: Play) => { const x = d.players[`${p.side}${p.jersey}`]; return x ? `${p.jersey} ${[x.lastName, x.firstName].filter(Boolean).join(' ')}` : `#${p.jersey}` }

export function recAttackReport(list: ReportMatch[]): RecAttackReport {
  const grades = () => byGrade((): RecGradeLine => ({ n: 0, won: 0, attack: attackZero() }))
  const out: RecAttackReport = { team: grades(), opponents: grades(), receivers: [], attackers: [] }
  const receivers = new Map<string, ReceiverLine>(), attackers = new Map<string, AttackerLine>()
  for (const m of list) {
    for (const f of rallyFacts(m.d)) {
      for (const s of [m.side, other(m.side)]) {
        const r = f.rec[s]
        if (!r || f.server !== other(s) || !isGrade(r.effect)) continue
        const won = f.wonBy === s, line = (s === m.side ? out.team : out.opponents)[r.effect], a = f.first[s]
        line.n++; if (won) line.won++
        if (a) addAttack(line.attack, a)
        if (s !== m.side) continue
        const rl = receivers.get(r.playerKey) ?? { key: r.playerKey, name: playerName(m.d, r), n: 0, won: 0, grades: byGrade(() => 0) }
        rl.n++; if (won) rl.won++; rl.grades[r.effect]++
        receivers.set(r.playerKey, rl)
        if (!a) continue
        const al = attackers.get(a.playerKey) ?? { key: a.playerKey, name: playerName(m.d, a), all: attackZero(), grades: byGrade(attackZero) }
        addAttack(al.all, a); addAttack(al.grades[r.effect], a)
        attackers.set(a.playerKey, al)
      }
    }
  }
  out.receivers = [...receivers.values()].sort((a, b) => b.n - a.n)
  out.attackers = [...attackers.values()].sort((a, b) => b.all.att - a.all.att)
  return out
}

// ---- runs ---------------------------------------------------------------------------------------
// Runs: RUN_MIN or more points in a row by one team within a set. For each match the team's runs and
// the opponents' (how many, the longest, the points in them, how many of 2, 3, 4 and 5 or more), and
// the same by the team's rotation at the run's last rally (a run of the team's own: the rotation it
// served in; the opponents': the one it could not side out of).
export const RUN_MIN = 2
export const RUN_TOP = 5 // runs of this many points or more go together
export interface RunCounts { runs: number; longest: number; points: number; by: number[] } // by: runs of RUN_MIN, …, RUN_TOP+
export interface RunRow { label: string; for: RunCounts; against: RunCounts }
export interface RunRotation { rot: number; for: RunCounts; against: RunCounts }
export interface RunReport { rows: RunRow[]; total: RunRow; rotations: RunRotation[] }
const runZero = (): RunCounts => ({ runs: 0, longest: 0, points: 0, by: Array<number>(RUN_TOP - RUN_MIN + 1).fill(0) })
const addRun = (c: RunCounts, n: number) => { c.runs++; c.points += n; c.longest = Math.max(c.longest, n); c.by[Math.min(n, RUN_TOP) - RUN_MIN]++ }

export function runReport(list: ReportMatch[], totalLabel = 'TOTAL'): RunReport {
  const rotations: RunRotation[] = [1, 2, 3, 4, 5, 6].map(rot => ({ rot, for: runZero(), against: runZero() }))
  const rows = list.map((m): RunRow => {
    const row: RunRow = { label: m.label, for: runZero(), against: runZero() }
    const facts = rallyFacts(m.d)
    let start = 0
    for (let i = 1; i <= facts.length; i++) {
      if (i < facts.length && facts[i].wonBy === facts[start].wonBy && facts[i].set === facts[start].set) continue
      const n = i - start, last = facts[i - 1]
      start = i
      if (n < RUN_MIN) continue
      const k = last.wonBy === m.side ? 'for' : 'against'
      addRun(row[k], n)
      const r = rotations.find(x => x.rot === last.rot[m.side])
      if (r) addRun(r[k], n)
    }
    return row
  })
  const total: RunRow = { label: totalLabel, for: runZero(), against: runZero() }
  for (const r of rows) for (const k of ['for', 'against'] as const) {
    const longest = Math.max(total[k].longest, r[k].longest)
    addInto(total[k], r[k]); total[k].longest = longest
  }
  return { rows, total, rotations }
}
