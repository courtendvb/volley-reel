// Installed copies update over the old version and find their settings by these; electron-builder.yml
// says what each one does. Changing one looks harmless and only shows on testers' PCs.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const yml = readFileSync('electron-builder.yml', 'utf8').replace(/\r\n/g, '\n')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

describe('what installed copies depend on', () => {
  it('keeps the installer identity', () => {
    expect(yml).toMatch(/^appId: com\.courtendvb\.volleyreel$/m)
    expect(yml).toMatch(/^ {2}executableName: volley-reel$/m)
  })

  it('keeps the shortcut name: a new one takes the old shortcut away, and its taskbar pin with it', () => {
    expect(yml).toMatch(/^ {2}shortcutName: SyncScout Video Editor$/m)
  })

  it('keeps the place updates come from', () => {
    expect(yml).toMatch(/^ {2}provider: github\n {2}owner: courtendvb\n {2}repo: syncscout-video-editor-releases$/m)
  })

  it('keeps the settings folder (%APPDATA%\volley-reel)', () => {
    expect(pkg.name).toBe('volley-reel')
    expect(pkg.productName).toBeUndefined()
  })
})
