// Video presets: patterns a whole video is made from in one go (the search's "プリセットから作る").
// Each gathers one kind of play for a team and lays it out as scenes, each with marker groups
// named for what they hold. Pure, so it is unit-tested.
import { EMPTY_FILTER, applyFilter, type PlayFilter, type PlayRef } from './filter'
import type { PlayDir } from './court'
import {
  ROTATION_ORDER, byCount, marked, personOf, playerLabel, playerMarkers, rankedMarkers, rotationOf, sideOutFilter, splitByRotation,
  type Marked, type RotationSplitBy, type WonBy,
} from './rotationSplit'
import { MARKERS, addClips, newReel, type ClipMode, type Marker, type Reel } from './reel'
import { displayName } from './dvw'
import { roleName } from './roles'
import type { ParsedDVW, Play, Player, PlayerRole } from './types'
import { t } from './i18n'

export type PresetKind = 'sideout' | 'serve' | 'block' | 'attack'
// How each preset lays the scenes out:
//  sideout  a scene per rotation, split inside as RotationSplitBy says
//  serve    a scene per server, marked by the serve's result: 'rotation' in the order of the
//           rotation each serves in most, 'count' the most serves first, 'jersey' by jersey number
//  block    'middle' a scene per middle blocker with every attack of the other team while that
//           middle was in the front row (touched or not), the most first, marked 1 after the
//           attacking team's good reception, 2 after its poor one, 3 in transition;
//           'rotation' a scene per rotation with the blocks, a marker per blocker
//  attack   'count' a scene per attacker, the most attacks first; 'position' a scene per
//           position (outside, opposite, middle, setter, the rest) with a marker per player;
//           'combo' a scene per attacker (the most first) with a marker per attack code
export interface PresetHow {
  sideout: RotationSplitBy
  serve: 'rotation' | 'count' | 'jersey'
  block: 'middle' | 'rotation'
  attack: 'count' | 'position' | 'combo'
}
export const DEFAULT_HOW: PresetHow = { sideout: 'none', serve: 'rotation', block: 'middle', attack: 'count' }

export interface SceneSpec extends Marked { title: string }

// A middle blocker facing an attack: the player key and how scenes name them.
export interface Facing { key: string; label: string }

export interface PresetLookups {
  wonBy: WonBy
  roleOf: (r: PlayRef) => PlayerRole | undefined // the project's position for the player, else the DVW roster's
  middlesFacing: (r: PlayRef) => Facing[] // an attack: the other team's middle blockers in the front row
}

// An attack by where it came from: the attacking team's reception phase after a good or a poor
// reception, or transition.
export function phaseMarker(attack: Play): Marker | null {
  if (attack.phase === 't') return 3
  const e = attack.phase === 'r' ? attack.recEffect : undefined
  return e === '#' || e === '+' ? 1 : e === '-' || e === '!' || e === '/' ? 2 : null
}
const PHASE_NAMES = (): Partial<Record<Marker, string>> => ({ 1: t('良いレセプション'), 2: t('悪いレセプション'), 3: t('トランジション') })

// A serve by its result: an ace, an out-of-system pass (+ /), an in-system pass (! -), an error.
export function serveMarker(serve: Play): Marker | null {
  const e = serve.effect
  return e === '#' ? 1 : e === '+' || e === '/' ? 2 : e === '!' || e === '-' ? 3 : e === '=' ? 4 : null
}
const SERVE_NAMES = (): Partial<Record<Marker, string>> => ({ 1: t('サービスエース'), 2: t('Cパス'), 3: t('ABパス'), 4: t('サーブミス') })

const SKILL: Record<Exclude<PresetKind, 'sideout'>, string> = { serve: 'S', block: 'B', attack: 'A' }
const otherTeam = { our: 'opp', opp: 'our', all: 'all' } as const

// A block video by middle gathers the other team's attacks; the rest gather their own skill.
export function presetFilter(kind: PresetKind, how: PresetHow, team: 'all' | 'our' | 'opp'): PlayFilter {
  if (kind === 'sideout') return sideOutFilter(team)
  if (kind === 'block' && how.block === 'middle') return { ...EMPTY_FILTER, team: otherTeam[team], skills: ['A'] }
  return { ...EMPTY_FILTER, team, skills: [SKILL[kind]] }
}

export const presetName = (kind: PresetKind): string =>
  ({ sideout: t('サイドアウト'), serve: t('サーブ'), block: t('ブロック'), attack: t('アタック') })[kind]

// Whether a preset's layout needs players' positions.
export const usesRoles = (kind: PresetKind, how: PresetHow): boolean => (kind === 'block' && how.block === 'middle') || (kind === 'attack' && how.attack === 'position')

const ROLE_ORDER: PlayerRole[] = ['OH', 'OP', 'MB', 'S']

