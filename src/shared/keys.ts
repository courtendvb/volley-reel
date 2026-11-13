// Key names as this computer's keyboard says them: Ctrl is ⌘ and Alt is ⌥ (Option) on a Mac
// (useShortcuts takes either; Option sets altKey).
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform)
export const keyName = (s: string, mac = IS_MAC) => (mac ? s.replace(/Ctrl\s*\+\s*/g, '⌘').replace(/Alt\s*\+\s*/g, '⌥') : s)
