import { describe, expect, it } from 'vitest'
import { FORECAST_COUNT_SEC, FORECAST_FADE_SEC, FORECAST_RAMP_SEC, forecastPhase, forecastSteps } from './courtForecast'
import { cleanGridStyle, forecastOn, type GridStyle, type PlayZones } from './court'

describe('forecastPhase', () => {
  it('shows the ghost from the start, clearer as the hit nears', () => {
    expect(forecastPhase(-30, 1)!.ghost).toBeCloseTo(0.45)
    expect(forecastPhase(0, 1)!.ghost).toBeCloseTo(0.8)
    expect(forecastPhase(-FORECAST_RAMP_SEC / 2, 1)!.ghost).toBeGreaterThan(0.3)
  })
  it('counts in only just before the hit, closing on it', () => {
    expect(forecastPhase(-FORECAST_COUNT_SEC - 0.1, 1)!.count).toBeNull()
    const early = forecastPhase(-FORECAST_COUNT_SEC, 1)!.count!, late = forecastPhase(-0.05, 1)!.count!
    expect(early.size).toBeGreaterThan(late.size)
    expect(late.alpha).toBeGreaterThan(early.alpha)
    expect(forecastPhase(0.3, 1)!.count).toBeNull()
  })
  it('draws the landing ring in as the ball comes, and fades everything after the landing', () => {
    expect(forecastPhase(-5, 1)!.reach).toBeCloseTo(1.7)
    expect(forecastPhase(1, 1)!.reach).toBe(1)
    expect(forecastPhase(1 + FORECAST_FADE_SEC / 2, 1)!.ghost).toBeCloseTo(0.4)
    expect(forecastPhase(1 + FORECAST_FADE_SEC, 1)).toBeNull()
  })
})

describe('forecastSteps', () => {
  it('covers the clip from its first frame to the end of the fade without gaps', () => {
    const s = forecastSteps(1.2)
    expect(s[0].from).toBe(-Infinity)
    expect(s[s.length - 1].to).toBeCloseTo(1.2 + FORECAST_FADE_SEC)
    for (let i = 1; i < s.length; i++) expect(s[i].from).toBeCloseTo(s[i - 1].to)
    expect(s.length).toBeLessThan(40)
  })
})

describe('forecastOn', () => {
  const zones = { skill: 'S', points: { start: { x: 0.5, y: 1.1 }, end: { x: 0.5, y: 0.2 }, startZ: 2.5 } } as unknown as PlayZones
  const style = { grid: true, color: '#fff', opacity: 1, lineWidth: 2, playZones: true, detail: 'point', flight: true } as GridStyle
  it('is on with the moving curve of a serve or attack, unless turned off', () => {
    expect(forecastOn(style, zones)).toBe(true)
    expect(forecastOn({ ...style, forecast: false }, zones)).toBe(false)
    expect(forecastOn({ ...style, flightStill: true }, zones)).toBe(false)
    expect(forecastOn({ ...style, flight: false }, zones)).toBe(false)
    expect(forecastOn(style, { ...zones, skill: 'R' } as PlayZones)).toBe(false)
  })
  it('is kept in the style only when off', () => {
    expect(cleanGridStyle({ forecast: false }).forecast).toBe(false)
    expect(cleanGridStyle({ forecast: true }).forecast).toBeUndefined()
  })
})
