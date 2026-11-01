import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { EMPTY_FILTER, applyFilter, buildRefs, cleanFilter, cleanSavedFilters, listPeople, ourSide, sameFilter } from './filter'
import type { ProjectSettings } from './types'

// Two made-up matches: HTH at home in A, away in B (same player, other side, "-a" style ID in B).
const dvw = (home: string, away: string, homeIds: string[], awayIds: string[], scout: string) => `[3TEAMS]
${home};HOME;;;;
${away};AWAY;;;;
[3PLAYERS-H]
0;1;1;;;;;;${homeIds[0]};${homeIds[1]};${homeIds[2]};
[3PLAYERS-V]
1;1;15;;;;;;${awayIds[0]};${awayIds[1]};${awayIds[2]};
[3SCOUT]
${scout}`

const A = parseDVW(dvw('HTH', 'OPP', ['TAN-TAR-02', 'TANAKA', 'Taro'], ['SMI-JOH-95', 'SMITH', 'John'], `
*01SQ-~~~16A;;;;;;;;1;1;3;1;100;;
a01RQ+~~~16AR;;;;;;;;1;1;3;1;102;;
a01AQ#PA~36BH1;;;;;;;;1;1;3;1;104;;
ap00:01;;;;;;;;1;1;3;1;114;;
`))
const B = parseDVW(dvw('XYZ', 'HTH', ['LEE-KIM-90', 'LEE', 'Kim'], ['TAN-TAR-02-a', 'TANAKA', 'Taro'], `
*01SQ#~~~16A;;;;;;;;1;5;2;1;50;;
*p01:00;;;;;;;;1;5;2;1;60;;
a01SQ-~~~16A;;;;;;;;1;5;2;1;70;;
*01RQ#~~~16A;;;;;;;;1;5;2;1;72;;
`))
const settings: ProjectSettings = { ourTeamCodes: ['HTH', 'HTA'] }
const refs = () => [...buildRefs('A', A, settings), ...buildRefs('B', B, settings)]

describe('team roles', () => {
  it('finds our side whether we are home or away', () => {
    expect(ourSide(A.teams, settings.ourTeamCodes)).toBe('*')
    expect(ourSide(B.teams, settings.ourTeamCodes)).toBe('a')
  })

  it('marks plays ours or theirs by side, per match', () => {
    const r = refs()
    expect(r.filter(x => x.teamRole === 'our').map(x => `${x.matchId}${x.play.code.slice(0, 4)}`)).toEqual(['A*01S', 'Ba01S'])
  })
})

describe('the same player across matches', () => {
  it('is one person when home in one match and away in another', () => {
    const r = applyFilter(refs(), { ...EMPTY_FILTER, person: 'TAN-TAR-02' })
    expect(r.map(x => x.matchId)).toEqual(['A', 'B'])
  })

  it('lists our people first', () => {
    expect(listPeople(refs()).map(p => `${p.key}:${p.teamRole}:${p.plays}`)).toEqual(['TAN-TAR-02:our:2', 'LEE-KIM-90:opp:2', 'SMI-JOH-95:opp:2'])
  })
})

describe('filters', () => {
  it('combine team, skill and effect', () => {
    const r = applyFilter(refs(), { ...EMPTY_FILTER, team: 'opp', skills: ['R'], effects: ['#', '+'] })
    expect(r.map(x => `${x.matchId}${x.play.code.slice(0, 6)}`)).toEqual(['Aa01RQ+', 'B*01RQ#']) // opponents at home and away
  })

  it('filter by our rotation and the opponent rotation, whoever made the play', () => {
    // A: HTH at home in rotation 1, OPP in 3. B: HTH away in rotation 2, XYZ at home in 5.
    expect(applyFilter(refs(), { ...EMPTY_FILTER, rots: [1] }).map(x => x.matchId)).toEqual(['A', 'A', 'A'])
    expect(applyFilter(refs(), { ...EMPTY_FILTER, rots: [2] }).map(x => x.matchId)).toEqual(['B', 'B', 'B'])
    expect(applyFilter(refs(), { ...EMPTY_FILTER, oppRots: [5] }).map(x => x.matchId)).toEqual(['B', 'B', 'B'])
    expect(applyFilter(refs(), { ...EMPTY_FILTER, rots: [1], oppRots: [5] })).toEqual([])
    expect(applyFilter(refs(), { ...EMPTY_FILTER, team: 'opp', rots: [1], oppRots: [3] }).map(x => x.play.code.slice(0, 4))).toEqual(['a01R', 'a01A'])
  })

  it('keep all-home plays when filtering by team, since their team is unknown', () => {
    const allHome = parseDVW(dvw('HTH', 'HTA', ['TAN-TAR-02', 'TANAKA', 'Taro'], ['TAN-TAR-02-a', 'TANAKA', 'Taro'], `
*01SQ-~~~16A;;;;;;;;1;1;1;1;10;;
`))
    const r = buildRefs('C', allHome, settings)
    expect(r[0].teamRole).toBeNull()
    expect(applyFilter(r, { ...EMPTY_FILTER, team: 'opp' })).toHaveLength(1)
  })

  it('search by tempo, attack combination and hit type', () => {
    const r = refs()
    expect(r.find(x => x.play.code.startsWith('a01AQ#'))).toMatchObject({ tempo: 'Q', combo: 'PA', hit: 'H' })
    expect(applyFilter(r, { ...EMPTY_FILTER, combos: ['PA'] }).map(x => x.play.code.slice(0, 6))).toEqual(['a01AQ#'])
    expect(applyFilter(r, { ...EMPTY_FILTER, tempos: ['Q'], skills: ['S'] })).toHaveLength(3)
    expect(applyFilter(r, { ...EMPTY_FILTER, hits: ['T'] })).toHaveLength(0)
  })

  it('match zones', () => {
    expect(applyFilter(refs(), { ...EMPTY_FILTER, skills: ['A'], startZone: 3, endZone: 6 })).toHaveLength(1)
    expect(applyFilter(refs(), { ...EMPTY_FILTER, skills: ['A'], startZone: 4 })).toHaveLength(0)
  })
})

