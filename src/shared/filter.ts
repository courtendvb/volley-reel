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
  nextSkills: string[] // the contact just after, the same way
  nextEffects: string[]
  nextTeam: 'any' | 'same' | 'opp'
  nextSkipSet: boolean // look past the team's own set: the attack a reception or dig led to
}

export const EMPTY_FILTER: PlayFilter = {
  team: 'all', person: null, skills: [], effects: [], sets: [], rots: [], oppRots: [], startZone: null, endZone: null, tempos: [], combos: [], hits: [],
  phase: 'all', prevSkills: [], prevEffects: [], prevTeam: 'any', prevSkipSet: false,
  nextSkills: [], nextEffects: [], nextTeam: 'any', nextSkipSet: false,
}

// Search conditions kept under a name in the project, to put back with one click.
export interface SavedFilter {
  id: string
  name: string
  filter: PlayFilter
}

// A filter read back from project.json: each condition takes the shape it has in EMPTY_FILTER, and
// anything missing or of the wrong kind falls back to "any" (also for conditions added later).
const CHOICES: Partial<Record<keyof PlayFilter, readonly string[]>> = {
  team: ['all', 'our', 'opp'], phase: ['all', 'reception', 'transition'], prevTeam: ['any', 'same', 'opp'], nextTeam: ['any', 'same', 'opp'],
}
const NUMBERS = new Set<keyof PlayFilter>(['sets', 'rots', 'oppRots', 'startZone', 'endZone'])

export function cleanFilter(x: unknown): PlayFilter {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const ok = (k: keyof PlayFilter, v: unknown) => (NUMBERS.has(k) ? Number.isInteger(v) : typeof v === 'string' && v !== '')
  const out: Record<string, unknown> = {}
  for (const [key, empty] of Object.entries(EMPTY_FILTER)) {
    const k = key as keyof PlayFilter, v = o[k]
    out[k] = CHOICES[k] ? (CHOICES[k]!.includes(v as string) ? v : empty)
      : Array.isArray(empty) ? (Array.isArray(v) ? v.filter(e => ok(k, e)) : [])
      : typeof empty === 'boolean' ? v === true
      : ok(k, v) ? v : null
  }
  return out as unknown as PlayFilter
}

export function cleanSavedFilters(x: unknown): SavedFilter[] {
  if (!Array.isArray(x)) return []
  return x.filter(s => s && typeof s === 'object' && typeof s.id === 'string' && typeof s.name === 'string' && s.name.trim())
    .map(s => ({ id: s.id, name: s.name.trim(), filter: cleanFilter(s.filter) }))
}

// Same conditions, whatever order the chips were picked in.
export function sameFilter(a: PlayFilter, b: PlayFilter): boolean {
  const key = (f: PlayFilter) => JSON.stringify(Object.entries(cleanFilter(f)).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort() : v]))
  return key(a) === key(b)
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
    return nearMatches(r, r.play.before, f.prevSkills, f.prevEffects, f.prevTeam, f.prevSkipSet)
      && nearMatches(r, r.play.after, f.nextSkills, f.nextEffects, f.nextTeam, f.nextSkipSet)
  })
}

// The contact next to a play (codes from p.before or p.after), past the team's own set if asked.
export function nearCode(p: Play, codes: string[], skipSet: boolean): string | null {
  const [c, d] = codes
  return (skipSet && c?.[3] === 'E' && c[0] === p.side ? d : c) ?? null
}

// With no condition anything passes; otherwise a play with nothing there (a serve has nothing
// before, a rally's last play nothing after) fails. All-home plays pass the team condition, as with
// the team filter.
function nearMatches(r: PlayRef, codes: string[], skills: string[] = [], effects: string[] = [], team: string = 'any', skipSet = false): boolean {
  if (!skills.length && !effects.length && team === 'any') return true
  const c = nearCode(r.play, codes, skipSet)
  if (!c) return false
  if (skills.length && !skills.includes(c[3])) return false
  if (effects.length && !effects.includes(c[5])) return false
  return team === 'any' || r.side === null || (c[0] === r.side) === (team === 'same')
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
