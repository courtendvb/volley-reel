import { describe, expect, it } from 'vitest'
import { attackSlide, hotSpot, inCondition, setterRowOf } from './attackBoard'
import { boardPlayers, boardSlide } from './board'
import { DEFAULT_CHART } from './chart'
import { attackerSetChart } from './setChart'
import type { ParsedDVW, Play } from './types'

const play = (over: object) => ({ side: 'a', jersey: 92, playerKey: 'K', skill: 'A', effect: '+', rallyId: 0, setNum: 1, score: { home: 0, away: 0 }, startZone: 2, endZone: 5, startSub: null, endSub: null,
  code: 'a92AH-X5~~~H', phase: 'r', recEffect: '#', homeRot: 1, awayRot: 1, startClick: { u: 0.85, v: 0.42 }, endClick: { u: 0.1, v: 0.85 }, ...over }) as unknown as Play
const set = (over: object = {}) => play({ skill: 'E', jersey: 3, playerKey: 'S', code: 'a03EH', startClick: { u: 0.6, v: 0.45 }, ...over })
const match = (plays: Play[]) => ({
  teams: [{ code: 'den', name: 'Denmark' }, { code: 'nor', name: 'Norway' }],
  players: { a92: { key: 'K', side: 'a', jersey: 92, lastName: 'Kvalen', firstName: 'Jonas' }, a3: { key: 'S', side: 'a', jersey: 3, lastName: 'Setter', firstName: '' } },
  rallies: [{ id: 0, wonBy: 'a' }, { id: 1, wonBy: '*' }, { id: 2, wonBy: 'a' }],
  plays,
}) as unknown as ParsedDVW

describe('the conditions', () => {
  it('splits attacks by the pass before them, or transition', () => {
    expect(inCondition({ phase: 'r', recEffect: '#' }, 'good')).toBe(true)
    expect(inCondition({ phase: 'r', recEffect: '+' }, 'good')).toBe(true)
    expect(inCondition({ phase: 'r', recEffect: '!' }, 'good')).toBe(false)
    expect(inCondition({ phase: 'r', recEffect: '!' }, 'poor')).toBe(true)
    expect(inCondition({ phase: 'r', recEffect: '-' }, 'poor')).toBe(true)
    expect(inCondition({ phase: 't' }, 'trans')).toBe(true)
    expect(inCondition({ phase: 't' }, 'good')).toBe(false)
  })
  it('tells the setter in the front row from rotations 2 to 4, of the attacking side', () => {
    expect(setterRowOf({ side: 'a', homeRot: 1, awayRot: 3 })).toBe('front')
    expect(setterRowOf({ side: 'a', homeRot: 3, awayRot: 6 })).toBe('back')
    expect(setterRowOf({ side: '*', homeRot: 4, awayRot: 1 })).toBe('front')
    expect(setterRowOf({ side: '*', homeRot: null, awayRot: 1 })).toBe(null)
  })
})

describe('hotSpot', () => {
  it('finds where most points lie, and their middle', () => {
    const s = hotSpot([{ u: 0.1, v: 0.9 }, { u: 0.12, v: 0.9 }, { u: 0.1, v: 0.92 }, { u: 0.9, v: 0.6 }])!
    expect(s.n).toBe(3)
    expect(s.u).toBeCloseTo(0.1067, 3)
  })
  it('gives none when too few are together', () => {
    expect(hotSpot([{ u: 0.1, v: 0.9 }, { u: 0.9, v: 0.6 }])).toBeNull()
  })
})

describe('attackerSetChart', () => {
  it('places each set given to the attacker, by where the attack came from and how it ended', () => {
    const c = attackerSetChart([{ attack: play({ effect: '#' }), set: set() }, { attack: play({ effect: '=' }), set: set() }, { attack: play({}), set: null }])!
    expect([c.total, c.kills, c.errors, c.by.right.n]).toEqual([2, 1, 1, 2])
    expect(c.dots.every(d => d.at)).toBe(true)
  })
  it('is null without sets', () => {
    expect(attackerSetChart([{ attack: play({}), set: null }])).toBeNull()
  })
})

