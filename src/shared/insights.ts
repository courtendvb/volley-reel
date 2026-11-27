// Insights (インサイト): the habits of a team its matches show, found by themselves, each with the plays
// that show it, so a scouting video is made in one go (the search's "インサイトから作る"). A habit is
// a share of plays in some situation well above the same share over plays like them: who the setter
// goes to in a rotation, where a setter sets in a rotation, with their own or the other setter in the
// front row, on a kind of pass (or a call, or at the end of a close set) against their own sets, where
// an attacker hits from a zone, where a server serves and whom, the server the team breaks with or
// doesn't, the receiver it sides out with or doesn't (against the servers faced), who breaks down on a
// kind of serve, the rotation the team can't side out of, who rises or falls at the end of a close set;
// and what anyone does in a situation against what they do otherwise (insightSituations.ts): a
// setter's places and whether they go back to who just scored, attackers' kill and blocked rates and
// courses, servers' errors, kinds, courses and pressure, receivers by the serve, side-out by pass,
// a rotation after a missed side-out, rallies after a timeout and long rallies, the recent matches
// against the earlier.
// Each is judged by an exact binomial test of its share against the base, and the more situations a
// kind of habit looks at, the surer each must be (Benjamini–Hochberg within its kind), so a kind with
// many places to look (a setter's combinations, an attacker's zones) doesn't fill the list with what
// chance alone would show. Pure, so it is unit-tested.
import type { PlayRef } from './filter'
import { MARKERS, addClips, newReel, type ClipMode, type Marker, type Reel } from './reel'
import { personOf, playerLabel, rotationOf, type WonBy } from './rotationSplit'
import { orderByMatch, serveZoneMarker } from './presets'
import { isLang, t, type Lang } from './i18n'
import { DEFAULT_TEXT_BOX, HEADLINE_SIZE, type Annotation, type HeadlineStyle } from './annotation'
import { nearSide, zoneCell, zoneCellQuad, type CourtFit } from './courtGeometry'
import { situationInsights, type InsightLookups } from './insightSituations'
import { MIN_N, MIN_LIFT, ALPHA, MAX_P, binomTail, groupBy, normalTail, pct, rallyKey, tally, worth, zScore, isClutch, isPoorPass, POOR_WEIGHT, SERVE_ZONE, SERVE_ZONES, serveKind, type Tally } from './insightStats'

export type { InsightLookups, League } from './insightSituations'
export { leagueOf, LEAGUE_TEAMS } from './insightSituations'
export { MIN_N, MIN_HITS, MIN_LIFT, ALPHA, MAX_P, pct, isClutch, zScore, binomTail, normalTail } from './insightStats'

export type InsightKind = 'share' | 'setDist' | 'setFollow' | 'zone' | 'zoneBy' | 'killRate' | 'blocked' | 'blockFront' | 'serveZone' | 'serveCourse' | 'serveTarget' | 'serveErr' | 'serveType' | 'serveEffect' | 'serverBreak' | 'receiverSO' | 'recZone' | 'soGrade' | 'clutch' | 'recWeak' | 'rotWeak' | 'rallyServe' | 'rallyRec' | 'rallyLong'
export const INSIGHT_KINDS: InsightKind[] = ['share', 'setDist', 'setFollow', 'zone', 'zoneBy', 'killRate', 'blocked', 'blockFront', 'serveZone', 'serveCourse', 'serveTarget', 'serveErr', 'serveType', 'serveEffect', 'serverBreak', 'receiverSO', 'recZone', 'soGrade', 'clutch', 'recWeak', 'rotWeak', 'rallyServe', 'rallyRec', 'rallyLong']

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
  league?: number // how much the league's teams move the same way in the same situation (none: not set beside it)
  maxP?: number // kept by p up to this, past MAX_P (a kind kept on less)
  low?: boolean // the number shown is below what it is set against (↓); else above it (↑)
  paint?: InsightPaint // the court zones it is about, painted on its clips
  weight?: number // its rank weighted by this too (POOR_WEIGHT: a choice after a poor reception)
  refs: PlayRef[] // the plays that show the habit, in the order played
  others: PlayRef[] // the rest of the situation's plays
}

// The zones a habit is about, on the half of the team that made the clip's play (own) or the other's.
export interface InsightPaint { zones: number[]; side: 'own' | 'other' }

