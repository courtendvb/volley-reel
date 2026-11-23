// Updates for testers (installed copies): on start, look for a newer version among the releases
// (electron-builder.yml's publish: the public syncscout-video-editor-releases repository), download it in the
// background and tell the renderer; the banner's button saves, then restarts into the new version.
// Quitting without the button installs it too, so the next start is new either way.
// Runs only in an installed copy (or with VR_UPDATE_TEST, against dev-app-update.yml), never in smoke runs.
//
// The installer is started here, not by electron-updater: when Windows won't let it start quietly
// (security software, unsigned-app checks), electron-updater retries it with administrator rights
// ("このアプリがデバイスに変更を加えることを許可しますか？"), which a per-user install never needs
// and which then fails or installs for another account. Instead it is opened the normal way, as
// when installed by hand. Every step goes to update.log in the app's logs folder.
//
// On a Mac, electron-updater can only replace a signed app and the Mac build isn't signed (README):
// it only finds the version there, and macUpdate.ts downloads, checks and swaps it in. Where the
// app can't replace itself (a disk image, translocated, a folder it may not change) the version is
// only announced, and the banner opens the download page. Without a Mac build in the latest
// release (no latest-mac.yml) the check just fails quietly, into the log.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net, shell, type BrowserWindow } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import { bundleOf, canWrite, cannotReplace, downloadChecked, fileUrl, pickMacZip, stagedAppExists, startSwap, unpackApp } from './macUpdate'
import type { UpdateEvent } from '../shared/types'
import { t } from '../shared/i18n'

const { autoUpdater } = electronUpdater
export const RELEASES_PAGE = 'https://github.com/courtendvb/syncscout-video-editor-releases/releases/latest'

let send: (ev: UpdateEvent) => void = () => {}
let downloaded: string | null = null // the installer, once downloaded and checked
let staged: string | null = null // Mac: the new .app, unpacked and checked, waiting to be swapped in
let installing = false
const mac = process.platform === 'darwin'
const TEST_SERVER = 'http://127.0.0.1:8766/' // dev-app-update.yml

export function updateLogPath(): string { return join(app.getPath('logs'), 'update.log') }

function log(level: string, msg: unknown): void {
  const line = `${new Date().toISOString()} ${level} ${msg instanceof Error ? msg.stack ?? msg.message : String(msg)}\n`
  if (level !== 'info') console.warn(`[update] ${line.trim()}`)
  try {
    const f = updateLogPath()
    mkdirSync(join(f, '..'), { recursive: true })
    if ((statSync(f, { throwIfNoEntry: false })?.size ?? 0) > 512 * 1024) writeFileSync(f, '') // keep it small
    appendFileSync(f, line)
  } catch { /* the log is a help, never a reason to fail */ }
}

export function startUpdates(win: BrowserWindow): void {
  const test = !!process.env.VR_UPDATE_TEST
  if ((!app.isPackaged && !test) || process.env.VR_SMOKE) return
  if (test) autoUpdater.forceDevUpdateConfig = true
  autoUpdater.logger = { info: m => log('info', m), warn: m => log('warn', m), error: m => log('error', m), debug: () => {} }
  autoUpdater.autoDownload = !mac // a Mac downloads its own way (macUpdate.ts)
  autoUpdater.autoInstallOnAppQuit = false // installed here instead (see above)
  send = ev => { if (!win.isDestroyed()) win.webContents.send('update:event', ev) }
  log('info', `SyncScout Video Editor ${app.getVersion()} looking for updates`)
  autoUpdater.on('update-available', info => {
    log('info', `${info.version} found`)
    if (!mac) { send({ type: 'available', version: info.version }); return }
    const why = cannotReplace(bundleOf(process.execPath), canWrite)
    if (why) { log('info', `announcing only: ${why}`); send({ type: 'manual', version: info.version }); return }
    send({ type: 'available', version: info.version })
    void stageMac(info, test).catch(e => { log('error', e); send({ type: 'manual', version: info.version }) })
  })
  autoUpdater.on('download-progress', p => send({ type: 'progress', ratio: p.percent / 100 }))
  autoUpdater.on('update-downloaded', info => {
    downloaded = info.downloadedFile
    log('info', `${info.version} downloaded: ${downloaded}`)
    send({ type: 'ready', version: info.version })
  })
  autoUpdater.on('update-not-available', info => log('info', `up to date (${info.version})`))
  // Offline, or nothing published yet: stay quiet (it is logged); the app works as it is.
  autoUpdater.on('error', e => log('error', e))
  void autoUpdater.checkForUpdates().catch(e => log('error', e))
  // Quitting with an update downloaded (あとで): install it quietly; the next start is the new version.
  app.on('will-quit', () => {
    if (installing || test) return
    if (downloaded) startInstaller(downloaded, false)
    else if (stagedAppExists(staged)) { try { swapMac(staged, false) } catch (e) { log('error', e) } }
  })
}

