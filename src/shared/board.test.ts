import { describe, expect, it } from 'vitest'
import { restyleBoard, attackCodes, boardColumn, boardPlayers, boardRates, boardSlide, keptByHand, serveTypeColor, serveTypeName, serveTypes } from './board'
import { chartWidth } from './chart'
import type { ParsedDVW, Play } from './types'

const play = (over: object) => ({ side: '*', jersey: 7, playerKey: 'A', skill: 'S', effect: '-', rallyId: 0, setNum: 1, score: { home: 0, away: 0 }, startZone: 1, endZone: 6, startSub: null, endSub: null,
  code: '*07SM-~~~16C', startClick: { u: 0.8, v: -0.05 }, endClick: { u: 0.5, v: 0.8 }, ...over }) as unknown as Play
const match = (plays: Play[]) => ({
  teams: [{ code: 'hth', name: 'Hiroshima' }, { code: 'opp', name: 'Other' }],
  players: { '*7': { key: 'A', side: '*', jersey: 7, lastName: 'Tanaka', firstName: 'Ken' }, '*9': { key: 'C', side: '*', jersey: 9, lastName: 'Sato', firstName: '' }, a9: { key: 'B', side: 'a', jersey: 9, lastName: 'Mori', firstName: '' } },
  rallies: [{ id: 0, wonBy: '*' }, { id: 1, wonBy: 'a' }],
  plays,
}) as unknown as ParsedDVW
const rates = (d: ParsedDVW, skill: 'S' | 'A') => boardRates(boardPlayers([d], skill)[0], skill).map(r => [r.label, r.value])

describe('boardPlayers', () => {
  const d = match([play({}), play({ rallyId: 1 }), play({ effect: '=' }), play({ side: 'a', jersey: 9, playerKey: 'B', rallyId: 1 }), play({ skill: 'A' })])
  it('gathers each player, most first, across matches', () => {
    const [a, b] = boardPlayers([d, d], 'S')
    expect([a.key, a.plays.length, a.team]).toEqual(['A', 6, 'HTH'])
    expect([b.key, b.plays.length, b.team]).toEqual(['B', 2, 'OPP'])
  })
  it('counts the rallies the server\'s team won', () => {
    const [a, b] = boardPlayers([d], 'S')
    expect(a.won).toBe(2)
    expect(b.won).toBe(1)
  })
  it('keeps to the plays asked for', () => {
    expect(boardPlayers([d], 'S', p => p.effect === '=')[0].plays).toHaveLength(1)
  })
})

describe('the rates', () => {
  it('gives break points and errors for serves', () => {
    expect(rates(match([play({}), play({ rallyId: 1 }), play({ effect: '=' }), play({ rallyId: 1, effect: '=' })]), 'S')).toEqual([['BP%', '50%'], ['ERR%', '50%']])
  })
  it('gives kills and efficiency for attacks', () => {
    const a = (effect: string) => play({ skill: 'A', effect })
    expect(rates(match([a('#'), a('#'), a('='), a('+')]), 'A')).toEqual([['K%', '50%'], ['EFF%', '25%']])
    expect(rates(match([a('#'), a('='), a('/'), a('+')]), 'A')).toEqual([['K%', '25%'], ['EFF%', '-25%']])
  })
})

describe('the colours of the rates', () => {
  const colors = (won: number, errors: number, n = 100) => {
    const plays = Array.from({ length: n }, (_, i) => play({ rallyId: i < won ? 0 : 1, effect: i >= n - errors ? '=' : '-' }))
    return boardRates(boardPlayers([match(plays)], 'S')[0], 'S').map(r => r.color)
  }
  const [BLUE, RED, PLAIN] = ['#2563EB', '#DC2626', '#0F172A']
  it('shows break points blue from 33%, red to 20%, plain between', () => {
    expect(colors(33, 0)[0]).toBe(BLUE)
    expect(colors(32, 0)[0]).toBe(PLAIN)
    expect(colors(21, 0)[0]).toBe(PLAIN)
    expect(colors(20, 0)[0]).toBe(RED)
  })
  it('shows errors red from 16%', () => {
    expect(colors(30, 16)[1]).toBe(RED)
    expect(colors(30, 15)[1]).toBe(PLAIN)
  })
  it('leaves attack rates plain', () => {
    expect(boardRates(boardPlayers([match([play({ skill: 'A', effect: '#' })])], 'A')[0], 'A').map(r => r.color)).toEqual([PLAIN, PLAIN])
  })
})

