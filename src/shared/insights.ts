// Insights (インサイト): the habits of a team its matches show, found by themselves, each with the plays
// that show it, so a scouting video is made in one go (the search's "インサイトから作る"). A habit is
// a share of plays in some situation well above the same share over all the team's plays like them:
// who the setter goes to in a rotation, where an attacker hits from a zone, where a server serves and
// whom, who breaks down on a kind of serve, the rotation the team can't side out of, who rises or
// falls at the end of a close set. Each is ranked by how sure it is (a binomial z-score of the share
// against the team's), so a habit seen in few plays, or one a little above usual, stays out.
// Pure, so it is unit-tested.
import type { PlayRef } from './filter'
import { MARKERS, addClips, newReel, type ClipMode, type Marker, type Reel } from './reel'
import { personOf, playerLabel, rotationOf, type WonBy } from './rotationSplit'
import { serveZoneMarker } from './presets'
import { tempoName } from './labels'
import type { Play } from './types'
import { t } from './i18n'

export type InsightKind = 'share' | 'zone' | 'serveZone' | 'serveTarget' | 'clutch' | 'recWeak' | 'rotWeak'
export const INSIGHT_KINDS: InsightKind[] = ['share', 'zone', 'serveZone', 'serveTarget', 'clutch', 'recWeak', 'rotWeak']

export interface Insight {
  key: string // the same habit gets the same key when found again
  subject: string // who or what it is about, with its kind: one habit is kept per subject
  kind: InsightKind
  headline: string // the habit in a line: the scene's name
  detail: string // the numbers behind it
  mark: string // what the plays that show it are (their marker's name)
  n: number // plays in the situation
  hits: number // of them, those that show the habit
  share: number // hits / n
  base: number // the same share over the team's plays like them
  z: number // how sure: the share against the base, in standard errors (negative: below it)
  refs: PlayRef[] // the plays that show the habit, in the order played
  others: PlayRef[] // the rest of the situation's plays
}

// How much a habit needs: enough plays in the situation, enough of them showing it, a share well
// above the team's, and a z-score past chance.
export const MIN_N = 10
export const MIN_HITS = 5
export const MIN_LIFT = 0.12
export const MIN_Z = 2

export const pct = (x: number): string => `${Math.round(x * 100)}%`

// The end of a close set: a team at 20 or more (10 in the fifth), the score within two.
export function isClutch(p: Play): boolean {
  const end = p.setNum === 5 ? 15 : 25
  const { home, away } = p.score ?? { home: 0, away: 0 }
  return Math.max(home, away) >= end - 5 && Math.abs(home - away) <= 2
}

// A share in a situation against the base: z = (p − p0) / √(p0(1 − p0) / n).
export function zScore(hits: number, n: number, base: number): number {
  if (!n || base <= 0 || base >= 1) return 0
  return (hits / n - base) / Math.sqrt((base * (1 - base)) / n)
}

const passes = (hits: number, n: number, base: number, up = true): boolean => {
  const lift = hits / n - base
  return n >= MIN_N && (up ? hits >= MIN_HITS && lift >= MIN_LIFT : lift <= -MIN_LIFT) && Math.abs(zScore(hits, n, base)) >= MIN_Z
}

interface Found { key: string; subject: string; kind: InsightKind; headline: (share: string) => string; detail: (n: number, hits: number, base: string) => string; mark: string; refs: PlayRef[]; others: PlayRef[]; base: number }
const make = (f: Found): Insight => {
  const n = f.refs.length + f.others.length, hits = f.refs.length, share = n ? hits / n : 0
  return { key: f.key, subject: f.subject, kind: f.kind, headline: f.headline(pct(share)), detail: f.detail(n, hits, pct(f.base)), mark: f.mark, n, hits, share, base: f.base, z: zScore(hits, n, f.base), refs: f.refs, others: f.others }
}
const detailAll = (n: number, hits: number, base: string) => t('{0} 本中 {1} 本（チーム全体では {2}）', n, hits, base)

// For each outcome in the situation: the share of it against its share in the base, kept when it passes.
function tendencies<K>(ctx: PlayRef[], base: PlayRef[], outcome: (r: PlayRef) => K | null, found: (k: K, refs: PlayRef[], others: PlayRef[], share0: number) => Insight | null): Insight[] {
  const known = ctx.filter(r => outcome(r) !== null), baseKnown = base.filter(r => outcome(r) !== null)
  if (known.length < MIN_N || !baseKnown.length) return []
  const counts = new Map<K, number>()
  for (const r of baseKnown) { const k = outcome(r)!; counts.set(k, (counts.get(k) ?? 0) + 1) }
  const out: Insight[] = []
  for (const k of new Set(known.map(r => outcome(r)!))) {
    const refs = known.filter(r => outcome(r) === k), share0 = (counts.get(k) ?? 0) / baseKnown.length
    if (!passes(refs.length, known.length, share0)) continue
    const i = found(k, refs, known.filter(r => outcome(r) !== k), share0)
    if (i) out.push(i)
  }
  return out
}

