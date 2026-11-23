// Updating the Mac app without a signature. electron-updater hands a Mac update to Squirrel.Mac,
// which only replaces an app signed by an Apple developer; this build is signed ad hoc (README). So
// on a Mac the app does it itself: electron-updater still finds the new version (latest-mac.yml),
// and this downloads that release's .zip for the Mac's chip, checks it against the sha512 in
// latest-mac.yml, unpacks it with ditto (which keeps the ad-hoc signature) and checks the signature.
// Once the app has quit, a small shell script swaps the new app in where the old one was and,
// when asked, starts it. A file the app downloads itself carries no quarantine, so macOS doesn't
// stop the new version on its first start.
//
// It needs the app somewhere it may write: not in a disk image, not translocated (macOS runs an
// app opened from Downloads from a read-only copy), and a folder the user may change. Otherwise
// updater.ts only announces the version, as before.
// No Electron here (the download takes a fetch), so it is unit-tested; the darwin-only test runs
// ditto, codesign and the swap for real on the Mac build (.github/workflows/mac.yml).
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { accessSync, constants, createWriteStream, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface UpdateFile { url: string; sha512: string; size?: number }

// The release's zip for this chip ("…-arm64-mac.zip" / "…-x64-mac.zip").
export function pickMacZip(files: readonly UpdateFile[], arch: string): UpdateFile | null {
  return files.find(f => f.url.endsWith(`-${arch}-mac.zip`)) ?? null
}

// Where a release's files are: the GitHub release named v<version>, or the local test server.
export function fileUrl(file: string, version: string, base?: string): string {
  if (/^https?:\/\//.test(file)) return file
  return base ? new URL(file, base).toString() : `https://github.com/courtendvb/syncscout-video-editor-releases/releases/download/v${version}/${encodeURIComponent(file)}`
}

// The .app a running Mac app is in, from process.execPath (…/X.app/Contents/MacOS/X).
export function bundleOf(execPath: string): string | null {
  const m = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath)
  return m ? m[1] : null
}

// Why the app can't replace itself where it is, or null when it can.
export function cannotReplace(app: string | null, writable: (path: string) => boolean): string | null {
  if (!app) return 'not in an .app'
  if (app.startsWith('/Volumes/')) return 'running from a disk image'
  if (app.includes('/AppTranslocation/')) return 'translocated (opened from where it was downloaded)'
  if (!writable(dirname(app)) || !writable(app)) return `no permission to change ${dirname(app)}`
  return null
}

export const canWrite = (path: string): boolean => {
  try { accessSync(path, constants.W_OK); return true } catch { return false }
}

// Downloads `url` to `dest`, checking the sha512 (base64, as latest-mac.yml has it) as it comes.
export async function downloadChecked(url: string, dest: string, sha512: string, fetchFn: (url: string) => Promise<Response>,
  onProgress: (ratio: number) => void = () => {}): Promise<void> {
  const res = await fetchFn(url)
  if (!res.ok || !res.body) throw new Error(`download failed: ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha512')
  const out = createWriteStream(dest)
  let got = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      got += value.length
      if (!out.write(value)) await new Promise<void>(r => out.once('drain', () => r()))
      if (total) onProgress(got / total)
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  }
  const sum = hash.digest('base64')
  if (sum !== sha512) { await rm(dest, { force: true }); throw new Error(`sha512 mismatch for ${url}`) }
}

// Unpacks the zip into `dir` (emptied first) and returns the .app in it, its signature checked.
export async function unpackApp(zip: string, dir: string): Promise<string> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await run('ditto', ['-x', '-k', zip, dir])
  const name = readdirSync(dir).find(n => n.endsWith('.app'))
  if (!name) throw new Error('no .app in the update')
  const app = join(dir, name)
  await run('codesign', ['--verify', '--deep', '--strict', app])
  return app
}

// Waits for the app (pid) to quit, swaps the new app in place of the old (putting the old back if
// that fails), and starts it when RUN is 1. Arguments: pid, new app, app to replace, run.
export const SWAP_SCRIPT = `#!/bin/sh
pid="$1"; new="$2"; target="$3"; start="$4"
i=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 0.2; i=$((i+1))
  [ "$i" -gt 300 ] && { echo "the app did not quit"; exit 1; }
done
old="$target.previous"
rm -rf "$old"
mv "$target" "$old" || { echo "could not move the old app aside"; exit 1; }
if ! mv "$new" "$target"; then mv "$old" "$target"; echo "could not put the new app in place"; exit 1; fi
rm -rf "$old"
xattr -dr com.apple.quarantine "$target" 2>/dev/null
[ "$start" = 1 ] && open "$target"
echo "updated $target"
exit 0
`

// Starts the swap, detached so it outlives the app; its output goes to `logFile`. Synchronous, so
// it is under way even when called as the app quits.
export function startSwap(opts: { pid: number; newApp: string; target: string; start: boolean; scriptDir: string; logFile: string }): void {
  const script = join(opts.scriptDir, 'swap-update.sh')
  writeFileSync(script, SWAP_SCRIPT, { mode: 0o755 })
  const cmd = `"$0" "$@" >> ${shellQuote(opts.logFile)} 2>&1`
  const child = spawn('/bin/sh', ['-c', cmd, script, String(opts.pid), opts.newApp, opts.target, opts.start ? '1' : '0'], { detached: true, stdio: 'ignore' })
  child.once('error', () => { /* /bin/sh is always there; the log shows a swap that didn't run */ })
  child.unref()
}

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

export const stagedAppExists = (app: string | null): app is string => !!app && existsSync(app)
