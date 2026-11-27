// Insights by situation (insights.ts): what someone (a setter, an attacker, a server, a receiver, a
// rotation, the team) does in a situation against what they do otherwise. A situation is one or two
// conditions of a play: its rotation, the setter's row or the other setter's, the pass it came from,
// the score, the stage of the set, the first set or the others, the recent matches or the earlier
// ones, what came just before (the last attack, the last serve, a timeout, points in a row), the
// front row. A condition of two sides (front or back row, recent or earlier…) is set against its
// other side; the others against all the plays of the one it is about, and a pair only when it
// says more than each of its parts alone. Pure, so it is unit-tested (insights.test.ts).
import type { PlayRef } from './filter'
import type { Insight, InsightKind, InsightPaint } from './insights'
import { personOf, playerLabel, rotationOf, type WonBy } from './rotationSplit'
import { serveZoneMarker } from './presets'
import { attackOfContact, setTarget, setTargetName, setterCall, type SetTarget } from './setChart'
import type { Side } from './types'
import { t } from './i18n'
import { LEAGUE_LIFT, MIN_HITS, MIN_LIFT, MIN_N, SERVE_ZONE, SERVE_ZONES, TARGET_ZONES, POOR_WEIGHT, isPoorPass, binomTail, groupBy, isClutch, pct, rallyKey, serveKind, tally, twoShares, worth, zScore, type Tally } from './insightStats'

// What insights look up beyond the plays: who won a rally, the matches' order (oldest first), the
// timeouts. presets.ts PresetLookups has them all.
export interface InsightLookups { wonBy: WonBy; matchIndex?: (matchId: string) => number; timeoutBy?: (r: PlayRef) => Side | null; league?: League | null }

// A play as a case: what came of it (its outcome) and the situation it was in (dims; null: not known).
export interface Case { ref: PlayRef; out: string; dims: Record<string, string | null> }

// One search: someone's cases, the situations to look at (each one or two dims), how they read.
interface Spec {
  kind: InsightKind
  subject: string // its subject is this and the situation
  person: string | null
  who: string // who it is about, as the headline begins
  cases: Case[]
  combos: string[][]
  twoSided: string[] // dims of two values: each set against the other
  label: (dim: string, value: string) => string // a condition, as "…のとき" takes it
  phrase: (out: string, share: number) => string | null // the outcome and its share; null: not looked for
  mark: (out: string) => string
  yes?: string // a yes-or-no outcome: the numbers count this one (a kill), whichever way the habit goes
  family?: string | null // the same search on the league's teams (familyOf)
  low?: boolean // a search of choices: the choices hardly made in a situation too (lowOf)
  paint?: (out: string, dims: [string, string][]) => InsightPaint | null // the zones a habit is about
  maxP?: number // kept by its own chance by luck alone up to this, however many were looked at (MAX_P)
}

// A serve to a zone, as a condition (a short serve has its own name).
const serveTo = (m: number): string => (m === 4 ? t('ショートサーブ') : t('{0} へのサーブ', SERVE_ZONE()[m]))

// The side a two-sided condition tells its yes-or-no habit from (the other side is in brackets).
const TELL: Record<string, string> = { x: 'in', row: 'front', oppRow: 'front', z1: 'in', z2: 'in', z3: 'in', z4: 'in' }
// A server's break rate by zone, a habit a coach can use at once: kept on less (and shown as the
// weakest).
const ZONE_BREAK_P = 0.1

