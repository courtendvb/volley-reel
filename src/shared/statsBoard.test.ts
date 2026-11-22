import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { boardPlayers, boardSlide } from './board'
import { STAT_COLUMNS, statRows, statsSlide } from './statsBoard'

// Five rallies (as in compare.test.ts): a home serve received (+) and killed by the away team; an away
// serve error; a home ace (jump float, M); a reception error (=) by the away team; an away attack error;
// an away attack blocked by the home team. The away team's receptions are all of jump serves (Q).
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

describe('the player stats tables', () => {
  const d = parseDVW(DVW)
  const table = (kind: 'serve' | 'attack' | 'reception', team: string) => {
    const players = boardPlayers([d], 'P', undefined, kind).filter(p => p.team === team)
    return { players, rows: statRows(kind, players.map(p => ({ player: p.player, plays: p.plays, wins: p.wins ?? new Set() }))) }
  }
  it('counts serves: aces, break points, errors and the serve index', () => {
    const { rows } = table('serve', 'HTH')
    expect(STAT_COLUMNS.serve.map(c => c.label)).toEqual(['STot', 'Ace', 'BP%', 'ERR%', 'SERVE INDEX'])
    // #02: an ace (#) and three + serves, all four rallies won; #01: a - serve, the rally lost.
    expect(rows).toEqual([
      { name: '#02 TWO', values: ['4', '1', '100.0%', '0.0%', '0.591'] },
      { name: '#01 ONE', values: ['1', '0', '0.0%', '0.0%', '0.281'] },
    ])
  })
  it('counts attacks: kills, kill rate and efficiency', () => {
    expect(table('attack', 'OPP').rows).toEqual([{ name: '#09 NINE', values: ['3', '1', '33.3%', '-33.3%'] }])
  })
  it('counts receptions in all, then of spin and float serves', () => {
    expect(STAT_COLUMNS.reception.map(c => `${c.group ?? ''}${c.label}`)).toEqual(['ALLRec', 'SPINRec', 'SPIN#+%', 'SPIN#%', 'SPINAce%', 'SPINSO%', 'FLOATRec', 'FLOAT#+%', 'FLOAT#%', 'FLOATAce%', 'FLOATSO%'])
    // Four receptions of jump serves: + (side out), = (aced), # (lost), # (lost to the block).
    expect(table('reception', 'OPP').rows).toEqual([{ name: '#09 NINE', values: ['4', '4', '75.0%', '50.0%', '25.0%', '25.0%', '0', '–', '–', '–', '–'] }])
  })
  it('lays out a heading and one group for the table', () => {
    const { players } = table('reception', 'OPP')
    const anns = boardSlide(players, 'P', { split: false, stat: 'reception' }, {}).annotations
    const texts = anns.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    expect(texts[0]).toBe('OPP RECEPTION STATS TOTAL (LAST 1 MATCH)')
    expect(texts).toEqual(expect.arrayContaining(['ALL', 'SPIN', 'FLOAT', 'Player', '#09 NINE', 'SO%']))
    expect(new Set(anns.slice(1).map(a => a.groupId)).size).toBe(1)
  })
  it('keeps the top players by attempts', () => {
    const { players } = table('serve', 'HTH')
    expect(statRows('serve', players.map(p => ({ player: p.player, plays: p.plays, wins: p.wins ?? new Set() })), 1).map(r => r.name)).toEqual(['#02 TWO'])
  })
  it('colours the table as chosen, every other row in the second colour', () => {
    const rows = ['A', 'B', 'C'].map(name => ({ name, values: ['1', '2', '3', '4'] }))
    const anns = statsSlide('attack', 'HTH', 1, rows, '#0F172A', { head: '#000000', name: '#FFFFFF', value: '#FFFFFF', stripe: '#DDDDDD' })
    const fill = (text: string) => anns.filter(a => a.kind === 'text' && a.text === text).map(a => (a.kind === 'text' ? [a.box?.fill, a.color] : []))
    expect(fill('ATot')).toEqual([['#000000', '#FFFFFF']]) // white on a dark header
    expect(fill('A')).toEqual([['#FFFFFF', '#0F172A']]) // dark on a light name
    expect(fill('1').map(f => f[0])).toEqual(['#FFFFFF', '#DDDDDD', '#FFFFFF'])
    const plain = statsSlide('attack', 'HTH', 1, rows, '#0F172A', { head: '#000000', name: '#FFFFFF', value: '#FFFFFF', stripe: null })
    expect(plain.filter(a => a.kind === 'text' && a.text === '1').map(a => (a.kind === 'text' ? a.box?.fill : ''))).toEqual(['#FFFFFF', '#FFFFFF', '#FFFFFF'])
  })
})
