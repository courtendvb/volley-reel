// DVW parser. Pure: no file or DOM access.
// Ported from HTH_videoviewer/dvw-parser.js and m0/lib/dvw.mjs (docs/design.md §7).
import type { ParsedDVW, Play, Player, Rally, Side, Team } from './types'

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
    if (section !== '[3SCOUT]') continue

    const code = c[0]
    if (!code) continue
    const time = parseFloat(c[12])

    if (code.startsWith('**') && /set/i.test(code)) {
      if (score.home > score.away) sets.home++
      else if (score.away > score.home) sets.away++
      setsEnded++
      score = { home: 0, away: 0 }
      rally = null
      continue
    }
    if (/^[*a]p\d/i.test(code)) {
      const m = code.match(/(\d{1,2}):(\d{1,2})/)
      if (!m) continue
      const next = { home: +m[1], away: +m[2] }
      const wonBy: Side = next.home > score.home ? '*' : next.away > score.away ? 'a' : (code[0].toLowerCase() as Side)
      if (rally) { rally.pointTime = isNaN(time) ? null : time; rally.wonBy = wonBy }
      score = next
      rally = null
      continue
    }

    const skill = code.charAt(3)
    if (!'SRABDE'.includes(skill)) continue
    const jersey = parseInt(code.substring(1, 3))
    // Fixed skip rule: no jersey (team codes like "a$$") or no video time.
    if (isNaN(jersey) || isNaN(time)) continue

    let rH: number | null = parseInt(c[9])
    if (!isNaN(rH)) homeRot = rH; else rH = homeRot
    let rA: number | null = parseInt(c[10])
    if (!isNaN(rA)) awayRot = rA; else rA = awayRot

    const setNum = setsEnded + 1
    if (skill === 'S') {
      rally = { id: rallies.length, setNum, serveTime: time, lastActionTime: time, pointTime: null, wonBy: null }
      rallies.push(rally)
    }
    if (rally) rally.lastActionTime = Math.max(rally.lastActionTime, time)

    const side = code.charAt(0) as Side
    const p = players[`${side}${jersey}`]
    plays.push({
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
      rallyId: rally ? rally.id : null,
    })
  }

  while (teams.length < 2) teams.push({ code: '?', name: '' })
  const allHome = plays.length > 0 && plays.every(p => p.side === '*')
  return { date, teams: [teams[0], teams[1]], players, plays, rallies, allHome }
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
