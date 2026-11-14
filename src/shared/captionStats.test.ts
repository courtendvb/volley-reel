import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { captionData, captionStats, DEFAULT_OVERLAY } from './overlay'

// The match of report.test.ts: a home serve the away #9 receives (+) and kills; #9's serve into the
// net; a home ace by #2.
const DVW = `[3MATCH]
01/11/2026;11.00.43;;2026/27;;;;;1250;1;Z;;;;;
[3TEAMS]
HTH;HOME;1;COACH Home;ASSIST Home;;;;;
OPP;AWAY;0;COACH Away;ASSIST Away;;;;;
[3MORE]
REF A;1200;;HIROSHIMA;GREEN ARENA;;;;;;
[3SET]
True; 8- 6;16-12;21-18;25-20;24;
True;;;;;;
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
`

const d = parseDVW(DVW)
const play = (side: '*' | 'a', jersey: number, skill: string) => d.plays.find(p => p.side === side && p.jersey === jersey && p.skill === skill)!

describe('captionStats', () => {
  it('gives a server ERR% and BP% over the match, with the counts', () => {
    expect(captionStats(d, play('a', 9, 'S'))).toEqual([{ label: 'ERR', value: '100%', count: '1/1' }, { label: 'BP', value: '0%', count: '0/1' }])
    expect(captionStats(d, play('*', 2, 'S'))).toEqual([{ label: 'ERR', value: '0%', count: '0/1' }, { label: 'BP', value: '100%', count: '1/1' }])
  })
  it('gives an attacker KILL% and EFF%', () => {
    expect(captionStats(d, play('a', 9, 'A'))).toEqual([{ label: 'KILL', value: '100%', count: '1/1' }, { label: 'EFF', value: '100%', count: '1/1' }])
  })
  it('gives a receiver #+% and #%', () => {
    expect(captionStats(d, play('a', 9, 'R'))).toEqual([{ label: '#+', value: '100%', count: '1/1' }, { label: '#', value: '0%', count: '0/1' }])
  })
  it('is only in the caption when switched on', () => {
    const s = DEFAULT_OVERLAY.playerCaption
    expect(captionData(d, play('a', 9, 'A'), s).stats).toBeUndefined()
    expect(captionData(d, play('a', 9, 'A'), { ...s, showStats: true }).stats).toHaveLength(2)
  })
})
