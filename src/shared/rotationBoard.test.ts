import { describe, expect, it } from 'vitest'
import { attackCone, attackLine, inRotation, rotationFormation, rotationLineup, rotationSlide, sideOut, topCalls } from './rotationBoard'
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
    const anns = rotationSlide({ rotation: 2, team: 'HTH', setter: d.players['*2'], sets, formation: rotationFormation([d], 'HTH', 2, rotationLineup([d], 'HTH', 2), 'S'), callNames: d.codeNames }, 'both', '#0F172A')
    const texts = anns.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts).toContain('P2')
    expect(['# pass', '+ pass', '! pass', 'CALL KA Quick A', 'CALL KB'].every(x => texts.includes(x))).toBe(true)
    expect(texts).toEqual(expect.arrayContaining(['2', '10', '19', '92', '6', '7'])) // the players' discs
    for (const a of anns) if (a.kind === 'rect' || a.kind === 'circle') { expect(a.x + a.w).toBeLessThanOrEqual(1); expect(a.y + a.h).toBeLessThanOrEqual(1) }
    for (const a of anns) if (a.kind === 'text' && a.box?.width) expect(a.x + a.box.width / 2).toBeLessThanOrEqual(1)
  })
})

describe('where the side-out team stands, and its attacks', () => {
  const rec = (jersey: number, endZone: number, endSub: string | null, rot = 1) =>
    ({ side: '*', skill: 'R', jersey, playerKey: `P${jersey}`, homeRot: rot, endZone, endSub, endClick: null, rallyId: 0, phase: 'r' }) as unknown as Play
  const d = {
    teams: [{ code: 'hth', name: 'H' }, { code: 'okb', name: 'O' }],
    players: { '*21': { key: 'S', jersey: 21, role: 'S' }, '*11': { key: 'P11', jersey: 11, role: 'OH' }, '*2': { key: 'P2', jersey: 2, role: 'MB' } },
    plays: [rec(11, 6, 'C'), rec(11, 6, 'C'), rec(18, 1, 'A'), rec(18, 1, 'A'), rec(18, 1, 'B'), rec(10, 5, null), rec(10, 5, null)],
    rallies: {},
  } as unknown as ParsedDVW
  const lineup = { jerseys: [21, 1, 4, 22, 11, 2], players: [d.players['*21'], null, null, null, d.players['*11'], d.players['*2']] }
  it("puts receivers where they received, the libero for the back row's middle, the setter at the net", () => {
    const f = rotationFormation([d], 'HTH', 1, lineup, 'S')
    expect(f.map(s => s.jersey)).toEqual([21, 1, 4, 22, 11, 18]) // 18 receives most of the liberos and comes on for 2
    const at = Object.fromEntries(f.map(s => [s.jersey, s.at]))
    expect(at[18].u).toBeGreaterThan(0.75) // zone 1: the team's right
    expect(at[11].u).toBeLessThan(0.5) // zone 6, sub C: left of the middle
    expect(at[21].v).toBeGreaterThan(0.4) // by the net
    expect(f.find(s => s.jersey === 18)?.libero).toBe(true)
  })
  it('moves players on the same spot apart', () => {
    const same = { ...d, plays: [rec(11, 6, null), rec(11, 6, null), rec(18, 6, null), rec(18, 6, null)] } as unknown as ParsedDVW
    const f = rotationFormation([same], 'HTH', 1, lineup, 'S'), a = f.find(s => s.jersey === 11)!.at, b = f.find(s => s.jersey === 18)!.at
    expect(Math.hypot((a.u - b.u) * 9, (a.v - b.v) * 18)).toBeGreaterThanOrEqual(1.4)
  })
  it('draws a cone over where the attacks went', () => {
    const line = (to: [number, number]) => ({ from: { u: 0.17, v: 0.45 }, to: { u: to[0], v: to[1] } })
    const c = attackCone([line([0.2, 0.9]), line([0.5, 0.8]), line([0.8, 0.95])])!
    expect(c.apex).toEqual({ u: 0.17, v: 0.45 })
    expect(c.from).toBeLessThan(c.to)
    expect(attackCone([])).toBeNull()
    const l = attackLine({ startClick: null, startZone: 4, endClick: null, endZone: 5 } as unknown as Play)! // zone 4 to the other side's zone 5
    expect([l.from.u, l.from.v, l.to.u, l.to.v].map(x => +x.toFixed(4))).toEqual([0.1667, 0.4167, 0.8333, 0.9167])
  })
})
