// Reel = the blueprint of one highlight video (design §3.4). Pure functions returning new reels,
// so the UI can treat a reel as immutable state and every change is unit-testable.
import { hasTiming, type ClipTiming } from './timing'
import { roundCoords, type Annotation } from './annotation'
import type { BoardMade, PlacedChart } from './board'
import type { DirectionChart } from './chart'
import type { SlideCones, SlideFlights, SlideHeat, SlideZones } from './court'
import type { CardLayout, ClipOverlayOverride, OverlayPatch } from './overlay'
import type { ParsedDVW, Play } from './types'

export type Marker = 1 | 2 | 3 | 4 | 5
export type Group = Marker | 'none'
export const MARKERS: Marker[] = [1, 2, 3, 4, 5]
export const MARKER_COLORS: Record<Marker, string> = { 1: '#2563EB', 2: '#DC2626', 3: '#16A34A', 4: '#D97706', 5: '#9333EA' }

export interface Clip {
  id: string
  matchId: string
  playId: number
  fingerprint: string // re-links the clip when the DVW is edited and ids shift
  inSec: number | null // video time; null = default rule (rally start)
  outSec: number | null
  annotations: Annotation[] // design §3.6; times are absolute video times
  overlayOverride?: ClipOverlayOverride // design §3.7: hide an auto element or rewrite the caption
  mode?: ClipMode // how it was cut when added from the search; missing = the scene's default
  tag?: string // a short note ("1", "A") to sort a group's clips by hand; never played or exported
  timing?: ClipTiming // slow stretches and holds (shared/timing.ts); video times like inSec / outSec
  speedKmh?: number // a serve's speed through the air, estimated by hand: how fast its flight goes
  skillSec?: number // when the play really happens, moved by hand from the DVW's whole second (the red line); starts the ball's flight
}

// "keyplay": key play ± seconds. "toEnd": from just before the key play to the end of its rally.
export type ClipMode = 'keyplay' | 'toEnd'

export interface Reel {
  id: string
  name: string
  markerNames: Record<Marker, string>
  groupOrder: Marker[]
  groups: Record<Group, string[]> // array order = clip order inside the group ('none' is shown chronologically)
  clips: Record<string, Clip>
  scope: 'marked' | 'all'
  noneByTag?: boolean // ungrouped clips by their tag, not in time order
  rangeDefaults?: RangeDefaults // added in M4; read through rangeDefaults()
  markerCards?: Partial<Record<Marker, boolean>> // title card per marker; missing = the video's setting
  sceneCard?: boolean // this scene's title card; missing = the video's setting
  markerOff?: Partial<Record<Marker, boolean>> // a marker group switched off: kept, but not played or exported
  annotations?: Annotation[] // objects shown on every clip of the scene (表示範囲: シーン全体)
  markerAnnotations?: Partial<Record<Marker, Annotation[]>> // objects on every clip of a marker group (表示範囲: マーカー全体)
  cardAnnotations?: Annotation[] // objects on the scene's title card
  markerCardAnnotations?: Partial<Record<Marker, Annotation[]>> // objects on each marker's title card
  cardTitle?: string // the scene card's text when it differs from the name (may have line breaks: one line each)
  markerCardTitles?: Partial<Record<Marker, string>> // the same for each marker's card
  cardLayout?: CardLayout // the scene card's own title place and size; missing = the video's for scene cards
  markerCardLayouts?: Partial<Record<Marker, CardLayout>> // the same for each marker's card
  slides?: Slide[] // still pages between clips; see Slide
  overlay?: OverlayPatch // M6 only: moved to the video in v3 (kept so old files still read)
  updatedAt: string
}

// A slide: a still page shown between clips (blank, a picture, a PDF page or a frame of a match),
// with objects on it like a title card. It sits in one group right after a clip (`after`; null =
// the group's head) and follows that clip when the clip moves. Slides after the same clip play in
// their order in Reel.slides.
export interface Slide {
  id: string
  group: Group
  after: string | null
  durationSec: number
  bg: SlideBg
  annotations: Annotation[]
  flights?: SlideFlights // balls flying over the picture, all at once (a search's serves)
  heat?: SlideHeat // a heatmap on the floor of the picture (where a search's shots landed)
  landings?: SlideHeat // where a player's shots landed, as points
  cones?: SlideCones // where a player's attacks went, as cones
  chart?: DirectionChart // a player's direction chart, fixed when it was put on
  charts?: PlacedChart[] // the charts of a slide comparing players (shared/board.ts)
  board?: BoardMade // how that slide was made
  zones?: SlideZones // a play's zones or clicks
}

