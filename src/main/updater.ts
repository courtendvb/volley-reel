// Updates for testers (installed copies): on start, look for a newer version among the releases
// (electron-builder.yml's publish: the public volley-reel-releases repository), download it in the
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
// A Mac can only replace a signed app, and the Mac build isn't signed (README): there a newer version
// is only announced, and the banner opens the download page. Without a Mac build in the latest
// release (no latest-mac.yml) the check just fails quietly, into the log.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateEvent } from '../shared/types'
import { t } from '../shared/i18n'

const { autoUpdater } = electronUpdater
export const RELEASES_PAGE = 'https://github.com/courtendvb/volley-reel-releases/releases/latest'

let send: (ev: UpdateEvent) => void = () => {}
let downloaded: string | null = null // the installer, once downloaded and checked
let installing = false
const announceOnly = process.platform === 'darwin'

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
  autoUpdater.autoDownload = !announceOnly
  autoUpdater.autoInstallOnAppQuit = false // installed here instead (see above)
  send = ev => { if (!win.isDestroyed()) win.webContents.send('update:event', ev) }
  log('info', `volley-reel ${app.getVersion()} looking for updates`)
  autoUpdater.on('update-available', info => { log('info', `${info.version} found`); send({ type: announceOnly ? 'manual' : 'available', version: info.version }) })
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
  app.on('will-quit', () => { if (downloaded && !installing && !test) startInstaller(downloaded, false) })
}

// The banner's button, after the renderer has saved: install and start the new version. Returns
// whether the app is quitting for it. With VR_UPDATE_TEST it only says so (it would replace this
// PC's installed copy).
export function installUpdate(): boolean {
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
