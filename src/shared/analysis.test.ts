import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { efficiency, errorTries, errors, percent, pointErrorReport, points, pointTries, recAttackReport, rotationReport, runReport, sideOutReport } from './analysis'

// Five rallies: a home serve received and killed by the away team; an away serve error; a home ace;
// a reception error (=) by the away team; an away attack error; an away attack blocked by the home team.
const DVW = `[3MATCH]
01/11/2026;11.00.43;;2026/27;;;;;1250;1;Z;;;;;
[3TEAMS]
HTH;HOME;1;;;;;;;
OPP;AWAY;0;;;;;;;
[3PLAYERS-H]
0;1;1;5;;;;;H-ONE;ONE;Home;;;2;False;
0;2;2;*;;;;;H-TWO;TWO;Home;;L;1;False;
[3PLAYERS-V]
1;9;3;1;;;;;A-NINE;NINE;Away;;;4;False;
[3SCOUT]
*01SQ-~~~16A;;;;;;;;1;1;1;1;100;;
a09RQ+~~~16AR;;;;;;;;1;1;1;1;102;;
a09AQ#PA~36BH1;;;;;;;;1;1;1;1;104;;
ap00:01;;;;;;;;1;1;1;1;114;;
a09SQ=~~~15B;;;;;;;;1;1;2;1;130;;
*p01:01;;;;;;;;1;1;2;1;140;;
*02SM#~~~16D;;;;;;;;1;1;2;1;150;;
*p02:01;;;;;;;;1;1;2;1;160;;
*02SQ+~~~16D;;;;;;;;1;1;2;1;170;;
a09RQ=~~~16D;;;;;;;;1;1;2;1;172;;
*p03:01;;;;;;;;1;1;2;1;174;;
*02SQ+~~~16D;;;;;;;;1;1;2;1;180;;
a09RQ#~~~16D;;;;;;;;1;1;2;1;182;;
a09AQ=PA~36BH1;;;;;;;;1;1;2;1;184;;
*p04:01;;;;;;;;1;1;2;1;186;;
*02SQ+~~~16D;;;;;;;;1;1;2;1;190;;
a09RQ#~~~16D;;;;;;;;1;1;2;1;192;;
a09AQ/PA~36BH1;;;;;;;;1;1;2;1;194;;
*01BQ#~~~16D;;;;;;;;1;1;2;1;195;;
*p05:01;;;;;;;;1;1;2;1;196;;
`

describe('the point % and error % report', () => {
  const d = parseDVW(DVW)
  it('counts each match for the team and for its opponents, with a total', () => {
    const r = pointErrorReport([{ d, side: '*', label: 'vs AWAY' }, { d, side: 'a', label: 'vs HOME' }])
    expect(r.team.rows[0]).toEqual({ label: 'vs AWAY', serve: 5, serveErr: 0, serveWin: 1, rec: 0, recErr: 0, attack: 0, attackErr: 0, attackWin: 0, block: 1, blockWin: 1, won: 5, lost: 1 })
    // The away team: one serve error, four receptions (one =), three attacks (one =, one blocked: not an error), a kill.
    expect(r.opponents.rows[0]).toEqual({ label: 'vs AWAY', serve: 1, serveErr: 1, serveWin: 0, rec: 4, recErr: 1, attack: 3, attackErr: 1, attackWin: 1, block: 0, blockWin: 0, won: 1, lost: 5 })
    // In the second match the team is the away side: the rows swap.
    expect(r.team.rows[1]).toEqual({ ...r.opponents.rows[0], label: 'vs HOME' })
    expect(r.opponents.rows[1]).toEqual({ ...r.team.rows[0], label: 'vs HOME' })
    expect(r.team.total).toMatchObject({ label: 'TOTAL', serve: 6, serveErr: 1, rec: 4, recErr: 1, attack: 3, attackErr: 1, attackWin: 1, block: 1, blockWin: 1, serveWin: 1, won: 6, lost: 6 })
  })
  it('works out the sums and percentages from the counts', () => {
    const away = pointErrorReport([{ d, side: 'a', label: 'x' }]).team.total
    expect([errorTries(away), errors(away), percent(errors(away), errorTries(away), 1)]).toEqual([8, 3, '37.5'])
    // Points: 1 serve + 0 block touches + 3 attacks.
    expect([pointTries(away), points(away), percent(points(away), pointTries(away), 1)]).toEqual([4, 1, '25.0'])
    const home = pointErrorReport([{ d, side: '*', label: 'x' }]).team.total
    expect([pointTries(home), points(home), percent(home.blockWin, home.block)]).toEqual([6, 2, '100%']) // 5 serves + 1 block touch
    expect([percent(1, 3), percent(0, 0), percent(3, 148)]).toEqual(['33%', '', '2%'])
  })
  it('is empty without matches', () => {
    expect(pointErrorReport([]).team).toEqual({ rows: [], total: expect.objectContaining({ serve: 0, won: 0 }) })
  })
})