// blank: the title card's background color. image: a picture in assets/. source: the file it was
// read from (page: a PDF's page, 1-based), so it can be read again when that file changes.
export type SlideBg = { kind: 'blank'; color?: string } | { kind: 'image'; assetId: string; source?: SlideSource }
interface SlideSource { path: string; name: string; page: number | null; pages?: number; mtimeMs: number } // pages: the PDF's page count
const DEFAULT_SLIDE_SEC = 3

const uid = () => globalThis.crypto.randomUUID()

export function newReel(name: string): Reel {
  return {
    id: uid(), name,
    markerNames: { 1: '', 2: '', 3: '', 4: '', 5: '' },
    groupOrder: [...MARKERS],
    groups: { 1: [], 2: [], 3: [], 4: [], 5: [], none: [] },
    clips: {}, scope: 'marked', rangeDefaults: { ...DEFAULT_RANGE }, updatedAt: new Date().toISOString(),
  }
}

const touch = (r: Reel): Reel => ({ ...r, updatedAt: new Date().toISOString() })

// A clip can carry several markers (it is then in each of those groups, and plays once per group);
// a clip with none is in 'none'. groupOf gives the first one, for single-group displays.
export function groupOf(reel: Reel, clipId: string): Group | null {
  for (const g of [...MARKERS, 'none'] as Group[]) if (reel.groups[g].includes(clipId)) return g
  return null
}

export function markersOf(reel: Reel, clipId: string): Marker[] {
  return MARKERS.filter(m => reel.groups[m].includes(clipId))
}

export function findClip(reel: Reel, matchId: string, playId: number): Clip | undefined {
  return Object.values(reel.clips).find(c => c.matchId === matchId && c.playId === playId)
}

// Adds plays not already in the reel; returns the ids of the clips (new or existing) in input order.
export function addClips(reel: Reel, items: { matchId: string; play: Play }[], group: Group = 'none', mode?: ClipMode): { reel: Reel; ids: string[] } {
  const clips = { ...reel.clips }
  const groups = { ...reel.groups, [group]: [...reel.groups[group]] }
  const ids: string[] = []
  for (const { matchId, play } of items) {
    const existing = Object.values(clips).find(c => c.matchId === matchId && c.playId === play.id)
    if (existing) { ids.push(existing.id); continue }
    const c: Clip = { id: uid(), matchId, playId: play.id, fingerprint: play.fingerprint, inSec: null, outSec: null, annotations: [], ...(mode ? { mode } : {}) }
    clips[c.id] = c
    groups[group].push(c.id)
    ids.push(c.id)
  }
  return { reel: touch({ ...reel, clips, groups }), ids }
}

// Moves a clip from one of its groups (`from`, by default its first) to another, appending by
// default; its other markers stay. Moving into its own group with no index is a no-op. Moving to
// 'none' takes every marker off.
export function moveClip(reel: Reel, clipId: string, to: Group, index?: number, from: Group | null = groupOf(reel, clipId)): Reel {
  if (!from || (from === to && index === undefined)) return reel
  const groups = { ...reel.groups }
  const leave: Group[] = to === 'none' ? [...MARKERS, 'none'] : [from, to]
  for (const g of leave) groups[g] = groups[g].filter(id => id !== clipId)
  if (to !== 'none') groups.none = groups.none.filter(id => id !== clipId)
  const target = [...groups[to]]
  target.splice(index === undefined ? target.length : Math.max(0, Math.min(index, target.length)), 0, clipId)
  groups[to] = target
  return keepSlides(reel, touch({ ...reel, groups }))
}

// Title card before a marker group: the scene's choice for that marker, else the video's setting.
export function markerCardOn(reel: Reel, m: Marker, videoDefault: boolean): boolean {
  return reel.markerCards?.[m] ?? videoDefault
}

