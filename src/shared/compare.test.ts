import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { better, compareRows, compareSlide, DEFAULT_COMPARE_ROWS, idsFor, rowsFor, SKILL_ROWS, skillCounts } from './compare'

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
  const show = (c: typeof home) => Object.fromEntries(compareRows().map(r => { const v = r.value(c); return [r.label, v === null ? '' : r.format(v)] }))
  it('counts each team over its own matches', () => {
    expect(home).toMatchObject({ matches: 1, sets: 1, oppServe: 1, soWon: 1, serve: 5, bpWon: 4, ace: 1, serveErr: 0, blockPts: 1, attack: 0, rec: 0 })
    expect(show(home)).toEqual({ 'SO%': '100.0%', '1ST BALL SO%': '', 'BP%': '80.0%', 'ATTACK KILL%': '', 'ATTACK EFF': '', 'SERVE INDEX': '0.529', 'SERVICE ACE%': '20.0%', 'SERVICE ERR%': '0.0%', 'RECEPTION#+%': '', 'BLOCK PTS/SET': '1.00', 'ERR PTS/SET': '0.00' })
    expect(show(away)).toEqual({ 'SO%': '20.0%', '1ST BALL SO%': '25.0%', 'BP%': '0.0%', 'ATTACK KILL%': '33.3%', 'ATTACK EFF': '-33.3%', 'SERVE INDEX': '0.000', 'SERVICE ACE%': '0.0%', 'SERVICE ERR%': '100.0%', 'RECEPTION#+%': '75.0%', 'BLOCK PTS/SET': '0.00', 'ERR PTS/SET': '3.00' })
  })
  it('counts the figures that can be added: possibilities, kills by phase, attack and reception errors', () => {
    const all = (c: typeof home) => Object.fromEntries(SKILL_ROWS.filter(r => !DEFAULT_COMPARE_ROWS.includes(r.id)).map(r => { const v = r.value(c); return [r.label, v === null ? '' : r.format(v)] }))
    // Home: five serves, the away team attacked out of four of them, and home never attacked.
    expect(all(home)).toMatchObject({ 'POSS%': '0.0%', 'POSSIBILITY/SET': '0.00', 'ATTACK ERR%': '', 'RECEPTION#%': '' })
    // Away: its serve error gave no possibility; three attacks after # or + receptions: a kill, an error, one blocked.
    expect(SKILL_ROWS.find(r => r.id === 'possSet')!.format(SKILL_ROWS.find(r => r.id === 'possSet')!.value({ ...home, poss: 3, sets: 2 })!)).toBe('1.50')
    expect(all(away)).toEqual({ 'POSS%': '0.0%', 'POSSIBILITY/SET': '0.00', 'KILL% #+ REC': '33.3%', 'KILL% -! REC': '', 'TRANSITION KILL%': '', 'ATTACK ERR%': '33.3%', 'BLOCKED%': '33.3%', 'RECEPTION#%': '50.0%', 'SERVICE ACE / MATCH': '0.00', 'BLOCK KILL / MATCH': '0.00' })
  })
  // Possibilities are the team's own (src/internal/README.md): offered only to an account allowed them.
  it('offers the possibility rows only to an account allowed them', () => {
    expect(rowsFor(true).map(r => r.id)).toEqual(SKILL_ROWS.map(r => r.id))
    expect(rowsFor(false).map(r => r.id)).toEqual(SKILL_ROWS.map(r => r.id).filter(id => id !== 'poss' && id !== 'possSet'))
    expect(idsFor(['poss', 'so', 'possSet', 'bp'], false)).toEqual(['so', 'bp'])
    expect(idsFor(['poss', 'so'], true)).toEqual(['poss', 'so'])
    expect(DEFAULT_COMPARE_ROWS.every(id => rowsFor(false).some(r => r.id === id))).toBe(true)
  })
  it('shows the rows picked in the order picked, the default when none are', () => {
    expect(compareRows().map(r => r.id)).toEqual(DEFAULT_COMPARE_ROWS)
    expect(compareRows([]).map(r => r.id)).toEqual(DEFAULT_COMPARE_ROWS)
    expect(compareRows(['errPts', 'poss', 'gone', 'so', 'poss']).map(r => r.id)).toEqual(['errPts', 'poss', 'so'])
    const side = { code: 'HTH', name: '', counts: home }, other = { code: 'OPP', name: '', counts: away }
    const labels = (ids?: string[]) => compareSlide(side, other, {}, '#000', ids).flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(labels(['poss', 'so'])).toEqual(expect.arrayContaining(['SO%', 'POSS%']))
    expect(labels(['poss', 'so'])).not.toContain('BP%')
    expect(labels()).toContain('ERR PTS/SET')
    // Top to bottom as picked.
    const rows = labels(['errPts', 'so']).filter(x => x === 'SO%' || x === 'ERR PTS/SET')
    expect(rows).toEqual(['ERR PTS/SET', 'SO%'])
  })
  it('weighs each serve by its evaluation for the serve index', () => {
    // - 0.281, # 1, + 0.455 three times: 2.646 over five serves.
    expect(home.serveWeight).toBeCloseTo(2.646, 6)
    expect(away.serveWeight).toBe(0)
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
    expect(row('blockPerMatch').value(home)).toBe(1) // one block point in one match
    expect(row('acePerMatch').value(home)).toBe(1)
    expect(better(row('errPts'), home, away)).toBe('a') // fewer points given
  })
})