// Real scout lines (players renumbered): a reception attack, a dig and a block cover in transition,
// and an overpass played back as a freeball.
const R = parseDVW(dvw('HTH', 'OPP', ['TAN-TAR-02', 'TANAKA', 'Taro'], ['SMI-JOH-95', 'SMITH', 'John'], `
*21SM-~~~68A;;;;0650;-1-1;7348;13.59.15;1;1;2;1;1427;;
a14RM#~~~68AL;;;;;;;13.59.17;1;1;2;1;1430;;
a17EU+KBB~3B;;;;4662;-1-1;3487;13.59.18;1;1;2;1;1430;;
a03AU+P9~95DH2;;r;;3384;-1-1;8683;13.59.18;1;1;2;1;1432;;
*10DU/~~~95D;;;;;;;13.59.21;1;1;2;1;1433;;
a15FH+~~~~3A;;;;;;;13.59.22;1;1;2;1;1436;;
a17EM+~~F~3A;;;;4263;-1-1;4815;13.59.24;1;1;2;1;1436;;
a11AM-PV~42AT4;;s;;4717;-1-1;5913;13.59.25;1;1;2;1;1438;;
*23BM+~~~~2B~4;;;;;;;13.59.27;1;1;2;1;1440;;
*23DO-~~~~6D;;;;;;;13.59.28;1;1;2;1;1441;;
*07EH+~~B~6D;;;;1240;-1-1;4968;13.59.28;1;1;2;1;1441;;
*23AH#P4~21DH3;p;p;;4770;-1-1;8936;13.59.29;1;1;2;1;1442;;
a15BH=~~~~4B~3;p;;;;;;13.59.31;1;1;2;1;1444;;
*p01:00;;;;;;;13.59.41;1;1;2;1;1454;;
*21SM-~~~66C;;;;0650;-1-1;8055;14.00.52;1;1;2;1;1466;;
a18RM+~~~66CL;;;;;;;14.00.54;1;1;2;1;1468;;
a17EU+KAP~3B;;;;4758;-1-1;3544;14.00.55;1;1;2;1;1469;;
a18AU!P8~85BH4;;r;;3344;-1-1;8068;14.00.56;1;1;2;1;1469;;
*15BU+~~~~3~~4;;;;;;;14.00.58;1;1;2;1;1472;;
a14DU+~~~~5D;;;;;;;14.00.59;1;1;2;1;1473;;
a17EH+~~F~3A;;;;4263;-1-1;4815;14.01.00;1;1;2;1;1474;;
a03AH#P4~45AH2;s;s;;4717;-1-1;5913;14.01.01;1;1;2;1;1475;;
ap00:01;;;;;;;14.01.11;1;1;2;1;1485;;
a11SQ/~~~65B;;;;0650;-1-1;7969;14.01.26;1;1;1;1;1500;;
*05RQ/~~~65BR;;;;;;;14.01.29;1;1;1;1;1503;;
a02FH!~~~~8C;;;;;;;14.01.30;1;1;1;1;1505;;
a06EH+~~F~8C;;;;3442;-1-1;4714;14.01.32;1;1;1;1;1506;;
a02AH#P1~45CH2;p;p;;4717;-1-1;8282;14.01.32;1;1;1;1;1506;;
ap00:02;;;;;;;14.01.42;1;1;1;1;1516;;
`))

