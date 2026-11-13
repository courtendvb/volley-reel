import { useMemo, useState } from 'react'
import { ANALYSIS_REPORTS, efficiency, errors, errorTries, GRADES, percent, pointErrorReport, points, pointTries, recAttackReport, RUN_MIN, RUN_TOP, runReport, sideOutReport, type AnalysisReportId, type AttackCount, type Grade, type PointErrorRow, type PointErrorSide, type RecGradeLine, type RunCounts, type RunRow, type SideOutRow } from '../../../shared/analysis'
import type { ReportMatch } from '../../../shared/report'
import type { Match, ParsedDVW } from '../../../shared/types'
import { t } from '../../../shared/i18n'

// 分析: reports on what the target team (設定の対象チーム) is really like over the project's
// matches. A tab per report (ANALYSIS_REPORTS); the numbers come from shared/analysis.ts.
const TITLES: Record<AnalysisReportId, string> = { pointError: '得点率・ミス率', sideOut: 'サイドアウト・ブレイク', recAttack: 'レセプションと攻撃', runs: '連続得点・連続失点' }

export function AnalysisDialog({ matches, dvws, ourCodes, onClose }: {
  matches: Match[]; dvws: Record<string, ParsedDVW>; onClose: () => void
  ourCodes: string[] // the target team's codes
}) {
  const [report, setReport] = useState<AnalysisReportId>('pointError')
  // The target team's side in each match it played, the opponent's name for the row.
  const ours = useMemo(() => {
    const codes = ourCodes.map(c => c.toUpperCase())
    return matches.flatMap((m): ReportMatch[] => {
      const d = dvws[m.id], i = d ? d.teams.findIndex(x => codes.includes(x.code.toUpperCase())) : -1
      return d && i >= 0 ? [{ d, side: i === 0 ? '*' : 'a', label: `${d.date ?? ''} vs ${d.teams[1 - i].name || d.teams[1 - i].code}`.trim() }] : []
    }).sort((a, b) => (a.d.date ?? '').localeCompare(b.d.date ?? ''))
  }, [matches, dvws, ourCodes])
  const team = ourCodes[0] ?? ''
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal report-dialog analysis-dialog" role="dialog" aria-label={t('分析')} onClick={e => e.stopPropagation()}>
        <div className="report-bar">
          <h2>{t('分析')}</h2>
          <div className="analysis-tabs" role="tablist">
            {ANALYSIS_REPORTS.map(id => <button key={id} role="tab" aria-selected={id === report} className={id === report ? 'active' : ''} onClick={() => setReport(id)}>{t(TITLES[id])}</button>)}
          </div>
          <span className="spacer" />
          <button onClick={onClose}>{t('閉じる')}</button>
        </div>
        <div className="analysis-body">
          {!team ? <p className="muted">{t('設定で対象チームを決めると分析できます')}</p>
            : !ours.length ? <p className="muted">{t('{0} の試合の DVW がありません', team)}</p>
            : report === 'pointError' ? <PointError list={ours} team={team} />
            : report === 'sideOut' ? <SideOut list={ours} team={team} />
            : report === 'recAttack' ? <RecAttack list={ours} team={team} />
            : <Runs list={ours} team={team} />}
        </div>
      </div>
    </div>
  )
}

