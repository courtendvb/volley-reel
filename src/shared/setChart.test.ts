import { describe, expect, it } from 'vitest'
import { cleanSetChart, cleanSetCourt, cleanSetFilter, setBefore, setChart, setChartShows, setExtremes, setTarget, setterCall } from './setChart'
import type { Play } from './types'

let id = 0
const play = (over: Partial<Play>): Play => ({
  id: id++, side: '*', jersey: 9, playerKey: 'S', skill: 'E', effect: '+', rallyId: 0, setNum: 1, homeRot: 1, awayRot: 3,
  startZone: null, endZone: null, startClick: null, endClick: null, code: '', time: 0, ...over,
}) as Play
const set = (rallyId: number, over: Partial<Play> = {}) => play({ rallyId, startClick: { u: 0.6, v: 0.45 }, ...over })
const hit = (rallyId: number, startZone: number, effect: string, over: Partial<Play> = {}) => play({ skill: 'A', rallyId, startZone, effect, jersey: 4, playerKey: 'H', ...over })

describe('where a set went', () => {
  it('names the place by the attack\'s start zone, and the setter\'s own attack a dump', () => {
    expect([4, 3, 2, 1, 9, 8, 7].map(z => setTarget({ startZone: z, playerKey: 'H' }, 'S'))).toEqual(['left', 'middle', 'right', 'back', 'back', 'pipe', 'left'])
    expect(setTarget({ startZone: 2, playerKey: 'S' }, 'S')).toBe('dump')
  })
})

