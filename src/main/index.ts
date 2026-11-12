import { createReadStream, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { folderName, uniqueName } from '../shared/folderName'
import { Readable } from 'node:stream'
import { BrowserWindow, app, clipboard, dialog, ipcMain, nativeImage, protocol, shell } from 'electron'
import type { Annotation } from '../shared/annotation'
import type { CourtFit } from '../shared/court'
import { readManifest, type PackManifest, type PhotoTarget } from '../shared/pack'
import { strToU8, zipSync } from 'fflate'
import type { Reel } from '../shared/reel'
import type { Video } from '../shared/video'
import type { ExportJob, ImportProgress, Match, PickedAsset, ProjectInit, ProjectSettings, SlideFile } from '../shared/types'
import { Exporter } from './export'
import { RELEASES_PAGE, installUpdate, startUpdates, updateLogPath } from './updater'
import { Library } from './library'
import { Project } from './project'
import { readSettings, recentProjects, rememberProject, saveSettings } from './appSettings'
import { lastFolder, rememberFolder, type ExportKind } from '../shared/exportFolders'
import { corruptFirstReel, registerSmokeIpc, runSmoke, type SmokeContext } from './smokeRun'
import { grabFrame, rawFrame } from './media'
import { setMacMenu } from './macMenu'
import { DETECT_H, DETECT_W, detectCourt } from '../shared/courtDetect'
import { getLang, setLang, t, type Lang } from '../shared/i18n'

// media://<matchId>/ streams that match's video with Range support, so <video> can seek.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

// Chromium pauses muted, video-only media when the window is hidden or covered (and Windows
// occlusion tracking counts a window behind another app as hidden). This is an editor: a
// through-play must keep going while the user looks at another window.
app.commandLine.appendSwitch('disable-background-media-suspend')
// The name in package.json stays volley-reel (electron-builder.yml says why), and on Windows nothing
// shows it. A Mac's default menu does ("Quit ..."): fix the settings folder first, as it follows the name.
if (process.platform === 'darwin') { app.setPath('userData', app.getPath('userData')); app.setName('SyncScout Video Editor') }
// A self-check keeps its own window state (panel tabs, the court's look), apart from everyday use.
if (process.env.VR_SMOKE) app.setPath('userData', join(tmpdir(), 'volley-reel-smoke'))
// The memory smoke check forces a GC before each heap sample.
if (process.env.VR_SMOKE_MEM) app.commandLine.appendSwitch('js-flags', '--expose-gc')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

let library: Library | null = null
let project: Project | null = null
const exporter = new Exporter()
let updating = false // restarting into a downloaded update (the renderer saved already)
let win: BrowserWindow | null = null
const lib = () => { if (!library) throw new Error(t('先に倉庫を選んでください')); return library }
const proj = () => { if (!project) throw new Error(t('プロジェクトが開かれていません')); return project }
const assetsDir = () => join(proj().dir, 'assets')
const smokeContext: SmokeContext = { library: () => library, project: () => project, setProject: p => { project = p }, win: () => win, takeAsset: p => takeAsset(p), takeSlideFile: p => takeSlideFile(p) }
const exportsDir = async () => { const dir = join(proj().dir, 'exports'); await mkdir(dir, { recursive: true }); return dir }
// Where a save dialog starts: the folder this project last wrote that kind of file to, else (videos)
// the project's exports folder, or nothing (documents: the system's choice). remembered: after a save.
const startFolder = async (kind: ExportKind): Promise<string | null> => {
  const last = project ? lastFolder(readSettings().exportFolders, project.dir, kind, existsSync) : null
  return last ?? (kind === 'video' ? exportsDir() : null)
}
const remembered = (kind: ExportKind, dir: string) => {
  if (project) saveSettings({ exportFolders: rememberFolder(readSettings().exportFolders, project.dir, kind, dir) })
}

app.whenReady().then(async () => {
  // The interface language (設定 → Language); the first start follows Windows' display language.
  // (VR_LANG=en|ja picks one for a development run without touching the saved setting.)
  setLang((process.env.VR_LANG as Lang | undefined) ?? readSettings().lang ?? (app.getLocale().startsWith('ja') ? 'ja' : 'en'))
  protocol.handle('media', serveMedia)
  if (process.platform === 'darwin') setMacMenu()
  registerIpc()

  const libPath = process.env.VR_LIBRARY || (process.env.VR_PROJECT ? join(dirname(process.env.VR_PROJECT), 'vr-smoke-library') : readSettings().libraryPath)
  // Packs shipped with the app: resources/packs when installed, vendor/packs in development. A
  // self-check reads them only when given (VR_PACKS_DIR), so its results don't depend on them.
  Library.bundledPacks = process.env.VR_PACKS_DIR || (process.env.VR_SMOKE ? null : app.isPackaged ? join(process.resourcesPath, 'packs') : join(app.getAppPath(), 'vendor', 'packs'))
  if (libPath) library = await Library.open(libPath)
  const last = process.env.VR_PROJECT
  if (process.env.VR_SMOKE && process.env.VR_SMOKE_CORRUPT && last) corruptFirstReel(last)
  if (process.env.VR_SMOKE) registerSmokeIpc(smokeContext)
  if (last && library && existsSync(join(last, 'project.json'))) project = await Project.open(last, library)
  else if (last && library && process.env.VR_SMOKE) { await mkdir(last, { recursive: true }); project = await Project.create(last, library, { name: 'smoke', ourTeamCodes: ['HTH', 'HTA'], matchIds: [] }) }

  win = new BrowserWindow({
    width: 1500, height: 900, backgroundColor: '#F1F5F9', title: 'SyncScout Video Editor',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })
  // A file dropped on the window would open in place of the app: nothing may lead it away.
  win.webContents.on('will-navigate', (e, url) => { if (url !== win?.webContents.getURL()) e.preventDefault() })
  win.setMenuBarVisibility(false)
  // Closing: let the renderer write pending reel saves first (autosave runs on a short delay),
  // with a timeout so a stuck renderer can't keep the window open. A running export is cancelled.
  let flushed = false
  win.on('close', e => {
    if (flushed || updating || !win || win.webContents.isDestroyed()) return
    e.preventDefault()
    exporter.cancel()
    const done = () => { if (flushed) return; flushed = true; clearTimeout(timer); win?.close() }
    const timer = setTimeout(done, 3000)
    ipcMain.once('app:flushed', done)
    win.webContents.send('app:flush')
  })
  // ?smoke makes the renderer load its self-check code (smoke.ts); a normal start never does.
  const query = process.env.VR_SMOKE ? '?smoke' : ''
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL + query)
  else await win.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: 'smoke' } : {})

  if (process.env.VR_SMOKE) {
    win.webContents.on('console-message', e => console.log(`[renderer] ${e.message}`))
    if (process.env.VR_SMOKE_MINIMIZE) win.minimize() // reproduces the hidden-window media pause
    await runSmoke(smokeContext, win, process.env.VR_SMOKE)
  }
  startUpdates(win)
})

