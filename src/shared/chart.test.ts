import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CHART, cleanLineColors, cleanPointScale, lineColor, pointColor, setChartColors, chartBox, chartName, chartResult, chartStats, cleanChart, drawChart, servedFrom } from './chart'
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
    expect(s.mix).toEqual([['H', 0.5], ['P', 0.25], ['T', 0.25]])
  })
  it('is empty without attacks', () => {
    expect(chartStats([])).toMatchObject({ att: 0, pos: 0 })
    expect(chartStats([], 'S').mix).toEqual([])
  })
  it('shares out a serve by its type, the most used first', () => {
    const serve = (type: string, effect = '-') => ({ effect, code: `*05S${type}${effect}~~~16C` })
    const s = chartStats([serve('Q', '#'), serve('M'), serve('M', '='), serve('M', '/')], 'S')
    expect(s.mix).toEqual([['M', 0.75], ['Q', 0.25]])
    expect(s).toMatchObject({ att: 4, k: 1, e: 1, b: 1 })
  })
  it('sorts each result', () => {
    expect(['#', '=', '/', '+', '-', '!'].map(chartResult)).toEqual(['kill', 'error', 'blocked', 'pos', 'neg', 'neg'])
  })
})

describe('servedFrom', () => {
  it('squeezes the depth behind the end line into the strip, in order, and leaves the court alone', () => {
    const near = servedFrom({ x: 0.2, y: -1 / 18 }), far = servedFrom({ x: 0.2, y: -8 / 18 })
    expect(far.y).toBeLessThan(near.y)
    expect(far.y * 18).toBeGreaterThan(-1.2)
    expect(near.x).toBe(0.2)
    expect(servedFrom({ x: 0.4, y: 0.3 })).toEqual({ x: 0.4, y: 0.3 })
  })
})

describe('cleanChart', () => {
  it('puts back the usual values', () => {
    expect(cleanChart(null)).toEqual(DEFAULT_CHART)
    expect(cleanChart({ lineOpacity: 5, points: false, heat: true })).toMatchObject({ lineOpacity: 0.7, points: false, heat: true })
    expect(cleanChart({ scope: 'x', corner: 'x', scale: 9, lines: 'no', colors: { kill: 3 } })).toEqual({ ...DEFAULT_CHART, lines: true })
  })
  it('keeps what was set', () => {
    expect(cleanChart({ lines: false, stats: true, name: true, scope: 'filter', corner: 'bl', scale: 1.5, colors: { kill: '#000000' } }))
      .toMatchObject({ lines: false, stats: true, name: true, scope: 'filter', corner: 'bl', scale: 1.5, colors: { kill: '#000000', error: DEFAULT_CHART.colors.error } })
  })
})

