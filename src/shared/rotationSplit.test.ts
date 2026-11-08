import { describe, expect, it } from 'vitest'
import { rotationOf, splitByRotation } from './rotationSplit'
import type { PlayRef } from './filter'
import type { Play } from './types'

let n = 0
interface O { ourRot?: number | null; oppRot?: number | null; teamRole?: 'our' | 'opp' | null; side?: '*' | 'a' | null; phase?: Play['phase']; recEffect?: string; effect?: string; person?: string; zone?: number | null; rally?: number }
const ref = (o: O): PlayRef => ({
  matchId: 'm', teamRole: o.teamRole ?? 'our', side: o.side === undefined ? '*' : o.side, teamCode: 'HTH', personKey: o.person ?? 'p', name: (o.person ?? 'p').toUpperCase(),
  ourRot: o.ourRot === undefined ? 1 : o.ourRot, oppRot: o.oppRot ?? null, tempo: null, combo: null, comboName: null, hit: null, dir: null,
  play: { id: n++, skill: 'A', effect: o.effect ?? '+', phase: o.phase ?? 'r', recEffect: o.recEffect, jersey: (o.person ?? 'p').charCodeAt(0) - 96, startZone: o.zone === undefined ? 4 : o.zone, rallyId: o.rally ?? null } as Play,
})
const markers = (refs: PlayRef[], by: Parameters<typeof splitByRotation>[1], wonBy?: Parameters<typeof splitByRotation>[2]) => splitByRotation(refs, by, wonBy).groups[0]

describe('rotation split', () => {
  it('goes by the rotation of the play’s own team', () => {
    expect(rotationOf(ref({ ourRot: 2, oppRot: 5 }))).toBe(2)
    expect(rotationOf(ref({ ourRot: 2, oppRot: 5, teamRole: 'opp' }))).toBe(5)
    expect(rotationOf(ref({ ourRot: 3, oppRot: 5, teamRole: null }))).toBe(3)
  })

  it('makes one group per rotation with plays, in the order a team rotates', () => {
    const refs = [ref({ ourRot: 2 }), ref({ ourRot: 6 }), ref({ ourRot: 2 }), ref({ ourRot: 1 })]
    const r = splitByRotation(refs, 'none')
    expect(r.groups.map(g => g.rot)).toEqual([1, 6, 2])
    expect(r.groups[2].items.map(i => i.ref)).toEqual([refs[0], refs[2]])
    expect(r.groups[2].rest).toBe(2)
  })

  it('counts plays with no rotation and leaves them out', () => {
    const r = splitByRotation([ref({ ourRot: null }), ref({ ourRot: 4 })], 'none')
    expect(r.skipped).toBe(1)
    expect(r.groups.map(g => g.rot)).toEqual([4])
  })

  it('marks by the reception the attack came from', () => {
    const g = markers([ref({ recEffect: '#' }), ref({ recEffect: '+' }), ref({ recEffect: '-' }), ref({ recEffect: '!' }), ref({ phase: 't' })], 'reception')
    expect(g.items.map(i => i.marker)).toEqual([1, 1, 2, 2, null])
    expect(g.counts).toEqual({ 1: 2, 2: 2 })
    expect(g.rest).toBe(1)
    expect(Object.keys(g.names)).toEqual(['1', '2'])
  })

  it('marks by player, the most attacks first, five at most', () => {
    const people = ['b', 'a', 'a', 'c', 'b', 'a', 'd', 'e', 'f']
    const g = markers(people.map(person => ref({ person })), 'player')
    expect(g.names).toEqual({ 1: '#1 A', 2: '#2 B', 3: '#3 C', 4: '#4 D', 5: '#5 E' })
    expect(g.counts).toEqual({ 1: 3, 2: 2, 3: 1, 4: 1, 5: 1 })
    expect(g.items.map(i => i.marker)).toEqual([2, 1, 1, 3, 2, 1, 4, 5, null])
    expect(g.rest).toBe(1)
  })

  it('marks by the zone attacked from, the most first', () => {
    const g = markers([ref({ zone: 2 }), ref({ zone: 4 }), ref({ zone: 4 }), ref({ zone: null })], 'zone')
    expect(g.items.map(i => i.marker)).toEqual([2, 1, 1, null])
    expect(Object.values(g.names)).toHaveLength(2)
  })

  it('marks by result: a kill, the rally won anyway, the rally lost', () => {
    const won = (r: PlayRef) => (r.play.rallyId === 1 ? '*' : r.play.rallyId === 2 ? 'a' : null)
    const g = markers([ref({ effect: '#', rally: 1 }), ref({ rally: 1 }), ref({ effect: '=', rally: 2 }), ref({ rally: 3 }), ref({ side: null, rally: 1 })], 'result', won)
    expect(g.items.map(i => i.marker)).toEqual([1, 2, 3, null, null])
    expect(g.counts).toEqual({ 1: 1, 2: 1, 3: 1 })
    expect(Object.keys(g.names)).toEqual(['1', '2', '3'])
  })

  it('leaves everything unmarked when not split', () => {
    const g = markers([ref({ recEffect: '#' })], 'none')
    expect(g.items[0].marker).toBe(null)
    expect(g.names).toEqual({})
  })
})
