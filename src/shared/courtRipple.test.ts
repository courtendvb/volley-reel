import { describe, expect, it } from 'vitest'
import { cleanGridStyle } from './courtStyle'
import { RIPPLE_END_SEC, ripplePhase, rippleSteps } from './courtHeat'

describe('ripplePhase', () => {
  it('shows nothing before the landing or after 3 s', () => {
    expect(ripplePhase(-0.01)).toBeNull()
    expect(ripplePhase(RIPPLE_END_SEC)).toBeNull()
  })
  it('spreads from nothing to 12 m in 0.8 s, then holds', () => {
    expect(ripplePhase(0)!.radius).toBe(0)
    expect(ripplePhase(0.1)!.radius).toBeGreaterThan(6) // a burst: past half way in the first eighth
    expect(ripplePhase(0.4)!.radius).toBeGreaterThan(11) // then it slows to a stop
    expect(ripplePhase(0.8)!.radius).toBeCloseTo(12)
    expect(ripplePhase(0.8)!.ring).toBe(0)
    expect(ripplePhase(1.5)).toMatchObject({ radius: 12, fade: 1, rings: [] })
  })
  it('has an echo a moment behind the ring, fainter', () => {
    const r = ripplePhase(0.3)!.rings
    expect(r).toHaveLength(2)
    expect(r[1].radius).toBeLessThan(r[0].radius)
    expect(r[1].strength).toBeLessThan(r[0].strength)
    expect(ripplePhase(0.85)!.rings).toHaveLength(1) // the echo outlasts the ring a little
  })
  it('fades out between 2.3 s and 3 s', () => {
    expect(ripplePhase(2.3)!.fade).toBe(1)
    expect(ripplePhase(2.65)!.fade).toBeCloseTo(0.5)
  })
})

describe('rippleSteps', () => {
  it('covers 0 to 3 s without gaps', () => {
    const s = rippleSteps()
    expect(s[0].from).toBe(0)
    expect(s[s.length - 1].to).toBeCloseTo(3)
    s.slice(1).forEach((x, i) => expect(x.from).toBeCloseTo(s[i].to))
  })
})

describe('cleanGridStyle ripple', () => {
  it('keeps the ripple only with the heatmap', () => {
    const g = cleanGridStyle({ bySkill: { S: { heat: true, ripple: true }, A: { ripple: true }, E: {} } })
    expect(g.bySkill?.S?.ripple).toBe(true)
    expect(g.bySkill?.A?.ripple).toBeUndefined()
  })
})
