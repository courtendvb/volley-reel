// 通し (the left list playing a rally whole): which play the court's marks are drawn for as the video
// runs, and the short stop before a set after a good reception. The captions keep to followWindows
// (overlay.ts); the court gets its own windows, because what it shows takes longer to read than
// the second or two a play takes: a serve's flight and where it landed, then the set distribution.
// Times are video times.
import { FOLLOW_LEAD_SEC, type FollowWindow } from './overlay'

export const SERVE_HOLD_SEC = 2.5 // a serve's marks stay at least this long, the reception waiting its turn
export const RECEPTION_DELAY_SEC = 0.5 // the reception's marks come this much after its contact, when there is room
export const SET_FREEZE_SEC = 2 // the picture stops this long before a set after a good reception
export const SET_SHARES_SEC = 1.5 // the set distribution stays this much video time once the picture runs again
export const SET_FREEZE_AFTER_SEC = 1.2 // the stop is this long after the set's logged second (the contact itself is a little before it)
// A video lands on a frame, so after the stop its time can be a few hundredths before the stop's own:
// the set's window opens this much earlier so the stopped picture is inside it.
export const FREEZE_SNAP_SEC = 0.1
export const FREEZE_RECEPTIONS = ['#', '+', '!']

export interface CourtWindow extends FollowWindow { shares?: boolean } // shares: draw the set distribution of the rotation
export interface FollowPlay { id: number; time: number; skill: string; phase?: 'r' | 't' | null; recEffect?: string }
export interface Freeze { at: number; sec: number; playId: number }

// A set made from a #, + or ! reception (the reception's evaluation is on the set itself, dvw.ts).
export const isFreezeSet = (p: FollowPlay): boolean => p.skill === 'E' && p.phase === 'r' && FREEZE_RECEPTIONS.includes(p.recEffect ?? '')

// Where the picture stops, for each such set: a little after its logged second, and not before the
// second the reception was logged in.
export function setFreezes(plays: FollowPlay[], offsetSec: number): Freeze[] {
  const sorted = [...plays].sort((a, b) => a.time - b.time || a.id - b.id)
  return sorted.filter(isFreezeSet).map(p => {
    const rec = [...sorted].reverse().find(q => q.skill === 'R' && (q.time < p.time || (q.time === p.time && q.id < p.id)))
    return { at: Math.max(p.time + offsetSec + SET_FREEZE_AFTER_SEC, rec ? rec.time + offsetSec : -Infinity), sec: SET_FREEZE_SEC, playId: p.id }
  })
}

export function courtWindows(plays: FollowPlay[], offsetSec: number, holdSec: number): CourtWindow[] {
  const freezeAt = new Map(setFreezes(plays, offsetSec).map(f => [f.playId, f.at]))
  const items = [...plays].filter(p => p.skill === 'S' || p.skill === 'R' || p.skill === 'A' || freezeAt.has(p.id))
    .sort((a, b) => a.time - b.time || a.id - b.id)
    .map(p => ({ p, raw: freezeAt.has(p.id) ? freezeAt.get(p.id)! - FREEZE_SNAP_SEC : p.time + offsetSec - FOLLOW_LEAD_SEC, start: 0, minEnd: 0 }))
  let floor = -Infinity // a serve or a set keeps the court until then; what follows waits (a set's stop doesn't: it is where the picture stops)
  items.forEach((it, i) => {
    const next = items[i + 1]
    const isSet = freezeAt.has(it.p.id)
    // The reception comes a little late, as far as the next play leaves room.
    const delayed = it.p.skill === 'R' ? Math.min(it.raw + RECEPTION_DELAY_SEC, next ? next.raw - 0.5 : Infinity) : it.raw
    it.start = isSet ? it.raw : Math.max(it.raw, delayed, floor)
    it.minEnd = it.p.skill === 'S' ? it.start + SERVE_HOLD_SEC : isSet ? it.start + SET_SHARES_SEC : it.start
    floor = Math.max(floor, it.minEnd)
  })
  // Each window ends at the earliest start of what comes after it, so none overlap (one squeezed to nothing is dropped).
  const startAfter: number[] = []
  items.reduceRight((m, it, i) => { startAfter[i] = m; return Math.min(m, it.start) }, Infinity)
  return items.map((it, i) => {
    const to = Math.min(Math.max(it.p.time + offsetSec + holdSec, it.minEnd), startAfter[i])
    const w: CourtWindow = { from: it.start, to, playId: it.p.id }
    if (freezeAt.has(it.p.id)) w.shares = true
    return w
  }).filter(w => w.to > w.from)
}
