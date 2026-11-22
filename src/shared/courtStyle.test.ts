import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART } from './chart'
import { DEFAULT_SET_CHART } from './setChart'
import { DEFAULT_GRID_STYLE, cleanClipCourtStyle, clipCourtStyle, markStyle, pinClipStyle, splitClipStyle, type GridStyle } from './courtStyle'

// The 表示 tab as a user left it: ripple on, heat on a serve, cones on an attack.
const tab: GridStyle = {
  ...DEFAULT_GRID_STYLE, ripple: true, rippleKind: 'flash', rippleLead: 1.5, rippleColor: '#FFAA00', detail: 'point',
  bySkill: { S: { heat: true }, A: { cones: true, chart: DEFAULT_CHART }, E: { setChart: DEFAULT_SET_CHART } },
}

describe('clipCourtStyle', () => {
  it('is the tab when the clip pins nothing', () => {
    expect(clipCourtStyle(tab, 'A', undefined)).toBe(tab)
  })

  it('replaces the marks of the clip\'s own kind of play and leaves the others', () => {
    const out = clipCourtStyle(tab, 'S', { marks: { landings: true } })
    expect(markStyle(out, 'S').heat).toBeUndefined()
    expect(markStyle(out, 'S').landings).toBe(true)
    expect(markStyle(out, 'A').cones).toBe(true) // another kind of play: still the tab's
  })

  it('takes the pinned detail and the landing effect wholesale', () => {
    const off = clipCourtStyle(tab, 'A', { detail: 'zone', effect: { on: false } })
    expect(off.detail).toBe('zone')
    expect(off.ripple).toBeUndefined()
    expect(off.rippleKind).toBeUndefined()
    expect(off.rippleLead).toBeUndefined()
    expect(off.rippleColor).toBeUndefined()
    const on = clipCourtStyle({ ...tab, ripple: undefined, rippleKind: undefined, rippleLead: undefined, rippleColor: undefined }, 'A', { effect: { on: true, kind: 'lock', lead: -1, color: '#112233' } })
    expect(on).toMatchObject({ ripple: true, rippleKind: 'lock', rippleLead: -1, rippleColor: '#112233' })
  })

  it('a ripple pinned as the plain one drops the tab\'s other kind', () => {
    const out = clipCourtStyle(tab, 'A', { effect: { on: true } })
    expect(out.ripple).toBe(true)
    expect(out.rippleKind).toBeUndefined() // the usual ripple, not the tab's flash
    expect(out.rippleLead).toBeUndefined()
  })

  it('keeps the grid and what the clip does not pin', () => {
    const out = clipCourtStyle({ ...tab, grid: false, color: '#00FF00' }, 'A', { effect: { on: false } })
    expect(out.grid).toBe(false)
    expect(out.color).toBe('#00FF00')
  })

  it('marks pinned for a play of no player-marks kind (a block) change nothing of the marks', () => {
    const out = clipCourtStyle(tab, 'B', { marks: { landings: true } })
    expect(out.bySkill).toEqual(tab.bySkill)
  })

  it('works on a style made without bySkill', () => {
    const plain: GridStyle = { ...DEFAULT_GRID_STYLE, heat: true, cones: true }
    const out = clipCourtStyle(plain, 'A', { marks: {} })
    expect(markStyle(out, 'A').cones).toBeUndefined()
    expect(markStyle(out, 'S').heat).toBe(true) // the serve's marks stay what the plain style gave them
  })
})

describe('pinClipStyle', () => {
  it('copies how the clip looks now: detail, effect and its kind\'s marks', () => {
    const pin = pinClipStyle(tab, 'S')
    expect(pin).toEqual({ detail: 'point', effect: { on: true, kind: 'flash', lead: 1.5, color: '#FFAA00' }, marks: { heat: true } })
    // Pinned as it is, the clip looks as it did.
    expect(clipCourtStyle(tab, 'S', pin)).toEqual(tab)
  })

  it('a clip of no marks kind pins the effect and detail only', () => {
    expect(pinClipStyle(tab, 'B').marks).toBeUndefined()
  })

  it('records an effect that is off', () => {
    expect(pinClipStyle({ ...DEFAULT_GRID_STYLE }, 'A').effect).toEqual({ on: false })
  })
})

describe('splitClipStyle', () => {
  it('sends the clip\'s changes to the pin and the rest to the tab', () => {
    const effective = clipCourtStyle(tab, 'A', pinClipStyle(tab, 'A'))
    // The user ticks cones off for this attack, and turns the grid off.
    const next: GridStyle = { ...effective, grid: false, bySkill: { ...effective.bySkill, A: { ...effective.bySkill!.A, cones: undefined } } }
    const out = splitClipStyle(next, tab, 'A')
    expect(out.tab.grid).toBe(false)
    expect(out.tab.bySkill).toEqual(tab.bySkill) // the tab's marks are untouched
    expect(out.pin.marks?.cones).toBeUndefined()
    expect(out.pin.marks?.chart).toBeDefined()
  })

  it('the tab keeps its own landing effect when the clip changes its own', () => {
    const effective = clipCourtStyle(tab, 'A', pinClipStyle(tab, 'A'))
    const { ripple: _r, rippleKind: _k, rippleLead: _l, rippleColor: _c, ...noEffect } = effective
    const out = splitClipStyle(noEffect as GridStyle, tab, 'A')
    expect(out.pin.effect).toEqual({ on: false })
    expect(out.tab).toMatchObject({ ripple: true, rippleKind: 'flash', rippleLead: 1.5, rippleColor: '#FFAA00' })
  })

  it('a tab without a ripple stays without one', () => {
    const bare: GridStyle = { ...DEFAULT_GRID_STYLE }
    const out = splitClipStyle({ ...bare, ripple: true }, bare, 'A')
    expect(out.tab.ripple).toBeUndefined()
    expect(out.pin.effect).toEqual({ on: true })
  })
})

describe('cleanClipCourtStyle', () => {
  it('reads back what pinClipStyle made', () => {
    const pin = pinClipStyle(tab, 'A')
    expect(cleanClipCourtStyle(JSON.parse(JSON.stringify(pin)))).toEqual(pin)
  })

  it('drops what is of the wrong kind, and a pin with nothing left is none', () => {
    expect(cleanClipCourtStyle(undefined)).toBeUndefined()
    expect(cleanClipCourtStyle('x')).toBeUndefined()
    expect(cleanClipCourtStyle({ detail: 'huge' })).toBeUndefined()
    expect(cleanClipCourtStyle({ detail: 'sub', effect: { on: true, kind: 'nope', lead: 99, color: 'red' } }))
      .toEqual({ detail: 'sub', effect: { on: true, lead: 3 } })
  })

  it('a marks object with nothing valid is an empty set of marks (the clip shows none)', () => {
    expect(cleanClipCourtStyle({ marks: { heat: 0, unknown: 1 } })).toEqual({ marks: {} })
  })
})