// The most common of a player's rotations, as its place in the order a team rotates.
function mainRotation(refs: PlayRef[]): number {
  const top = byCount(refs, rotationOf)[0]
  return top ? ROTATION_ORDER.indexOf(top.key) : ROTATION_ORDER.length
}

// The plays a preset gathers: from every play of the matches searched for a team, or narrowed
// from the search's results ('results').
// `dir`: only plays going that way on screen (filter.ts), which needs the match's court fitted.
export function presetRefs(kind: PresetKind, how: PresetHow, source: 'our' | 'opp' | 'results', scope: PlayRef[], results: PlayRef[], dir: 'all' | PlayDir = 'all'): PlayRef[] {
  const f = { ...presetFilter(kind, how, source === 'results' ? 'all' : source), dir }
  return applyFilter(source === 'results' ? results : scope, f)
}

// An attack code as a marker names it: the code, and its name from the DVW's table when there is one.
const comboLabel = (r: PlayRef): string => (r.comboName ? `${r.combo} ${r.comboName}` : r.combo ?? '')

export function buildPreset(kind: PresetKind, how: PresetHow, refs: PlayRef[], look: PresetLookups): { scenes: SceneSpec[]; skipped: number } {
  if (kind === 'sideout' || (kind === 'block' && how.block === 'rotation')) {
    const by = kind === 'sideout' ? how.sideout : 'player'
    const { groups, skipped } = splitByRotation(refs, by, look.wonBy)
    return { scenes: groups.map(({ rot, ...g }) => ({ title: t('ローテ {0}', rot), ...g })), skipped }
  }
  if (kind === 'block') {
    // An attack goes in the scene of each middle facing it (usually one).
    const byMiddle = new Map<string, { label: string; refs: PlayRef[] }>()
    for (const r of refs) for (const m of look.middlesFacing(r)) {
      const g = byMiddle.get(m.key) ?? { label: m.label, refs: [] }
      g.refs.push(r)
      byMiddle.set(m.key, g)
    }
    const scenes = [...byMiddle.values()].sort((a, b) => b.refs.length - a.refs.length)
      .map(g => ({ title: g.label, ...marked(g.refs, r => phaseMarker(r.play), PHASE_NAMES()) }))
    return { scenes, skipped: 0 }
  }
  const people = byCount(refs, personOf)
  if (kind === 'serve') {
    const order = how.serve === 'count' ? people
      : how.serve === 'jersey' ? [...people].sort((a, b) => a.refs[0].play.jersey - b.refs[0].play.jersey)
      : [...people].sort((a, b) => mainRotation(a.refs) - mainRotation(b.refs))
    return { scenes: order.map(p => ({ title: playerLabel(p.refs[0]), ...marked(p.refs, r => serveMarker(r.play), SERVE_NAMES()) })), skipped: 0 }
  }
  if (how.attack === 'count') return { scenes: people.map(p => ({ title: playerLabel(p.refs[0]), ...marked(p.refs) })), skipped: 0 }
  if (how.attack === 'combo') return { scenes: people.map(p => ({ title: playerLabel(p.refs[0]), ...rankedMarkers(p.refs, r => r.combo, comboLabel) })), skipped: 0 }
  const byRole = new Map<PlayerRole | null, PlayRef[]>()
  for (const r of refs) {
    const role = look.roleOf(r) ?? null
    const k = role && ROLE_ORDER.includes(role) ? role : null
    byRole.set(k, [...(byRole.get(k) ?? []), r])
  }
  const scenes = [...ROLE_ORDER, null].filter(k => byRole.has(k)).map(k => ({ title: roleName(k), ...playerMarkers(byRole.get(k)!) }))
  return { scenes, skipped: 0 }
}

export type PresetSource = 'our' | 'opp' | 'results'
export const PRESET_KINDS: PresetKind[] = ['sideout', 'serve', 'block', 'attack']

export const HOW_OPTIONS = (): { [K in PresetKind]: [PresetHow[K], string][] } => ({
  sideout: [['none', t('分けない')], ['reception', t('レセプションの質')], ['player', t('選手別')], ['zone', t('ゾーン別')], ['result', t('結果別')]],
  serve: [['rotation', t('ローテ順')], ['count', t('打数順')], ['jersey', t('背番号順')]],
  block: [['middle', t('ミドル別')], ['rotation', t('ローテ別')]],
  attack: [['count', t('打数順')], ['position', t('ポジション別')], ['combo', t('アタックコード別')]],
})

// What a video was made from, kept on the video (Video.preset) so it can be made again, for
// example after matches are added.
export interface VideoPreset {
  kind: PresetKind
  how: PresetHow
  source: PresetSource
  dir: 'all' | PlayDir
  mode: ClipMode
}