// Number keys and the list's 1–5: adds that marker (keeping any others), or takes it off when the
// clip has it; null (0) takes every marker off. With `when` (a clip's [match date, video time]) the
// clip goes into the group in time order — before the first clip that comes later — so a group
// stays chronological unless it was reordered by hand; without it, at the end.
export function toggleMarker(reel: Reel, clipId: string, m: Marker | null, when?: (c: Clip) => [string, number]): Reel {
  if (!reel.clips[clipId]) return reel
  if (m === null) return moveClip(reel, clipId, 'none')
  const groups = { ...reel.groups }
  if (groups[m].includes(clipId)) {
    groups[m] = groups[m].filter(id => id !== clipId)
    if (!MARKERS.some(x => groups[x].includes(clipId))) groups.none = [...groups.none, clipId]
  } else {
    const list = [...groups[m]]
    let at = list.length
    if (when) {
      const [d, t] = when(reel.clips[clipId])
      const later = list.findIndex(id => { const [d2, t2] = when(reel.clips[id]); return d2.localeCompare(d) > 0 || (d2 === d && t2 > t) })
      if (later >= 0) at = later
    }
    list.splice(at, 0, clipId)
    groups[m] = list
    groups.none = groups.none.filter(id => id !== clipId)
  }
  return keepSlides(reel, touch({ ...reel, groups }))
}

// Tags are a few characters at most; an empty one takes the tag off.
export const TAG_MAX = 4

// What was done to a clip by hand, for the marks on its row in the scene list: its headline, how many
// other objects are drawn on it, slow / hold, and the auto overlays hidden or rewritten.
export interface ClipEdits { headline: string | null; objects: number; timing: boolean; overlay: boolean }
export function clipEdits(c: Clip): ClipEdits {
  const quick = c.annotations.find(a => a.kind === 'text' && a.quick)
  const o = c.overlayOverride
  return {
    headline: quick && quick.kind === 'text' ? quick.text : null,
    objects: c.annotations.filter(a => a !== quick).length,
    timing: hasTiming(c.timing),
    overlay: !!(o?.scoreboard?.hidden || o?.playerCaption?.hidden || o?.playerCaption?.name || o?.playerCaption?.line),
  }
}

export function setTag(reel: Reel, clipId: string, tag: string | null): Reel {
  const c = reel.clips[clipId]
  if (!c) return reel
  const t = (tag ?? '').trim().slice(0, TAG_MAX)
  if ((c.tag ?? '') === t) return reel
  const { tag: _, ...rest } = c
  return touch({ ...reel, clips: { ...reel.clips, [clipId]: t ? { ...rest, tag: t } : rest } })
}

// Tags in order: numbers by size ("2" before "10"), then letters; no tag last.
function byTag(a: string | undefined, b: string | undefined): number {
  if (!a || !b) return Number(!a) - Number(!b)
  return a.localeCompare(b, 'ja', { numeric: true })
}

// A marker group's clips by tag, the order among equal tags kept. Slides stay after the clip they follow.
export function sortByTag(reel: Reel, m: Marker): Reel {
  const ids = reel.groups[m]
  const tagOf = (id: string) => reel.clips[id]?.tag
  const sorted = [...ids].sort((a, b) => byTag(tagOf(a), tagOf(b)))
  if (sorted.every((id, i) => id === ids[i])) return reel
  return touch({ ...reel, groups: { ...reel.groups, [m]: sorted } })
}

export function placeGroup(reel: Reel, m: Marker, before: Marker | null): Reel {
  const order = reel.groupOrder.filter(x => x !== m)
  order.splice(before === null ? order.length : order.indexOf(before), 0, m)
  return touch({ ...reel, groupOrder: order })
}

export function removeClip(reel: Reel, clipId: string): Reel {
  const clips = { ...reel.clips }
  delete clips[clipId]
  const groups = Object.fromEntries(Object.entries(reel.groups).map(([g, ids]) => [g, ids.filter(id => id !== clipId)])) as Reel['groups']
  return keepSlides(reel, touch({ ...reel, clips, groups }))
}

// ---- slides ---------------------------------------------------------------------------------
export type Row = { kind: 'clip'; id: string } | { kind: 'slide'; slide: Slide }
// Where slides go: after a clip of the group (null = its head), at this index among the slides there.
export interface SlideSpot { group: Group; after: string | null; index: number }

