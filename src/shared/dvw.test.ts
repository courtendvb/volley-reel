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
  // Column 3 on attack lines is DataVolley's own phase: r reception, s / p transition.
  it.each(files)('%s: reception and transition attacks agree with the scout column', f => {
    const text = readFileSync(join(dir!, f), 'latin1')
    const cols = text.split(/\r?\n/).map(l => l.trim().split(';'))
      .filter(c => /^[*a]\d\dA/.test(c[0]) && !isNaN(parseFloat(c[12]))).map(c => c[2])
    const ours = parseDVW(text).plays.filter(p => p.skill === 'A').map(p => p.phase)
    expect(ours.length).toBe(cols.length)
    expect(ours.map((ph, i) => (ph && cols[i] ? `${ph}${cols[i] === 'r' ? 'r' : 't'}` : 'ok')).filter(x => x !== 'ok' && x[0] !== x[1])).toEqual([])
  })
})

describe('a set and its attack', () => {
  it('keeps the tempo of the same team\u0027s attack right after it', () => {
    const d = parseDVW(['[3TEAMS]', 'HTH;HOME;0;;', 'TGB;AWAY;0;;', '[3SCOUT]', 'a04SM+~~~58A;;;;;;;14.00.01;1;1;1;1;201;;', '*21EQ+K8F~8C;;;;;;;14.00.03;1;1;1;1;203;;', '*07AU+P1~41BH3;;;;;;;14.00.04;1;1;1;1;204;;', '*21EH+K8F~8C;;;;;;;14.00.06;1;1;1;1;206;;', ''].join(String.fromCharCode(10)))
    expect(d.plays.filter(p => p.skill === 'E').map(p => p.setTo ?? null)).toEqual(['U', null])
  })
})

describe('possibility', () => {
  const marked = (scout: string) => parseDVW(`[3TEAMS]
HTH;HOME;0;;
TGB;AWAY;0;;
[3SCOUT]
${scout}
`).plays.map(p => `${p.side}${p.skill}${p.possibility ? ':P' : ''}`)
  const line = (code: string, sec: number) => `${code};;;;;;;14.00.${String(sec).padStart(2, '0')};1;1;1;1;${200 + sec};;`
  const serve = line('*04SM+~~~58A', 1), rec = line('a01RM+~~~58A', 2), set = line('a02EH+K8F~8C', 3), oppAttack = line('a07AH+P1~41BH', 4)

  it('marks the serve, the blocks before the first attack, and that attack only', () => {
    const block = line('*03BH+~~~~~', 5), dig = line('*02DH+~~~~~', 6), mySet = line('*05EH+K8F~8C', 7), first = line('*07AH+P1~41BH', 8), second = line('*07AH-P1~41BH', 9), lateBlock = line('*03BH-~~~~~', 10)
    expect(marked([serve, rec, set, oppAttack, block, dig, mySet, first, lateBlock, second].join('\n')))
      .toEqual(['*S:P', 'aR', 'aE', 'aA', '*B:P', '*D', '*E', '*A:P', '*B', '*A'])
  })
  it('marks nothing without an attack by the serving team', () => {
    expect(marked([serve, rec, set, oppAttack, line('*03BH#~~~~~', 5)].join('\n'))).toEqual(['*S', 'aR', 'aE', 'aA', '*B'])
  })
})

describe('clicks', () => {
  const D = parseDVW(`[3TEAMS]
HTH;HOME;0;;
TGB;AWAY;0;;
[3SCOUT]
a04SM+~~~58A;;;;0619;-1-1;7348;14.00.07;1;4;2;1;214;;
*05RM-~~~58AR;;;;;;;14.00.09;1;4;2;1;217;;
*07AH#P1~41BH3;s;r;;4717;-1-1;8017;14.00.11;1;4;2;1;218;;
a06BH=~~~~;s;;;;;;14.00.13;1;4;2;1;220;;
*08DH+~~~41B;s;;;;;;14.00.14;1;4;2;1;221;;
`)
  const [serve, reception, attack, block, cover] = D.plays

  it("sends a set without an end click to the same team's next attack", () => {
    const d = parseDVW(`[3TEAMS]
HTH;HOME;0;;
TGB;AWAY;0;;
[3SCOUT]
a04SM+~~~58A;;;;0619;-1-1;7348;14.00.07;1;4;2;1;214;;
*21EH+K8F~8C;;;;3548;;;14.00.11;1;4;2;1;218;;
*07AH#P1~41BH3;s;r;;4717;-1-1;8017;14.00.11;1;4;2;1;218;;
`)
    const [, set, attack] = d.plays
    expect(set.endClick).toEqual(attack.startClick)
  })

  it('keeps where the scout clicked', () => {
    expect(serve.startClick?.v).toBeCloseTo(-0.0075)
    expect(attack.endClick?.v).toBeGreaterThan(0.5)
    expect(block.startClick ?? null).toBeNull()
  })

  it('gives a reception the serve seen from the other side', () => {
    expect(reception.startClick!.u).toBeCloseTo(1 - serve.startClick!.u)
    expect(reception.startClick!.v).toBeCloseTo(1 - serve.startClick!.v)
    expect(reception.endClick!.v).toBeCloseTo(1 - serve.endClick!.v)
  })

  it("doesn't give a dig of the team's own blocked attack its own shot", () => {
    expect(cover.side).toBe(attack.side)
    expect(cover.startClick ?? null).toBeNull()
  })
})

describe('front row', () => {
  const lines = (lineups: string) => parseDVW(`[3TEAMS]
HTH;HOME;;;;
OPP;AWAY;;;;
[3PLAYERS-H]
0;2;2;;;;;;TAN-TAR-02;TANAKA;Taro;
[3PLAYERS-V]
1;9;16;;;;;;;BROWN;Bob;
[3SCOUT]
*02SQ-~~~16A;;;;;;;;1;1;1;1;100;;${lineups}
`).plays[0]

  it('takes P2 to P4 of both lineups, by player key', () => {
    expect(lines('1;2;3;4;5;6;7;16;9;10;11;12;').front).toMatchObject({ 0: 'TAN-TAR-02', 1: '*3', 2: '*4', 3: 'a16', 5: 'a10', length: 6 })
  })
  it('leaves it out for a file without lineups', () => {
    expect(lines('').front).toBeUndefined()
  })
})
