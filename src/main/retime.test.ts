// Runs the hold / slow chain through the bundled ffmpeg on a generated clip whose frames are all
// different, and checks which source frame lands where. Skipped when ffmpeg isn't in vendor/.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { retime } from './retime'

const bin = process.env.FFMPEG_DIR
  ? join(process.env.FFMPEG_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  : process.platform === 'darwin'
    ? join('vendor', 'ffmpeg-mac', process.arch, 'ffmpeg')
    : join('vendor', 'ffmpeg', 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')

// The checksum of each output frame of `chain` run on `sec` seconds of a 30 fps test pattern
// (testsrc draws a running frame counter, so no two source frames are alike).
function frames(chain: string | null, sec: number): string[] {
  const src = `testsrc=size=160x90:rate=30:duration=${sec}`
  const fc = `[0:v]format=yuv420p[v0];[v0]${chain ?? 'null'},showinfo[o]`
  const r = spawnSync(bin, ['-hide_banner', '-f', 'lavfi', '-i', src, '-filter_complex', fc, '-map', '[o]', '-f', 'null', '-'], { encoding: 'utf8' })
  return [...r.stderr.matchAll(/Parsed_showinfo.*? n: *\d+ .*?checksum:([0-9A-F]+)/g)].map(m => m[1])
}

describe.skipIf(!existsSync(bin))('retime through ffmpeg', () => {
  // Made on first use: the suite body runs to collect the tests even when they are skipped (no ffmpeg in CI).
  let made: string[] | null = null
  const src = () => (made ??= frames(null, 4))

  it('holds the frame at the hold time, then plays on from there', () => {
    // IN 100, OUT 104; hold at 101.65 for 1 s. Frame 49 (1.6333 s) is on screen then.
    const out = frames(retime({ in: 100, out: 104, timing: { holds: [{ at: 101.65, sec: 1 }] } }, '30'), 4)
    expect(out).toHaveLength(120 + 30)
    expect(out.slice(0, 50)).toEqual(src().slice(0, 50)) // played up to the hold
    expect(new Set(out.slice(50, 80))).toEqual(new Set([src()[49]])) // that frame, 30 more times
    expect(out.slice(80)).toEqual(src().slice(50)) // then on from where it stopped
  })

  it('holds on a frame boundary and at OUT', () => {
    const onFrame = frames(retime({ in: 0, out: 4, timing: { holds: [{ at: 2, sec: 0.5 }] } }, '30'), 4)
    expect(onFrame).toHaveLength(120 + 15)
    expect(onFrame.slice(0, 61)).toEqual(src().slice(0, 61))
    expect(new Set(onFrame.slice(61, 76))).toEqual(new Set([src()[60]]))
    expect(onFrame.slice(76)).toEqual(src().slice(61))
    const atOut = frames(retime({ in: 0, out: 4, timing: { holds: [{ at: 4, sec: 0.5 }] } }, '30'), 4)
    expect(atOut).toHaveLength(120 + 15)
    expect(atOut.slice(0, 120)).toEqual(src())
    expect(new Set(atOut.slice(120))).toEqual(new Set([src()[119]]))
  })

  it('stretches a slow stretch', () => {
    const out = frames(retime({ in: 0, out: 2, timing: { slows: [{ from: 1, to: 2, rate: 0.5 }] } }, '30'), 2)
    expect(out).toHaveLength(30 + 60)
    expect(out.slice(0, 30)).toEqual(src().slice(0, 30))
  })
})
