import { describe, expect, it } from 'vitest'
import { hasTiming, pieces, playedAt, playedSec, rateAt } from './timing'

describe('pieces', () => {
  it('is the clip at rate 1 without slows or holds', () => {
    expect(pieces(10, 20)).toEqual([{ kind: 'play', from: 10, to: 20, rate: 1 }])
    expect(pieces(20, 10)).toEqual([])
  })

  it('cuts a slow stretch in, clipped to IN–OUT, the slower one winning where two overlap', () => {
    expect(pieces(10, 20, { slows: [{ from: 12, to: 14, rate: 0.5 }] })).toEqual([
      { kind: 'play', from: 10, to: 12, rate: 1 }, { kind: 'play', from: 12, to: 14, rate: 0.5 }, { kind: 'play', from: 14, to: 20, rate: 1 },
    ])
    expect(pieces(10, 20, { slows: [{ from: 5, to: 11, rate: 0.5 }] })[0]).toEqual({ kind: 'play', from: 10, to: 11, rate: 0.5 })
    expect(pieces(10, 20, { slows: [{ from: 12, to: 16, rate: 0.5 }, { from: 14, to: 18, rate: 0.25 }] }).map(p => p.kind === 'play' && p.rate))
      .toEqual([1, 0.5, 0.25, 1]) // 14–18 at 0.25 is one piece
    expect(pieces(10, 20, { slows: [{ from: 30, to: 40, rate: 0.5 }] })).toEqual([{ kind: 'play', from: 10, to: 20, rate: 1 }]) // outside: ignored
  })

  it('puts holds where they fall, at IN and at OUT too, and leaves out the ones outside', () => {
    expect(pieces(10, 20, { holds: [{ at: 15, sec: 2 }, { at: 10, sec: 1 }, { at: 20, sec: 3 }, { at: 25, sec: 1 }] })).toEqual([
      { kind: 'hold', at: 10, sec: 1 }, { kind: 'play', from: 10, to: 15, rate: 1 }, { kind: 'hold', at: 15, sec: 2 },
      { kind: 'play', from: 15, to: 20, rate: 1 }, { kind: 'hold', at: 20, sec: 3 },
    ])
  })
})

describe('playedSec and playedAt', () => {
  const ps = pieces(10, 20, { slows: [{ from: 12, to: 14, rate: 0.5 }], holds: [{ at: 16, sec: 2 }] })

  it('a slow stretch takes longer and a hold adds its seconds', () => {
    expect(playedSec(ps)).toBeCloseTo(2 + 4 + 2 + 2 + 4) // 10–12, 12–14 at half speed, 14–16, hold, 16–20
  })

  it('maps video times onto the played clip; at a hold, start is before it and end after it', () => {
    expect(playedAt(ps, 10, 'start')).toBe(0)
    expect(playedAt(ps, 13, 'start')).toBeCloseTo(2 + 2)
    expect(playedAt(ps, 15, 'start')).toBeCloseTo(2 + 4 + 1)
    expect(playedAt(ps, 16, 'start')).toBeCloseTo(8)
    expect(playedAt(ps, 16, 'end')).toBeCloseTo(10)
    expect(playedAt(ps, 20, 'end')).toBeCloseTo(14)
    // An object shown from 15 to 17 stays up through the hold at 16.
    expect(playedAt(ps, 17, 'end') - playedAt(ps, 15, 'start')).toBeCloseTo(1 + 2 + 1)
  })

  it('rateAt and hasTiming', () => {
    expect(rateAt({ slows: [{ from: 12, to: 14, rate: 0.5 }] }, 13)).toBe(0.5)
    expect(rateAt({ slows: [{ from: 12, to: 14, rate: 0.5 }] }, 14)).toBe(1)
    expect(hasTiming({})).toBe(false)
    expect(hasTiming({ holds: [{ at: 1, sec: 1 }] })).toBe(true)
  })
})
