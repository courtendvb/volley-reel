// VolleyStation's own scout file (.vsm, JSON) read as a DVW: it is written out as the DVW text
// VolleyStation itself would export, and that is parsed by parseDVW, so everything read from a DVW
// (phases, receptions, lineups, clicks…) comes the same from a .vsm. Checked against a match exported
// both ways: every play's code, time, rotations and lineups agree, and its clicks to the grid cell.
// Pure: no file or DOM access.
import { parseDVW } from './dvw'
import type { ParsedDVW } from './types'

interface VsmPoint { x: number; y: number }
interface VsmPlay {
  team: '*' | 'a'; player: string | number; skill: string; hitType?: string; effect?: string
  combination?: string; targetAttacker?: string; startZone?: number; startSubZone?: string; endZone?: number; endSubZone?: string
  skillType?: string; players?: number; special?: string; custom?: string
  time?: number // tenths of a second into the video
  travelPath?: VsmPoint[]
}
interface VsmLineup { positions: Record<string, number>; setterAt: number }
interface VsmEvent {
  lineup?: { home: VsmLineup; away: VsmLineup }
  score?: { home: number; away: number } // after the event
  exchange?: { plays: VsmPlay[]; point?: '*' | 'a' }
  substitution?: { playerIn: number; playerOut: number; team: '*' | 'a' }
}
interface VsmSet { startingLineup?: { home: VsmLineup; away: VsmLineup }; events: VsmEvent[]; score?: { home: number; away: number } }
interface VsmPlayer { shirtNumber: number; firstName?: string; lastName?: string; code?: string; position?: number }
interface VsmTeam { name?: string; code?: string; shortCode?: string; players?: VsmPlayer[]; libero?: number[]; staff?: Record<string, { firstName?: string; lastName?: string } | undefined> }
export interface Vsm {
  startDate?: string
  team?: { home?: VsmTeam; away?: VsmTeam }
  attackCombinations?: { code: string; name?: string; hitType?: string; targetAttacker?: string; start?: { zone?: number } }[]
  setterCalls?: { code: string; name?: string }[]
  scout?: { sets?: VsmSet[] }
}