export function newSlide(bg: SlideBg, durationSec = DEFAULT_SLIDE_SEC): Slide {
  return { id: uid(), group: 'none', after: null, durationSec, bg, annotations: [] }
}

// A group as it is listed and played: its head slides, then each clip followed by its slides.
// clipIds: the group's clips in display order ('none' is shown chronologically).
export function groupRows(reel: Reel, g: Group, clipIds: string[] = reel.groups[g]): Row[] {
  const mine = (reel.slides ?? []).filter(s => s.group === g)
  const at = (after: string | null): Row[] => mine.filter(s => s.after === after).map(slide => ({ kind: 'slide', slide }))
  const rows: Row[] = at(null)
  for (const id of clipIds) rows.push({ kind: 'clip', id }, ...at(id))
  // A slide whose clip isn't listed (keepSlides prevents it; a hand-edited file might not): at the end.
  const listed = new Set(clipIds)
  for (const s of mine) if (s.after !== null && !listed.has(s.after)) rows.push({ kind: 'slide', slide: s })
  return rows
}

// The spot for something put at row k (0 = before the first row) of a group's rows.
export function spotAt(rows: Row[], g: Group, k: number): SlideSpot {
  let after: string | null = null, index = 0
  for (const r of rows.slice(0, k)) {
    if (r.kind === 'clip') { after = r.id; index = 0 } else index++
  }
  return { group: g, after, index }
}

// Puts slides (new ones, or ones already in the scene: they move) at a spot, in the given order.
export function putSlides(reel: Reel, list: Slide[], at: SlideSpot): Reel {
  const ids = new Set(list.map(s => s.id))
  const rest = (reel.slides ?? []).filter(s => !ids.has(s.id))
  const here = (s: Slide) => s.group === at.group && s.after === at.after
  const there = rest.filter(here)
  there.splice(Math.max(0, Math.min(at.index, there.length)), 0, ...list.map(s => ({ ...s, group: at.group, after: at.after })))
  return touch({ ...reel, slides: [...rest.filter(s => !here(s)), ...there] })
}

export function setSlide(reel: Reel, slide: Slide): Reel {
  return touch({ ...reel, slides: (reel.slides ?? []).map(s => (s.id === slide.id ? slide : s)) })
}

export function removeSlide(reel: Reel, id: string): Reel {
  return touch({ ...reel, slides: (reel.slides ?? []).filter(s => s.id !== id) })
}

// After clips move or leave: a slide whose clip is no longer in its group goes after the clip that
// was before that one (still in the group), after that clip's own slides; else to the group's head.
function keepSlides(old: Reel, next: Reel): Reel {
  if (!next.slides?.length) return next
  const kept: Slide[] = [], moved: Slide[] = []
  for (const s of next.slides) {
    const ids = next.groups[s.group]
    if (s.after === null || ids.includes(s.after)) { kept.push(s); continue }
    const before = old.groups[s.group].slice(0, Math.max(0, old.groups[s.group].indexOf(s.after)))
    moved.push({ ...s, after: before.reverse().find(id => ids.includes(id)) ?? null })
  }
  return moved.length ? { ...next, slides: [...kept, ...moved] } : next
}

export function renameMarker(reel: Reel, m: Marker, name: string): Reel {
  return touch({ ...reel, markerNames: { ...reel.markerNames, [m]: name } })
}

// Playback / export order: marker groups in groupOrder, then (scope 'all') unmarked clips by
// match date and time. `when` gives a clip's [match date, video time].
export function playOrder(reel: Reel, when: (c: Clip) => [string, number], scope = reel.scope): Clip[] {
  const marked = reel.groupOrder.filter(m => !reel.markerOff?.[m]).flatMap(m => reel.groups[m].map(id => reel.clips[id]))
  if (scope === 'marked') return marked
  return [...marked, ...chronological(reel, reel.groups.none, when)]
}

// Ungrouped clips as they are shown and played: in time order, unless the scene sorts them by tag.
export function chronological(reel: Reel, ids: string[], when: (c: Clip) => [string, number]): Clip[] {
  return ids.map(id => reel.clips[id]).sort((a, b) => {
    const [da, ta] = when(a), [db, tb] = when(b)
    return (reel.noneByTag ? byTag(a.tag, b.tag) : 0) || da.localeCompare(db) || ta - tb
  })
}