describe('the set chart', () => {
  const plays = [
    set(0), hit(0, 4, '#'), // left, kill
    set(1), hit(1, 4, '='), // left, lost
    set(2), hit(2, 3, '+'), // middle, in play
    set(3), play({ side: 'a', skill: 'D', rallyId: 3, playerKey: 'X' }), // the other team next: no attack
    hit(4, 2, '#', { playerKey: 'S', jersey: 9, startClick: { u: 0.7, v: 0.48 } }), // a dump
    set(5, { homeRot: 2 }), hit(5, 2, '#', { homeRot: 2 }), // another rotation: left out
    set(6, { playerKey: 'T', jersey: 1 }), hit(6, 8, '#'), // another setter: left out
  ]
  it('counts the setter\'s sets in the rotation by where they went, and the dumps', () => {
    const c = setChart(plays[0], plays, s => `#${s.jersey}`)!
    expect(c.title).toBe('#9')
    expect(c.rotation).toBe(1)
    expect(c.total).toBe(4)
    expect([c.kills, c.errors]).toEqual([2, 1])
    expect(c.by.left).toEqual({ n: 2, kills: 1 })
    expect(c.by.middle).toEqual({ n: 1, kills: 0 })
    expect(c.by.dump).toEqual({ n: 1, kills: 1 })
    expect(c.dots.map(d => [d.target, d.result])).toEqual([['left', 'kill'], ['left', 'lost'], ['middle', 'play'], ['dump', 'kill']])
  })
  it('puts each set where it was given, seen across the net', () => {
    const c = setChart(plays[0], plays)!
    expect(c.dots[0].at!.x).toBeCloseTo(0.4)
    expect(c.dots[0].at!.y).toBeCloseTo(0.9)
  })
  it('opens from the attack after a set too', () => {
    expect(setBefore(plays, plays[1])).toBe(plays[0])
    expect(setChart(plays[1], plays)?.total).toBe(4)
    expect(setChart(plays[8], plays)).toBeNull() // a dump has no set before it
  })
  it('reads its setting back safely', () => {
    expect(cleanSetChart({ corner: 'br', scale: 1.2 })).toEqual({ corner: 'br', scale: 1.2 })
    expect(cleanSetChart({ corner: 'x', scale: 9, view: 'nope' })).toEqual({ corner: 'tl', scale: 1 })
    expect(cleanSetChart({ view: 'zones' }).view).toBe('zones')
  })
  it('falls back to the zones alone when most sets have no click', () => {
    const c = setChart(plays[0], plays)!
    expect(setChartShows(c)).toBe('points')
    const bare = plays.map(p => (p.skill === 'E' ? { ...p, startClick: null } : p))
    const b = setChart(bare[0], bare)!
    expect(b.total).toBe(4) // counted all the same
    expect(setChartShows(b)).toBe('zones')
    expect(setChartShows(b, 'points')).toBe('points')
  })
  it('names the places most and least set to', () => {
    const c = setChart(plays[0], plays)!
    expect(setExtremes(c)).toEqual({ most: 'left', least: 'dump' }) // left 2; middle and the dump 1 each: the last of the least
    const one = setChart(plays[2], plays.slice(4, 6))!
    expect(setExtremes(one)).toEqual({ most: 'middle', least: null })
  })
  it('keeps the click of each set for the court, and its flip and layer settings', () => {
    const c = setChart(plays[0], plays)!
    expect(c.dots[0].click).toEqual({ u: 0.6, v: 0.45 })
    expect(cleanSetChart({ flip: true }).flip).toBe(true)
    expect(cleanSetChart({}).flip).toBeUndefined()
    expect(cleanSetCourt({ layer: 'spots' })).toEqual({ layer: 'spots' })
    expect(cleanSetCourt({ layer: 'x' })).toEqual({ layer: 'shares' })
  })
  it('keeps to the rotations, setter calls and the other team rotations asked for', () => {
    const coded = [
      set(10, { code: '*09EH+KAF~3B' }), hit(10, 4, '#'),
      set(11, { code: '*09EH+K1F~3B', awayRot: 5 }), hit(11, 3, '#'),
      set(12, { code: '*09EH+KAF~3B', homeRot: 4 }), hit(12, 2, '=', { homeRot: 4 }),
      hit(13, 2, '#', { playerKey: 'S', jersey: 9 }), // a dump
    ]
    expect(setterCall(coded[0])).toBe('KA')
    expect(setChart(coded[0], coded)!.total).toBe(3) // rotation 1: two sets and the dump
    expect(setChart(coded[0], coded, () => '', { rot: 'all' })!.total).toBe(4)
    expect(setChart(coded[0], coded, () => '', { rot: 'all' })!.rotLabel).toBe('All')
    const ka = setChart(coded[0], coded, () => '', { rot: 'all', calls: ['KA'] })!
    expect([ka.total, ka.by.dump.n, ka.filtered]).toEqual([2, 0, 'KA'])
    const opp = setChart(coded[0], coded, () => '', { oppRots: [5] })!
    expect([opp.total, opp.by.middle.n, opp.filtered]).toEqual([1, 1, 'Opp R5'])
    expect(setChart(coded[0], coded, () => '', { rot: [1, 4] })!.rotLabel).toBe('S1/S4')
  })
  it('reads the filter back safely', () => {
    expect(cleanSetFilter({ rot: [9, 2, 2, 'x'], calls: ['KA', 'bad', 3], oppRots: [] })).toEqual({ rot: [2], calls: ['KA'] })
    expect(cleanSetFilter({ rot: 'all' })).toEqual({ rot: 'all' })
    expect(cleanSetFilter(null)).toEqual({})
  })
  it('keeps to the phase, the reception it came from and the score', () => {
    const list = [
      set(20, { phase: 'r', recEffect: '#', score: { home: 3, away: 5 } }), hit(20, 4, '#'),
      set(21, { phase: 'r', recEffect: '-', score: { home: 12, away: 5 } }), hit(21, 3, '#'),
      set(22, { phase: 't', score: { home: 21, away: 20 } }), hit(22, 2, '='),
    ]
    expect(setChart(list[0], list)!.total).toBe(3)
    expect(setChart(list[0], list, () => '', { phases: ['t'] })!.by.right.n).toBe(1)
    const good = setChart(list[0], list, () => '', { recs: ['#', '+'] })!
    expect([good.total, good.by.left.n, good.filtered]).toEqual([1, 1, 'R #+'])
    const late = setChart(list[0], list, () => '', { scores: ['mid', 'late'] })!
    expect([late.total, late.filtered]).toEqual([2, 'Pts 10–19, 20–'])
    expect(setChart(list[0], list, () => '', { phases: ['r'] })!.filtered).toBe('Rec')
    expect(cleanSetFilter({ phases: ['r', 'x'], recs: ['#', '?'], scores: ['late', 'soon'] })).toEqual({ phases: ['r'], recs: ['#'], scores: ['late'] })
  })
})
