import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from 'electron'
import type { Reel } from '../shared/reel'
import type { Video } from '../shared/video'
import type { ExportJob, PickedAsset, ProjectInit, ProjectSettings, RecentProject } from '../shared/types'
import { Exporter } from './export'
import { Library } from './library'
import { Project } from './project'

// media://<matchId>/ streams that match's video with Range support, so <video> can seek.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

// Chromium pauses muted, video-only media when the window is hidden or covered (and Windows
// occlusion tracking counts a window behind another app as hidden). This is an editor: a
// through-play must keep going while the user looks at another window.
app.commandLine.appendSwitch('disable-background-media-suspend')
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

let library: Library | null = null
let project: Project | null = null
const exporter = new Exporter()
let win: BrowserWindow | null = null
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

app.whenReady().then(async () => {
  protocol.handle('media', serveMedia)
  registerIpc()

  const libPath = process.env.VR_LIBRARY || (process.env.VR_PROJECT ? join(dirname(process.env.VR_PROJECT), 'vr-smoke-library') : readSettings().libraryPath)
  if (libPath) library = await Library.open(libPath)
  const last = process.env.VR_PROJECT
  if (process.env.VR_SMOKE && process.env.VR_SMOKE_CORRUPT && last) corruptFirstReel(last)
  if (process.env.VR_SMOKE) {
    ipcMain.handle('smoke:scan', (_e, folders: string[]) => library!.scan(folders))
    ipcMain.handle('smoke:pickAsset', (_e, path: string) => takeAsset(path))
    ipcMain.handle('smoke:createProject', async (_e, dir: string, init: ProjectInit) => {
      await mkdir(dir, { recursive: true })
      project = await Project.create(dir, library!, init)
      return project.info()
    })
    // Smoke only: add a point after the first point line and delete one play line in a DVW copy.
    ipcMain.handle('smoke:editDvw', async (_e, matchId: string, code: string, time: number) => {
      const m = library?.getMatch(matchId)
      if (!m) throw new Error('no match')
      const lines = readFileSync(m.dvwPath, 'latin1').split(/\r?\n/)
      const at = lines.findIndex(l => /^[*a]p\d+:\d+/i.test(l))
      lines.splice(at + 1, 0, lines[at].replace(/^[*a]p(\d+):(\d+)/i, (_s, h, a) => `*p${String(+h + 1).padStart(2, '0')}:${a}`))
      const del = lines.findIndex(l => l.startsWith(code + ';') && l.split(';')[12] === String(time))
      lines.splice(del, 1)
      await writeFile(m.dvwPath, lines.join('\r\n'), 'latin1')
      return `added a point after line ${at + 1}, deleted line ${del + 1} (${code} @ ${time})`
    })
  }
  if (last && library && existsSync(join(last, 'project.json'))) project = await Project.open(last, library)
  else if (last && library && process.env.VR_SMOKE) { await mkdir(last, { recursive: true }); project = await Project.create(last, library, { name: 'smoke', ourTeamCodes: ['HTH', 'HTA'], matchIds: [] }) }

  win = new BrowserWindow({
    width: 1500, height: 900, backgroundColor: '#F1F5F9', title: 'volley-reel',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })
  win.setMenuBarVisibility(false)
  // Closing: let the renderer write pending reel saves first (autosave runs on a short delay),
  // with a timeout so a stuck renderer can't keep the window open. A running export is cancelled.
  let flushed = false
  win.on('close', e => {
    if (flushed || !win || win.webContents.isDestroyed()) return
    e.preventDefault()
    exporter.cancel()
    const done = () => { if (flushed) return; flushed = true; clearTimeout(timer); win?.close() }
    const timer = setTimeout(done, 3000)
    ipcMain.once('app:flushed', done)
    win.webContents.send('app:flush')
  })
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await win.loadFile(join(__dirname, '../renderer/index.html'))

  if (process.env.VR_SMOKE) {
    win.webContents.on('console-message', e => console.log(`[renderer] ${e.message}`))
    if (process.env.VR_SMOKE_MINIMIZE) win.minimize() // reproduces the hidden-window media pause
    await smoke(win, process.env.VR_SMOKE)
  }
})

