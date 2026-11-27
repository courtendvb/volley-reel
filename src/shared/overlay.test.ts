import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { DEFAULT_OVERLAY, can1080, captionData, exportHeight, lookTheme, overlaySettings, scoreboardData, withTeamColors } from './overlay'
import { localName, type PackInfo } from './pack'

// HTH away in this made-up match; SATO appears twice on HTH so names get an initial.
const D = parseDVW(`[3TEAMS]
OPP;OPPONENT;;;;
HTH;HIROSHIMA;;;;
[3PLAYERS-H]
0;9;1;;;;;;LEE-KIM-90;LEE;Kim;
[3PLAYERS-V]
1;1;15;;;;;;SAT-JIR-99;SATO;Jiro;
1;2;16;;;;;;SAT-KEN-00;SATO;Kenta;
[3SCOUT]
*09SQ-~~~16A;;;;;;;;1;1;1;1;100;;
a01RQ#~~~16AR;;;;;;;;1;1;1;1;102;;
ap00:01;;;;;;;;1;1;1;1;110;;
a02SQ#~~~16A;;;;;;;;1;1;1;1;120;;
ap00:02;;;;;;;;1;1;1;1;130;;
**1set;;;;;;;;1;1;1;1;131;;
*09SQ=~~~16A;;;;;;;;1;1;1;1;200;;
ap00:01;;;;;;;;1;1;1;1;210;;
`)
const OURS = ['HTH']

describe('scoreboard data', () => {
  it('puts our team on the left even when we are away, with the score before the rally', () => {
    expect(scoreboardData(D, D.plays[2], OURS)).toEqual({ left: 'HTH', right: 'OPP', ptsL: 1, ptsR: 0, setsL: 0, setsR: 0, winner: 'L' })
  })

  it('carries sets won and the rally winner per side', () => {
    expect(scoreboardData(D, D.plays[3], OURS)).toMatchObject({ setsL: 1, setsR: 0, ptsL: 0, ptsR: 0, winner: 'L' })
  })

  it('keeps home on the left when neither team is ours', () => {
    expect(scoreboardData(D, D.plays[0], [])).toMatchObject({ left: 'OPP', right: 'HTH', winner: 'R' })
  })
})

describe('lineup data', () => {
  it('has none when the rally has no lineups (this file has none)', () => {
    expect(scoreboardData(D, D.plays[0], OURS).lineup).toBeUndefined()
  })

  it('puts our team on the left, each side\'s jerseys P1 to P6', () => {
    const home = [1, 2, 3, 4, 5, 6], away = [11, 12, 13, 14, 15, 16]
    const d = { ...D, rallies: D.rallies.map(r => ({ ...r, court: { home, away } })) }
    // HTH is away here, so it is the left side with the away jerseys.
    expect(scoreboardData(d, d.plays[0], OURS).lineup).toEqual({ left: { code: 'HTH', jerseys: away }, right: { code: 'OPP', jerseys: home } })
    expect(scoreboardData(d, d.plays[0], []).lineup).toEqual({ left: { code: 'OPP', jerseys: home }, right: { code: 'HTH', jerseys: away } })
  })

  it('says which team is by the camera, from the grid\'s near team and the set', () => {
    const d = { ...D, rallies: D.rallies.map(r => ({ ...r, court: { home: [1, 2, 3, 4, 5, 6], away: [11, 12, 13, 14, 15, 16] } })) }
    const play = (setNum: number) => ({ ...d.plays[0], setNum, score: { home: 0, away: 0 } })
    // HTH (ours, left) is away; home near in set 1: the right-hand team is by the camera, then the left in set 2.
    expect(scoreboardData(d, play(1), OURS, { nearSet1: '*' }).lineup?.near).toBe('right')
    expect(scoreboardData(d, play(2), OURS, { nearSet1: '*' }).lineup?.near).toBe('left')
    expect(scoreboardData(d, play(1), OURS, { nearSet1: 'a' }).lineup?.near).toBe('left')
    expect(scoreboardData(d, play(1), OURS).lineup?.near).toBeUndefined() // no grid: ours below, as before
    expect(withTeamColors(scoreboardData(d, play(1), OURS, { nearSet1: '*' }), { HTH: '#C8102E' }).lineup?.near).toBe('right') // kept with the colors
  })

  it('carries the teams\' library colors by team code', () => {
    const d = { ...D, rallies: D.rallies.map(r => ({ ...r, court: { home: [1, 2, 3, 4, 5, 6], away: [11, 12, 13, 14, 15, 16] } })) }
    const sb = scoreboardData(d, d.plays[0], OURS)
    expect(withTeamColors(sb, { HTH: '#C8102E' }).lineup).toMatchObject({ left: { code: 'HTH', color: '#C8102E' }, right: { code: 'OPP' } })
    expect(withTeamColors(sb, {}).lineup?.left.color).toBeUndefined()
    expect(withTeamColors(scoreboardData(D, D.plays[0], OURS), { HTH: '#C8102E' }).lineup).toBeUndefined()
  })

  it('is off until switched on', () => {
    expect(DEFAULT_OVERLAY.lineup.enabled).toBe(false)
    expect(overlaySettings({ lineup: { enabled: true } }).lineup).toEqual({ enabled: true, anchor: 'br', scale: 1 })
  })
})