// A DVW made of rallies: each is its contact codes (the serve first), who won it and the home and
// away rotations; '**1set' between sets.
type R = { codes: string[]; won: '*' | 'a'; rot?: [number, number] } | 'set'
function dvwOf(rallies: R[]): string {
  let h = 0, a = 0, t = 100, set = 0
  const lines: string[] = []
  for (const r of rallies) {
    if (r === 'set') { lines.push(`**${++set}set;;;;;;;;;;;;${t++};;`); h = a = 0; continue }
    const [rh, ra] = r.rot ?? [1, 1]
    for (const c of r.codes) lines.push(`${c};;;;;;;;1;${rh};${ra};1;${t++};;`)
    if (r.won === '*') h++; else a++
    lines.push(`${r.won}p${String(h).padStart(2, '0')}:${String(a).padStart(2, '0')};;;;;;;;1;${rh};${ra};1;${t++};;`)
  }
  return `[3MATCH]
01/11/2026;11.00.43;;;;;;;;;;;;;;
[3TEAMS]
HTH;HOME;1;;;;;;;
OPP;AWAY;0;;;;;;;
[3PLAYERS-H]
0;1;1;5;;;;;H-ONE;ONE;Home;;;2;False;
0;5;5;1;;;;;H-FIVE;FIVE;Home;;;2;False;
[3PLAYERS-V]
1;9;3;1;;;;;A-NINE;NINE;Away;;;4;False;
[3SCOUT]
${lines.join('\n')}
`
}

describe('the side-out and break point report', () => {
  const d = parseDVW(dvwOf([
    { codes: ['a09SQ+', '*01RQ#', '*05AQ#'], won: '*' }, // a first-ball side-out from a perfect reception
    { codes: ['a09SQ+', '*01RQ-', '*05AQ-', 'a09DQ+', 'a09AQ#'], won: 'a' }, // poor reception, lost
    { codes: ['a09SQ='], won: '*' }, // a serve error: a side-out without a reception
    { codes: ['*05SQ-', 'a09RQ!', 'a09AQ=' ], won: '*' }, // a break point
    { codes: ['*05SQ+', 'a09RQ+', 'a09AQ-', '*01DQ+', '*05AQ=', 'a09DQ+', 'a09AQ#'], won: 'a' }, // the away team sides out, not first ball
  ]))
  const r = sideOutReport([{ d, side: '*', label: 'm' }])
  it('counts side-outs on the other serve, from reception, first ball and by evaluation', () => {
    expect(r.team.rows[0]).toMatchObject({ oppServe: 3, soWon: 2, rec: 2, recWon: 1, firstKill: 1, serve: 2, bpWon: 1 })
    expect(r.team.rows[0].grades).toMatchObject({ '#': { n: 1, won: 1 }, '-': { n: 1, won: 0 } })
    expect(r.opponents.rows[0]).toMatchObject({ oppServe: 2, soWon: 1, rec: 2, recWon: 1, firstKill: 0, serve: 3, bpWon: 1 })
    expect(r.opponents.rows[0].grades).toMatchObject({ '!': { n: 1, won: 0 }, '+': { n: 1, won: 1 } })
    expect(r.team.total).toMatchObject({ label: 'TOTAL', oppServe: 3, soWon: 2, grades: { '#': { n: 1, won: 1 } } })
  })
  it('splits receptions and the attack after them, for the team and its players', () => {
    const x = recAttackReport([{ d, side: '*', label: 'm' }, { d, side: '*', label: 'm2' }])
    expect(x.team['#']).toEqual({ n: 2, won: 2, attack: { att: 2, kill: 2, err: 0, blo: 0 } })
    expect(x.team['-']).toEqual({ n: 2, won: 0, attack: { att: 2, kill: 0, err: 0, blo: 0 } })
    expect(x.opponents['!'].attack).toEqual({ att: 2, kill: 0, err: 2, blo: 0 })
    expect(x.receivers).toEqual([{ key: 'H-ONE', name: '1 ONE Home', n: 4, won: 2, grades: { '#': 2, '+': 0, '!': 0, '-': 2, '/': 0, '=': 0 } }])
    expect(x.attackers.map(a => [a.name, a.all.att, a.grades['#'].kill, a.grades['-'].att, a.grades['!'].att])).toEqual([['5 FIVE Home', 4, 2, 2, 0]])
    expect(efficiency(x.opponents['!'].attack)).toBe('-100%')
  })
})

