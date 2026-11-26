// Insights (インサイト): the habits of a team its matches show, found by themselves, each with the plays
// that show it, so a scouting video is made in one go (the search's "インサイトから作る"). A habit is
// a share of plays in some situation well above the same share over plays like them: who the setter
// goes to in a rotation, where a setter sets in a rotation, with their own or the other setter in the
// front row, on a kind of pass (or a call, or at the end of a close set) against their own sets, where
// an attacker hits from a zone, where a server serves and whom, the server the team breaks with or
// doesn't, the receiver it sides out with or doesn't (against the servers faced), who breaks down on a
// kind of serve, the rotation the team can't side out of, who rises or falls at the end of a close set.
// Each is judged by an exact binomial test of its share against the base, and the more situations a
// kind of habit looks at, the surer each must be (Benjamini–Hochberg within its kind), so a kind with
// many places to look (a setter's combinations, an attacker's zones) doesn't fill the list with what
// chance alone would show. Pure, so it is unit-tested.
import type { PlayRef } from './filter'
import { MARKERS, addClips, newReel, type ClipMode, type Marker, type Reel } from './reel'
import { personOf, playerLabel, rotationOf, type WonBy } from './rotationSplit'
import { serveZoneMarker } from './presets'
import { tempoName } from './labels'
import { SET_TARGETS, attackOfContact, setTarget, setTargetName, setterCall, type SetTarget } from './setChart'
import type { Play } from './types'
import { t } from './i18n'

export type InsightKind = 'share' | 'setDist' | 'zone' | 'serveZone' | 'serveTarget' | 'serverBreak' | 'receiverSO' | 'clutch' | 'recWeak' | 'rotWeak'
export const INSIGHT_KINDS: InsightKind[] = ['share', 'setDist', 'zone', 'serveZone', 'serveTarget', 'serverBreak', 'receiverSO', 'clutch', 'recWeak', 'rotWeak']

export interface Insight {
  key: string // the same habit gets the same key when found again
  subject: string // who or what it is about, with its kind: one habit is kept per subject
  person: string | null // the player it is about (rotationSplit personOf); null: the team's (a rotation)
  kind: InsightKind
  headline: string // the habit in a line: the scene's name
  detail: string // the numbers behind it
  mark: string // what the plays that show it are (their marker's name)
  n: number // plays in the situation
  hits: number // of them, those that show the habit
  share: number // hits / n
  base: number // the same share over the plays like them
  z: number // the share against the base, in standard errors (negative: below it)
  p: number // the chance of a share this far from the base by luck alone (exact binomial, one-sided)
  adjP: number // p against the situations its kind looked at (Benjamini–Hochberg): how sure it is, all told
  refs: PlayRef[] // the plays that show the habit, in the order played
  others: PlayRef[] // the rest of the situation's plays
}

// How much a habit needs: enough plays in the situation, enough of them showing it, a share well
// above the base, and, all told (adjP), little chance of being luck: a list kept to ALPHA holds at
// most about one in five found by luck. A few matches hold few plays of a setter's combinations, so
// a stricter list would leave most of them out; the sample shows in each habit's numbers.
export const MIN_N = 10
export const MIN_HITS = 5
export const MIN_LIFT = 0.12
export const ALPHA = 0.2

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

// ln Γ(x), Lanczos (g = 7, nine terms): plenty for the counts of a few matches.
const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x)
  x -= 1
  let a = LANCZOS[0]
  const g = x + 7.5
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(g) - g + Math.log(a)
}
// The chance of `hits` or more (up) or `hits` or fewer (down) in n plays, each with chance `base`.
export function binomTail(hits: number, n: number, base: number, up = true): number {
  if (!n) return 1
  const p0 = Math.min(Math.max(base, 1e-9), 1 - 1e-9)
  const lnPmf = (k: number) => lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1) + k * Math.log(p0) + (n - k) * Math.log(1 - p0)
  const ks = up ? Array.from({ length: n - hits + 1 }, (_, i) => hits + i) : Array.from({ length: hits + 1 }, (_, i) => i)
  const logs = ks.map(lnPmf), top = Math.max(...logs)
  return Math.min(1, Math.exp(top) * logs.reduce((s, l) => s + Math.exp(l - top), 0))
}

