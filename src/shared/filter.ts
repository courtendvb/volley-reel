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
  personKey: string // the DataVolley player key (home/away and the "-a" suffix already merged)
  name: string
  ourRot: number | null // our team's rotation at the play (home's when our side can't be known)
  oppRot: number | null // the other team's rotation
  tempo: string | null // the type letter (H, M, Q, T, U, N, O)
  combo: string | null // attack combination (attacks) or setter call (sets), e.g. "X5", "K1"
  comboName: string | null // its name from the file's tables, e.g. "QUICK TEMPO A"
  hit: string | null // attacks: H hard, P soft, T tip
}

export interface PlayFilter {
  team: 'all' | TeamRole // the project's target team or its opponents, whichever side they played
  person: string | null
  skills: string[] // empty = any
  effects: string[]
  sets: number[]
  rots: number[] // our team's rotation
  oppRots: number[] // the opponent's rotation
  startZone: number | null
  endZone: number | null
  tempos: string[] // detailed search
  combos: string[]
  hits: string[]
  phase: 'all' | 'reception' | 'transition' // dvw.ts phaseOf; serves are neither
  prevSkills: string[] // the contact just before in the rally (F: freeball)
  prevEffects: string[]
  prevTeam: 'any' | 'same' | 'opp' // relative to the play's own team
  prevSkipSet: boolean // look past the team's own set: the reception or dig an attack came from
}

export const EMPTY_FILTER: PlayFilter = {
  team: 'all', person: null, skills: [], effects: [], sets: [], rots: [], oppRots: [], startZone: null, endZone: null, tempos: [], combos: [], hits: [],
  phase: 'all', prevSkills: [], prevEffects: [], prevTeam: 'any', prevSkipSet: false,
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

export function buildRefs(matchId: string, dvw: ParsedDVW, settings: ProjectSettings): PlayRef[] {
  const our = dvw.allHome ? null : ourSide(dvw.teams, settings.ourTeamCodes)
  // Rotations by team, not by who made the play. Where our side can't be known, home counts as ours
  // (all-home input scouts the home team).
  const ourHome = our !== 'a'
  return dvw.plays.map(p => ({
    matchId,
    play: p,
    teamRole: dvw.allHome || our === null ? null : p.side === our ? 'our' : 'opp',
    side: dvw.allHome ? null : p.side,
    teamCode: dvw.allHome ? '—' : (p.side === '*' ? dvw.teams[0] : dvw.teams[1]).code,
    personKey: p.playerKey,
    name: displayName(dvw.players, p.side, p.jersey),
    ourRot: ourHome ? p.homeRot : p.awayRot,
    oppRot: ourHome ? p.awayRot : p.homeRot,
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

// Plays whose team can't be known (all-home input, or neither team is the target) stay in for a
// team filter rather than vanish.
export function applyFilter(refs: PlayRef[], f: PlayFilter): PlayRef[] {
  return refs.filter(r => {
    const p = r.play
    if (f.team !== 'all' && r.teamRole !== null && r.teamRole !== f.team) return false
    if (f.person && r.personKey !== f.person) return false
    if (f.skills.length && !f.skills.includes(p.skill)) return false
    if (f.effects.length && !f.effects.includes(p.effect)) return false
    if (f.sets.length && !f.sets.includes(p.setNum)) return false
    if (f.rots.length && (r.ourRot === null || !f.rots.includes(r.ourRot))) return false
    if (f.oppRots?.length && (r.oppRot === null || !f.oppRots.includes(r.oppRot))) return false
    if (f.startZone !== null && p.startZone !== f.startZone) return false
    if (f.tempos?.length && (!r.tempo || !f.tempos.includes(r.tempo))) return false
    if (f.combos?.length && (!r.combo || !f.combos.includes(r.combo))) return false
    if (f.hits?.length && (!r.hit || !f.hits.includes(r.hit))) return false
    if (f.endZone !== null && p.endZone !== f.endZone) return false
    if (f.phase && f.phase !== 'all' && p.phase !== f.phase[0]) return false
    return !hasPrev(f) || prevMatches(r, f)
  })
}

const hasPrev = (f: PlayFilter) => !!(f.prevSkills?.length || f.prevEffects?.length || (f.prevTeam && f.prevTeam !== 'any'))

// A serve has no previous play, so any previous-play condition drops it. All-home plays pass the
// team condition, as with the team filter.
export function prevCode(p: Play, skipSet: boolean): string | null {
  const [c, d] = p.before
  return (skipSet && c?.[3] === 'E' && c[0] === p.side ? d : c) ?? null
}

function prevMatches(r: PlayRef, f: PlayFilter): boolean {
  const c = prevCode(r.play, !!f.prevSkipSet)
  if (!c) return false
  if (f.prevSkills?.length && !f.prevSkills.includes(c[3])) return false
  if (f.prevEffects?.length && !f.prevEffects.includes(c[5])) return false
  return !f.prevTeam || f.prevTeam === 'any' || r.side === null || (c[0] === r.side) === (f.prevTeam === 'same')
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
