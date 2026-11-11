import { describe, expect, it } from 'vitest'
import { inRotation, rotationLineup, rotationSlide, sideOut, topCalls } from './rotationBoard'
import { setterSets } from './setterBoard'
import type { ParsedDVW, Play } from './types'

// A rally of the home team in rotation rot: the setter's set (rec: the reception before it; call: the
// setter call) and the attack after it from a zone.
let rally = 0
const rallyOf = (o: { rot: number; rec?: string; call?: string; zone?: number }): Play[] => {
  const id = rally++, base = { side: '*', rallyId: id, setNum: 1, homeRot: o.rot, awayRot: 1, phase: 'r', recEffect: o.rec ?? '#', score: { home: 0, away: 0 } }
  return [
    { ...base, skill: 'E', playerKey: 'S', jersey: 2, effect: '#', code: `*02EH#${o.call ?? '~~'}`, startZone: null },
    { ...base, skill: 'A', playerKey: 'X', jersey: 9, effect: '#', startZone: o.zone ?? 4, code: '*09AH#' },
  ] as unknown as Play[]
}
const match = (rallies: Play[][], court: (id: number) => number[]) => {
  const plays = rallies.flat()
  const ids = [...new Set(plays.map(p => p.rallyId!))]
  return {
    teams: [{ code: 'hth', name: 'H' }, { code: 'okb', name: 'O' }],
    players: { '*2': { key: 'S', side: '*', jersey: 2, lastName: 'Eiro', firstName: '', role: 'S' } },
    plays, codeNames: { KA: 'Quick A' },
    rallies: Object.fromEntries(ids.map(id => [id, { id, court: { home: court(id), away: [] } }])),
  } as unknown as ParsedDVW
}

describe('a rotation', () => {
  const rs = [rallyOf({ rot: 2, call: 'KA', zone: 3 }), rallyOf({ rot: 2, rec: '+', call: 'KA', zone: 4 }), rallyOf({ rot: 2, rec: '!', call: 'KB', zone: 2 }),
    rallyOf({ rot: 2, rec: '-', zone: 4 }), rallyOf({ rot: 2, rec: '+', call: 'KB', zone: 1 }), rallyOf({ rot: 3, call: 'KA', zone: 4 })]
  const first = rs[0][0].rallyId!
  const d = match(rs, id => (id === first + 3 ? [7, 2, 10, 19, 92, 6] : [2, 10, 19, 92, 6, 7]))
  const sets = setterSets([d], 'S')
  it('takes its sets, its side-out after # + !, and its two most used calls after # +', () => {
    expect(inRotation(sets, 2)).toHaveLength(5)
    expect(sideOut(inRotation(sets, 2))).toHaveLength(4)
    expect(topCalls(inRotation(sets, 2)).map(c => [c.call, c.sets.length])).toEqual([['KA', 2], ['KB', 1]])
  })
  it('finds the lineup it had most often, P1 to P6', () => {
    expect(rotationLineup([d], 'HTH', 2)?.jerseys).toEqual([2, 10, 19, 92, 6, 7])
    expect(rotationLineup([d], 'HTH', 2)?.players[0]?.lastName).toBe('Eiro')
    expect(rotationLineup([d], 'HTH', 5)).toBeNull()
    expect(rotationLineup([d], 'XXX', 2)).toBeNull()
  })
  it('makes the slide: P2, the six players, three pass tables and two call tables, all inside', () => {
    const anns = rotationSlide({ rotation: 2, team: 'HTH', setter: d.players['*2'], sets, lineup: rotationLineup([d], 'HTH', 2), callNames: d.codeNames }, 'both', '#0F172A')
    const texts = anns.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts).toContain('P2')
    expect(['# pass', '+ pass', '! pass', 'CALL KA Quick A', 'CALL KB'].every(x => texts.includes(x))).toBe(true)
    expect(texts).toEqual(expect.arrayContaining(['2', '10', '19', '92', '6', '7'])) // the players' discs
    for (const a of anns) if (a.kind === 'rect' || a.kind === 'circle') { expect(a.x + a.w).toBeLessThanOrEqual(1); expect(a.y + a.h).toBeLessThanOrEqual(1) }
    for (const a of anns) if (a.kind === 'text' && a.box?.width) expect(a.x + a.box.width / 2).toBeLessThanOrEqual(1)
  })
})
