import { useMemo } from 'react'
import { percent } from '../shared/analysis'
import type { ReportMatch } from '../shared/report'
import { t } from '../shared/i18n'
import { errorTries, errors, pointErrorReport, pointTries, points, type PointErrorRow, type PointErrorSide } from './pointError'

// The 分析 window's 得点率・ミス率 tab (internal edition only): the team's and the opponents' error and
// point rates, a row per match.
export function PointError({ list, team }: { list: ReportMatch[]; team: string }) {
  const r = useMemo(() => pointErrorReport(list), [list])
  const them = t('相手')
  return (
    <>
      <ErrorTable title={t('ミス率 — {0}', team)} side={r.team} team={team} them={them} />
      <PointTable title={t('得点率 — {0}', team)} side={r.team} team={team} them={them} />
      <ErrorTable title={t('ミス率 — 相手チーム')} side={r.opponents} team={team} them={them} opp />
      <PointTable title={t('得点率 — 相手チーム')} side={r.opponents} team={team} them={them} opp />
      <p className="hint">{t('= をミス、# を得点として DVW から数えます。A Err は = だけ（ブロックされたアタック / は入りません）。Block はブロックのタッチ数（DVW の B の総数）です。右端の 2 列は各試合で取ったラリーの数（相手のミスによる得点も含む）')}</p>
    </>
  )
}

// opp: the opponents' table; its last two columns stay the team's points, then the opponents'.
type TableProps = { title: string; side: PointErrorSide; team: string; them: string; opp?: boolean }
const scored = (r: PointErrorRow, opp?: boolean) => (opp ? [r.lost, r.won] : [r.won, r.lost])

function ErrorTable({ title, side, team, them, opp }: TableProps) {
  const row = (r: PointErrorRow, total = false) => {
    const [a, b] = scored(r, opp)
    return (
      <tr key={r.label} className={total ? 'total' : ''}>
        <th title={r.label}>{r.label}</th>
        <td>{r.serve}</td><td>{r.serveErr}</td><td className="pct">{percent(r.serveErr, r.serve)}</td>
        <td>{r.rec}</td><td>{r.recErr}</td><td className="pct">{percent(r.recErr, r.rec)}</td>
        <td>{r.attack}</td><td>{r.attackErr}</td><td className="pct">{percent(r.attackErr, r.attack)}</td>
        <td className="sum">{errorTries(r)}</td><td className="sum">{errors(r)}</td>
        <td className="key">{percent(errors(r), errorTries(r), 1)}</td>
        <td className="side">{a}</td><td className="side">{b}</td>
      </tr>
    )
  }
  return (
    <table className="analysis-table">
      <caption>{title}</caption>
      <thead><tr><th />{['Serve', 'S Err', 'S Err%', 'Rec', 'R Err', 'R Err%', 'Attack', 'A Err', 'A Err%'].map(h => <th key={h}>{h}</th>)}
        <th className="sum">S+R+A</th><th className="sum">Error</th><th className="key">Error%</th><th className="side">{team}</th><th className="side">{them}</th></tr></thead>
      <tbody>{side.rows.map(r => row(r))}{row(side.total, true)}</tbody>
    </table>
  )
}

function PointTable({ title, side, team, them, opp }: TableProps) {
  const row = (r: PointErrorRow, total = false) => {
    const [a, b] = scored(r, opp)
    return (
      <tr key={r.label} className={total ? 'total' : ''}>
        <th title={r.label}>{r.label}</th>
        <td>{r.serve}</td><td>{r.serveWin}</td><td className="pct">{percent(r.serveWin, r.serve)}</td>
        <td>{r.block}</td><td>{r.blockWin}</td><td className="pct">{percent(r.blockWin, r.block)}</td>
        <td>{r.attack}</td><td>{r.attackWin}</td><td className="pct">{percent(r.attackWin, r.attack)}</td>
        <td className="sum">{pointTries(r)}</td><td className="sum">{points(r)}</td>
        <td className="key">{percent(points(r), pointTries(r), 1)}</td>
        <td className="side">{a}</td><td className="side">{b}</td>
      </tr>
    )
  }
  return (
    <table className="analysis-table">
      <caption>{title}</caption>
      <thead><tr><th /><th>Serve</th><th>S#</th><th>S#%</th><th title={t('ブロックのタッチ数（DVW の B の総数）')}>Block</th><th>B#</th><th>B#%</th><th>Attack</th><th>A#</th><th>A#%</th>
        <th className="sum">S+B+A</th><th className="sum">Point</th><th className="key">Point%</th><th className="side">{team}</th><th className="side">{them}</th></tr></thead>
      <tbody>{side.rows.map(r => row(r))}{row(side.total, true)}</tbody>
    </table>
  )
}
