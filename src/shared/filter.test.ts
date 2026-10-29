import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { EMPTY_FILTER, applyFilter, buildRefs, listPeople, ourSide } from './filter'
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