interface Found { key: string; subject: string; person: string | null; kind: InsightKind; headline: (share: string) => string; detail: (n: number, hits: number, base: string) => string; mark: string; refs: PlayRef[]; others: PlayRef[]; base: number; low?: boolean; paint?: InsightPaint; weight?: number }
const make = (f: Found): Insight => {
  const n = f.refs.length + f.others.length, hits = f.refs.length, share = n ? hits / n : 0, p = binomTail(hits, n, f.base)
  return { key: f.key, subject: f.subject, person: f.person, kind: f.kind, headline: f.headline(pct(share)), detail: f.detail(n, hits, pct(f.base)), mark: f.mark, n, hits, share, base: f.base, z: zScore(hits, n, f.base), p, adjP: p, refs: f.refs, others: f.others, ...(f.low ? { low: true } : {}), ...(f.paint?.zones.length ? { paint: f.paint } : {}), ...(f.weight ? { weight: f.weight } : {}) }
}
const detailAll = (n: number, hits: number, base: string) => t('{0} 本中 {1} 本（チーム全体では {2}）', n, hits, base)

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

// The other way: each outcome of the base hardly ever seen in the situation (none at all too), with
// its share well below the base's. ok: an outcome that could have been (an attacker in the front row).
// The scenes are the situation's other plays.
function lows<K>(s: Tally, kind: InsightKind, ctx: PlayRef[], base: PlayRef[], outcome: (r: PlayRef) => K | null, ok: (k: K, known: PlayRef[]) => boolean, found: (k: K, refs: PlayRef[], elsewhere: PlayRef[], share0: number, one: PlayRef) => Found | null): Insight[] {
  const known = ctx.filter(r => outcome(r) !== null), baseKnown = base.filter(r => outcome(r) !== null)
  if (known.length < MIN_N || !baseKnown.length) return []
  const byK = groupBy(baseKnown, r => outcome(r)!)
  tally(s, kind, byK.size)
  const out: Insight[] = []
  for (const [k, theirs] of byK) {
    const refs = known.filter(r => outcome(r) === k), share0 = theirs.length / baseKnown.length
    if (!worth(refs.length, known.length, share0, false) || !ok(k, known)) continue
    const f = found(k, refs, known.filter(r => outcome(r) !== k), share0, theirs[0])
    if (!f) continue
    const n = known.length, hits = refs.length, share = hits / n, p = binomTail(hits, n, share0, false)
    out.push({ key: f.key, subject: f.subject, person: f.person, kind: f.kind, headline: f.headline(pct(share)), detail: f.detail(n, hits, pct(share0)), mark: f.mark, n, hits, share, base: share0, z: zScore(hits, n, share0), p, adjP: p, refs: f.refs, others: f.others, low: true, ...(f.paint?.zones.length ? { paint: f.paint } : {}), ...(f.weight ? { weight: f.weight } : {}) })
  }
  return out
}
// An attacker in the front row in nearly all of the situation's plays: one who could have been set.
const frontIn = (who: string, known: PlayRef[]) => {
  const key = who.split('|').slice(1).join('|'), told = known.filter(r => r.play.front)
  return told.length >= known.length * 0.8 && told.filter(r => r.play.front!.includes(key)).length >= told.length * 0.8
}

