// DVW parser. Pure: no file or DOM access.
// Ported from HTH_videoviewer/dvw-parser.js and m0/lib/dvw.mjs (docs/design.md §7).
import type { ClickPoint, ParsedDVW, Play, Player, Rally, Side, Team } from './types'

export function parseDVW(text: string): ParsedDVW {
  const teams: Team[] = []
  const players: Record<string, Player> = {}
  const plays: Play[] = []
  const rallies: Rally[] = []
  let date: string | null = null
  let section = ''
  let score = { home: 0, away: 0 }
  const sets = { home: 0, away: 0 }
  let setsEnded = 0 // set number comes from the markers, not sets won, so odd files stay consistent
  let homeRot: number | null = null
  let awayRot: number | null = null
  let rally: Rally | null = null
  let contacts: { code: string; side: Side; skill: string; play?: Play }[] = [] // the rally so far, freeballs included
  // Each contact is the next one for the two before it.
  const touch = (x: { code: string; side: Side; skill: string; play?: Play }) => {
    for (const y of contacts.slice(-2)) y.play?.after.push(x.code)
    contacts.push(x)
  }
  const codeNames: Record<string, string> = {}

  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    if (l.startsWith('[')) { section = l; continue }
    if (!l) continue
    const c = l.split(';')

    if (section === '[3MATCH]') {
      if (date === null) date = parseDate(c[0])
      continue
    }
    if (section === '[3TEAMS]') {
      if (teams.length < 2) teams.push({ code: c[0].trim(), name: (c[1] || '').trim() })
      continue
    }
    if (section === '[3PLAYERS-H]' || section === '[3PLAYERS-V]') {
      const side: Side = section.includes('-H') ? '*' : 'a'
      const jersey = parseInt(c[1])
      if (isNaN(jersey)) continue
      const lastName = (c[9] || '').trim()
      const firstName = (c[10] || '').trim()
      players[`${side}${jersey}`] = { key: playerKey(c[8], lastName, firstName, jersey), side, jersey, lastName, firstName }
      continue
    }
    if (section === '[3ATTACKCOMBINATION]' || section === '[3SETTERCALL]') {
      const name = (section === '[3SETTERCALL]' ? c[2] : c[4])?.trim()
      if (c[0]?.trim() && name) codeNames[c[0].trim()] = name
      continue
    }
    if (section !== '[3SCOUT]') continue

    const code = c[0]
    if (!code) continue
    const time = parseFloat(c[12])

    if (code.startsWith('**') && /set/i.test(code)) {
      if (score.home > score.away) sets.home++
      else if (score.away > score.home) sets.away++
      setsEnded++
      score = { home: 0, away: 0 }
      rally = null; contacts = []
      continue
    }
    if (/^[*a]p\d/i.test(code)) {
      const m = code.match(/(\d{1,2}):(\d{1,2})/)
      if (!m) continue
      const next = { home: +m[1], away: +m[2] }
      const wonBy: Side = next.home > score.home ? '*' : next.away > score.away ? 'a' : (code[0].toLowerCase() as Side)
      if (rally) { rally.pointTime = isNaN(time) ? null : time; rally.wonBy = wonBy }
      score = next
      rally = null; contacts = []
      continue
    }

    const skill = code.charAt(3)
    if (!'SRABDEF'.includes(skill)) continue
    const jersey = parseInt(code.substring(1, 3))
    // Fixed skip rule: no jersey (team codes like "a$$") or no video time.
    if (isNaN(jersey) || isNaN(time)) continue
    const side = code.charAt(0) as Side
    // Freeballs are not plays (ids stay as they were), only context for the next one.
    if (skill === 'F') { if (rally) touch({ code, side, skill }); continue }

    let rH: number | null = parseInt(c[9])
    if (!isNaN(rH)) homeRot = rH; else rH = homeRot
    let rA: number | null = parseInt(c[10])
    if (!isNaN(rA)) awayRot = rA; else rA = awayRot

    const setNum = setsEnded + 1
    if (skill === 'S') {
      rally = { id: rallies.length, setNum, serveTime: time, lastActionTime: time, pointTime: null, wonBy: null }
      rallies.push(rally); contacts = []
    }
    if (rally) rally.lastActionTime = Math.max(rally.lastActionTime, time)

    const p = players[`${side}${jersey}`]
    // Each line lists both lineups, P1 to P6 (home in 14–19, away in 20–25): P2–P4 are the front row.
    const row = (s: Side, cols: string[]) => cols.map(x => parseInt(x)).filter(n => !isNaN(n)).map(n => players[`${s}${n}`]?.key ?? `${s}${n}`)
    const front = [...row('*', c.slice(15, 18)), ...row('a', c.slice(21, 24))]
    const play: Play = {
      id: plays.length,
      fingerprint: `${setNum}|${score.home}-${score.away}|${code}|${time}`,
      code,
      time,
      side,
      jersey,
      playerKey: p ? p.key : `${side}${jersey}`,
      skill,
      effect: code.charAt(5),
      setNum,
      setsBefore: { ...sets },
      score: { ...score },
      homeRot: rH,
      awayRot: rA,
      startZone: zone(code.charAt(9)),
      endZone: zone(code.charAt(10)),
      // A set's coded zone is where it was set from, and its first click is that spot.
      startSub: clickSub(c[4], zone(code.charAt(9))),
      endSub: /[A-D]/.test(code.charAt(11)) ? code.charAt(11) : clickSub(skill === 'E' ? c[4] : c[6], zone(code.charAt(10))),
      startClick: clickPoint(c[4]),
      endClick: clickPoint(c[6]),
      rallyId: rally ? rally.id : null,
      before: rally ? contacts.slice(-2).map(x => x.code).reverse() : [],
      phase: rally && skill !== 'S' ? phaseOf(contacts, side, skill) : null,
      after: [],
      ...(front.length ? { front } : {}),
    }
    plays.push(play)
    if (rally) touch({ code, side, skill, play })
  }

  // A set without a click for where it went goes to the attack that follows it, when it is the same
  // team's; that attack's tempo also shapes the set's flight.
  for (const p of plays) {
    const q = plays[p.id + 1]
    if (p.skill !== 'E' || q?.skill !== 'A' || q.side !== p.side || q.rallyId !== p.rallyId) continue
    if (!p.endClick) p.endClick = q.startClick
    p.setTo = q.code.charAt(4)
  }

  // Receptions and digs have no clicks of their own: the ball came along the other team's last serve
  // or attack, seen from this side. Not when that shot was this team's own (a dig of a blocked attack).
  for (const p of plays) {
    if (p.rallyId === null || (p.skill !== 'R' && p.skill !== 'D')) continue
    for (let i = p.id - 1; i >= 0 && plays[i].rallyId === p.rallyId; i--) {
      const q = plays[i]
      if (q.skill !== 'S' && q.skill !== 'A') continue
      if (q.side !== p.side) { p.startClick = turned(q.startClick); p.endClick = turned(q.endClick); p.shotCode = q.code }
      break
    }
  }

  markPossibilities(plays)
  markReceptions(plays)

  while (teams.length < 2) teams.push({ code: '?', name: '' })
  const allHome = plays.length > 0 && plays.every(p => p.side === '*')
  return { date, teams: [teams[0], teams[1]], players, plays, rallies, allHome, codeNames }
}

