// A clip's slow stretches and holds as an ffmpeg filter chain (design §11). Kept apart from export.ts,
// which needs Electron, so a test can run the chain through the real ffmpeg.
import type { ExportItem } from '../shared/types'
import { pieces } from '../shared/timing'

// '30000/1001' or '30' as a number.
export function fps(fpsStr: string): number {
  const [n, d] = fpsStr.split('/').map(Number)
  return d ? n / d : n
}

// The clip's slow stretches and holds as a filter chain on the trimmed clip (times from 0 at IN), or
// null when it has none: each piece cut from a copy of the clip, slowed by stretching its timestamps
// or held by cloning one frame, then joined and put back on the frame rate.
export function retime(it: Pick<Extract<ExportItem, { kind: 'clip' }>, 'in' | 'out' | 'timing'>, fpsStr: string): string | null {
  const ps = pieces(it.in, it.out, it.timing)
  if (ps.length < 2 && !(ps[0]?.kind === 'play' && ps[0].rate !== 1)) return null
  const frame = 1 / fps(fpsStr), last = Math.max(0, it.out - it.in - frame)
  const parts = ps.map((p, k) => {
    if (p.kind === 'play') return `[r${k}]trim=start=${(p.from - it.in).toFixed(4)}:end=${(p.to - it.in).toFixed(4)},setpts=(PTS-STARTPTS)/${p.rate}[q${k}]`
    // The held picture is the frame on screen at the hold time (the one the preview shows paused
    // there), cut by its number (frames count from 0 at IN). Cutting it by time doesn't work: a
    // one-frame window comes out empty, since trim drops a frame that runs past the window's end, and
    // a longer window ends at a later time, which concat then plays as part of the hold.
    const at = Math.min(last, Math.max(0, p.at - it.in))
    const n = Math.floor(at / frame + 1e-6)
    return `[r${k}]trim=start_frame=${n}:end_frame=${n + 1},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${Math.max(0, p.sec - frame).toFixed(4)}[q${k}]`
  })
  return `split=${ps.length}${ps.map((_, k) => `[r${k}]`).join('')};${parts.join(';')};${ps.map((_, k) => `[q${k}]`).join('')}concat=n=${ps.length}:v=1:a=0,fps=${fpsStr}`
}