// Who the attacks go to: in each rotation's side-out, after a good and a poor reception, in
// transition and at the end of a close set, against the team's attacks of that phase.
function shareInsights(s: Tally, attacks: PlayRef[]): Insight[] {
  const so = attacks.filter(r => r.play.phase === 'r')
  const good = (r: PlayRef) => r.play.recEffect === '#' || r.play.recEffect === '+'
  const poor = (r: PlayRef) => isPoorPass(r.play.recEffect)
  // A rotation's habit as a whole shows only when its good receptions (#+) lean the same way: else
  // it is the poor ones, where the setter sets to whoever can be set.
  const goodIn = new Map([1, 6, 5, 4, 3, 2].map(rot => [`rot${rot}`, so.filter(r => rotationOf(r) === rot && good(r))]))
  const leans = (id: string, who: string, b: number, up: boolean) => {
    const g = goodIn.get(id)
    if (!g) return true
    if (g.length < MIN_N) return false
    const sh = g.filter(r => personOf(r) === who).length / g.length
    return up ? sh - b >= MIN_LIFT : b - sh >= MIN_LIFT
  }
  const situations: [string, string, PlayRef[], PlayRef[]][] = [
    ...[1, 6, 5, 4, 3, 2].map((rot): [string, string, PlayRef[], PlayRef[]] => [`rot${rot}`, t('ローテ {0} のサイドアウト', rot), so.filter(r => rotationOf(r) === rot), so]),
    ['good', t('良いレセプションからの攻撃'), so.filter(good), so],
    ['poor', t('悪いレセプションからの攻撃'), so.filter(poor), so],
    ['trans', t('トランジションの攻撃'), attacks.filter(r => r.play.phase === 't'), attacks],
    ['clutch', t('終盤の接戦の攻撃'), attacks.filter(r => isClutch(r.play)), attacks],
  ]
  const whole = situations.flatMap(([id, label, ctx, base]) => tendencies(s, 'share', ctx, base, personOf, (who, refs, others, b) => !leans(id, who, b, true) ? null : make({
    key: `share|${id}|${who}`, subject: `share|${id}`, person: who, kind: 'share', base: b, refs, others, mark: playerLabel(refs[0]), ...(id === 'poor' ? { weight: POOR_WEIGHT } : {}),
    headline: sh => t('{0}は {1} が {2}', label, playerLabel(refs[0]), sh), detail: detailAll,
  })))
  // Each rotation after a good (#+) and a poor (!-) reception, against the rotation's side-out as a
  // whole; kept only when past that reception's share over every rotation too (else the reception
  // says it all).
  const byPass = [1, 6, 5, 4, 3, 2].flatMap(rot => {
    const inRot = so.filter(r => rotationOf(r) === rot)
    return ([['good', '#+', good], ['poor', '!-', poor]] as const).flatMap(([id, grade, is]) => {
      const all = so.filter(is)
      return tendencies(s, 'share', inRot.filter(is), inRot, personOf, (who, refs, others, b) => {
        const share = refs.length / (refs.length + others.length)
        if (share - all.filter(r => personOf(r) === who).length / all.length < MIN_LIFT) return null
        return make({
          key: `share|rot${rot}${id}|${who}`, subject: `share|rot${rot}${id}`, person: who, kind: 'share', base: b, refs, others, mark: playerLabel(refs[0]), ...(id === 'poor' ? { weight: POOR_WEIGHT } : {}),
          headline: sh => t('ローテ {0}・レセプション {1} のサイドアウトは {2} が {3}', rot, grade, playerLabel(refs[0]), sh),
          detail: (n, hits, bs) => t('{0} 本中 {1} 本（ローテ {2} 全体では {3}）', n, hits, rot, bs),
        })
      })
    })
  })
  // And who they hardly go to, though in the front row; not by the pass alone (a poor pass takes the
  // quick away from every team).
  const wholeLow = situations.filter(([id]) => !['good', 'poor', 'trans'].includes(id)).flatMap(([id, label, ctx, base]) => lows(s, 'share', ctx, base, personOf, frontIn, (who, refs, elsewhere, b, one) => !leans(id, who, b, false) ? null : ({
    key: `share|${id}|${who}|low`, subject: `share|${id}|low`, person: who, kind: 'share', base: b, refs: elsewhere, others: refs, mark: t('{0} 以外', playerLabel(one)),
    headline: sh => t('{0}は {1} が {2}', label, playerLabel(one), sh), detail: detailAll,
  })))
  const byPassLow = [1, 6, 5, 4, 3, 2].flatMap(rot => {
    const inRot = so.filter(r => rotationOf(r) === rot)
    return ([['good', '#+', good], ['poor', '!-', poor]] as const).flatMap(([id, grade, is]) => {
      const all = so.filter(is)
      return lows(s, 'share', inRot.filter(is), inRot, personOf, frontIn, (who, refs, elsewhere, b, one) => {
        const share = refs.length / (refs.length + elsewhere.length)
        if (all.filter(r => personOf(r) === who).length / all.length - share < MIN_LIFT) return null
        return {
          key: `share|rot${rot}${id}|${who}|low`, subject: `share|rot${rot}${id}|low`, person: who, kind: 'share', base: b, refs: elsewhere, others: refs, mark: t('{0} 以外', playerLabel(one)), ...(id === 'poor' ? { weight: POOR_WEIGHT } : {}),
          headline: sh => t('ローテ {0}・レセプション {1} のサイドアウトは {2} が {3}', rot, grade, playerLabel(one), sh),
          detail: (n, hits, bs) => t('{0} 本中 {1} 本（ローテ {2} 全体では {3}）', n, hits, rot, bs),
        }
      })
    })
  })
  return [...whole, ...byPass, ...wholeLow, ...byPassLow]
}

