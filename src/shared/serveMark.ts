// A serve's hit and its reception's touch, marked by hand frame by frame (video times). They belong to
// the play, not to a clip: kept on the match by the play's fingerprint, so a serve can be marked from
// the list and every clip of it, in any scene, measures and flies the same.
import type { Match, Play, ServeMark } from './types'

// The mark of a play on its match; undefined when nothing is marked.
export function serveMarkOf(match: Pick<Match, 'serveMarks'> | null | undefined, play: Pick<Play, 'fingerprint'>): ServeMark | undefined {
  return match?.serveMarks?.[play.fingerprint]
}

// The match with a play's mark changed: a time set, or cleared with null. A mark with neither time goes.
export function withServeMark<M extends Pick<Match, 'serveMarks'>>(match: M, fingerprint: string, patch: { hit?: number | null; touch?: number | null }): M {
  const was = match.serveMarks?.[fingerprint] ?? {}
  const next: ServeMark = { ...was }
  for (const k of ['hit', 'touch'] as const) {
    const v = patch[k]
    if (v === null) delete next[k]
    else if (v !== undefined) {
      if (!Number.isFinite(v) || v < 0) throw new Error(`bad ${k} time: ${v}`)
      next[k] = Math.round(v * 1000) / 1000
    }
  }
  const { [fingerprint]: _old, ...rest } = match.serveMarks ?? {}
  const marks = next.hit !== undefined || next.touch !== undefined ? { ...rest, [fingerprint]: next } : rest
  const { serveMarks: _was, ...base } = match
  return (Object.keys(marks).length ? { ...base, serveMarks: marks } : base) as M
}

// The times a play's flight and speed go by: the play's marks over the clip's own red line.
export function playTimes(mark: ServeMark | undefined, clip?: { skillSec?: number; speedKmh?: number } | null): { skillSec?: number; speedKmh?: number; touchSec?: number } {
  const skillSec = mark?.hit ?? clip?.skillSec
  return { ...(skillSec !== undefined ? { skillSec } : {}), ...(clip?.speedKmh !== undefined ? { speedKmh: clip.speedKmh } : {}), ...(mark?.touch !== undefined ? { touchSec: mark.touch } : {}) }
}
