import { createReadStream, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { folderName, uniqueName } from '../shared/folderName'
import { cleanLook, type VideoLook } from '../shared/videoLook'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, clipboard, dialog, ipcMain, nativeImage, protocol, safeStorage, shell } from 'electron'
import { APP_NAME } from '../shared/edition'
import { Account, AccountFailure, ENFORCED, LEASE_PUBLIC_KEY } from './account'
import { FREE_MATCHES, WEB_ADMIN_URL, WEB_URL, type TeamAction } from '../shared/account'
import type { Annotation } from '../shared/annotation'
import type { CourtFit } from '../shared/court'
import type { ScoutInsert } from '../shared/codeEdit'
import { readManifest, type PackManifest, type PhotoTarget } from '../shared/pack'
import { strToU8, zipSync } from 'fflate'
import type { Reel } from '../shared/reel'
import type { Video } from '../shared/video'
import type { CompareSession, CompareSource } from '../shared/videoCompare'
import { runLength, type CompareExportJob, type CompareExportSide, type CompareRunSide } from '../shared/compareExport'
import type { ExportJob, ImportProgress, Match, ParsedDVW, PickedAsset, ProjectInit, ProjectSettings, ProjectSummary, SlideFile } from '../shared/types'
import { Exporter } from './export'
import { RELEASES_PAGE, installUpdate, startUpdates, updateLogPath } from './updater'
import { Library } from './library'
import { CompareStore } from './compare'
import { Project } from './project'
import { readSettings, recentProjects, rememberProject, saveSettings } from './appSettings'
import { lastFolder, rememberFolder, type ExportKind } from '../shared/exportFolders'
import { corruptFirstReel, registerSmokeIpc, runSmoke, type SmokeContext } from './smokeRun'
import { grabFrame, probe, rawFrame } from './media'
import { setMacMenu } from './macMenu'
import { DETECT_H, DETECT_W, detectCourt } from '../shared/courtDetect'
import { getLang, setLang, t, type Lang } from '../shared/i18n'
import { stripDevEnv } from './devEnv'

// An installed copy ignores the development-only variables (devEnv.ts): no self-check mode, no
// accounts switched off, no other lease key, no other page in the window. Nothing reads them before
// this line (the imports above only define things).
if (app.isPackaged) stripDevEnv(process.env)

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
// The internal edition (src/internal/README.md) keeps its own settings folder, so it installs beside the sold
// one without the two sharing settings or sign-in (the library can still be the same folder).
if (__INTERNAL__) app.setPath('userData', join(app.getPath('appData'), 'volley-reel-internal'))
if (process.platform === 'darwin') { app.setPath('userData', app.getPath('userData')); app.setName(APP_NAME) }
// A self-check keeps its own window state (panel tabs, the court's look), apart from everyday use.
if (process.env.VR_SMOKE) app.setPath('userData', join(tmpdir(), 'volley-reel-smoke'))
// The memory smoke check forces a GC before each heap sample.
if (process.env.VR_SMOKE_MEM) app.commandLine.appendSwitch('js-flags', '--expose-gc')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

