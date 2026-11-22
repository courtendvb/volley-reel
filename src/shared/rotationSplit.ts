// A rotation video: a search's plays split by the rotation their team was in, one scene each
// (a rotation video usually holds a team's side-out attacks), and inside each scene into marker
// groups named for what they hold. Pure, so it is unit-tested. presets.ts builds on it.
import { EMPTY_FILTER, type PlayFilter, type PlayRef } from './filter'
import { MARKERS, type Marker } from './reel'
import type { Side } from './types'
import { t } from './i18n'

// A team's side-out attacks: its attacks in the reception phase (from its reception until the
// ball goes over).
export const sideOutFilter = (team: 'all' | 'our' | 'opp'): PlayFilter => ({ ...EMPTY_FILTER, team, skills: ['A'], phase: 'reception' })

// Inside a rotation:
//  'reception' marker 1 after a good reception (# +), 2 after a poor one (- ! /)
//  'player'    a marker per attacker, the most attacks first (the sixth and later: unmarked)
//  'zone'      a marker per zone attacked from, the most attacks first (the same way)
//  'result'    1 a kill, 2 the rally won all the same, 3 the rally lost
// Plays that fit none (no reception phase, no zone, rally not known) stay unmarked.
export type RotationSplitBy = 'none' | 'reception' | 'player' | 'zone' | 'result'

// Plays put in marker groups: what a scene of a made video holds.
export interface Marked {
  items: { ref: PlayRef; marker: Marker | null }[] // in the search's order
  names: Partial<Record<Marker, string>> // the markers used, with their names
  counts: Partial<Record<Marker, number>>
  rest: number // the unmarked plays
}
export interface RotationGroup extends Marked { rot: number }

// The order a team goes through its rotations in a set: DataVolley numbers a rotation by the
// setter's zone, so 1 → 6 → 5 → 4 → 3 → 2.
export const ROTATION_ORDER = [1, 6, 5, 4, 3, 2]

// The rotation of the play's own team: an opponent's play goes by the opponent's.
export const rotationOf = (r: PlayRef): number | null => (r.teamRole === 'opp' ? r.oppRot : r.ourRot)

// A player as markers and scenes name them: the jersey, then the name.
export const playerLabel = (r: PlayRef): string => `#${r.play.jersey} ${r.name}`
// The same person across matches (the DataVolley key), kept apart from the other team's.
export const personOf = (r: PlayRef): string => `${r.teamRole ?? r.teamCode}|${r.personKey}`

// Who won the play's rally; null when it isn't known.
export type WonBy = (r: PlayRef) => Side | null

export function marked(refs: PlayRef[], markerOf: (r: PlayRef) => Marker | null = () => null, names: Partial<Record<Marker, string>> = {}): Marked {
  const items = refs.map(ref => ({ ref, marker: markerOf(ref) }))
  const counts: Partial<Record<Marker, number>> = {}
  for (const i of items) if (i.marker !== null) counts[i.marker] = (counts[i.marker] ?? 0) + 1
  return { items, names, counts, rest: items.filter(i => i.marker === null).length }
}

function fixedMarker(r: PlayRef, by: 'reception' | 'result', wonBy: WonBy): Marker | null {
  if (by === 'reception') {
    const e = r.play.phase === 'r' ? r.play.recEffect : undefined
    return e === '#' || e === '+' ? 1 : e === '-' || e === '!' || e === '/' ? 2 : null
  }
  if (r.play.skill === 'A' && r.play.effect === '#') return 1
  const w = r.side ? wonBy(r) : null // all-home input: the side doesn't tell the teams apart
  return w === null ? null : w === r.side ? 2 : 3
}

const FIXED_NAMES = (): Record<'reception' | 'result', Partial<Record<Marker, string>>> => ({
  reception: { 1: t('良いレセプションから'), 2: t('悪いレセプションから') },
  result: { 1: t('決定'), 2: t('サイドアウト成功'), 3: t('サイドアウト失敗') },
})

// Keys in the order of how many plays they have, the most first (ties: the one seen first).
export function byCount<K>(refs: PlayRef[], key: (r: PlayRef) => K | null): { key: K; refs: PlayRef[] }[] {
  const seen = new Map<K, PlayRef[]>()
  for (const r of refs) {
    const k = key(r)
    if (k === null) continue
    seen.set(k, [...(seen.get(k) ?? []), r])
  }
  return [...seen.entries()].map(([k, list]) => ({ key: k, refs: list })).sort((a, b) => b.refs.length - a.refs.length)
}

// A marker per key, the most plays first; the sixth key on is unmarked.
export function rankedMarkers(refs: PlayRef[], key: (r: PlayRef) => string | null, label: (r: PlayRef) => string): Marked {
  const top = byCount(refs, key).slice(0, MARKERS.length)
  const markerOf = new Map(top.map((g, i) => [g.key, MARKERS[i]]))
  const names: Partial<Record<Marker, string>> = {}
  top.forEach((g, i) => { names[MARKERS[i]] = label(g.refs[0]) })
  return marked(refs, r => { const k = key(r); return k === null ? null : markerOf.get(k) ?? null }, names)
}
export const playerMarkers = (refs: PlayRef[]): Marked => rankedMarkers(refs, personOf, playerLabel)

export function splitInside(refs: PlayRef[], by: RotationSplitBy, wonBy: WonBy): Marked {
  if (by === 'reception' || by === 'result') return marked(refs, r => fixedMarker(r, by, wonBy), FIXED_NAMES()[by])
  if (by === 'player') return playerMarkers(refs)
  if (by === 'zone') return rankedMarkers(refs, r => (r.play.startZone === null ? null : String(r.play.startZone)), r => t('ゾーン {0}', r.play.startZone))
  return marked(refs)
}

// Rotations with no plays are left out; `skipped` counts plays whose rotation isn't in the file.
export function splitByRotation(refs: PlayRef[], by: RotationSplitBy, wonBy: WonBy = () => null): { groups: RotationGroup[]; skipped: number } {
  const byRot = new Map<number, PlayRef[]>()
  let skipped = 0
  for (const ref of refs) {
    const rot = rotationOf(ref)
    if (rot === null || rot < 1 || rot > 6) { skipped++; continue }
    byRot.set(rot, [...(byRot.get(rot) ?? []), ref])
  }
  const groups = ROTATION_ORDER.filter(r => byRot.has(r)).map(rot => ({ rot, ...splitInside(byRot.get(rot)!, by, wonBy) }))
  return { groups, skipped }
}
