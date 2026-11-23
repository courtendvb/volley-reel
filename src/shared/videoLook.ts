// A match's picture correction (Match.look): for a video shot too dark, too flat or too grey.
// The preview and the export apply the same three steps, in the same order, to each RGB value
// v in 0..1, so what the slider shows is what the MP4 gets:
//   1. brightness: a gamma curve, v^g (lifts the dark parts without blowing out the light ones)
//   2. contrast: (v - 0.5) * k + 0.5, clipped to 0..1
//   3. saturation: the colour mixed with its grey (the SVG / CSS saturate matrix)
// The preview draws it with an SVG filter on the <video>; the export with ffmpeg's lutrgb and
// colorchannelmixer. The overlays are drawn over the corrected picture and are never corrected.

// Each value is in steps from −100 to +100; 0 (or missing) is the video as it is.
export interface VideoLook { brightness?: number; contrast?: number; saturation?: number }

export const LOOK_MIN = -100
export const LOOK_MAX = 100

const clampStep = (n: number | undefined) => (Number.isFinite(n) ? Math.min(LOOK_MAX, Math.max(LOOK_MIN, Math.round(n!))) : 0)

// The look with every value clamped and the zeros left out; null when it changes nothing.
export function cleanLook(look: VideoLook | null | undefined): VideoLook | null {
  if (!look) return null
  const out: VideoLook = {}
  for (const k of ['brightness', 'contrast', 'saturation'] as const) {
    const v = clampStep(look[k])
    if (v) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

// The numbers the steps use: gamma exponent, contrast slope, saturation amount.
// +100 brightness is v^0.4 (a dark gym made bright), −100 is v^2.5; contrast ±100 is a slope of 2 / 0;
// saturation +100 doubles the colour, −100 is black and white.
export function lookParams(look: VideoLook | null | undefined): { gamma: number; slope: number; sat: number } {
  const l = cleanLook(look) ?? {}
  return {
    gamma: Math.pow(2.5, -(l.brightness ?? 0) / 100),
    slope: 1 + (l.contrast ?? 0) / 100,
    sat: 1 + (l.saturation ?? 0) / 100,
  }
}

// The saturate matrix's rows (SVG feColorMatrix type="saturate", which CSS saturate() is too).
export function saturateMatrix(s: number): [number, number, number][] {
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ]
}

// One RGB value (0..1) through brightness and contrast, as both the preview and the export do it.
export function toneValue(v: number, gamma: number, slope: number): number {
  return Math.min(1, Math.max(0, (Math.pow(v, gamma) - 0.5) * slope + 0.5))
}

const n = (x: number) => String(Math.round(x * 10000) / 10000)

// ffmpeg filters for the look, to put in a chain on frames of any format: ",format=gbrp,lutrgb=…,colorchannelmixer=…"
// (each with a leading comma so it slots in), or '' when the look changes nothing.
export function lookFilter(look: VideoLook | null | undefined): string {
  if (!cleanLook(look)) return ''
  const { gamma, slope, sat } = lookParams(look)
  let f = ',format=gbrp'
  if (gamma !== 1 || slope !== 1) {
    const e = `clip((pow(val/maxval,${n(gamma)})-0.5)*${n(slope)}+0.5,0,1)*maxval` // quoted, so its commas don't end the filter
    f += `,lutrgb=r='${e}':g='${e}':b='${e}'`
  }
  if (sat !== 1) {
    const m = saturateMatrix(sat)
    const ch = ['r', 'g', 'b']
    f += `,colorchannelmixer=${m.flatMap((row, i) => row.map((c, j) => `${ch[i]}${ch[j]}=${n(c)}`)).join(':')}`
  }
  return f
}

// The SVG filter's primitives for the preview, as plain data (VideoLookFilter renders them).
export function lookSvg(look: VideoLook | null | undefined): { gamma: number; slope: number; intercept: number; sat: number } | null {
  if (!cleanLook(look)) return null
  const { gamma, slope, sat } = lookParams(look)
  return { gamma, slope, intercept: 0.5 - 0.5 * slope, sat }
}
