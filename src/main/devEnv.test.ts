import { describe, expect, it } from 'vitest'
import { isDevEnvKey, stripDevEnv } from './devEnv'

describe('stripDevEnv', () => {
  it('drops the development-only variables and keeps the rest', () => {
    const env: Record<string, string | undefined> = {
      VR_SMOKE: 'C:\\shot.png', VR_SMOKE_EXPORT: 'out.mp4', VR_LEASE_KEY: 'abc', VR_ACCOUNTS: '1',
      VR_UPDATE_TEST: '1', VR_PROJECT: 'C:\\p', ELECTRON_RENDERER_URL: 'http://evil.example',
      PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\x\\AppData\\Roaming',
    }
    expect(stripDevEnv(env).sort()).toEqual(['ELECTRON_RENDERER_URL', 'VR_ACCOUNTS', 'VR_LEASE_KEY', 'VR_PROJECT', 'VR_SMOKE', 'VR_SMOKE_EXPORT', 'VR_UPDATE_TEST'])
    expect(env).toEqual({ PATH: 'C:\\Windows', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' })
  })

  it('leaves names that only contain VR_ further in', () => {
    expect(isDevEnvKey('MY_VR_SMOKE')).toBe(false)
    expect(isDevEnvKey('VR_LANG')).toBe(true)
  })
})
