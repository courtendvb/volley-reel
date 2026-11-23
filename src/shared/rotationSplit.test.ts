import { describe, expect, it } from 'vitest'
import { byRotation, playerMarkers, rotationOf } from './rotationSplit'
import type { PlayRef } from './filter'
import type { Play } from './types'

let n = 0
interface O { ourRot?: number | null; oppRot?: number | null; teamRole?: 'our' | 'opp' | null; side?: '*' | 'a' | null; phase?: Play['phase']; recEffect?: string; effect?: string; person?: string; zone?: number | null; rally?: number }
const ref = (o: O): PlayRef => ({
  matchId: 'm', teamRole: o.teamRole ?? 'our', side: o.side === undefined ? '*' : o.side, teamCode: 'HTH', personKey: o.person ?? 'p', name: (o.person ?? 'p').toUpperCase(),
  ourRot: o.ourRot === undefined ? 1 : o.ourRot, oppRot: o.oppRot ?? null, tempo: null, combo: null, comboName: null, hit: null, dir: null,
  play: { id: n++, skill: 'A', effect: o.effect ?? '+', phase: o.phase ?? 'r', recEffect: o.recEffect, jersey: (o.person ?? 'p').charCodeAt(0) - 96, startZone: o.zone === undefined ? 4 : o.zone, rallyId: o.rally ?? null } as Play,
})

describe('rotation split', () => {
  it('goes by the rotation of the play’s own team', () => {
    expect(rotationOf(ref({ ourRot: 2, oppRot: 5 }))).toBe(2)
    expect(rotationOf(ref({ ourRot: 2, oppRot: 5, teamRole: 'opp' }))).toBe(5)
    expect(rotationOf(ref({ ourRot: 3, oppRot: 5, teamRole: null }))).toBe(3)
  })

  it('puts each rotation in its own marker, played in the order a team rotates', () => {
    const refs = [ref({ ourRot: 2 }), ref({ ourRot: 6 }), ref({ ourRot: 2 }), ref({ ourRot: 1 })]
    const r = byRotation(refs)
    expect(r.items.map(i => i.marker)).toEqual([2, 6, 2, 1])
    expect(r.counts).toEqual({ 1: 1, 2: 2, 6: 1 })
    expect(Object.keys(r.names)).toEqual(['1', '2', '6'])
    expect(r.names[6]).toBe('ローテ 6')
    expect(r.order).toEqual([1, 6, 5, 4, 3, 2])
    expect(r.rest).toBe(0)
  })

  it('counts plays with no rotation and leaves them out', () => {
    const r = byRotation([ref({ ourRot: null }), ref({ ourRot: 4 })])
    expect(r.skipped).toBe(1)
    expect(r.items.map(i => i.marker)).toEqual([4])
  })

  it('marks by player, the most attacks first, six at most', () => {
    const people = ['b', 'a', 'a', 'c', 'b', 'a', 'd', 'e', 'f', 'g']
    const g = playerMarkers(people.map(person => ref({ person })))
    expect(g.names).toEqual({ 1: '#1 A', 2: '#2 B', 3: '#3 C', 4: '#4 D', 5: '#5 E', 6: '#6 F' })
    expect(g.counts).toEqual({ 1: 3, 2: 2, 3: 1, 4: 1, 5: 1, 6: 1 })
    expect(g.items.map(i => i.marker)).toEqual([2, 1, 1, 3, 2, 1, 4, 5, 6, null])
    expect(g.rest).toBe(1)
  })
})