// The habits of one search.
// With the league, a habit is the share against what the league's shift in the same situation leads
// one to expect (its base moved as the league's teams move), and must be LEAGUE_LIFT past it.
function search(s: Tally, x: Spec, league?: League | null): Insight[] {
  const out: Insight[] = [], all = x.cases
  if (all.length < MIN_N) return out
  const outs = x.yes ? [x.yes, `!${x.yes}`] : [...new Set(all.map(c => c.out))]
  const is = (c: Case, o: string) => (x.yes ? (o === x.yes) === (c.out === x.yes) : c.out === o)
  const shareOf = (cs: Case[], o: string) => cs.filter(c => is(c, o)).length / cs.length
  const where = (cs: Case[], dims: [string, string][]) => cs.filter(c => dims.every(([d, v]) => c.dims[d] === v))
  for (const combo of x.combos) {
    for (const [key, ctx] of groupBy(all, c => (combo.some(d => c.dims[d] === null || c.dims[d] === undefined) ? null : combo.map(d => `${d}=${c.dims[d]}`).join('&')))) {
      if (ctx.length < MIN_N) continue
      const dims = combo.map((d): [string, string] => [d, ctx[0].dims[d]!])
      const two = combo.length === 1 && x.twoSided.includes(combo[0])
      const other = two ? all.filter(c => c.dims[combo[0]] != null && c.dims[combo[0]] !== dims[0][1]) : null
      if (other && other.length < MIN_N) continue
      // A yes-or-no habit of two sides is told from the side where someone does something: a blocker
      // or a setter in the front row, not out of it.
      if (other && x.yes && TELL[combo[0]] && dims[0][1] !== TELL[combo[0]]) continue
      const looked = outs.filter(o => ctx.some(c => is(c, o)))
      tally(s, x.kind, looked.length)
      for (const o of looked) {
        const refs = ctx.filter(c => is(c, o)), share = refs.length / ctx.length
        const phrase = x.phrase(o, share)
        if (!phrase) continue
        const lg = league && x.family ? league.shift.get(`${x.family}|${key}|${o}`) : undefined
        let base: number, z: number, p: number, h2 = 0
        if (other) {
          h2 = other.filter(c => is(c, o)).length
          base = h2 / other.length
          if (refs.length < MIN_HITS || share - base < MIN_LIFT) continue
          if (lg && share - base - lg.d < LEAGUE_LIFT) continue
          ;({ z, p } = twoShares(refs.length, ctx.length, h2, other.length, lg?.d ?? 0))
        } else {
          base = shareOf(all, o)
          if (!worth(refs.length, ctx.length, base)) continue
          if (dims.length > 1 && dims.some(part => share - shareOf(where(all, [part]), o) < MIN_LIFT)) continue
          const expect = lg ? Math.min(0.99, Math.max(0.01, base + lg.d)) : base
          if (lg && share - expect < LEAGUE_LIFT) continue
          z = zScore(refs.length, ctx.length, expect); p = binomTail(refs.length, ctx.length, expect)
        }
        // The numbers count the yes outcome, whichever way the habit goes.
        const flip = !!x.yes && o !== x.yes
        const n = ctx.length, hits = flip ? n - refs.length : refs.length, b = flip ? 1 - base : base
        const cond = dims.map(([d, v]) => x.label(d, v)).join('・')
        const otherCount = other ? (flip ? other.length - h2 : h2) : 0, ld = lg ? (flip ? -lg.d : lg.d) : 0
        const pts = t('{0} ポイント', `${ld >= 0 ? '+' : '−'}${Math.round(Math.abs(ld) * 100)}`)
        const detail = other
          ? lg ? t('{0} 本中 {1} 本（{2}のときは {3}・{4} 本中 {5} 本。リーグでは差が {6}）', n, hits, x.label(combo[0], other[0].dims[combo[0]]!), pct(b), other.length, otherCount, pts)
            : t('{0} 本中 {1} 本（{2}のときは {3}・{4} 本中 {5} 本）', n, hits, x.label(combo[0], other[0].dims[combo[0]]!), pct(b), other.length, otherCount)
          : lg ? t('{0} 本中 {1} 本（ふだんは {2}。リーグでは同じ場面で {3}）', n, hits, pct(b), pts)
            : t('{0} 本中 {1} 本（ふだんは {2}）', n, hits, pct(b))
        // A yes-or-no outcome against a condition of two sides is one habit whichever side tells it
        // (a kill rate of 76% in front, 46% at the back).
        out.push({
          key: `${x.subject}|${key}|${o}`, subject: other && x.yes ? `${x.subject}|${combo[0]}` : `${x.subject}|${key}`, person: x.person, kind: x.kind,
          // A name in letters takes a space before は; Japanese runs on (#8 NAKASHIMA は / 長いラリーは).
          headline: t('{0}は{1}のとき {2}', /[!-~）)]$/.test(x.who) ? `${x.who} ` : x.who, cond, phrase), detail, mark: x.mark(o),
          n, hits: refs.length, share, base, z, p, adjP: p, refs: refs.map(c => c.ref), others: ctx.filter(c => !is(c, o)).map(c => c.ref),
          ...(lg ? { league: lg.d } : {}), ...(x.maxP ? { maxP: x.maxP } : {}), ...(flip ? { low: true } : {}), ...paintOf(x, o, dims), ...poorOf(x, dims),
        })
      }
      // Not by the pass alone (a poor pass takes the quick away from every setter) nor by the call (a
      // call names where the set goes).
      if (x.low && !x.yes && !other && !combo.includes('call') && !(combo.length === 1 && combo[0] === 'pass')) out.push(...lowOf(s, x, key, ctx, dims, all, league))
    }
  }
  return out
}

// The choices a search of choices (low) hardly ever makes in a situation, set against how often it
// makes them as a whole: a place a setter all but stops setting to (none at all too). The scenes are
// the plays that went elsewhere. Not for a situation of two sides: its low side is the other's high.
function lowOf(s: Tally, x: Spec, key: string, ctx: Case[], dims: [string, string][], all: Case[], league?: League | null): Insight[] {
  const out: Insight[] = []
  const shareOf = (cs: Case[], o: string) => cs.filter(c => c.out === o).length / cs.length
  const outs = [...new Set(all.map(c => c.out))]
  tally(s, x.kind, outs.length)
  for (const o of outs) {
    const refs = ctx.filter(c => c.out === o), share = refs.length / ctx.length, base = shareOf(all, o)
    if (!worth(refs.length, ctx.length, base, false)) continue
    if (dims.length > 1 && dims.some(part => shareOf(all.filter(c => c.dims[part[0]] === part[1]), o) - share < MIN_LIFT)) continue
    const lg = league && x.family ? league.shift.get(`${x.family}|${key}|${o}`) : undefined
    const expect = lg ? Math.min(0.99, Math.max(0.01, base + lg.d)) : base
    if (lg && expect - share < LEAGUE_LIFT) continue
    const phrase = x.phrase(o, share)
    if (!phrase) continue
    const n = ctx.length, p = binomTail(refs.length, n, expect, false)
    const pts = lg ? t('{0} ポイント', `${lg.d >= 0 ? '+' : '−'}${Math.round(Math.abs(lg.d) * 100)}`) : ''
    out.push({
      key: `${x.subject}|${key}|${o}|low`, subject: `${x.subject}|${key}|low`, person: x.person, kind: x.kind,
      headline: t('{0}は{1}のとき {2}', /[!-~）)]$/.test(x.who) ? `${x.who} ` : x.who, dims.map(([d, v]) => x.label(d, v)).join('・'), phrase),
      detail: lg ? t('{0} 本中 {1} 本（ふだんは {2}。リーグでは同じ場面で {3}）', n, refs.length, pct(base), pts) : t('{0} 本中 {1} 本（ふだんは {2}）', n, refs.length, pct(base)),
      mark: t('{0} 以外', x.mark(o)),
      n, hits: refs.length, share, base, z: zScore(refs.length, n, expect), p, adjP: p,
      refs: ctx.filter(c => c.out !== o).map(c => c.ref), others: refs.map(c => c.ref),
      ...(lg ? { league: lg.d } : {}), low: true, ...paintOf(x, o, dims), ...poorOf(x, dims),
    })
  }
  return out
}
// A setter's choice after a poor reception counts less (POOR_WEIGHT).
const poorOf = (x: Spec, dims: [string, string][]): { weight?: number } =>
  x.kind === 'setDist' && dims.some(([d, v]) => d === 'pass' && isPoorPass(v)) ? { weight: POOR_WEIGHT } : {}
