import { describe, expect, it } from 'vitest'
import { courtWindows, setFreezes, SERVE_HOLD_SEC, SET_FREEZE_AFTER_SEC, SET_FREEZE_AFTER_SERVE_SEC, SET_FREEZE_SEC, type FollowPlay } from './courtFollow'
import { FOLLOW_LEAD_SEC as L } from './overlay'

const serve = (id: number, time: number): FollowPlay => ({ id, time, skill: 'S' })
const rec = (id: number, time: number): FollowPlay => ({ id, time, skill: 'R' })
const set = (id: number, time: number, recEffect: string, phase: 'r' | 't' = 'r'): FollowPlay => ({ id, time, skill: 'E', phase, recEffect })
const atk = (id: number, time: number): FollowPlay => ({ id, time, skill: 'A' })

describe('courtWindows: the serve', () => {
  it('keeps the serve up for at least SERVE_HOLD_SEC though the reception is logged a second later', () => {
    const ws = courtWindows([serve(1, 100), rec(2, 101), atk(3, 105)], 10, 4)
    const s = ws.find(w => w.playId === 1)!, r = ws.find(w => w.playId === 2)!
    expect(s.to - s.from).toBeGreaterThanOrEqual(SERVE_HOLD_SEC - 1e-9)
    expect(r.from).toBeGreaterThanOrEqual(s.to - 1e-9)
  })
  it('does not drop the serve when the reception is in the same second', () => {
    expect(courtWindows([serve(1, 100), rec(2, 100)], 0, 4).map(w => w.playId)).toEqual([1, 2])
  })
  it('lets the reception come a little late when there is room', () => {
    const ws = courtWindows([serve(1, 100), rec(2, 108)], 0, 4)
    expect(ws.find(w => w.playId === 2)!.from).toBeGreaterThan(108 - L)
  })
  it('windows never overlap and stay in order', () => {
    const ws = courtWindows([serve(1, 100), rec(2, 101), set(3, 102, '#'), atk(4, 103), serve(5, 130)], 0, 4)
    for (let i = 1; i < ws.length; i++) expect(ws[i].from).toBeGreaterThanOrEqual(ws[i - 1].to - 1e-9)
  })
})

describe('setFreezes', () => {
  it('stops before the set after a #, + or ! reception only', () => {
    for (const e of ['#', '+', '!']) expect(setFreezes([serve(1, 100), rec(2, 101), set(3, 103, e)], 0).map(f => f.playId)).toEqual([3])
    for (const e of ['-', '/', '=']) expect(setFreezes([serve(1, 100), rec(2, 101), set(3, 103, e)], 0)).toEqual([])
  })
  it('stops as long as asked, and not at all for 0', () => {
    const plays = [serve(1, 100), rec(2, 101), set(3, 103, '#'), atk(4, 104)]
    expect(setFreezes(plays, 0, 3.5)[0].sec).toBe(3.5)
    expect(setFreezes(plays, 0, 0)).toEqual([])
    expect(courtWindows(plays, 0, 4, 0).some(w => w.shares)).toBe(false)
  })
  it('leaves a transition set alone', () => {
    expect(setFreezes([serve(1, 100), rec(2, 101), set(3, 103, '#', 't')], 0)).toEqual([])
  })
  it('stops a fixed time after the serve, wherever the set was logged', () => {
    const [f] = setFreezes([serve(1, 100), rec(2, 101), set(3, 103, '#')], 10)
    expect(f.at).toBeCloseTo(110 + SET_FREEZE_AFTER_SERVE_SEC)
    expect(f.sec).toBe(SET_FREEZE_SEC)
    expect(setFreezes([serve(1, 100), rec(2, 101), set(3, 105, '#')], 10)[0].at).toBeCloseTo(110 + SET_FREEZE_AFTER_SERVE_SEC)
  })
  it('takes the rally’s own serve, not an earlier one', () => {
    expect(setFreezes([serve(1, 80), rec(2, 81), serve(3, 100), rec(4, 101), set(5, 103, '#')], 0)[0].at).toBeCloseTo(100 + SET_FREEZE_AFTER_SERVE_SEC)
  })
  it('falls back to a little after the set when no serve is logged before it', () => {
    expect(setFreezes([rec(2, 101), set(3, 103, '#')], 10)[0].at).toBeCloseTo(113 + SET_FREEZE_AFTER_SEC)
  })
  it('gives the set a window that draws the distribution', () => {
    const ws = courtWindows([serve(1, 100), rec(2, 101), set(3, 103, '#'), atk(4, 103)], 0, 4)
    const w = ws.find(x => x.playId === 3)!
    expect(w.shares).toBe(true)
    expect(ws.filter(x => x.shares)).toHaveLength(1)
  })
  it('opens that window a little before the stop, for a video that lands on the frame before it', () => {
    const [f] = setFreezes([serve(1, 100), rec(2, 101), set(3, 103, '#')], 0)
    const w = courtWindows([serve(1, 100), rec(2, 101), set(3, 103, '#'), atk(4, 106)], 0, 4).find(x => x.shares)!
    expect(w.from).toBeLessThan(f.at - 0.05)
    expect(w.to).toBeGreaterThan(f.at)
  })
  it('closes that window right after the stop, though nothing follows the set', () => {
    const [f] = setFreezes([serve(1, 100), rec(2, 101), set(3, 103, '#')], 0)
    const w = courtWindows([serve(1, 100), rec(2, 101), set(3, 103, '#')], 0, 4).find(x => x.shares)!
    expect(w.to).toBeLessThan(f.at + 0.2)
  })
  it('lets the attack in right after the stop', () => {
    const [f] = setFreezes([serve(1, 100), rec(2, 101), set(3, 102, '#'), atk(4, 102)], 0)
    const a = courtWindows([serve(1, 100), rec(2, 101), set(3, 102, '#'), atk(4, 102)], 0, 4).find(x => x.playId === 4)!
    expect(a.from).toBeLessThan(f.at + 0.2)
  })
})

describe('courtWindows: ahead of the contact', () => {
  it('opens a serve or an attack earlier by aheadSec, and leaves a reception as it was', () => {
    const base = courtWindows([serve(1, 100), rec(2, 101), atk(3, 105)], 10, 4)
    const ahead = courtWindows([serve(1, 100), rec(2, 101), atk(3, 105)], 10, 4, 0, 1)
    expect(ahead[0].from).toBeCloseTo(base[0].from - 0.7)
    expect(ahead[ahead.length - 1].from).toBeCloseTo(base[base.length - 1].from - 0.7)
    expect(ahead[1].from).toBeCloseTo(base[1].from)
  })
})