// Whether a share is worth testing: enough plays, enough of them, far enough from the base.
const worth = (hits: number, n: number, base: number, up = true): boolean => {
  const lift = hits / n - base
  return n >= MIN_N && (up ? hits >= MIN_HITS && lift >= MIN_LIFT : lift <= -MIN_LIFT)
}

// The situations each kind of habit looked at, for how sure each found must be (adjP).
type Tally = Partial<Record<InsightKind, number>>
const tally = (s: Tally, kind: InsightKind, n = 1) => { s[kind] = (s[kind] ?? 0) + n }

interface Found { key: string; subject: string; person: string | null; kind: InsightKind; headline: (share: string) => string; detail: (n: number, hits: number, base: string) => string; mark: string; refs: PlayRef[]; others: PlayRef[]; base: number }
const make = (f: Found): Insight => {
  const n = f.refs.length + f.others.length, hits = f.refs.length, share = n ? hits / n : 0, p = binomTail(hits, n, f.base)
  return { key: f.key, subject: f.subject, person: f.person, kind: f.kind, headline: f.headline(pct(share)), detail: f.detail(n, hits, pct(f.base)), mark: f.mark, n, hits, share, base: f.base, z: zScore(hits, n, f.base), p, adjP: p, refs: f.refs, others: f.others }
}
const detailAll = (n: number, hits: number, base: string) => t('{0} 本中 {1} 本（チーム全体では {2}）', n, hits, base)
const detailOwn = (n: number, hits: number, base: string) => t('{0} 本中 {1} 本（ふだんは {2}）', n, hits, base)