const paintOf = (x: Spec, o: string, dims: [string, string][]): { paint?: InsightPaint } => {
  const p = x.paint?.(o, dims)
  return p?.zones.length ? { paint: p } : {}
}

// What the searches share: the team's plays by match, the rallies in order, who is who, the recent
// matches.
interface Ctx {
  team: 'our' | 'opp'
  look: InsightLookups
  byMatch: Map<string, PlayRef[]> // each match's plays in the order played
  mine: (r: PlayRef) => boolean
  labelOf: (key: string) => string // a player key as scenes name the player
  recentOf: (matchId: string) => string | null // 'recent' or 'earlier'; null: too few matches to tell
  recent: number // how many matches are the recent ones
}

function context(scope: PlayRef[], team: 'our' | 'opp', look: InsightLookups): Ctx {
  const byMatch = groupBy(scope, r => r.matchId)
  const labels = new Map<string, string>()
  for (const r of scope) if (!labels.has(r.personKey)) labels.set(r.personKey, playerLabel(r))
  // The newest third of the matches (at least one) against the rest, when there are three or more.
  const ids = [...byMatch.keys()], recent = look.matchIndex && ids.length >= 3 ? Math.max(1, Math.round(ids.length / 3)) : 0
  const newest = new Set(recent ? [...ids].sort((a, b) => look.matchIndex!(b) - look.matchIndex!(a)).slice(0, recent) : [])
  return {
    team, look, byMatch, recent,
    mine: r => r.teamRole === team,
    labelOf: k => labels.get(k) ?? k,
    recentOf: id => (recent ? (newest.has(id) ? 'recent' : 'earlier') : null),
  }
}

const PASSES = ['#', '+', '!', '-']
const rowOf = (rot: number | null): string | null => (rot === null ? null : rot >= 2 && rot <= 4 ? 'front' : 'back')
const otherRotationOf = (r: PlayRef): number | null => (r.teamRole === 'opp' ? r.ourRot : r.oppRot)
// The team's score and the other's at the play.
const scoreOf = (r: PlayRef): [number, number] | null => (r.play.side === '*' ? [r.play.score.home, r.play.score.away] : r.play.side === 'a' ? [r.play.score.away, r.play.score.home] : null)
// A play that came of a free (or chance) ball: the team's freeball contact before it in the rally.
const fromFree = (r: PlayRef): boolean => r.play.before.some(c => c[0] === r.play.side && c[3] === 'F')

// The conditions every play has: the rotation and rows, the pass it came from, the score, the
// stage of the set, the first set or not, recent or not.
function common(r: PlayRef, c: Ctx): Record<string, string | null> {
  const rot = rotationOf(r), sc = scoreOf(r)
  const diff = sc ? sc[0] - sc[1] : null, end = r.play.setNum === 5 ? 15 : 25
  return {
    rot: rot === null ? null : String(rot), row: rowOf(rot), oppRow: rowOf(otherRotationOf(r)),
    pass: r.play.phase === 't' ? (fromFree(r) ? 'f' : 't') : r.play.phase === 'r' && PASSES.includes(r.play.recEffect ?? '') ? r.play.recEffect! : null,
    late: isClutch(r.play) ? 'late' : null,
    margin: diff === null ? null : diff >= 2 ? 'ahead' : diff <= -2 ? 'behind' : 'level',
    stage: sc ? (sc[0] / end < 0.4 ? 'early' : sc[0] / end < 0.8 ? 'mid' : 'end') : null,
    set1: r.play.setNum === 1 ? 'first' : 'later',
    recent: c.recentOf(r.matchId),
  }
}

// How the common conditions read.
function commonLabel(c: Ctx) {
  return (d: string, v: string): string => {
    switch (d) {
      case 'rot': return t('ローテ {0}', v)
      case 'row': return v === 'front' ? t('自分が前衛') : t('自分が後衛')
      case 'oppRow': return v === 'front' ? t('相手セッターが前衛') : t('相手セッターが後衛')
      case 'pass': return v === 't' ? t('トランジション') : v === 'f' ? t('チャンスボール') : t('レセプション「{0}」', v)
      case 'call': return t('コール {0}', v)
      case 'late': return t('終盤の接戦')
      case 'margin': return v === 'ahead' ? t('2点以上リード') : v === 'behind' ? t('2点以上ビハインド') : t('1点差以内')
      case 'stage': return v === 'early' ? t('セットの序盤') : v === 'mid' ? t('セットの中盤') : t('セットの終盤')
      case 'set1': return v === 'first' ? t('1セット目') : t('2セット目以降')
      case 'recent': return v === 'recent' ? t('直近 {0} 試合', c.recent) : t('それより前の試合')
      default: return v
    }
  }
}

