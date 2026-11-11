import { describe, expect, it } from 'vitest'
import { cardPlayers, cardTeams } from './cardPeople'
import type { ParsedDVW } from './types'

const d = {
  teams: [{ code: 'hth', name: 'Hiroshima' }, { code: 'okb', name: 'Okayama' }],
  players: {
    '*4': { key: 'A', side: '*', jersey: 4, lastName: 'Miwa', firstName: '' }, '*21': { key: 'B', side: '*', jersey: 21, lastName: 'Eiro', firstName: '' },
    a6: { key: 'C', side: 'a', jersey: 6, lastName: 'Kim', firstName: '' },
  },
  plays: [{ side: '*', jersey: 4 }, { side: '*', jersey: 4 }, { side: 'a', jersey: 6 }, { side: '*', jersey: 99 }],
} as unknown as ParsedDVW

describe('cardPlayers', () => {
  it("lists the clips' players, the most clips first, then the matches' other players", () => {
    const list = cardPlayers([{ matchId: 'm', playId: 2 }, { matchId: 'm', playId: 0 }, { matchId: 'm', playId: 1 }, { matchId: 'x', playId: 0 }], { m: d })
    expect(list.map(p => [p.team, p.player.jersey, p.clips])).toEqual([['HTH', 4, 2], ['OKB', 6, 1], ['HTH', 21, 0]])
  })
})

describe('cardTeams', () => {
  it("lists the matches' teams, the team with the most clips first", () => {
    expect(cardTeams([{ matchId: 'm', playId: 2 }], { m: d }).map(t => [t.code, t.clips])).toEqual([['OKB', 1], ['HTH', 0]])
    expect(cardTeams([], { m: d })).toEqual([])
  })
})
