import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { matchReport, per, pct, seasonReport } from './report'
import { matchLinks, reportHtml, seasonLinks, type ReportPick } from './reportHtml'
import { applyFilter, buildRefs, EMPTY_FILTER } from './filter'

// Three rallies: the home team's serve received by the away team, who kill it (side-out); the away
// serve into the net (a home point from an error); a home ace (a break point).
const DVW = `[3MATCH]
01/11/2026;11.00.43;;2026/27;;;;;1250;1;Z;;;;;
[3TEAMS]
HTH;HOME;1;COACH Home;ASSIST Home;;;;;
OPP;AWAY;0;COACH Away;ASSIST Away;;;;;
[3MORE]
REF A;1200;;HIROSHIMA;GREEN ARENA;;;;;;
[3SET]
True; 8- 6;16-12;21-18;25-20;24;
True;;;;;;
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
`

describe('the match report', () => {
  const d = parseDVW(DVW)
  const r = matchReport(d)
  const [home, away] = r.teams
  it('reads the match from the DVW: time, sets played, staff, what [3MORE] holds, who started where', () => {
    expect(r.time).toBe('11:00')
    expect(r.info?.sets).toEqual([{ partials: ['8-6', '16-12', '21-18'], score: '25-20', minutes: 24 }])
    expect([home.coach, home.assistant, home.setsWon, away.setsWon]).toEqual(['COACH Home', 'ASSIST Home', 1, 0])
    expect(r.info?.more).toMatchObject({ referees: 'REF A', spectators: '1200', city: 'HIROSHIMA', hall: 'GREEN ARENA' })
    expect(home.players.map(p => [p.jersey, p.sets[0], p.libero])).toEqual([[1, 5, false], [2, '*', true]])
  })
  it('counts each player\'s serve, reception, attack and points, break points on their own serve', () => {
    const nine = away.players[0]
    expect(nine.serve).toEqual({ tot: 1, err: 1, pts: 0, poss: 0, brk: 0 })
    expect(nine.rec).toEqual({ tot: 1, err: 0, pos: 1, exc: 0, ovr: 0 })
    expect(nine.att).toEqual({ tot: 1, err: 0, blo: 0, pts: 1 })
    expect([nine.points, nine.bp, nine.wl]).toEqual([1, 0, 0]) // a kill, a serve error
    const two = home.players[1]
    expect([two.points, two.bp, two.serve.pts, two.serve.brk]).toEqual([1, 1, 1, 1]) // the ace, on their own serve: a break point
    expect(home.players[0].serve.poss).toBe(0) // received and killed: no attack of their own
  })
  it('counts the serves after which their team got an attack of its own', () => {
    // The away attack kept in play, then a home attack: the home serve made a possibility.
    const dug = parseDVW(DVW.replace('a09AQ#PA~36BH1', 'a09AQ-PA~36BH1;;;;;;;;1;1;1;1;104;;\n*01AQ#PA~36BH1'))
    const one = matchReport(dug).teams[0].players[0]
    expect([one.serve.tot, one.serve.poss]).toEqual([1, 1])
  })
  it('splits the points into side-out and break, and by how they were won in the set', () => {
    expect([home.so.points, home.bp.points, away.so.points, away.bp.points]).toEqual([1, 1, 1, 0])
    expect(home.sets[0].won).toEqual({ ser: 1, atk: 0, blo: 0, opErr: 1 })
    expect(away.sets[0].won).toEqual({ ser: 0, atk: 1, blo: 0, opErr: 0 })
    expect(away.kill.pos).toEqual({ tot: 1, err: 0, blo: 0, pts: 1 }) // the first attack after a + reception
  })
  it('writes the page', () => {
    const html = reportHtml(r)
    expect(html).toContain('Match report')
    expect(html).toContain('GREEN ARENA')
    expect(html).toContain('25-20')
    expect(pct(1, 3)).toBe('33%'); expect(per(83, 67)).toBe('1.24'); expect(per(5, 0)).toBe('–')
  })
  it('counts the rallies each player was on court for, from the lineups at the serve', () => {
    const lined = DVW.replace(/^([*a]\d\dS[^;]*;;;;;;;;1;1;\d;1;\d+;;)$/gm, '$1;1;7;3;4;5;6;9;8;7;6;5;4') // #2 (a libero) is not in the lineup
    const rep = matchReport(parseDVW(lined))
    expect([rep.teams[0].rallies, rep.teams[0].players.map(p => p.onCourt)]).toEqual([3, [3, 1]])
    expect(rep.teams[1].players[0].onCourt).toBe(3)
  })
  it('counts overpasses in reception', () => {
    const over = matchReport(parseDVW(DVW.replace('a09RQ+~~~16AR', 'a09RQ/~~~16AR')))
    expect(over.teams[1].players[0].rec).toMatchObject({ tot: 1, ovr: 1, pos: 0 })
  })
  it('adds up one team over several matches, with the share of the sets each played and a row per match', () => {
    const s = seasonReport([{ d, side: '*', label: 'vs AWAY' }, { d, side: '*', label: 'vs AWAY again' }])!
    const [us, them] = s.teams
    expect(s.matches?.map(m => [m.label, m.score, m.won])).toEqual([['vs AWAY', '1-0', true], ['vs AWAY again', '1-0', true]])
    expect([us.setsWon, them.setsWon]).toEqual([2, 0])
    // The lineups in this file are empty: only the libero (#2) counts, in the rally they played a ball in.
    expect(us.players.map(p => [p.jersey, p.played])).toEqual([[1, { rallies: 0, of: 6, sets: 2, setsOf: 2 }], [2, { rallies: 2, of: 6, sets: 2, setsOf: 2 }]])
    const page = reportHtml(s)
    expect(page).toContain('2/2 sets') // the libero, by sets
    expect(page).toContain('0%') // the other, by rallies
    expect(us.players[1].serve).toMatchObject({ tot: 2, pts: 2, brk: 2 })
    expect(us.sets.map(r => r.label)).toEqual(['vs AWAY', 'vs AWAY again'])
    expect([us.so.points, us.bp.points, them.players.length, them.name]).toEqual([2, 2, 0, 'Opponents'])
    expect(reportHtml(s)).toContain('Team report')
  })
})


