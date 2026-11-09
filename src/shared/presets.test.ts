import { describe, expect, it } from 'vitest'
import { DEFAULT_HOW, buildPreset, cleanDialogState, cleanPreset, lineupsMissing, makePreset, phaseMarker, presetLabels, presetLookups, presetReels, presetRefs, serveMarker, type Facing, type PresetLookups, type VideoPreset } from './presets'
import type { PlayRef } from './filter'
import type { ParsedDVW, Play, PlayerRole } from './types'

let n = 0
interface O { skill?: string; effect?: string; jersey: number; rot?: number; team?: 'our' | 'opp'; phase?: Play['phase']; recEffect?: string; combo?: string; dir?: 'up' | 'down' }
const ref = (o: O): PlayRef => ({
  matchId: 'm', teamRole: o.team ?? 'our', side: '*', teamCode: 'HTH', personKey: `P${o.jersey}`, name: `N${o.jersey}`,
  ourRot: o.rot ?? 1, oppRot: null, tempo: null, combo: o.combo ?? null, comboName: o.combo === 'X5' ? 'SHOOT' : null, hit: null, dir: o.dir ?? null,
  play: { id: n++, skill: o.skill ?? 'S', effect: o.effect ?? '+', jersey: o.jersey, phase: o.phase ?? null, recEffect: o.recEffect, startZone: 4, rallyId: null, setNum: 1, before: [], after: [] } as unknown as Play,
})
const roles: Record<number, PlayerRole> = { 1: 'S', 2: 'OH', 3: 'MB', 4: 'OP', 5: 'MB' }
// An attack's facing middles, by its id.
const facing: Record<number, Facing[]> = {}
const look: PresetLookups = { wonBy: () => null, roleOf: r => roles[r.play.jersey], middlesFacing: r => facing[r.play.id] ?? [] }
const titles = (s: { title: string }[]) => s.map(x => x.title)

