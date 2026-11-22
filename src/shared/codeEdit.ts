// Corrections to a scout file, kept beside the match and laid over the file when it is read: the file itself
// is never written. Three kinds, each naming a [3SCOUT] line (its index among that section's non-empty lines)
// and the code the file had there, so it applies only while the file still says that:
// - a code changed (CodeEdit, to: the new code)
// - a line taken out (CodeEdit, to: '')
// - a play put in after a line (ScoutInsert: its code and video-file time, the rest copied from that line)
// applyScoutEdits writes the corrected DVW text and says where each of its scout lines came from; reading
// (parseDVW) and writing out a corrected .dvw both use it. A file changed since leaves an edit out (stale)
// rather than putting it on another play.
// Pure: no file or DOM access.

// start / end: the clicks (columns 5 and 7, DataVolley's 100 × 100 cell, '' for none), when they were corrected.
export interface CodeEdit { line: number; from: string; to: string; start?: string; end?: string } // to '': the line is taken out
export interface ScoutInsert { id: string; after: number; from: string; code: string; time: number; start?: string; end?: string } // time: DVW seconds

// Where a line of the corrected [3SCOUT] came from: a file line (and the code it had), or a play put in.
export type ScoutSource = { line: number; original: string; insert?: undefined } | { line: number; original: string; insert: string }

export interface ScoutEdits { edits?: CodeEdit[]; inserts?: ScoutInsert[] }

// The edits after one line's code and / or clicks are set. to: the new code (the file's: no code change; '': the
// line taken out); start / end: a cell, or null for the file's click again. An edit that changes nothing goes.
export function withLineEdit(edits: CodeEdit[] | undefined, line: number, from: string, patch: { to?: string; start?: string | null; end?: string | null }): CodeEdit[] {
  const had = (edits ?? []).find(e => e.line === line && e.from === from)
  const rest = (edits ?? []).filter(e => e.line !== line)
  const next: CodeEdit = { line, from, to: patch.to ?? had?.to ?? from }
  const start = patch.start === undefined ? had?.start : patch.start ?? undefined
  const end = patch.end === undefined ? had?.end : patch.end ?? undefined
  if (start !== undefined) next.start = start
  if (end !== undefined) next.end = end
  const changes = next.to !== from || next.start !== undefined || next.end !== undefined
  return changes ? [...rest, next].sort((a, b) => a.line - b.line) : rest
}

// The edits after one play's code is set (to its original: no code change; to '': the line is taken out).
export const withCodeEdit = (edits: CodeEdit[] | undefined, line: number, from: string, to: string): CodeEdit[] => withLineEdit(edits, line, from, { to })

// A click as DataVolley's cell (row * 100 + column + 1, four digits) and back; the point is in the coding team's
// half and up (u across 0..1, v from its own end line 0 to the far one 1, the net at 0.5), as dvw.ts reads it.
export function cellOf(p: { u: number; v: number }): string {
  const col = Math.max(0, Math.min(99, Math.round(((p.u * 3 + 0.5) * 100) / 4 - 0.5)))
  const row = Math.max(0, Math.min(99, Math.round(((p.v * 6 + 0.5) * 100) / 7 - 0.5)))
  return String(row * 100 + col + 1).padStart(4, '0')
}
export function pointOf(cell: string | undefined): { u: number; v: number } | null {
  const i = parseInt(cell ?? '')
  if (!(i > 0)) return null
  const row = Math.floor((i - 1) / 100), col = (i - 1) % 100
  return { u: (((col + 0.5) * 4) / 100 - 0.5) / 3, v: (((row + 0.5) * 7) / 100 - 0.5) / 6 }
}

// The inserts after one is put in, changed (same id) or taken off (code '').
export function withInsert(inserts: ScoutInsert[] | undefined, ins: ScoutInsert): ScoutInsert[] {
  const had = (inserts ?? []).some(i => i.id === ins.id)
  const rest = (inserts ?? []).filter(i => i.id !== ins.id)
  if (!ins.code) return rest
  return had ? (inserts ?? []).map(i => (i.id === ins.id ? ins : i)) : [...rest, ins]
}

