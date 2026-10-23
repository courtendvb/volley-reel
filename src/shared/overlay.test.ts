import { describe, expect, it } from 'vitest'
import { parseDVW } from './dvw'
import { DEFAULT_OVERLAY, captionData, overlaySettings, scoreboardData } from './overlay'

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
})

describe('settings', () => {
  it('fills missing parts from the defaults', () => {
    const s = overlaySettings({ theme: { base: '#000000', accent: '#FFFFFF' }, scoreboard: { anchor: 'tr' } as never })
    expect(s.theme).toEqual({ base: '#000000', accent: '#FFFFFF' })
    expect(s.scoreboard).toMatchObject({ anchor: 'tr', enabled: false, showSets: true })
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