const groupBy = <K,>(refs: PlayRef[], key: (r: PlayRef) => K | null): Map<K, PlayRef[]> => {
  const m = new Map<K, PlayRef[]>()
  for (const r of refs) { const k = key(r); if (k !== null) m.set(k, [...(m.get(k) ?? []), r]) }
  return m
}
const rallyKey = (r: PlayRef): string | null => (r.play.rallyId === null ? null : `${r.matchId}|${r.play.rallyId}`)

// Who the attacks go to: in each rotation's side-out, after a good and a poor reception, in
// transition and at the end of a close set, against the team's attacks of that phase.
function shareInsights(attacks: PlayRef[]): Insight[] {
  const so = attacks.filter(r => r.play.phase === 'r')
  const good = (r: PlayRef) => r.play.recEffect === '#' || r.play.recEffect === '+'
  const poor = (r: PlayRef) => r.play.recEffect === '!' || r.play.recEffect === '-' || r.play.recEffect === '/'
  const situations: [string, string, PlayRef[], PlayRef[]][] = [
    ...[1, 6, 5, 4, 3, 2].map((rot): [string, string, PlayRef[], PlayRef[]] => [`rot${rot}`, t('ローテ {0} のサイドアウト', rot), so.filter(r => rotationOf(r) === rot), so]),
    ['good', t('良いレセプションからの攻撃'), so.filter(good), so],
    ['poor', t('悪いレセプションからの攻撃'), so.filter(poor), so],
    ['trans', t('トランジションの攻撃'), attacks.filter(r => r.play.phase === 't'), attacks],
    ['clutch', t('終盤の接戦の攻撃'), attacks.filter(r => isClutch(r.play)), attacks],
  ]
  return situations.flatMap(([id, label, ctx, base]) => tendencies(ctx, base, personOf, (who, refs, others, b) => make({
    key: `share|${id}|${who}`, subject: `share|${id}`, kind: 'share', base: b, refs, others, mark: playerLabel(refs[0]),
    headline: s => t('{0}は {1} が {2}', label, playerLabel(refs[0]), s), detail: detailAll,
  })))
}

// Where an attacker hits from each zone, against the team's attacks from that zone.
function zoneInsights(attacks: PlayRef[]): Insight[] {
  const from = groupBy(attacks, r => r.play.startZone)
  return [...from].flatMap(([zone, base]) => [...groupBy(base, personOf)].flatMap(([who, ctx]) =>
    tendencies(ctx, base, r => r.play.endZone, (end, refs, others, b) => make({
      key: `zone|${who}|${zone}|${end}`, subject: `zone|${who}|${zone}`, kind: 'zone', base: b, refs, others, mark: `Zone${end}`,
      headline: s => t('{0} の Zone{1} からのアタックは Zone{2} へ {3}', playerLabel(refs[0]), zone, end, s), detail: detailAll,
    }))))
}

const SERVE_ZONE = (): Record<number, string> => ({ 1: 'Zone1', 2: 'Zone6', 3: 'Zone5', 4: t('ショート') })

// Where each server serves (Zone1, 6, 5 or short) and whom, against the team's serves.
function serveInsights(serves: PlayRef[], receiverOf: (r: PlayRef) => PlayRef | null): Insight[] {
  const out: Insight[] = []
  const recKey = (r: PlayRef) => { const x = receiverOf(r); return x ? personOf(x) : null }
  for (const [who, ctx] of groupBy(serves, personOf)) {
    out.push(...tendencies(ctx, serves, r => serveZoneMarker(r.play), (z, refs, others, b) => make({
      key: `serveZone|${who}|${z}`, subject: `serveZone|${who}`, kind: 'serveZone', base: b, refs, others, mark: SERVE_ZONE()[z],
      headline: s => t('{0} のサーブは {1} へ {2}', playerLabel(refs[0]), SERVE_ZONE()[z], s), detail: detailAll,
    })))
    out.push(...tendencies(ctx, serves, recKey, (rec, refs, others, b) => {
      const target = receiverOf(refs[0])
      return target ? make({
        key: `serveTarget|${who}|${rec}`, subject: `serveTarget|${who}`, kind: 'serveTarget', base: b, refs, others, mark: playerLabel(target),
        headline: s => t('{0} のサーブは {1} を狙う（{2}）', playerLabel(refs[0]), playerLabel(target), s), detail: detailAll,
      }) : null
    }))
  }
  return out
}

