// The size objects are being edited at: the annotation layer sets it as it draws, so the format
// panel can measure text (its width depends on the picture's shape) when it lines objects up.
import { bounds, type Annotation, type Rect } from '../../shared/annotation'

let frame = { w: 1280, h: 720 }
let ctx: CanvasRenderingContext2D | null = null

export function setAnnFrame(w: number, h: number): void {
  if (w > 0 && h > 0) frame = { w, h }
}

// How big each object is on the picture (normalized), as the layer measures it.
export function annBoxOf(): (a: Annotation) => Rect {
  ctx ??= document.createElement('canvas').getContext('2d')
  const { w, h } = frame
  return a => bounds(ctx!, a, w, h)
}
