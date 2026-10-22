import { describe, expect, it } from 'vitest'
import { codesFromName, dateFromName, matchDate, pairFiles, type DvwInfo } from './pairing'

describe('names', () => {
  it('reads dates written several ways', () => {
    expect(dateFromName('C:\\video\\261011HTH-SMT_FM.MP4')).toBe('2026-10-11')
    expect(dateFromName('2026-10-11 HTH-SMT.dvw')).toBe('2026-10-11')
    expect(dateFromName('&260314HTH-SAK_0-3_5th.dvw')).toBe('2026-03-14')
    expect(dateFromName('match 20251115.mp4')).toBe('2025-11-15')
    expect(dateFromName('clip.mp4')).toBeNull()
    expect(dateFromName('991399.mp4')).toBeNull() // month 13
  })

  it('finds three-letter team codes and ignores shorter tags', () => {
    expect(codesFromName('261011HTH-SMT_FM.MP4')).toEqual(['HTH', 'SMT'])
    expect(codesFromName('260207_all home.dvw')).toEqual(['ALL'])
  })
})

const dvw = (path: string, date: string | null, home: string, away: string): DvwInfo => ({ path, date, home, away })

describe('pairing', () => {
  it('pairs by date and both team codes', () => {
    const r = pairFiles([dvw('2026-10-11 HTH-SMT.dvw', '2026-10-11', 'HTH', 'SMT')],
      ['C:/video/261010HTH-SMT_FM.MP4', 'C:/video/261011HTH-SMT_FM.MP4'])
    expect(r[0]).toMatchObject({ video: 'C:/video/261011HTH-SMT_FM.MP4', score: 5, note: '日付とチーム' })
  })

  it('tells a doubleheader apart by codes', () => {
    const r = pairFiles(
      [dvw('a.dvw', '2026-09-22', 'HTH', 'FGK'), dvw('b.dvw', '2026-09-22', 'OKB', 'SMT')],
      ['260922OKB-SMT.mp4', '260922HTH-FGK_FM.MP4'])
    expect(r.map(p => p.video)).toEqual(['260922HTH-FGK_FM.MP4', '260922OKB-SMT.mp4'])
  })

  it('accepts a date-only match when it is the only video that day, and flags it', () => {
    const r = pairFiles([dvw('scrimmage.dvw', '2026-02-07', 'HTH', 'HTA')], ['260207 紅白戦.mp4'])
    expect(r[0]).toMatchObject({ video: '260207 紅白戦.mp4', score: 1, note: '日付のみ（要確認）' })
  })

  it('does not guess between several same-day videos without codes', () => {
    const r = pairFiles([dvw('x.dvw', '2026-02-07', 'HTH', 'HTA')], ['260207 前半.mp4', '260207 後半.mp4'])
    expect(r[0].video).toBeNull()
  })

  it('uses each video once and reports DVWs left without one', () => {
    const r = pairFiles([dvw('a.dvw', '2026-10-11', 'HTH', 'SMT'), dvw('b.dvw', '2026-10-11', 'HTH', 'SMT')], ['261011HTH-SMT.mp4'])
    expect(r.filter(p => p.video).length).toBe(1)
    expect(r.find(p => !p.video)?.note).toBe('動画なし')
  })

  it('reads a dd/mm vs mm/dd header date the way the file name has it', () => {
    expect(matchDate('2024-10-08', '&2024-08-10 526302 FRA-POL(VM).dvw')).toBe('2024-08-10')
    expect(matchDate('2026-10-11', '2026-10-11 HTH-SMT.dvw')).toBe('2026-10-11')
    expect(matchDate('2026-10-11', 'scout.dvw')).toBe('2026-10-11')
    expect(pairFiles([dvw('&2024-08-10 FRA-POL.dvw', '2024-10-08', 'FRA', 'POL')], ['240810 FRA-POL.mp4'])[0].score).toBe(5)
  })

  it('falls back to the DVW file name for the date', () => {
    expect(pairFiles([dvw('&260314HTH-SAK_0-3_5th.dvw', null, 'HTH', 'SAK')], ['260314HTH-SAK.mp4'])[0].score).toBe(5)
  })
})
