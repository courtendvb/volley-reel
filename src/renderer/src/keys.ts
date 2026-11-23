import type { KeyboardEvent } from 'react'
import { FREEZE_RECEPTIONS, FREEZE_RECEPTION_CHOICES } from '../../shared/courtFollow'

// True while an input method (Japanese IME) is composing: its Enter / Escape confirm or cancel the
// conversion and must not also finish the field. keyCode 229 covers the keydown some browsers send
// just as composition ends.
export function composing(e: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  const n = 'nativeEvent' in e ? e.nativeEvent : e
  return n.isComposing || n.keyCode === 229
}

// How far ← → and Ctrl + ← → move the video, in seconds; kept on this computer.
const seconds = (key: string, usual: number) => {
  try { const n = Number(localStorage.getItem(key)); return n > 0 && n <= 60 ? n : usual } catch { return usual }
}
const keep = (key: string, sec: number) => { try { localStorage.setItem(key, String(sec)) } catch { /* not kept */ } }
export const arrowSec = () => seconds('vr.arrowSec', 0.5)
export const setArrowSec = (sec: number) => keep('vr.arrowSec', sec)
export const ctrlArrowSec = () => seconds('vr.ctrlArrowSec', 5)
export const setCtrlArrowSec = (sec: number) => keep('vr.ctrlArrowSec', sec)

// 通し: how long the picture stops on a set after a good reception, for its set distribution; 0 = no stop.
// Kept on this computer.
export const SET_STOP_MAX_SEC = 10
export const setStopSec = (): number => {
  try { const v = localStorage.getItem('vr.setStopSec'); const n = Number(v); return v !== null && n >= 0 && n <= SET_STOP_MAX_SEC ? n : 2 } catch { return 2 }
}
export const setSetStopSec = (sec: number) => { try { localStorage.setItem('vr.setStopSec', String(sec)) } catch { /* not kept */ } }
// 通し: the receptions whose set gets the stop (#, + and ! unless picked otherwise; none: no stop). Kept on this computer.
export const setStopRecs = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem('vr.setStopRecs') ?? 'null')
    return Array.isArray(v) ? FREEZE_RECEPTION_CHOICES.filter(e => v.includes(e)) : [...FREEZE_RECEPTIONS]
  } catch { return [...FREEZE_RECEPTIONS] }
}
export const setSetStopRecs = (recs: string[]) => { try { localStorage.setItem('vr.setStopRecs', JSON.stringify(recs)) } catch { /* not kept */ } }
