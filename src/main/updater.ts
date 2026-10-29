// Updates for testers (installed copies): on start, look for a newer version among the releases
// (electron-builder.yml's publish: the public volley-reel-releases repository), download it in the
// background and tell the renderer; the banner's button saves, then restarts into the new version.
// Quitting without the button installs it silently too, so the next start is new either way.
// Runs only in an installed copy (or with VR_UPDATE_TEST, against dev-app-update.yml), never in smoke runs.
import { app, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateEvent } from '../shared/types'

const { autoUpdater } = electronUpdater

export function startUpdates(win: BrowserWindow): void {
  const test = !!process.env.VR_UPDATE_TEST
  if ((!app.isPackaged && !test) || process.env.VR_SMOKE) return
  if (test) autoUpdater.forceDevUpdateConfig = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = !test // a test never installs (it would replace this PC's copy)
  const send = (ev: UpdateEvent) => { if (!win.isDestroyed()) win.webContents.send('update:event', ev) }
  autoUpdater.on('update-available', info => { console.log(`[update] ${info.version} found`); send({ type: 'available', version: info.version }) })
  autoUpdater.on('download-progress', p => send({ type: 'progress', ratio: p.percent / 100 }))
  autoUpdater.on('update-downloaded', info => { console.log(`[update] ${info.version} downloaded`); send({ type: 'ready', version: info.version }) })
  autoUpdater.on('update-not-available', info => console.log(`[update] up to date (${info.version})`))
  // Offline, or nothing published yet: stay quiet; the app works as it is.
  autoUpdater.on('error', e => console.warn(`[update] ${e.message}`))
  void autoUpdater.checkForUpdates().catch(e => console.warn(`[update] ${(e as Error).message}`))
}

// Called by the banner's button after the renderer has saved: restart into the new version.
// With VR_UPDATE_TEST it only says so: the installer would replace the copy installed on this PC.
export function installUpdate(): boolean {
  if (process.env.VR_UPDATE_TEST) { console.log('[update] would restart into the update now (not in a test)'); return false }
  autoUpdater.quitAndInstall(true, true) // silent install, then start the new version
  return true
}