// The banner's button, after the renderer has saved: install and start the new version. Resolves to
// whether the app is quitting for it. With VR_UPDATE_TEST it only says so (it would replace this
// PC's installed copy).
export async function installUpdate(): Promise<boolean> {
  if (mac && stagedAppExists(staged)) {
    if (process.env.VR_UPDATE_TEST) { log('info', `test: would swap in ${staged} now`); return false }
    try {
      swapMac(staged, true)
    } catch (e) {
      installing = false
      log('error', e)
      send({ type: 'error', message: t('更新を入れられませんでした（アプリのフォルダを変更できない可能性があります）') })
      return false
    }
    setImmediate(() => app.quit()) // after the caller has noted that the app is quitting for it
    return true
  }
  if (!downloaded) { send({ type: 'error', message: t('ダウンロードした更新が見つかりません') }); return false }
  if (process.env.VR_UPDATE_TEST) { log('info', `test: would start ${downloaded} now`); return false }
  startInstaller(downloaded, true)
  return true
}

// Quietly first (/S, then start the app again with --force-run). If Windows won't start it that
// way, the installer opens normally, as when run by hand; if even that fails, the banner says so.
function startInstaller(file: string, runAfter: boolean): void {
  installing = true
  const args = ['--updated', '/S', ...(runAfter ? ['--force-run'] : [])]
  log('info', `starting ${file} ${args.join(' ')}`)
  let child
  try {
    child = spawn(file, args, { detached: true, stdio: 'ignore' })
  } catch (e) { openNormally(file, e); return }
  child.once('spawn', () => { child.unref(); log('info', 'installer started; quitting'); if (runAfter) app.quit() })
  child.once('error', e => openNormally(file, e))
}

function openNormally(file: string, why: unknown): void {
  log('warn', `could not start the installer quietly (${(why as NodeJS.ErrnoException)?.code ?? why}); opening it normally`)
  void shell.openPath(file).then(err => {
    if (!err) { log('info', 'installer opened; quitting'); app.quit(); return }
    installing = false
    log('error', `could not open the installer: ${err}`)
    send({ type: 'error', message: t('インストーラーを起動できませんでした（セキュリティソフトなどに止められた可能性があります）') })
  })
}

// Mac: download the release's zip for this chip, check it, unpack it next to the user data. The
// banner then offers the restart, as on Windows.
async function stageMac(info: UpdateInfo, test: boolean): Promise<void> {
  const zip = pickMacZip(info.files, process.arch)
  if (!zip) throw new Error(`no ${process.arch} zip in ${info.version}`)
  const dir = join(app.getPath('userData'), 'update')
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'update.zip')
  const url = fileUrl(zip.url, info.version, test ? TEST_SERVER : undefined)
  log('info', `downloading ${url}`)
  await downloadChecked(url, file, zip.sha512, u => net.fetch(u), ratio => send({ type: 'progress', ratio }))
  staged = await unpackApp(file, join(dir, 'app'))
  await rm(file, { force: true })
  log('info', `${info.version} unpacked and checked: ${staged}`)
  send({ type: 'ready', version: info.version })
}

// Mac: once this app has quit, put the staged app in its place (and start it when asked).
function swapMac(newApp: string, start: boolean): void {
  installing = true
  const target = bundleOf(process.execPath)
  if (!target) throw new Error('not in an .app')
  log('info', `swapping ${newApp} into ${target}${start ? ', then starting it' : ''}`)
  startSwap({ pid: process.pid, newApp, target, start, scriptDir: join(app.getPath('userData'), 'update'), logFile: updateLogPath() })
}
