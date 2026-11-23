import { describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAY, lookTheme, overlaySettings, type TelopLook } from './overlay'
import { drawTitleCard } from './overlayDraw'

// A 2D context that does nothing but measure text (0.5 × font px per character) and note where
// pictures go.
function fakeCtx() {
  const images: number[][] = []
  const state: Record<string, unknown> = { font: '10px x' }
  const ctx = new Proxy(state, {
    get: (o, k) => {
      if (k === 'measureText') return (t: string) => ({ width: t.length * 0.5 * parseFloat(/(\d+(\.\d+)?)px/.exec(String(o.font))![1]) })
      if (k === 'drawImage') return (_i: unknown, x: number, y: number, w: number, h: number) => images.push([x, y, w, h])
      if (k in o) return o[k as string]
      return () => {}
    },
    set: (o, k, v) => { o[k as string] = v; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, images }
}
const card = { marker: 1, name: 'SERVE', match: null }

describe('a title card without a logo of its own', () => {
  it('draws no picture: a logo goes on as an object', () => {
    for (const d of [card, { ...card, marker: null }, { ...card, marker: null, video: true }]) {
      const { ctx, images } = fakeCtx()
      drawTitleCard(ctx, 1280, 720, d, DEFAULT_OVERLAY.titleCard, DEFAULT_OVERLAY.theme)
      expect(images).toHaveLength(0)
    }
  })
})

describe('scene title place', () => {
  const draw = (name: string, layout?: { x: number; y: number; scale: number; origin?: 'tl' }) =>
    drawTitleCard(fakeCtx().ctx, 1280, 720, { marker: null, name, match: 'VS OKB', ...(layout ? { layout } : {}) }, DEFAULT_OVERLAY.titleCard, DEFAULT_OVERLAY.theme)
  it('keeps its top-left whatever the title, a long one growing right and shrunk inside the frame', () => {
    const short = draw('Serve'), long = draw('A very long scene name that would not fit across the frame at all')
    expect([short.x, short.y]).toEqual([128, 288])
    expect([long.x, long.y]).toEqual([128, 288])
    expect(long.w).toBeGreaterThan(short.w)
    expect(long.x + long.w).toBeLessThanOrEqual(1280 * 0.98 + 0.5)
  })
  it('reads a layout saved as a centre as a top-left, the same for every title', () => {
    const a = draw('Serve', { x: 0.5, y: 0.5, scale: 1 }), b = draw('Block of the middle', { x: 0.5, y: 0.5, scale: 1 })
    expect([a.x, a.y]).toEqual([b.x, b.y])
    expect(a.x).toBeCloseTo((0.5 - 0.105) * 1280)
    expect(draw('Serve', { x: 0.3, y: 0.2, scale: 1, origin: 'tl' }).x).toBeCloseTo(0.3 * 1280)
  })
})

// The title cards follow the design chosen for the telops (look): what is filled, in which colour, and
// the colour of the text. A context that records polygons (fill after lineTo) and text.
function paintCtx() {
  const fills: { color: unknown; pts: number[][] }[] = [], texts: { s: string; color: unknown; shadow: unknown }[] = []
  let path: number[][] = []
  const state: Record<string, unknown> = { font: '10px x', shadowColor: 'transparent' }
  const ctx = new Proxy(state, {
    get: (o, k) => {
      if (k === 'measureText') return (t: string) => ({ width: t.length * 0.5 * parseFloat(/(\d+(\.\d+)?)px/.exec(String(o.font))![1]) })
      if (k === 'beginPath') return () => { path = [] }
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => path.push([x, y])
      if (k === 'fill') return () => fills.push({ color: o.fillStyle, pts: path })
      if (k === 'fillRect') return () => {}
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} })
      if (k === 'fillText') return (t: string) => texts.push({ s: t, color: o.fillStyle, shadow: o.shadowColor })
      if (k in o) return o[k as string]
      return () => {}
    },
    set: (o, k, v) => { o[k as string] = v; return true },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts }
}
const lookCard = (look: TelopLook, c: Parameters<typeof drawTitleCard>[3] = card) => {
  const r = paintCtx()
  drawTitleCard(r.ctx, 1280, 720, c, DEFAULT_OVERLAY.titleCard, lookTheme(overlaySettings({ look })))
  return r
}

describe('the title card takes the design of the telops', () => {
  it('keeps the slanted plates as they were by default', () => {
    const { fills } = lookCard('slant')
    // plate (the base lightened a little) then the accent block, both slanted; q = 3 × 720 / 720.
    expect(fills.map(f => f.color)).toEqual(['#1f1f1f', '#C8102E'])
    const x = 128, y = 216, q = 3, numW = measureNum(), plateW = plateWidth()
    expect(fills[0].pts).toEqual([[x + numW - 6 * q + 10 * q, y], [x + numW - 6 * q + plateW, y], [x + numW - 6 * q + plateW - 14 * q, y + 46 * q], [x + numW - 6 * q, y + 46 * q]])
    expect(fills[1].pts).toEqual([[x, y], [x + numW, y], [x + numW - 10 * q, y + 46 * q], [x, y + 46 * q]])
  })
  it('draws square plates on dark text-free ground in box, white plates with dark text in light', () => {
    const box = lookCard('box'), light = lookCard('light')
    expect(String(box.fills[0].color)).toMatch(/^rgba\(/) // see-through
    expect(box.fills[0].pts[0][0]).toBeLessThan(box.fills[0].pts[1][0])
    expect(light.fills[0].color).toBe('#ECECEC')
    expect(light.texts.find(x => x.s === 'S')!.color).toBe('#111111')
    expect(lookCard('slant').texts.find(x => x.s === 'S')!.color).toBe('#FFFFFF')
  })
  it('has no plate in float, only the accent block and shadowed text', () => {
    const { fills, texts } = lookCard('float')
    expect(fills.map(f => f.color)).toEqual(['#C8102E'])
    expect(texts.find(x => x.s === 'S')!.shadow).toBe('rgba(0,0,0,0.85)')
  })
  it('does the same on scene cards', () => {
    const scene = { marker: null, name: 'Scene', match: null }
    expect(lookCard('slant', scene).fills.map(f => f.color)).toEqual(['#1f1f1f', '#C8102E'])
    expect(lookCard('light', scene).texts.find(x => x.s === 'S')!.color).toBe('#111111')
    expect(lookCard('float', scene).fills.map(f => f.color)).toEqual(['#C8102E'])
  })
})

// The marker card's number block and name plate widths at 720p × 3 with the fake 0.5-em text.
function measureNum() { return 0.5 * 24 * 3 + 32 * 3 }
function plateWidth() { return 0.5 * 28 * 3 * 5 + 0.08 * 28 * 3 * 4 + 46 * 3 }
