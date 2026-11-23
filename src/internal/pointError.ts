// 得点率・ミス率, a report of the 分析 window (internal edition only: shared/analysis.ts ANALYSIS_REPORTS).
// Pure: PointErrorReport.tsx draws it.
import { matchReport, type ReportMatch } from '../shared/report'

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
