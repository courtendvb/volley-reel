import { describe, expect, it } from 'vitest'
import { playTimes, serveMarkOf, withServeMark } from './serveMark'

describe('serve marks on a match', () => {
  const m = { id: 'm' } as { id: string; serveMarks?: Record<string, { hit?: number; touch?: number }> }
  it('sets a time to the millisecond, keeps the other, and goes when both are cleared', () => {
    const hit = withServeMark(m, 'f1', { hit: 281.18049 })
    expect(hit.serveMarks).toEqual({ f1: { hit: 281.18 } })
    const both = withServeMark(hit, 'f1', { touch: 281.882 })
    expect(serveMarkOf(both, { fingerprint: 'f1' })).toEqual({ hit: 281.18, touch: 281.882 })
    expect(withServeMark(both, 'f1', { hit: null }).serveMarks).toEqual({ f1: { touch: 281.882 } })
    expect('serveMarks' in withServeMark(both, 'f1', { hit: null, touch: null })).toBe(false)
    expect(withServeMark(both, 'f2', { hit: 5 }).serveMarks).toEqual({ f1: { hit: 281.18, touch: 281.882 }, f2: { hit: 5 } })
    expect(m.serveMarks).toBeUndefined() // the match given is left as it was
  })
  it('refuses a time that is not one', () => {
    expect(() => withServeMark(m, 'f', { touch: NaN })).toThrow()
    expect(() => withServeMark(m, 'f', { hit: -1 })).toThrow()
  })
  it("puts the play's hit over the clip's red line and keeps the clip's speed", () => {
    expect(playTimes({ hit: 10.2, touch: 10.9 }, { skillSec: 10.5, speedKmh: 80 })).toEqual({ skillSec: 10.2, touchSec: 10.9, speedKmh: 80 })
    expect(playTimes({ touch: 10.9 }, { skillSec: 10.5 })).toEqual({ skillSec: 10.5, touchSec: 10.9 })
    expect(playTimes(undefined, null)).toEqual({})
  })
})
