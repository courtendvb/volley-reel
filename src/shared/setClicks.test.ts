import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { setChart } from './setChart'

// One rally: a reception, the set with the clicks given, and the attack hit at 4717.
const rally = (start: string, end: string) => parseDVW(`[3TEAMS]
HTH;HOME;0;;
TGB;AWAY;0;;
[3SCOUT]
a04SM+~~~58A;;;;0619;-1-1;7348;14.00.07;1;4;2;1;214;;
*05RM-~~~58AR;;;;;;;14.00.09;1;4;2;1;217;;
*21EH+K8F~3C;;;;${start};-1-1;${end};14.00.11;1;4;2;1;218;;
*07AH#P1~41BH3;s;r;;4717;-1-1;8017;14.00.11;1;4;2;1;218;;
*p01:00;;;;;;;14.00.24;1;4;2;1;231;;
`)
const setOf = (d: ReturnType<typeof parseDVW>) => d.plays.find(p => p.skill === 'E')!
const near = (a: { u: number; v: number } | null | undefined, b: { u: number; v: number } | null | undefined) => !!a && !!b && Math.abs(a.u - b.u) < 1e-9 && Math.abs(a.v - b.v) < 1e-9

describe("a set's clicks", () => {
  it('keeps both as they are: where it was given from, where it went', () => {
    const d = rally('4858', '4937'), s = setOf(d)
    expect(s.startClick!.v).toBeGreaterThan(0.4)
    expect(near(s.startClick, s.endClick)).toBe(false)
  })
  it('reads a lone click at the attack as where the set went, else as where it was given from', () => {
    const atHit = setOf(rally('', '4717')), alsoAtHit = setOf(rally('4718', ''))
    const attack = rally('', '4717').plays.find(p => p.skill === 'A')!
    expect(atHit.startClick).toBeNull()
    expect(near(atHit.endClick, attack.startClick)).toBe(true)
    expect(alsoAtHit.startClick).toBeNull() // in the first column, but at the attack: where it went
    const away = setOf(rally('4858', ''))
    expect(away.startClick).not.toBeNull()
    expect(near(away.endClick, attack.startClick)).toBe(true) // where it went: the attack's spot, as before
  })
  it("draws a set's point where it was given from only, never where it went", () => {
    const point = (d: ReturnType<typeof parseDVW>) => setChart(setOf(d), d.plays)!.dots[0]
    expect(point(rally('', '')).at).toBeNull() // no click: counted, no point
    expect(point(rally('', '4717')).at).toBeNull()
    expect(point(rally('4858', '4937')).at).not.toBeNull()
  })
})
