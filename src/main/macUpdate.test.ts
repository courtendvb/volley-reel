import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { bundleOf, cannotReplace, downloadChecked, fileUrl, pickMacZip, startSwap, unpackApp } from './macUpdate'

const files = [
  { url: 'syncscout-video-editor-0.2.44-x64-mac.zip', sha512: 'a' },
  { url: 'syncscout-video-editor-0.2.44-arm64-mac.zip', sha512: 'b' },
  { url: 'syncscout-video-editor-0.2.44-x64.dmg', sha512: 'c' },
  { url: 'syncscout-video-editor-0.2.44-arm64.dmg', sha512: 'd' },
]

describe('mac update helpers', () => {
  it('picks the zip for the chip', () => {
    expect(pickMacZip(files, 'arm64')?.sha512).toBe('b')
    expect(pickMacZip(files, 'x64')?.sha512).toBe('a')
    expect(pickMacZip(files.filter(f => f.url.endsWith('.dmg')), 'arm64')).toBeNull()
  })

  it('finds the file on the release, or on the test server', () => {
    expect(fileUrl('a b.zip', '0.2.44')).toBe('https://github.com/courtendvb/syncscout-video-editor-releases/releases/download/v0.2.44/a%20b.zip')
    expect(fileUrl('x.zip', '0.2.44', 'http://127.0.0.1:8766/')).toBe('http://127.0.0.1:8766/x.zip')
    expect(fileUrl('https://example.com/x.zip', '0.2.44')).toBe('https://example.com/x.zip')
  })

  it('finds the .app from the executable', () => {
    expect(bundleOf('/Applications/SyncScout Video Editor.app/Contents/MacOS/SyncScout Video Editor')).toBe('/Applications/SyncScout Video Editor.app')
    expect(bundleOf('C:\\Program Files\\x\\volley-reel.exe')).toBeNull()
  })

  it('says why it cannot replace the app', () => {
    const yes = () => true
    expect(cannotReplace('/Applications/X.app', yes)).toBeNull()
    expect(cannotReplace('/Volumes/SyncScout/X.app', yes)).toMatch(/disk image/)
    expect(cannotReplace('/private/var/folders/ab/T/AppTranslocation/1234/d/X.app', yes)).toMatch(/translocated/)
    expect(cannotReplace('/Applications/X.app', p => p !== '/Applications')).toMatch(/permission/)
    expect(cannotReplace(null, yes)).toMatch(/not in an \.app/)
  })
})

describe('downloadChecked', () => {
  const body = Buffer.from('a new version of the app '.repeat(1000))
  const sha = createHash('sha512').update(body).digest('base64')
  const fetchOk = async () => new Response(body, { headers: { 'content-length': String(body.length) } })

  it('writes the file when the sha512 matches, with progress', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vr-mac-')), 'u.zip')
    const seen: number[] = []
    await downloadChecked('http://x/u.zip', dest, sha, fetchOk, r => seen.push(r))
    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(seen.at(-1)).toBe(1)
  })

  it('throws and leaves no file when the sha512 differs', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vr-mac-')), 'u.zip')
    await expect(downloadChecked('http://x/u.zip', dest, 'wrong', fetchOk)).rejects.toThrow(/sha512/)
    expect(existsSync(dest)).toBe(false)
  })

  it('throws on a failed response', async () => {
    const dest = join(mkdtempSync(join(tmpdir(), 'vr-mac-')), 'u.zip')
    await expect(downloadChecked('http://x/u.zip', dest, sha, async () => new Response('no', { status: 404 }))).rejects.toThrow(/404/)
  })
})

// The real thing, on a Mac: unpack a zipped app with ditto, check its signature, swap it in once
// a stand-in for the running app has quit.
describe.runIf(process.platform === 'darwin')('mac update on macOS', () => {
  it('unpacks, verifies and swaps the app in', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vr-mac-swap-'))
    const makeApp = (dir: string, version: string) => {
      const app = join(dir, 'Test.app')
      mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
      writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Test</string><key>CFBundleIdentifier</key><string>test.vr.update</string><key>CFBundleShortVersionString</key><string>${version}</string></dict></plist>`)
      writeFileSync(join(app, 'Contents', 'MacOS', 'Test'), `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
      execFileSync('codesign', ['--force', '--deep', '-s', '-', app])
      return app
    }
    mkdirSync(join(root, 'installed')); mkdirSync(join(root, 'build'))
    const installed = makeApp(join(root, 'installed'), '1')
    const built = makeApp(join(root, 'build'), '2')
    const zip = join(root, 'Test-arm64-mac.zip')
    execFileSync('ditto', ['-c', '-k', '--keepParent', built, zip])

    const staged = await unpackApp(zip, join(root, 'staged'))
    const stand = spawn('/bin/sleep', ['1'])
    startSwap({ pid: stand.pid!, newApp: staged, target: installed, start: false, scriptDir: root, logFile: join(root, 'swap.log') })
    for (let i = 0; i < 100 && !readFileSync(join(installed, 'Contents', 'MacOS', 'Test'), 'utf8').includes('2'); i++) await new Promise(r => setTimeout(r, 100))
    expect(readFileSync(join(installed, 'Contents', 'MacOS', 'Test'), 'utf8')).toContain('echo 2')
    expect(existsSync(`${installed}.previous`)).toBe(false)
    expect(readFileSync(join(root, 'swap.log'), 'utf8')).toMatch(/updated/)
  }, 30000)
})