describe('columns by attack code', () => {
  const hit = (key: string, jersey: number, code: string, effect = '#') => play({ skill: 'A', jersey, playerKey: key, effect, code: `*0${jersey}AQ${effect}${code}~46CH2` })
  const d = match([hit('A', 7, 'X5'), hit('A', 7, 'X5'), hit('A', 7, 'V5'), hit('A', 7, 'PP'), hit('C', 9, 'X5', '='), hit('C', 9, 'X1')])
  const [a, b] = boardPlayers([d], 'A')
  it('lists the codes, most used first', () => {
    expect(attackCodes([a, b])[0]).toEqual({ code: 'X5', count: 3 })
  })
  it('fills a slot with a player, or one code of theirs', () => {
    expect(boardColumn(a, null)).toBe(a)
    expect(boardColumn(a, 'X5', { X5: 'Quick' })).toMatchObject({ code: 'X5', codeName: 'Quick', plays: { length: 2 } })
    expect(boardColumn(a, 'X1')).toBeNull()
  })
  it('gives the same player side by side one heading and photo, and each code its own rates', () => {
    const cols = [boardColumn(a, 'X5')!, boardColumn(a, 'V5')!, boardColumn(a, 'PP')!, boardColumn(b, 'X5')!]
    const { annotations, charts } = boardSlide(cols, 'A', { split: false }, { [a.key]: { assetId: 'x', width: 600, height: 750 } })
    expect(annotations.filter(x => x.kind === 'text' && x.text === 'TANAKA')).toHaveLength(1)
    expect(annotations.filter(x => x.kind === 'text' && x.text === 'SATO')).toHaveLength(1)
    expect(annotations.filter(x => x.kind === 'image')).toHaveLength(1)
    expect(annotations.filter(x => x.kind === 'text' && x.text === 'K%')).toHaveLength(4)
    expect(charts).toHaveLength(4)
    for (const code of ['X5', 'V5', 'PP']) expect(annotations.some(x => x.kind === 'text' && x.text === code)).toBe(true)
    // The heading's rule runs across all three of the player's columns.
    const rule = annotations.find(x => x.kind === 'polyline') as unknown as { points: number[][] }
    expect(rule.points[1][0]).toBeGreaterThan(0.7)
  })
  it('does not share when the same player is apart', () => {
    const { annotations } = boardSlide([boardColumn(a, 'X5')!, boardColumn(b, 'X5')!, boardColumn(a, 'V5')!], 'A', { split: false }, {})
    expect(annotations.filter(x => x.kind === 'text' && x.text === 'TANAKA')).toHaveLength(2)
  })
  it('puts the code on the chart', () => {
    const { annotations } = boardSlide([boardColumn(a, 'X5', { X5: 'Quick' })!], 'A', { split: false }, {})
    expect(annotations.some(x => x.kind === 'text' && x.text === 'X5 Quick')).toBe(true)
  })
})

describe('serve types', () => {
  it('names them, the most used first', () => {
    const t = serveTypes([play({ code: '*07SQ-' }), play({}), play({})])
    expect(t.map(x => [x.type, x.plays.length])).toEqual([['M', 2], ['Q', 1]])
    expect([serveTypeName('Q'), serveTypeName('M'), serveTypeName('X')]).toEqual(['Jump', 'Float', 'X'])
  })
})

describe('the colour of a serve label', () => {
  it('goes by the type, not whether it is the main one', () => {
    expect([serveTypeColor('Q'), serveTypeColor('M'), serveTypeColor('H'), serveTypeColor('T')]).toEqual(['#DC2626', '#1D4ED8', '#1D4ED8', '#16A34A'])
  })
  it('colours each label on the slide that way', () => {
    const jumpMost = [...Array.from({ length: 8 }, () => play({ code: '*07SQ-~~~16C' })), ...Array.from({ length: 4 }, () => play({ code: '*07SM-~~~16C' }))]
    const { annotations } = boardSlide(boardPlayers([match(jumpMost)], 'S'), 'S', { split: true }, {})
    const fill = (name: string) => (annotations.find(a => a.kind === 'text' && a.text === name) as unknown as { box: { fill: string } }).box.fill
    expect([fill('Jump'), fill('Float')]).toEqual(['#DC2626', '#1D4ED8'])
  })
})

