import { describe, expect, it } from 'vitest'
import { DEFAULT_OVERLAY } from './overlay'
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
const logo = { width: 200, height: 100 } as unknown as CanvasImageSource
const card = { marker: 1, name: 'SERVE', match: null }

describe('the logo on a title card', () => {
  it('goes beside the title by default, inside its box', () => {
    const { ctx, images } = fakeCtx()
    const b = drawTitleCard(ctx, 1280, 720, card, DEFAULT_OVERLAY.titleCard, DEFAULT_OVERLAY.theme, logo)
    expect(images).toHaveLength(1)
    expect(b.logo).toBeDefined()
    expect(b.logo!.x + b.logo!.w).toBeCloseTo(b.x + b.w)
  })
  it('has its own place and size when set for the kind of card, apart from the title', () => {
    const { ctx, images } = fakeCtx()
    const s = { ...DEFAULT_OVERLAY.titleCard, logos: { marker: { x: 0.8, y: 0.2, h: 0.25 } } }
    const b = drawTitleCard(ctx, 1280, 720, card, s, DEFAULT_OVERLAY.theme, logo)
    expect(images).toEqual([[1024 - 180, 144 - 90, 360, 180]]) // 25% of 720 tall, 2:1, centred on (80%, 20%)
    expect(b.logo).toEqual({ x: 844, y: 54, w: 360, h: 180 })
    expect(b.x + b.w).toBeLessThan(844) // the title no longer makes room for it
    // other kinds of card keep it with the title
    const scene = fakeCtx()
    drawTitleCard(scene.ctx, 1280, 720, { ...card, marker: null }, s, DEFAULT_OVERLAY.theme, logo)
    expect(scene.images[0][3]).toBeCloseTo(120 * 720 / 720)
  })
  it('can be left out', () => {
    const { ctx, images } = fakeCtx()
    const b = drawTitleCard(ctx, 1280, 720, card, { ...DEFAULT_OVERLAY.titleCard, logos: { marker: 'hidden' } }, DEFAULT_OVERLAY.theme, logo)
    expect(images).toHaveLength(0)
    expect(b.logo).toBeUndefined()
  })
})