// Where an attacker hits from each zone, against the team's attacks from that zone.
function zoneInsights(s: Tally, attacks: PlayRef[]): Insight[] {
  const from = groupBy(attacks, r => r.play.startZone)
  return [...from].flatMap(([zone, base]) => [...groupBy(base, personOf)].flatMap(([who, ctx]) =>
    tendencies(s, 'zone', ctx, base, r => r.play.endZone, (end, refs, others, b) => make({
      key: `zone|${who}|${zone}|${end}`, subject: `zone|${who}|${zone}`, person: who, kind: 'zone', base: b, refs, others, mark: `Zone${end}`, paint: { zones: [end], side: 'other' },
      headline: sh => t('{0} の Zone{1} からのアタックは Zone{2} へ {3}', playerLabel(refs[0]), zone, end, sh), detail: detailAll,
    })).concat(lows(s, 'zone', ctx, base, r => r.play.endZone, () => true, (end, refs, elsewhere, b) => ({
      key: `zone|${who}|${zone}|${end}|low`, subject: `zone|${who}|${zone}|low`, person: who, kind: 'zone', base: b, refs: elsewhere, others: refs, mark: t('{0} 以外', `Zone${end}`), paint: { zones: [end], side: 'other' },
      headline: sh => t('{0} の Zone{1} からのアタックは Zone{2} へ {3}', playerLabel(ctx[0]), zone, end, sh), detail: detailAll,
    })))))
}


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
      key: `serveZone|${who}|${z}`, subject: `serveZone|${who}`, person: who, kind: 'serveZone', base: b, refs, others, mark: SERVE_ZONE()[z], paint: { zones: SERVE_ZONES[z], side: 'other' },
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
      key: `rotWeak|${rot}`, subject: `rotWeak|${rot}`, person: null, kind: 'rotWeak', base: b, low: true, refs, others: ctx.filter(r => !lost(r)), mark: t('失点'),
      headline: () => t('ローテ {0} のサイドアウト率 {1}（全体 {2}）', rot, pct(1 - refs.length / ctx.length), pct(1 - b)),
      detail: (n, hits) => t('{0} 回のレセプションのうち {1} 回は点を取られた', n, hits),
    })]
  })
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
      z: zScore(breaks.length, ctx.length, b), p, adjP: p, refs: up ? breaks : lost, others: up ? lost : breaks, ...(up ? {} : { low: true }),
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
// How far a receiver's side-out rate is from what their servers would give, to be told: less than
// elsewhere, since the set and the attack come after the reception and even out the gap.
const RECEIVER_LIFT = 0.08
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
    const share = ok.length / ctx.length, base = expect / ctx.length, up = share - base >= RECEIVER_LIFT
    if (!up && share - base > -RECEIVER_LIFT) return []
    const z = spread ? (ok.length - expect) / spread : 0
    const p = normalTail(z)
    return [{
      key: `receiverSO|${who}|${up ? 'up' : 'down'}`, subject: `receiverSO|${who}`, person: who, kind: 'receiverSO', n: ctx.length, hits: up ? ok.length : lost.length, share, base,
      z, p, adjP: p, refs: up ? ok : lost, others: up ? lost : ok, ...(up ? {} : { low: true }),
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
      z: zScore(kills.length, ctx.length, b), p, adjP: p, refs: up ? kills : missed, others: up ? missed : kills, ...(up ? {} : { low: true }),
      mark: up ? t('決まったアタック') : t('決まらなかったアタック'),
      headline: up ? t('{0} は終盤の接戦で決定率 {1}', playerLabel(all[0]), pct(share)) : t('{0} は終盤の接戦で決定率が {1} に落ちる', playerLabel(all[0]), pct(share)),
      detail: t('{0} 本中 {1} 本が決まった（ふだんは {2}）', ctx.length, kills.length, pct(b)),
    }]
  })
}