// A reception that breaks down: poor (-), an overpass (/) or an error (=).
const brokeDown = (r: PlayRef) => r.play.effect === '-' || r.play.effect === '/' || r.play.effect === '='

// A serve's kind as its reception's type letter tells it: jump spin (Q), jump float (M), float (H).
const serveKind = (type: string): string => ({ Q: t('ジャンプサーブ'), M: t('ジャンプフローター'), H: t('フローター') })[type] ?? tempoName(type)

// Who breaks down on a kind of serve, against the team's receptions of that kind.
function receptionInsights(receptions: PlayRef[]): Insight[] {
  return [...groupBy(receptions, r => r.tempo)].flatMap(([type, base]) => {
    const b = base.filter(brokeDown).length / base.length
    return [...groupBy(base, personOf)].flatMap(([who, ctx]) => {
      const refs = ctx.filter(brokeDown)
      if (!passes(refs.length, ctx.length, b)) return []
      return [make({
        key: `recWeak|${who}|${type}`, subject: `recWeak|${who}`, kind: 'recWeak', base: b, refs, others: ctx.filter(r => !brokeDown(r)), mark: t('崩れたレセプション'),
        headline: s => t('{0} は{1}で崩れる（{2}）', playerLabel(refs[0]), serveKind(type), s),
        detail: (n, hits, base) => t('{0} 本中 {1} 本が - / =（チーム全体では {2}）', n, hits, base),
      })]
    })
  })
}

// The rotation the team can't side out of: its receptions there whose rally it lost, against the
// rallies it lost on reception in every rotation. The scene shows the lost ones.
function rotationInsights(receptions: PlayRef[], wonBy: WonBy): Insight[] {
  const known = receptions.filter(r => r.side !== null && wonBy(r) !== null)
  const lost = (r: PlayRef) => wonBy(r) !== r.side
  if (!known.length) return []
  const b = known.filter(lost).length / known.length
  return [1, 6, 5, 4, 3, 2].flatMap(rot => {
    const ctx = known.filter(r => rotationOf(r) === rot), refs = ctx.filter(lost)
    if (!passes(refs.length, ctx.length, b)) return []
    return [make({
      key: `rotWeak|${rot}`, subject: `rotWeak|${rot}`, kind: 'rotWeak', base: b, refs, others: ctx.filter(r => !lost(r)), mark: t('失点'),
      headline: () => t('ローテ {0} のサイドアウト率 {1}（全体 {2}）', rot, pct(1 - refs.length / ctx.length), pct(1 - b)),
      detail: (n, hits) => t('{0} 回のレセプションのうち {1} 回は点を取られた', n, hits),
    })]
  })
}

// Who rises or falls at the end of a close set: the attacker's kill rate there against their own.
// Rising, the kills show it; falling, the attacks that didn't go down do.
function clutchInsights(attacks: PlayRef[]): Insight[] {
  const kill = (r: PlayRef) => r.play.effect === '#'
  return [...groupBy(attacks, personOf)].flatMap(([who, all]): Insight[] => {
    const ctx = all.filter(r => isClutch(r.play)), kills = ctx.filter(kill)
    if (ctx.length >= all.length) return []
    const b = all.filter(kill).length / all.length, share = kills.length / ctx.length
    const up = passes(kills.length, ctx.length, b)
    if (!up && !passes(kills.length, ctx.length, b, false)) return []
    const missed = ctx.filter(r => !kill(r))
    return [{
      key: `clutch|${who}|${up ? 'up' : 'down'}`, subject: `clutch|${who}`, kind: 'clutch', n: ctx.length, hits: up ? kills.length : missed.length, share, base: b,
      z: zScore(kills.length, ctx.length, b), refs: up ? kills : missed, others: up ? missed : kills,
      mark: up ? t('決まったアタック') : t('決まらなかったアタック'),
      headline: up ? t('{0} は終盤の接戦で決定率 {1}', playerLabel(all[0]), pct(share)) : t('{0} は終盤の接戦で決定率が {1} に落ちる', playerLabel(all[0]), pct(share)),
      detail: t('{0} 本中 {1} 本が決まった（ふだんは {2}）', ctx.length, kills.length, pct(b)),
    }]
  })
}