// The corrected DVW text, and per corrected scout line where it came from; edits and inserts whose line no
// longer holds their code are returned as stale and left out. Line ends stay as the file has them.
export function applyScoutEdits(text: string, s: ScoutEdits): { text: string; sources: ScoutSource[]; stale: { edits: CodeEdit[]; inserts: ScoutInsert[] } } {
  const edits = new Map((s.edits ?? []).map(e => [e.line, e]))
  const inserts = new Map<number, ScoutInsert[]>()
  for (const i of s.inserts ?? []) inserts.set(i.after, [...(inserts.get(i.after) ?? []), i])
  const usedEdits = new Set<number>(), usedInserts = new Set<string>()
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const out: string[] = [], sources: ScoutSource[] = []
  let section = '', idx = -1
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    if (l.startsWith('[')) section = l
    if (section !== '[3SCOUT]' || !l || l.startsWith('[')) { out.push(raw); continue }
    idx++
    const c = raw.split(';')
    const original = c[0].trim()
    const e = edits.get(idx)
    let keep = true
    if (e && e.from === original) {
      usedEdits.add(idx)
      if (e.to === '') keep = false
      else {
        c[0] = e.to
        if (e.start !== undefined || e.end !== undefined) while (c.length < 7) c.push('')
        if (e.start !== undefined) c[4] = e.start
        if (e.end !== undefined) c[6] = e.end
      }
    }
    if (keep) { out.push(c.join(';')); sources.push({ line: idx, original }) }
    for (const ins of inserts.get(idx) ?? []) {
      if (ins.from !== original || !validCode(ins.code)) continue
      usedInserts.add(ins.id)
      const n = raw.split(';')
      n[0] = ins.code
      while (n.length < 7) n.push('')
      n[4] = ins.start ?? ''; n[6] = ins.end ?? '' // its own clicks, if any were put
      if (n.length > 12) n[12] = String(Math.round(ins.time * 10) / 10) // tenths, as a .vsm's DVW text has them
      out.push(n.join(';'))
      sources.push({ line: idx, original: ins.code, insert: ins.id })
    }
  }
  return {
    text: out.join(nl), sources,
    stale: { edits: (s.edits ?? []).filter(e => !usedEdits.has(e.line)), inserts: (s.inserts ?? []).filter(i => !usedInserts.has(i.id)) },
  }
}

// A play's code, DataVolley's layout: side, jersey (2), skill, hit type, evaluation, attack combination or
// setter call (2), target attacker, start zone, end zone, end sub-zone, skill type, players, special, then
// anything custom. '~' fills a place left empty.
export interface CodeParts {
  side: '*' | 'a'
  jersey: number
  skill: string // S R A B D E
  type: string // hit type: H M Q T U N O
  effect: string // # + ! - / =
  combo: string // two letters, or ''
  target: string
  startZone: string // 1-9, or ''
  endZone: string
  endSub: string // A-D, or ''
  rest: string // whatever follows, kept as it was
}

export const SKILLS = ['S', 'R', 'A', 'B', 'D', 'E'] as const
export const TYPES = ['H', 'M', 'Q', 'T', 'U', 'N', 'O'] as const
export const EFFECTS = ['#', '+', '!', '-', '/', '='] as const

const at = (code: string, i: number) => { const c = code.charAt(i); return c === '~' ? '' : c }

export function codeParts(code: string): CodeParts {
  return {
    side: code.charAt(0) === 'a' ? 'a' : '*',
    jersey: parseInt(code.substring(1, 3)) || 0,
    skill: code.charAt(3), type: at(code, 4), effect: at(code, 5),
    combo: code.substring(6, 8).replace(/~/g, '').length === 2 ? code.substring(6, 8) : '',
    target: at(code, 8), startZone: at(code, 9), endZone: at(code, 10), endSub: at(code, 11),
    rest: code.substring(12),
  }
}

// The code back from its parts, with trailing empty places left off as DataVolley does.
export function partsCode(p: CodeParts): string {
  const f = (v: string) => v || '~'
  const head = `${p.side}${String(p.jersey).padStart(2, '0')}${p.skill}${f(p.type)}${f(p.effect)}`
  const tail = `${p.combo || '~~'}${f(p.target)}${f(p.startZone)}${f(p.endZone)}${f(p.endSub)}${p.rest}`
  return (head + tail).replace(/~+$/, '')
}

// Whether a code can stand for a play: side, a two-digit jersey, a skill, a hit type and an evaluation.
export function validCode(code: string): boolean {
  return /^[*a]\d\d[SRABDE][HMQTUNO~][#+!\-/=~]/.test(code) && !/[;\r\n]/.test(code)
}

// How many corrections a match has.
export const editCount = (s: ScoutEdits) => (s.edits?.length ?? 0) + (s.inserts?.length ?? 0)