describe('boardSlide', () => {
  const many = (code: string, n: number) => Array.from({ length: n }, () => play({ code }))
  const serves = [...many('*07SM-~~~16C', 8), ...many('*07SQ-~~~16C', 4)]
  const players = (n: number) => Array.from({ length: n }, (_, i) => ({ ...boardPlayers([match(serves)], 'S')[0], key: `P${i}` }))
  const photo = { assetId: 'x', width: 600, height: 750 }
  const texts = (a: ReturnType<typeof boardSlide>['annotations'], text: string) => a.filter(x => x.kind === 'text' && x.text === text)
  it('lays each column out inside the picture, with or without photos and notes', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      for (const photos of [{}, Object.fromEntries(players(n).map(p => [p.key, photo]))]) {
        for (const notes of [false, true]) {
          const { charts, annotations } = boardSlide(players(n), 'S', { split: true, notes }, photos)
          expect(charts.length).toBeGreaterThanOrEqual(n)
          for (const c of charts) {
            expect(c.h).toBeGreaterThan(0)
            expect(c.x).toBeGreaterThanOrEqual(0)
            expect(c.x + chartWidth(c.h) * 9 / 16).toBeLessThanOrEqual(1)
            expect(c.y + c.h).toBeLessThanOrEqual(notes ? 0.78 : 1)
          }
          expect(texts(annotations, 'TANAKA')).toHaveLength(n)
        }
      }
    }
  })
  it('splits a serve\'s second type off only when asked, and when there are enough', () => {
    expect(boardSlide(players(1), 'S', { split: false }, {}).charts).toHaveLength(1)
    const few = [{ ...players(1)[0], plays: [...many('*07SM-~~~16C', 8), ...many('*07SQ-~~~16C', 2)] }]
    expect(boardSlide(few, 'S', { split: true }, {}).charts).toHaveLength(1)
    const [main, second] = boardSlide(players(1), 'S', { split: true }, {}).charts
    expect([main.chart.stats.att, second.chart.stats.att]).toEqual([8, 4])
  })
  it('puts in the photo when there is one', () => {
    const p = players(1)
    const { annotations } = boardSlide(p, 'S', { split: false }, { [p[0].key]: photo })
    expect(annotations.find(a => a.kind === 'image')).toMatchObject({ assetId: 'x' })
    expect(boardSlide(p, 'S', { split: false }, {}).annotations.some(a => a.kind === 'image')).toBe(false)
  })
  it('gives the chart the room of a missing photo when narrow', () => {
    const p = players(5)
    const without = boardSlide(p, 'S', { split: false }, {}).charts[0], withIt = boardSlide(p, 'S', { split: false }, Object.fromEntries(p.map(x => [x.key, photo]))).charts[0]
    expect(without.y).toBeLessThan(withIt.y)
  })
  it('adds four text boxes under each column on request, grey and white by turns, the first the largest', () => {
    const lines = texts(boardSlide(players(3), 'S', { split: false, notes: true }, {}).annotations, '') as unknown as { box: { fill: string; width: number }; size: number; bold: boolean; align: string }[]
    expect(lines).toHaveLength(12)
    expect(lines.slice(0, 4).map(l => l.box.fill)).toEqual(['#E2E8F0', '#FFFFFF', '#E2E8F0', '#FFFFFF'])
    expect(lines[0].box.width).toBeGreaterThan(0.2)
    expect(lines[0].size).toBeGreaterThan(lines[1].size)
    expect([lines[0].bold, lines[1].bold, lines[0].align]).toEqual([true, false, 'center'])
    const six = texts(boardSlide(players(6), 'S', { split: false, notes: true }, {}).annotations, '') as unknown as { size: number }[]
    expect(six[0].size).toBeGreaterThanOrEqual(24)
    expect(texts(boardSlide(players(3), 'S', { split: false }, {}).annotations, '')).toHaveLength(0)
  })
  it('keeps to one chart a column from four across', () => {
    expect(boardSlide(players(4), 'S', { split: true }, {}).charts).toHaveLength(4)
  })
  it('colours the number by position, and shows text on a light background', () => {
    const p = players(1)
    p[0] = { ...p[0], player: { ...p[0].player, role: 'OP' } }
    const dark = boardSlide(p, 'S', { split: false }, {}).annotations, light = boardSlide(p, 'S', { split: false, background: '#FFFFFF' }, {}).annotations
    expect((texts(dark, '7')[0] as unknown as { box: { fill: string } }).box.fill).toBe('#DC2626')
    expect(texts(dark, 'TANAKA')[0].color).toBe('#FFFFFF')
    expect(texts(light, 'TANAKA')[0].color).toBe('#0F172A')
  })
  it('rounds the number, rules the name twice, and frames the photo', () => {
    const p = players(1)
    const { annotations } = boardSlide(p, 'S', { split: false }, { [p[0].key]: photo })
    expect((texts(annotations, '7')[0] as unknown as { box: { radius: number } }).box.radius).toBeGreaterThan(0)
    expect(annotations.filter(a => a.kind === 'polyline')).toHaveLength(2)
    const pic = annotations.find(a => a.kind === 'image')!
    expect(annotations.some(a => a.kind === 'rect' && a.groupId === pic.groupId && a.fill === null)).toBe(true)
    const behind = annotations.findIndex(a => a.kind === 'rect' && a.groupId === pic.groupId && a.fill === '#FFFFFF')
    expect(behind).toBe(annotations.indexOf(pic) - 1)
  })
  it('keeps hand-added objects and notes when a card is made again', () => {
    const made = boardSlide(players(2), 'S', { split: false, notes: true }, {})
    const arrow = { id: 'mine', kind: 'arrow', color: '#FFFFFF', x1: 0, y1: 0, x2: 1, y2: 1, width: 2 } as const
    const written = made.annotations.map(a => (a.id === made.noteIds[5] ? { ...a, text: 'short serves' } : a))
    const { hand, noteTexts } = keptByHand({ annotations: [...written, arrow], board: { config: {} as never, made: made.annotations.map(a => a.id), noteIds: made.noteIds } })
    expect(hand).toEqual([arrow])
    expect(noteTexts[5]).toBe('short serves')
    expect(noteTexts).toHaveLength(8)
    const again = boardSlide(players(2), 'S', { split: false, notes: true, noteTexts }, {})
    expect(texts(again.annotations, 'short serves')).toHaveLength(1)
  })
  it('sets what the charts show, at making and all at once afterwards', () => {
    const made = boardSlide(players(2), 'S', { split: false, display: { heat: true, points: false, lines: false, lineOpacity: 0.3 } }, {})
    expect(made.charts[0].chart.look).toMatchObject({ heat: true, points: false, lines: false, lineOpacity: 0.3 })
    const after = restyleBoard({ charts: made.charts }, { lines: true })
    expect(after.charts!.every(c => c.chart.look.lines && c.chart.look.heat)).toBe(true)
  })
  it('makes the notes taller or shorter, the charts making room, and colours them', () => {
    const tall = boardSlide(players(3), 'S', { split: false, notes: true, noteSize: 1.5, noteFills: ['#000000', '#FFF200'] }, {})
    const usual = boardSlide(players(3), 'S', { split: false, notes: true }, {})
    const lines = (r: typeof tall) => texts(r.annotations, '') as unknown as { y: number; size: number; color: string; box: { fill: string } }[]
    expect(lines(tall)[0].y).toBeLessThan(lines(usual)[0].y)
    expect(lines(tall)[0].size).toBeGreaterThan(lines(usual)[0].size)
    expect(Math.max(...tall.charts.map(c => c.y + c.h))).toBeLessThan(Math.max(...usual.charts.map(c => c.y + c.h)))
    expect(lines(tall).slice(0, 2).map(l => [l.box.fill, l.color])).toEqual([['#000000', '#FFFFFF'], ['#FFF200', '#0F172A']])
  })
  it('keeps the name and data off the charts: the card has them', () => {
    const c = boardSlide(players(1), 'A', { split: false }, {}).charts[0].chart
    expect([c.look.name, c.look.stats]).toEqual([false, false])
  })
})
