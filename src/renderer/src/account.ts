// The SyncScout account as the window sees it (main/account.ts holds the truth). One copy for the
// whole window, so signing in from the home screen also clears the notes at the export buttons.
import { useEffect, useState } from 'react'
import type { AccountState } from '../../shared/account'

export interface AccountInfo { enabled: boolean; state: AccountState }

let info: AccountInfo | null = null
const listeners = new Set<(i: AccountInfo) => void>()

export function setAccountState(state: AccountState): void {
  info = { enabled: info?.enabled ?? true, state }
  for (const l of listeners) l(info)
}

async function load(): Promise<void> {
  info = await window.api.account()
  for (const l of listeners) l(info)
}

// null until the first answer; enabled: false while accounts are turned off (show nothing then).
export function useAccount(): AccountInfo | null {
  const [now, setNow] = useState(info)
  useEffect(() => {
    listeners.add(setNow)
    if (!info) void load()
    else setNow(info)
    // A lease runs out, or a background refresh changes it: look again when the window comes back.
    const back = () => void load()
    window.addEventListener('focus', back)
    return () => { listeners.delete(setNow); window.removeEventListener('focus', back) }
  }, [])
  return now
}