// Whether a scout file's text is a VolleyStation file (JSON) rather than a DVW.
export const isVsm = (text: string) => /^\s*\{/.test(text)

// A scout file of either kind.
export function parseScout(text: string): ParsedDVW {
  return parseDVW(isVsm(text) ? vsmToDvw(JSON.parse(text) as Vsm) : text)
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const z = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '~' : String(v))
// A click as DataVolley's 100 × 100 grid cell (row * 100 + column + 1); VolleyStation's units are
// 11 to a column and 22 to a row.
const cell = (p: VsmPoint | undefined) => (p ? String(Math.round(p.y / 22 + 9.13) * 100 + Math.round(p.x / 11 + 8.13) + 1).padStart(4, '0') : '')

// A play's DataVolley code. Its zones as DataVolley gives them: a reception the serve's (from, to and
// where in it); a set and a block where they were played; a dig from where the attack it answers came,
// to where it was dug.
export function playCode(p: VsmPlay, before: VsmPlay[]): string {
  let start = p.startZone, end = p.endZone, sub = p.endSubZone
  if (p.skill === 'R') {
    const serve = [...before].reverse().find(q => q.skill === 'S')
    start = serve?.startZone; end = p.startZone; sub = p.startSubZone
  } else if (p.skill === 'E' || p.skill === 'B') {
    start = undefined; end = p.startZone; sub = p.startSubZone
  } else if (p.skill === 'D') {
    if (p.startZone !== undefined) {
      const shot = [...before].reverse().find(q => (q.skill === 'A' || q.skill === 'S') && q.team !== p.team)
      start = shot?.startZone; end = p.startZone; sub = p.startSubZone
    } else start = undefined
  }
  const c = `${p.team}${pad2(Number(p.player))}${p.skill}${p.hitType ?? '~'}${p.effect ?? '~'}${p.combination || '~~'}${z(p.targetAttacker)}` +
    `${z(start)}${z(end)}${z(sub)}${z(p.skillType)}${z(p.players)}${z(p.special)}${p.custom ?? ''}`
  return c.replace(/~+$/, '')
}

const lineupCols = (l: VsmLineup | undefined) => [1, 2, 3, 4, 5, 6].map(k => (l?.positions[String(k)] ?? ''))
const person = (x: { firstName?: string; lastName?: string } | undefined) => [x?.lastName, x?.firstName].filter(Boolean).join(' ')

// The DVW text of a VolleyStation file: the match, teams, sets, players, attack combinations, setter
// calls and the plays, with a point line after each rally and a set line after each set.
export function vsmToDvw(v: Vsm): string {
  const out: string[] = ['[3DATAVOLLEYSCOUT]', 'GENERATOR-PRG: SyncScout Video Editor (from VolleyStation .vsm)']
  const start = v.startDate ? new Date(v.startDate) : null
  const day = start && !isNaN(+start) ? `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)}/${start.getFullYear()}` : ''
  const clock = start && !isNaN(+start) ? `${pad2(start.getHours())}.${pad2(start.getMinutes())}.${pad2(start.getSeconds())}` : ''
  out.push('[3MATCH]', `${day};${clock};;;;;;;;;;;;;;`)
  const sets = v.scout?.sets ?? []
  const won = { home: 0, away: 0 }
  for (const s of sets) { if (s.score) { if (s.score.home > s.score.away) won.home++; else if (s.score.away > s.score.home) won.away++ } }
  const teams = [v.team?.home, v.team?.away]
  out.push('[3TEAMS]')
  teams.forEach((tm, i) => out.push(`${tm?.shortCode ?? tm?.code ?? (i ? 'AWAY' : 'HOME')};${tm?.name ?? ''};${i ? won.away : won.home};${person(tm?.staff?.coach)};${person(tm?.staff?.assistantCoach)};;;;;`))
  // The sets: the score when the first team reached 8, 16 and 21, the final score and the minutes.
  out.push('[3SET]')
  for (const s of sets) {
    const partial: string[] = []
    let first = Infinity, last = -Infinity
    for (const e of s.events) {
      for (const p of e.exchange?.plays ?? []) if (p.time !== undefined) { first = Math.min(first, p.time); last = Math.max(last, p.time) }
      if (!e.exchange || !e.score) continue
      const top = Math.max(e.score.home, e.score.away)
      for (const [k, at] of [8, 16, 21].entries()) if (top >= at && partial.length === k) partial.push(`${e.score.home}-${e.score.away}`)
    }
    const fin = s.score ? `${s.score.home}-${s.score.away}` : ''
    const minutes = isFinite(first) ? Math.round((last - first) / 600) : 0
    out.push(`True;${partial[0] ?? ''};${partial[1] ?? ''};${partial[2] ?? ''};${fin};${minutes};`)
  }
  // The players: each set's starting zone, '*' when they came on (or, a libero, played), the libero flag and the role.
  for (const [i, side] of (['home', 'away'] as const).entries()) {
    const tm = teams[i], mark = side === 'home' ? '*' : 'a'
    out.push(side === 'home' ? '[3PLAYERS-H]' : '[3PLAYERS-V]')
    for (const [k, pl] of (tm?.players ?? []).entries()) {
      const n = pl.shirtNumber, libero = tm?.libero?.includes(n)
      const inSet = (s: VsmSet) => {
        const startAt = Object.entries(s.startingLineup?.[side].positions ?? {}).find(([, j]) => j === n)?.[0]
        if (startAt) return startAt
        const cameOn = s.events.some(e => (e.substitution?.team === mark && e.substitution.playerIn === n) ||
          Object.values(e.lineup?.[side].positions ?? {}).includes(n) || (e.exchange?.plays ?? []).some(p => p.team === mark && Number(p.player) === n))
        return cameOn ? '*' : ''
      }
      const per = [0, 1, 2, 3, 4].map(j => (sets[j] ? inSet(sets[j]) : ''))
      out.push(`${i};${n};${k + 1};${per.join(';')};${pl.code ?? ''};${pl.lastName ?? ''};${pl.firstName ?? ''};;${libero ? 'L' : ''};${pl.position !== undefined ? pl.position + 1 : ''};False;`)
    }
  }
  out.push('[3ATTACKCOMBINATION]')
  for (const a of v.attackCombinations ?? []) out.push(`${a.code};${a.start?.zone ?? ''};;${a.hitType ?? ''};${a.name ?? ''};;;;${a.targetAttacker ?? ''};;`)
  out.push('[3SETTERCALL]')
  for (const c of v.setterCalls ?? []) out.push(`${c.code};;${c.name ?? ''};;;;;;;;;;;;;`)
  // The plays: code; clicks (from, to); the set; both rotations (where the setters are); the video time;
  // both lineups, P1 to P6.
  out.push('[3SCOUT]')
  sets.forEach((s, si) => {
    for (const e of s.events) {
      const plays = e.exchange?.plays
      if (!plays?.length) continue
      const l = e.lineup, rot = `${l?.home.setterAt ?? ''};${l?.away.setterAt ?? ''}`, lineups = [...lineupCols(l?.home), ...lineupCols(l?.away)].join(';')
      let time = 0
      plays.forEach((p, k) => {
        time = (p.time ?? 0) / 10
        const path = p.travelPath
        out.push(`${playCode(p, plays.slice(0, k))};;;;${cell(path?.[0])};;${path && path.length > 1 ? cell(path[path.length - 1]) : ''};;${si + 1};${rot};1;${time};;${lineups};`)
      })
      if (e.exchange?.point && e.score) out.push(`${e.exchange.point}p${pad2(e.score.home)}:${pad2(e.score.away)};;;;;;;;${si + 1};${rot};1;${time};;${lineups};`)
    }
    out.push(`**${si + 1}set;;;;;;;;;;;;;;;;;;;;;;;;;`)
  })
  return out.join('\r\n')
}
