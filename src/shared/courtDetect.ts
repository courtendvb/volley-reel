// A first guess at the court's four corners from the video's frames. Match videos are shot from up
// behind one end, with the court in the middle of the picture. So the end lines come first: the five
// lines across the court fall at spacings perspective fixes, which tells them from the net, the boards
// and each other. Then each sideline is the straight paint between the two end lines, and the court
// must sit in the middle of the picture. A median over frames from different moments takes the
// players off the floor. The guess is meant to be finished by hand; with no good court it says nothing.
import { homography, project, type CourtFit, type Pt } from './court'

export const DETECT_W = 1280, DETECT_H = 720 // the size frames are read at, in RGB; far sidelines are thin
const GAP = 4 // how far from a line, in pixels, the floor beside it is looked at
const RIDGE = 60 // how far a pixel can count as standing out, so one bright spot doesn't make a line
const CONTRAST = 30, FLAT = 18 // how far colours are apart (R + G + B) at a change, and at most on flat floor
const LEANS = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015] // of end lines: pixels down per pixel across
const RATIOS = 28 // far end's width to the near end's, tried from 0.45 in steps of 0.01
const NEAR_ROWS = 20, FAR_ROWS = 60, STRONG_ROWS = 40 // rows tried for each end line, and looked at for stray lines
const PAIRS = 10 // pairs of end lines taken on to look for sidelines
const CENTRED = 0.04 // of the picture's width: how far each end's middle can be from the middle
const SIDES = 4 // sidelines kept for each side of the court
const SAMPLES = 40 // points looked at along each line of the court
const MIN_SCORE = 0.5 // of the lines' points that are on paint, for the guess to count

interface Line { slope: number; at: number } // y = slope x + at, or for a sideline x = slope y + at
interface Ends { far: Line; near: Line; ratio: number; fit: number }

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

// (ridge: how far a pixel stands out from both its left and its right: a sideline of any colour, even
// where the mask loses it, thin and slanted far away.)
// Where the flat floor changes: a painted line of another colour than both sides of it, or the edge
// between two floors of different colours, which is how a court's sides look on many floors. Both
// sides must be flat, which the crowd and the boards aren't. Above and below for lines across the
// picture, left and right for lines going up it.
function paint(c: Uint8Array, w: number, h: number) {
  const across = new Uint8Array(w * h), along = new Uint8Array(w * h), ridge = new Uint8Array(w * h), ridgeUp = new Uint8Array(w * h)
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
      ridge[p] = Math.min(RIDGE, far(i, i - GAP * 3), far(i, i + GAP * 3))
      ridgeUp[p] = Math.min(RIDGE, far(i, i - GAP * w * 3), far(i, i + GAP * w * 3))
    }
  }
  return { across, along, ridge, ridgeUp }
}

// Where an end line (y = m x + b) meets a sideline (x = n y + c).
function meet(e: Line, s: Line): Pt {
  const y = (e.slope * s.at + e.at) / (1 - e.slope * s.slope)
  return { x: s.slope * y + s.at, y }
}

function score(corners: [Pt, Pt, Pt, Pt], on: Uint8Array, w: number, h: number): number {
  const H = homography(corners)
  const hit = (u: number, v: number) => {
    const p = project(H, u, v), x = Math.round(p.x), y = Math.round(p.y)
    if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) return 0
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (on[(y + dy) * w + x + dx]) return 1
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
    + line(s => [-0.02 - s * 0.1, 0]) + line(s => [1.02 + s * 0.1, 0]) + line(s => [-0.02 - s * 0.1, 1]) + line(s => [1.02 + s * 0.1, 1])
  return (sides + inside * 2 - past / 2) / 9
}

