import { describe, expect, it } from 'vitest'
import { setPanels, setterCourts, setterSets, splitSets } from './setterBoard'
import type { ParsedDVW, Play } from './types'

// A rally: the setter's set (rec: the reception before it; rot: the setter's rotation; call: the
// setter call) and the attack after it from a zone; or the setter's own attack (a dump).
let rally = 0
const rallyOf = (o: { rec?: string; rot?: number; call?: string; zone?: number; effect?: string; dump?: boolean; phase?: 'r' | 't' }): Play[] => {
  const id = rally++, base = { side: '*', rallyId: id, setNum: 1, homeRot: o.rot ?? 1, awayRot: 1, phase: o.phase ?? 'r', recEffect: o.rec ?? '#', score: { home: 0, away: 0 } }
  const attack = (key: string, zone: number) => ({ ...base, skill: 'A', playerKey: key, jersey: 9, effect: o.effect ?? '+', startZone: zone, code: '*09AH+' })
  if (o.dump) return [attack('S', 3) as unknown as Play]
  return [
    { ...base, skill: 'E', playerKey: 'S', jersey: 2, effect: '#', code: `*02EH#${o.call ?? '~~'}`, startZone: null },
    attack('X', o.zone ?? 4),
  ] as unknown as Play[]
}
const match = (rallies: Play[][]) => ({ plays: rallies.flat(), codeNames: { K1: 'Quick' } }) as unknown as ParsedDVW

describe('setterSets', () => {
  it('takes the attack after each set, Zone2 and Zone1 as one place, and the dumps', () => {
    const d = match([rallyOf({ zone: 2 }), rallyOf({ zone: 1 }), rallyOf({ zone: 9 }), rallyOf({ zone: 4 }), rallyOf({ zone: 8 }), rallyOf({ dump: true })])
    expect(setterSets([d], 'S').map(s => s.place)).toEqual(['right', 'right', 'right', 'left', 'pipe', 'dump'])
    const sp = splitSets(setterSets([d], 'S'))
    expect([sp.total, sp.by.right.n, sp.by.dump.n]).toEqual([6, 3, 1])
  })
  it('keeps to the contacts asked for', () => {
    const d = match([rallyOf({ zone: 2 }), rallyOf({ zone: 3, rec: '-' })])
    expect(setterSets([d], 'S', p => p.recEffect === '-').map(s => s.place)).toEqual(['middle'])
  })
})

describe('setPanels', () => {
  const d = match([
    rallyOf({ rec: '#', call: 'K1', zone: 3 }), rallyOf({ rec: '+', call: 'K1', zone: 3 }), rallyOf({ rec: '+', call: 'K7', zone: 4 }),
    rallyOf({ rec: '!', call: 'K2', zone: 4 }), rallyOf({ rec: '-', call: 'K1', zone: 4 }), rallyOf({ phase: 't', zone: 4 }),
    rallyOf({ rec: '#', rot: 6, zone: 2 }), rallyOf({ rec: '!', rot: 4, zone: 4 }),
  ])
  const list = setterSets([d], 'S')
  it('by reception (# + !), then by setter call after # and +, the most called first', () => {
    const { rows, labels } = setPanels(list, 'reception', { K1: 'Quick' })
    expect(rows[0].map(p => [p.title, p.sets.length])).toEqual([['# Reception', 2], ['+ Reception', 2], ['! Reception', 2]])
    expect(rows[1].map(p => [p.title, p.sets.length])).toEqual([['K1 Quick', 2], ['K7', 1], ['—', 0]])
    expect(labels).toEqual(['Reception', 'Setter call (# +)'])
  })
  it('by rotation: S1 S6 S5 over S4 S3 S2, after a # + or ! reception only', () => {
    const { rows, labels } = setPanels(list, 'rotation')
    expect(rows.map(r => r.map(p => p.title))).toEqual([['S1', 'S6', 'S5'], ['S4', 'S3', 'S2']])
    expect(rows.map(r => r.map(p => p.sets.length))).toEqual([[4, 1, 0], [1, 0, 0]])
    expect(labels).toBeNull()
  })
  it('draws six courts, each one group, inside the slide', () => {
    const anns = setterCourts(list, 'reception', {}, 'both', '#0F172A', { left: 0.19, top: 0.105, bottom: 0.985 })
    const groups = new Set(anns.map(a => a.groupId).filter(Boolean))
    expect(groups.size).toBe(6)
    expect(anns.filter(a => a.kind === 'text' && a.text === 'Zone2/1')).toHaveLength(6)
    for (const a of anns) if (a.kind === 'rect') { expect(a.x + a.w).toBeLessThanOrEqual(1); expect(a.y + a.h).toBeLessThanOrEqual(1) }
  })
})
