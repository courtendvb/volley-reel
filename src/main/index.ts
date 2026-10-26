import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { folderName, uniqueName } from '../shared/folderName'
import { Readable } from 'node:stream'
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from 'electron'
import type { Annotation } from '../shared/annotation'
import type { Reel } from '../shared/reel'
import type { Video } from '../shared/video'
import type { ExportJob, PickedAsset, ProjectInit, ProjectSettings, RecentProject, SlideFile } from '../shared/types'
import { Exporter } from './export'
import { Library } from './library'
import { Project } from './project'
import { ffmpegDir } from './ffmpegPath'
import { grabFrame } from './media'

// media://<matchId>/ streams that match's video with Range support, so <video> can seek.
protocol.registerSchemesAsPrivileged([
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
])

// Chromium pauses muted, video-only media when the window is hidden or covered (and Windows
// occlusion tracking counts a window behind another app as hidden). This is an editor: a
// through-play must keep going while the user looks at another window.
app.commandLine.appendSwitch('disable-background-media-suspend')
// The memory smoke check forces a GC before each heap sample.
if (process.env.VR_SMOKE_MEM) app.commandLine.appendSwitch('js-flags', '--expose-gc')
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
    // Copies, so the slide check can change "its" file without touching the given ones.
    ipcMain.handle('smoke:pickSlides', async (_e, paths: string[]) => {
      const dir = join(project!.dir, 'smoke-slides')
      await mkdir(dir, { recursive: true })
      return Promise.all(paths.map(async p => { const to = join(dir, basename(p)); await writeFile(to, await readFile(p)); return takeSlideFile(to) }))
    })
    ipcMain.handle('smoke:touch', async (_e, path: string) => {
      if (!resolve(path).startsWith(resolve(project!.dir) + sep)) throw new Error('outside the project')
      const now = new Date()
      await utimes(path, now, now)
    })
    ipcMain.handle('smoke:relocate', async (_e, id: string, part: 'video' | 'dvw', path: string) => {
      const note = await library!.relocate(id, part, path, () => {})
      return { library: library!.info(), project: project?.info() ?? null, note }
    })
    ipcMain.handle('smoke:setLogo', async (_e, code: string, path: string) => { await library!.setLogo(code, path); return library!.logos() })
    ipcMain.handle('smoke:createProject', async (_e, dir: string, init: ProjectInit) => {
      await mkdir(dir, { recursive: true })
      project = await Project.create(dir, library!, init)
      return project.info()
    })
    // Smoke only: add a point after the first point line and delete one play line in a DVW copy.
    ipcMain.handle('smoke:editDvw', async (_e, matchId: string, code: string, time: number) => {
      const m = library?.getMatch(matchId)
      if (!m) throw new Error('no match')
      // Only ever a copy in the temp folder: a smoke run must not change a real scout file.
      const tmp = resolve(tmpdir()) + sep
      if (!resolve(m.dvwPath).toLowerCase().startsWith(tmp.toLowerCase())) throw new Error(`smoke:editDvw edits DVW copies in ${tmp} only (got ${m.dvwPath})`)
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
  // ?smoke makes the renderer load its self-check code (smoke.ts); a normal start never does.
  const query = process.env.VR_SMOKE ? '?smoke' : ''
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL + query)
  else await win.loadFile(join(__dirname, '../renderer/index.html'), query ? { search: 'smoke' } : {})

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
    const name = init.name.trim() || `${init.ourTeamCodes[0] ?? ''} プロジェクト`.trim()
    let dir: string
    if (init.chooseFolder) {
      const r = await dialog.showOpenDialog(win!, { title: 'プロジェクトを作るフォルダを選択（空のフォルダ）', properties: ['openDirectory', 'createDirectory'] })
      if (r.canceled || !r.filePaths[0]) return null
      dir = r.filePaths[0]
    } else {
      // No folder to pick: a new one named after the project, next to the library's matches.
      const root = join(library.dir, 'projects')
      dir = join(root, uniqueName(folderName(name), n => existsSync(join(root, n))))
      await mkdir(dir, { recursive: true })
    }
    project = await Project.create(dir, library, { ...init, name })
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

  ipcMain.handle('match:relocate', async (e, id: string, part: 'video' | 'dvw') => {
    if (!library) throw new Error('先に倉庫を選んでください')
    const m = library.getMatch(id)
    if (!m) throw new Error(`試合が見つかりません: ${id}`)
    const r = await dialog.showOpenDialog(win!, part === 'video'
      ? { title: `${m.name} の動画を選択（元: ${basename(m.sourceVideoPath)}）`, properties: ['openFile'], filters: [{ name: '動画', extensions: ['mp4', 'MP4', 'mov', 'MOV', 'mts', 'MTS', 'm4v'] }] }
      : { title: `${m.name} の DVW を選択（元: ${basename(m.dvwPath)}）`, properties: ['openFile'], filters: [{ name: 'DataVolley', extensions: ['dvw', 'DVW'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const note = await library.relocate(id, part, r.filePaths[0], p => e.sender.send('import:progress', p))
    return { library: library.info(), project: project?.info() ?? null, note }
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

  const lib = () => { if (!library) throw new Error('先に倉庫を選んでください'); return library }
  const assetsDir = () => { if (!project) throw new Error('プロジェクトが開かれていません'); return join(project.dir, 'assets') }
  ipcMain.handle('palette:get', () => library?.palette() ?? { colors: [], items: [] })
  ipcMain.handle('palette:setColors', (_e, colors: string[]) => lib().setPaletteColors(colors))
  ipcMain.handle('palette:save', (_e, name: string, anns: Annotation[]) => lib().savePaletteItem(name, anns, assetsDir()))
  ipcMain.handle('palette:remove', (_e, id: string) => lib().removePaletteItem(id))
  ipcMain.handle('palette:use', (_e, id: string) => lib().usePaletteItem(id, assetsDir()))
  ipcMain.handle('logo:list', () => library?.logos() ?? {})
  ipcMain.handle('logo:pick', async (_e, code: string) => {
    if (!library) throw new Error('先に倉庫を選んでください')
    const r = await dialog.showOpenDialog(win!, {
      title: `${code} のロゴを選ぶ`, properties: ['openFile'],
      filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (!r.canceled && r.filePaths[0]) await library.setLogo(code, r.filePaths[0])
    return library.logos()
  })
  ipcMain.handle('logo:remove', async (_e, code: string) => { await library?.removeLogo(code); return library?.logos() ?? {} })
  ipcMain.handle('logo:read', (_e, code: string) => library?.readLogo(code) ?? null)

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

  ipcMain.handle('slide:pick', async () => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    const r = await dialog.showOpenDialog(win!, {
      title: 'スライドを読み込む（PDF・画像。複数選べます）', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF・画像', extensions: ['pdf', ...IMAGE_EXT] }],
    })
    // Pictures in name order, numbers by value (スライド2 before スライド10), as exported from PowerPoint.
    const paths = r.canceled ? [] : [...r.filePaths].sort((a, b) => basename(a).localeCompare(basename(b), 'ja', { numeric: true }))
    return Promise.all(paths.map(takeSlideFile))
  })
  // Only files slides already came from are read again (the renderer can't name any other file).
  ipcMain.handle('slide:read', async (_e, path: string) => {
    if (!(await slideSources()).has(path)) throw new Error('スライドの元のファイルではありません')
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
    if (!file || !existsSync(file)) throw new Error('動画が見つかりません')
    const dir = assetsDir()
    await mkdir(dir, { recursive: true })
    const id = `${randomUUID()}.png`
    await grabFrame(file, sec, join(dir, id))
    return id
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
  if (ext !== 'pdf' && !IMAGE_EXT.includes(ext)) throw new Error('PDF か画像（PNG・JPEG など）を選んでください')
  const [data, st] = await Promise.all([readFile(path), stat(path)])
  const base = { path, name: basename(path), mtimeMs: st.mtimeMs }
  if (ext === 'pdf') return { ...base, kind: 'pdf', data: new Uint8Array(data) }
  return { ...base, kind: 'image', assetId: await saveAsset(data, ext === 'jpeg' ? 'jpg' : ext) }
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
  const bin = ffmpegDir()
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
  const bin = ffmpegDir()
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
// [VR_SMOKE_SLIDES=1 [VR_SMOKE_EXPORT=<out.mp4>] [VR_SMOKE_ASSETS=<a.pdf;b.png>]: the ＋ menu, objects on a slide,
//  PDF pages and pictures, a frame, drag, through-play, a changed file read again, export]
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
      exportTo: process.env.VR_SMOKE_VIDEO || process.env.VR_SMOKE_OBJ || process.env.VR_SMOKE_SLIDES ? undefined : process.env.VR_SMOKE_EXPORT,
      videoExportTo: process.env.VR_SMOKE_VIDEO || process.env.VR_SMOKE_OBJ || process.env.VR_SMOKE_SLIDES ? process.env.VR_SMOKE_EXPORT : undefined,
      m8: process.env.VR_SMOKE_M8,
      home: process.env.VR_SMOKE_HOME,
      video: !!process.env.VR_SMOKE_VIDEO,
      obj: !!process.env.VR_SMOKE_OBJ,
      copy: !!process.env.VR_SMOKE_COPY,
      slides: !!process.env.VR_SMOKE_SLIDES,
      mem: process.env.VR_SMOKE_MEM ? Number(process.env.VR_SMOKE_MEM) : undefined,
      assets: process.env.VR_SMOKE_ASSETS?.split(';'),
      logo: process.env.VR_SMOKE_LOGO,
      listRun: !!process.env.VR_SMOKE_LISTRUN,
      folders: process.env.VR_SMOKE_FOLDERS?.split(';'),
      newProject: process.env.VR_SMOKE_NEWPROJ }
    // With VR_SMOKE_MEM: each second, the renderer's and the GPU process's memory and CPU (the
    // last samples cover the playback window the renderer measures).
    const procSamples: { renderer: number; gpu: number; main: number; rendererCpu: number; gpuCpu: number }[] = []
    const pid = w.webContents.getOSProcessId()
    const sampler = process.env.VR_SMOKE_MEM ? setInterval(() => {
      const ms = app.getAppMetrics()
      const r = ms.find(m => m.pid === pid), g = ms.find(m => m.type === 'GPU')
      const b = ms.find(m => m.type === 'Browser')
      procSamples.push({ renderer: r?.memory.workingSetSize ?? 0, gpu: g?.memory.workingSetSize ?? 0, main: b?.memory.workingSetSize ?? 0, rendererCpu: r?.cpu.cumulativeCPUUsage ?? 0, gpuCpu: g?.cpu.cumulativeCPUUsage ?? 0 })
    }, 1000) : null
    const result = await w.webContents.executeJavaScript(`(async () => { while (!window.__smoke) await new Promise(r => setTimeout(r, 50)); return window.__smoke(${JSON.stringify(opts)}) })()`)
    if (sampler) {
      clearInterval(sampler)
      const last = procSamples.slice(-Number(process.env.VR_SMOKE_MEM))
      const mb = (kb: number) => +(kb / 1024).toFixed(1)
      console.log(`[mem] ${JSON.stringify({
        rendererMB: { first: mb(last[0]?.renderer ?? 0), last: mb(last[last.length - 1]?.renderer ?? 0), max: mb(Math.max(...last.map(x => x.renderer))) },
        gpuMB: { first: mb(last[0]?.gpu ?? 0), last: mb(last[last.length - 1]?.gpu ?? 0), max: mb(Math.max(...last.map(x => x.gpu))) },
        mainMB: { first: mb(last[0]?.main ?? 0), last: mb(last[last.length - 1]?.main ?? 0) },
        // CPU seconds used per second of the window (1.0 = one core busy).
        cpuCores: { renderer: +((last[last.length - 1].rendererCpu - last[0].rendererCpu) / Math.max(1, last.length - 1)).toFixed(3), gpu: +((last[last.length - 1].gpuCpu - last[0].gpuCpu) / Math.max(1, last.length - 1)).toFixed(3) },
      })}`)
    }
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
