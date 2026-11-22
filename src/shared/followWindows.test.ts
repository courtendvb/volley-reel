import { describe, expect, it } from 'vitest'
import { FOLLOW_LEAD_SEC, followAt, followWindows } from './overlay'

const L = FOLLOW_LEAD_SEC
// A rally: serve, reception a second later, attack three seconds after; then the next serve 20 s on.
const plays = [{ id: 3, time: 104 }, { id: 1, time: 100 }, { id: 2, time: 101 }, { id: 4, time: 124 }]

describe('followWindows', () => {
  const ws = followWindows(plays, 10, 4)
  it('puts the plays in time order, each up just before its contact', () => {
    expect(ws.map(w => w.playId)).toEqual([1, 2, 3, 4])
    expect(ws[0].from).toBeCloseTo(110 - L)
  })
  it('hands over to the next play as it comes', () => {
    expect(ws[0].to).toBeCloseTo(111 - L)
    expect(ws[1].to).toBeCloseTo(114 - L)
  })
  it('lets a play go after holdSec when nothing follows soon', () => {
    expect(ws[2].to).toBeCloseTo(118)
    expect(ws[3].to).toBeCloseTo(138)
  })
  it('drops a play with no time of its own (one at the same moment as the next)', () => {
    expect(followWindows([{ id: 1, time: 5 }, { id: 2, time: 5 }], 0, 4).map(w => w.playId)).toEqual([2])
  })
})

describe('followAt', () => {
  const ws = followWindows(plays, 10, 4)
  it('finds the play under the playhead', () => {
    expect(followAt(ws, 110.5)).toBe(0)
    expect(followAt(ws, 112)).toBe(1)
    expect(followAt(ws, 117)).toBe(2)
  })
  it('is none between rallies and before the first play', () => {
    expect(followAt(ws, 120)).toBe(-1)
    expect(followAt(ws, 50)).toBe(-1)
    expect(followAt([], 10)).toBe(-1)
  })
})
