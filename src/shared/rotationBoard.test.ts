import { describe, expect, it } from 'vitest'
import { attackCone, attackLine, inRotation, mainColor, mainCourse, rotationFormation, rotationLineup, rotationSideOut, rotationSlide, sideOut, topCalls } from './rotationBoard'
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
  it('makes the slide: P2, the six players, three pass tables and the calls most used first, all inside; the court fixed', () => {
    const anns = rotationSlide({ rotation: 2, team: 'HTH', setter: d.players['*2'], sets, formation: rotationFormation([d], 'HTH', 2, rotationLineup([d], 'HTH', 2), 'S'), callNames: d.codeNames }, 'both', '#0F172A')
    const texts = anns.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts).toContain('P2')
    expect(['# pass', '+ pass', '! pass', '1. CALL KA Quick A', '2. CALL KB'].every(x => texts.includes(x))).toBe(true)
    expect(texts.some(x => x.startsWith('SD '))).toBe(false) // no dumps tag on the court
    expect(texts).toContain('EIRO') // the setter's heading over the chart
    expect(anns.filter(a => a.locked).length).toBeGreaterThan(20) // the court, net and antennas
    expect(anns.some(a => a.locked && (a.kind === 'text' || (a.kind === 'polygon' && a.disc)))).toBe(false) // players and numbers move
    const withPhoto = rotationSlide({ rotation: 2, team: 'HTH', setter: d.players['*2'], sets, formation: [], photo: { assetId: 'ph', width: 300, height: 400 } }, 'both', '#0F172A')
    expect(withPhoto.find(a => a.kind === 'image')).toMatchObject({ assetId: 'ph', fit: 'cover' })
    expect(anns.some(a => a.kind === 'image')).toBe(false)
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
  it("lines up in the standard serve receive: the outsides and the libero pass, the libero for the back row's middle", () => {
    const f = rotationFormation([d], 'HTH', 1, lineup, 'S')
    expect(f.map(s => s.jersey)).toEqual([21, 1, 4, 22, 11, 18]) // 18 receives most of those not in the lineup and comes on for 2
    expect(f.filter(s => s.receives).map(s => s.jersey)).toEqual([1, 11, 18])
    expect(f.find(s => s.jersey === 18)?.libero).toBe(true)
    expect(f.find(s => s.setter)?.jersey).toBe(21)
    const at = Object.fromEntries(f.map(s => [s.jersey, s.at]))
    expect(at[21].u).toBeGreaterThan(0.75) // zone 1: the team's right, behind its zone 2
    expect(at[21].v).toBeLessThan(at[1].v)
    expect(at[22].v).toBeGreaterThan(0.3) // the opposite in zone 4 a step off the net
    expect(at[22].u).toBeLessThan(0.2)
    expect(rotationFormation([d], 'HTH', 1, null, 'S')).toEqual([])
  })
  it('keeps the overlap rule in every rotation', () => {
    for (const r of [1, 2, 3, 4, 5, 6]) {
      const jerseys = [1, 2, 3, 4, 5, 6].map(z => ((z - r + 6) % 6) + 1) // the setter (1) in zone r
      const f = rotationFormation([], 'HTH', r, { jerseys, players: jerseys.map(j => (j === 1 ? { key: 'S' } as never : null)) }, 'S')
      const pos = Object.fromEntries([1, 2, 3, 4, 5, 6].map(zone => [zone, f[(zone - r + 6) % 6].at])) // the formation runs from the setter on
      for (const [front, back] of [[4, 5], [3, 6], [2, 1]]) expect(pos[front].v, `P${r}: ${front} before ${back}`).toBeGreaterThan(pos[back].v)
      for (const [left, right] of [[4, 3], [3, 2], [5, 6], [6, 1]]) expect(pos[left].u, `P${r}: ${left} left of ${right}`).toBeLessThan(pos[right].u)
      expect(f.filter(s => s.receives)).toHaveLength(2) // no libero without receptions: the outsides
    }
  })
  it("draws a spiker's usual course, and finds a logo's main colour", () => {
    const line = (to: [number, number]) => ({ from: { u: 0.17, v: 0.45 }, to: { u: to[0], v: to[1] } })
    const c = mainCourse([line([0.2, 0.9]), line([0.22, 0.95]), line([0.25, 0.92]), line([0.9, 0.6])])!
    expect(Math.abs(c.to - c.from)).toBeLessThan(0.4) // the three down the line, not the cross
    expect(mainCourse([])).toBeNull()
    const px = [255, 255, 255, 255, 200, 20, 30, 255, 204, 24, 28, 255, 0, 0, 255, 0, 20, 20, 20, 255]
    expect(mainColor(px)).toBe('#ca161d')
    expect(mainColor([255, 255, 255, 255])).toBeNull()
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

describe("a rotation's serve receive", () => {
  // Rally id: the home team receives in rotation 3, then (attack: its first attack's effect, if any) it
  // wins or loses the rally.
  const rally = (id: number, attack: string | null, won: boolean, rot = 3) => ({
    plays: [
      { side: 'a', skill: 'S', rallyId: id, homeRot: rot, awayRot: 1 },
      { side: '*', skill: 'R', rallyId: id, homeRot: rot, awayRot: 1 },
      { side: '*', skill: 'E', rallyId: id, homeRot: rot, awayRot: 1 },
      ...(attack ? [{ side: '*', skill: 'A', effect: attack, rallyId: id, homeRot: rot, awayRot: 1 }] : []),
      { side: 'a', skill: 'D', rallyId: id, homeRot: rot, awayRot: 1 },
      { side: '*', skill: 'A', effect: '#', rallyId: id, homeRot: rot, awayRot: 1 }, // a later attack: not the first ball
    ],
    rally: { id, wonBy: won ? '*' : 'a' },
  })
  const rs = [rally(0, '#', true), rally(1, '-', true), rally(2, '=', false), rally(3, null, false), rally(4, '#', true, 4)]
  const d = { teams: [{ code: 'hth' }, { code: 'okb' }], plays: rs.flatMap(r => r.plays), rallies: Object.fromEntries(rs.map(r => [r.rally.id, r.rally])) } as unknown as ParsedDVW
  it('counts its receptions, the rallies won after them, and those won by the first attack', () => {
    const so = rotationSideOut([d], 'HTH')
    expect(so[3]).toEqual({ n: 4, won: 2, firstBall: 1 })
    expect(so[4]).toEqual({ n: 1, won: 1, firstBall: 1 })
    expect(so[1]).toEqual({ n: 0, won: 0, firstBall: 0 })
    expect(rotationSideOut([d], 'OKB')[3].n).toBe(0)
  })
  it('heads the slide with them: Receptions, Side-out %, FBSO %', () => {
    const anns = rotationSlide({ rotation: 3, team: 'HTH', setter: { jersey: 2, lastName: 'Eiro' } as never, sets: [], formation: [], rates: rotationSideOut([d], 'HTH')[3], logo: { assetId: 'lg', width: 200, height: 200 } }, 'both', '#0F172A')
    const texts = anns.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts).toEqual(expect.arrayContaining(['Receptions', '4', 'Side-out %', '50%', 'FBSO %', '25%']))
    expect(texts.some(x => x.startsWith('HTH  #'))).toBe(false) // the setter's name only over the chart
    const logo = anns.find(a => a.kind === 'image' && a.assetId === 'lg'), p = anns.find(a => a.kind === 'text' && a.text === 'P3')
    expect(logo?.kind === 'image' && p?.kind === 'text' && logo.x + logo.w < p.x).toBe(true) // the logo first, at the top left
  })
})
