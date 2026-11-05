import type { KeyboardEvent } from 'react'

// True while an input method (Japanese IME) is composing: its Enter / Escape confirm or cancel the
// conversion and must not also finish the field. keyCode 229 covers the keydown some browsers send
// just as composition ends.
export function composing(e: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  const n = 'nativeEvent' in e ? e.nativeEvent : e
  return n.isComposing || n.keyCode === 229
}

// How far ← → move the video, in seconds; kept on this computer.
const ARROW_KEY = 'vr.arrowSec'
export const ARROW_SEC = 0.5
export function arrowSec(): number {
  try { const n = Number(localStorage.getItem(ARROW_KEY)); return n > 0 && n <= 60 ? n : ARROW_SEC } catch { return ARROW_SEC }
}
export function setArrowSec(sec: number): void {
  try { localStorage.setItem(ARROW_KEY, String(sec)) } catch { /* not kept */ }
}
