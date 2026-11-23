// 通し (the left list playing a rally whole): which play the court's marks are drawn for as the video
// runs, and the short stop before a set after a good reception. The captions keep to followWindows
// (overlay.ts); the court gets its own windows, because what it shows takes longer to read than
// the second or two a play takes: a serve's flight and where it landed, then the set distribution.
// Times are video times.
import { FOLLOW_LEAD_SEC, type FollowWindow } from './overlay'

export const SERVE_HOLD_SEC = 1.5 // a serve's marks stay at least this long, the reception waiting its turn
export const RECEPTION_DELAY_SEC = 0.5 // the reception's marks come this much after its contact, when there is room
export const SET_FREEZE_SEC = 2 // the picture stops this long on a set after a good reception, unless told otherwise (0: no stop)
// The stop is this long after the rally's serve was logged. Scouts log the serve on time, while a set's
// logged second drifts from scout to scout, so the stop follows the serve: about when the set is played.
export const SET_FREEZE_AFTER_SERVE_SEC = 2.5
export const SET_FREEZE_AFTER_SEC = 1.2 // with no serve before it, the stop is this long after the set's logged second
// A video lands on a frame, so after the stop its time can be a few hundredths before the stop's own:
// the set's window opens this much earlier so the stopped picture is inside it, and closes as much
// after: the distribution goes with the stop and leaves the court to the attack that follows.
export const FREEZE_SNAP_SEC = 0.1
export const FORECAST_AHEAD_SEC = 1 // with the forecast on, a serve's or attack's marks open this long before its contact (the count-in needs 0.7 s, the ghost line the rest)
export const FREEZE_RECEPTIONS = ['#', '+', '!'] // the receptions whose set gets the stop, unless told otherwise
export const FREEZE_RECEPTION_CHOICES = ['#', '+', '!', '-', '/'] // those that can be picked (an error has no set after it)

export interface CourtWindow extends FollowWindow { shares?: boolean } // shares: draw the set distribution of the rotation
export interface FollowPlay { id: number; time: number; skill: string; phase?: 'r' | 't' | null; recEffect?: string }
export interface Freeze { at: number; sec: number; playId: number }

// A set made from one of the receptions picked (#, + or ! unless told otherwise; the reception's
// evaluation is on the set itself, dvw.ts).
export const isFreezeSet = (p: FollowPlay, recs: readonly string[] = FREEZE_RECEPTIONS): boolean => p.skill === 'E' && p.phase === 'r' && recs.includes(p.recEffect ?? '')

// Where the picture stops, for each such set: a fixed time after the rally's serve (the last serve
// logged before the set); a set with no serve before it falls back to a little after its own second.
export function setFreezes(plays: FollowPlay[], offsetSec: number, stopSec = SET_FREEZE_SEC, recs: readonly string[] = FREEZE_RECEPTIONS): Freeze[] {
  if (!(stopSec > 0)) return []
  const sorted = [...plays].sort((a, b) => a.time - b.time || a.id - b.id)
  return sorted.filter(p => isFreezeSet(p, recs)).map(p => {
    const sv = [...sorted].reverse().find(q => q.skill === 'S' && (q.time < p.time || (q.time === p.time && q.id < p.id)))
    const at = sv ? sv.time + offsetSec + SET_FREEZE_AFTER_SERVE_SEC : p.time + offsetSec + SET_FREEZE_AFTER_SEC
    return { at, sec: stopSec, playId: p.id }
  })
}

export function courtWindows(plays: FollowPlay[], offsetSec: number, holdSec: number, stopSec = SET_FREEZE_SEC, aheadSec = 0, recs: readonly string[] = FREEZE_RECEPTIONS): CourtWindow[] {
  const freezeAt = new Map(setFreezes(plays, offsetSec, stopSec, recs).map(f => [f.playId, f.at]))
  const items = [...plays].filter(p => p.skill === 'S' || p.skill === 'R' || p.skill === 'A' || freezeAt.has(p.id))
    .sort((a, b) => a.time - b.time || a.id - b.id)
    .map(p => ({ p, raw: freezeAt.has(p.id) ? freezeAt.get(p.id)! - FREEZE_SNAP_SEC : p.time + offsetSec - (p.skill === 'S' || p.skill === 'A' ? Math.max(FOLLOW_LEAD_SEC, aheadSec) : FOLLOW_LEAD_SEC), start: 0, minEnd: 0 }))
  let floor = -Infinity // a serve or a set keeps the court until then; what follows waits (a set's stop doesn't: it is where the picture stops)
  items.forEach((it, i) => {
    const next = items[i + 1]
    const isSet = freezeAt.has(it.p.id)
    // The reception comes a little late, as far as the next play leaves room.
    const delayed = it.p.skill === 'R' ? Math.min(it.raw + RECEPTION_DELAY_SEC, next ? next.raw - 0.5 : Infinity) : it.raw
    it.start = isSet ? it.raw : Math.max(it.raw, delayed, floor)
    it.minEnd = it.p.skill === 'S' ? it.start + SERVE_HOLD_SEC : isSet ? it.start + 2 * FREEZE_SNAP_SEC : it.start
    floor = Math.max(floor, it.minEnd)
  })
  // Each window ends at the earliest start of what comes after it, so none overlap (one squeezed to nothing is dropped).
  const startAfter: number[] = []
  items.reduceRight((m, it, i) => { startAfter[i] = m; return Math.min(m, it.start) }, Infinity)
  return items.map((it, i) => {
    const to = freezeAt.has(it.p.id) ? it.minEnd : Math.min(Math.max(it.p.time + offsetSec + holdSec, it.minEnd), startAfter[i])
    const w: CourtWindow = { from: it.start, to, playId: it.p.id }
    if (freezeAt.has(it.p.id)) w.shares = true
    return w
  }).filter(w => w.to > w.from)
}