// A possibility: the serving team got an attack of its own out of the rally. Its serve, its blocks
// up to that attack and the attack itself are marked; later attacks in the rally are not.
function markPossibilities(plays: Play[]): void {
  const rallies = new Map<number, Play[]>()
  for (const p of plays) if (p.rallyId !== null) rallies.set(p.rallyId, [...(rallies.get(p.rallyId) ?? []), p])
  for (const rally of rallies.values()) {
    const serve = rally.find(p => p.skill === 'S')
    if (!serve) continue
    const attack = rally.find(p => p.skill === 'A' && p.side === serve.side)
    if (!attack) continue
    for (const p of rally) if (p === serve || p === attack || (p.skill === 'B' && p.side === serve.side && p.id < attack.id)) p.possibility = true
  }
}

// The reception phase's plays carry their reception's evaluation, to search attacks by it.
function markReceptions(plays: Play[]): void {
  const received = new Map<number, string>()
  for (const p of plays) if (p.skill === 'R' && p.rallyId !== null) received.set(p.rallyId, p.effect)
  for (const p of plays) if (p.phase === 'r' && p.rallyId !== null && received.has(p.rallyId)) p.recEffect = received.get(p.rallyId)
}

// Reception phase: the receiving team's contacts from its reception until the ball goes to the other
// side (the reception attack and its set). Everything else after the serve is transition. Agrees
// with the r / s / p column DataVolley writes on attacks, in every attack of a season's files.
// Stopping at an attack or block as well keeps all-home files (one side for both teams) right.
function phaseOf(contacts: { side: Side; skill: string }[], side: Side, skill: string): 'r' | 't' {
  if (skill === 'R') return 'r'
  for (let i = contacts.length - 1; i >= 0 && contacts[i].side === side && !'AB'.includes(contacts[i].skill); i--) if (contacts[i].skill === 'R') return 'r'
  return 't'
}