// The team's habits, the surest first. A habit of the same player or rotation and kind shows once
// (the surest), and at most `max` are kept.
export function findInsights(scope: PlayRef[], team: 'our' | 'opp', wonBy: WonBy, max = 20): Insight[] {
  const mine = scope.filter(r => r.teamRole === team)
  const skill = (s: string) => mine.filter(r => r.play.skill === s)
  // A serve's reception: the other team's first reception in the rally.
  const recs = new Map<string, PlayRef>()
  for (const r of scope) { const k = rallyKey(r); if (k && r.play.skill === 'R' && r.teamRole !== team && !recs.has(k)) recs.set(k, r) }
  const receiverOf = (r: PlayRef) => { const k = rallyKey(r); return k ? recs.get(k) ?? null : null }
  const attacks = skill('A'), receptions = skill('R')
  const all = [
    ...shareInsights(attacks), ...zoneInsights(attacks), ...serveInsights(skill('S'), receiverOf),
    ...receptionInsights(receptions), ...rotationInsights(receptions, wonBy), ...clutchInsights(attacks),
  ].sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
  const seen = new Set<string>(), out: Insight[] = []
  for (const i of all) {
    if (seen.has(i.subject)) continue
    seen.add(i.subject)
    out.push(i)
    if (out.length >= max) break
  }
  return out
}

// The scenes of an insight video: one per insight, named by its headline, its title card with the
// numbers under it. Marker 1 holds the plays that show the habit (at most `limit`: the last ones
// in the search's order); with `withOthers`, marker 2 the situation's other plays, to see
// what the habit is against.
export interface InsightReelOptions { mode: ClipMode; limit: number | null; withOthers: boolean; prefix: string }
export function insightReels(list: Insight[], o: InsightReelOptions): Reel[] {
  const take = (refs: PlayRef[]) => (o.limit ? refs.slice(-o.limit) : refs)
  return list.map(i => {
    let r: Reel = { ...newReel(o.prefix ? `${o.prefix} ${i.headline}` : i.headline), scope: 'all', sceneCard: true, cardTitle: `${i.headline}\n${i.detail}` }
    r = { ...r, markerNames: { ...r.markerNames, 1: i.mark, ...(o.withOthers ? { 2: t('それ以外') } : {}) } }
    const groups: [Marker, PlayRef[]][] = [[MARKERS[0], take(i.refs)], ...(o.withOthers ? [[MARKERS[1], take(i.others)] as [Marker, PlayRef[]]] : [])]
    for (const [m, refs] of groups) if (refs.length) r = addClips(r, refs.map(x => ({ matchId: x.matchId, play: x.play })), m, o.mode).reel
    return r
  })
}

// What an insight video was made from, kept on the video (Video.insight) so it can be made again,
// for example after matches are added: the team, the habits picked by subject (so a rotation whose
// sets now go to another player is still in it), and how the scenes were cut.
export interface VideoInsight extends InsightReelOptions { team: 'our' | 'opp'; subjects: string[] }

export const videoInsight = (team: 'our' | 'opp', list: Insight[], o: InsightReelOptions): VideoInsight =>
  ({ team, subjects: list.map(i => i.subject), mode: o.mode, limit: o.limit, withOthers: o.withOthers, prefix: o.prefix })

// A video's insight read back from its file: null when it isn't one.
export function cleanVideoInsight(v: unknown): VideoInsight | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<VideoInsight>
  if (!Array.isArray(o.subjects)) return null
  const subjects = o.subjects.filter((s): s is string => typeof s === 'string' && s !== '')
  if (!subjects.length) return null
  return {
    team: o.team === 'our' ? 'our' : 'opp', subjects,
    mode: o.mode === 'toEnd' ? 'toEnd' : 'keyplay',
    limit: typeof o.limit === 'number' && o.limit > 0 ? Math.floor(o.limit) : null,
    withOthers: o.withOthers === true,
    prefix: typeof o.prefix === 'string' ? o.prefix : '',
  }
}

// The habits of a video found again in these plays, in the video's order: each subject's surest
// habit now (its outcome may have changed). `gone`: the subjects with no clear habit any more.
export function refindInsights(scope: PlayRef[], vi: VideoInsight, wonBy: WonBy): { insights: Insight[]; gone: number } {
  const now = new Map(findInsights(scope, vi.team, wonBy, Infinity).map(i => [i.subject, i]))
  const insights = vi.subjects.map(s => now.get(s)).filter((i): i is Insight => !!i)
  return { insights, gone: vi.subjects.length - insights.length }
}

export const insightKindName = (k: InsightKind): string => ({
  share: t('セット配分'), zone: t('コース'), serveZone: t('サーブコース'), serveTarget: t('サーブの狙い'),
  clutch: t('勝負所'), recWeak: t('レセプション'), rotWeak: t('ローテーション'),
})[k]