describe('presets', () => {
  const serves = [ref({ jersey: 9, rot: 6 }), ref({ jersey: 3, rot: 5 }), ref({ jersey: 3, rot: 5 }), ref({ jersey: 12, rot: 1 }), ref({ jersey: 9, rot: 6 }), ref({ jersey: 9, rot: 6 })]

  it('makes a scene per server by rotation, count or jersey', () => {
    expect(titles(buildPreset('serve', { ...DEFAULT_HOW, serve: 'rotation' }, serves, look).scenes)).toEqual(['#12 N12', '#9 N9', '#3 N3'])
    expect(titles(buildPreset('serve', { ...DEFAULT_HOW, serve: 'count' }, serves, look).scenes)).toEqual(['#9 N9', '#3 N3', '#12 N12'])
    expect(titles(buildPreset('serve', { ...DEFAULT_HOW, serve: 'jersey' }, serves, look).scenes)).toEqual(['#3 N3', '#9 N9', '#12 N12'])
    expect(buildPreset('serve', DEFAULT_HOW, serves, look).scenes.map(s => s.items.length)).toEqual([1, 3, 2])
  })

  it('makes a scene per middle with the attacks faced in the front row, by where they came from', () => {
    const m3 = { key: 'M3', label: '#3 N3' }, m5 = { key: 'M5', label: '#5 N5' }
    const attacks = [
      ref({ skill: 'A', jersey: 10, team: 'opp', phase: 'r', recEffect: '#' }), ref({ skill: 'A', jersey: 10, team: 'opp', phase: 'r', recEffect: '-' }),
      ref({ skill: 'A', jersey: 11, team: 'opp', phase: 't' }), ref({ skill: 'A', jersey: 11, team: 'opp', phase: 'r' }), ref({ skill: 'A', jersey: 12, team: 'opp', phase: 't' }),
    ]
    facing[attacks[0].play.id] = [m5]; facing[attacks[1].play.id] = [m5]; facing[attacks[2].play.id] = [m3, m5]; facing[attacks[3].play.id] = [m5]
    const s = buildPreset('block', { ...DEFAULT_HOW, block: 'middle' }, attacks, look).scenes
    expect(titles(s)).toEqual(['#5 N5', '#3 N3'])
    expect(s[0].names).toEqual({ 1: '良いレセプション', 2: '悪いレセプション', 3: 'トランジション' })
    expect(s[0].counts).toEqual({ 1: 1, 2: 1, 3: 1 })
    expect(s[0].rest).toBe(1)
    expect(s[1].counts).toEqual({ 3: 1 })
  })

  it('marks an attack by where it came from, and a serve by its result', () => {
    expect(phaseMarker({ phase: 'r', recEffect: '#' } as Play)).toBe(1)
    expect(phaseMarker({ phase: 'r', recEffect: '/' } as Play)).toBe(2)
    expect(phaseMarker({ phase: 't' } as Play)).toBe(3)
    expect(phaseMarker({ phase: 'r' } as Play)).toBe(null)
    expect(['#', '+', '/', '!', '-', '='].map(effect => serveMarker({ effect } as Play))).toEqual([1, 2, 2, 3, 3, 4])
  })

  it('marks each server’s serves by result', () => {
    const s = buildPreset('serve', DEFAULT_HOW, [ref({ jersey: 9, effect: '#' }), ref({ jersey: 9, effect: '=' }), ref({ jersey: 9, effect: '-' })], look).scenes[0]
    expect(s.counts).toEqual({ 1: 1, 3: 1, 4: 1 })
    expect(s.names[1]).toBe('サービスエース')
  })

  it('makes block scenes per rotation, in the order a team rotates', () => {
    const blocks = [ref({ skill: 'B', jersey: 3, rot: 2 }), ref({ skill: 'B', jersey: 5, rot: 6 }), ref({ skill: 'B', jersey: 3, rot: 6 })]
    const s = buildPreset('block', { ...DEFAULT_HOW, block: 'rotation' }, blocks, look).scenes
    expect(titles(s)).toEqual(['ローテ 6', 'ローテ 2'])
    expect(s[0].names).toEqual({ 1: '#5 N5', 2: '#3 N3' })
  })

  it('makes attack scenes per attacker or per position', () => {
    const attacks = [2, 4, 2, 3, 1, 7, 2, 4].map(j => ref({ skill: 'A', jersey: j }))
    expect(titles(buildPreset('attack', { ...DEFAULT_HOW, attack: 'count' }, attacks, look).scenes)).toEqual(['#2 N2', '#4 N4', '#3 N3', '#1 N1', '#7 N7'])
    const s = buildPreset('attack', { ...DEFAULT_HOW, attack: 'position' }, attacks, look).scenes
    expect(titles(s)).toEqual(['アウトサイドヒッター', 'オポジット', 'ミドルブロッカー', 'セッター', 'その他'])
    expect(s[0].names).toEqual({ 1: '#2 N2' })
    expect(s[0].counts).toEqual({ 1: 3 })
  })

  it('makes attack scenes per attacker with a marker per attack code', () => {
    const attacks = [ref({ skill: 'A', jersey: 2, combo: 'V5' }), ref({ skill: 'A', jersey: 2, combo: 'X5' }), ref({ skill: 'A', jersey: 2, combo: 'X5' }), ref({ skill: 'A', jersey: 2 }), ref({ skill: 'A', jersey: 3, combo: 'X1' })]
    const s = buildPreset('attack', { ...DEFAULT_HOW, attack: 'combo' }, attacks, look).scenes
    expect(titles(s)).toEqual(['#2 N2', '#3 N3'])
    expect(s[0].names).toEqual({ 1: 'X5 SHOOT', 2: 'V5' })
    expect(s[0].counts).toEqual({ 1: 2, 2: 1 })
    expect(s[0].rest).toBe(1)
    expect(s[1].names).toEqual({ 1: 'X1' })
  })

  it('keeps only the plays going the way picked on court', () => {
    const all = [ref({ jersey: 1, dir: 'up' }), ref({ jersey: 2, dir: 'down' }), ref({ jersey: 3 })]
    expect(presetRefs('serve', DEFAULT_HOW, 'our', all, [], 'up').map(r => r.play.jersey)).toEqual([1])
    expect(presetRefs('serve', DEFAULT_HOW, 'results', [], all, 'down').map(r => r.play.jersey)).toEqual([2])
    expect(presetRefs('serve', DEFAULT_HOW, 'our', all, []).map(r => r.play.jersey)).toEqual([1, 2, 3])
  })

  it('gathers the preset’s plays for a team, or from the results', () => {
    const all = [ref({ jersey: 1 }), ref({ jersey: 2, team: 'opp' }), ref({ skill: 'A', jersey: 3 }), ref({ skill: 'A', jersey: 4, phase: 'r' })]
    expect(presetRefs('serve', DEFAULT_HOW, 'our', all, []).map(r => r.play.jersey)).toEqual([1])
    expect(presetRefs('serve', DEFAULT_HOW, 'opp', all, []).map(r => r.play.jersey)).toEqual([2])
    expect(presetRefs('sideout', DEFAULT_HOW, 'our', all, []).map(r => r.play.jersey)).toEqual([4])
    expect(presetRefs('attack', DEFAULT_HOW, 'results', all, all.slice(2, 3)).map(r => r.play.jersey)).toEqual([3])
    // A block video by middle: our middles face the other team's attacks.
    expect(presetRefs('block', DEFAULT_HOW, 'our', [...all, ref({ skill: 'A', jersey: 5, team: 'opp' })], []).map(r => r.play.jersey)).toEqual([5])
  })

  it('names the video and its scenes from the preset', () => {
    const p: VideoPreset = { kind: 'block', how: DEFAULT_HOW, source: 'our', dir: 'up', mode: 'keyplay' }
    expect(presetLabels(p, 'HTH')).toEqual({ name: 'HTH ブロック ミドル別 ↑', prefix: 'HTH ブロック' })
    expect(presetLabels({ ...p, kind: 'sideout', source: 'opp', dir: 'all' }, 'HTH')).toEqual({ name: '相手 サイドアウト ローテーション別', prefix: '相手 サイドアウト' })
    expect(presetLabels({ ...p, kind: 'serve', source: 'results', dir: 'all' }, 'HTH').prefix).toBe('サーブ')
  })

  it('makes a video again from its saved preset', () => {
    const p: VideoPreset = { kind: 'serve', how: { ...DEFAULT_HOW, serve: 'count' }, source: 'our', dir: 'all', mode: 'keyplay' }
    const serves = [ref({ jersey: 7 }), ref({ jersey: 8 }), ref({ jersey: 8 })]
    expect(titles(makePreset(p, serves, [], look).scenes)).toEqual(['#8 N8', '#7 N7'])
  })

  it('reads a saved preset back, and nothing that isn’t one', () => {
    const p: VideoPreset = { kind: 'attack', how: { ...DEFAULT_HOW, attack: 'combo' }, source: 'opp', dir: 'down', mode: 'toEnd' }
    expect(cleanPreset(JSON.parse(JSON.stringify(p)))).toEqual(p)
    expect(cleanPreset({ kind: 'attack', how: { attack: 'nope' } })).toEqual({ kind: 'attack', how: DEFAULT_HOW, source: 'our', dir: 'all', mode: 'keyplay' })
    expect(cleanPreset({ kind: 'dance' })).toBe(null)
    expect(cleanPreset(undefined)).toBe(null)
  })
})