describe('the attacker slide', () => {
  const d = match([set(), play({ effect: '#' }), set({ rallyId: 1, recEffect: '!' }), play({ rallyId: 1, recEffect: '!', effect: '=' }), set({ rallyId: 2, phase: 't' }), play({ rallyId: 2, phase: 't', awayRot: 3 })])
  it('reads each attack with the set before it', () => {
    const [k] = boardPlayers([d], 'D')
    expect(k.key).toBe('K')
    expect(k.plays).toHaveLength(3)
    expect([...k.setOf!.values()].every(s => s?.skill === 'E')).toBe(true)
  })
  it('makes a column per condition, each with its set chart and direction chart', () => {
    const [k] = boardPlayers([d], 'D')
    const s = boardSlide([k], 'D', { split: false, attack: { conditions: ['good', 'poor', 'trans'], defense: true } }, {})
    expect(s.charts).toHaveLength(3)
    expect(s.setCharts).toHaveLength(3)
    expect(s.charts.map(c => c.chart.stats.att)).toEqual([1, 1, 1])
    expect(s.charts.every(c => c.chart.look.name && c.chart.look.stats && c.chart.name === '#92 Jonas KVALEN')).toBe(true)
    // Side by side, inside the slide, right of the court.
    const right = s.charts.map(c => c.x)
    expect(right[0]).toBeGreaterThan(0.45) // three columns: the court made smaller
    expect(right[1]).toBeGreaterThan(right[0])
    expect(s.annotations.some(a => a.kind === 'text' && a.text === '#92 KVALEN')).toBe(true)
    expect(s.annotations.some(a => a.kind === 'text' && a.text === 'NOR · All attacks')).toBe(true)
  })
  it('keeps to the setter\'s row, and says so under the name', () => {
    const [k] = boardPlayers([d], 'D')
    const s = boardSlide([k], 'D', { split: false, attack: { conditions: ['good', 'trans'], setterRow: 'front', defense: false } }, {})
    expect(s.charts.map(c => c.chart.stats.att)).toEqual([1])
    expect(s.annotations.some(a => a.kind === 'text' && a.text === 'NOR · Setter Front')).toBe(true)
  })
  it('puts our five discs on only when asked', () => {
    const [k] = boardPlayers([d], 'D')
    const balls = (defense: boolean) => attackSlide({ player: k.player, team: 'NOR', attacks: k.plays, setOf: k.setOf!, label: '' },
      { conditions: ['good'], defense, style: DEFAULT_CHART, ink: '#000000' }).annotations.filter(a => a.kind === 'circle' && a.shade === 'ball').length
    expect(balls(false)).toBe(1) // the attacker
    expect(balls(true)).toBe(6)
  })
  it('shows the two cones most attacks went into, each with its share', () => {
    const spread = match([play({}), play({}), play({ endClick: { u: 0.5, v: 0.95 } }), play({ endClick: { u: 0.85, v: 0.7 } })])
    const [k] = boardPlayers([spread], 'D')
    const made = attackSlide({ player: k.player, team: 'NOR', attacks: k.plays, setOf: k.setOf!, label: '' }, { conditions: ['good'], defense: false, style: DEFAULT_CHART, ink: '#000000' }).annotations
    const shares = made.flatMap(a => (a.kind === 'text' && /%$/.test(a.text) ? [a.text] : []))
    expect(shares).toHaveLength(2)
    expect(shares[0]).toBe('50%') // the most first
    expect(made.filter(a => a.kind === 'polygon' && a.color === '#DC2626' && a.fill === '#DC2626')).toHaveLength(2)
  })
  it('puts the two blockers shoulder to shoulder', () => {
    const [k] = boardPlayers([match([play({})])], 'D')
    const block = attackSlide({ player: k.player, team: 'NOR', attacks: k.plays, setOf: k.setOf!, label: '' }, { conditions: ['good'], defense: true, style: DEFAULT_CHART, ink: '#000000' })
      .annotations.filter(a => a.kind === 'circle' && a.fill === '#FACC15')
    expect(block).toHaveLength(2)
    const [l, r] = block.map(a => (a.kind === 'circle' ? a : null)!).sort((a, b) => a.x - b.x)
    expect(Math.abs(r.x - (l.x + l.w))).toBeLessThan(0.004) // touching, neither apart nor overlapping
  })
})