// For each outcome in the situation: the share of it against its share in the base, kept when worth it.
function tendencies<K>(s: Tally, kind: InsightKind, ctx: PlayRef[], base: PlayRef[], outcome: (r: PlayRef) => K | null, found: (k: K, refs: PlayRef[], others: PlayRef[], share0: number) => Insight | null): Insight[] {
  const known = ctx.filter(r => outcome(r) !== null), baseKnown = base.filter(r => outcome(r) !== null)
  if (known.length < MIN_N || !baseKnown.length) return []
  const counts = new Map<K, number>()
  for (const r of baseKnown) { const k = outcome(r)!; counts.set(k, (counts.get(k) ?? 0) + 1) }
  const out: Insight[] = []
  const seen = new Set(known.map(r => outcome(r)!))
  tally(s, kind, seen.size)
  for (const k of seen) {
    const refs = known.filter(r => outcome(r) === k), share0 = (counts.get(k) ?? 0) / baseKnown.length
    if (!worth(refs.length, known.length, share0)) continue
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
function shareInsights(s: Tally, attacks: PlayRef[]): Insight[] {
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
  return situations.flatMap(([id, label, ctx, base]) => tendencies(s, 'share', ctx, base, personOf, (who, refs, others, b) => make({
    key: `share|${id}|${who}`, subject: `share|${id}`, person: who, kind: 'share', base: b, refs, others, mark: playerLabel(refs[0]),
    headline: sh => t('{0}は {1} が {2}', label, playerLabel(refs[0]), sh), detail: detailAll,
  })))
}

// A setter's set: where it went, with the situation it was given in. row: the setter in the front row
// or the back (a team's rotation is its setter's place: 2, 3 and 4 are the front row); oppRow: the
// other team's setter, whose block is the low one when in the front row.
type SetDim = 'rot' | 'row' | 'oppRow' | 'pass' | 'call' | 'late'
interface SetEvent { ref: PlayRef; target: SetTarget; dims: Record<SetDim, string | null> }
// The situations a setter's sets are looked at in: each alone, and some pairs: a rotation or the
// setter's row with the pass, the other setter's row and so on.
const SET_COMBOS: SetDim[][] = [
  ['rot'], ['row'], ['oppRow'], ['pass'], ['call'], ['late'],
  ['rot', 'pass'], ['rot', 'call'], ['rot', 'late'], ['rot', 'oppRow'], ['row', 'pass'], ['row', 'oppRow'], ['oppRow', 'pass'],
]
const PASSES = ['#', '+', '!', '-']
const TWO_SIDED: SetDim[] = ['row', 'oppRow'] // two values each: one is set against the other
const rowOf = (rot: number | null): string | null => (rot === null ? null : rot >= 2 && rot <= 4 ? 'front' : 'back')
const otherRotationOf = (r: PlayRef): number | null => (r.teamRole === 'opp' ? r.ourRot : r.oppRot)

// Every set (and dump) of the team's setters, each match's plays in order. A setter is a player who set.
function setEvents(scope: PlayRef[], team: 'our' | 'opp'): Map<string, SetEvent[]> {
  const setters = new Set(scope.filter(r => r.teamRole === team && r.play.skill === 'E').map(personOf))
  const out = new Map<string, SetEvent[]>()
  for (const refs of groupBy(scope, r => r.matchId).values()) {
    const plays = refs.map(r => r.play)
    refs.forEach((r, i) => {
      if (r.teamRole !== team || !setters.has(personOf(r)) || (r.play.skill !== 'E' && r.play.skill !== 'A')) return
      const attack = attackOfContact(plays, i)
      const target = attack && setTarget(attack, r.play.playerKey, r.play)
      if (!target) return
      const rot = rotationOf(r), call = r.play.skill === 'E' ? setterCall(r.play) : ''
      const pass = r.play.phase === 't' ? 't' : r.play.phase === 'r' && PASSES.includes(r.play.recEffect ?? '') ? r.play.recEffect! : null
      const dims = { rot: rot === null ? null : String(rot), row: rowOf(rot), oppRow: rowOf(otherRotationOf(r)), pass, call: call || null, late: isClutch(r.play) ? 'late' : null }
      out.set(personOf(r), [...(out.get(personOf(r)) ?? []), { ref: r, target, dims }])
    })
  }
  return out
}

const dimLabel = (d: SetDim, v: string): string =>
  d === 'rot' ? t('ローテ {0}', v) : d === 'row' ? (v === 'front' ? t('自分が前衛') : t('自分が後衛'))
    : d === 'oppRow' ? (v === 'front' ? t('相手セッターが前衛') : t('相手セッターが後衛'))
    : d === 'pass' ? (v === 't' ? t('トランジション') : t('レセプション「{0}」', v)) : d === 'call' ? t('コール {0}', v) : t('終盤の接戦')

// Where a setter sets in a situation, against their own sets: a rotation, their row or the other
// setter's (against the other row), a kind of pass (or transition), a call, the end of a close set,
// or a pair of them. A pair is kept only when it says more than each of its parts alone (its share
// well above theirs).
function setDistInsights(s: Tally, events: Map<string, SetEvent[]>): Insight[] {
  const out: Insight[] = []
  for (const [setter, all] of events) {
    const baseOf = (k: SetTarget) => all.filter(e => e.target === k).length / all.length
    const shareIn = (dims: [SetDim, string][], k: SetTarget) => {
      const ctx = all.filter(e => dims.every(([d, v]) => e.dims[d] === v))
      return ctx.filter(e => e.target === k).length / ctx.length
    }
    for (const combo of SET_COMBOS) {
      const groups = new Map<string, SetEvent[]>()
      for (const e of all) {
        if (combo.some(d => e.dims[d] === null)) continue
        const key = combo.map(d => `${d}=${e.dims[d]}`).join('&')
        groups.set(key, [...(groups.get(key) ?? []), e])
      }
      for (const [key, ctx] of groups) {
        if (ctx.length < MIN_N) continue
        const dims = combo.map((d): [SetDim, string] => [d, ctx[0].dims[d]!])
        const places = SET_TARGETS.filter(k => ctx.some(e => e.target === k))
        tally(s, 'setDist', places.length)
        // A row alone is set against the other row (front against back), not all the sets, which are
        // half of each: the two shares and their samples are both in the numbers.
        const [d0] = combo, other = combo.length === 1 && TWO_SIDED.includes(d0) ? all.filter(e => e.dims[d0] !== null && e.dims[d0] !== dims[0][1]) : null
        if (other) {
          if (other.length < MIN_N) continue
          for (const k of places) {
            const refs = ctx.filter(e => e.target === k), h2 = other.filter(e => e.target === k).length
            const p1 = refs.length / ctx.length, p2 = h2 / other.length, pooled = (refs.length + h2) / (ctx.length + other.length)
            if (refs.length < MIN_HITS || p1 - p2 < MIN_LIFT) continue
            const z = (p1 - p2) / Math.sqrt(pooled * (1 - pooled) * (1 / ctx.length + 1 / other.length)), p = normalTail(z)
            const who = refs[0].ref, otherLabel = dimLabel(d0, other[0].dims[d0]!)
            out.push({
              key: `setDist|${setter}|${key}|${k}`, subject: `setDist|${setter}|${key}`, person: setter, kind: 'setDist', n: ctx.length, hits: refs.length, share: p1, base: p2, z, p, adjP: p,
              refs: refs.map(e => e.ref), others: ctx.filter(e => e.target !== k).map(e => e.ref), mark: setTargetName(k),
              headline: t('{0} は{1}のとき {2} へ {3}', playerLabel(who), dimLabel(d0, dims[0][1]), setTargetName(k), pct(p1)),
              detail: t('{0} 本中 {1} 本（{2}のときは {3}・{4} 本中 {5} 本）', ctx.length, refs.length, otherLabel, pct(p2), other.length, h2),
            })
          }
          continue
        }
        for (const k of places) {
          const refs = ctx.filter(e => e.target === k), b = baseOf(k), share = refs.length / ctx.length
          if (!worth(refs.length, ctx.length, b)) continue
          if (dims.length > 1 && dims.some(part => share - shareIn([part], k) < MIN_LIFT)) continue
          const who = refs[0].ref, where = dims.map(([d, v]) => dimLabel(d, v)).join('・')
          out.push(make({
            key: `setDist|${setter}|${key}|${k}`, subject: `setDist|${setter}|${key}`, person: setter, kind: 'setDist', base: b,
            refs: refs.map(e => e.ref), others: ctx.filter(e => e.target !== k).map(e => e.ref), mark: setTargetName(k),
            headline: sh => t('{0} は{1}のとき {2} へ {3}', playerLabel(who), where, setTargetName(k), sh), detail: detailOwn,
          }))
        }
      }
    }
  }
  return out
}

// Where an attacker hits from each zone, against the team's attacks from that zone.
function zoneInsights(s: Tally, attacks: PlayRef[]): Insight[] {
  const from = groupBy(attacks, r => r.play.startZone)
  return [...from].flatMap(([zone, base]) => [...groupBy(base, personOf)].flatMap(([who, ctx]) =>
    tendencies(s, 'zone', ctx, base, r => r.play.endZone, (end, refs, others, b) => make({
      key: `zone|${who}|${zone}|${end}`, subject: `zone|${who}|${zone}`, person: who, kind: 'zone', base: b, refs, others, mark: `Zone${end}`,
      headline: sh => t('{0} の Zone{1} からのアタックは Zone{2} へ {3}', playerLabel(refs[0]), zone, end, sh), detail: detailAll,
    }))))
}

const SERVE_ZONE = (): Record<number, string> => ({ 1: 'Zone1', 2: 'Zone6', 3: 'Zone5', 4: t('ショート') })

// Where each server serves (Zone1, 6, 5 or short), against the team's serves; and whom, against the
// team's serves in the matches that receiver received in, the server's own there only (in the other
// matches the receiver wasn't there to be served at).
function serveInsights(s: Tally, serves: PlayRef[], receiverOf: (r: PlayRef) => PlayRef | null): Insight[] {
  const out: Insight[] = []
  const recKey = (r: PlayRef) => { const x = receiverOf(r); return x ? personOf(x) : null }
  const received = serves.filter(r => recKey(r) !== null)
  const matchesOf = new Map<string, Set<string>>()
  for (const r of received) { const k = recKey(r)!; matchesOf.set(k, (matchesOf.get(k) ?? new Set()).add(r.matchId)) }
  for (const [who, ctx] of groupBy(serves, personOf)) {
    out.push(...tendencies(s, 'serveZone', ctx, serves, r => serveZoneMarker(r.play), (z, refs, others, b) => make({
      key: `serveZone|${who}|${z}`, subject: `serveZone|${who}`, person: who, kind: 'serveZone', base: b, refs, others, mark: SERVE_ZONE()[z],
      headline: sh => t('{0} のサーブは {1} へ {2}', playerLabel(refs[0]), SERVE_ZONE()[z], sh), detail: detailAll,
    })))
    for (const rec of new Set(ctx.map(recKey).filter((k): k is string => k !== null))) {
      const there = matchesOf.get(rec)!
      const here = ctx.filter(r => there.has(r.matchId) && recKey(r) !== null), pool = received.filter(r => there.has(r.matchId))
      if (here.length < MIN_N) continue
      tally(s, 'serveTarget')
      const refs = here.filter(r => recKey(r) === rec), b = pool.filter(r => recKey(r) === rec).length / pool.length
      if (!worth(refs.length, here.length, b)) continue
      const target = receiverOf(refs[0])!
      out.push(make({
        key: `serveTarget|${who}|${rec}`, subject: `serveTarget|${who}`, person: who, kind: 'serveTarget', base: b, refs, others: here.filter(r => recKey(r) !== rec), mark: playerLabel(target),
        headline: sh => t('{0} のサーブは {1} を狙う（{2}）', playerLabel(refs[0]), playerLabel(target), sh), detail: detailAll,
      }))
    }
  }
  return out
}

// A reception that breaks down: poor (-), an overpass (/) or an error (=).
const brokeDown = (r: PlayRef) => r.play.effect === '-' || r.play.effect === '/' || r.play.effect === '='

// A serve's kind as its reception's type letter tells it: jump spin (Q), jump float (M), float (H).
const serveKind = (type: string): string => ({ Q: t('ジャンプサーブ'), M: t('ジャンプフローター'), H: t('フローター') })[type] ?? tempoName(type)

// Who breaks down on a kind of serve, against the team's receptions of that kind.
function receptionInsights(s: Tally, receptions: PlayRef[]): Insight[] {
  return [...groupBy(receptions, r => r.tempo)].flatMap(([type, base]) => {
    const b = base.filter(brokeDown).length / base.length
    return [...groupBy(base, personOf)].flatMap(([who, ctx]) => {
      if (ctx.length < MIN_N) return []
      tally(s, 'recWeak')
      const refs = ctx.filter(brokeDown)
      if (!worth(refs.length, ctx.length, b)) return []
      return [make({
        key: `recWeak|${who}|${type}`, subject: `recWeak|${who}`, person: who, kind: 'recWeak', base: b, refs, others: ctx.filter(r => !brokeDown(r)), mark: t('崩れたレセプション'),
        headline: sh => t('{0} は{1}で崩れる（{2}）', playerLabel(refs[0]), serveKind(type), sh),
        detail: (n, hits, base) => t('{0} 本中 {1} 本が - / =（チーム全体では {2}）', n, hits, base),
      })]
    })
  })
}

// The rotation the team can't side out of: its receptions there whose rally it lost, against the
// rallies it lost on reception in every rotation. The scene shows the lost ones.
function rotationInsights(s: Tally, receptions: PlayRef[], wonBy: WonBy): Insight[] {
  const known = receptions.filter(r => r.side !== null && wonBy(r) !== null)
  const lost = (r: PlayRef) => wonBy(r) !== r.side
  if (!known.length) return []
  const b = known.filter(lost).length / known.length
  return [1, 6, 5, 4, 3, 2].flatMap(rot => {
    const ctx = known.filter(r => rotationOf(r) === rot), refs = ctx.filter(lost)
    if (ctx.length < MIN_N) return []
    tally(s, 'rotWeak')
    if (!worth(refs.length, ctx.length, b)) return []
    return [make({
      key: `rotWeak|${rot}`, subject: `rotWeak|${rot}`, person: null, kind: 'rotWeak', base: b, refs, others: ctx.filter(r => !lost(r)), mark: t('失点'),
      headline: () => t('ローテ {0} のサイドアウト率 {1}（全体 {2}）', rot, pct(1 - refs.length / ctx.length), pct(1 - b)),
      detail: (n, hits) => t('{0} 回のレセプションのうち {1} 回は点を取られた', n, hits),
    })]
  })
}

// The chance of a standard normal at z or beyond, away from 0 (Abramowitz–Stegun 7.1.26).
export function normalTail(z: number): number {
  const x = Math.abs(z) / Math.SQRT2, k = 1 / (1 + 0.3275911 * x)
  const erfc = k * (0.254829592 + k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429)))) * Math.exp(-x * x)
  return erfc / 2
}