app.on('window-all-closed', () => app.quit())

function registerIpc(): void {
  ipcMain.handle('project:get', () => project?.info() ?? null)
  ipcMain.handle('library:get', () => library?.info() ?? null)

  ipcMain.handle('library:choose', async () => {
    const r = await dialog.showOpenDialog(win!, { title: '倉庫にするフォルダを選択（空のフォルダか、既存の倉庫）', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    library = await Library.open(r.filePaths[0])
    project = null
    saveSettings({ libraryPath: library.dir })
    return library.info()
  })

  ipcMain.handle('library:scan', async () => {
    if (!library) throw new Error('先に倉庫を選んでください')
    const r = await dialog.showOpenDialog(win!, { title: '動画と DVW があるフォルダを選択（複数可）', properties: ['openDirectory', 'multiSelections'] })
    if (r.canceled || !r.filePaths.length) return null
    return library.scan(r.filePaths)
  })

  ipcMain.handle('library:importPairs', async (e, pairs: { dvwPath: string; video: string }[]) => {
    if (!library) throw new Error('先に倉庫を選んでください')
    return importPairs(library, pairs, p => e.sender.send('import:progress', p))
  })

  ipcMain.handle('project:recent', () => recentProjects())

  ipcMain.handle('project:create', async (_e, init: ProjectInit) => {
    if (!library) throw new Error('先に倉庫を選んでください')
    const r = await dialog.showOpenDialog(win!, { title: 'プロジェクトを作るフォルダを選択（空のフォルダ）', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    project = await Project.create(r.filePaths[0], library, init)
    rememberProject(project)
    return project.info()
  })

  ipcMain.handle('project:open', async (_e, path?: string) => {
    if (!library) throw new Error('先に倉庫を選んでください')
    let dir = path
    if (!dir) {
      const r = await dialog.showOpenDialog(win!, { title: 'プロジェクトのフォルダを選択', properties: ['openDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    }
    project = await Project.open(dir, library)
    rememberProject(project)
    return project.info()
  })

  ipcMain.handle('project:close', () => { project = null })

  ipcMain.handle('project:setMatches', async (_e, ids: string[]) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    await project.setMatches(ids)
    return project.info()
  })

  ipcMain.handle('match:import', async e => {
    if (!library) throw new Error('先に倉庫を選んでください')
    const v = await dialog.showOpenDialog(win!, { title: '試合の動画を選択', properties: ['openFile'],
      filters: [{ name: '動画', extensions: ['mp4', 'MP4', 'mov', 'MOV', 'mts', 'MTS', 'm4v'] }] })
    if (v.canceled || !v.filePaths[0]) return null
    const d = await dialog.showOpenDialog(win!, { title: 'スカウトファイル（.dvw）を選択', properties: ['openFile'],
      filters: [{ name: 'DataVolley', extensions: ['dvw', 'DVW'] }] })
    if (d.canceled || !d.filePaths[0]) return null
    return library.importMatch(v.filePaths[0], d.filePaths[0], p => e.sender.send('import:progress', p))
  })

  ipcMain.handle('project:saveSettings', async (_e, s: ProjectSettings) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    await project.saveSettings(s)
    return project.info()
  })

  ipcMain.handle('export:choosePath', async (_e, name: string) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    const dir = join(project.dir, 'exports')
    await mkdir(dir, { recursive: true })
    const safe = name.replace(/[\/:*?"<>|]/g, '_').trim() || 'reel'
    const r = await dialog.showSaveDialog(win!, { title: 'MP4 に書き出す', defaultPath: join(dir, `${safe}.mp4`), filters: [{ name: 'MP4', extensions: ['mp4'] }] })
    return r.canceled || !r.filePath ? null : r.filePath
  })

  // Starts in the background and returns at once; progress and the result arrive as export:event.
  ipcMain.handle('export:start', (e, job: ExportJob) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    if (exporter.running) throw new Error('書き出し中です。終わるか、キャンセルしてからもう一度試してください')
    const p = project
    void exporter.run(job, join(p.dir, 'export-work'), id => p.getMatch(id)?.videoPath, ev => {
      if (!e.sender.isDestroyed()) e.sender.send('export:event', ev)
    })
  })
  ipcMain.handle('export:cancel', () => exporter.cancel())
  ipcMain.handle('project:notices', () => project?.takeNotices() ?? library?.notices.splice(0) ?? [])
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.handle('asset:pick', async () => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    const r = await dialog.showOpenDialog(win!, {
      title: '画像・PDF を挿入', properties: ['openFile'],
      filters: [{ name: '画像・PDF', extensions: [...IMAGE_EXT, 'pdf'] }],
    })
    return r.canceled || !r.filePaths[0] ? null : takeAsset(r.filePaths[0])
  })
  ipcMain.handle('asset:save', (_e, png: Uint8Array) => saveAsset(png, 'png'))
  ipcMain.handle('asset:read', (_e, id: string) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    if (!ASSET_ID.test(id)) throw new Error('bad asset id')
    return readFile(join(project.dir, 'assets', id))
  })

  ipcMain.handle('video:list', () => project?.listVideos() ?? [])
  ipcMain.handle('video:save', (_e, v: Video) => { if (!project) throw new Error('プロジェクトが開かれていません'); return project.saveVideo(v) })
  ipcMain.handle('video:delete', (_e, id: string) => project?.deleteVideo(id))
  ipcMain.handle('reel:list', () => project?.listReels() ?? [])
  ipcMain.handle('reel:save', (_e, r: Reel) => { if (!project) throw new Error('プロジェクトが開かれていません'); return project.saveReel(r) })
  ipcMain.handle('reel:delete', (_e, id: string) => project?.deleteReel(id))

  ipcMain.handle('match:parse', (_e, id: string) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    return project.parse(id)
  })
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
const ASSET_ID = /^[0-9a-f-]{36}\.(png|jpg|webp|gif|bmp)$/

async function takeAsset(path: string): Promise<PickedAsset> {
  const ext = extname(path).slice(1).toLowerCase()
  const data = await readFile(path)
  if (ext === 'pdf') return { kind: 'pdf', data: new Uint8Array(data), name: basename(path) }
  if (!IMAGE_EXT.includes(ext)) throw new Error('画像（PNG・JPEG など）か PDF を選んでください')
  return { kind: 'image', assetId: await saveAsset(data, ext === 'jpeg' ? 'jpg' : ext) }
}

// A copy in the project, so the project keeps working if the original file moves.
async function saveAsset(data: Uint8Array, ext: string): Promise<string> {
  if (!project) throw new Error('プロジェクトが開かれていません')
  const dir = join(project.dir, 'assets')
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

// Smoke only: probe the exported MP4, save frames at the check times, and confirm the cancelled
// run left neither its output nor the work folder behind.
function checkExport(r: { export: string; checks: { name: string; t: number }[]; cancelPath: string }): void {
  const bin = process.env.FFMPEG_DIR || join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin')
  const probe = spawnSync(join(bin, 'ffprobe.exe'), ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_packets:format=duration,size', '-of', 'json', r.export], { encoding: 'utf8' })
  console.log(`[export-probe] ${probe.stdout.replace(/\s+/g, ' ')}`)
  for (const c of r.checks) {
    const out = r.export.replace(/\.mp4$/, `-${c.name}.png`)
    spawnSync(join(bin, 'ffmpeg.exe'), ['-v', 'error', '-y', '-ss', c.t.toFixed(3), '-i', r.export, '-frames:v', '1', out])
    console.log(`[export-frame] ${c.name} t=${c.t.toFixed(2)} -> ${existsSync(out) ? out : 'missing'}`)
  }
  console.log(`[export-cancel] output left behind: ${existsSync(r.cancelPath)}, work dir left: ${existsSync(join(project!.dir, 'export-work'))}`)
}

// Smoke only: probe an exported MP4 and save frames at the given times next to it.
function grabFrames(file: string, checks: { name: string; t: number }[]): void {
  const bin = process.env.FFMPEG_DIR || join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin')
  const probe = spawnSync(join(bin, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', file], { encoding: 'utf8' })
  console.log(`[export-probe] ${probe.stdout.replace(/\s+/g, ' ')}`)
  for (const c of checks) {
    const out = file.replace(/\.mp4$/, `-${c.name}.png`)
    spawnSync(join(bin, 'ffmpeg.exe'), ['-v', 'error', '-y', '-ss', c.t.toFixed(3), '-i', file, '-frames:v', '1', out])
    console.log(`[export-frame] ${c.name} t=${c.t.toFixed(2)} -> ${existsSync(out) ? out : 'missing'}`)
  }
}

function corruptFirstReel(dir: string): void {
  const reels = join(dir, 'reels')
  const f = existsSync(reels) ? readdirSync(reels).find(x => x.endsWith('.json')) : undefined
  if (!f) return
  writeFileSync(join(reels, f), '{ this is not json')
  console.log(`[smoke] corrupted ${f}`)
}

interface AppSettings { libraryPath?: string; recentProjects?: RecentProject[] }

function readSettings(): AppSettings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) } catch { return {} }
}

function saveSettings(patch: Partial<AppSettings>): void {
  if (process.env.VR_SMOKE) return // smoke runs never touch the user's settings
  writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2))
}

function recentProjects(): RecentProject[] {
  return (readSettings().recentProjects ?? []).filter(p => existsSync(join(p.path, 'project.json')))
}

function rememberProject(p: Project): void {
  const rest = recentProjects().filter(r => r.path.toLowerCase() !== p.dir.toLowerCase())
  saveSettings({ recentProjects: [{ path: p.dir, name: p.name, openedAt: new Date().toISOString() }, ...rest].slice(0, 12) })
}

// Bulk import, step 2: one match at a time (probing is quick; preparing a copy can take minutes).
async function importPairs(lib: Library, pairs: { dvwPath: string; video: string }[], progress: (p: import('../shared/types').ImportProgress) => void) {
  const imported: import('../shared/types').Match[] = [], failed: { dvwPath: string; message: string }[] = []
  for (const [i, p] of pairs.entries()) {
    try {
      imported.push(await lib.importMatch(p.video, p.dvwPath, ev => progress({ ...ev, item: i, items: pairs.length, message: `${i + 1} / ${pairs.length}: ${ev.message}` })))
    } catch (e) {
      failed.push({ dvwPath: p.dvwPath, message: (e as Error).message })
    }
  }
  return { imported, failed }
}

// Dev self-check: VR_PROJECT=<dir> VR_IMPORT="<video>|<dvw>[;...]" VR_SMOKE=<out.png>
// [VR_SMOKE_PLAY=<n>] [VR_SMOKE_SCOPE=match|all] [VR_SMOKE_FILTER=<PlayFilter JSON>] [VR_SMOKE_SETTINGS=1]
// [VR_SMOKE_KEYS=3,3,1: keys pressed after the jump] [VR_SMOKE_TRIM=1: loop and trim a clip]
// [VR_SMOKE_ANN=1: draw, move and time annotations through pointer events]
// [VR_SMOKE_OV=1|dialog: auto overlays, per-clip override, theme, title cards in through-play]
// [VR_SMOKE_EXPORT=<out.mp4>: export a 3-clip reel, probe it, grab frames, then cancel a second run]
// [VR_SMOKE_VIDEO=1 [VR_SMOKE_EXPORT=<out.mp4>]: videos of shared scenes, cards, undo, export]
// [VR_SMOKE_OBJ=1 [VR_SMOKE_EXPORT=<out.mp4>] [VR_SMOKE_ASSETS=<a.png;b.pdf>]: object handles, polygon
//  and triangle drawing, edit points, format panel, inserted pictures, export]
// [VR_SMOKE_HOME=<step>: library and project flow from the home screen; VR_LIBRARY=<dir>]
// [VR_SMOKE_M8=relink|flush-write|report|undo] [VR_SMOKE_CORRUPT=1: break the first reel file before loading] [VR_SMOKE_MINIMIZE=1]
// [VR_SMOKE_REEL=<{markers, groupOrder?, scope?, shotAt?} JSON>: build a reel from the results and play it through]
// imports matches if needed, applies the filter, jumps to the n-th result, and saves a screenshot.
async function smoke(w: BrowserWindow, outPng: string): Promise<void> {
  try {
    if (!project && !process.env.VR_SMOKE_HOME) throw new Error('VR_PROJECT is required for VR_SMOKE')
    // VR_IMPORT may list several matches: "<video>|<dvw>;<video>|<dvw>" — into the library, then the project.
    for (const pair of (process.env.VR_IMPORT ?? '').split(';').filter(Boolean)) {
      const [video, dvw] = pair.split('|')
      if (!video || !dvw || !library || !project) continue
      const m = await library.importMatch(video, dvw, p => console.log(`[import] ${p.message}${p.ratio != null ? ` ${(p.ratio * 100).toFixed(0)}%` : ''}`))
      if (!project.info().matchIds.includes(m.id)) await project.setMatches([...project.info().matchIds, m.id])
    }
    const opts = { play: Number(process.env.VR_SMOKE_PLAY ?? 40), filter: process.env.VR_SMOKE_FILTER ? JSON.parse(process.env.VR_SMOKE_FILTER) : null, scope: process.env.VR_SMOKE_SCOPE ?? 'match', settings: !!process.env.VR_SMOKE_SETTINGS,
      reel: process.env.VR_SMOKE_REEL ? JSON.parse(process.env.VR_SMOKE_REEL) : undefined,
      keys: process.env.VR_SMOKE_KEYS ? process.env.VR_SMOKE_KEYS.split(',') : undefined,
      trim: !!process.env.VR_SMOKE_TRIM,
      ann: !!process.env.VR_SMOKE_ANN,
      ov: process.env.VR_SMOKE_OV,
      exportTo: process.env.VR_SMOKE_VIDEO || process.env.VR_SMOKE_OBJ ? undefined : process.env.VR_SMOKE_EXPORT,
      videoExportTo: process.env.VR_SMOKE_VIDEO || process.env.VR_SMOKE_OBJ ? process.env.VR_SMOKE_EXPORT : undefined,
      m8: process.env.VR_SMOKE_M8,
      home: process.env.VR_SMOKE_HOME,
      video: !!process.env.VR_SMOKE_VIDEO,
      obj: !!process.env.VR_SMOKE_OBJ,
      assets: process.env.VR_SMOKE_ASSETS?.split(';'),
      folders: process.env.VR_SMOKE_FOLDERS?.split(';'),
      newProject: process.env.VR_SMOKE_NEWPROJ }
    const result = await w.webContents.executeJavaScript(`window.__smoke(${JSON.stringify(opts)})`)
    await new Promise(r => setTimeout(r, 400))
    await writeFile(outPng, (await w.webContents.capturePage()).toPNG())
    console.log(`[smoke] ${JSON.stringify(result)}`)
    if (result?.export) checkExport(result)
    if (result?.videoExport && result.exported) grabFrames(result.videoExport, result.exported.checks)
  } catch (e) {
    console.error(`[smoke] failed: ${(e as Error).message}`)
    process.exitCode = 1
  }
  app.quit()
}