// The skill a kind of habit is about: sets, attacks, serves or receptions.
export type InsightSkill = 'E' | 'A' | 'B' | 'S' | 'R'
export const INSIGHT_SKILLS: InsightSkill[] = ['E', 'A', 'B', 'S', 'R']
export const KIND_SKILL: Record<InsightKind, InsightSkill> = {
  share: 'A', setDist: 'E', setFollow: 'E', zone: 'A', zoneBy: 'A', killRate: 'A', blocked: 'A', clutch: 'A', rallyLong: 'A', blockFront: 'B',
  serveZone: 'S', serveCourse: 'S', serveTarget: 'S', serveErr: 'S', serveType: 'S', serveEffect: 'S', serverBreak: 'S', rallyServe: 'S',
  receiverSO: 'R', recZone: 'R', soGrade: 'R', recWeak: 'R', rotWeak: 'R', rallyRec: 'R',
}

// What to look at: habits of these skills only, about these players only (personOf keys; a
// rotation's habit is about no player, so it goes). Empty: all.
export interface InsightFocus { skills: InsightSkill[]; persons: string[] }
export const NO_FOCUS: InsightFocus = { skills: [], persons: [] }
export const inFocus = (i: Insight, f: InsightFocus): boolean =>
  (!f.skills.length || f.skills.includes(KIND_SKILL[i.kind])) && (!f.persons.length || (i.person !== null && f.persons.includes(i.person)))

// How much a kind of habit counts when they are ranked, by how much of a choice it shows. A choice
// someone makes (where a setter sets, and after what; where an attacker hits; which serve a server
// picks) is what a scouting video is for, so it comes first. The rest (how well someone does, how
// rallies go) comes after. Where a serve lands, or whom it finds, is more the server's reach and the
// other team's lineup than a choice: LAST_KINDS come after every other habit, however sure.
export const KIND_WEIGHT: Partial<Record<InsightKind, number>> = { setDist: 1.5, setFollow: 1.5, share: 1.5, zone: 1.5, zoneBy: 1.5, serveType: 1.5 }
export const LAST_KINDS: InsightKind[] = ['serveZone', 'serveCourse', 'serveTarget']
// How sure a habit is all told: how unlikely it is, as a power of ten (2: one in a hundred).
export const sureOf = (i: Pick<Insight, 'adjP'>): number => -Math.log10(Math.max(i.adjP, 1e-12))
// A habit's place in the list: how sure it is, weighted by its kind.
export const rankOf = (i: Pick<Insight, 'kind' | 'adjP' | 'weight'>): number => sureOf(i) * (KIND_WEIGHT[i.kind] ?? 1) * (i.weight ?? 1)

// The team's habits in focus, the surest first (by rankOf, then by their own p), LAST_KINDS after the rest. A habit of the same
// player or rotation and kind shows once (the surest in focus), and at most `max` are kept.
// look: who won each rally, or with it the matches' order and the timeouts (InsightLookups).
export function findInsights(scope: PlayRef[], team: 'our' | 'opp', look: WonBy | InsightLookups, max = 20, focus: InsightFocus = NO_FOCUS): Insight[] {
  const L: InsightLookups = typeof look === 'function' ? { wonBy: look } : look, wonBy = L.wonBy
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
    ...shareInsights(s, attacks), ...situationInsights(s, scope, team, L), ...zoneInsights(s, attacks), ...serveInsights(s, serves, receiverOf),
    ...breakInsights(s, serves, wonBy), ...sideOutInsights(s, receptions, serverOf, wonBy),
    ...receptionInsights(s, receptions), ...rotationInsights(s, receptions, wonBy), ...clutchInsights(s, attacks),
  ].map(i => ({ ...i, adjP: 1 }))
  // Benjamini–Hochberg in each kind: the situations it looked at and didn't find worth testing count
  // as p = 1, behind every habit found. A habit's adjP is the smallest share of luck a list down to it
  // would hold: it orders the list and says how sure each is; one past MAX_P on its own stays in.
  for (const kind of INSIGHT_KINDS) {
    const list = all.filter(i => i.kind === kind).sort((a, b) => a.p - b.p), m = Math.max(s[kind] ?? 1, list.length)
    let least = 1
    for (let j = list.length - 1; j >= 0; j--) { least = Math.min(least, (list[j].p * m) / (j + 1)); list[j].adjP = least }
  }
  const kept = all.filter(i => (i.adjP <= ALPHA || i.p <= (i.maxP ?? MAX_P)) && inFocus(i, focus)).sort((a, b) => +LAST_KINDS.includes(a.kind) - +LAST_KINDS.includes(b.kind) || rankOf(b) - rankOf(a) || a.p - b.p)
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
// numbers under it. Marker 1 holds the plays that show the habit; with `withOthers`, marker 2 the
// situation's other plays, to see what the habit is against. Whatever the search's order, `order`
// lays them out: the newest match first or the oldest (each match's plays in the order played;
// `limit` keeps the latest plays or the earliest), or at random, taken from the matches in turn so a
// scene doesn't stand for one match's habit (`limit` then keeps as many from each match as it can).
// matchIndex: a match's place, oldest first (PresetLookups); without it, the plays' order stands for it.
export type InsightOrder = 'new' | 'old' | 'random'
export const INSIGHT_ORDERS: InsightOrder[] = ['random', 'new', 'old']
// lang: the language of the scenes' headlines, title cards and markers (missing: the interface's).
export interface InsightReelOptions { mode: ClipMode; limit: number | null; withOthers: boolean; prefix: string; order: InsightOrder; lang?: Lang }
// How the scenes look: the habit as every clip's headline (in the project's look for headlines), and
// the zones it is about painted on each clip whose match has its court fitted (red: more than usual,
// blue: less).
export interface InsightDress { headline?: HeadlineStyle; courtOf?: (matchId: string) => CourtFit | undefined }
export const PAINT_UP = '#DC2626', PAINT_DOWN = '#2563EB', PAINT_OPACITY = 0.35
const HEADLINE_ROOM = 1200 // px at 720p the headline may take across