// The team's rallies on its own serve that it won (a break), by server, against the team's: well
// above or well below. Up, the breaks show it; down, the serves the other team sided out of.
function breakInsights(s: Tally, serves: PlayRef[], wonBy: WonBy): Insight[] {
  const known = serves.filter(r => r.side !== null && wonBy(r) !== null)
  if (!known.length) return []
  const won = (r: PlayRef) => wonBy(r) === r.side
  const b = known.filter(won).length / known.length
  return [...groupBy(known, personOf)].flatMap(([who, ctx]): Insight[] => {
    if (ctx.length < MIN_N) return []
    tally(s, 'serverBreak', 2) // up and down
    const breaks = ctx.filter(won), lost = ctx.filter(r => !won(r)), share = breaks.length / ctx.length
    const up = worth(breaks.length, ctx.length, b)
    if (!up && !worth(breaks.length, ctx.length, b, false)) return []
    const p = binomTail(breaks.length, ctx.length, b, up)
    return [{
      key: `serverBreak|${who}|${up ? 'up' : 'down'}`, subject: `serverBreak|${who}`, person: who, kind: 'serverBreak', n: ctx.length, hits: up ? breaks.length : lost.length, share, base: b,
      z: zScore(breaks.length, ctx.length, b), p, adjP: p, refs: up ? breaks : lost, others: up ? lost : breaks,
      mark: up ? t('ブレイク') : t('サイドアウトされた'),
      headline: t('{0} のサーブはブレイク率 {1}', playerLabel(ctx[0]), pct(share)),
      detail: t('{0} 本中 {1} 本でブレイク（チーム全体では {2}）', ctx.length, breaks.length, pct(b)),
    }]
  })
}

