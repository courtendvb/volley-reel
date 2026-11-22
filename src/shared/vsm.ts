// VolleyStation's own scout file (.vsm, JSON) read as a DVW: it is written out as the DVW text
// VolleyStation itself would export, and that is parsed by parseDVW, so everything read from a DVW
// (phases, receptions, lineups, clicks…) comes the same from a .vsm. Checked against a match exported
// both ways: every play's code, time, rotations and lineups agree, and its clicks to the grid cell.
// Pure: no file or DOM access.
import { parseDVW } from './dvw'
import type { ParsedDVW, Play } from './types'
import { applyScoutEdits, editCount, type ScoutEdits } from './codeEdit'

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
// The DVW text of a scout file of either kind.
export const scoutDvwText = (text: string): string => (isVsm(text) ? vsmToDvw(JSON.parse(text) as Vsm) : text)

// edits: corrections by [3SCOUT] line (codeEdit.ts); a .vsm's lines are those of the DVW text it becomes.
export function parseScout(text: string, edits?: ScoutEdits): ParsedDVW {
  const dvw = scoutDvwText(text)
  if (!edits || !editCount(edits)) return parseDVW(dvw)
  const r = applyScoutEdits(dvw, edits)
  const d = parseDVW(r.text, r.sources)
  // The plays taken out, read from the file with every other correction laid in, for the list to show faded.
  const gone = new Set((edits.edits ?? []).filter(e => e.to === '' && !r.stale.edits.includes(e)).map(e => e.line))
  let deleted: Play[] = []
  if (gone.size) {
    const kept = applyScoutEdits(dvw, { ...edits, edits: (edits.edits ?? []).filter(e => e.to !== '') })
    deleted = parseDVW(kept.text, kept.sources).plays.filter(p => !p.inserted && p.line !== undefined && gone.has(p.line)).map(p => ({ ...p, deleted: true }))
  }
  return { ...d, ...(r.stale.edits.length || r.stale.inserts.length ? { stale: r.stale } : {}), ...(deleted.length ? { deleted } : {}) }
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

// ---- writing corrections back to a .vsm --------------------------------------------------------------

// Which VolleyStation play each [3SCOUT] line of vsmToDvw's text came from (null: a point or set line), in the
// same order the lines are written.
export function vsmScoutRefs(v: Vsm): ({ si: number; ei: number; pi: number } | { si: number; ei: number; pi: null } | null)[] {
  const out: ({ si: number; ei: number; pi: number } | { si: number; ei: number; pi: null } | null)[] = []
  ;(v.scout?.sets ?? []).forEach((s, si) => {
    s.events.forEach((e, ei) => {
      const plays = e.exchange?.plays
      if (!plays?.length) return
      plays.forEach((_p, pi) => out.push({ si, ei, pi }))
      if (e.exchange?.point && e.score) out.push({ si, ei, pi: null })
    })
    out.push(null)
  })
  return out
}

// A play's fields from a DataVolley code, over the play it replaces (its time and path kept). The zones go back
// the way playCode reads them: a reception, set, block or dig keeps its own spot in startZone.
export function vsmPlayFromCode(code: string, base: Partial<VsmPlay> = {}): VsmPlay {
  const ch = (i: number) => { const c = code.charAt(i); return c && c !== '~' ? c : undefined }
  const num = (i: number) => { const c = ch(i); return c && /\d/.test(c) ? Number(c) : undefined }
  const skill = code.charAt(3)
  const combo = code.substring(6, 8)
  const own = skill === 'R' || skill === 'E' || skill === 'B' || skill === 'D'
  // VolleyStation's own short code would no longer match the play, so it is left off (its fields are what count).
  const { code: _vsCode, ...kept } = base as Partial<VsmPlay> & { code?: string }
  const jersey = Number(code.substring(1, 3))
  const p: VsmPlay = {
    ...kept,
    // the jersey written as the file writes it (VolleyStation: "06")
    team: code.charAt(0) === 'a' ? 'a' : '*', player: typeof base.player === 'number' ? jersey : pad2(jersey), skill,
    hitType: ch(4), effect: ch(5), combination: /^[^~]{2}$/.test(combo) ? combo : undefined, targetAttacker: ch(8),
    skillType: ch(12), players: num(13), special: ch(14), custom: code.length > 15 ? code.substring(15) : undefined,
  }
  if (own) {
    p.startZone = num(10); p.startSubZone = ch(11)
    if (skill === 'R') { /* the serve's zones stay with the serve */ } else { p.endZone = undefined; p.endSubZone = undefined }
  } else { p.startZone = num(9); p.endZone = num(10); p.endSubZone = ch(11) }
  for (const k of Object.keys(p) as (keyof VsmPlay)[]) if (p[k] === undefined) delete p[k]
  return p
}

// A DataVolley cell back in VolleyStation's units (the inverse of cell above).
const vsmPoint = (cell: string): VsmPoint | null => {
  const i = parseInt(cell)
  if (!(i > 0)) return null
  const row = Math.floor((i - 1) / 100), col = (i - 1) % 100
  return { x: Math.round((col - 8.13) * 11), y: Math.round((row - 9.13) * 22) }
}
// A play's path from its corrected clicks (undefined: the clicks were not corrected, the path stays).
function withPath(p: VsmPlay, start: string | undefined, end: string | undefined): VsmPlay {
  if (start === undefined && end === undefined) return p
  const was = p.travelPath ?? []
  const s = start === undefined ? was[0] ?? null : vsmPoint(start)
  const e = end === undefined ? (was.length > 1 ? was[was.length - 1] : null) : vsmPoint(end)
  const path = [s, e].filter((x): x is VsmPoint => !!x)
  const { travelPath: _old, ...rest } = p
  // A path's first point is the start: an end without a start is kept as both (VolleyStation has no end alone).
  return path.length ? { ...rest, travelPath: s ? path : [e!, e!] } : rest
}

// The .vsm with the corrections laid in: codes changed on their plays, plays taken out, plays put in after
// the line they follow (time in tenths of a second). Point and set lines are not changed here. Returns the
// file and the corrections it could not place.
export function vsmWithEdits(v: Vsm, s: ScoutEdits): { vsm: Vsm; skipped: number } {
  const refs = vsmScoutRefs(v)
  const lines = vsmToDvw(v).split('\r\n')
  const start = lines.indexOf('[3SCOUT]') + 1
  const codeAt = (i: number) => (lines[start + i] ?? '').split(';')[0]
  const out = JSON.parse(JSON.stringify(v)) as Vsm
  let skipped = 0
  const changes: { si: number; ei: number; pi: number; kind: 'set' | 'drop' | 'add'; play?: VsmPlay; order: number }[] = []
  for (const e of s.edits ?? []) {
    const r = refs[e.line]
    if (!r || r.pi === null || codeAt(e.line) !== e.from) { skipped++; continue }
    const base = v.scout!.sets![r.si].events[r.ei].exchange!.plays[r.pi]
    changes.push(e.to === '' ? { ...r, pi: r.pi, kind: 'drop', order: 0 } : { ...r, pi: r.pi, kind: 'set', play: withPath(vsmPlayFromCode(e.to, base), e.start, e.end), order: 0 })
  }
  ;(s.inserts ?? []).forEach((ins, n) => {
    const r = refs[ins.after]
    if (!r || codeAt(ins.after) !== ins.from) { skipped++; return }
    const plays = v.scout!.sets![r.si].events[r.ei].exchange!.plays
    const after = r.pi ?? plays.length - 1
    changes.push({ si: r.si, ei: r.ei, pi: after, kind: 'add', play: withPath(vsmPlayFromCode(ins.code, { time: Math.round(ins.time * 10) }), ins.start ?? '', ins.end ?? ''), order: n + 1 })
  })
  // Each exchange from its last play back, so the places still to change keep their index.
  changes.sort((a, b) => a.si - b.si || a.ei - b.ei || b.pi - a.pi || b.order - a.order)
  for (const c of changes) {
    const plays = out.scout!.sets![c.si].events[c.ei].exchange!.plays
    if (c.kind === 'set') plays[c.pi] = c.play!
    else if (c.kind === 'drop') plays.splice(c.pi, 1)
    else plays.splice(c.pi + 1, 0, c.play!)
  }
  return { vsm: out, skipped }
}