// The headline object: one centered text at the top middle, as the headline field makes it, its size
// brought down until it fits across.
export function insightHeadline(i: Insight, h: HeadlineStyle = {}): Annotation {
  const text = `${i.low ? '↓' : '↑'} ${i.headline}`
  const wide = [...text].reduce((w, ch) => w + (/[ -~]/.test(ch) ? 0.6 : 1), 0)
  const size = Math.max(20, Math.min(h.size ?? HEADLINE_SIZE, Math.floor(HEADLINE_ROOM / wide)))
  return {
    id: globalThis.crypto.randomUUID(), kind: 'text', color: h.color ?? '#FFFFFF', x: 0.5, y: 0.05, text, size, align: 'center', quick: true,
    ...(h.bold !== undefined ? { bold: h.bold } : {}), ...(h.outline !== undefined ? { outline: h.outline } : {}), ...(h.font ? { font: h.font } : {}),
    box: { ...DEFAULT_TEXT_BOX, ...(h.box ? { fill: h.box } : {}) },
  }
}

// The habit's zones on one clip's court: on the half of the clip's team (own) or the other's, which
// of the two is near the camera following the set and the score. One object, however many zones.
export function insightPaint(i: Insight, ref: PlayRef, fit: CourtFit | undefined): Annotation[] {
  if (!i.paint || !fit || ref.side === null) return []
  const side = i.paint.side === 'own' ? ref.side : ref.side === '*' ? 'a' : '*'
  const near = nearSide(fit, ref.play) === side, color = i.low ? PAINT_DOWN : PAINT_UP, group = globalThis.crypto.randomUUID()
  return i.paint.zones.flatMap(z => {
    const c = zoneCell(z, near)
    if (!c) return []
    const cell = { ...c, div: 3 as const }
    return [{ id: globalThis.crypto.randomUUID(), kind: 'polygon', color, width: 0, points: zoneCellQuad(fit.corners, cell), fill: color, fillOpacity: PAINT_OPACITY, cell, groupId: group } as Annotation]
  })
}

