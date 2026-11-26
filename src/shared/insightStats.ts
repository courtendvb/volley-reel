// The numbers behind insights (insights.ts): how much a habit needs, and the tests that say how far
// a share is from chance. Pure, so it is unit-tested (insights.test.ts).
import type { PlayRef } from './filter'
import type { Play } from './types'
import { tempoName } from './labels'
import { t } from './i18n'

// How much a habit needs: enough plays in the situation, enough of them showing it, a share well
// above the base, and little chance of being luck: all told (adjP within ALPHA, at most about one in
// five of a list by luck), or on its own (p within MAX_P) though its kind looked at many situations.
// adjP orders the list and says how sure each is: a few matches hold few plays of a setter's
// combinations, and adding a kind of situation to look at shouldn't make another's habits go. The
// sample shows in each habit's numbers.
export const MIN_N = 10
export const MIN_HITS = 5
export const MIN_LIFT = 0.12
export const ALPHA = 0.2
export const MAX_P = 0.01
// With the league to set beside: how far past the league's shift in the same situation a habit must go.
export const LEAGUE_LIFT = 0.08

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

// The chance of a standard normal at z or beyond, away from 0 (Abramowitz–Stegun 7.1.26).
export function normalTail(z: number): number {
  const x = Math.abs(z) / Math.SQRT2, k = 1 / (1 + 0.3275911 * x)
  const erfc = k * (0.254829592 + k * (-0.284496736 + k * (1.421413741 + k * (-1.453152027 + k * 1.061405429)))) * Math.exp(-x * x)
  return erfc / 2
}

// Two shares against each other (h1 of n1 above h2 of n2, by more than `by`): z, and its one-sided
// chance by luck.
export function twoShares(h1: number, n1: number, h2: number, n2: number, by = 0): { z: number; p: number } {
  const pooled = (h1 + h2) / (n1 + n2), se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
  const z = se ? (h1 / n1 - h2 / n2 - by) / se : 0
  return { z, p: z > 0 ? normalTail(z) : 1 - normalTail(z) }
}

// Whether a share is worth testing: enough plays, enough of them, far enough from the base.
export const worth = (hits: number, n: number, base: number, up = true): boolean => {
  const lift = hits / n - base
  return n >= MIN_N && (up ? hits >= MIN_HITS && lift >= MIN_LIFT : lift <= -MIN_LIFT)
}

// The situations each kind of habit looked at, for how sure each found must be (adjP).
export type Tally = Partial<Record<string, number>>
export const tally = (s: Tally, kind: string, n = 1) => { s[kind] = (s[kind] ?? 0) + n }

export const groupBy = <K, T = PlayRef>(refs: T[], key: (r: T) => K | null): Map<K, T[]> => {
  const m = new Map<K, T[]>()
  for (const r of refs) { const k = key(r); if (k !== null) { const l = m.get(k); if (l) l.push(r); else m.set(k, [r]) } }
  return m
}
export const rallyKey = (r: PlayRef): string | null => (r.play.rallyId === null ? null : `${r.matchId}|${r.play.rallyId}`)

// A serve's zone as serveZoneMarker gives it (1 Zone1, 2 Zone6, 3 Zone5, 4 short), as scenes name it.
export const SERVE_ZONE = (): Record<number, string> => ({ 1: 'Zone1', 2: 'Zone6', 3: 'Zone5', 4: t('ショート') })
// A serve's kind as its type letter tells it: jump spin (Q), jump float (M), float (H).
export const serveKind = (type: string): string => ({ Q: t('ジャンプサーブ'), M: t('ジャンプフローター'), H: t('フローター') })[type] ?? tempoName(type)