describe('the runs report', () => {
  const w = (won: '*' | 'a', rot: [number, number] = [1, 1]): R => ({ codes: [won === '*' ? '*05SQ-' : 'a09SQ-'], won, rot })
  // Set 1: home 3 in a row (rotation 2 at the end), away 2, home 3; set 2: home 1, then away 5 in a
  // row (the home team in rotation 4 at the end). A run does not go over a set.
  const d = parseDVW(dvwOf([w('*'), w('*'), w('*', [2, 1]), w('a'), w('a'), w('*'), w('*'), w('*'), 'set',
    w('*'), w('a'), w('a'), w('a'), w('a'), w('a', [4, 1])]))
  it('finds each team\'s runs of two or more within a set, per match and by rotation', () => {
    const r = runReport([{ d, side: '*', label: 'm' }, { d, side: 'a', label: 'swap' }])
    // Set 1 ends on a home run of 3; set 2 starts with a single home point, so the runs do not join.
    expect(r.rows[0]).toEqual({ label: 'm', for: { runs: 2, longest: 3, points: 6, by: [0, 2, 0, 0] }, against: { runs: 2, longest: 5, points: 7, by: [1, 0, 0, 1] } })
    expect(r.rows[1]).toEqual({ label: 'swap', for: r.rows[0].against, against: r.rows[0].for })
    expect(r.total).toEqual({ label: 'TOTAL', for: { runs: 4, longest: 5, points: 13, by: [1, 2, 0, 1] }, against: { runs: 4, longest: 5, points: 13, by: [1, 2, 0, 1] } })
    // By the team's rotation at each run's last rally: as home, for in 2 and 1, against in 1 and 4; as away, all in 1.
    const rot = (n: number) => r.rotations[n - 1]
    expect(rot(1)).toEqual({ rot: 1, for: { runs: 3, longest: 5, points: 10, by: [1, 1, 0, 1] }, against: { runs: 3, longest: 3, points: 8, by: [1, 2, 0, 0] } })
    expect(rot(2)).toEqual({ rot: 2, for: { runs: 1, longest: 3, points: 3, by: [0, 1, 0, 0] }, against: { runs: 0, longest: 0, points: 0, by: [0, 0, 0, 0] } })
    expect(rot(4).against).toEqual({ runs: 1, longest: 5, points: 5, by: [0, 0, 0, 1] })
  })
})

describe('the rotation report', () => {
  const d = parseDVW(DVW)
  it('counts each rotation of the team: side-out, break point and the points', () => {
    // The away team receives in P1 and sides out with a kill, then serves an error in P2 and loses the
    // home team's four serves there: an ace, a reception error, an attack error and a blocked attack.
    const r = rotationReport([{ d, side: 'a', label: '' }])
    expect(r.rows.map(x => x.rot)).toEqual([1, 2, 3, 4, 5, 6])
    expect(r.rows[0]).toMatchObject({ oppServe: 1, soWon: 1, rec: 1, recPos: 1, firstKill: 1, recAttack: { att: 1, kill: 1, err: 0, blo: 0 }, serve: 0, won: 1, lost: 0 })
    expect(r.rows[1]).toMatchObject({ oppServe: 4, soWon: 0, rec: 3, recPos: 2, firstKill: 0, recAttack: { att: 2, kill: 0, err: 1, blo: 1 }, serve: 1, bpWon: 0, serveErr: 1, won: 0, lost: 5 })
    expect(r.rows.slice(2).every(x => x.won + x.lost === 0)).toBe(true)
    expect(r.total).toMatchObject({ oppServe: 5, soWon: 1, rec: 4, serve: 1, won: 1, lost: 5 })
  })
  it('adds the matches up, the team on either side', () => {
    const r = rotationReport([{ d, side: '*', label: '' }, { d, side: 'a', label: '' }])
    expect(r.total).toMatchObject({ serve: 6, bpWon: 4, ace: 1, serveErr: 1, oppServe: 6, soWon: 2, won: 6, lost: 6 })
  })
})
