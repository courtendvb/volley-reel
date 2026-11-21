import { describe, expect, it } from 'vitest'
import { currentPlay, filterPlayRows, isNear, jumpTime, NO_FILTER, playerChoices, playJumpRows } from './comparePlays'
import type { ParsedDVW, Play } from './types'

const play = (o: Partial<Play>): Play => ({ id: 0, time: 0, side: '*', jersey: 1, skill: 'S', effect: '#', setNum: 1, score: { home: 0, away: 0 }, ...o } as Play)
const d = {
  teams: [{ code: 'HTH', name: 'Home' }, { code: 'SMT', name: 'Smt' }],
  players: { '*1': { lastName: 'SATO' }, a7: { lastName: 'ITO' } },
  plays: [play({ id: 1, time: 10, playerKey: '*1' }), play({ id: 2, time: 20, side: 'a', jersey: 7, playerKey: 'a7', skill: 'A', effect: '/', setNum: 2, score: { home: 3, away: 5 } }), play({ id: 3, time: 30, jersey: 9, playerKey: '*9' })],
} as unknown as ParsedDVW

describe('play jump list', () => {
  it('puts each play at its video time, through the offset', () => {
    const r = playJumpRows(d, 100)
    expect(r.map(x => x.sec)).toEqual([110, 120, 130])
    expect(r[1]).toMatchObject({ team: 'SMT', who: '#7 ITO', what: 'Attack Blocked', score: '3-5', setNum: 2 })
    expect(r[2].who).toBe('#9') // a player the roster doesn't have
  })
  it('filters by set, skill and team', () => {
    const r = playJumpRows(d, 0)
    expect(filterPlayRows(r, NO_FILTER)).toHaveLength(3)
    expect(filterPlayRows(r, { ...NO_FILTER, setNum: 2 }).map(x => x.id)).toEqual([2])
    expect(filterPlayRows(r, { ...NO_FILTER, skill: 'S' }).map(x => x.id)).toEqual([1, 3])
    expect(filterPlayRows(r, { ...NO_FILTER, side: 'a', skill: 'S' })).toEqual([])
  })
  it('filters by player', () => {
    const r = playJumpRows(d, 0)
    expect(filterPlayRows(r, { ...NO_FILTER, playerKey: 'a7' }).map(x => x.id)).toEqual([2])
  })
  it('lists the players with plays, by team and jersey, one team when asked', () => {
    const r = playJumpRows(d, 0)
    expect(playerChoices(r, null).map(x => x.key)).toEqual(['*1', '*9', 'a7'])
    expect(playerChoices(r, 'a').map(x => x.label)).toEqual(['SMT #7 ITO'])
  })
  it('tells near from far by which team was near in set 1, swapping each set', () => {
    const r = playJumpRows(d, 0)
    expect(isNear(r[0], '*')).toBe(true) // home, set 1, home near
    expect(isNear(r[1], '*')).toBe(true) // away, set 2: sides swapped, so away is near
    expect(isNear(r[0], 'a')).toBe(false)
    expect(filterPlayRows(r, { ...NO_FILTER, position: 'near' }, '*').map(x => x.id)).toEqual([1, 2, 3])
    expect(filterPlayRows(r, { ...NO_FILTER, position: 'far' }, '*')).toEqual([])
    expect(filterPlayRows(r, { ...NO_FILTER, position: 'far' }, null)).toHaveLength(3) // unknown: not applied
  })
  it('knows which play the playhead is at', () => {
    const r = playJumpRows(d, 0) // plays at 10, 20, 30; a jump lands 2 s before each
    expect(currentPlay(r, 0)).toBeNull()
    expect(currentPlay(r, 8)?.id).toBe(1) // where a jump to the first play lands
    expect(currentPlay(r, 17)?.id).toBe(1)
    expect(currentPlay(r, 18)?.id).toBe(2)
    expect(currentPlay(r, 500)?.id).toBe(3)
  })
  it('lands before the play, never before the start', () => {
    expect(jumpTime(30)).toBe(28)
    expect(jumpTime(1)).toBe(0)
  })
})