// Each clickable number with its search; the plays that search finds in the play list.
const picks = (html: string) => [...html.matchAll(/data-f="([^"]*)"[^>]*>([^<]*)</g)]
  .map(([, raw, text]) => ({ pick: JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as ReportPick, text }))
const found = (dvws: Record<string, ReturnType<typeof parseDVW>>, p: ReportPick) =>
  applyFilter(p.m.flatMap(id => buildRefs(id, dvws[id], { ourTeamCodes: ['HTH'] })), { ...EMPTY_FILTER, ...p.f }).length

describe('the report\'s numbers as searches', () => {
  const d = parseDVW(DVW)
  it('finds as many plays as each count says, for players, teams, sets and the first attacks', () => {
    const html = reportHtml(matchReport(d), matchLinks('M', d, ['HTH']))
    const counts = picks(html).filter(x => /^\d+$/.test(x.text))
    expect(counts.length).toBeGreaterThan(10)
    for (const { pick, text } of counts) expect([found({ M: d }, pick), pick]).toEqual([Number(text), pick])
  })
  it('leaves the PDF plain, and a match with no target team only its players and rotations', () => {
    expect(reportHtml(matchReport(d))).not.toContain('data-f=')
    const html = reportHtml(matchReport(d), matchLinks('M', d, ['XXX']))
    expect(picks(html).every(x => x.pick.f.persons || x.pick.f.rots || x.pick.f.oppRots)).toBe(true)
    expect(html).toContain('&quot;rots&quot;:[1]')
  })
  it('in a report of several matches, searches each match\'s row in that match', () => {
    const r = seasonReport([{ d, side: '*', label: 'vs AWAY' }, { d, side: '*', label: 'vs AWAY' }])!
    const html = reportHtml(r, seasonLinks(['M1', 'M2']))
    const counts = picks(html).filter(x => /^\d+$/.test(x.text))
    expect(counts.some(x => x.pick.m.length === 1 && x.pick.m[0] === 'M2')).toBe(true)
    for (const { pick, text } of counts) expect([found({ M1: d, M2: d }, pick), pick]).toEqual([Number(text), pick])
  })
})
