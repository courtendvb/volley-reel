import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { better, SKILL_ROWS, skillCounts } from './compare'

// Five rallies: a home serve received and killed by the away team; an away serve error; a home ace;
// a reception error (=) by the away team; an away attack error; an away attack blocked by the home team.
const DVW = `[3MATCH]
01/11/2026;11.00.43;;2026/27;;;;;1250;1;Z;;;;;
[3TEAMS]
HTH;HOME;1;;;;;;;
OPP;AWAY;0;;;;;;;
[3PLAYERS-H]
0;1;1;5;;;;;H-ONE;ONE;Home;;;2;False;
0;2;2;*;;;;;H-TWO;TWO;Home;;L;1;False;
[3PLAYERS-V]
1;9;3;1;;;;;A-NINE;NINE;Away;;;4;False;
[3SCOUT]
*01SQ-~~~16A;;;;;;;;1;1;1;1;100;;
a09RQ+~~~16AR;;;;;;;;1;1;1;1;102;;
a09AQ#PA~36BH1;;;;;;;;1;1;1;1;104;;
ap00:01;;;;;;;;1;1;1;1;114;;
a09SQ=~~~15B;;;;;;;;1;1;2;1;130;;
*p01:01;;;;;;;;1;1;2;1;140;;
*02SM#~~~16D;;;;;;;;1;1;2;1;150;;
*p02:01;;;;;;;;1;1;2;1;160;;
*02SQ+~~~16D;;;;;;;;1;1;2;1;170;;
a09RQ=~~~16D;;;;;;;;1;1;2;1;172;;
*p03:01;;;;;;;;1;1;2;1;174;;
*02SQ+~~~16D;;;;;;;;1;1;2;1;180;;
a09RQ#~~~16D;;;;;;;;1;1;2;1;182;;
a09AQ=PA~36BH1;;;;;;;;1;1;2;1;184;;
*p04:01;;;;;;;;1;1;2;1;186;;
*02SQ+~~~16D;;;;;;;;1;1;2;1;190;;
a09RQ#~~~16D;;;;;;;;1;1;2;1;192;;
a09AQ/PA~36BH1;;;;;;;;1;1;2;1;194;;
*01BQ#~~~16D;;;;;;;;1;1;2;1;195;;
*p05:01;;;;;;;;1;1;2;1;196;;
`

describe('the skill comparison', () => {
  const d = parseDVW(DVW)
  const home = skillCounts([{ d, side: '*', label: '' }]), away = skillCounts([{ d, side: 'a', label: '' }])
  const show = (c: typeof home) => Object.fromEntries(SKILL_ROWS.map(r => { const v = r.value(c); return [r.label, v === null ? '' : r.format(v)] }))
  it('counts each team over its own matches', () => {
    expect(home).toMatchObject({ matches: 1, sets: 1, oppServe: 1, soWon: 1, serve: 5, bpWon: 4, ace: 1, serveErr: 0, serveGood: 3, blockPts: 1, attack: 0, rec: 0 })
    expect(show(home)).toEqual({ 'SO%': '100.0%', 'BP%': '80.0%', 'ATTACK KILL%': '', 'ATTACK EFF': '', 'SERVE INDEX': '35.0', 'ACE%': '20.0%', 'ERR%': '0.0%', 'RECEPTION#+%': '', 'BLOCK PTS/SET': '1.00' })
    expect(show(away)).toEqual({ 'SO%': '20.0%', 'BP%': '0.0%', 'ATTACK KILL%': '33.3%', 'ATTACK EFF': '-33.3%', 'SERVE INDEX': '-25.0', 'ACE%': '0.0%', 'ERR%': '100.0%', 'RECEPTION#+%': '75.0%', 'BLOCK PTS/SET': '0.00' })
  })
  it('adds up several matches', () => {
    const two = skillCounts([{ d, side: '*', label: '' }, { d, side: 'a', label: '' }])
    expect(two).toMatchObject({ matches: 2, sets: 2, oppServe: 6, soWon: 2, serve: 6, bpWon: 4, attack: 3, kill: 1 })
  })
  it('marks the better team, a lower error rate being the better', () => {
    const row = (id: string) => SKILL_ROWS.find(r => r.id === id)!
    expect(better(row('so'), home, away)).toBe('a')
    expect(better(row('err'), home, away)).toBe('a')
    expect(better(row('rec'), home, away)).toBe(null) // the home team has no receptions
    expect(better(row('block'), away, home)).toBe('b')
  })
})