// The rallies of each match in order, as the team saw them: who served, who won, the team's
// reception, the attacks in it.
interface RallyRow { key: string; setNum: number; serve: PlayRef; rec: PlayRef | null; won: boolean | null; attacks: number }
function rallies(c: Ctx): RallyRow[][] {
  return [...c.byMatch.values()].map(refs => {
    const rows: RallyRow[] = []
    for (const [key, rs] of groupBy(refs, rallyKey)) {
      const serve = rs.find(r => r.play.skill === 'S')
      if (!serve || serve.side === null) continue
      const w = c.look.wonBy(serve), mySide = c.mine(serve) ? serve.side : serve.side === '*' ? 'a' : '*'
      rows.push({ key, setNum: serve.play.setNum, serve, rec: rs.find(r => r.play.skill === 'R' && c.mine(r)) ?? null, won: w === null ? null : w === mySide, attacks: rs.filter(r => r.play.skill === 'A').length })
    }
    return rows
  })
}

// Where a setter sets (setDist) and whether they go back to the attacker of the last attack
// (setFollow), from every set and dump of the team's setters (players who set).
function setterSpecs(c: Ctx): Spec[] {
  const label = commonLabel(c), out: Spec[] = []
  const setters = new Set<string>(), teamKeys = new Set<string>()
  for (const refs of c.byMatch.values()) for (const r of refs) if (c.mine(r)) { teamKeys.add(r.personKey); if (r.play.skill === 'E') setters.add(personOf(r)) }
  const sets = new Map<string, Case[]>(), follow = new Map<string, Case[]>()
  for (const refs of c.byMatch.values()) {
    const plays = refs.map(r => r.play), byPlay = new Map(refs.map(r => [r.play, r]))
    let last: { who: string; result: string; set: number } | null = null
    refs.forEach((r, i) => {
      if (!c.mine(r)) return
      if (r.play.skill === 'A') last = { who: personOf(r), result: r.play.effect === '#' ? 'kill' : r.play.effect === '/' || r.play.effect === '=' ? 'miss' : 'play', set: r.play.setNum }
      if (!setters.has(personOf(r)) || (r.play.skill !== 'E' && r.play.skill !== 'A')) return
      const attack = attackOfContact(plays, i)
      const target = attack && setTarget(attack, r.play.playerKey, r.play)
      if (!attack || !target) return
      const setter = personOf(r), front = (r.play.front ?? []).filter(k => k !== r.play.playerKey && teamKeys.has(k))
      const dims = { ...common(r, c), call: r.play.skill === 'E' ? setterCall(r.play) || null : null, front: front.length ? front.map(c.labelOf).sort().join('・') : null }
      sets.set(setter, [...(sets.get(setter) ?? []), { ref: r, out: target, dims }])
      // The last attack before this set, in the set: did the set go back to its attacker?
      const before: { who: string; result: string; set: number } | null = r.play.skill === 'A' ? null : last
      const to = byPlay.get(attack)
      if (before && before.set === r.play.setNum && to) {
        const k = `${setter}>${before.who}`
        follow.set(k, [...(follow.get(k) ?? []), { ref: r, out: personOf(to) === before.who ? 'yes' : 'no', dims: { after: before.result } }])
      }
    })
  }
  for (const [setter, cases] of sets) {
    out.push({
      kind: 'setDist', subject: `setDist|${setter}`, person: setter, low: true, who: c.labelOf(setter.split('|').slice(1).join('|')), cases,
      combos: [['rot'], ['row'], ['oppRow'], ['pass'], ['call'], ['late'], ['margin'], ['stage'], ['set1'], ['front'], ['recent'],
        ['rot', 'pass'], ['rot', 'call'], ['rot', 'late'], ['rot', 'oppRow'], ['row', 'pass'], ['row', 'oppRow'], ['oppRow', 'pass']],
      twoSided: ['row', 'oppRow', 'set1', 'recent'],
      label: (d, v) => (d === 'front' ? t('前衛が {0}', v) : label(d, v)),
      phrase: (o, sh) => t('{0} へ {1}', setTargetName(o as SetTarget), pct(sh)), mark: o => setTargetName(o as SetTarget),
      paint: o => ({ zones: TARGET_ZONES[o] ?? [], side: 'own' }),
    })
  }
  for (const [k, cases] of follow) {
    const [setter, attacker] = k.split('>'), name = c.labelOf(attacker.split('|').slice(1).join('|'))
    out.push({
      kind: 'setFollow', subject: `setFollow|${k}`, person: setter, who: c.labelOf(setter.split('|').slice(1).join('|')), cases, combos: [['after']], twoSided: [], yes: 'yes',
      label: (_d, v) => (v === 'kill' ? t('{0} が決めた直後', name) : v === 'miss' ? t('{0} が止められた・ミスした直後', name) : t('{0} が決めきれなかった直後', name)),
      phrase: (o, sh) => (o === 'yes' ? t('{0} へ {1}', name, pct(sh)) : t('{0} へは {1} に減る', name, pct(1 - sh))),
      mark: o => (o === 'yes' ? name : t('それ以外')),
    })
  }
  return out
}

// A zone of attack as a set's place: Zone4 (4, 5, 7), Zone3, Zone2/1 (2, 1, 9), Pipe (6, 8).
const zonePlace = (z: number | null): SetTarget | null => (z === 4 || z === 5 || z === 7 ? 'left' : z === 3 ? 'middle' : z === 2 || z === 1 || z === 9 ? 'right' : z === 6 || z === 8 ? 'pipe' : null)