export function insightReels(list: Insight[], o: InsightReelOptions, matchIndex?: (matchId: string) => number, rand: () => number = Math.random, dress: InsightDress = {}): Reel[] {
  const shuffle = <T,>(xs: T[]): T[] => {
    const a = [...xs]
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    return a
  }
  const take = (refs: PlayRef[]) => {
    if (o.order === 'random') {
      // Each match's plays shuffled, the matches in a shuffled turn: one from each, then again.
      const piles = shuffle([...groupBy(refs, r => r.matchId).values()].map(shuffle)), out: PlayRef[] = []
      for (let k = 0; out.length < refs.length; k++) for (const p of piles) if (k < p.length) out.push(p[k])
      return o.limit ? out.slice(0, o.limit) : out
    }
    const shown = orderByMatch(refs, o.order, matchIndex)
    if (!o.limit || refs.length <= o.limit) return shown
    const latest = new Set(orderByMatch(o.order === 'new' ? [...refs].reverse() : refs, o.order, matchIndex).slice(0, o.limit))
    return shown.filter(r => latest.has(r))
  }
  return list.map(i => {
    let r: Reel = { ...newReel(o.prefix ? `${o.prefix} ${i.headline}` : i.headline), scope: 'all', sceneCard: true, cardTitle: `${i.headline}\n${i.detail}`, annotations: [insightHeadline(i, dress.headline)] }
    r = { ...r, markerNames: { ...r.markerNames, 1: i.mark, ...(o.withOthers ? { 2: t('それ以外') } : {}) } }
    const groups: [Marker, PlayRef[]][] = [[MARKERS[0], take(i.refs)], ...(o.withOthers ? [[MARKERS[1], take(i.others)] as [Marker, PlayRef[]]] : [])]
    for (const [m, refs] of groups) {
      if (!refs.length) continue
      const added = addClips(r, refs.map(x => ({ matchId: x.matchId, play: x.play })), m, o.mode)
      const clips = { ...added.reel.clips }
      added.ids.forEach((id, k) => {
        const paint = insightPaint(i, refs[k], dress.courtOf?.(refs[k].matchId))
        if (paint.length) clips[id] = { ...clips[id], annotations: [...paint, ...clips[id].annotations] }
      })
      r = { ...added.reel, clips }
    }
    return r
  })
}

// What an insight video was made from, kept on the video (Video.insight) so it can be made again,
// for example after matches are added: the team, the habits picked by subject (so a rotation whose
// sets now go to another player is still in it), and how the scenes were cut.
// The focus is kept too, so a rotation's habit made for one player stays about that player.
// league: the habits were set beside the league (made again, they are too, once it is loaded).
export interface VideoInsight extends InsightReelOptions { team: 'our' | 'opp'; subjects: string[]; focus: InsightFocus; league?: boolean }

export const videoInsight = (team: 'our' | 'opp', list: Insight[], o: InsightReelOptions, focus: InsightFocus = NO_FOCUS, league = false): VideoInsight =>
  ({ ...(league ? { league } : {}), team, subjects: list.map(i => i.subject), focus: { skills: [...focus.skills], persons: [...focus.persons] }, mode: o.mode, limit: o.limit, withOthers: o.withOthers, prefix: o.prefix, order: o.order, ...(o.lang ? { lang: o.lang } : {}) })

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
    order: INSIGHT_ORDERS.includes(o.order as InsightOrder) ? o.order as InsightOrder : 'random',
    ...(o.league === true ? { league: true } : {}),
    ...(isLang(o.lang) ? { lang: o.lang } : {}),
  }
}

// The habits of a video found again in these plays, in the video's order: each subject's surest
// habit now (its outcome may have changed). `gone`: the subjects with no clear habit any more.
export function refindInsights(scope: PlayRef[], vi: VideoInsight, look: WonBy | InsightLookups): { insights: Insight[]; gone: number } {
  const now = new Map(findInsights(scope, vi.team, look, Infinity, vi.focus).map(i => [i.subject, i]))
  const insights = vi.subjects.map(s => now.get(s)).filter((i): i is Insight => !!i)
  return { insights, gone: vi.subjects.length - insights.length }
}

export const insightKindName = (k: InsightKind): string => ({
  share: t('アタッカー'), setDist: t('セット配分'), setFollow: t('セットの反応'), zone: t('コース'), zoneBy: t('コース'), killRate: t('決定率'), blocked: t('被ブロック'),
  blockFront: t('ブロック'), serveZone: t('サーブコース'), serveCourse: t('サーブコース'), serveTarget: t('サーブの狙い'), serveErr: t('サーブミス'), serveType: t('サーブの種類'),
  serveEffect: t('サーブの効果'), serverBreak: t('ブレイク'), receiverSO: t('サイドアウト'), recZone: t('レセプション'), soGrade: t('サイドアウト'), clutch: t('勝負所'),
  recWeak: t('レセプション'), rotWeak: t('ローテーション'), rallyServe: t('ラリーの流れ'), rallyRec: t('ラリーの流れ'), rallyLong: t('ラリーの流れ'),
})[k]