// Who the team sides out with, or doesn't, when they receive: the rallies of their receptions the
// team won, against what the servers they faced would lead one to expect. Each serve's chance of a
// side-out is 1 − its server's break rate, the server's break rate drawn toward all the servers'
// (SERVER_PRIOR serves' worth) and without this receiver's own receptions: a receiver isn't weak for
// having faced the strong servers, nor a server strong for having served at this receiver.
const SERVER_PRIOR = 10
function sideOutInsights(s: Tally, receptions: PlayRef[], serverOf: (r: PlayRef) => PlayRef | null, wonBy: WonBy): Insight[] {
  const known = receptions.filter(r => r.side !== null && wonBy(r) !== null && serverOf(r) !== null)
  if (!known.length) return []
  const sidedOut = (r: PlayRef) => wonBy(r) === r.side
  const breakAll = known.filter(r => !sidedOut(r)).length / known.length
  // Each server's serves received and broken: in all, and by receiver.
  const tot = new Map<string, { n: number; broke: number }>(), byRec = new Map<string, { n: number; broke: number }>()
  const add = (m: Map<string, { n: number; broke: number }>, k: string, broke: boolean) => { const c = m.get(k) ?? { n: 0, broke: 0 }; c.n++; if (broke) c.broke++; m.set(k, c) }
  for (const r of known) { const sv = personOf(serverOf(r)!); add(tot, sv, !sidedOut(r)); add(byRec, `${sv}>${personOf(r)}`, !sidedOut(r)) }
  const expectedSideOut = (r: PlayRef) => {
    const sv = personOf(serverOf(r)!), all = tot.get(sv)!, mine = byRec.get(`${sv}>${personOf(r)}`)!
    return 1 - (all.broke - mine.broke + SERVER_PRIOR * breakAll) / (all.n - mine.n + SERVER_PRIOR)
  }
  return [...groupBy(known, personOf)].flatMap(([who, ctx]): Insight[] => {
    if (ctx.length < MIN_N) return []
    tally(s, 'receiverSO', 2) // up and down
    const ok = ctx.filter(sidedOut), lost = ctx.filter(r => !sidedOut(r)), chances = ctx.map(expectedSideOut)
    const expect = chances.reduce((a, c) => a + c, 0), spread = Math.sqrt(chances.reduce((a, c) => a + c * (1 - c), 0))
    const share = ok.length / ctx.length, base = expect / ctx.length, up = share - base >= MIN_LIFT
    if (!up && share - base > -MIN_LIFT) return []
    const z = spread ? (ok.length - expect) / spread : 0
    const p = normalTail(z)
    return [{
      key: `receiverSO|${who}|${up ? 'up' : 'down'}`, subject: `receiverSO|${who}`, person: who, kind: 'receiverSO', n: ctx.length, hits: up ? ok.length : lost.length, share, base,
      z, p, adjP: p, refs: up ? ok : lost, others: up ? lost : ok,
      mark: up ? t('サイドアウト') : t('失点'),
      headline: t('{0} のレセプションはサイドアウト率 {1}', playerLabel(ctx[0]), pct(share)),
      detail: t('{0} 本中 {1} 本でサイドアウト（受けたサーバーからの見込みは {2}）', ctx.length, ok.length, pct(base)),
    }]
  })
}

