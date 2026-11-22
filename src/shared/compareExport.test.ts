import { describe, expect, it } from 'vitest'
import { cellSize, compareArgs, paneFilter, runLength, type CompareRun, type CompareRunSide } from './compareExport'

const side = (o: Partial<CompareRunSide> = {}): CompareRunSide => ({ file: 'a.mp4', width: 1920, height: 1080, durationSec: 100, startSec: 10, view: { zoom: 1, x: 0, y: 0 }, ...o })

describe('cells', () => {
  it('splits 1920×1080 in two', () => {
    expect(cellSize('side')).toEqual({ w: 960, h: 1080 })
    expect(cellSize('stack')).toEqual({ w: 1920, h: 540 })
    expect(cellSize('overlay')).toEqual({ w: 1920, h: 1080 })
  })
})

describe('one side', () => {
  it('fits a 16:9 picture into a half-width cell with bars above and below, unzoomed', () => {
    // 1920×1080 into 960×1080: scale 0.5 → 960×540, bars of 270 above and below
    expect(paneFilter(1920, 1080, 960, 1080, { zoom: 1, x: 0, y: 0 })).toBe('crop=1920:1080:0:0,scale=960:540:flags=lanczos,pad=960:1080:0:270:black,setsar=1,fps=30,format=yuv420p')
  })
  it('crops the zoomed part of the picture and fills the cell with it', () => {
    // 2× on the centre of a picture that fits its cell exactly: the middle quarter
    expect(paneFilter(1920, 1080, 1920, 1080, { zoom: 2, x: 0, y: 0 })).toBe('crop=960:540:480:270,scale=1920:1080:flags=lanczos,pad=1920:1080:0:0:black,setsar=1,fps=30,format=yuv420p')
  })
  it('follows the pan: the picture moved right shows its left part', () => {
    const f = paneFilter(1920, 1080, 1920, 1080, { zoom: 2, x: 0.5, y: 0 }) // the most it can move
    expect(f.startsWith('crop=960:540:0:270')).toBe(true)
  })
  it('keeps the bars in view when zoomed only a little', () => {
    // 1.5× of the half-width cell: a 640-wide window over the 960-wide picture (the middle 1280 of the source);
    // the 540-tall picture stays whole inside the 720-tall window, so it is drawn 960×810 with bars above and below
    const f = paneFilter(1920, 1080, 960, 1080, { zoom: 1.5, x: 0, y: 0 })
    expect(f).toContain('crop=1280:1080:320:0')
    expect(f).toContain('scale=960:810')
    expect(f).toMatch(/pad=960:1080:0:13[46]:black/)
  })
  it('shows black when panned onto the bars, the picture all out of view', () => {
    // zoom 8 at the top edge of a cell whose picture starts 270 down: only the bars are on show
    expect(paneFilter(1920, 1080, 960, 1080, { zoom: 8, x: 99, y: 99 })).toMatch(/^scale=960:1080,drawbox=.*:t=fill,/)
  })
})

describe('see-through layer', () => {
  it('is clear where there is no picture and keeps only its share where there is', () => {
    expect(paneFilter(1920, 1080, 1920, 1080, { zoom: 1, x: 0, y: 0 }, 0.4)).toBe('crop=1920:1080:0:0,scale=1920:1080:flags=lanczos,format=rgba,pad=1920:1080:0:0:black@0,colorchannelmixer=aa=0.400,setsar=1,fps=30')
    expect(paneFilter(1920, 1080, 1920, 1080, { zoom: 1, x: 0, y: 0 })).not.toContain('rgba')
  })
  it('lays the right side over the left', () => {
    const run: CompareRun = { left: side(), right: side(), layout: 'overlay', overlayAlpha: 0.5, durationSec: 5, outPath: 'o.mp4' }
    const fc = compareArgs(run)[compareArgs(run).indexOf('-filter_complex') + 1]
    expect(fc).toContain('[l][r]overlay=format=auto,format=yuv420p[v]')
    expect(fc).toContain('colorchannelmixer=aa=0.500')
    expect(fc.split('colorchannelmixer').length).toBe(2) // only the top layer is made see-through
  })
})

describe('length and arguments', () => {
  it('is cut short by the video that ends first', () => {
    expect(runLength(30, side({ startSec: 10 }), side({ startSec: 90 }))).toBe(10)
    expect(runLength(30, side(), side())).toBe(30)
    expect(runLength(30, side({ startSec: 100 }), side())).toBe(0)
  })
  it('puts both sides on one picture', () => {
    const run: CompareRun = { left: side({ file: 'l.mp4', startSec: 12.5 }), right: side({ file: 'r.mp4', startSec: 3 }), layout: 'side', overlayAlpha: 0.5, durationSec: 8, outPath: 'out.mp4' }
    const a = compareArgs(run)
    expect(a.slice(0, 6)).toEqual(['-ss', '12.500', '-t', '8.000', '-i', 'l.mp4'])
    expect(a[a.indexOf('-filter_complex') + 1]).toMatch(/\[l\]\[r\]hstack=inputs=2\[v\]$/)
    expect(a[a.length - 1]).toBe('out.mp4')
    expect(compareArgs({ ...run, layout: 'stack' })[a.indexOf('-filter_complex') + 1]).toMatch(/vstack/)
  })
});