describe('line colours by evaluation', () => {
  const plain = { colors: DEFAULT_CHART.colors }
  afterEach(() => setChartColors(undefined))
  it('starts from the usual colours of each skill', () => {
    const of = (skill: 'A' | 'S') => ['#', '+', '!', '-', '/', '='].map(e => lineColor(plain, e, skill))
    const [BLACK, GREEN, RED, GREY] = ['#000000', '#22C55E', '#DC2626', DEFAULT_CHART.colors.neg]
    expect(of('S')).toEqual([BLACK, GREEN, GREY, GREY, GREEN, DEFAULT_CHART.colors.error])
    expect(of('A')).toEqual([BLACK, GREEN, GREY, GREY, RED, RED])
  })
  it('takes the project\'s colours, each skill its own', () => {
    setChartColors({ lines: { S: { '#': '#FF00FF' } } })
    expect(lineColor(plain, '#', 'S')).toBe('#FF00FF')
    expect(lineColor(plain, '#', 'A')).toBe('#000000')
  })
  it('takes the project\'s point colours by evaluation, else the result\'s', () => {
    setChartColors({ points: { A: { '-': '#123456' } } })
    expect(pointColor(plain, '-', 'neg', 'A')).toBe('#123456')
    expect(pointColor(plain, '!', 'neg', 'A')).toBe(DEFAULT_CHART.colors.neg)
    expect(pointColor(plain, '-', 'neg', 'S')).toBe(DEFAULT_CHART.colors.neg)
    expect(pointColor(plain, undefined, 'kill', 'A')).toBe(DEFAULT_CHART.colors.kill)
  })
  it('keeps a point size in its narrow range', () => {
    expect([cleanPointScale(0.8), cleanPointScale(1), cleanPointScale(5), cleanPointScale('1.2')]).toEqual([0.8, undefined, undefined, undefined])
  })
  it('keeps only real evaluations and colours when read back', () => {
    expect(cleanLineColors({ S: { '#': '#111111', x: '#222222', '=': 3, '-': 'red' }, Q: { '#': '#333333' } })).toEqual({ S: { '#': '#111111' } })
    expect(cleanLineColors({ A: {} })).toBeUndefined()
    expect(cleanLineColors(null)).toBeUndefined()
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
  it('gives the title bar room back without the name, and shows neither until asked', () => {
    expect(chartBox(1280, 720, 'tr', 1, false).x).toBeLessThan(chartBox(1280, 720, 'tr', 1, true).x)
    expect([DEFAULT_CHART.name, DEFAULT_CHART.stats]).toEqual([false, false])
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
  const marks = (chart: object, extra?: object, play = plays[0]) => playerMarks(play, fit, { ...DEFAULT_GRID_STYLE, chart: { ...DEFAULT_CHART, scope: 'player', ...chart } }, () => plays, extra)
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
  it('keeps to the attack code unless told otherwise', () => {
    expect(playerMarks(plays[0], fit, { ...DEFAULT_GRID_STYLE, chart: DEFAULT_CHART }, () => plays)!.chart!.stats.att).toBe(3)
    expect(playerMarks(plays[2], fit, { ...DEFAULT_GRID_STYLE, chart: DEFAULT_CHART }, () => plays)!.chart!.stats.att).toBe(1)
  })
  it('can keep to the attack code, or the search', () => {
    expect(marks({ scope: 'code' })!.chart!.stats.att).toBe(3)
    expect(marks({ scope: 'filter' }, { filtered: () => [plays[1], plays[3]] })!.chart!.stats.att).toBe(1)
  })
  it('keeps to the serving player, and their start zone', () => {
    const serve = hit({ skill: 'S', code: '*05SQ-~~~16C', startZone: 1 }), other = hit({ skill: 'S', code: '*05SM+~~~56C', startZone: 5 })
    const list = [serve, other, plays[0]]
    const m = (chart: object) => playerMarks(serve, fit, { ...DEFAULT_GRID_STYLE, chart: { ...DEFAULT_CHART, ...chart } }, () => list)!.chart!
    expect(m({})).toMatchObject({ skill: 'S', stats: { att: 2 } }) // a serve has no attack code: the default shows them all
    expect(m({ scope: 'zone' }).stats.att).toBe(1)
    const log = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
    expect(() => drawChart(log, m({}), chartBox(1280, 720, 'center'))).not.toThrow()
  })
  it("draws a serve's starts as squares only when asked", () => {
    const serve = hit({ skill: 'S', code: '*05SQ-~~~16C', startZone: 1, startClick: { u: 0.8, v: -0.2 }, endClick: { u: 0.3, v: 0.8 } })
    const squares = (starts: boolean, skill: 'S' | 'A' = 'S') => {
      let n = 0
      const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : k === 'fillRect' ? () => { n++ } : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
      const c = playerMarks(serve, fit, { ...DEFAULT_GRID_STYLE, chart: { ...DEFAULT_CHART, lines: false, starts } }, () => [serve])!.chart!
      drawChart(ctx, { ...c, skill }, chartBox(1280, 720, 'center'))
      return n - 1 // the panel's own ground
    }
    expect(squares(false)).toBe(0)
    expect(squares(true)).toBe(1)
    expect(squares(true, 'A')).toBe(0)
  })
  it('does not come with other skills, and carries the name', () => {
    expect(marks({}, undefined, hit({ skill: 'R' }))).toBeNull()
    expect(marks({}, { name: '#7 Ken' })!.chart!.name).toBe('#7 Ken')
  })
  it('draws whatever is set', () => {
    const log = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D
    const c = marks({})!.chart!
    expect(() => drawChart(log, c, chartBox(1280, 720, 'tr'))).not.toThrow()
    expect(() => drawChart(log, { ...c, dots: [], look: { ...c.look, lines: false, stats: true, name: true } }, chartBox(1280, 720, 'center', 1, true))).not.toThrow()
  })
})
