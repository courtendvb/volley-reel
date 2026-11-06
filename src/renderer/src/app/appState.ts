// What App keeps in its `latest` ref (the state as of the last render, for callbacks and the
// self-checks), and small helpers App and its hooks share.
import type { PlayFilter, PlayRef } from '../../../shared/filter'
import { markersOf, relink, type Clip, type Group, type Marker, type Reel } from '../../../shared/reel'
import type { CaptionData, OverlaySettings, ScoreboardData } from '../../../shared/overlay'
import type { LibraryInfo, Match, ParsedDVW, ProjectSettings } from '../../../shared/types'
import { opponentLabel, type Video } from '../../../shared/video'
import type { PlayKey } from '../components/PlayList'
import type { ClipInfo } from '../components/ReelPanel'

type OverlayData = { scoreboard: ScoreboardData; caption: CaptionData }

export interface AppLatest {
  results: PlayRef[]; filter: PlayFilter; matches: Record<string, Match>; reels: Reel[]; reelId: string | null; reel: Reel | null
  selected: PlayKey | null; activeClipId: string | null; order: Clip[]; clipInfo: (c: Clip) => ClipInfo; selectedAnn: string | null
  overlay: OverlaySettings; settings: ProjectSettings | undefined; videos: Video[]; videoId: string | null; video: Video | null
  orderOf: (s: Reel) => Clip[]; infoFor: (c: Clip, scene: Reel | null) => ClipInfo
  overlayData: null | ((c: Clip | null) => OverlayData | null)
  exportState: null | { status: string; ratio: number; message: string; outPath?: string }; notice: string | null
  dvwsRef: null | Record<string, ParsedDVW>; library: LibraryInfo | null; projectPath: string | null; activeGroup: Group | null
}

// The marker group a clip is worked on in: the one it was opened from if it is still in it, else its
// first marker (null when it has none, so there are no marker-wide objects to show).
export function markerFor(r: Reel, clipId: string, preferred: Group | null): Marker | null {
  if (preferred && preferred !== 'none' && r.groups[preferred].includes(clipId)) return preferred
  return markersOf(r, clipId)[0] ?? null
}

// Clips whose play can't be found in the DVW, per scene object and DVW set (relink walks every clip).
const missingMemo = new WeakMap<Reel, { dvws: Record<string, ParsedDVW>; missing: Set<string> }>()
export function missingOf(r: Reel, dvws: Record<string, ParsedDVW>): Set<string> {
  const hit = missingMemo.get(r)
  if (hit && hit.dvws === dvws) return hit.missing
  const missing = relink(r, dvws).missing
  missingMemo.set(r, { dvws, missing })
  return missing
}

// Dialog preview data: the active (or first) clip's real data, or a placeholder for an empty reel.
export function overlaySample(d: OverlayData | null, r: Reel | null) {
  const m = r?.groupOrder.find(g => r.groups[g].length) ?? 1
  return {
    scoreboard: d?.scoreboard ?? { left: 'HTH', right: 'OPP', ptsL: 17, ptsR: 9, setsL: 1, setsR: 0, winner: 'L' as const },
    caption: d?.caption ?? { number: 1, name: 'PLAYER', line: 'SERVE · ACE' },
    card: { marker: m, name: r?.markerNames[m] ?? '', match: null },
  }
}

// Short label for the match column: "10/11 SMT" (the opponent when one side is ours).
export function labelMatches(ms: Match[], codes: string[]): Record<string, string> {
  return Object.fromEntries(ms.map(m => {
    const d = m.date ? `${+m.date.slice(5, 7)}/${+m.date.slice(8, 10)}` : ''
    return [m.id, `${d} ${opponentLabel(m, codes)}`.trim()]
  }))
}
