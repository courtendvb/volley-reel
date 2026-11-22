// Corrections to a scout file's codes, kept beside the match (Match.codeEdits) and laid over the file when it
// is read: the file itself is never written. An edit names the [3SCOUT] line (its index among that section's
// lines) and the code it had, so it applies only while the file still says that there; a file changed since
// leaves the edit out (staleEdits) rather than putting it on another play.
// Pure: no file or DOM access.

export interface CodeEdit { line: number; from: string; to: string }

// By line, for parseDVW.
export const editsByLine = (edits: CodeEdit[] | undefined): Map<number, CodeEdit> => new Map((edits ?? []).map(e => [e.line, e]))

// The edits after one play's code is set (to its original: the edit goes).
export function withCodeEdit(edits: CodeEdit[] | undefined, line: number, from: string, to: string): CodeEdit[] {
  const rest = (edits ?? []).filter(e => e.line !== line)
  return to === from ? rest : [...rest, { line, from, to }].sort((a, b) => a.line - b.line)
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

// The edits whose line no longer holds the code they were made on (the file was changed or replaced).
export function staleEdits(edits: CodeEdit[] | undefined, applied: Set<number>): CodeEdit[] {
  return (edits ?? []).filter(e => !applied.has(e.line))
}