// An attacker's kill rate (killRate) and blocked rate (blocked) by situation, the course from each
// zone by situation (zoneBy), and the other team's kill rate with each of the team's players in the
// front row or not (blockFront).
function attackSpecs(c: Ctx): Spec[] {
  const label = commonLabel(c), out: Spec[] = []
  const attacks = [...c.byMatch.values()].flat().filter(r => r.play.skill === 'A')
  const teamKeys = new Set([...c.byMatch.values()].flat().filter(c.mine).map(r => r.personKey))
  for (const [who, mine] of groupBy(attacks.filter(c.mine), personOf)) {
    const name = c.labelOf(mine[0].personKey)
    const base = (r: PlayRef) => common(r, c)
    out.push({
      kind: 'killRate', subject: `killRate|${who}`, person: who, who: name, yes: '#',
      cases: mine.map(r => ({ ref: r, out: r.play.effect === '#' ? '#' : 'x', dims: base(r) })),
      combos: [['pass'], ['oppRow'], ['margin'], ['stage'], ['set1'], ['rot'], ['recent'], ['pass', 'oppRow'], ['rot', 'pass']],
      twoSided: ['oppRow', 'set1', 'recent'], label,
      phrase: (o, sh) => (o === '#' ? t('決定率 {0}', pct(sh)) : t('決定率が {0} に落ちる', pct(1 - sh))),
      mark: o => (o === '#' ? t('決まったアタック') : t('決まらなかったアタック')),
    })
    // The other team's blockers in the front row: each in or out.
    const blockers = new Set(mine.flatMap(r => (r.play.front ?? []).filter(k => !teamKeys.has(k))))
    const blockDims = (r: PlayRef) => {
      const f = r.play.front
      return Object.fromEntries([...blockers].map(k => [`opp:${k}`, f ? (f.includes(k) ? 'in' : 'out') : null]))
    }
    out.push({
      kind: 'blocked', subject: `blocked|${who}`, person: who, who: name, yes: '/',
      cases: mine.map(r => ({ ref: r, out: r.play.effect === '/' ? '/' : 'x', dims: { ...base(r), ...blockDims(r) } })),
      combos: [['pass'], ['oppRow'], ['rot'], ...[...blockers].map(k => [`opp:${k}`])],
      twoSided: ['oppRow', ...[...blockers].map(k => `opp:${k}`)],
      label: (d, v) => (d.startsWith('opp:') ? (v === 'in' ? t('{0} が前衛', c.labelOf(d.slice(4))) : t('{0} が後衛', c.labelOf(d.slice(4)))) : label(d, v)),
      phrase: (o, sh) => (o === '/' ? t('被ブロック率 {0}', pct(sh)) : null),
      mark: () => t('ブロックされたアタック'),
    })
    for (const [zone, from] of groupBy(mine, r => r.play.startZone)) {
      out.push({
        kind: 'zoneBy', subject: `zoneBy|${who}|${zone}`, person: who, low: true, who: t('{0} の Zone{1} からのアタック', name, zone),
        cases: from.filter(r => r.play.endZone !== null).map(r => ({ ref: r, out: String(r.play.endZone), dims: base(r) })),
        combos: [['pass'], ['oppRow'], ['rot'], ['late'], ['recent']], twoSided: ['oppRow', 'recent'], label,
        phrase: (o, sh) => t('Zone{0} へ {1}', o, pct(sh)), mark: o => `Zone${o}`, paint: o => ({ zones: [+o], side: 'other' }),
      })
    }
  }
  // The other team's attacks from each place, with each of the team's players in the front row or not.
  const theirs = attacks.filter(r => !c.mine(r) && r.play.front)
  for (const key of teamKeys) {
    const person = `${c.team}|${key}`, name = c.labelOf(key)
    if (!theirs.some(r => r.play.front!.includes(key))) continue
    for (const [place, from] of groupBy(theirs, r => zonePlace(r.play.startZone))) {
      out.push({
        kind: 'blockFront', subject: `blockFront|${key}|${place}`, person, who: t('相手の {0} からのアタック', setTargetName(place)), yes: '#',
        cases: from.map(r => ({ ref: r, out: r.play.effect === '#' ? '#' : 'x', dims: { x: r.play.front!.includes(key) ? 'in' : 'out' } })),
        combos: [['x']], twoSided: ['x'], paint: () => ({ zones: TARGET_ZONES[place] ?? [], side: 'own' }),
        label: (_d, v) => (v === 'in' ? t('{0} が前衛', name) : t('{0} が後衛', name)),
        phrase: (o, sh) => (o === '#' ? t('決定率 {0}', pct(sh)) : t('決定率が {0} に落ちる', pct(1 - sh))),
        mark: o => (o === '#' ? t('決められたアタック') : t('止めたアタック')),
      })
    }
  }
  return out
}

