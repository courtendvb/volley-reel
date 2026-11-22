// Video comparison to an MP4 (see shared/videoCompare.ts): the two videos side by side (or stacked) on
// one 1920×1080 picture, each as its zoom and position show it in the preview, from where each side
// was left, for a length. Pure: it only builds the ffmpeg arguments.
import { clampView, type CompareLayout, type CompareSource, type PaneView } from './videoCompare'

export const OUT_W = 1920
export const OUT_H = 1080
export const OUT_FPS = 30

// What the renderer sends: each side's source, view and start (video seconds).
export interface CompareExportSide { source: CompareSource; view: PaneView; startSec: number }
export interface CompareExportJob { left: CompareExportSide; right: CompareExportSide; layout: CompareLayout; overlayAlpha: number; durationSec: number; outPath: string }

// What the main process runs: sources resolved to playable files, with their size and length.
export interface CompareRunSide { file: string; width: number; height: number; durationSec: number; startSec: number; view: PaneView }
export interface CompareRun { left: CompareRunSide; right: CompareRunSide; layout: CompareLayout; overlayAlpha: number; durationSec: number; outPath: string }

// Each side's share of the picture.
export function cellSize(layout: CompareLayout): { w: number; h: number } {
  return layout === 'side' ? { w: OUT_W / 2, h: OUT_H } : layout === 'stack' ? { w: OUT_W, h: OUT_H / 2 } : { w: OUT_W, h: OUT_H }
}

// How long both sides can play from their starts: the wanted length, less if either video ends first.
export function runLength(wanted: number, left: CompareRunSide, right: CompareRunSide): number {
  const room = (s: CompareRunSide) => (s.durationSec > 0 ? s.durationSec - s.startSec : Infinity)
  return Math.max(0, Math.min(wanted, room(left), room(right)))
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

// The filter chain for one side: the preview shows the picture fitted into its cell (black bars where
// the shapes differ), then zoomed about the cell's centre and moved. Here the part of the picture that
// shows is cropped from the source and put on a black cell, so nothing is scaled bigger than it ends up.
// alpha: the side is a see-through layer to lay over another (the overlay layout): its bars and the
// parts out of view are clear, and what shows is `alpha` opaque.
export function paneFilter(srcW: number, srcH: number, cellW: number, cellH: number, view: PaneView, alpha?: number): string {
  const v = clampView(view), z = v.zoom
  const fit = Math.min(cellW / srcW, cellH / srcH)
  const pw = srcW * fit, ph = srcH * fit, px = (cellW - pw) / 2, py = (cellH - ph) / 2 // the fitted picture in the cell
  const vx = cellW * (0.5 - (0.5 + v.x) / z), vy = cellH * (0.5 - (0.5 + v.y) / z) // the part of the cell on show
  const ix0 = Math.max(vx, px), ix1 = Math.min(vx + cellW / z, px + pw)
  const iy0 = Math.max(vy, py), iy1 = Math.min(vy + cellH / z, py + ph)
  const layer = alpha !== undefined
  const tail = layer ? `colorchannelmixer=aa=${alpha.toFixed(3)},setsar=1,fps=${OUT_FPS}` : `setsar=1,fps=${OUT_FPS},format=yuv420p`
  if (ix1 - ix0 < 1 || iy1 - iy0 < 1) return layer ? `scale=${cellW}:${cellH},format=rgba,colorchannelmixer=aa=0,setsar=1,fps=${OUT_FPS}` : `scale=${cellW}:${cellH},drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill,${tail}` // nothing of the picture shows (panned onto the bars)
  const cw = Math.max(2, Math.round((ix1 - ix0) / fit)), ch = Math.max(2, Math.round((iy1 - iy0) / fit))
  const cx = Math.min(Math.max(0, Math.round((ix0 - px) / fit)), srcW - cw), cy = Math.min(Math.max(0, Math.round((iy0 - py) / fit)), srcH - ch)
  const ox = Math.min(Math.max(0, Math.round((ix0 - vx) * z / 2) * 2), cellW - 2), oy = Math.min(Math.max(0, Math.round((iy0 - vy) * z / 2) * 2), cellH - 2)
  const ow = Math.min(even((ix1 - ix0) * z), cellW - ox), oh = Math.min(even((iy1 - iy0) * z), cellH - oy)
  return `crop=${cw}:${ch}:${cx}:${cy},scale=${ow}:${oh}:flags=lanczos,${layer ? 'format=rgba,' : ''}pad=${cellW}:${cellH}:${ox}:${oy}:${layer ? 'black@0' : 'black'},${tail}`
}

export function compareArgs(run: CompareRun): string[] {
  const { w, h } = cellSize(run.layout)
  const sec = run.durationSec.toFixed(3)
  const input = (s: CompareRunSide) => ['-ss', s.startSec.toFixed(3), '-t', sec, '-i', s.file]
  const f = (s: CompareRunSide, alpha?: number) => paneFilter(s.width, s.height, w, h, s.view, alpha)
  const join = run.layout === 'overlay' ? 'overlay=format=auto,format=yuv420p' : `${run.layout === 'side' ? 'hstack' : 'vstack'}=inputs=2`
  const fc = `[0:v]${f(run.left)}[l];[1:v]${f(run.right, run.layout === 'overlay' ? run.overlayAlpha : undefined)}[r];[l][r]${join}[v]`
  return [...input(run.left), ...input(run.right), '-filter_complex', fc, '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(OUT_FPS), '-an', '-movflags', '+faststart', run.outPath]
}