// A camera up behind one end of the court, in the middle of it, as match videos are shot: the court
// is centred across the picture, fills its lower part, and its far end looks 45-72 % as wide as the near end.
function plausible(c: [Pt, Pt, Pt, Pt], w: number, h: number): boolean {
  const top = c[1].x - c[0].x, bottom = c[3].x - c[2].x, ratio = top / bottom
  const off = (a: Pt, b: Pt) => Math.abs((a.x + b.x) / 2 - w / 2)
  return bottom > w * 0.5 && ratio > 0.45 && ratio < 0.73 && off(c[0], c[1]) < w * CENTRED && off(c[2], c[3]) < w * CENTRED
    && Math.min(c[0].y, c[1].y) > h * 0.25 && Math.min(c[2].y, c[3].y) > h * 0.7 && Math.max(c[2].y, c[3].y) < h * 1.03
}

// How much of each row, in the middle of the picture where every court line is, is paint.
function rowPaint(ridgeUp: Uint8Array, w: number, h: number, lean: number): Float32Array {
  const rows = new Float32Array(h), from = Math.round(w * 0.3), to = Math.round(w * 0.7)
  for (let y = 0; y < h; y++) {
    let n = 0, on = 0
    for (let x = from; x < to; x += 2) {
      const at = Math.round(y + lean * (x - w / 2))
      if (at < 1 || at >= h - 1) continue
      n++
      on += Math.max(ridgeUp[(at - 1) * w + x], ridgeUp[at * w + x], ridgeUp[(at + 1) * w + x]) / RIDGE
    }
    rows[y] = n ? on / n : 0
  }
  return rows
}

// A row v of the way down the court, between the ends: far lines are closer together.
const rowAt = (far: number, near: number, ratio: number, v: number) => far + (near - far) * ratio * v / (1 - v + ratio * v)

// The likeliest end lines: for each pair of rows and each width ratio, whether the attack lines and the
// centre line are where they would be.
function endLines(ridgeUp: Uint8Array, w: number, h: number): Ends[] {
  const found: Ends[] = []
  for (const lean of LEANS) {
    const rows = rowPaint(ridgeUp, w, h, lean)
    const close = (y: number) => { const r = Math.round(y); return Math.max(rows[r - 2] ?? 0, rows[r - 1] ?? 0, rows[r] ?? 0, rows[r + 1] ?? 0, rows[r + 2] ?? 0) }
    const peaks: number[] = []
    for (let y = Math.ceil(h * 0.25); y < h; y++) if (rows[y] >= 0.15 && rows[y] >= (rows[y - 1] ?? 0) && rows[y] >= (rows[y + 1] ?? 0)) peaks.push(y)
    // Only the strongest: a textured floor has a peak on nearly every row, and every pair would be tried.
    const strongest = (list: number[], count: number) => [...list].sort((a, b) => rows[b] - rows[a]).slice(0, count)
    const nears = strongest(peaks.filter(y => y >= h * 0.8), NEAR_ROWS), fars = strongest(peaks.filter(y => y < h * 0.65), FAR_ROWS)
    const strong = strongest(peaks.filter(y => rows[y] >= 0.6), STRONG_ROWS)
    const line = (y: number): Line => ({ slope: lean, at: y - lean * w / 2 })
    for (const near of nears) {
      for (const far of fars) {
        for (let k = 0; k < RATIOS; k++) {
          const ratio = 0.45 + k * 0.01, inner = [1 / 3, 0.5, 2 / 3].map(v => rowAt(far, near, ratio, v))
          const at = (i: number) => close(inner[i])
          // A strong line inside that the court doesn't have: the real end, if this one is the net's.
          let stray = 0
          for (const y of strong) if (y > far + 3 && y < near - 3 && !inner.some(r => Math.abs(r - y) < 4)) stray += rows[y]
          found.push({ far: line(far), near: line(near), ratio, fit: rows[far] + rows[near] + (at(0) + at(2)) * 1.5 + at(1) / 2 - stray })
        }
      }
    }
  }
  found.sort((a, b) => b.fit - a.fit)
  const kept: Ends[] = [], mid = (l: Line) => l.slope * w / 2 + l.at
  for (const e of found) {
    if (kept.some(k => Math.abs(mid(k.far) - mid(e.far)) < 3 && Math.abs(mid(k.near) - mid(e.near)) < 3)) continue
    kept.push(e)
    if (kept.length === PAIRS) break
  }
  return kept
}