describe('preset scenes and lookups', () => {
  it('makes scenes with the prefix, short title cards, named markers and every clip played', () => {
    const a = ref({ jersey: 2, skill: 'A' }), b = ref({ jersey: 3, skill: 'A' })
    const [r] = presetReels([{ title: '#5 N5', items: [{ ref: a, marker: 1 }, { ref: b, marker: null }], names: { 1: 'X' }, counts: { 1: 1 }, rest: 1 }], 'HTH ブロック', 'keyplay')
    expect([r.name, r.cardTitle, r.sceneCard, r.scope, r.markerNames[1]]).toEqual(['HTH ブロック #5 N5', '#5 N5', true, 'all', 'X'])
    expect([r.groups[1].length, r.groups.none.length]).toEqual([1, 1])
    expect(presetReels([{ title: 'T', items: [], names: {}, counts: {}, rest: 0 }], '', 'keyplay')[0].cardTitle).toBeUndefined()
  })

  it('finds the other team’s middles in the front row, by the project’s positions first', () => {
    const d = {
      players: { a3: { key: 'K3', side: 'a', jersey: 3, lastName: 'MID', firstName: '', role: 'MB' }, a7: { key: 'K7', side: 'a', jersey: 7, lastName: 'OUT', firstName: '', role: 'OH' }, '*9': { key: 'K9', side: '*', jersey: 9, lastName: 'US', firstName: '', role: 'MB' } },
      rallies: [], plays: [],
    } as unknown as ParsedDVW
    const attack = { ...ref({ jersey: 9, skill: 'A' }), matchId: 'm' }
    attack.play = { ...attack.play, side: '*', front: ['K3', 'K7', 'K9'] }
    expect(presetLookups({ m: d }, undefined).middlesFacing(attack)).toEqual([{ key: 'K3', label: '#3 MID' }])
    expect(presetLookups({ m: d }, { K7: 'MB', K3: 'OH' }).middlesFacing(attack)).toEqual([{ key: 'K7', label: '#7 OUT' }])
  })
})

describe('preset dialog', () => {
  it('counts the attacks a block video by middle cannot use (no lineups in the DVW)', () => {
    const a = ref({ skill: 'A', jersey: 2 }), b = ref({ skill: 'A', jersey: 3 })
    b.play = { ...b.play, front: ['K1'] }
    expect(lineupsMissing('block', DEFAULT_HOW, [a, b])).toBe(1)
    expect(lineupsMissing('block', { ...DEFAULT_HOW, block: 'rotation' }, [a, b])).toBe(0)
    expect(lineupsMissing('attack', DEFAULT_HOW, [a, b])).toBe(0)
  })

  it('reads the last choices back, unknown parts as the default', () => {
    const modes = { sideout: 'toEnd', serve: 'keyplay', block: 'keyplay', attack: 'keyplay' } as const
    const kept = { kind: 'attack', how: { ...DEFAULT_HOW, attack: 'combo' }, source: 'opp', dir: 'up', modes: { ...modes, attack: 'toEnd' } }
    expect(cleanDialogState(JSON.parse(JSON.stringify(kept)), modes)).toEqual(kept)
    expect(cleanDialogState({ kind: 'dance', modes: { serve: 'x' } }, modes)).toEqual({ kind: 'sideout', how: DEFAULT_HOW, source: 'our', dir: 'all', modes })
    expect(cleanDialogState(null, modes).kind).toBe('sideout')
  })
})
