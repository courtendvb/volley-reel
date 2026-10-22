import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { displayName, parseDVW } from './dvw'

// Made-up names; the layout mirrors real VolleyStation exports.
const FIXTURE = `[3DATAVOLLEYSCOUT]
FILEFORMAT: 2.0
[3MATCH]
11/10/2026;09.40.18;;2026/27;;;;;1250;1;Z;;;;;
[3TEAMS]
HTH;HOME TEAM;2;Coach;Assistant;;;;;
OPP;AWAY TEAM;3;Coach;Assistant;;;;;
[3PLAYERS-H]
0;1;1;;;;;;TAN-TAR-02;TANAKA;Taro;
0;2;2;;;;;;SAT-JIR-99;SATO;Jiro;
0;3;3;;;;;;SAT-KEN-00;SATO;Kenta;
[3PLAYERS-V]
1;1;15;;;;;;SMI-JOH-95-a;SMITH;John;
1;9;16;;;;;;;BROWN;Bob;
[3SCOUT]
*P01>LUp;;;;;;;;1;1;1;1;;;
*01SQ-~~~16A;;;;;;;10.00.00;1;1;1;1;100;;
a09RQ+~~~16AR;;;;;;;10.00.02;1;;;1;102;;
a01AQ#PA~36BH1;;;;;;;10.00.04;1;;;1;104;;
a$$&H=;;;;;;;10.00.04;1;1;1;1;104;;
ap00:01;;;;;;;10.00.14;1;1;1;1;114;;
a01SQ=~~~15B;;;;;;;10.00.30;1;1;2;1;130;;
*p01:01;;;;;;;10.00.40;1;1;2;1;140;;
*02SM#~~~16D;;;;;;;10.00.50;1;1;2;1;;;
*p02:01;;;;;;;10.00.55;1;1;2;1;155;;
**1set;;;;;;;10.01.00;1;1;2;1;160;;
*03SQ#~~~16D;;;;;;;10.02.00;1;3;4;1;200;;
*p01:00;;;;;;;10.02.10;1;3;4;1;210;;
`

describe('parseDVW', () => {
  const d = parseDVW(FIXTURE)

  it('reads date and teams', () => {
    expect(d.date).toBe('2026-10-11')
    expect(d.teams.map(t => t.code)).toEqual(['HTH', 'OPP'])
  })

  it('keys players by DataVolley ID without the -a suffix, falling back to names', () => {
    expect(d.players['a1'].key).toBe('SMI-JOH-95')
    expect(d.players['a9'].key).toBe('BROWN|Bob|9')
  })

  it('skips team codes and lines without a video time, with stable ids', () => {
    expect(d.plays.map(p => p.code.slice(0, 4))).toEqual(['*01S', 'a09R', 'a01A', 'a01S', '*03S'])
    expect(d.plays.map(p => p.id)).toEqual([0, 1, 2, 3, 4])
    expect(parseDVW(FIXTURE).plays.map(p => p.fingerprint)).toEqual(d.plays.map(p => p.fingerprint))
  })

  it('carries rotation forward when a line leaves it blank', () => {
    expect(d.plays[1]).toMatchObject({ homeRot: 1, awayRot: 1 })
  })

  it('records the score before the rally and the rally winner', () => {
    expect(d.plays[3].score).toEqual({ home: 0, away: 1 })
    expect(d.rallies[0]).toMatchObject({ wonBy: 'a', lastActionTime: 104, pointTime: 114 })
    expect(d.rallies[1]).toMatchObject({ wonBy: '*' })
  })

  it('advances sets on the set marker and handles a final set without one', () => {
    expect(d.plays[4]).toMatchObject({ setNum: 2, setsBefore: { home: 1, away: 0 } })
    expect(d.rallies[2]).toMatchObject({ setNum: 2, wonBy: '*' })
  })

  it('flags files with every play coded as home', () => {
    expect(d.allHome).toBe(false)
    expect(parseDVW(FIXTURE.replace(/^a(\d\d[SRABDE])/gm, '*$1')).allHome).toBe(true)
  })

  it('adds the first initial only when a surname repeats on that side', () => {
    expect(displayName(d.players, '*', 1)).toBe('TANAKA')
    expect(displayName(d.players, '*', 2)).toBe('SATO J.')
    expect(displayName(d.players, 'a', 77)).toBe('#77')
  })
})

// Real files stay out of git; point VR_DVW_DIR at a folder of .dvw to run these.
const dir = process.env.VR_DVW_DIR
describe.skipIf(!dir || !existsSync(dir))('real DVW files', () => {
  const files = dir ? readdirSync(dir).filter(f => f.toLowerCase().endsWith('.dvw')) : []
  it.each(files)('%s parses with plays, rallies and stable ids', f => {
    const text = readFileSync(join(dir!, f), 'latin1')
    const a = parseDVW(text), b = parseDVW(text)
    expect(a.plays.length).toBeGreaterThan(0)
    expect(a.rallies.length).toBeGreaterThan(0)
    expect(b.plays.map(p => p.fingerprint)).toEqual(a.plays.map(p => p.fingerprint))
  })
})
