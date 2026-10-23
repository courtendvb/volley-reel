import type { KeyboardEvent } from 'react'

// True while an input method (Japanese IME) is composing: its Enter / Escape confirm or cancel the
// conversion and must not also finish the field. keyCode 229 covers the keydown some browsers send
// just as composition ends.
export function composing(e: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  const n = 'nativeEvent' in e ? e.nativeEvent : e
  return n.isComposing || n.keyCode === 229
}