// After a DVW is re-read: find each clip's play again and report those that can't be found
// (never drop them silently). Matching goes from strict to loose, because fixing the scout shifts
// later fingerprints — a missed point added early changes every later score, a nudged timestamp
// changes the time. Loose matches must be unambiguous, or the clip is reported instead of guessed.
type RelinkHow = 'id' | 'fingerprint' | 'code+time' | 'code+near-time'

export function relink(reel: Reel, dvws: Record<string, ParsedDVW>): { reel: Reel; missing: Set<string>; changed: boolean; how: Map<string, RelinkHow> } {
  const missing = new Set<string>()
  const how = new Map<string, RelinkHow>()
  let changed = false
  const clips = { ...reel.clips }
  for (const c of Object.values(reel.clips)) {
    const d = dvws[c.matchId]
    if (!d) { missing.add(c.id); continue }
    if (d.plays[c.playId]?.fingerprint === c.fingerprint) { how.set(c.id, 'id'); continue }
    const found = findPlay(d, c.fingerprint)
    if (!found) { missing.add(c.id); continue }
    clips[c.id] = { ...c, playId: found.play.id, fingerprint: found.play.fingerprint }
    how.set(c.id, found.how)
    changed = true
  }
  return { reel: changed ? { ...reel, clips } : reel, missing, changed, how }
}

const NEAR_TIME_SEC = 2

function findPlay(d: ParsedDVW, fingerprint: string): { play: Play; how: RelinkHow } | null {
  const exact = d.plays.find(p => p.fingerprint === fingerprint)
  if (exact) return { play: exact, how: 'fingerprint' }
  const f = parseFingerprint(fingerprint)
  if (!f) return null
  const same = d.plays.filter(p => p.code === f.code && p.setNum === f.setNum)
  const atTime = same.filter(p => p.time === f.time)
  if (atTime.length === 1) return { play: atTime[0], how: 'code+time' }
  if (atTime.length > 1) return null
  const near = same.map(p => ({ p, dt: Math.abs(p.time - f.time) })).filter(x => x.dt <= NEAR_TIME_SEC).sort((x, y) => x.dt - y.dt)
  if (near.length === 1 || (near.length > 1 && near[0].dt < near[1].dt)) return { play: near[0].p, how: 'code+near-time' }
  return null
}

// `${setNum}|${home}-${away}|${code}|${time}` (see Play.fingerprint).
export function parseFingerprint(fp: string): { setNum: number; code: string; time: number } | null {
  const parts = fp.split('|')
  if (parts.length < 4) return null
  const setNum = Number(parts[0]), time = Number(parts[parts.length - 1])
  const code = parts.slice(2, -1).join('|')
  return isFinite(setNum) && isFinite(time) && code ? { setNum, code, time } : null
}

// ---- clip ranges (design §3.5) -----------------------------------------------------------
// All times are video times. "rally": first serve - lead → last contact + tail (the point line is
// logged ~10s after the last contact, M0 finding, so it is not used). "keyplay": key play ± seconds.
export interface RangeDefaults {
  mode: 'rally' | 'keyplay'
  rallyLead: number
  rallyTail: number
  keyBefore: number
  keyAfter: number
}

export const DEFAULT_RANGE: RangeDefaults = { mode: 'rally', rallyLead: 1.5, rallyTail: 2.5, keyBefore: 3, keyAfter: 4 }
export const MIN_CLIP_SEC = 0.5

// Reels saved before M4 have no rangeDefaults.
export function rangeDefaults(r: Reel): RangeDefaults {
  return { ...DEFAULT_RANGE, ...(r.rangeDefaults ?? {}) }
}

export function defaultRange(dvw: ParsedDVW, play: Play, offsetSec: number, d: RangeDefaults = DEFAULT_RANGE, mode?: ClipMode): { in: number; out: number } {
  const r = play.rallyId !== null ? dvw.rallies[play.rallyId] : null
  const m = mode ?? d.mode
  const [a, b] = m === 'rally' && r ? [r.serveTime - d.rallyLead, r.lastActionTime + d.rallyTail]
    : m === 'toEnd' && r ? [play.time - d.keyBefore, Math.max(play.time + d.keyAfter, r.lastActionTime + d.rallyTail)]
    : [play.time - d.keyBefore, play.time + d.keyAfter]
  return { in: Math.max(0, a + offsetSec), out: b + offsetSec }
}

