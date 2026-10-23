// Canvas helpers for the layers over the video.

// Sizes a canvas for its CSS size at the screen's pixel ratio and returns a context drawing in CSS
// pixels, cleared. The backing store is only reallocated when the size really changes: setting
// width / height (even to the same value) throws away and reallocates it, which on every frame is
// a steady stream of large allocations.
export function prepareCanvas(c: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr)
  canvasStats.draws++
  if (c.width !== pw || c.height !== ph) { canvasStats.reallocs++; c.width = pw; c.height = ph }
  const ctx = c.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, pw, ph)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1
  return ctx
}

// Counts for the memory smoke check: how often layers were drawn, and how often a backing store
// had to be reallocated.
export const canvasStats = { draws: 0, reallocs: 0 }
