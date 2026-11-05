// A first guess at the court's four corners from the video's frames: find the painted lines, then take
// the four that make the court whose other lines (the attack lines, the centre line) are there too.
// A median over frames from different moments takes the players off the floor. The guess is meant
// to be finished by hand, so it may be a little off; with no good court it says nothing.
import { homography, project, type CourtFit, type Pt } from './court'

export const DETECT_W = 640, DETECT_H = 360 // the size frames are read at, in RGB
const GAP = 3 // how far from a line, in pixels, the floor beside it is looked at
const CONTRAST = 30, FLAT = 18 // how far colours are apart (R + G + B) at a change, and at most on flat floor
const STRAIGHT = 0.2 // end lines lean at most this much: pixels down per pixel across
const STEEPEST = 1.6, LEAST = 0.08 // sidelines: pixels across per pixel down
const SLIDE = 14 // how far a line is tried either way, in pixels
const SAMPLES = 40 // points looked at along each line of the court
const MIN_SCORE = 0.5 // of the lines' points that are on paint, for the guess to count

interface Line { slope: number; at: number } // y = slope x + at, or for a sideline x = slope y + at

// Each pixel's colour in the middle of the frames, which takes the players off the floor.
function median(frames: Uint8Array[], w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3), now = new Array<number>(frames.length), n = w * h * 3
  for (let i = 0; i < n; i++) {
    for (let f = 0; f < frames.length; f++) now[f] = frames[f][i]
    now.sort((a, b) => a - b)
    out[i] = now[frames.length >> 1]
  }
  return out
}

// Where the flat floor changes: a painted line of another colour than both sides of it, or the edge
// between two floors of different colours, which is how a court's sides look on many floors. Both
// sides must be flat, which the crowd and the boards aren't. Above and below for lines across the
// picture, left and right for lines going up it.
function paint(c: Uint8Array, w: number, h: number) {
  const across = new Uint8Array(w * h), along = new Uint8Array(w * h)
  const far = (i: number, j: number) => Math.abs(c[i] - c[j]) + Math.abs(c[i + 1] - c[j + 1]) + Math.abs(c[i + 2] - c[j + 2])
  const line = (i: number, s: number) => {
    const a = i - s, b = i + s
    if (far(a, a - s) > FLAT || far(b, b + s) > FLAT) return false
    return far(a, b) > CONTRAST || (far(i, a) > CONTRAST && far(i, b) > CONTRAST)
  }
  for (let y = GAP * 2; y < h - GAP * 2; y++) {
    for (let x = GAP * 2; x < w - GAP * 2; x++) {
      const p = y * w + x, i = p * 3
      if (line(i, GAP * w * 3)) across[p] = 1
      if (line(i, GAP * 3)) along[p] = 1
    }
  }
  return { across, along }
}

// The strongest straight lines through a mask. `pos` gives a marked pixel's (run, rise): rise = slope
// run + at; a Hough transform over slope and at, the best kept apart from each other.
function strongest(mask: Uint8Array, w: number, h: number, sideways: boolean, slopes: number[], count: number): Line[] {
  const span = sideways ? w : h, reach = sideways ? h : w, pad = Math.ceil(reach * Math.max(...slopes.map(Math.abs)))
  const rows = span + pad * 2 + 1, votes = new Int32Array(slopes.length * rows)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      const run = sideways ? y : x, rise = sideways ? x : y
      for (let s = 0; s < slopes.length; s++) {
        const at = Math.round(rise - slopes[s] * run) + pad
        if (at >= 0 && at < rows) votes[s * rows + at]++
      }
    }
  }
  const order = [...votes.keys()].filter(i => votes[i] > 20).sort((a, b) => votes[b] - votes[a])
  const out: Line[] = []
  for (const i of order) {
    const slope = slopes[Math.floor(i / rows)], at = (i % rows) - pad
    const mid = reach / 2
    if (out.some(l => Math.abs(l.slope * mid + l.at - (slope * mid + at)) < 7 && Math.abs(l.slope - slope) < 0.06)) continue
    out.push({ slope, at })
    if (out.length === count) break
  }
  return out
}

// Where an end line (y = m x + b) meets a sideline (x = n y + c).
function meet(e: Line, s: Line): Pt {
  const y = (e.slope * s.at + e.at) / (1 - e.slope * s.slope)
  return { x: s.slope * y + s.at, y }
}

const steps = (from: number, to: number, by: number) => { const o: number[] = []; for (let x = from; x <= to + 1e-9; x += by) o.push(x); return o }