describe('caption data', () => {
  const s = DEFAULT_OVERLAY.playerCaption
  it('builds number, name with initial on a clash, and an upper-case skill line', () => {
    expect(captionData(D, D.plays[1], s)).toEqual({ number: 1, name: 'SATO J.', line: 'RECEPTION · PERFECT' })
  })

  it('drops parts that are switched off', () => {
    expect(captionData(D, D.plays[2], { ...s, showEvaluation: false, showNumber: false })).toEqual({ number: null, name: 'SATO K.', line: 'SERVE' })
    expect(captionData(D, D.plays[2], { ...s, showSkill: false, showEvaluation: false }).line).toBeNull()
  })

  it('uses per-clip overrides for name and line, ignoring blanks', () => {
    expect(captionData(D, D.plays[2], s, { name: 'Kenta', line: 'great serve' })).toMatchObject({ name: 'Kenta', line: 'GREAT SERVE' })
    expect(captionData(D, D.plays[2], s, { line: '  ' }).line).toBe('SERVE · ACE')
  })

  it("uses the video's name for the player in every clip, unless the clip has its own", () => {
    const key = D.plays[2].playerKey, names = { [key]: 'Kenta Sato' }
    expect(captionData(D, D.plays[2], s, undefined, names).name).toBe('Kenta Sato')
    expect(captionData(D, D.plays[2], s, { name: 'K. SATO' }, names).name).toBe('K. SATO') // the clip's own wins
    expect(captionData(D, D.plays[1], s, undefined, names).name).toBe('SATO J.') // another player
    expect(captionData(D, D.plays[2], s, undefined, { [key]: '  ' }).name).toBe('SATO K.') // blank: the DVW's
  })

  it("uses the player's name from a pack in every video, under the video's and the clip's", () => {
    const p = D.players[`${D.plays[2].side}${D.plays[2].jersey}`]
    const packs: PackInfo[] = [{ id: 'local', name: 'local', players: [], names: [localName({ key: p.key, team: D.teams[D.plays[2].side === '*' ? 0 : 1].code, jersey: p.jersey, lastName: p.lastName, firstName: p.firstName }, 'Kenta')] }]
    expect(captionData(D, D.plays[2], s, undefined, undefined, packs).name).toBe('Kenta')
    expect(captionData(D, D.plays[2], s, undefined, { [D.plays[2].playerKey]: 'K. Sato' }, packs).name).toBe('K. Sato') // the video's wins
    expect(captionData(D, D.plays[2], s, { name: 'KS' }, undefined, packs).name).toBe('KS') // the clip's wins
    expect(captionData(D, D.plays[1], s, undefined, undefined, packs).name).toBe('SATO J.') // another player
  })
})

describe('settings', () => {
  it('fills missing parts from the defaults', () => {
    const s = overlaySettings({ theme: { base: '#000000', accent: '#FFFFFF' }, scoreboard: { anchor: 'tr' } as never })
    expect(s.theme).toEqual({ base: '#000000', accent: '#FFFFFF' })
    expect(s.scoreboard).toMatchObject({ anchor: 'tr', enabled: true, showSets: true })
    expect(overlaySettings(undefined)).toEqual(DEFAULT_OVERLAY)
  })
})

describe('drawing helpers', () => {
  it('places elements by anchor with a 2.5% margin', async () => {
    const { place } = await import('./overlayDraw')
    expect(place('tl', 100, 50, 1280, 720)).toEqual({ x: 18, y: 18 })
    expect(place('br', 100, 50, 1280, 720)).toEqual({ x: 1162, y: 652 })
    expect(place('tc', 100, 50, 1280, 720)).toEqual({ x: 590, y: 18 })
  })

  it('mixes colors and picks readable text on the accent', async () => {
    const { mix, onColor } = await import('./overlayDraw')
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080')
    expect(onColor('#C8102E')).toBe('#FFFFFF')
    expect(onColor('#FACC15')).toBe('#111111')
  })
})

describe('the design of the overlays', () => {
  it('keeps a design picked, and leaves the first one unsaved', () => {
    expect(overlaySettings({ look: 'light' }).look).toBe('light')
    expect('look' in overlaySettings({ look: 'slant' })).toBe(false)
    expect('look' in overlaySettings(undefined)).toBe(false)
  })
  it('hands the drawing the colors with the design', () => {
    expect(lookTheme(overlaySettings({ look: 'float' }))).toEqual({ ...DEFAULT_OVERLAY.theme, look: 'float' })
    expect(lookTheme(DEFAULT_OVERLAY).look).toBe('slant')
  })
})

describe('export height', () => {
  const at = (h: 720 | 1080) => ({ output: { height: h } })
  it('offers 1080p only when every source is at least 1080 high', () => {
    expect(can1080([1080, 1080])).toBe(true)
    expect(can1080([2160])).toBe(true)
    expect(can1080([1080, 720])).toBe(false)
    expect(can1080([undefined])).toBe(false)
    expect(can1080([])).toBe(false)
  })
  it('makes 1080p only when picked and the sources allow it', () => {
    expect(exportHeight(at(1080), [1080])).toBe(1080)
    expect(exportHeight(at(1080), [1080, 720])).toBe(720)
    expect(exportHeight(at(720), [1080])).toBe(720)
  })
  it('reads a saved height, 720 when missing or odd', () => {
    expect(overlaySettings(undefined).output.height).toBe(720)
    expect(overlaySettings({ output: { height: 1080 } }).output.height).toBe(1080)
    expect(overlaySettings({ output: { height: 480 as 720 } }).output.height).toBe(720)
  })
})