// The video's name, and what goes before each scene's name so the scene list tells this video's
// scenes from others' ("HTH ブロック #15 …"); `team` is the project's target team code.
export function presetLabels(p: VideoPreset, team: string): { name: string; prefix: string } {
  const who = p.source === 'our' ? team || t('対象チーム') : p.source === 'opp' ? t('相手') : null
  const how = (HOW_OPTIONS()[p.kind] as [string, string][]).find(([v]) => v === p.how[p.kind])?.[1] ?? ''
  const dir = p.dir === 'up' ? '↑' : p.dir === 'down' ? '↓' : ''
  const name = [who, presetName(p.kind), p.kind === 'sideout' ? t('ローテーション別') : how, dir].filter(Boolean).join(' ')
  return { name, prefix: [who, presetName(p.kind)].filter(Boolean).join(' ') }
}

export function makePreset(p: VideoPreset, scope: PlayRef[], results: PlayRef[], look: PresetLookups): { scenes: SceneSpec[]; skipped: number } {
  return buildPreset(p.kind, p.how, presetRefs(p.kind, p.how, p.source, scope, results, p.dir), look)
}

// A video's preset read back from its file: null when it isn't one (or not one this version knows).
export function cleanPreset(v: unknown): VideoPreset | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<VideoPreset>
  if (!PRESET_KINDS.includes(o.kind as PresetKind)) return null
  const how = { ...DEFAULT_HOW }
  const opts = HOW_OPTIONS()
  for (const k of PRESET_KINDS) {
    const x = (o.how as Record<string, unknown> | undefined)?.[k]
    if ((opts[k] as [string, string][]).some(([val]) => val === x)) (how as Record<string, unknown>)[k] = x
  }
  return {
    kind: o.kind as PresetKind, how,
    source: o.source === 'opp' || o.source === 'results' ? o.source : 'our',
    dir: o.dir === 'up' || o.dir === 'down' ? o.dir : 'all',
    mode: o.mode === 'toEnd' ? 'toEnd' : 'keyplay',
  }
}

// What the presets look up in the matches: who won a play's rally, a player's position (the
// project's, else the DVW roster's) and the other team's middle blockers in the front row.
export function presetLookups(dvws: Record<string, ParsedDVW>, roles: Record<string, PlayerRole> | undefined): PresetLookups {
  const role = (p: Player) => roles?.[p.key] ?? p.role
  return {
    wonBy: r => (r.play.rallyId === null ? null : dvws[r.matchId]?.rallies[r.play.rallyId]?.wonBy ?? null),
    roleOf: r => roles?.[r.personKey] ?? dvws[r.matchId]?.players[`${r.play.side}${r.play.jersey}`]?.role,
    middlesFacing: r => {
      const d = dvws[r.matchId], front = r.play.front
      if (!d || !front) return []
      return Object.values(d.players).filter(p => p.side !== r.play.side && front.includes(p.key) && role(p) === 'MB')
        .map(p => ({ key: p.key, label: `#${p.jersey} ${displayName(d.players, p.side, p.jersey)}` }))
    },
  }
}

// The scenes a preset makes: each with its title card, its markers named, its clips in them, every
// clip played (scope 'all'). The name has the prefix so the scene list tells videos' scenes apart;
// the title card keeps the short title.
export const presetReels = (specs: SceneSpec[], prefix: string, mode: ClipMode): Reel[] => specs.map(g => {
  let r: Reel = { ...newReel(prefix ? `${prefix} ${g.title}` : g.title), scope: 'all', sceneCard: true, ...(prefix ? { cardTitle: g.title } : {}) }
  r = { ...r, markerNames: { ...r.markerNames, ...g.names } }
  for (const m of [...MARKERS, null]) {
    const items = g.items.filter(i => i.marker === m).map(i => ({ matchId: i.ref.matchId, play: i.ref.play }))
    if (items.length) r = addClips(r, items, m ?? 'none', mode).reel
  }
  return r
})

// A block video by middle goes by who is in the front row at each attack: the attacks from a DVW
// that doesn't record the lineups can't go in (counted, to say so).
export const lineupsMissing = (kind: PresetKind, how: PresetHow, refs: PlayRef[]): number =>
  kind === 'block' && how.block === 'middle' ? refs.filter(r => !r.play.front).length : 0

// The dialog's last choices, kept on this computer and read back with care (anything unknown: the default).
export interface PresetDialogState { kind: PresetKind; how: PresetHow; source: PresetSource; dir: 'all' | PlayDir; modes: Record<PresetKind, ClipMode> }
export function cleanDialogState(v: unknown, modes: Record<PresetKind, ClipMode>): PresetDialogState {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<PresetDialogState>
  const p = cleanPreset({ ...o, mode: 'keyplay' }) ?? { kind: 'sideout' as const, how: DEFAULT_HOW, source: 'our' as const, dir: 'all' as const }
  const m = { ...modes }
  for (const k of PRESET_KINDS) { const x = (o.modes as Record<string, unknown> | undefined)?.[k]; if (x === 'toEnd' || x === 'keyplay') m[k] = x }
  return { kind: p.kind, how: p.how, source: p.source, dir: p.dir, modes: m }
}
