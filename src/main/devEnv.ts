// Environment variables only a development run may use: the self-checks (VR_SMOKE…), a test lease
// key (VR_LEASE_KEY), accounts before release (VR_ACCOUNTS), the update test, a library or project
// to open, and the dev server's URL. An installed copy drops them all before anything reads them, so
// none can turn the account limits off, swap the key leases are checked with, or load another page
// into the app's window.
export const isDevEnvKey = (key: string): boolean => key.startsWith('VR_') || key === 'ELECTRON_RENDERER_URL'

// Removes the development-only variables from `env`; returns the names it removed.
export function stripDevEnv(env: Record<string, string | undefined>): string[] {
  const removed = Object.keys(env).filter(isDevEnvKey)
  for (const k of removed) delete env[k]
  return removed
}