app.on('window-all-closed', () => app.quit())

function registerIpc(): void {
  ipcMain.handle('project:get', () => project?.info() ?? null)
  ipcMain.handle('library:get', () => library?.info() ?? null)

  ipcMain.handle('library:choose', async () => {
    const r = await dialog.showOpenDialog(win!, { title: t('倉庫にするフォルダを選択（空のフォルダか、既存の倉庫）'), properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    library = await Library.open(r.filePaths[0])
    project = null
    saveSettings({ libraryPath: library.dir })
    return library.info()
  })

  ipcMain.handle('library:scan', async () => {
    const l = lib()
    const r = await dialog.showOpenDialog(win!, { title: t('動画と DVW があるフォルダを選択（複数可）'), properties: ['openDirectory', 'multiSelections'] })
    if (r.canceled || !r.filePaths.length) return null
    return l.scan(r.filePaths)
  })

  ipcMain.handle('library:importPairs', async (e, pairs: { dvwPath: string; video: string }[]) => {
    const l = lib()
    return importPairs(l, pairs, p => e.sender.send('import:progress', p))
  })

  ipcMain.handle('project:recent', () => recentProjects())

  ipcMain.handle('project:create', async (_e, init: ProjectInit) => {
    const l = lib()
    const name = init.name.trim() || t('{0} プロジェクト', init.ourTeamCodes[0] ?? '').trim()
    let dir: string
    if (init.chooseFolder) {
      const r = await dialog.showOpenDialog(win!, { title: t('プロジェクトを作るフォルダを選択（空のフォルダ）'), properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    } else {
      // No folder to pick: a new one named after the project, next to the library's matches.
      const root = join(l.dir, 'projects')
      dir = join(root, uniqueName(folderName(name), n => existsSync(join(root, n))))
      await mkdir(dir, { recursive: true })
    }
    project = await Project.create(dir, l, { ...init, name })
    rememberProject(project)
    return project.info()
  })

  ipcMain.handle('project:open', async (_e, path?: string) => {
    const l = lib()
    let dir = path
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { title: t('プロジェクトのフォルダを選択'), properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    project = await Project.open(dir, l)
    rememberProject(project)
    return project.info()
  })

  ipcMain.handle('project:close', () => { project = null })

  ipcMain.handle('project:setMatches', async (_e, ids: string[]) => {
    const p = proj()
    await p.setMatches(ids)
    return p.info()
  })

  ipcMain.handle('match:import', async e => {
    const l = lib()
    const v = await dialog.showOpenDialog(win!, { title: t('試合の動画を選択'), properties: ['openFile'],
      filters: [videoFilter()] })
    if (v.canceled || !v.filePaths[0]) return null
    const d = await dialog.showOpenDialog(win!, { title: t('スカウトファイル（.dvw / .vsm）を選択'), properties: ['openFile'],
      filters: [dvwFilter] })
    if (d.canceled || !d.filePaths[0]) return null
    return l.importMatch(v.filePaths[0], d.filePaths[0], p => e.sender.send('import:progress', p))
  })

  ipcMain.handle('match:relocate', async (e, id: string, part: 'video' | 'dvw') => {
    const l = lib()
    const m = l.getMatch(id)
    if (!m) throw new Error(t('試合が見つかりません: {0}', id))
    const r = await dialog.showOpenDialog(win!, part === 'video'
      ? { title: t('{0} の動画を選択（元: {1}）', m.name, basename(m.sourceVideoPath)), properties: ['openFile'], filters: [videoFilter()] }
      : { title: t('{0} の DVW を選択（元: {1}）', m.name, basename(m.dvwPath)), properties: ['openFile'], filters: [dvwFilter] })
    if (r.canceled || !r.filePaths[0]) return null
    const note = await l.relocate(id, part, r.filePaths[0], p => e.sender.send('import:progress', p))
    return { library: l.info(), project: project?.info() ?? null, note }
  })

  ipcMain.handle('match:setCourt', async (_e, id: string, court: CourtFit | null) => {
    const l = lib()
    await l.setCourt(id, court)
    return project?.info() ?? null
  })

  ipcMain.handle('project:saveSettings', async (_e, s: ProjectSettings) => {
    const p = proj()
    await p.saveSettings(s)
    return p.info()
  })

  ipcMain.handle('export:choosePath', async (_e, name: string) => {
    const dir = (await startFolder('video'))!
    const safe = name.replace(/[\/:*?"<>|]/g, '_').trim() || 'reel'
    const r = await dialog.showSaveDialog(win!, { title: t('MP4 に書き出す'), defaultPath: join(dir, `${safe}.mp4`), filters: [{ name: 'MP4', extensions: ['mp4'] }] })
    if (r.canceled || !r.filePath) return null
    remembered('video', dirname(r.filePath))
    return r.filePath
  })

  // One MP4 per scene: a folder, then a path in it for each file name (names come safe and unique
  // from sceneFileNames). Returns which of them are already there, so the user can say whether to overwrite.
  ipcMain.handle('export:chooseFolder', async (_e, names: string[]) => {
    const dir = (await startFolder('video'))!
    const r = await dialog.showOpenDialog(win!, { title: t('シーンごとに書き出すフォルダ'), defaultPath: dir, properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    remembered('video', r.filePaths[0])
    const paths = names.map(n => join(r.filePaths[0], `${n}.mp4`))
    return { paths, existing: paths.filter(p => existsSync(p)) }
  })

  // Starts in the background and returns at once; progress and the result arrive as export:event.
  ipcMain.handle('export:start', (e, job: ExportJob) => {
    const p = proj()
    if (exporter.running) throw new Error(t('書き出し中です。終わるか、キャンセルしてからもう一度試してください'))
    void exporter.run(job, join(p.dir, 'export-work'), id => p.getMatch(id)?.videoPath, ev => {
      if (!e.sender.isDestroyed()) e.sender.send('export:event', ev)
    })
  })
  ipcMain.handle('export:cancel', () => exporter.cancel())
  ipcMain.handle('project:notices', () => project?.takeNotices() ?? library?.notices.splice(0) ?? [])
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('app:version', () => app.getVersion())
  // The preload reads the language synchronously, so the interface's text is right from its first paint.
  ipcMain.on('app:lang', e => { e.returnValue = getLang() })
  ipcMain.handle('app:setLang', (_e, l: Lang) => { setLang(l); saveSettings({ lang: getLang() }) })
  // The renderer has saved: no flush on the way out, straight into the installer.
  ipcMain.handle('update:install', () => { updating = installUpdate() })
  ipcMain.handle('update:help', (_e, what: 'page' | 'log') => (what === 'page' ? shell.openExternal(RELEASES_PAGE) : shell.showItemInFolder(updateLogPath())))

  ipcMain.handle('palette:get', () => library?.palette() ?? { colors: [], items: [] })
  ipcMain.handle('palette:setColors', (_e, colors: string[]) => lib().setPaletteColors(colors))
  ipcMain.handle('palette:save', (_e, name: string, anns: Annotation[], category: string | null) => lib().savePaletteItem(name, anns, assetsDir(), category))
  ipcMain.handle('palette:addCategory', (_e, name: string) => lib().addPaletteCategory(name))
  ipcMain.handle('palette:renameCategory', (_e, id: string, name: string) => lib().renamePaletteCategory(id, name))
  ipcMain.handle('palette:moveCategory', (_e, id: string, to: number) => lib().movePaletteCategory(id, to))
  ipcMain.handle('palette:removeCategory', (_e, id: string) => lib().removePaletteCategory(id))
  ipcMain.handle('palette:setCategory', (_e, id: string, category: string | null) => lib().setPaletteItemCategory(id, category))
  ipcMain.handle('palette:remove', (_e, id: string) => lib().removePaletteItem(id))
  ipcMain.handle('palette:move', (_e, id: string, to: number) => lib().movePaletteItem(id, to))
  ipcMain.handle('palette:lock', (_e, id: string, locked: boolean) => lib().lockPaletteItem(id, locked))
  ipcMain.handle('palette:use', (_e, id: string) => lib().usePaletteItem(id, assetsDir()))
  ipcMain.handle('logo:list', () => library?.logos() ?? {})
  ipcMain.handle('logo:pick', async (_e, code: string) => {
    const l = lib()
    const r = await dialog.showOpenDialog(win!, {
      title: t('{0} のロゴを選ぶ', code), properties: ['openFile'],
      filters: [{ name: t('画像'), extensions: IMAGE_EXT }],
    })
    if (!r.canceled && r.filePaths[0]) await l.setLogo(code, r.filePaths[0])
    return l.logos()
  })
  ipcMain.handle('logo:remove', async (_e, code: string) => { await library?.removeLogo(code); return library?.logos() ?? {} })
  ipcMain.handle('logo:read', (_e, code: string) => library?.readLogo(code) ?? null)
  // A team's logo copied into the project's assets, to put on a card as a picture; null without one.
  ipcMain.handle('logo:use', async (_e, code: string) => {
    const l = lib(), f = (await l.logos())[code.toUpperCase()], data = f ? await l.readLogo(code) : null
    if (!f || !data) return null
    const ext = extname(f).slice(1).toLowerCase()
    const { width, height } = nativeImage.createFromBuffer(Buffer.from(data)).getSize()
    return { assetId: await saveAsset(data, ext === 'jpeg' ? 'jpg' : ext), width: width || 1, height: height || 1 }
  })
  // Add-on packs: read from a .vrpack the user picks, kept in the library for every project.
  ipcMain.handle('pack:list', () => library?.packs() ?? [])
  ipcMain.handle('pack:import', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: t('アドオンのパックを読み込む'), properties: ['openFile'],
      filters: [{ name: t('SyncScout Video Editor パック'), extensions: ['vrpack', 'zip'] }],
    })
    if (!r.canceled && r.filePaths[0]) await lib().importPack(r.filePaths[0])
    return lib().packs()
  })
  // A card as a picture, or the cards as a PDF: to a file the user names; the path, or null.
  ipcMain.handle('card:save', async (_e, name: string, ext: 'png' | 'pdf', data: Uint8Array) => {
    const file = `${name.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`, dir = await startFolder('docs')
    const r = await dialog.showSaveDialog(win!, { title: t('スライドを書き出す'), defaultPath: dir ? join(dir, file) : file, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled || !r.filePath) return null
    remembered('docs', dirname(r.filePath))
    await writeFile(r.filePath, data)
    return r.filePath
  })
  // The match report as an A4 PDF: its page drawn in a hidden window, printed, saved where the user says.
  ipcMain.handle('report:pdf', async (_e, html: string, name: string) => {
    const file = `${name.replace(/[\\/:*?"<>|]/g, '_')}.pdf`, dir = await startFolder('docs')
    const r = await dialog.showSaveDialog(win!, { title: t('マッチレポートを PDF に書き出す'), defaultPath: dir ? join(dir, file) : file, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (r.canceled || !r.filePath) return null
    remembered('docs', dirname(r.filePath))
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
    try {
      await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
      await writeFile(r.filePath, pdf)
    } finally { w.destroy() }
    return r.filePath
  })
  ipcMain.handle('pack:roster', () => lib().roster())
  // A pack made in the app: to a file the user names, or straight into the library. The file name, or
  // null when the save was called off.
  ipcMain.handle('pack:save', async (_e, manifest: PackManifest, photos: Record<string, Uint8Array>, install: boolean) => {
    const m = readManifest(manifest)
    if (!m || !m.players.length) throw new Error(t('パックの内容が読めません'))
    const zip = zipSync({ 'manifest.json': strToU8(JSON.stringify(m, null, 1)), ...Object.fromEntries(Object.entries(photos).map(([f, d]) => [`photos/${f}`, d])) }, { level: 0 })
    if (install) { await lib().importPackData(zip); return { saved: m.name, packs: await lib().packs() } }
    const r = await dialog.showSaveDialog(win!, { title: t('パックを書き出す'), defaultPath: `${m.name.replace(/[\\/:*?"<>|]/g, '_')}.vrpack`, filters: [{ name: t('SyncScout Video Editor パック'), extensions: ['vrpack'] }] })
    if (r.canceled || !r.filePath) return { saved: null, packs: await lib().packs() }
    await writeFile(r.filePath, zip)
    return { saved: r.filePath, packs: await lib().packs() }
  })
  ipcMain.handle('pack:remove', async (_e, id: string) => { await lib().removePack(id); return lib().packs() })
  ipcMain.handle('pack:setPhoto', async (_e, tg: PhotoTarget) => {
    const r = await dialog.showOpenDialog(win!, {
      title: t('{0} の写真を選ぶ', tg.label ?? tg.lastName), properties: ['openFile'],
      filters: [{ name: t('写真'), extensions: ['png', 'jpg', 'jpeg'] }],
    })
    if (!r.canceled && r.filePaths[0]) await lib().setPlayerPhoto(tg, r.filePaths[0])
    return lib().packs()
  })
  ipcMain.handle('pack:removePhoto', async (_e, tg: PhotoTarget) => { await lib().removePlayerPhoto(tg); return lib().packs() })
  ipcMain.handle('pack:readPhoto', (_e, id: string, photo: string) => lib().readPackPhoto(id, photo))
  ipcMain.handle('pack:usePhoto', async (_e, id: string, photo: string) => {
    const { assetId, path } = await lib().usePackPhoto(id, photo, assetsDir())
    const { width, height } = nativeImage.createFromPath(path).getSize()
    return { assetId, width: width || 3, height: height || 4 } // unreadable size: a portrait frame
  })

  ipcMain.handle('asset:pick', async () => {
    proj() // needs an open project before asking for a file
    const r = await dialog.showOpenDialog(win!, {
      title: t('画像・PDF を挿入'), properties: ['openFile'],
      filters: [{ name: t('画像・PDF'), extensions: [...IMAGE_EXT, 'pdf'] }],
    })
    return r.canceled || !r.filePaths[0] ? null : takeAsset(r.filePaths[0])
  })
  ipcMain.handle('asset:save', (_e, png: Uint8Array) => saveAsset(png, 'png'))
  // Ctrl+V: what the system clipboard holds. Copying objects in the app leaves OBJECTS_MARK there,
  // so whatever was copied last (objects here, or a screenshot / picture elsewhere) is what pastes.
  ipcMain.handle('clipboard:kind', async () => {
    if ((await clipboard.readText().catch(() => '')) === OBJECTS_MARK) return 'objects'
    return (await clipboardPicture()) ? 'image' : 'other'
  })
  ipcMain.handle('clipboard:markObjects', () => clipboard.writeText(OBJECTS_MARK))
  // The clipboard's picture saved into the project's assets as a PNG (like a picked image).
  ipcMain.handle('clipboard:saveImage', async () => {
    const blob = await clipboardPicture()
    if (!blob) return null
    const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
    if (img.isEmpty()) return null
    const { width, height } = img.getSize()
    return { assetId: await saveAsset(img.toPNG(), 'png'), width, height }
  })
  ipcMain.handle('asset:read', (_e, id: string) => {
    const dir = assetsDir()
    if (!ASSET_ID.test(id)) throw new Error('bad asset id')
    return readFile(join(dir, id))
  })

  ipcMain.handle('slide:pick', async () => {
    proj() // needs an open project before asking for a file
    const r = await dialog.showOpenDialog(win!, {
      title: t('スライドを読み込む（PDF・画像。複数選べます）'), properties: ['openFile', 'multiSelections'],
      filters: [{ name: t('PDF・画像'), extensions: ['pdf', ...IMAGE_EXT] }],
    })
    // Pictures in name order, numbers by value (スライド2 before スライド10), as exported from PowerPoint.
    const paths = r.canceled ? [] : [...r.filePaths].sort((a, b) => basename(a).localeCompare(basename(b), 'ja', { numeric: true }))
    return Promise.all(paths.map(takeSlideFile))
  })
  // Only files slides already came from are read again (the renderer can't name any other file).
  ipcMain.handle('slide:read', async (_e, path: string) => {
    if (!(await slideSources()).has(path)) throw new Error(t('スライドの元のファイルではありません'))
    return takeSlideFile(path)
  })
  ipcMain.handle('slide:times', async (_e, paths: string[]) => {
    const known = await slideSources()
    const out: Record<string, number | null> = {}
    for (const p of paths) out[p] = known.has(p) ? await stat(p).then(s => s.mtimeMs, () => null) : null
    return out
  })
  ipcMain.handle('slide:frame', async (_e, matchId: string, sec: number) => {
    const file = library?.getMatch(matchId)?.videoPath
    if (!file || !existsSync(file)) throw new Error(t('動画が見つかりません'))
    const dir = assetsDir()
    await mkdir(dir, { recursive: true })
    const id = `${randomUUID()}.png`
    await grabFrame(file, sec, join(dir, id))
    return id
  })

  // Frames spread over the match, so the median of them has no players on the floor.
  ipcMain.handle('court:detect', async (_e, matchId: string) => {
    const m = library?.getMatch(matchId)
    if (!m?.videoPath || !existsSync(m.videoPath)) throw new Error(t('動画が見つかりません'))
    const frames = await Promise.all([0.2, 0.35, 0.5, 0.65, 0.8].map(at => rawFrame(m.videoPath, m.durationSec * at, DETECT_W, DETECT_H)))
    return detectCourt(frames)?.corners ?? null
  })

  ipcMain.handle('video:list', () => project?.listVideos() ?? [])
  ipcMain.handle('video:save', (_e, v: Video) => proj().saveVideo(v))
  ipcMain.handle('video:delete', (_e, id: string) => project?.deleteVideo(id))
  ipcMain.handle('reel:list', () => project?.listReels() ?? [])
  ipcMain.handle('reel:save', (_e, r: Reel) => proj().saveReel(r))
  ipcMain.handle('reel:delete', (_e, id: string) => project?.deleteReel(id))

  ipcMain.handle('match:parse', (_e, id: string) => proj().parse(id))
}

const videoFilter = () => ({ name: t('動画'), extensions: ['mp4', 'MP4', 'mov', 'MOV', 'mts', 'MTS', 'm4v'] })
const dvwFilter = { name: 'DataVolley / VolleyStation', extensions: ['dvw', 'DVW', 'vsm', 'VSM'] }
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const ASSET_ID = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|bmp)$/
const OBJECTS_MARK = '[SyncScout Video Editor: objects copied]' // on the system clipboard after copying objects

// The picture on the system clipboard (a screenshot, an image copied in a browser or PowerPoint), or null.
async function clipboardPicture(): Promise<Blob | null> {
  const items = await clipboard.read().catch(() => [])
  for (const it of items) {
    const type = it.types.find(t => t === 'image/png') ?? it.types.find(t => t.startsWith('image/'))
    if (type) return (await it.getType(type)) as Blob
  }
  return null
}

async function takeAsset(path: string): Promise<PickedAsset> {
  const ext = extname(path).slice(1).toLowerCase()
  const data = await readFile(path)
  if (ext === 'pdf') return { kind: 'pdf', data: new Uint8Array(data), name: basename(path) }
  if (!IMAGE_EXT.includes(ext)) throw new Error(t('画像（PNG・JPEG など）か PDF を選んでください'))
  return { kind: 'image', assetId: await saveAsset(data, ext === 'jpeg' ? 'jpg' : ext) }
}

// The files slides were read from: picked in this session, or named by the project's saved scenes.
const pickedSlides = new Set<string>()
async function slideSources(): Promise<Set<string>> {
  const out = new Set(pickedSlides)
  for (const r of (await project?.listReels()) ?? []) for (const s of r.slides ?? []) if (s.bg.kind === 'image' && s.bg.source) out.add(s.bg.source.path)
  return out
}

async function takeSlideFile(path: string): Promise<SlideFile> {
  pickedSlides.add(path)
  const ext = extname(path).slice(1).toLowerCase()
  if (ext !== 'pdf' && !IMAGE_EXT.includes(ext)) throw new Error(t('PDF か画像（PNG・JPEG など）を選んでください'))
  const [data, st] = await Promise.all([readFile(path), stat(path)])
  const base = { path, name: basename(path), mtimeMs: st.mtimeMs }
  if (ext === 'pdf') return { ...base, kind: 'pdf', data: new Uint8Array(data) }
  return { ...base, kind: 'image', assetId: await saveAsset(data, ext === 'jpeg' ? 'jpg' : ext) }
}

// A copy in the project, so the project keeps working if the original file moves.
async function saveAsset(data: Uint8Array, ext: string): Promise<string> {
  const dir = assetsDir()
  await mkdir(dir, { recursive: true })
  const id = `${randomUUID()}.${ext}`
  await writeFile(join(dir, id), data)
  return id
}

async function serveMedia(req: Request): Promise<Response> {
  const id = new URL(req.url).hostname
  const file = library?.getMatch(id)?.videoPath
  if (!file || !existsSync(file)) return new Response('not found', { status: 404 })
  const size = (await stat(file)).size
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '')
  if (!m) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
      status: 200, headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
    })
  }
  let start = m[1] ? +m[1] : size - +m[2]
  let end = m[1] && m[2] ? +m[2] : size - 1
  start = Math.max(0, start); end = Math.min(end, size - 1)
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1),
    },
  })
}

// Bulk import, step 2: one match at a time (probing is quick; preparing a copy can take minutes).
async function importPairs(lib: Library, pairs: { dvwPath: string; video: string }[], progress: (p: ImportProgress) => void) {
  const imported: Match[] = [], failed: { dvwPath: string; message: string }[] = []
  for (const [i, p] of pairs.entries()) {
    try {
      imported.push(await lib.importMatch(p.video, p.dvwPath, ev => progress({ ...ev, item: i, items: pairs.length, message: `${i + 1} / ${pairs.length}: ${ev.message}` })))
    } catch (e) {
      failed.push({ dvwPath: p.dvwPath, message: (e as Error).message })
    }
  }
  return { imported, failed }
}
