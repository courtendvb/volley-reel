import { t } from './i18n'
// Bulk import into the library (v3): pair each DVW with its video by date and team codes.
// Names are written differently on each side ("2026-10-11 HTH-SMT.dvw" vs "261011HTH-SMT_FM.MP4"),
// so both are reduced to a date and a set of three-letter codes. Pure, so it is unit-tested.

export interface DvwInfo {
  path: string
  date: string | null // 'YYYY-MM-DD' from [3MATCH], else from the file name
  home: string
  away: string
}

export interface Pair {
  dvw: DvwInfo
  video: string | null
  score: number // 0 = no video found; higher = surer
  note: string
}

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'mts', 'm2ts', 'm4v', 'mkv']

// First date found in a file name: 2026-10-11, 20261011, 2026_10_11 or 261011 (yymmdd).
export function dateFromName(name: string): string | null {
  const base = basename(name)
  const long = /(?<!\d)(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?!\d)/.exec(base)
  if (long && valid(+long[2], +long[3])) return `${long[1]}-${long[2]}-${long[3]}`
  const short = /(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/.exec(base)
  if (short && valid(+short[2], +short[3])) return `20${short[1]}-${short[2]}-${short[3]}`
  return null
}

// Upper-case three-letter tokens in a name ("261011HTH-SMT_FM.MP4" → HTH, SMT). The extension and
// two-letter tags like FM are ignored by the length rule.
export function codesFromName(name: string): string[] {
  const base = basename(name).replace(/\.[^.]+$/, '')
  return [...new Set(base.toUpperCase().match(/(?<![A-Z])[A-Z]{3}(?![A-Z])/g) ?? [])]
}

// DataVolley writes the date in the scouting PC's locale, so dd/mm and mm/dd both occur. When the
// file name has the swapped date, trust the name; otherwise keep the header's reading.
export function matchDate(headerDate: string | null, dvwPath: string): string | null {
  const fromName = dateFromName(dvwPath)
  if (!headerDate) return fromName
  return fromName && fromName === swapDayMonth(headerDate) ? fromName : headerDate
}

export function swapDayMonth(d: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  return m && +m[3] <= 12 ? `${m[1]}-${m[3]}-${m[2]}` : null
}

// One video per DVW at most. A video counts only on the same date; each team code found in its
// name adds confidence. Best scores are taken first, so a doubleheader on one day still pairs by
// codes, and a date-only match is used only when it is the sole video on that date.
export function pairFiles(dvws: DvwInfo[], videos: string[]): Pair[] {
  const cands: { d: number; v: number; score: number; note: string }[] = []
  dvws.forEach((dvw, d) => {
    const date = matchDate(dvw.date, dvw.path)
    if (!date) return
    const sameDay = videos.map((v, i) => ({ v, i })).filter(x => dateFromName(x.v) === date)
    for (const { v, i } of sameDay) {
      const codes = codesFromName(v)
      const hits = [dvw.home, dvw.away].filter(c => c && codes.includes(c.toUpperCase())).length
      if (hits === 0 && sameDay.length > 1) continue
      cands.push({ d, v: i, score: 1 + hits * 2, note: hits === 2 ? t('日付とチーム') : hits === 1 ? t('日付と片方のチーム') : t('日付のみ（要確認）') })
    }
  })
  cands.sort((a, b) => b.score - a.score)
  const usedD = new Set<number>(), usedV = new Set<number>()
  const chosen = new Map<number, { v: number; score: number; note: string }>()
  for (const c of cands) {
    if (usedD.has(c.d) || usedV.has(c.v)) continue
    usedD.add(c.d); usedV.add(c.v)
    chosen.set(c.d, c)
  }
  return dvws.map((dvw, d) => {
    const c = chosen.get(d)
    return c ? { dvw, video: videos[c.v], score: c.score, note: c.note } : { dvw, video: null, score: 0, note: t('動画なし') }
  })
}

function valid(m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= 31
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
