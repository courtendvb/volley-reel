import { describe, expect, it } from 'vitest'
import { applyGesture, clampView, cleanCompare, newCompare, offsetFor, panBy, partnerTime, stepTime, withZoom, zoomAt } from './videoCompare'

describe('view', () => {
  it('keeps the picture inside its box', () => {
    expect(clampView({ zoom: 1, x: 3, y: -2 })).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(clampView({ zoom: 2, x: 3, y: -3 })).toEqual({ zoom: 2, x: 0.5, y: -0.5 })
    expect(clampView({ zoom: 100, x: 0, y: 0 }).zoom).toBe(8)
    expect(clampView({ zoom: NaN, x: NaN, y: 0 })).toEqual({ zoom: 1, x: 0, y: 0 })
  })
  it('zooms around the pointer so the spot under it stays put', () => {
    const v = zoomAt({ zoom: 1, x: 0, y: 0 }, 2, 0.25, 0)
    expect(v.zoom).toBe(2)
    // the picture point under the pointer: (c - x) / zoom, before and after
    expect((0.25 - v.x) / v.zoom).toBeCloseTo(0.25)
  })
  it('zooming out to 1 recentres', () => {
    const z = zoomAt({ zoom: 1, x: 0, y: 0 }, 4, 0.4, 0.3)
    expect(zoomAt(z, 0.1, 0.4, 0.3)).toEqual({ zoom: 1, x: 0, y: 0 })
  })
  it('pans only while zoomed', () => {
    expect(panBy({ zoom: 1, x: 0, y: 0 }, 0.3, 0.3)).toEqual({ zoom: 1, x: 0, y: 0 })
    expect(panBy({ zoom: 3, x: 0, y: 0 }, 0.3, -2)).toEqual({ zoom: 3, x: 0.3, y: -1 })
  })
  it('matches another side\'s zoom within its own limits', () => {
    expect(withZoom({ zoom: 4, x: 1.4, y: 0 }, 2)).toEqual({ zoom: 2, x: 0.5, y: 0 })
  })
})

describe('gesture', () => {
  it('does to a view what the pointer did', () => {
    const z = applyGesture({ zoom: 1, x: 0, y: 0 }, { kind: 'zoom', factor: 2, cx: 0, cy: 0 })
    expect(z.zoom).toBe(2)
    expect(applyGesture(z, { kind: 'pan', dx: 0.2, dy: 0 }).x).toBeCloseTo(0.2)
    expect(applyGesture(z, { kind: 'reset' })).toEqual({ zoom: 1, x: 0, y: 0 })
  })
  it('keeps two views that differ apart when both get the same gesture', () => {
    const a = applyGesture({ zoom: 2, x: 0.3, y: 0 }, { kind: 'zoom', factor: 1.5, cx: 0, cy: 0 })
    const b = applyGesture({ zoom: 1, x: 0, y: 0 }, { kind: 'zoom', factor: 1.5, cx: 0, cy: 0 })
    expect(a.zoom).toBeCloseTo(3)
    expect(b.zoom).toBeCloseTo(1.5)
  })
})

describe('time', () => {
  it('maps a time to the other side through the offset', () => {
    expect(partnerTime('left', 10, 2.5, 60)).toBe(12.5)
    expect(partnerTime('right', 12.5, 2.5, 60)).toBe(10)
  })
  it('has no partner time outside the other video', () => {
    expect(partnerTime('right', 1, 2.5, 60)).toBeNull()
    expect(partnerTime('left', 59, 2.5, 60)).toBeNull()
    expect(partnerTime('left', 59, 2.5, 0)).toBe(61.5) // duration not known yet
  })
  it('makes two positions the same moment', () => {
    const off = offsetFor(10, 34.2)
    expect(partnerTime('left', 10, off, 100)).toBeCloseTo(34.2)
  })
  it('steps by frames within the video', () => {
    expect(stepTime(1, 1, 30, 10)).toBeCloseTo(1 + 1 / 30)
    expect(stepTime(0, -1, 30, 10)).toBe(0)
    expect(stepTime(9.99, 5, 30, 10)).toBe(10)
  })
})

describe('saved sessions', () => {
  it('reads back what was saved', () => {
    const s = newCompare('A vs B')
    s.left.source = { kind: 'match', matchId: 'm1' }
    s.right.source = { kind: 'file', path: 'C:/v/x.mp4', name: 'x.mp4' }
    s.right.view = { zoom: 2, x: 0.2, y: 0 }
    s.offsetSec = -1.5; s.synced = true; s.layout = 'overlay'; s.overlayAlpha = 0.3
    expect(cleanCompare(JSON.parse(JSON.stringify(s)))).toEqual(s)
  })
  it('puts right what is missing or wrong', () => {
    const c = cleanCompare({ id: 'abc', left: { source: { kind: 'nope' }, view: { zoom: 99 }, time: -4 }, offsetSec: 'x', layout: 'weird' })!
    expect(c.left.source).toBeNull()
    expect(c.left.view.zoom).toBe(8)
    expect(c.left.time).toBe(0)
    expect(c.offsetSec).toBe(0)
    expect(c.layout).toBe('side')
    expect(c.overlayAlpha).toBe(0.5)
    expect(cleanCompare({ id: 'x', overlayAlpha: 7 })!.overlayAlpha).toBe(1)
    expect(c.name).toBe('abc')
  })
  it('refuses what is not a session or has an unsafe id', () => {
    expect(cleanCompare(null)).toBeNull()
    expect(cleanCompare({ id: '../x' })).toBeNull()
    expect(cleanCompare({})).toBeNull()
  })
})
