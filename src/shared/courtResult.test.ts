import { describe, expect, it } from 'vitest'
import { AFTER_END_SEC, afterPhase, afterSteps, playResult } from './courtResult'
import { afterOn, cleanGridStyle, type GridStyle, type PlayZones } from './court'

describe('playResult', () => {
  it('reads a serve or attack by its evaluation', () => {
    expect(playResult('S', '#')).toMatchObject({ kind: 'win', color: '#22C55E' })
    expect(playResult('A', '#')).toMatchObject({ kind: 'win' })
    expect(playResult('S', '=')).toMatchObject({ kind: 'lost', color: '#EF4444' })
    expect(playResult('A', '/')).toMatchObject({ kind: 'blocked', color: '#EF4444' })
  })
  it('keeps the evaluation symbol for a ball still in play, in the usual colour', () => {
    expect(playResult('S', '+')).toEqual({ kind: 'play', symbol: '+', color: null })
    expect(playResult('S', '/')).toMatchObject({ kind: 'play', symbol: '/' }) // on a serve a / is only an evaluation
    expect(playResult('A', '-')).toMatchObject({ kind: 'play', symbol: '-' })
  })
  it('has nothing for other skills or no evaluation', () => {
    expect(playResult('R', '#')).toBeNull()
    expect(playResult('S', '')).toBeNull()
    expect(playResult('A', undefined)).toBeNull()
  })
})

describe('afterPhase', () => {
  it('shows nothing before the landing or after it is over', () => {
    expect(afterPhase(-0.1)).toBeNull()
    expect(afterPhase(AFTER_END_SEC)).toBeNull()
  })
  it('pops the badge past its size and settles, holds, then fades', () => {
    expect(afterPhase(0)!.pop).toBeLessThan(0.1)
    expect(Math.max(...[0.1, 0.15, 0.2, 0.25].map(s => afterPhase(s)!.pop))).toBeGreaterThan(1)
    expect(afterPhase(1)).toMatchObject({ pop: 1, fade: 1 })
    expect(afterPhase(2.9)!.fade).toBeCloseTo(0.5)
  })
})

describe('afterSteps', () => {
  it('covers the effect without gaps', () => {
    const s = afterSteps()
    expect(s[0].from).toBe(0)
    expect(s[s.length - 1].to).toBe(AFTER_END_SEC)
    for (let i = 1; i < s.length; i++) expect(s[i].from).toBe(s[i - 1].to)
  })
})

describe('afterOn', () => {
  const style = { grid: true, color: '#fff', opacity: 1, lineWidth: 2, playZones: true, detail: 'zone' } as GridStyle
  const zones = (skill: string) => ({ skill } as PlayZones)
  it('is on for a serve or attack, unless both parts are off', () => {
    expect(afterOn(style, zones('S'))).toBe(true)
    expect(afterOn(style, zones('R'))).toBe(false)
    expect(afterOn({ ...style, resultMark: false }, zones('A'))).toBe(true)
    expect(afterOn({ ...style, resultMark: false, resultTint: false }, zones('A'))).toBe(false)
  })
  it('keeps a part in the style only when it is off', () => {
    expect(cleanGridStyle({ resultMark: false }).resultMark).toBe(false)
    expect(cleanGridStyle({ resultTint: true }).resultTint).toBeUndefined()
  })
})
