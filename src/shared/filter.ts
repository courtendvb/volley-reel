// Play search across matches (design §3.2, §3.3). Pure, so it is unit-tested without the app.
import { displayName } from './dvw'
import type { ParsedDVW, Play, ProjectSettings, Side, Team } from './types'

export type TeamRole = 'our' | 'opp'

export interface PlayRef {
  matchId: string
  play: Play
  teamRole: TeamRole | null // null: all-home input, or neither team is ours
  side: Side | null // null: all-home input, where the team can't be known
  teamCode: string
  personKey: string // player key after the alias table
  name: string
  rot: number | null // rotation of the team that made the play
  tempo: string | null // the type letter (H, M, Q, T, U, N, O)
  combo: string | null // attack combination (attacks) or setter call (sets), e.g. "X5", "K1"
  comboName: string | null // its name from the file's tables, e.g. "QUICK TEMPO A"
  hit: string | null // attacks: H hard, P soft, T tip
}

export interface PlayFilter {
  team: 'all' | 'home' | 'away'
  person: string | null
  skills: string[] // empty = any
  effects: string[]
  sets: number[]
  rots: number[]
  startZone: number | null
  endZone: number | null
  tempos: string[] // detailed search
  combos: string[]
  hits: string[]
}

export const EMPTY_FILTER: PlayFilter = {
  team: 'all', person: null, skills: [], effects: [], sets: [], rots: [], startZone: null, endZone: null, tempos: [], combos: [], hits: [],
}

// The parts of a scout code after the skill and effect: *07AQ#X5~36BH1 → tempo Q, combo X5, hit H.
export function codeDetail(code: string, skill: string): { tempo: string | null; combo: string | null; hit: string | null } {
  const at = (i: number) => { const ch = code[i]; return ch && ch !== '~' ? ch : null }
  const combo = code.slice(6, 8)
  return {
    tempo: at(4),
    combo: (skill === 'A' || skill === 'E') && /^[A-Z0-9]{2}$/i.test(combo) ? combo.toUpperCase() : null,
    hit: skill === 'A' ? at(12) : null,
  }
}

// Which side is ours in this match. Scrimmages (both codes ours) count the home side.
export function ourSide(teams: [Team, Team], codes: string[]): Side | null {
  if (codes.includes(teams[0].code)) return '*'
  if (codes.includes(teams[1].code)) return 'a'
  return null
}

// Follows alias links to the end; a loop stops at the first repeat instead of hanging.
export function resolvePerson(key: string, aliases: Record<string, string>): string {
  const seen = new Set<string>()
  let k = key
  while (aliases[k] && !seen.has(k)) { seen.add(k); k = aliases[k] }
  return k
}

export function buildRefs(matchId: string, dvw: ParsedDVW, settings: ProjectSettings): PlayRef[] {
  const our = dvw.allHome ? null : ourSide(dvw.teams, settings.ourTeamCodes)
  return dvw.plays.map(p => ({
    matchId,
    play: p,
    teamRole: dvw.allHome || our === null ? null : p.side === our ? 'our' : 'opp',
    side: dvw.allHome ? null : p.side,
    teamCode: dvw.allHome ? '—' : (p.side === '*' ? dvw.teams[0] : dvw.teams[1]).code,
    personKey: resolvePerson(p.playerKey, settings.playerAliases),
    name: displayName(dvw.players, p.side, p.jersey),
    rot: p.side === '*' ? p.homeRot : p.awayRot,
    ...detailOf(p.code, p.skill, dvw.codeNames ?? {}),
  }))
}

function detailOf(code: string, skill: string, names: Record<string, string>) {
  const d = codeDetail(code, skill)
  return { ...d, comboName: d.combo ? names[d.combo] ?? null : null }
}

// What the detailed search can offer for these plays, most used first.
export function detailOptions(refs: PlayRef[]): { tempos: string[]; hits: string[]; combos: { code: string; name: string | null; n: number }[] } {
  const tempos = new Set<string>(), hits = new Set<string>()
  const combos = new Map<string, { code: string; name: string | null; n: number }>()
  for (const r of refs) {
    if (r.tempo) tempos.add(r.tempo)
    if (r.hit) hits.add(r.hit)
    if (r.combo) {
      const e = combos.get(r.combo) ?? { code: r.combo, name: r.comboName, n: 0 }
      e.n++; if (!e.name) e.name = r.comboName
      combos.set(r.combo, e)
    }
  }
  return { tempos: [...tempos], hits: [...hits], combos: [...combos.values()].sort((a, b) => b.n - a.n || a.code.localeCompare(b.code)) }
}

// Plays whose team can't be known (all-home input) stay in for a team filter rather than vanish.
export function applyFilter(refs: PlayRef[], f: PlayFilter): PlayRef[] {
  return refs.filter(r => {
    const p = r.play
    if (f.team !== 'all' && r.side !== null && r.side !== (f.team === 'home' ? '*' : 'a')) return false
    if (f.person && r.personKey !== f.person) return false
    if (f.skills.length && !f.skills.includes(p.skill)) return false
    if (f.effects.length && !f.effects.includes(p.effect)) return false
    if (f.sets.length && !f.sets.includes(p.setNum)) return false
    if (f.rots.length && (r.rot === null || !f.rots.includes(r.rot))) return false
    if (f.startZone !== null && p.startZone !== f.startZone) return false
    if (f.tempos?.length && (!r.tempo || !f.tempos.includes(r.tempo))) return false
    if (f.combos?.length && (!r.combo || !f.combos.includes(r.combo))) return false
    if (f.hits?.length && (!r.hit || !f.hits.includes(r.hit))) return false
    if (f.endZone !== null && p.endZone !== f.endZone) return false
    return true
  })
}

export interface Person {
  key: string
  name: string
  jerseys: number[]
  teamCodes: string[]
  teamRole: TeamRole | null
  plays: number
}

// People appearing in `refs`, ours first, then by jersey.
export function listPeople(refs: PlayRef[]): Person[] {
  const map = new Map<string, Person>()
  for (const r of refs) {
    let p = map.get(r.personKey)
    if (!p) { p = { key: r.personKey, name: r.name, jerseys: [], teamCodes: [], teamRole: r.teamRole, plays: 0 }; map.set(r.personKey, p) }
    p.plays++
    if (!p.jerseys.includes(r.play.jersey)) p.jerseys.push(r.play.jersey)
    if (r.teamCode !== '—' && !p.teamCodes.includes(r.teamCode)) p.teamCodes.push(r.teamCode)
    if (r.teamRole === 'our') p.teamRole = 'our'
  }
  const rank = (p: Person) => (p.teamRole === 'our' ? 0 : p.teamRole === null ? 1 : 2)
  return [...map.values()].sort((a, b) => rank(a) - rank(b) || a.jerseys[0] - b.jerseys[0] || a.name.localeCompare(b.name))
}
