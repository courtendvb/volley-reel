// How far the player's marks reach (the 表示 tab's 範囲): every shot of the player in the project's
// matches (the usual), only the match on screen, the scene the clip is in, the marker group it is in,
// the rally of the play shown, or the plays of the search. The marks (heatmap, landings, flights,
// cones, charts) are made from the shots left.
import type { Group, Reel } from './reel'
import type { ParsedDVW, Play } from './types'

export type MarkRange = 'all' | 'match' | 'scene' | 'marker' | 'rally' | 'filter'
export const MARK_RANGES: MarkRange[] = ['all', 'match', 'scene', 'marker', 'rally', 'filter']
export const isMarkRange = (x: unknown): x is MarkRange => typeof x === 'string' && (MARK_RANGES as string[]).includes(x)

// Where the narrower ranges look, each only when asked for.
export interface RangeSource { match?: () => Play[]; scene?: () => Play[]; marker?: () => Play[]; filter?: () => Play[] }

// The shots the marks of `play` are made from. A range with no source (no scene open, say) is the whole pool.
export function rangePlays(range: MarkRange | undefined, play: Pick<Play, 'rallyId'>, all: () => Play[], src?: RangeSource): Play[] {
  if (!range || range === 'all') return all()
  if (range === 'rally') {
    const of = src?.match?.()
    return of && play.rallyId !== null ? of.filter(p => p.rallyId === play.rallyId) : all()
  }
  return src?.[range]?.() ?? all()
}

// The plays of some clips, as the matches parsed them.
const playsOf = (reel: Reel, ids: string[], dvws: Record<string, ParsedDVW | undefined>): Play[] =>
  ids.flatMap(id => { const c = reel.clips[id], p = c && dvws[c.matchId]?.plays[c.playId]; return p ? [p] : [] })

export const scenePlays = (reel: Reel, dvws: Record<string, ParsedDVW | undefined>): Play[] => playsOf(reel, Object.keys(reel.clips), dvws)
export const markerPlays = (reel: Reel, group: Group, dvws: Record<string, ParsedDVW | undefined>): Play[] => playsOf(reel, reel.groups[group], dvws)

// The sources for a clip of a scene, played in a group (null: not in a scene, so only the match applies).
export function clipRangeSource(reel: Reel | null | undefined, group: Group | null, matchId: string, dvws: Record<string, ParsedDVW | undefined>): RangeSource {
  return {
    match: () => dvws[matchId]?.plays ?? [],
    ...(reel ? { scene: () => scenePlays(reel, dvws) } : {}),
    ...(reel && group ? { marker: () => markerPlays(reel, group, dvws) } : {}),
  }
}
