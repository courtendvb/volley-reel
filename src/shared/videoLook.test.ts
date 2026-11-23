import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanLook, lookFilter, lookParams, lookSvg, saturateMatrix, toneValue, type VideoLook } from './videoLook'

describe('cleanLook', () => {
  it('drops zeros and clamps to ±100', () => {
    expect(cleanLook({ brightness: 0, contrast: 0 })).toBeNull()
    expect(cleanLook(undefined)).toBeNull()
    expect(cleanLook({ brightness: 250, contrast: -3.4, saturation: 0 })).toEqual({ brightness: 100, contrast: -3 })
    expect(cleanLook({ brightness: Number.NaN })).toBeNull()
  })
})

describe('lookParams', () => {
  it('is the identity at 0', () => {
    expect(lookParams(null)).toEqual({ gamma: 1, slope: 1, sat: 1 })
  })
  it('brightens with a gamma below 1', () => {
    const { gamma } = lookParams({ brightness: 50 })
    expect(gamma).toBeLessThan(1)
    expect(toneValue(0.2, gamma, 1)).toBeGreaterThan(0.2)
    expect(toneValue(1, gamma, 1)).toBe(1) // white stays white: nothing blows out
    expect(toneValue(0, gamma, 1)).toBe(0)
  })
})

describe('lookFilter / lookSvg', () => {
  it('is empty when nothing changes', () => {
    expect(lookFilter({})).toBe('')
    expect(lookSvg({ brightness: 0 })).toBeNull()
  })
  it('only adds the steps in use', () => {
    expect(lookFilter({ saturation: 20 })).not.toContain('lutrgb')
    expect(lookFilter({ brightness: 20 })).not.toContain('colorchannelmixer')
  })
  it('keeps the saturate matrix rows summing to 1 (greys stay grey)', () => {
    for (const row of saturateMatrix(1.7)) expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
  })
})

// The export must give what the preview shows: run the filter on a flat colour through the bundled
// ffmpeg and compare with the same maths. Skipped when ffmpeg isn't in vendor/.
const bin = process.env.FFMPEG_DIR
  ? join(process.env.FFMPEG_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : process.platform === 'darwin'
    ? join('vendor', 'ffmpeg-mac', process.arch, 'ffmpeg')
    : join('vendor', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

function throughFfmpeg(rgb: [number, number, number], look: VideoLook): number[] {
  const hex = rgb.map(c => c.toString(16).padStart(2, '0')).join('')
  const fc = `[0:v]format=rgb24${lookFilter(look)},format=rgb24[o]`
  const r = spawnSync(bin, ['-hide_banner', '-f', 'lavfi', '-i', `color=c=0x${hex}:size=8x8:rate=1:duration=1`, '-filter_complex', fc, '-map', '[o]',
    '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 })
  if (r.status !== 0) throw new Error(String(r.stderr))
  return [...r.stdout.subarray(0, 3)]
}

function expected(rgb: [number, number, number], look: VideoLook): number[] {
  const { gamma, slope, sat } = lookParams(look)
  const t = rgb.map(c => toneValue(c / 255, gamma, slope))
  return saturateMatrix(sat).map(row => Math.round(Math.min(1, Math.max(0, row[0] * t[0] + row[1] * t[1] + row[2] * t[2])) * 255))
}

describe.skipIf(!existsSync(bin))('lookFilter through ffmpeg', () => {
  const cases: [[number, number, number], VideoLook][] = [
    [[40, 60, 90], { brightness: 60 }],
    [[40, 60, 90], { brightness: -40, contrast: 30 }],
    [[120, 80, 50], { saturation: 50 }],
    [[30, 50, 70], { brightness: 100, contrast: -20, saturation: -60 }],
  ]
  for (const [rgb, look] of cases) {
    it(`matches the preview's maths for ${JSON.stringify(look)}`, () => {
      // The colour source is YUV inside, so its RGB comes back a step or two off: start from what it gives.
      const base = throughFfmpeg(rgb, {}) as [number, number, number]
      const got = throughFfmpeg(rgb, look), want = expected(base, look)
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i] - want[i])).toBeLessThanOrEqual(2)
    })
  }
})
