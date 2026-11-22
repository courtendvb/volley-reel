import { describe, expect, it } from 'vitest'
import { playerIndex, unifyPlayers } from './players'
import type { ParsedDVW, Play, Player, Side } from './types'

const player = (side: Side, jersey: number, key: string, lastName = 'IKEDA'): Player => ({ key, side, jersey, lastName, firstName: '' })
const play = (side: Side, jersey: number, playerKey: string, front?: string[]): Play =>
  ({ side, jersey, playerKey, skill: 'S', effect: '#', ...(front ? { front } : {}) }) as Play
const match = (home: string, away: string, players: Player[], plays: Play[] = [], allHome = false): ParsedDVW => ({
  date: null, teams: [{ code: home, name: home }, { code: away, name: away }],
  players: Object.fromEntries(players.map(p => [`${p.side}${p.jersey}`, p])), plays, rallies: [], allHome, codeNames: {},
})

describe('unifyPlayers', () => {
  it('puts the same team and jersey under one key, the ID seen in the most matches', () => {
    const a = match('HYS', 'SAK', [player('*', 11, 'HYS-11')], [play('*', 11, 'HYS-11')])
    const b = match('SAK', 'HYS', [player('a', 11, 'HYS-11')])
    const c = match('HYS', 'FGK', [player('*', 11, 'OLD-ID')], [play('*', 11, 'OLD-ID', ['OLD-ID', 'FGK-1'])])
    const index = playerIndex([a, b, c])
    const u = unifyPlayers(c, index)
    expect(u.players['*11'].key).toBe('HYS-11')
    expect(u.plays[0].playerKey).toBe('HYS-11')
    expect(u.plays[0].front).toEqual(['HYS-11', 'FGK-1'])
    expect(c.plays[0].playerKey).toBe('OLD-ID') // the parsed file is left as it was
  })

  it('names a jersey missing from the roster from the other matches', () => {
    const a = match('HYS', 'SAK', [player('*', 11, 'HYS-11')])
    const b = match('FGK', 'HYS', [], [play('a', 11, 'a11')])
    const u = unifyPlayers(b, playerIndex([a, b]))
    expect(u.plays[0].playerKey).toBe('HYS-11')
    expect(u.players.a11).toMatchObject({ key: 'HYS-11', side: 'a', jersey: 11, lastName: 'IKEDA' })
  })

  it('keeps teams apart, and a real ID over one made from the name', () => {
    const a = match('HYS', 'SAK', [player('*', 7, 'IKEDA||7'), player('a', 7, 'SAK-7', 'OTHER')])
    const b = match('HYS', 'FGK', [player('*', 7, 'HYS-7')])
    const index = playerIndex([a, a, b])
    const u = unifyPlayers(a, index)
    expect(u.players['*7'].key).toBe('HYS-7')
    expect(u.players.a7.key).toBe('SAK-7')
  })

  it('leaves plays without a roster entry alone when every play is coded as home', () => {
    const a = match('HYS', 'SAK', [player('*', 11, 'HYS-11'), player('a', 11, 'SAK-11', 'X')])
    const b = match('HYS', 'SAK', [], [play('*', 11, '*11')], true)
    const u = unifyPlayers(b, playerIndex([a, b]))
    expect(u.plays[0].playerKey).toBe('*11')
  })
})