// The sidelines most on paint between the end lines, on one side of the picture. side: -1 left, 1 right.
function sidelines(e: Ends, ridge: Uint8Array, w: number, h: number, side: number): Line[] {
  const cx = w / 2, step = Math.max(1, Math.round(w / 640)), tries: { line: Line; on: number }[] = []
  const hit = (x: number, y: number) => {
    const X = Math.round(x), Y = Math.round(y)
    if (X < 1 || Y < 0 || X >= w - 1 || Y >= h) return 0
    return Math.max(ridge[Y * w + X - 1], ridge[Y * w + X], ridge[Y * w + X + 1])
  }
  for (let half = w * 0.25; half <= w * 0.54; half += step) {
    const nearX = cx + side * half, nearY = e.near.slope * nearX + e.near.at
    const centre = cx + side * half * e.ratio
    for (let farX = centre - w * CENTRED; farX <= centre + w * CENTRED; farX += step) {
      const farY = e.far.slope * farX + e.far.at
      let on = 0
      for (let i = 0; i <= SAMPLES * 2; i++) { const s = i / (SAMPLES * 2); on += hit(farX + (nearX - farX) * s, farY + (nearY - farY) * s) }
      const slope = (nearX - farX) / (nearY - farY)
      tries.push({ line: { slope, at: farX - slope * farY }, on })
    }
  }
  tries.sort((a, b) => b.on - a.on)
  const kept: Line[] = [], mid = h * 0.7
  for (const t of tries) {
    if (kept.some(k => Math.abs(k.slope * mid + k.at - (t.line.slope * mid + t.line.at)) < 4 * step)) continue
    kept.push(t.line)
    if (kept.length === SIDES) break
  }
  return kept
}

// The line through the paint close to `l`, for a corner that lands on the line's middle.
function settle(l: Line, mask: Uint8Array, w: number, h: number, sideways: boolean, from: number, to: number): Line {
  let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let run = Math.max(0, Math.round(from)); run < Math.min(sideways ? h : w, to); run++) {
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
  const { across, along, ridge, ridgeUp } = paint(median(frames, w, h), w, h)
  const on = new Uint8Array(w * h)
  for (let i = 0; i < on.length; i++) on[i] = ridgeUp[i] > RIDGE / 3 || ridge[i] > RIDGE / 3 ? 1 : 0
  const corners = ([f, n, a, b]: Line[]): [Pt, Pt, Pt, Pt] => [meet(f, a), meet(f, b), meet(n, a), meet(n, b)]
  let best: { lines: [Line, Line, Line, Line]; score: number } | null = null
  for (const e of endLines(ridgeUp, w, h)) {
    const rights = sidelines(e, ridge, w, h, 1)
    for (const l of sidelines(e, ridge, w, h, -1)) {
      for (const r of rights) {
        const lines: [Line, Line, Line, Line] = [e.far, e.near, l, r], c = corners(lines)
        if (!plausible(c, w, h)) continue
        const s = score(c, on, w, h)
        if (!best || s > best.score) best = { lines, score: s }
      }
    }
  }
  if (!best || best.score < MIN_SCORE) return null
  let [far, near, l, r] = best.lines
  for (let i = 0; i < 2; i++) {
    const c = corners([far, near, l, r])
    far = settle(far, across, w, h, false, c[0].x, c[1].x); near = settle(near, across, w, h, false, c[2].x, c[3].x)
    l = settle(l, along, w, h, true, c[0].y, c[2].y); r = settle(r, along, w, h, true, c[1].y, c[3].y)
  }
  const unit = (p: Pt): Pt => ({ x: p.x / w, y: p.y / h })
  return { corners: corners([far, near, l, r]).map(unit) as CourtFit['corners'], score: best.score }
}