// Who rises or falls at the end of a close set: the attacker's kill rate there against their own.
// Rising, the kills show it; falling, the attacks that didn't go down do.
function clutchInsights(s: Tally, attacks: PlayRef[]): Insight[] {
  const kill = (r: PlayRef) => r.play.effect === '#'
  return [...groupBy(attacks, personOf)].flatMap(([who, all]): Insight[] => {
    const ctx = all.filter(r => isClutch(r.play)), kills = ctx.filter(kill)
    if (ctx.length >= all.length || ctx.length < MIN_N) return []
    tally(s, 'clutch', 2) // up and down
    const b = all.filter(kill).length / all.length, share = kills.length / ctx.length
    const up = worth(kills.length, ctx.length, b)
    if (!up && !worth(kills.length, ctx.length, b, false)) return []
    const missed = ctx.filter(r => !kill(r)), p = binomTail(kills.length, ctx.length, b, up)
    return [{
      key: `clutch|${who}|${up ? 'up' : 'down'}`, subject: `clutch|${who}`, person: who, kind: 'clutch', n: ctx.length, hits: up ? kills.length : missed.length, share, base: b,
      z: zScore(kills.length, ctx.length, b), p, adjP: p, refs: up ? kills : missed, others: up ? missed : kills,
      mark: up ? t('決まったアタック') : t('決まらなかったアタック'),
      headline: up ? t('{0} は終盤の接戦で決定率 {1}', playerLabel(all[0]), pct(share)) : t('{0} は終盤の接戦で決定率が {1} に落ちる', playerLabel(all[0]), pct(share)),
      detail: t('{0} 本中 {1} 本が決まった（ふだんは {2}）', ctx.length, kills.length, pct(b)),
    }]
  })
}

