import { spawnSync } from 'node:child_process'
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from 'electron'
import type { Reel } from '../shared/reel'
import type { ExportJob, ProjectSettings } from '../shared/types'
import { Exporter } from './export'
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

let project: Project | null = null
const exporter = new Exporter()
let win: BrowserWindow | null = null
const settingsFile = () => join(app.getPath('userData'), 'settings.json')

app.whenReady().then(async () => {
  protocol.handle('media', serveMedia)
  registerIpc()

  const last = process.env.VR_PROJECT || readSettings().lastProject
  if (last && existsSync(last)) project = await Project.open(last)

  win = new BrowserWindow({
    width: 1500, height: 900, backgroundColor: '#F1F5F9', title: 'volley-reel',
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  })
  win.setMenuBarVisibility(false)
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

  ipcMain.handle('project:choose', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'プロジェクトフォルダを選択', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    project = await Project.open(r.filePaths[0])
    await writeFile(settingsFile(), JSON.stringify({ ...readSettings(), lastProject: project.dir }, null, 2))
    return project.info()
  })

  ipcMain.handle('match:import', async e => {
    if (!project) throw new Error('先にプロジェクトフォルダを開いてください')
    const v = await dialog.showOpenDialog(win!, { title: '試合の動画を選択', properties: ['openFile'],
      filters: [{ name: '動画', extensions: ['mp4', 'MP4', 'mov', 'MOV', 'mts', 'MTS', 'm4v'] }] })
    if (v.canceled || !v.filePaths[0]) return null
    const d = await dialog.showOpenDialog(win!, { title: 'スカウトファイル（.dvw）を選択', properties: ['openFile'],
      filters: [{ name: 'DataVolley', extensions: ['dvw', 'DVW'] }] })
    if (d.canceled || !d.filePaths[0]) return null
    return project.importMatch(v.filePaths[0], d.filePaths[0], p => e.sender.send('import:progress', p))
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
    void exporter.run(job, join(p.dir, 'cache', 'export'), id => p.getMatch(id)?.videoPath, ev => {
      if (!e.sender.isDestroyed()) e.sender.send('export:event', ev)
    })
  })
  ipcMain.handle('export:cancel', () => exporter.cancel())
  ipcMain.handle('shell:showInFolder', (_e, p: string) => shell.showItemInFolder(p))

  ipcMain.handle('reel:list', () => project?.listReels() ?? [])
  ipcMain.handle('reel:save', (_e, r: Reel) => { if (!project) throw new Error('プロジェクトが開かれていません'); return project.saveReel(r) })
  ipcMain.handle('reel:delete', (_e, id: string) => project?.deleteReel(id))

  ipcMain.handle('match:parse', (_e, id: string) => {
    if (!project) throw new Error('プロジェクトが開かれていません')
    return project.parse(id)
  })
}

async function serveMedia(req: Request): Promise<Response> {
  const id = new URL(req.url).hostname
  const file = project?.getMatch(id)?.videoPath
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
  console.log(`[export-cancel] output left behind: ${existsSync(r.cancelPath)}, work dir left: ${existsSync(join(project!.dir, 'cache', 'export'))}`)
}

function readSettings(): { lastProject?: string } {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) } catch { return {} }
}

// Dev self-check: VR_PROJECT=<dir> VR_IMPORT="<video>|<dvw>[;...]" VR_SMOKE=<out.png>
// [VR_SMOKE_PLAY=<n>] [VR_SMOKE_SCOPE=match|all] [VR_SMOKE_FILTER=<PlayFilter JSON>] [VR_SMOKE_SETTINGS=1]
// [VR_SMOKE_KEYS=3,3,1: keys pressed after the jump] [VR_SMOKE_TRIM=1: loop and trim a clip]
// [VR_SMOKE_ANN=1: draw, move and time annotations through pointer events]
// [VR_SMOKE_OV=1|dialog: auto overlays, per-clip override, theme, title cards in through-play]
// [VR_SMOKE_EXPORT=<out.mp4>: export a 3-clip reel, probe it, grab frames, then cancel a second run] [VR_SMOKE_MINIMIZE=1]
// [VR_SMOKE_REEL=<{markers, groupOrder?, scope?, shotAt?} JSON>: build a reel from the results and play it through]
// imports matches if needed, applies the filter, jumps to the n-th result, and saves a screenshot.
async function smoke(w: BrowserWindow, outPng: string): Promise<void> {
  try {
    if (!project) throw new Error('VR_PROJECT is required for VR_SMOKE')
    // VR_IMPORT may list several matches: "<video>|<dvw>;<video>|<dvw>"
    for (const pair of (process.env.VR_IMPORT ?? '').split(';').filter(Boolean)) {
      const [video, dvw] = pair.split('|')
      if (video && dvw && !project.findBySources(video, dvw)) {
        await project.importMatch(video, dvw, p => console.log(`[import] ${p.message}${p.ratio != null ? ` ${(p.ratio * 100).toFixed(0)}%` : ''}`))
      }
    }
    const opts = { play: Number(process.env.VR_SMOKE_PLAY ?? 40), filter: process.env.VR_SMOKE_FILTER ? JSON.parse(process.env.VR_SMOKE_FILTER) : null, scope: process.env.VR_SMOKE_SCOPE ?? 'match', settings: !!process.env.VR_SMOKE_SETTINGS,
      reel: process.env.VR_SMOKE_REEL ? JSON.parse(process.env.VR_SMOKE_REEL) : undefined,
      keys: process.env.VR_SMOKE_KEYS ? process.env.VR_SMOKE_KEYS.split(',') : undefined,
      trim: !!process.env.VR_SMOKE_TRIM,
      ann: !!process.env.VR_SMOKE_ANN,
      ov: process.env.VR_SMOKE_OV,
      exportTo: process.env.VR_SMOKE_EXPORT }
    const result = await w.webContents.executeJavaScript(`window.__smoke(${JSON.stringify(opts)})`)
    await new Promise(r => setTimeout(r, 400))
    await writeFile(outPng, (await w.webContents.capturePage()).toPNG())
    console.log(`[smoke] ${JSON.stringify(result)}`)
    if (result?.export) checkExport(result)
  } catch (e) {
    console.error(`[smoke] failed: ${(e as Error).message}`)
    process.exitCode = 1
  }
  app.quit()
}