export function clipRange(c: Clip, dvw: ParsedDVW, offsetSec: number, d: RangeDefaults = DEFAULT_RANGE): { in: number; out: number } | null {
  const play = dvw.plays[c.playId]
  if (!play) return null
  const def = defaultRange(dvw, play, offsetSec, d, c.mode)
  return { in: c.inSec ?? def.in, out: c.outSec ?? def.out }
}

// Sets IN or OUT (null = back to the default) while keeping the clip at least MIN_CLIP_SEC long:
// an IN past the OUT pushes nothing — it is clamped instead, so a stray key press can't flip the clip.
export function trimClip(reel: Reel, clipId: string, edge: 'in' | 'out', t: number | null,
  current: { in: number; out: number }, def: { in: number; out: number }, durationSec = Infinity): Reel {
  const c = reel.clips[clipId]
  if (!c) return reel
  let next: Clip
  if (t === null) next = edge === 'in' ? { ...c, inSec: null } : { ...c, outSec: null }
  else if (edge === 'in') next = { ...c, inSec: round(Math.max(0, Math.min(t, current.out - MIN_CLIP_SEC))) }
  else next = { ...c, outSec: round(Math.min(durationSec, Math.max(t, current.in + MIN_CLIP_SEC))) }
  // A value equal to the default is stored as "default" so later changes to the defaults apply.
  if (next.inSec !== null && Math.abs(next.inSec - def.in) < 0.001) next.inSec = null
  if (next.outSec !== null && Math.abs(next.outSec - def.out) < 0.001) next.outSec = null
  return touch({ ...reel, clips: { ...reel.clips, [clipId]: next } })
}

const round = (t: number) => Math.round(t * 1000) / 1000

// Clips of the same match whose ranges overlap (e.g. two plays of one rally). Warned, never merged.
export function findOverlaps(items: { id: string; matchId: string; in: number; out: number }[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const sorted = [...items].sort((a, b) => a.matchId.localeCompare(b.matchId) || a.in - b.in)
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].matchId === sorted[i].matchId && sorted[j].in < sorted[i].out; j++) {
      out.set(sorted[i].id, [...(out.get(sorted[i].id) ?? []), sorted[j].id])
      out.set(sorted[j].id, [...(out.get(sorted[j].id) ?? []), sorted[i].id])
    }
  }
  return out
}

const patchClip = (reel: Reel, clipId: string, patch: (c: Clip) => Clip): Reel => {
  const c = reel.clips[clipId]
  return c ? touch({ ...reel, clips: { ...reel.clips, [clipId]: patch(c) } }) : reel
}

export function setAnnotations(reel: Reel, clipId: string, annotations: Annotation[]): Reel {
  return patchClip(reel, clipId, c => ({ ...c, annotations: annotations.map(roundCoords) }))
}

export function setTiming(reel: Reel, clipId: string, timing: ClipTiming): Reel {
  return patchClip(reel, clipId, ({ timing: _old, ...rest }) => (hasTiming(timing) ? { ...rest, timing } : rest))
}

// Where the red line of a clip is: a video time, or null back on the DVW's time.
export function setSkillTime(reel: Reel, clipId: string, sec: number | null): Reel {
  return patchClip(reel, clipId, ({ skillSec: _old, ...rest }) => (sec === null ? rest : { ...rest, skillSec: sec }))
}

// A serve's speed for its flight, or null back on the default.
export function setServeSpeed(reel: Reel, clipId: string, kmh: number | null): Reel {
  return patchClip(reel, clipId, ({ speedKmh: _old, ...rest }) => (kmh === null ? rest : { ...rest, speedKmh: kmh }))
}

export function setOverlayOverride(reel: Reel, clipId: string, o: ClipOverlayOverride | undefined): Reel {
  return patchClip(reel, clipId, c => ({ ...c, overlayOverride: o }))
}