// The skill a kind of habit is about: sets, attacks, serves or receptions.
export type InsightSkill = 'E' | 'A' | 'S' | 'R'
export const INSIGHT_SKILLS: InsightSkill[] = ['E', 'A', 'S', 'R']
export const KIND_SKILL: Record<InsightKind, InsightSkill> = { share: 'A', setDist: 'E', zone: 'A', clutch: 'A', serveZone: 'S', serveTarget: 'S', serverBreak: 'S', receiverSO: 'R', recWeak: 'R', rotWeak: 'R' }

// What to look at: habits of these skills only, about these players only (personOf keys; a
// rotation's habit is about no player, so it goes). Empty: all.
export interface InsightFocus { skills: InsightSkill[]; persons: string[] }
export const NO_FOCUS: InsightFocus = { skills: [], persons: [] }
export const inFocus = (i: Insight, f: InsightFocus): boolean =>
  (!f.skills.length || f.skills.includes(KIND_SKILL[i.kind])) && (!f.persons.length || (i.person !== null && f.persons.includes(i.person)))

// How much a kind of habit counts when they are ranked: a server's target counts half. A server has
// only a few receivers to aim at, and over several matches whom a server aimed at in one says little.
export const KIND_WEIGHT: Partial<Record<InsightKind, number>> = { serveTarget: 0.5 }
// A habit's place in the list (and how sure the dialog calls it): how unlikely it is all told, as a
// power of ten (2: one in a hundred), weighted by its kind.
export const rankOf = (i: Pick<Insight, 'kind' | 'adjP'>): number => -Math.log10(Math.max(i.adjP, 1e-12)) * (KIND_WEIGHT[i.kind] ?? 1)