describe('rally context', () => {
  const rr = () => buildRefs('R', R, settings)
  const codes = (f: Partial<typeof EMPTY_FILTER>) => applyFilter(rr(), { ...EMPTY_FILTER, ...f }).map(x => x.play.code.slice(0, 6))

  it('tells reception attacks from transition attacks the way the scout column does', () => {
    const attacks = R.plays.filter(p => p.skill === 'A')
    expect(attacks.map(p => p.phase)).toEqual(['r', 't', 't', 'r', 't', 't']) // column 3: r s p r s p
    expect(codes({ skills: ['A'], phase: 'reception' })).toEqual(['a03AU+', 'a18AU!'])
    expect(codes({ skills: ['A'], phase: 'transition' })).toEqual(['a11AM-', '*23AH#', 'a03AH#', 'a02AH#'])
  })

  it('puts the reception and its set in the reception phase, and nothing for a serve', () => {
    expect(codes({ phase: 'reception', skills: ['R', 'E'] })).toEqual(['a14RM#', 'a17EU+', 'a18RM+', 'a17EU+', '*05RQ/'])
    expect(codes({ phase: 'reception', skills: ['S'] })).toEqual([])
    expect(R.plays.filter(p => p.skill === 'S').map(p => p.phase)).toEqual([null, null, null])
  })

  it('matches the play just before, freeballs included', () => {
    expect(codes({ skills: ['D'], prevSkills: ['A'], prevTeam: 'opp' })).toEqual(['*10DU/'])
    expect(codes({ skills: ['E'], prevSkills: ['D'] })).toEqual(['*07EH+', 'a17EH+'])
    expect(codes({ skills: ['E'], prevSkills: ['F'], prevTeam: 'same' })).toEqual(['a17EM+', 'a06EH+'])
    expect(codes({ prevSkills: ['B'], prevTeam: 'opp' })).toEqual(['a14DU+']) // the cover after our attack was blocked
    expect(codes({ skills: ['S'], prevSkills: ['A'] })).toEqual([])
  })

  it('looks past the set to what an attack came from', () => {
    expect(codes({ skills: ['A'], prevSkills: ['R'], prevEffects: ['#'] })).toEqual([])
    expect(codes({ skills: ['A'], prevSkills: ['R'], prevEffects: ['#'], prevSkipSet: true })).toEqual(['a03AU+'])
    expect(codes({ skills: ['A'], prevSkills: ['F'], prevSkipSet: true })).toEqual(['a11AM-', 'a02AH#'])
    expect(codes({ skills: ['A'], prevSkills: ['D'], prevSkipSet: true })).toEqual(['*23AH#', 'a03AH#'])
  })

  it('matches the play just after, and nothing after a rally ends', () => {
    expect(codes({ skills: ['S'], nextSkills: ['R'], nextEffects: ['#'] })).toEqual(['*21SM-'])
    expect(codes({ skills: ['A'], nextSkills: ['D'], nextTeam: 'opp' })).toEqual(['a03AU+'])
    expect(codes({ skills: ['A'], nextTeam: 'opp' })).toEqual(['a03AU+', 'a11AM-', '*23AH#', 'a18AU!']) // the kills end their rallies
    expect(codes({ nextSkills: ['F'], nextTeam: 'opp' })).toEqual(['*10DU/', '*05RQ/']) // overpasses played back as freeballs
  })

  it('looks past the set to the attack a reception led to', () => {
    expect(codes({ skills: ['R'], nextSkills: ['A'] })).toEqual([])
    expect(codes({ skills: ['R'], nextSkills: ['A'], nextEffects: ['+', '!'], nextSkipSet: true })).toEqual(['a14RM#', 'a18RM+'])
    expect(codes({ skills: ['R'], prevSkills: ['S'], nextSkills: ['A'], nextSkipSet: true })).toEqual(['a14RM#', 'a18RM+'])
  })
})

describe('saved filters', () => {
  it('reads back what was saved, and anything broken as "any"', () => {
    const f = { ...EMPTY_FILTER, team: 'our' as const, skills: ['A'], effects: ['#'], startZone: 4, phase: 'transition' as const, prevSkills: ['D'], prevSkipSet: true }
    expect(cleanFilter(JSON.parse(JSON.stringify(f)))).toEqual(f)
    expect(cleanFilter({ team: 'x', skills: 'A', sets: [1, 'two', 2.5], endZone: '3', nextSkipSet: 'yes', phase: 'serve' })).toEqual({ ...EMPTY_FILTER, sets: [1] })
    expect(cleanFilter(null)).toEqual(EMPTY_FILTER)
  })

  it('drops entries without an id or a name', () => {
    const list = cleanSavedFilters([{ id: 'a', name: ' レセプション A ', filter: { skills: ['R'] } }, { id: 'b', name: '  ' }, { name: 'x' }, 3])
    expect(list).toEqual([{ id: 'a', name: 'レセプション A', filter: { ...EMPTY_FILTER, skills: ['R'] } }])
    expect(cleanSavedFilters('nope')).toEqual([])
  })

  it('treats the same chips in another order as the same conditions', () => {
    expect(sameFilter({ ...EMPTY_FILTER, rots: [1, 3] }, { ...EMPTY_FILTER, rots: [3, 1] })).toBe(true)
    expect(sameFilter({ ...EMPTY_FILTER, rots: [1] }, { ...EMPTY_FILTER, oppRots: [1] })).toBe(false)
    expect(sameFilter({ ...EMPTY_FILTER, person: 'TAN-TAR-02' }, EMPTY_FILTER)).toBe(false)
  })
})