// A server's errors (serveErr), kinds of serve (serveType), courses (serveCourse) by situation,
// and how often they break the pass at each zone (serveEffect): with what came before the serve
// (their last serve, the team's points in a row, a timeout) among the situations.
function serveSpecs(c: Ctx, rows: RallyRow[][]): Spec[] {
  const label = commonLabel(c), out: Spec[] = []
  const before = new Map<PlayRef, Record<string, string | null>>()
  const wonOf = new Map(rows.flat().map(row => [row.serve, row.won]))
  for (const match of rows) {
    const last = new Map<string, string>()
    match.forEach((row, i) => {
      if (!c.mine(row.serve)) return
      let streak = 0
      for (let k = i - 1; k >= 0 && match[k].setNum === row.setNum && match[k].won === true; k--) streak++
      const by = c.look.timeoutBy?.(row.serve) ?? null, who = personOf(row.serve)
      before.set(row.serve, {
        prevErr: last.has(who) ? (last.get(who) === '=' ? 'err' : 'in') : null,
        streak: streak >= 2 ? 'yes' : 'no',
        timeout: by === null ? null : by === row.serve.side ? 'ours' : 'theirs',
      })
      last.set(who, row.serve.play.effect)
    })
  }
  const serves = rows.flat().map(r => r.serve).filter(r => before.has(r))
  const lab = (d: string, v: string) =>
    d === 'prevErr' ? (v === 'err' ? t('前のサーブがミス') : t('前のサーブが成功'))
      : d === 'streak' ? (v === 'yes' ? t('2点以上の連続得点中') : t('連続得点中でない'))
        : d === 'timeout' ? (v === 'ours' ? t('自分たちのタイムアウト明け') : t('相手のタイムアウト明け'))
          : d === 'zone' ? serveTo(+v) : label(d, v)
  for (const [who, mine] of groupBy(serves, personOf)) {
    const name = c.labelOf(mine[0].personKey)
    const dims = (r: PlayRef) => ({ ...common(r, c), ...before.get(r)! })
    out.push({
      kind: 'serveErr', subject: `serveErr|${who}`, person: who, who: t('{0} のサーブ', name), yes: '=',
      cases: mine.map(r => ({ ref: r, out: r.play.effect === '=' ? '=' : 'x', dims: dims(r) })),
      combos: [['late'], ['margin'], ['stage'], ['set1'], ['prevErr'], ['streak'], ['timeout'], ['recent']],
      twoSided: ['set1', 'prevErr', 'streak', 'recent'], label: lab,
      phrase: (o, sh) => (o === '=' ? t('ミス率 {0}', pct(sh)) : t('ミス率が {0} に下がる', pct(1 - sh))),
      mark: o => (o === '=' ? t('サーブミス') : t('入ったサーブ')),
    })
    const typed = mine.filter(r => r.tempo)
    if (new Set(typed.map(r => r.tempo)).size > 1) {
      out.push({
        kind: 'serveType', subject: `serveType|${who}`, person: who, who: t('{0} のサーブ', name),
        cases: typed.map(r => ({ ref: r, out: r.tempo!, dims: dims(r) })),
        combos: [['late'], ['margin'], ['set1'], ['prevErr'], ['streak'], ['timeout']], twoSided: ['set1', 'prevErr', 'streak'], label: lab,
        phrase: (o, sh) => t('{0} {1}', serveKind(o), pct(sh)), mark: o => serveKind(o),
      })
    }
    const zoned = mine.filter(r => serveZoneMarker(r.play) !== null)
    out.push({
      kind: 'serveCourse', subject: `serveCourse|${who}`, person: who, who: t('{0} のサーブ', name),
      cases: zoned.map(r => ({ ref: r, out: String(serveZoneMarker(r.play)), dims: dims(r) })),
      combos: [['recent'], ['late'], ['margin'], ['set1'], ['prevErr'], ['rot']], twoSided: ['recent', 'set1', 'prevErr'], label: lab,
      phrase: (o, sh) => t('{0} へ {1}', SERVE_ZONE()[+o], pct(sh)), mark: o => SERVE_ZONE()[+o], paint: o => ({ zones: SERVE_ZONES[+o] ?? [], side: 'other' }),
    })
    // Broke the pass: an ace, an overpass, or a poor pass (the serve coded #, / or +).
    out.push({
      kind: 'serveEffect', subject: `serveEffect|${who}`, person: who, who: t('{0} のサーブ', name), yes: 'good',
      cases: zoned.map(r => ({ ref: r, out: '#/+'.includes(r.play.effect) ? 'good' : 'x', dims: { zone: String(serveZoneMarker(r.play)) } })),
      combos: [['zone']], twoSided: [], label: lab, paint: (_o, d) => ({ zones: SERVE_ZONES[+d[0][1]] ?? [], side: 'other' }),
      phrase: (o, sh) => (o === 'good' ? t('崩した率 {0}', pct(sh)) : t('崩した率が {0} に下がる', pct(1 - sh))),
      mark: o => (o === 'good' ? t('崩したサーブ') : t('崩せなかったサーブ')),
    })
    // The rally won on the serve (a break) by where it went, against the server's serves to the other
    // zones.
    const decided = zoned.filter(r => wonOf.get(r) != null)
    const zones = ['1', '2', '3', '4'].filter(z => decided.some(r => String(serveZoneMarker(r.play)) === z))
    out.push({
      kind: 'serverBreak', subject: `serverBreak|${who}|zone`, person: who, who: t('{0} のサーブ', name), yes: 'won', maxP: ZONE_BREAK_P,
      cases: decided.map(r => ({ ref: r, out: wonOf.get(r) ? 'won' : 'x', dims: Object.fromEntries(zones.map(z => [`z${z}`, String(serveZoneMarker(r.play)) === z ? 'in' : 'out'])) })),
      combos: zones.map(z => [`z${z}`]), twoSided: zones.map(z => `z${z}`), paint: (_o, d) => ({ zones: SERVE_ZONES[+d[0][0].slice(1)] ?? [], side: 'other' }),
      label: (d, v) => (v === 'in' ? serveTo(+d.slice(1)) : t('ほかのゾーンへのサーブ')),
      phrase: (o, sh) => (o === 'won' ? t('ブレイク率 {0}', pct(sh)) : t('ブレイク率が {0} に落ちる', pct(1 - sh))),
      mark: o => (o === 'won' ? t('ブレイク') : t('サイドアウトされた')),
    })
  }
  return out
}