function score(corners: [Pt, Pt, Pt, Pt], on: Uint8Array, w: number, h: number): number {
  const H = homography(corners)
  const hit = (u: number, v: number) => {
    const p = project(H, u, v), x = Math.round(p.x), y = Math.round(p.y)
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return 0
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (on[(y + dy) * w + x + dx]) return 1
    return 0
  }
  const line = (a: (s: number) => [number, number]) => {
    let n = 0
    for (let i = 0; i <= SAMPLES; i++) { const [u, v] = a(i / SAMPLES); n += hit(u, v) }
    return n / (SAMPLES + 1)
  }
  // The four sides; the attack and centre lines, which tell the court from anything else
  // rectangular; and no paint going on past a corner, as there would be past a line taken for the end.
  const sides = line(s => [0, s]) + line(s => [1, s]) + line(s => [s, 0]) + line(s => [s, 1])
  const inside = line(s => [s, 1 / 3]) + line(s => [s, 2 / 3]) + line(s => [s, 0.5]) / 2
  const past = line(s => [0, -0.02 - s * 0.1]) + line(s => [1, -0.02 - s * 0.1]) + line(s => [0, 1.02 + s * 0.1]) + line(s => [1, 1.02 + s * 0.1])
  return (sides + inside * 2 - past) / 9
}

// A camera up behind one end of the court, as match videos are shot: the court fills the lower part
// of the picture, and the far end looks 45-80 % as wide as the near end.
function plausible(c: [Pt, Pt, Pt, Pt], w: number, h: number): boolean {
  const top = c[1].x - c[0].x, bottom = c[3].x - c[2].x, ratio = top / bottom
  return bottom > w * 0.5 && ratio > 0.45 && ratio < 0.8 && c[0].y > h * 0.3 && c[1].y > h * 0.3 && c[2].y > h * 0.7 && c[3].y > h * 0.7
}

// The line through the paint close to `l`, for a corner that lands on the line's middle.
function settle(l: Line, mask: Uint8Array, w: number, h: number, sideways: boolean): Line {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
  const reach = sideways ? h : w
  for (let run = 0; run < reach; run++) {
    const want = l.slope * run + l.at
    for (let rise = Math.round(want) - 3; rise <= Math.round(want) + 3; rise++) {
      const i = sideways ? run * w + rise : rise * w + run
      if (i < 0 || i >= w * h || rise < 0 || rise >= (sideways ? w : h) || !mask[i]) continue
      n++; sx += run; sy += rise; sxx += run * run; sxy += run * rise
    }
  }
  const den = n * sxx - sx * sx
  if (n < 30 || Math.abs(den) < 1e-6) return l
  const slope = (n * sxy - sx * sy) / den
  return { slope, at: (sy - slope * sx) / n }
}

// frames: RGB, w × h, from different moments of the match. The corners as CourtFit keeps them.
export function detectCourt(frames: Uint8Array[], w = DETECT_W, h = DETECT_H): { corners: CourtFit['corners']; score: number } | null {
  if (!frames.length) return null
  const { across, along } = paint(median(frames, w, h), w, h)
  const on = new Uint8Array(w * h)
  for (let i = 0; i < on.length; i++) on[i] = across[i] | along[i]
  const ends = strongest(across, w, h, false, steps(-STRAIGHT, STRAIGHT, 0.01), 24)
  const lefts = strongest(along, w, h, true, steps(-STEEPEST, -LEAST, 0.02), 24)
  const rights = strongest(along, w, h, true, steps(LEAST, STEEPEST, 0.02), 24)
  let best: { lines: [Line, Line, Line, Line]; score: number } | null = null
  for (const far of ends) {
    for (const near of ends) {
      if (far.at + far.slope * w / 2 >= near.at + near.slope * w / 2 - h * 0.2) continue
      for (const l of lefts) {
        for (const r of rights) {
          const c: [Pt, Pt, Pt, Pt] = [meet(far, l), meet(far, r), meet(near, l), meet(near, r)]
          if (!plausible(c, w, h)) continue
          const s = score(c, on, w, h)
          if (!best || s > best.score) best = { lines: [far, near, l, r], score: s }
        }
      }
    }
  }
  if (!best || best.score < MIN_SCORE) return null
  // A line the search missed (a faint end line, say): each in turn slid and turned to do better.
  const corners = ([f, n, a, b]: Line[]): [Pt, Pt, Pt, Pt] => [meet(f, a), meet(f, b), meet(n, a), meet(n, b)]
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 4; i++) {
      for (let move = -SLIDE; move <= SLIDE; move += 2) {
        for (let turn = -3; turn <= 3; turn++) {
          const lines = [...best.lines] as [Line, Line, Line, Line], old = lines[i]
          const mid = (i < 2 ? w : h) / 2, slope = old.slope + turn * 0.01
          lines[i] = { slope, at: old.at + (old.slope - slope) * mid + move }
          const c = corners(lines)
          if (!plausible(c, w, h)) continue
          const s = score(c, on, w, h)
          if (s > best.score) best = { lines, score: s }
        }
      }
    }
  }
  let [far, near, l, r] = best.lines
  for (let i = 0; i < 2; i++) {
    far = settle(far, across, w, h, false); near = settle(near, across, w, h, false)
    l = settle(l, along, w, h, true); r = settle(r, along, w, h, true)
  }
  const unit = (p: Pt): Pt => ({ x: p.x / w, y: p.y / h })
  return { corners: [unit(meet(far, l)), unit(meet(far, r)), unit(meet(near, l)), unit(meet(near, r))], score: best.score }
}