// The team's habits in focus, the surest first (by rankOf). A habit of the same player or rotation
// and kind shows once (the surest in focus), and at most `max` are kept.
export function findInsights(scope: PlayRef[], team: 'our' | 'opp', wonBy: WonBy, max = 20, focus: InsightFocus = NO_FOCUS): Insight[] {
  const mine = scope.filter(r => r.teamRole === team)
  const skill = (s: string) => mine.filter(r => r.play.skill === s)
  // A serve's reception: the other team's first reception in the rally.
  const recs = new Map<string, PlayRef>()
  for (const r of scope) { const k = rallyKey(r); if (k && r.play.skill === 'R' && r.teamRole !== team && !recs.has(k)) recs.set(k, r) }
  const receiverOf = (r: PlayRef) => { const k = rallyKey(r); return k ? recs.get(k) ?? null : null }
  // A reception's serve: the other team's serve in the rally.
  const servesBy = new Map<string, PlayRef>()
  for (const r of scope) { const k = rallyKey(r); if (k && r.play.skill === 'S' && r.teamRole !== team && !servesBy.has(k)) servesBy.set(k, r) }
  const serverOf = (r: PlayRef) => { const k = rallyKey(r); return k ? servesBy.get(k) ?? null : null }
  const attacks = skill('A'), receptions = skill('R'), serves = skill('S'), s: Tally = {}
  const all = [
    ...shareInsights(s, attacks), ...setDistInsights(s, setEvents(scope, team)), ...zoneInsights(s, attacks), ...serveInsights(s, serves, receiverOf),
    ...breakInsights(s, serves, wonBy), ...sideOutInsights(s, receptions, serverOf, wonBy),
    ...receptionInsights(s, receptions), ...rotationInsights(s, receptions, wonBy), ...clutchInsights(s, attacks),
  ].map(i => ({ ...i, adjP: 1 }))
  // Benjamini–Hochberg in each kind: the situations it looked at and didn't find worth testing count
  // as p = 1, behind every habit found. A habit's adjP is the smallest share of luck a list down to it
  // would hold; those within ALPHA are kept.
  for (const kind of INSIGHT_KINDS) {
    const list = all.filter(i => i.kind === kind).sort((a, b) => a.p - b.p), m = Math.max(s[kind] ?? 1, list.length)
    let least = 1
    for (let j = list.length - 1; j >= 0; j--) { least = Math.min(least, (list[j].p * m) / (j + 1)); list[j].adjP = least }
  }
  const kept = all.filter(i => i.adjP <= ALPHA && inFocus(i, focus)).sort((a, b) => rankOf(b) - rankOf(a))
  const seen = new Set<string>(), out: Insight[] = []
  for (const i of kept) {
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
// The focus is kept too, so a rotation's habit made for one player stays about that player.
export interface VideoInsight extends InsightReelOptions { team: 'our' | 'opp'; subjects: string[]; focus: InsightFocus }

export const videoInsight = (team: 'our' | 'opp', list: Insight[], o: InsightReelOptions, focus: InsightFocus = NO_FOCUS): VideoInsight =>
  ({ team, subjects: list.map(i => i.subject), focus: { skills: [...focus.skills], persons: [...focus.persons] }, mode: o.mode, limit: o.limit, withOthers: o.withOthers, prefix: o.prefix })

// A video's insight read back from its file: null when it isn't one.
export function cleanVideoInsight(v: unknown): VideoInsight | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<VideoInsight>
  if (!Array.isArray(o.subjects)) return null
  const subjects = o.subjects.filter((s): s is string => typeof s === 'string' && s !== '')
  if (!subjects.length) return null
  const f = (o.focus ?? {}) as Partial<InsightFocus>
  const focus: InsightFocus = {
    skills: Array.isArray(f.skills) ? INSIGHT_SKILLS.filter(k => (f.skills as unknown[]).includes(k)) : [],
    persons: Array.isArray(f.persons) ? f.persons.filter((x): x is string => typeof x === 'string' && x !== '') : [],
  }
  return {
    team: o.team === 'our' ? 'our' : 'opp', subjects, focus,
    mode: o.mode === 'toEnd' ? 'toEnd' : 'keyplay',
    limit: typeof o.limit === 'number' && o.limit > 0 ? Math.floor(o.limit) : null,
    withOthers: o.withOthers === true,
    prefix: typeof o.prefix === 'string' ? o.prefix : '',
  }
}

// The habits of a video found again in these plays, in the video's order: each subject's surest
// habit now (its outcome may have changed). `gone`: the subjects with no clear habit any more.
export function refindInsights(scope: PlayRef[], vi: VideoInsight, wonBy: WonBy): { insights: Insight[]; gone: number } {
  const now = new Map(findInsights(scope, vi.team, wonBy, Infinity, vi.focus).map(i => [i.subject, i]))
  const insights = vi.subjects.map(s => now.get(s)).filter((i): i is Insight => !!i)
  return { insights, gone: vi.subjects.length - insights.length }
}

export const insightKindName = (k: InsightKind): string => ({
  share: t('アタッカー'), setDist: t('セット配分'), zone: t('コース'), serveZone: t('サーブコース'), serveTarget: t('サーブの狙い'),
  serverBreak: t('ブレイク'), receiverSO: t('サイドアウト'), clutch: t('勝負所'), recWeak: t('レセプション'), rotWeak: t('ローテーション'),
})[k]