// A receiver breaking down by where and how they were served (recZone); the side-out rate on each
// kind of pass by situation (soGrade); a rotation's side-out after one missed (rotStuck); the
// team's rallies after a timeout and by length, on its serve and on the other's (rallyServe,
// rallyRec).
function rallySpecs(c: Ctx, rows: RallyRow[][]): Spec[] {
  const label = commonLabel(c), out: Spec[] = []
  const serveOf = new Map<PlayRef, PlayRef>()
  for (const row of rows.flat()) if (row.rec) serveOf.set(row.rec, row.serve)
  const recs = [...serveOf.keys()]
  const broke = (r: PlayRef) => '-/='.includes(r.play.effect)
  for (const [who, mine] of groupBy(recs, personOf)) {
    const name = c.labelOf(mine[0].personKey)
    out.push({
      kind: 'recZone', subject: `recZone|${who}`, person: who, who: t('{0} のレセプション', name), yes: 'broke',
      cases: mine.map(r => { const z = serveZoneMarker(serveOf.get(r)!.play); return { ref: r, out: broke(r) ? 'broke' : 'x', dims: { zone: z === null ? null : String(z), type: r.tempo } } }),
      combos: [['zone'], ['type'], ['zone', 'type']], twoSided: [], paint: (_o, d) => { const z = d.find(([k]) => k === 'zone'); return z ? { zones: SERVE_ZONES[+z[1]] ?? [], side: 'own' } : null },
      label: (d, v) => (d === 'zone' ? serveTo(+v) : serveKind(v)),
      phrase: (o, sh) => (o === 'broke' ? t('崩れる率 {0}', pct(sh)) : null), mark: () => t('崩れたレセプション'),
    })
  }
  // Every rally of the team's reception, with whether it sided out.
  const recRows = rows.map(m => m.filter(r => r.rec && r.won !== null))
  for (const grade of PASSES) {
    const cases = recRows.flat().filter(r => r.rec!.play.effect === grade).map(r => ({ ref: r.rec!, out: r.won ? 'so' : 'x', dims: common(r.rec!, c) }))
    out.push({
      kind: 'soGrade', subject: `soGrade|${grade}`, person: null, who: t('レセプション「{0}」', grade), yes: 'so', cases,
      combos: [['rot'], ['oppRow'], ['late'], ['recent']], twoSided: ['oppRow', 'recent'], label,
      phrase: (o, sh) => (o === 'so' ? t('サイドアウト率 {0}', pct(sh)) : t('サイドアウト率が {0} に落ちる', pct(1 - sh))),
      mark: o => (o === 'so' ? t('サイドアウト') : t('失点')),
    })
  }
  // A rotation's receptions: right after one it lost in the same rotation, or not.
  const stuck: Case[] = []
  for (const match of rows) match.forEach((row, i) => {
    if (!row.rec || row.won === null) return
    const prev = match[i - 1], rot = rotationOf(row.rec)
    const again = !!prev && prev.setNum === row.setNum && prev.rec !== null && prev.won === false && rotationOf(prev.rec) === rot
    stuck.push({ ref: row.rec, out: row.won ? 'so' : 'x', dims: { again: again ? 'again' : 'first', rot: rot === null ? null : String(rot) } })
  })
  for (const [rot, cases] of groupBy(stuck, x => x.dims.rot)) {
    out.push({
      kind: 'rallyRec', subject: `rotStuck|${rot}`, person: null, who: t('ローテ {0}', rot), yes: 'so', cases, combos: [['again']], twoSided: ['again'],
      label: (_d, v) => (v === 'again' ? t('1本落とした後') : t('最初の1本')),
      phrase: (o, sh) => (o === 'so' ? t('サイドアウト率 {0}', pct(sh)) : t('サイドアウト率が {0} に落ちる', pct(1 - sh))),
      mark: o => (o === 'so' ? t('サイドアウト') : t('失点')),
    })
  }
  // The team's rallies right after a timeout, on its serve and on the other's.
  const flow = (serving: boolean): Case[] => rows.flat().filter(r => r.won !== null && c.mine(r.serve) === serving).map(r => {
    const by = c.look.timeoutBy?.(r.serve) ?? null, mySide = serving ? r.serve.side : r.serve.side === '*' ? 'a' : '*'
    return { ref: serving ? r.serve : r.rec ?? r.serve, out: r.won ? 'won' : 'x', dims: { timeout: by === null ? null : by === mySide ? 'ours' : 'theirs' } }
  })
  for (const serving of [true, false]) {
    const rate = serving ? t('ブレイク率') : t('サイドアウト率')
    out.push({
      kind: serving ? 'rallyServe' : 'rallyRec', subject: serving ? 'flow|serve' : 'flow|rec', person: null,
      who: serving ? t('自分たちのサーブのラリー') : t('相手のサーブのラリー'), yes: 'won', cases: flow(serving),
      combos: [['timeout']], twoSided: [],
      label: (_d, v) => (v === 'ours' ? t('自分たちのタイムアウト明け') : t('相手のタイムアウト明け')),
      phrase: (o, sh) => (o === 'won' ? t('{0} {1}', rate, pct(sh)) : t('{0}が {1} に落ちる', rate, pct(1 - sh))),
      mark: o => (o === 'won' ? t('取ったラリー') : t('落としたラリー')),
    })
  }
  // The long rallies (three attacks or more: each side has attacked again): won or lost, by the
  // team's rotation and situation, against all the long rallies. How many attacks a rally had says
  // by itself who is likelier to have won it, so only long rallies are set against each other.
  const long = rows.flat().filter(r => r.won !== null && r.attacks >= 3).map(r => {
    const mine = c.mine(r.serve), rot = mine ? rotationOf(r.serve) : otherRotationOf(r.serve), base = common(r.serve, c)
    return { ref: r.serve, out: r.won ? 'won' : 'x', dims: { rot: rot === null ? null : String(rot), serving: mine ? 'serve' : 'receive', late: base.late, set1: base.set1, recent: base.recent } }
  })
  out.push({
    kind: 'rallyLong', subject: 'flow|long', person: null, who: t('長いラリー（アタック 3 本以上）'), yes: 'won', cases: long,
    combos: [['rot'], ['serving'], ['late'], ['set1'], ['recent'], ['rot', 'serving']], twoSided: ['serving', 'set1', 'recent'],
    label: (d, v) => (d === 'serving' ? (v === 'serve' ? t('自分たちのサーブ') : t('相手のサーブ')) : label(d, v)),
    phrase: (o, sh) => (o === 'won' ? t('勝率 {0}', pct(sh)) : t('勝率が {0} に落ちる', pct(1 - sh))),
    mark: o => (o === 'won' ? t('取ったラリー') : t('落としたラリー')),
  })
  return out
}