function PointError({ list, team }: { list: ReportMatch[]; team: string }) {
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

// ---- a table of any report ---------------------------------------------------------------------
// cls: the column's look (pct green, sum grey, key red on blue, side purple); groups: a header row
// above the columns, each spanning some of them.
type Cell = string | number
interface Col { head: string; cls?: string; title?: string }
interface Line { label: string; cells: Cell[]; title?: string }
function Table({ caption, groups, cols, rows, total, rowHead = '' }: { caption: string; groups?: { head: string; span: number }[]; cols: Col[]; rows: Line[]; total?: Line; rowHead?: string }) {
  const line = (r: Line, isTotal = false) => (
    <tr key={r.label} className={isTotal ? 'total' : ''}>
      <th title={r.title ?? r.label}>{r.label}</th>
      {r.cells.map((c, i) => <td key={i} className={cols[i]?.cls}>{c}</td>)}
    </tr>
  )
  return (
    <table className="analysis-table">
      <caption>{caption}</caption>
      <thead>
        {groups && <tr><th />{groups.map((g, i) => <th key={i} colSpan={g.span} className="group">{g.head}</th>)}</tr>}
        <tr><th>{rowHead}</th>{cols.map((c, i) => <th key={i} className={c.cls} title={c.title}>{c.head}</th>)}</tr>
      </thead>
      <tbody>{rows.map(r => line(r))}{total && line(total, true)}</tbody>
    </table>
  )
}

// The evaluations a reception-phase attack can follow (an overpass or an error leaves none).
const ATTACK_GRADES: Grade[] = ['#', '+', '!', '-']

// ---- side-out and break point -------------------------------------------------------------------
function SideOut({ list, team }: { list: ReportMatch[]; team: string }) {
  const r = useMemo(() => sideOutReport(list), [list])
  const cols: Col[] = [
    { head: t('相手サーブ') }, { head: t('SO 得点') }, { head: 'SO%', cls: 'key' },
    { head: t('レセプション') }, { head: t('うち SO') }, { head: t('レセプション SO%'), cls: 'pct' },
    { head: t('1 本目で得点') }, { head: t('1 本目 SO%'), cls: 'pct', title: t('レセプションからの最初の攻撃で決めた割合') },
    { head: t('サーブ') }, { head: t('BP 得点') }, { head: 'BP%', cls: 'key' },
  ]
  const main = (x: SideOutRow): Line => ({ label: x.label, cells: [x.oppServe, x.soWon, percent(x.soWon, x.oppServe), x.rec, x.recWon, percent(x.recWon, x.rec), x.firstKill, percent(x.firstKill, x.rec), x.serve, x.bpWon, percent(x.bpWon, x.serve)] })
  const gradeCols: Col[] = GRADES.flatMap(g => [{ head: t('本数') }, { head: 'SO%', cls: 'pct' }])
  const grades = (x: SideOutRow): Line => ({ label: x.label, cells: GRADES.flatMap(g => [x.grades[g].n, percent(x.grades[g].won, x.grades[g].n)]) })
  const groups = GRADES.map(g => ({ head: g, span: 2 }))
  const sides = [[team, r.team], [t('相手チーム'), r.opponents]] as const
  return (
    <>
      {sides.map(([who, s]) => (
        <div key={who} className="analysis-pair">
          <Table caption={t('サイドアウト・ブレイク — {0}', who)} cols={cols} rows={s.rows.map(main)} total={main(s.total)} />
          <Table caption={t('レセプション評価別のサイドアウト — {0}', who)} groups={groups} cols={gradeCols} rows={s.rows.map(grades)} total={grades(s.total)} />
        </div>
      ))}
      <p className="hint">{t('SO%: 相手のサーブで取ったラリーの割合（相手のサーブミスを含む）。レセプション SO%: レセプションしたラリーのうち取った割合。1 本目 SO%: レセプションからの最初の攻撃で決めた割合。BP%: 自分のサーブで取ったラリーの割合')}</p>
    </>
  )
}

// ---- reception and the attack after it ----------------------------------------------------------
const attackCells = (a: AttackCount): Cell[] => [a.att, a.kill, a.err, a.blo, percent(a.kill, a.att), efficiency(a)]
function RecAttack({ list, team }: { list: ReportMatch[]; team: string }) {
  const r = useMemo(() => recAttackReport(list), [list])
  const cols: Col[] = [
    { head: t('本数') }, { head: t('割合'), cls: 'pct' }, { head: 'SO%', cls: 'key' },
    { head: t('打数') }, { head: t('決定') }, { head: t('ミス') }, { head: t('被ブロック') }, { head: t('決定率'), cls: 'pct' }, { head: t('効果率'), cls: 'key', title: t('（決定 − ミス − 被ブロック）÷ 打数') },
  ]
  const byGrade = (lines: Record<Grade, RecGradeLine>) => {
    const sum: RecGradeLine = { n: 0, won: 0, attack: { att: 0, kill: 0, err: 0, blo: 0 } }
    for (const g of GRADES) { sum.n += lines[g].n; sum.won += lines[g].won; for (const k of ['att', 'kill', 'err', 'blo'] as const) sum.attack[k] += lines[g].attack[k] }
    const line = (label: string, x: RecGradeLine): Line => ({ label, cells: [x.n, percent(x.n, sum.n), percent(x.won, x.n), ...attackCells(x.attack)] })
    return { rows: GRADES.map(g => line(g, lines[g])), total: line('TOTAL', sum) }
  }
  const recCols: Col[] = [{ head: t('本数') }, ...GRADES.map(g => ({ head: g })), { head: '#+%', cls: 'pct', title: t('# と + の割合') }, { head: 'SO%', cls: 'key' }]
  const groups = [...ATTACK_GRADES.map(g => ({ head: g, span: 3 })), { head: t('合計'), span: 3 }]
  const atkCols: Col[] = groups.flatMap(() => [{ head: t('打数') }, { head: t('決定率'), cls: 'pct' }, { head: t('効果率'), cls: 'key' }])
  const three = (a: AttackCount): Cell[] => [a.att, percent(a.kill, a.att), efficiency(a)]
  const sides = [[team, r.team], [t('相手チーム'), r.opponents]] as const
  return (
    <>
      <div className="analysis-pair">
        {sides.map(([who, lines]) => <Table key={who} caption={t('レセプション評価別の攻撃 — {0}', who)} rowHead={t('レセプション')} cols={cols} {...byGrade(lines)} />)}
      </div>
      <Table caption={t('レシーバー別 — {0}', team)} cols={recCols}
        rows={r.receivers.map(x => ({ label: x.name, cells: [x.n, ...GRADES.map(g => x.grades[g]), percent(x.grades['#'] + x.grades['+'], x.n), percent(x.won, x.n)] }))} />
      <Table caption={t('アタッカー別（レセプションからの最初の攻撃）— {0}', team)} groups={groups} cols={atkCols}
        rows={r.attackers.map(x => ({ label: x.name, cells: [...ATTACK_GRADES.flatMap(g => three(x.grades[g])), ...three(x.all)] }))} />
      <p className="hint">{t('攻撃は、レセプションのあと自チームが最初に打ったアタック（ツーアタックを含む）。効果率は（決定 − ミス − 被ブロック）÷ 打数。SO% は相手のサーブをレセプションしたラリーのうち取った割合。選手の表は対象チームだけ（全試合の合計）。アタッカー別はレセプションの評価ごと（/ と = のあとはレセプションからの攻撃がない）')}</p>
    </>
  )
}

// ---- runs ---------------------------------------------------------------------------------------
function Runs({ list, team }: { list: ReportMatch[]; team: string }) {
  const r = useMemo(() => runReport(list), [list])
  const part = (c: RunCounts): Cell[] => [c.runs, c.longest || '', c.points, ...c.by]
  const sizes = Array.from({ length: RUN_TOP - RUN_MIN + 1 }, (_, i) => RUN_MIN + i)
  const half: Col[] = [{ head: t('回数'), cls: 'key' }, { head: t('最長') }, { head: t('点数'), cls: 'sum' }, ...sizes.map(n => ({ head: n === RUN_TOP ? t('{0} 点以上', n) : t('{0} 点', n) }))]
  const line = (x: RunRow): Line => ({ label: x.label, cells: [...part(x.for), ...part(x.against)] })
  const pair = [{ head: t('連続得点'), span: half.length }, { head: t('連続失点'), span: half.length }]
  return (
    <>
      <Table caption={t('{0} 点以上の連続得点・連続失点 — {1}', RUN_MIN, team)} groups={pair} cols={[...half, ...half]} rows={r.rows.map(line)} total={line(r.total)} />
      <Table caption={t('ローテーション別 — {0}', team)} rowHead={t('ローテ')} groups={pair} cols={[...half, ...half]}
        rows={r.rotations.map(x => ({ label: String(x.rot), title: t('ローテーション {0}（DVW の番号）', x.rot), cells: [...part(x.for), ...part(x.against)] }))} />
      <p className="hint">{t('同じセットの中で、どちらかのチームが {0} 点以上続けて取ったものを数えます。ローテーションは、その連続の最後のラリーでの対象チームのローテーション（連続得点ならサーブを打っていたローテ、連続失点ならサイドアウトできなかったローテ）', RUN_MIN)}</p>
    </>
  )
}
