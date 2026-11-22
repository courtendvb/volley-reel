// Slow motion and holds within a clip: a stretch played at a lower rate, or the picture held still
// at a moment for a few seconds. Times are video times like IN / OUT (design §11), so trimming
// doesn't move them; the parts outside IN–OUT are ignored. The preview (playback.ts) and the export
// (main/export.ts) both play a clip as these pieces in order.

export interface Slow { from: number; to: number; rate: number } // rate < 1: 0.5 = half speed
export interface Hold { at: number; sec: number } // the frame at `at` stays for `sec` seconds
export interface ClipTiming { slows?: Slow[]; holds?: Hold[] }

export const SLOW_RATES = [0.75, 0.5, 0.25] as const

// One piece of a clip as played: a stretch of the video at a rate, or a held frame.
type Piece = { kind: 'play'; from: number; to: number; rate: number } | { kind: 'hold'; at: number; sec: number }

const EPS = 1e-6

// The clip from `inT` to `outT` as pieces: plain play at rate 1, the slow stretches at theirs (where
// two overlap, the slower wins), and each hold where it falls (one at OUT holds the last frame).
export function pieces(inT: number, outT: number, timing?: ClipTiming): Piece[] {
  if (!(outT > inT)) return []
  const slows = (timing?.slows ?? []).filter(s => s.rate > 0 && s.to > inT && s.from < outT && s.to > s.from)
  const holds = (timing?.holds ?? []).filter(h => h.sec > 0 && h.at >= inT - EPS && h.at <= outT + EPS)
    .map(h => ({ at: Math.min(outT, Math.max(inT, h.at)), sec: h.sec })).sort((a, b) => a.at - b.at)
  const cuts = [...new Set([inT, outT, ...slows.flatMap(s => [s.from, s.to]), ...holds.map(h => h.at)]
    .map(x => Math.min(outT, Math.max(inT, x))))].sort((a, b) => a - b)
  const out: Piece[] = []
  const play = (from: number, to: number) => {
    if (to - from < EPS) return
    const mid = (from + to) / 2
    const rate = Math.min(1, ...slows.filter(s => s.from <= mid && mid <= s.to).map(s => s.rate))
    const last = out[out.length - 1]
    if (last?.kind === 'play' && last.rate === rate && Math.abs(last.to - from) < EPS) last.to = to
    else out.push({ kind: 'play', from, to, rate })
  }
  let h = 0
  for (let i = 0; i < cuts.length; i++) {
    while (h < holds.length && holds[h].at <= cuts[i] + EPS) out.push({ kind: 'hold', ...holds[h++] })
    if (i + 1 < cuts.length) play(cuts[i], cuts[i + 1])
  }
  return out
}

const pieceSec = (p: Piece) => (p.kind === 'hold' ? p.sec : (p.to - p.from) / p.rate)

// How long the clip plays: slow stretches take longer, holds add their seconds.
export function playedSec(ps: Piece[]): number {
  return ps.reduce((s, p) => s + pieceSec(p), 0)
}

// Where a video time lands in the played clip (seconds from its start). At a held moment, 'start'
// is before the hold and 'end' after it, so an object shown across the moment stays up while held.
export function playedAt(ps: Piece[], t: number, edge: 'start' | 'end'): number {
  let acc = 0
  for (const p of ps) {
    if (p.kind === 'hold') {
      if (p.at > t + EPS) break
      if (p.at < t - EPS || edge === 'end') acc += p.sec
      continue
    }
    if (t <= p.from + EPS) break
    if (t < p.to - EPS) return acc + (t - p.from) / p.rate
    acc += (p.to - p.from) / p.rate
  }
  return acc
}

// The slow rate at a video time (1 outside every slow stretch).
export function rateAt(timing: ClipTiming | undefined, t: number): number {
  return Math.min(1, ...(timing?.slows ?? []).filter(s => s.rate > 0 && s.from <= t && t < s.to).map(s => s.rate))
}

// How long a clip plays from IN to OUT with its slows and holds.
export function clipPlayedSec(range: { in: number; out: number }, timing?: ClipTiming): number {
  return hasTiming(timing) ? playedSec(pieces(range.in, range.out, timing)) : range.out - range.in
}

export const hasTiming = (timing?: ClipTiming) => !!(timing?.slows?.length || timing?.holds?.length)
