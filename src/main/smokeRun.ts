// Dev self-check (VR_SMOKE) in the main process: the extra handlers a run drives the app with, and the
// run itself (smoke.ts in the renderer does the steps). Loaded by index.ts; a normal start never runs it.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { BrowserWindow, ClipboardItem, app, clipboard, ipcMain, nativeImage } from 'electron'
import type { PhotoTarget } from '../shared/pack'
import type { PickedAsset, ProjectInit, SlideFile } from '../shared/types'
import { ffmpegBin, ffprobeBin } from './ffmpegPath'
import type { Library } from './library'
import { Project } from './project'

export interface SmokeContext {
  library: () => Library | null
  project: () => Project | null
  setProject: (p: Project) => void
  win: () => BrowserWindow | null
  takeAsset: (path: string) => Promise<PickedAsset>
  takeSlideFile: (path: string) => Promise<SlideFile>
}

export function registerSmokeIpc(c: SmokeContext): void {
  ipcMain.handle('smoke:scan', (_e, folders: string[]) => c.library()!.scan(folders))
  ipcMain.handle('smoke:pickAsset', (_e, path: string) => c.takeAsset(path))
  // Copies, so the slide check can change "its" file without touching the given ones.
  ipcMain.handle('smoke:pickSlides', async (_e, paths: string[]) => {
    const dir = join(c.project()!.dir, 'smoke-slides')
    await mkdir(dir, { recursive: true })
    return Promise.all(paths.map(async p => { const to = join(dir, basename(p)); await writeFile(to, await readFile(p)); return c.takeSlideFile(to) }))
  })
  ipcMain.handle('smoke:touch', async (_e, path: string) => {
    if (!resolve(path).startsWith(resolve(c.project()!.dir) + sep)) throw new Error('outside the project')
    const now = new Date()
    await utimes(path, now, now)
  })
  ipcMain.handle('smoke:relocate', async (_e, id: string, part: 'video' | 'dvw', path: string) => {
    const note = await c.library()!.relocate(id, part, path, () => {})
    return { library: c.library()!.info(), project: c.project()?.info() ?? null, note }
  })
  ipcMain.handle('smoke:setPhoto', async (_e, tg: PhotoTarget, path: string) => { await c.library()!.setPlayerPhoto(tg, path); return c.library()!.packs() })
  ipcMain.handle('smoke:importPack', async (_e, path: string) => { await c.library()!.importPack(path); return c.library()!.packs() })
  ipcMain.handle('smoke:setLogo', async (_e, code: string, path: string) => { await c.library()!.setLogo(code, path); return c.library()!.logos() })
  // A screenshot of the window in the middle of a run (the run's own one is taken at its end).
  ipcMain.handle('smoke:drag', async (_e, pts: [number, number][]) => {
    const wc = c.win()!.webContents, at = (p: [number, number]) => ({ x: Math.round(p[0]), y: Math.round(p[1]) })
    wc.sendInputEvent({ type: 'mouseMove', ...at(pts[0]) })
    wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...at(pts[0]) })
    for (const p of pts.slice(1)) { await new Promise(r => setTimeout(r, 40)); wc.sendInputEvent({ type: 'mouseMove', button: 'left', modifiers: ['leftbuttondown'], ...at(p) }) }
    await new Promise(r => setTimeout(r, 40))
    wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...at(pts[pts.length - 1]) })
  })
  ipcMain.handle('smoke:rightClick', async (_e, x: number, y: number) => {
    const wc = c.win()!.webContents, at = { x: Math.round(x), y: Math.round(y) }
    wc.sendInputEvent({ type: 'mouseMove', ...at })
    wc.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...at })
    await new Promise(r => setTimeout(r, 40))
    wc.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...at })
  })
  ipcMain.handle('smoke:key', async (_e, key: string) => { const wc = c.win()!.webContents; wc.sendInputEvent({ type: 'keyDown', keyCode: key }); wc.sendInputEvent({ type: 'keyUp', keyCode: key }) })
  ipcMain.handle('smoke:shot', async (_e, name: string) => { await writeFile(join(dirname(process.env.VR_SMOKE!), basename(name)), (await c.win()!.webContents.capturePage()).toPNG()) }) // next to the run's own screenshot
  // An image file put on the system clipboard as a picture, as a screenshot leaves it.
  ipcMain.handle('smoke:clipboardImage', async (_e, path: string) => {
    const png = nativeImage.createFromPath(resolve(path)).toPNG()
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])
  })
  ipcMain.handle('smoke:createProject', async (_e, dir: string, init: ProjectInit) => {
    await mkdir(dir, { recursive: true })
    c.setProject(await Project.create(dir, c.library()!, init))
    return c.project()!.info()
  })
  // Smoke only: add a point after the first point line and delete one play line in a DVW copy.
  ipcMain.handle('smoke:editDvw', async (_e, matchId: string, code: string, time: number) => {
    const m = c.library()?.getMatch(matchId)
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

// Smoke only: probe the exported MP4, save frames at the check times, and confirm the cancelled
// run left neither its output nor the work folder behind.
function checkExport(c: SmokeContext, r: { export: string; checks: { name: string; t: number }[]; cancelPath: string }): void {
  const probe = spawnSync(ffprobeBin(), ['-v', 'error', '-count_packets', '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_read_packets:format=duration,size', '-of', 'json', r.export], { encoding: 'utf8' })
  console.log(`[export-probe] ${probe.stdout.replace(/\s+/g, ' ')}`)
  saveFrames(r.export, r.checks)
  console.log(`[export-cancel] output left behind: ${existsSync(r.cancelPath)}, work dir left: ${existsSync(join(c.project()!.dir, 'export-work'))}`)
}

// Smoke only: probe an exported MP4 and save frames at the given times next to it.
function grabFrames(file: string, checks: { name: string; t: number }[]): void {
  const probe = spawnSync(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', file], { encoding: 'utf8' })
  console.log(`[export-probe] ${probe.stdout.replace(/\s+/g, ' ')}`)
  saveFrames(file, checks)
}

function saveFrames(file: string, checks: { name: string; t: number }[]): void {
  for (const c of checks) {
    const out = file.replace(/\.mp4$/, `-${c.name}.png`)
    spawnSync(ffmpegBin(), ['-v', 'error', '-y', '-ss', c.t.toFixed(3), '-i', file, '-frames:v', '1', out])
    console.log(`[export-frame] ${c.name} t=${c.t.toFixed(2)} -> ${existsSync(out) ? out : 'missing'}`)
  }
}

export function corruptFirstReel(dir: string): void {
  const reels = join(dir, 'reels')
  const f = existsSync(reels) ? readdirSync(reels).find(x => x.endsWith('.json')) : undefined
  if (!f) return
  writeFileSync(join(reels, f), '{ this is not json')
  console.log(`[smoke] corrupted ${f}`)
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
// [VR_SMOKE_SLIDES=1 [VR_SMOKE_EXPORT=<out.mp4>] [VR_SMOKE_ASSETS=<a.pdf;b.png>]: the right-click menu, objects on a slide,
//  PDF pages and pictures, a frame, drag, through-play, a changed file read again, export]
// [VR_SMOKE_HOME=<step>: library and project flow from the home screen; VR_LIBRARY=<dir>]
// [VR_SMOKE_M8=relink|flush-write|report|undo] [VR_SMOKE_CORRUPT=1: break the first reel file before loading] [VR_SMOKE_MINIMIZE=1]
// [VR_SMOKE_PHOTOS=<pack.vrpack>: read a pack in, put the play's player's photo on a clip, set and remove one]
// [VR_SMOKE_COURT=1: fit the court grid by dragging a corner, save it with the match, swap the near side, light a play's zones,
//  lay a picture on the near half with perspective and drag a corner, move its transparency slider with the real
//  mouse and keys; with VR_SMOKE_EXPORT=<out.mp4> also export the clip with the court]
// [VR_SMOKE_SETTER=reception|rotation|rot|serve: a setter's data slide made from the dialog (serve: a server's, with the starts)]
// [VR_SMOKE_CARDINSERT=<pack.vrpack>|<logo image>: a player's photo and a team logo put on a marker card from its bar]
// [VR_SMOKE_PRESETSERVE=1: the serve preset's player order and markers (zone, in order) in the dialog's preview]
// [VR_SMOKE_CLIPMENU=1 [VR_SMOKE_EXPORT=<out.mp4>]: a clip's right-click menu: copied and moved to another scene, exported alone]
// [VR_SMOKE_PRESETBLOCK=1: the block preset by middle split by the opposing setter, made newest match first]
// [VR_SMOKE_SCENETITLE=1: a scene card with a long name; dragging its title saves a top-left]
// [VR_SMOKE_REEL=<{markers, groupOrder?, scope?, shotAt?} JSON>: build a reel from the results and play it through]
// imports matches if needed, applies the filter, jumps to the n-th result, and saves a screenshot.
export async function runSmoke(c: SmokeContext, w: BrowserWindow, outPng: string): Promise<void> {
  const library = c.library(), project = c.project()
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
      photos: process.env.VR_SMOKE_PHOTOS,
      court: !!process.env.VR_SMOKE_COURT,
      savedFilters: !!process.env.VR_SMOKE_SAVEDFILTERS,
      presets: !!process.env.VR_SMOKE_PRESETS,
      picker: !!process.env.VR_SMOKE_PICKER,
      presetServe: !!process.env.VR_SMOKE_PRESETSERVE,
      presetBlock: !!process.env.VR_SMOKE_PRESETBLOCK,
      clipMenu: !!process.env.VR_SMOKE_CLIPMENU,
      setter: process.env.VR_SMOKE_SETTER,
      cardInsert: process.env.VR_SMOKE_CARDINSERT,
      sceneTitle: !!process.env.VR_SMOKE_SCENETITLE,
      captionPhoto: !!process.env.VR_SMOKE_CAPTIONPHOTO,
      captionNames: !!process.env.VR_SMOKE_CAPTIONNAMES,
      courtPoints: process.env.VR_SMOKE_COURTPOINTS,
      cardOwn: !!process.env.VR_SMOKE_CARDOWN,
      flightStill: !!process.env.VR_SMOKE_FLIGHTSTILL,
      slowHold: !!process.env.VR_SMOKE_SLOWHOLD,
      serveTouch: !!process.env.VR_SMOKE_SERVETOUCH,
      direction: !!process.env.VR_SMOKE_DIRECTION,
      maximize: !!process.env.VR_SMOKE_MAXIMIZE,
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
    if (result?.export) checkExport(c, result)
    if (result?.videoExport && result.exported) grabFrames(result.videoExport, result.exported.checks)
  } catch (e) {
    console.error(`[smoke] failed: ${(e as Error).message}`)
    process.exitCode = 1
  }
  app.quit()
}
