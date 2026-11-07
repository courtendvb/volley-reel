import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART, chartBox, chartName, chartResult, chartStats, cleanChart, drawChart } from './chart'
import { DEFAULT_GRID_STYLE, playerMarks, type CourtFit, DEFAULT_CORNERS } from './court'
import type { ParsedDVW, Play } from './types'

const fit: CourtFit = { corners: DEFAULT_CORNERS, nearSet1: '*' }
const code = (hit: string) => `*07AQ#X5~46${'A'}${hit}1`.padEnd(13, '~')
const shot = (effect: string, hit = 'H') => ({ effect, code: `*07AQ${effect}X5~46C${hit}2` })

describe('chartStats', () => {
  it('gives the numbers of a chart', () => {
    const plays = [
      ...Array(8).fill(shot('#')), shot('='), ...Array(2).fill(shot('/')), ...Array(3).fill(shot('+')),
      ...Array(5).fill(shot('-')), ...Array(2).fill(shot('!')),
    ]
    const s = chartStats(plays)
    expect(s).toMatchObject({ att: 21, k: 8, e: 1, b: 2 })
    expect(s.pos).toBeCloseTo(3 / 21)
    expect(s.neg).toBeCloseTo(7 / 21)
    expect((s.e + s.b) / s.att).toBeCloseTo(0.14, 2)
  })
  it('shares out hard, pushed and tipped attacks', () => {
    const s = chartStats([shot('#', 'H'), shot('#', 'H'), shot('#', 'P'), shot('#', 'T')])
    expect([s.hard, s.push, s.tip]).toEqual([0.5, 0.25, 0.25])
  })
  it('is empty without attacks', () => {
    expect(chartStats([])).toMatchObject({ att: 0, pos: 0, hard: 0 })
  })
  it('sorts each result', () => {
    expect(['#', '=', '/', '+', '-', '!'].map(chartResult)).toEqual(['kill', 'error', 'blocked', 'pos', 'neg', 'neg'])
  })
})

describe('cleanChart', () => {
  it('puts back the usual values', () => {
    expect(cleanChart(null)).toEqual(DEFAULT_CHART)
    expect(cleanChart({ scope: 'x', corner: 'x', scale: 9, lines: 'no', colors: { kill: 3 } })).toEqual({ ...DEFAULT_CHART, lines: true })
  })
  it('keeps what was set', () => {
    expect(cleanChart({ lines: false, stats: false, scope: 'filter', corner: 'bl', scale: 1.5, colors: { kill: '#000000' } }))
      .toMatchObject({ lines: false, stats: false, scope: 'filter', corner: 'bl', scale: 1.5, colors: { kill: '#000000', error: DEFAULT_CHART.colors.error } })
  })
})

describe('chartBox', () => {
  it('stays in the picture in each corner, at its largest', () => {
    for (const c of ['tl', 'tr', 'bl', 'br'] as const) {
      const b = chartBox(1280, 720, c, 2)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y + b.h).toBeLessThanOrEqual(720)
    }
  })
  it('sits in the middle on a slide', () => {
    expect(chartBox(1280, 720, 'center').y).toBeCloseTo(720 * 0.04)
  })
})

describe('chartName', () => {
  it('names the player, or the number alone', () => {
    const dvw = { players: { '*7': { jersey: 7, firstName: 'Ken', lastName: 'Tanaka' } } } as unknown as ParsedDVW
    expect(chartName(dvw, { side: '*', jersey: 7 })).toBe('#7 Ken Tanaka')
    expect(chartName(undefined, { side: '*', jersey: 7 })).toBe('#7')
  })
})

describe('the chart of a player', () => {
  const base = { side: '*', setNum: 1, score: { home: 0, away: 0 }, rallyId: 1, playerKey: 'a', startSub: null, endSub: null, skill: 'A', startZone: 4, endZone: 6, effect: '#' }
  const hit = (extra: object) => ({ ...base, code: code('H'), startClick: { u: 0.1, v: 0.45 }, endClick: { u: 0.5, v: 0.9 }, ...extra }) as unknown as Play
  const plays = [hit({}), hit({ effect: '=' }), hit({ code: '*07AQ#V5~46CH2' }), hit({ playerKey: 'b' }), hit({ skill: 'S' }), hit({ startClick: null, endClick: null })]
  const marks = (chart: object, extra?: object, play = plays[0]) => playerMarks(play, fit, { ...DEFAULT_GRID_STYLE, chart: { ...DEFAULT_CHART, ...chart } }, () => plays, extra)
  it('takes all their attacks, zones only ones too, and marks those', () => {
    const c = marks({})!.chart!
    expect(c.stats.att).toBe(4)
    expect(c.dots.filter(d => d.rough)).toHaveLength(1)
    expect(c.dots[0].result).toBe('kill')
    expect(c.dots[1].result).toBe('error')
  })
  it('goes from the attacker at the top to the other end at the bottom', () => {
    const d = marks({})!.chart!.dots[0]
    expect(d.start!.y).toBeLessThan(0.5)
    expect(d.end!.y).toBeGreaterThan(0.5)
  })
  it('can keep to the attack code, or the search', () => {
    expect(marks({ scope: 'code' })!.chart!.stats.att).toBe(3)
    expect(marks({ scope: 'filter' }, { filtered: () => [plays[1], plays[3]] })!.chart!.stats.att).toBe(1)
  })
  it('only comes with an attack, and carries the name', () => {
    expect(marks({}, undefined, plays[4])).toBeNull()
    expect(marks({}, { name: '#7 Ken' })!.chart!.name).toBe('#7 Ken')
  })
  it('draws whatever is set', () => {
    const log = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
    const c = marks({})!.chart!
    expect(() => drawChart(log, c, chartBox(1280, 720, 'tr'))).not.toThrow()
    expect(() => drawChart(log, { ...c, dots: [], look: { ...c.look, lines: false, stats: false } }, chartBox(1280, 720, 'center'))).not.toThrow()
  })
})