// Every search of the team.
function specsOf(c: Ctx): Spec[] {
  const rows = rallies(c)
  return [...setterSpecs(c), ...attackSpecs(c), ...serveSpecs(c, rows), ...rallySpecs(c, rows)]
}

// The same search on another team, for the league: a setter's places are any setter's, a zone's
// courses any attacker's from it; a search about the team's own people against each other (who a
// setter goes back to, a player of the team in the front row) has none.
function familyOf(x: Spec): string | null {
  switch (x.kind) {
    case 'setDist': case 'killRate': case 'blocked': case 'serveErr': case 'serveType': case 'serveCourse': case 'serveEffect': case 'recZone': case 'serverBreak': return x.kind
    case 'zoneBy': return `zoneBy|${x.subject.split('|').pop()}`
    case 'soGrade': case 'rallyRec': case 'rallyServe': case 'rallyLong': return x.subject
    default: return null
  }
}
// Conditions that are the team's own, not to be set beside another team's: its recent matches, its
// front-row players, its setter's calls, the other team's blockers by name.
const OWN_DIMS = ['recent', 'front', 'call', 'after', 'x']
const ownDim = (d: string) => OWN_DIMS.includes(d) || d.startsWith('opp:')

// The league: how much each situation moves each outcome, on average over the other teams (each
// team counted once, however many matches it has). key: family|situation|outcome. A situation of
// two sides moves its outcome against the other side; the others against all the team's plays.
export interface League { teams: number; matches: number; shift: Map<string, { d: number; teams: number }> }
export const LEAGUE_TEAMS = 3 // a shift seen in fewer teams than this is not the league's

// Each team's plays (as its own team, 'our') and lookups; matches: how many there are in all.
export function leagueOf(teams: { scope: PlayRef[]; look: InsightLookups }[], matches: number): League {
  const per = new Map<string, number[]>()
  const add = (k: string, d: number) => { const l = per.get(k); if (l) l.push(d); else per.set(k, [d]) }
  for (const tm of teams) {
    const specs = specsOf(context(tm.scope, 'our', tm.look))
    for (const [family, xs] of groupBy(specs, familyOf)) {
      const x = xs[0], all = xs.flatMap(y => y.cases)
      if (all.length < MIN_N) continue
      const outs = x.yes ? [x.yes] : [...new Set(all.map(c => c.out))]
      const share = (cs: Case[], o: string) => cs.filter(c => c.out === o).length / cs.length
      for (const combo of x.combos) {
        if (combo.some(ownDim)) continue
        const two = combo.length === 1 && x.twoSided.includes(combo[0])
        for (const [key, ctx] of groupBy(all, c => (combo.some(d => c.dims[d] == null) ? null : combo.map(d => `${d}=${c.dims[d]}`).join('&')))) {
          if (ctx.length < MIN_N) continue
          const other = two ? all.filter(c => c.dims[combo[0]] != null && c.dims[combo[0]] !== ctx[0].dims[combo[0]]) : all
          if (other.length < MIN_N) continue
          for (const o of outs) {
            const d = share(ctx, o) - share(other, o)
            add(`${family}|${key}|${o}`, d)
            if (x.yes) add(`${family}|${key}|!${o}`, -d)
          }
        }
      }
    }
  }
  const shift = new Map<string, { d: number; teams: number }>()
  for (const [k, ds] of per) if (ds.length >= LEAGUE_TEAMS) shift.set(k, { d: ds.reduce((a, b) => a + b, 0) / ds.length, teams: ds.length })
  return { teams: teams.length, matches, shift }
}

// Every habit by situation of the team; with a league, set against how the league's teams move in
// the same situation.
export function situationInsights(s: Tally, scope: PlayRef[], team: 'our' | 'opp', look: InsightLookups): Insight[] {
  return specsOf(context(scope, team, look)).flatMap(x => search(s, { ...x, family: familyOf(x) }, look.league))
}