// Same person across matches: DataVolley player ID with the scrimmage "-a" suffix removed.
export function playerKey(rawId: string | undefined, lastName: string, firstName: string, jersey: number): string {
  const id = (rawId || '').trim()
  return id ? id.replace(/-a$/i, '') : `${lastName}|${firstName}|${jersey}`
}

// "YANAKITA" or "YANAKITA Y." — the initial only when the surname repeats on that side.
export function displayName(players: Record<string, Player>, side: Side, jersey: number): string {
  const p = players[`${side}${jersey}`]
  if (!p) return `#${jersey}`
  const clash = Object.values(players).some(o => o !== p && o.side === side && o.lastName === p.lastName)
  return clash && p.firstName ? `${p.lastName} ${p.firstName.charAt(0)}.` : p.lastName || p.firstName
}

// DataVolley writes dd/mm/yyyy.
function parseDate(s: string | undefined): string | null {
  const m = (s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

function zone(ch: string): number | null {
  return ch >= '1' && ch <= '9' ? +ch : null
}

// Where the scout clicked (start and end columns on serves, sets and attacks): a 100 × 100 grid
// as row * 100 + column + 1, seen by the player's team from behind its own end line. Columns span
// 4 m-units across (the court is 0.5–3.5), rows 7 along (court 0.5–6.5, net at 3.5). Checked against
// the coded zones and sub-zones of a season's files: 87–97% agree.
function clickPoint(raw: string | undefined): ClickPoint | null {
  const i = parseInt(raw ?? '')
  if (!(i > 0)) return null
  const row = Math.floor((i - 1) / 100), col = (i - 1) % 100
  return { u: (((col + 0.5) * 4) / 100 - 0.5) / 3, v: (((row + 0.5) * 7) / 100 - 0.5) / 6 } // v: own end line 0, net 0.5
}

// The same place seen from the other side of the net.
const turned = (p: ClickPoint | null | undefined): ClickPoint | null => (p ? { u: 1 - p.u, v: 1 - p.v } : null)

const OWN = [[5, 6, 1], [7, 8, 9], [4, 3, 2]] // from the own end line toward the net, left to right
const OPP = [[2, 3, 4], [9, 8, 7], [1, 6, 5]] // from the net toward the far end line

// The sub-zone of a click, when it falls in the coded zone (else the click and the code disagree).
// Own half: A back right, B front right, C front left, D back left; the other half is the same
// seen from its own side.
function clickSub(raw: string | undefined, coded: number | null): string | null {
  const p = clickPoint(raw)
  if (!p || coded === null || p.u < 0 || p.u >= 1 || p.v < 0 || p.v >= 1) return null
  const c = Math.floor(p.u * 3), r = Math.floor(p.v * 6), su = p.u * 3 - c, sv = p.v * 6 - r
  if ((r < 3 ? OWN[r][c] : OPP[r - 3][c]) !== coded) return null
  if (r < 3) return sv < 0.5 ? (su < 0.5 ? 'D' : 'A') : (su < 0.5 ? 'C' : 'B')
  return sv < 0.5 ? (su < 0.5 ? 'B' : 'C') : (su < 0.5 ? 'A' : 'D')
}