let library: Library | null = null
let project: Project | null = null
let lastCompareDir: string | null = null
let compares!: CompareStore // set when the app is ready
const exporter = new Exporter()
let updating = false // restarting into a downloaded update (the renderer saved already)
let win: BrowserWindow | null = null
let account: Account // made when the app is ready (it needs the user data folder)
// Exports, imports and new projects ask first (shared/account.ts: gate); a yes until accounts are on.
const mayExport = () => {
  const r = account.refusal('export')
  if (r === 'sign_in') throw new Error(t('書き出すには SyncScout へのログイン（お試し中か契約中）が必要です。ホーム画面右上のボタンか、書き出し画面の案内からログインしてください'))
  if (r === 'plan') throw new Error(t('お試し期間か契約が終わっているため、書き出せません。ホーム画面右上のボタンから契約を確認してください'))
}
const mayImport = (adding: number) => {
  const r = account.refusal('import', library?.info().matches.length ?? 0, adding)
  if (r === 'sign_in') throw new Error(t('ログインしていない間は、倉庫に入れられる試合は {0} 試合までです。ログインすると（初めての方は14日間無料）制限なく取り込めます。ホーム画面右上のボタンからログインしてください', FREE_MATCHES))
  if (r === 'plan') throw new Error(t('お試し期間か契約が終わっているため、試合を追加できません。作ったプロジェクトはこれまでどおり開いて編集できます'))
}
const mayCreateProject = () => {
  if (account.refusal('newProject')) throw new Error(t('お試し期間か契約が終わっているため、新しいプロジェクトは作れません。作ったプロジェクトはこれまでどおり開いて編集できます'))
}
// What a failed account call says to the user.
const accountMessage = (e: unknown): string => {
  const code = e instanceof AccountFailure ? e.code : 'server'
  return ({
    invalid_code: t('コードが違うか、期限が切れています。もう一度送ってください'),
    invalid_device: t('このパソコンのログインが取り消されました。もう一度ログインしてください'),
    licence_expired: t('お試し期間か契約が終わっています'),
    payment_required: t('お支払いが確認できていません。カードの情報を確かめてください'),
    no_access: t('このチームの契約には Video Editor が含まれていません'),
    too_many_attempts: t('試行が多すぎます。少し待ってからもう一度試してください'),
    already_subscribed: t('このチームはすでに有料プランを契約しています。「状態を更新」を押してください'),
    invalid_credentials: t('チームID か合言葉が違います'),
    trial_used: t('このアカウントの無料お試しは使用済みです。チームに参加するか、有料プランをお申し込みください'),
    network: t('サーバーにつながりません。インターネットの接続を確かめてください'),
    server: t('サーバーでエラーが起きました。少し待ってからもう一度試してください'),
  } as Record<string, string>)[code]
}
const withAccount = async <T>(f: () => Promise<T>): Promise<T> => {
  try { return await f() } catch (e) { throw new Error(accountMessage(e)) }
}
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
  setLang((process.env.VR_LANG as Lang | undefined) ?? readSettings().lang ?? (app.getLocale().startsWith('ja') ? 'ja' : app.getLocale().startsWith('es') ? 'es' : 'en'))
  account = new Account({
    dir: app.getPath('userData'),
    appVersion: app.getVersion(),
    // Off in self-checks; VR_ACCOUNTS=1 (+ VR_LEASE_KEY) tries it before the release that turns it on.
    enabled: !process.env.VR_SMOKE && (ENFORCED || process.env.VR_ACCOUNTS === '1'),
    publicKey: process.env.VR_LEASE_KEY || LEASE_PUBLIC_KEY,
    // The internal edition: the addresses its features open for (electron.vite.config.ts); none in the sold one.
    ...(__INTERNAL__ ? { internalEmails: __INTERNAL_EMAILS__ } : {}),
    ...(safeStorage.isEncryptionAvailable() ? {
      encrypt: (s: string) => safeStorage.encryptString(s).toString('base64'),
      decrypt: (s: string) => safeStorage.decryptString(Buffer.from(s, 'base64')),
    } : {}),
  })
  compares = new CompareStore(join(app.getPath('userData'), 'compare'))
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
    width: 1500, height: 900, backgroundColor: '#F1F5F9', title: APP_NAME,
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
  // A fresh lease once half of it has run; checked at start and every few hours after.
  void account.refreshIfDue()
  setInterval(() => void account.refreshIfDue(), 6 * 3600 * 1000).unref()
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
    mayImport(1) // before the folders are picked, when not even one more would go in
    const r = await dialog.showOpenDialog(win!, { title: t('動画と DVW があるフォルダを選択（複数可）'), properties: ['openDirectory', 'multiSelections'] })
    if (r.canceled || !r.filePaths.length) return null
    return l.scan(r.filePaths)
  })

  ipcMain.handle('library:importPairs', async (e, pairs: { dvwPath: string; video: string }[]) => {
    const l = lib()
    mayImport(pairs.length)
    return importPairs(l, pairs, p => e.sender.send('import:progress', p))
  })

  // Video comparison: files with no DVW, and the saved sessions (shared/videoCompare.ts).
  ipcMain.handle('compare:pickVideo', async e => {
    const r = await dialog.showOpenDialog(win!, { title: t('比べる動画を選択'), properties: ['openFile'], filters: [{ name: t('動画'), extensions: ['mp4', 'mov', 'm4v', 'mts', 'm2ts', 'mkv', 'avi', 'webm'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    return compares.open(r.filePaths[0], p => e.sender.send('import:progress', p))
  })
  ipcMain.handle('compare:openVideo', (e, path: string) => compares.open(path, p => e.sender.send('import:progress', p)))
  ipcMain.handle('compare:parseMatch', (_e, id: string) => lib().parse(id)) // no project is open in a comparison
  ipcMain.handle('compare:list', () => compares.list())
  ipcMain.handle('compare:save', (_e, s: CompareSession) => compares.save(s))
  ipcMain.handle('compare:remove', (_e, id: string) => compares.remove(id))

  ipcMain.handle('project:recent', () => recentProjects())

  ipcMain.handle('project:create', async (_e, init: ProjectInit) => {
    const l = lib()
    mayCreateProject()
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

  // One match on its own, from the library's list: the project made for that match and team before
  // (one match, that team ours; in <library>/projects or among the recent ones), else a new one there.
  ipcMain.handle('project:openMatch', async (_e, matchId: string, code: string) => {
    const l = lib()
    const m = l.info().matches.find(x => x.id === matchId)
    if (!m) throw new Error(t('試合が見つかりません: {0}', matchId))
    const root = join(l.dir, 'projects')
    for (const dir of await projectDirs(l)) {
      try {
        const f = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as { matchIds?: string[]; ourTeamCodes?: string[] }
        if (f.matchIds?.length !== 1 || f.matchIds[0] !== matchId || f.ourTeamCodes?.[0]?.toUpperCase() !== code.toUpperCase()) continue
        project = await Project.open(dir, l)
        rememberProject(project)
        return project.info()
      } catch { /* not a project, or unreadable: look on */ }
    }
    mayCreateProject() // its project made before opens above; a new one is a new project
    const opp = m.teams.find(x => x.code.toUpperCase() !== code.toUpperCase())?.code ?? ''
    const name = [code, m.date, opp && `vs ${opp}`].filter(Boolean).join(' ')
    const dir = join(root, uniqueName(folderName(name), n => existsSync(join(root, n))))
    await mkdir(dir, { recursive: true })
    project = await Project.create(dir, l, { name, ourTeamCodes: [code], matchIds: [matchId] })
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

  // Other projects, for comparing their target team with this one's: the name, the team, how many matches.
  ipcMain.handle('project:others', async () => {
    const l = lib(), here = project?.dir.toLowerCase()
    const out: ProjectSummary[] = []
    for (const dir of await projectDirs(l)) {
      if (dir.toLowerCase() === here) continue
      const f = await projectFile(dir)
      if (f) out.push({ path: dir, name: f.name || basename(dir), code: f.ourTeamCodes?.[0] ?? '', matches: (f.matchIds ?? []).filter(id => l.getMatch(id)).length })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  })
  // That project's matches parsed from the library (only read: the project stays as it is).
  ipcMain.handle('project:dvws', async (_e, dir: string) => {
    const l = lib(), f = await projectFile(dir)
    if (!f) throw new Error(t('プロジェクトが見つかりません（project.json がありません）'))
    const dvws: ParsedDVW[] = [], failed: string[] = []
    for (const id of f.matchIds ?? []) {
      if (!l.getMatch(id)) continue
      try { dvws.push(await l.parse(id)) } catch (e) { failed.push((e as Error).message) }
    }
    return { name: f.name || basename(dir), code: f.ourTeamCodes?.[0] ?? '', dvws, failed }
  })

  ipcMain.handle('project:setMatches', async (_e, ids: string[]) => {
    const p = proj()
    await p.setMatches(ids)
    return p.info()
  })

  ipcMain.handle('match:import', async e => {
    const l = lib()
    mayImport(1)
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

  // Projects that list a match (for the warning before it is deleted).
  ipcMain.handle('match:users', async (_e, id: string) => {
    const out: string[] = []
    for (const dir of await projectDirs(lib())) {
      const f = await projectFile(dir)
      if (f?.matchIds?.includes(id)) out.push(f.name || basename(dir))
    }
    return out
  })
  ipcMain.handle('match:delete', async (_e, id: string) => {
    const l = lib()
    await l.deleteMatch(id)
    if (project) await project.setMatches(project.info().matchIds.filter(x => x !== id))
    return { library: l.info(), project: project?.info() ?? null }
  })
  // A project's folder goes to the trash (it can be put back from there); the open one can't go.
  ipcMain.handle('project:delete', async (_e, path: string) => {
    if (project && project.dir.toLowerCase() === path.toLowerCase()) throw new Error(t('開いているプロジェクトは削除できません。先にホームへ戻ってください'))
    if (!existsSync(join(path, 'project.json'))) throw new Error(t('プロジェクトが見つかりません（project.json がありません）'))
    await shell.trashItem(path)
    return recentProjects()
  })

  ipcMain.handle('match:setCourt', async (_e, id: string, court: CourtFit | null) => {
    const l = lib()
    await l.setCourt(id, court)
    return project?.info() ?? null
  })

  ipcMain.handle('match:setOffset', async (_e, id: string, offsetSec: number) => {
    await lib().setOffset(id, offsetSec)
    return project?.info() ?? null
  })
  ipcMain.handle('match:setLook', async (_e, id: string, look: VideoLook | null) => {
    await lib().setLook(id, look)
    return project?.info() ?? null
  })
  ipcMain.handle('match:setCodeEdit', async (_e, id: string, line: number, from: string, patch: { to?: string; start?: string | null; end?: string | null }) => {
    await lib().setCodeEdit(id, line, from, patch)
    return project?.info() ?? null
  })
  ipcMain.handle('match:setInsert', async (_e, id: string, ins: ScoutInsert) => {
    await lib().setInsert(id, ins)
    return project?.info() ?? null
  })
  ipcMain.handle('match:clearScoutEdits', async (_e, id: string) => {
    await lib().clearScoutEdits(id)
    return project?.info() ?? null
  })
  // The corrected scout file, saved where the person picks (next to the original by default, named so it is
  // not mistaken for it). null: cancelled.
  ipcMain.handle('match:exportScout', async (_e, id: string, format: 'dvw' | 'vsm') => {
    mayExport()
    const m = lib().getMatch(id)
    if (!m) throw new Error(t('試合が見つかりません: {0}', id))
    const ext = format === 'vsm' ? 'vsm' : 'dvw'
    const stem = basename(m.dvwPath, extname(m.dvwPath))
    const r = await dialog.showSaveDialog(win!, { title: t('直したスカウトファイルを書き出す'), defaultPath: join(dirname(m.dvwPath), `${stem} ${t('修正済み')}.${ext}`),
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled || !r.filePath) return null
    if (r.filePath === m.dvwPath) throw new Error(t('元のスカウトファイルには上書きできません。別の名前にしてください'))
    const skipped = await lib().exportScout(id, r.filePath, format)
    return { path: r.filePath, skipped }
  })
  ipcMain.handle('match:setServeMark', (_e, id: string, fingerprint: string, patch: { hit?: number | null; touch?: number | null }) => lib().setServeMark(id, fingerprint, patch))

  ipcMain.handle('project:saveSettings', async (_e, s: ProjectSettings) => {
    const p = proj()
    await p.saveSettings(s)
    return p.info()
  })

  ipcMain.handle('export:choosePath', async (_e, name: string) => {
    mayExport()
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
    mayExport()
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
    mayExport()
    if (exporter.running) throw new Error(t('書き出し中です。終わるか、キャンセルしてからもう一度試してください'))
    void exporter.run(job, join(p.dir, 'export-work'), id => p.getMatch(id)?.videoPath, ev => {
      if (!e.sender.isDestroyed()) e.sender.send('export:event', ev)
    })
  })
  // A comparison to MP4: each side's source made playable, then one ffmpeg run in the background (export:event, export:cancel).
  // Where a comparison's MP4 goes: no project is open, so the save dialog starts where the last one was saved (first: Videos).
  ipcMain.handle('compare:choosePath', async (_e, name: string) => {
    mayExport()
    const safe = name.replace(/[\/:*?"<>|]/g, '_').trim() || 'compare'
    const dir = lastCompareDir && existsSync(lastCompareDir) ? lastCompareDir : app.getPath('videos')
    const r = await dialog.showSaveDialog(win!, { title: t('MP4 に書き出す'), defaultPath: join(dir, `${safe}.mp4`), filters: [{ name: 'MP4', extensions: ['mp4'] }] })
    if (r.canceled || !r.filePath) return null
    lastCompareDir = dirname(r.filePath)
    return r.filePath
  })
  ipcMain.handle('compare:export', async (e, job: CompareExportJob) => {
    mayExport()
    if (exporter.running) throw new Error(t('書き出し中です。終わるか、キャンセルしてからもう一度試してください'))
    const side = async (s: CompareExportSide): Promise<CompareRunSide> => {
      const file = await compareFile(s.source, p => e.sender.send('import:progress', p))
      const info = await probe(file)
      const look = s.source.kind === 'match' ? cleanLook(library?.getMatch(s.source.matchId)?.look) : null // as the comparison's preview shows it
      return { file, width: info.width, height: info.height, durationSec: info.durationSec, startSec: Math.max(0, s.startSec), view: s.view, ...(look ? { look } : {}) }
    }
    const left = await side(job.left), right = await side(job.right)
    const durationSec = runLength(job.durationSec, left, right)
    if (durationSec < 0.5) throw new Error(t('再生位置から先の長さが足りません。位置を戻してください'))
    void exporter.runCompare({ left, right, layout: job.layout, overlayAlpha: Math.min(1, Math.max(0, job.overlayAlpha)), durationSec, outPath: job.outPath }, ev => {
      if (!e.sender.isDestroyed()) e.sender.send('export:event', ev)
    })
  })
  ipcMain.handle('export:cancel', () => exporter.cancel())
  ipcMain.handle('project:notices', () => project?.takeNotices() ?? library?.notices.splice(0) ?? [])
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('account:get', () => ({ enabled: account.enabled, state: account.state() }))
  ipcMain.handle('account:sendCode', (_e, email: string) => withAccount(() => account.sendCode(email)))
  ipcMain.handle('account:signIn', (_e, email: string, code: string) => withAccount(() => account.signIn(email, code)))
  ipcMain.handle('account:refresh', (_e, teamId?: number) => withAccount(() => account.refresh(teamId)))
  ipcMain.handle('account:checkout', (_e, plan: 'monthly' | 'annual') => withAccount(async () => { await shell.openExternal(await account.checkoutUrl(plan === 'monthly' ? 'monthly' : 'annual')) }))
  ipcMain.handle('account:prices', () => account.prices())
  ipcMain.handle('account:web', () => withAccount(() => account.webAccess()))
  ipcMain.handle('account:openWeb', (_e, page: 'view' | 'admin') => shell.openExternal(page === 'admin' ? WEB_ADMIN_URL : `${WEB_URL}/`))
  ipcMain.handle('account:signOut', () => { account.forget(); return account.state() })
  ipcMain.handle('account:team', (_e, a: TeamAction) => withAccount(() => account.teamAction(a)))
  // The preload reads the language synchronously, so the interface's text is right from its first paint.
  ipcMain.on('app:lang', e => { e.returnValue = getLang() })
  ipcMain.handle('app:setLang', (_e, l: Lang) => { setLang(l); saveSettings({ lang: getLang() }) })
  // The renderer has saved: no flush on the way out, straight into the installer.
  ipcMain.handle('update:install', async () => { updating = await installUpdate() })
  // The manual ships with the app (electron-builder extraResources: site/), so it opens without the internet, in the
  // computer's browser. Japanese only for now; page: a chapter's file name (05-scene.html), else the index.
  ipcMain.handle('app:manual', (_e, page?: string) => {
    const site = app.isPackaged ? join(process.resourcesPath, 'site') : join(app.getAppPath(), 'site')
    const name = page && /^[0-9a-z-]+\.html$/.test(page) ? page : 'index.html'
    return shell.openExternal(pathToFileURL(join(site, 'manual', 'ja', name)).href)
  })
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
  ipcMain.handle('teamColor:list', () => library?.teamColors() ?? {})
  ipcMain.handle('teamColor:set', (_e, code: string, color: string | null) => lib().setTeamColor(code, color))
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
  ipcMain.handle('card:save', async (_e, name: string, ext: 'png' | 'pdf' | 'pptx', data: Uint8Array) => {
    mayExport()
    const file = `${name.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`, dir = await startFolder('docs')
    const r = await dialog.showSaveDialog(win!, { title: t('スライドを書き出す'), defaultPath: dir ? join(dir, file) : file, filters: [{ name: ext === 'pptx' ? 'PowerPoint' : ext.toUpperCase(), extensions: [ext] }] })
    if (r.canceled || !r.filePath) return null
    remembered('docs', dirname(r.filePath))
    await writeFile(r.filePath, data)
    return r.filePath
  })
  // The match report as an A4 PDF: its page drawn in a hidden window, printed, saved where the user says.
  ipcMain.handle('report:pdf', async (_e, html: string, name: string) => {
    mayExport()
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

// The project folders this computer knows: those in <library>/projects and the recent ones.
async function projectDirs(l: Library): Promise<string[]> {
  const root = join(l.dir, 'projects')
  const inRoot = existsSync(root) ? (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => join(root, d.name)) : []
  const seen = new Set<string>()
  return [...inRoot, ...recentProjects().map(r => r.path)].filter(d => { const k = d.toLowerCase(); return seen.has(k) ? false : (seen.add(k), true) })
}
// A project's project.json as saved, or null when there is none (or it can't be read).
async function projectFile(dir: string): Promise<{ name?: string; ourTeamCodes?: string[]; matchIds?: string[] } | null> {
  try { return JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) } catch { return null }
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

// The file <video> plays for a side of a comparison (a library match's, or a chosen file made playable).
async function compareFile(src: CompareSource, progress: (p: ImportProgress) => void): Promise<string> {
  if (src.kind === 'match') {
    const f = library?.getMatch(src.matchId)?.videoPath
    if (!f || !existsSync(f)) throw new Error(t('動画が見つかりません（試合 {0}）', src.matchId))
    return f
  }
  const f = await compares.open(src.path, progress)
  return compares.fileOf(f.token)!
}

async function serveMedia(req: Request): Promise<Response> {
  const id = new URL(req.url).hostname
  const file = compares?.fileOf(id) ?? library?.getMatch(id)?.videoPath
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
