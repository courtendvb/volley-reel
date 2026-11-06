import type { KeyboardEvent } from 'react'

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
