import { describe, expect, it } from 'vitest'
import { receiveStats, receivers, serveTargetSlide, teamReceptions } from './serveTargetBoard'
import type { ParsedDVW, Play } from './types'

// A rally: the other team's serve (Q jump / M float), the home team's reception by `by` into `zone`
// with `effect`, then (unless a pass error) its attack from `from` (# a kill); won by `won`.
let id = 0
const rally = (o: { type: 'Q' | 'M'; by: number; effect: string; zone: number; sub?: string; from?: number; kill?: boolean; won: '*' | 'a' }) => {
  const r = id++, base = { rallyId: r, setNum: 1 }
  const plays: Partial<Play>[] = [
    { ...base, side: 'a', skill: 'S', jersey: 9, playerKey: 'A9', code: `a09S${o.type}+` },
    { ...base, side: '*', skill: 'R', jersey: o.by, playerKey: `H${o.by}`, effect: o.effect, endZone: o.zone, endSub: o.sub ?? null, shotCode: `a09S${o.type}+` },
  ]
  if (o.from) plays.push({ ...base, side: '*', skill: 'A', jersey: 7, playerKey: 'H7', effect: o.kill ? '#' : '+', startZone: o.from })
  return { plays, won: o.won }
}
const match = (rs: ReturnType<typeof rally>[]) => {
  const plays = rs.flatMap(r => r.plays).map((p, i) => ({ ...p, id: i })) as Play[]
  return { teams: [{ code: 'hth', name: 'H' }, { code: 'okb', name: 'O' }], plays, players: {}, rallies: Object.fromEntries(rs.map(r => [r.plays[0].rallyId, { wonBy: r.won }])) } as unknown as ParsedDVW
}

describe('serve targets', () => {
  const d = match([
    rally({ type: 'Q', by: 11, effect: '#', zone: 1, from: 4, kill: true, won: '*' }),
    rally({ type: 'Q', by: 11, effect: '-', zone: 5, from: 3, won: 'a' }),
    rally({ type: 'M', by: 11, effect: '+', zone: 6, from: 2, kill: true, won: '*' }),
    rally({ type: 'M', by: 10, effect: '=', zone: 8, sub: 'B', won: 'a' }),
    rally({ type: 'M', by: 10, effect: '#', zone: 6, from: 8, won: '*' }),
  ])
  const all = teamReceptions([d], 'HTH')
  it('reads each reception: the serve type, the zone it went to, the first attack and the side-out', () => {
    expect(all.map(r => [r.jersey, r.kind, r.zone, r.good, r.place, r.sideOut])).toEqual([
      [11, 'jump', 1, true, 'left', true], [11, 'jump', 3, false, 'middle', false], [11, 'float', 2, true, 'right', true],
      [10, 'float', 4, false, null, false], [10, 'float', 2, true, 'pipe', true],
    ])
    expect(teamReceptions([d], 'OKB')).toEqual([])
  })
  it('counts good passes, first-attack kills and side-outs', () => {
    expect(receiveStats(all)).toEqual({ n: 5, good: 3, attacks: 4, kills: 2, sideOuts: 3, known: 5 })
    expect(receivers(all).map(r => [r.jersey, r.n])).toEqual([[11, 3], [10, 2]])
  })
  it('draws a column per receiver and the team, the zones and their panels', () => {
    const anns = serveTargetSlide({ team: 'HTH', teamName: 'H', receptions: all, players: {}, photos: {} })
    const texts = anns.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts.filter(t => /^#1[01] /.test(t))).toHaveLength(2)
    expect(['Zone1', 'Zone6', 'Zone5', 'Short', 'All · Zone1', 'Jump · Short', 'Float · Zone6'].every(t => texts.includes(t))).toBe(true)
    for (const a of anns) if (a.kind === 'text' && a.box?.width) expect(a.x + a.box.width / 2).toBeLessThanOrEqual(1.001)
  })
})
