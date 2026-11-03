// Dev self-checks (VR_SMOKE): scripted runs through the real UI that report what they saw.
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { EMPTY_FILTER, sameFilter, type PlayFilter, type PlayRef } from '../../shared/filter'
import { addClips, findClip, groupOf, groupRows, newReel, rangeDefaults, relink, setAnnotations, setOverlayOverride, toggleMarker, trimClip, type Clip, type ClipMode, type Group, type Marker, type Reel, type SlideSpot } from '../../shared/reel'
import type { ExportJob, LibraryInfo, ProjectInfo, ScanResult, SlideFile } from '../../shared/types'
import { drawAnnotation, type Annotation } from '../../shared/annotation'
import { mergeScoped, scopeOf, type AnnScope, type ScopedAnnotations } from '../../shared/annotationScope'
import { overlaySettings, type OverlaySettings } from '../../shared/overlay'
import { newVideo, type PlanItem, type Video } from '../../shared/video'
import type { Scope } from './components/FilterPanel'
import type { SlideHow } from './components/ReelPanel'
import type { Tool } from './components/AnnotationLayer'
import { assetStats, forgetLogo } from './assets'
import { canvasStats } from './canvas'
import { playback } from './playback'
import { refreshPacks } from './packs'
import { captionPhoto, findPhoto } from '../../shared/pack'
import { courtQuad, playZones } from '../../shared/court'
import { assetImage } from './assets'
import { t } from '../../shared/i18n'
import type { AppLatest } from './app/appState'
import { clipPlayedSec } from '../../shared/timing'

export interface SmokeOpts {
  play: number
  filter: Partial<PlayFilter> | null
  scope: Scope
  settings?: boolean
  keys?: string[]
  trim?: boolean
  ann?: boolean
  ov?: string
  exportTo?: string
  m8?: string
  video?: boolean
  obj?: boolean
  copy?: boolean // Ctrl+C / Ctrl+V of objects within a clip and onto another clip
  slides?: boolean // slides: the right-click menu, objects on a slide, PDF pages, a frame, through-play, reading again, export
  assets?: string[] // with obj / slides: image / PDF files to insert
  logo?: string // with video: "<code>|<image>" set as that team's logo first
  photos?: string // a .vrpack read in; the player-photo panel used through its buttons
  court?: boolean // the court grid fitted through its bar and corner handles
  maximize?: boolean // M and Esc with real keys, then the scene played maximized from its ⛶ with a real click
  direction?: boolean // the court fitted, then the 向き buttons: up and down split the plays, the list shows ↑ ↓
  slowHold?: boolean // a slow stretch and a hold put from the trim bar's buttons, played in the loop, and exported
  captionNames?: boolean // a name typed on one clip goes to every clip of that player in the video; 'this clip only' stays on the clip
  captionPhoto?: boolean // with VR_PACKS_DIR: the player's photo by the caption, bottom-left then top-left, and in the export
  savedFilters?: boolean // the filter saved under a name, put back, saved again, removed and the removal undone
  listRun?: boolean // the list follows on to the next plays (プレー前後)
  mem?: number // with obj: seconds of playback to sample the JS heap over
  videoExportTo?: string
  home?: string
  folders?: string[]
  newProject?: string
  reel?: { markers: (Marker | null)[]; groupOrder?: Marker[]; scope?: 'marked' | 'all'; shotAt?: number }
}

// What the self-checks drive in App: its state setters, actions and the latest-state ref.
export interface SmokeHost {
  activateClip: (c: Clip, g?: Group) => void
  currentPlan: (target: 'video' | 'scene') => PlanItem[]
  editCard: (sceneId: string | null, marker: Marker | null) => void
  exportMarker: (sceneId: string, m: Marker, outPath?: string) => Promise<ExportJob | null>
  exportScenes: (dir?: string) => Promise<void>
  extraSelRef: RefObject<string[]>
  insertImage: (path?: string) => Promise<string | null>
  jump: (r: PlayRef) => void
  latest: RefObject<AppLatest>
  loadProject: (p: ProjectInfo | null) => Promise<void>
  overlapsRef: RefObject<Map<string, string[]>>
  playThrough: (target: 'video' | 'scene', startAt?: number) => void
  putSlide: (spot: SlideSpot, how: SlideHow, files?: SlideFile[]) => Promise<void>
  scopedNow: () => ScopedAnnotations | null
  setAnnScope: (annId: string, to: AnnScope) => void
  setAnnTool: Dispatch<SetStateAction<Tool>>
  setAnns: (list: Annotation[]) => void
  setExtract: Dispatch<SetStateAction<ClipMode>>
  setFilter: Dispatch<SetStateAction<PlayFilter>>
  setLibrary: Dispatch<SetStateAction<LibraryInfo | null>>
  setOverlay: (s: OverlaySettings) => void
  setOverlayOpen: Dispatch<SetStateAction<boolean>>
  setPicker: Dispatch<SetStateAction<'create' | 'edit' | null>>
  setReelId: Dispatch<SetStateAction<string | null>>
  setReels: Dispatch<SetStateAction<Reel[]>>
  setScan: Dispatch<SetStateAction<ScanResult | null>>
  setScope: Dispatch<SetStateAction<Scope>>
  setSelectedAnn: Dispatch<SetStateAction<string | null>>
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setVideoId: Dispatch<SetStateAction<string | null>>
  setVideos: Dispatch<SetStateAction<Video[]>>
  startExport: (outPathArg?: string, part?: { plan: PlanItem[]; name: string }) => Promise<ExportJob | null>
  updateReel: (r: Reel) => void
  updateVideo: (v: Video) => void
  SAVE_DELAY_MS: number
}

const api = window.api
const sleep = (ms: number) => new Promise(ok => setTimeout(ok, ms))

function waitFor<T>(get: () => T | null, timeoutMs = 20000, label: string | (() => string) = 'condition'): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      const v = get()
      if (v) return resolve(v)
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${typeof label === 'function' ? label() : label}`))
      setTimeout(tick, 100)
    }
    tick()
  })
}

// Installs window.__smoke, which the main process calls with the run's options (VR_SMOKE_*).
// Loaded with a dynamic import only on a self-check run, so normal use never runs or parses it.
export function installSmoke(h: SmokeHost): void {
  const { activateClip, currentPlan, editCard, exportMarker, exportScenes, extraSelRef, insertImage, jump, latest, loadProject, overlapsRef, playThrough, putSlide, scopedNow, setAnnScope, setAnnTool, setAnns, setExtract, setFilter, setLibrary, setOverlay, setOverlayOpen, setPicker, setReelId, setReels, setScan, setScope, setSelectedAnn, setSettingsOpen, setVideoId, setVideos, startExport, updateReel, updateVideo, SAVE_DELAY_MS } = h
  // A failure's stack is logged here: only its message reaches the main process.
  window.__smoke = (opts: SmokeOpts) => run(opts).catch(e => { console.error(`[smoke stack] ${(e as Error).stack}`); throw e })
  const run = async (opts: SmokeOpts) => {
    if (opts.home) return smokeHome(opts)
    if (opts.m8?.startsWith('relocate:')) return smokeRelocate(opts.m8.slice('relocate:'.length))
    const p = await api.getProject()
    if (!p?.matches.length) throw new Error('no match in project')
    await loadProject(p)
    setScope(opts.scope)
    const want = { ...EMPTY_FILTER, ...(opts.filter ?? {}) }
    setFilter(want)
    const res = await waitFor(() => {
      const l = latest.current
      return JSON.stringify(l.filter) === JSON.stringify(want) && l.results.length ? l.results : null
    })
    if (opts.reel) return smokeReel(opts.reel, res)
    if (opts.trim) return smokeTrim(res)
    if (opts.ann) return smokeAnn(res)
    if (opts.copy) return smokeCopy(res)
    if (opts.photos) return smokePhotos(res, opts.photos)
    if (opts.court) return smokeCourt(res, opts.exportTo)
    if (opts.savedFilters) return smokeSavedFilters(want, res.length)
    if (opts.captionPhoto) return smokeCaptionPhoto(res, opts.exportTo)
    if (opts.captionNames) return smokeCaptionNames(res)
    if (opts.slowHold) return smokeSlowHold(res, opts.exportTo)
    if (opts.direction) return smokeDirection()
    if (opts.maximize) return smokeMaximize(res)
    if (opts.slides) return smokeSlides(res, opts).catch(e => { throw new Error(String((e as Error).stack)) })
    if (opts.ov) return smokeOverlay(res, opts.ov)
    if (opts.exportTo) return smokeExport(res, opts.exportTo)
    if (opts.m8) return smokeM8(res, opts.m8)
    if (opts.video) return smokeVideo(res, opts).catch(e => { throw new Error(String((e as Error).stack)) })
    if (opts.obj) return smokeObjects(res, opts).catch(e => { throw new Error(String((e as Error).stack)) }) // keep where it failed in the log
    if (opts.listRun) {
      // プレー前後: a play picked in the list is followed by the next ones on their own.
      setExtract('keyplay'); await sleep(100)
      const start = Math.min(opts.play, res.length - 3)
      jump(res[start])
      const seen = [res[start].play.id]
      const t0 = performance.now()
      while (seen.length < 3 && performance.now() - t0 < 40000) {
        await sleep(200)
        const s = latest.current.selected
        if (s && s.playId !== seen[seen.length - 1]) seen.push(s.playId)
      }
      return { listRun: seen, expected: res.slice(start, start + 3).map(x => x.play.id), ms: Math.round(performance.now() - t0) }
    }
    const r = res[Math.min(opts.play, res.length - 1)]
    jump(r)
    await waitFor(() => playback.attachedKey === r.matchId && playback.current.ready || null)
    const t = await playback.seekAndWait(r.play.time + latest.current.matches[r.matchId].offsetSec)
    if (opts.settings) { setSettingsOpen(true); await sleep(300) }
    // Real key events, as if typed: each one goes through the window keydown handler.
    const afterKeys: (string | number | null)[] = []
    for (const key of opts.keys ?? []) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      await sleep(150)
      const rl = latest.current.reel, c = rl && findClip(rl, r.matchId, r.play.id)
      afterKeys.push(c ? groupOf(rl, c.id) : null)
    }
    return {
      matches: p.matches.map(m => m.name), scope: opts.scope, results: res.length,
      perMatch: Object.fromEntries(p.matches.map(m => [m.name, res.filter(x => x.matchId === m.id).length])),
      // How the list runs through the matches: one entry per stretch of the same match.
      matchRuns: latest.current.results.reduce<string[]>((o, x) => { const n = p.matches.find(m => m.id === x.matchId)?.name ?? '?'; if (o[o.length - 1] !== n) o.push(n); return o }, []).slice(0, 12),
      jumped: { match: latest.current.matches[r.matchId].name, code: r.play.code, name: r.name, videoTime: t },
      keys: opts.keys ?? [], groupAfterEachKey: afterKeys, reel: latest.current.reel?.name ?? null,
    }
  }

  // Objects through real pointer, key and form events: a polygon by clicks, a box resized by its
  // corner, an arrow end dragged, a vertex inserted from a midpoint and one deleted, then fill,
  // transparency, dash, arrow heads and a boxed text set from the format panel; optional export.
  // Slides: a blank one through the right-click menu (it opens for editing; a rectangle drawn on it,
  // its seconds changed), PDF pages / pictures (copied into the project first) at the group's head,
  // a frame of the video, a drag, the plan and a through-play, a changed file read again, export.
  const smokeSlides = async (res: PlayRef[], opts: SmokeOpts) => {
    const picks = res.filter(x => x.play.rallyId !== null).slice(0, 2)
    let sc = addClips(newReel('slide smoke'), picks.map(x => ({ matchId: x.matchId, play: x.play }))).reel
    const ids = sc.groups.none.slice()
    for (const id of ids) sc = toggleMarker(sc, id, 1)
    smokeUse(sc)
    await waitFor(() => latest.current.reel?.id === sc.id || null, 20000, 'scene')
    activateClip(latest.current.reel!.clips[ids[0]], 1)
    await waitFor(() => playback.attachedKey === picks[0].matchId && playback.current.ready ? true : null, 20000, 'video')
    await playback.seekAndWait(latest.current.clipInfo(latest.current.reel!.clips[ids[0]]).range!.in + 1.5)
    const scene = () => latest.current.reels.find(x => x.id === sc.id)!
    const rows = () => groupRows(scene(), 1).map(r => (r.kind === 'clip' ? `clip${ids.indexOf(r.id)}` : r.slide.bg.kind === 'blank' ? 'blank' : r.slide.bg.source ? `file:${r.slide.bg.source.page ?? r.slide.bg.source.name}` : 'frame'))
    const log: Record<string, unknown> = {}

    // Right-click: on the group's header it offers the top of the group (closed again with Esc); on
    // the first clip, below it, then 無地のスライド.
    const rightClick = async (el: Element) => {
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 40, clientY: b.top + b.height / 2 })); await sleep(150)
    }
    await rightClick(document.querySelector('.reel-groups .group:first-child .group-head')!)
    log.headMenu = document.querySelector('.slide-menu-title')?.textContent
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100)
    log.headMenuClosed = !document.querySelector('.slide-menu')
    log.gapButtons = document.querySelectorAll('.slide-gap').length // the hover ＋ between rows is gone
    await rightClick(document.querySelector('.reel-groups .group:first-child .clip-row')!)
    log.rowMenu = document.querySelector('.slide-menu-title')?.textContent
    const items = [...document.querySelectorAll<HTMLButtonElement>('.slide-menu button')].map(b => `${b.textContent}${b.disabled ? '(off)' : ''}`)
    log.menu = items
    ;[...document.querySelectorAll<HTMLButtonElement>('.slide-menu button')].find(b => b.textContent === '無地のスライド')!.click()
    await waitFor(() => document.querySelector('.card-edit-bar')?.textContent?.includes('スライド') || null, 5000, 'slide editor')
    log.afterBlank = rows()
    log.editorOpen = document.querySelector('.slide-row.active') !== null

    // A rectangle on the slide, and 2.5 seconds.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })); await sleep(100)
    const ac = document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]')!
    const apt = (fx: number, fy: number) => { const b = ac.getBoundingClientRect(); return { clientX: b.left + fx * b.width, clientY: b.top + fy * b.height, bubbles: true, pointerId: 1 } }
    ac.dispatchEvent(new PointerEvent('pointerdown', apt(0.3, 0.3))); await sleep(40)
    ac.dispatchEvent(new PointerEvent('pointermove', apt(0.5, 0.5))); await sleep(40)
    ac.dispatchEvent(new PointerEvent('pointermove', apt(0.7, 0.7))); await sleep(40)
    ac.dispatchEvent(new PointerEvent('pointerup', apt(0.7, 0.7))); await sleep(300)
    const secs = document.querySelector<HTMLInputElement>('[aria-label="スライドを出す秒数"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(secs, '2.5')
    secs.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200)
    const blank = scene().slides!.find(s => s.bg.kind === 'blank')!
    log.blank = { objects: blank.annotations.map(a => a.kind), sec: blank.durationSec }

    // PDF pages and pictures at the head of marker 1; a frame of the video after the last clip.
    const files = await api.smokePickSlides!(opts.assets ?? [])
    await putSlide({ group: 1, after: null, index: 0 }, 'file', files)
    await putSlide({ group: 1, after: ids[1], index: 0 }, 'frame')
    await sleep(300)
    log.afterFiles = rows()
    log.frameEditing = document.querySelector('.card-edit-bar')?.textContent?.includes('静止画') ?? false

    // Drag the blank slide onto the top half of the first row: it goes to the head.
    const blankRow = [...document.querySelectorAll<HTMLElement>('.slide-row')].find(r => r.textContent?.includes('無地'))!
    const firstRow = document.querySelector<HTMLElement>('.reel-groups .group:first-child .clip-row')!
    const dt = new DataTransfer()
    blankRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const fb = firstRow.getBoundingClientRect()
    firstRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: fb.top + 2 }))
    await sleep(150)
    firstRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: fb.top + 2 }))
    await sleep(300)
    log.afterDrag = rows()

    // The plan, and a through-play: each item as it starts.
    const describe = (p: PlanItem[]) => p.map(it => it.kind === 'card' ? (it.card.slide ? `slide ${it.durationSec}s` : `[card ${it.card.marker}]`) : `clip${ids.indexOf(it.clip.id)}`)
    log.plan = describe(currentPlan('video'))
    const timeline: string[] = []
    let last = -1
    const unsub = playback.subscribe(st => {
      if (!st.seq || st.seq.index === last) return
      last = st.seq.index
      timeline.push(st.card ? (st.card.slide ? `slide` : 'card') : 'clip')
    })
    document.querySelector<HTMLButtonElement>('.card-edit-bar button.primary')?.click(); await sleep(200)
    playThrough('video', 0)
    await waitFor(() => (playback.current.seq === null && timeline.length ? true : null), 180000, 'through-play')
    unsub()
    log.timeline = timeline

    // A picture's file changes (its copy in the project): the bar appears on focus; 読み直す gives a new picture.
    const pic = scene().slides!.find(s => s.bg.kind === 'image' && s.bg.source && s.bg.source.page === null)
    if (pic && pic.bg.kind === 'image' && pic.bg.source) {
      const before = pic.bg.assetId
      await sleep(1100)
      await api.smokeTouch!(pic.bg.source.path)
      window.dispatchEvent(new Event('focus'))
      const bar = await waitFor(() => document.querySelector<HTMLElement>('.banner.slides-stale'), 5000, 'stale bar')
      log.staleBar = bar.textContent
      ;[...bar.querySelectorAll('button')].find(b => b.textContent === '読み直す')!.click()
      await waitFor(() => { const s = scene().slides!.find(x => x.id === pic.id); return s?.bg.kind === 'image' && s.bg.assetId !== before ? true : null }, 10000, 'reloaded picture')
      log.reloaded = { notice: latest.current.notice, barGone: !document.querySelector('.banner.slides-stale') }
    }

    // Export: the plan's slides become stills of their length.
    let exported: unknown = null
    if (opts.videoExportTo) {
      const job = await startExport(opts.videoExportTo)
      await waitFor(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') || null, 300000, 'export')
      const starts: number[] = []; let acc = 0
      for (const it of job!.items) { starts.push(acc); acc += it.kind === 'clip' ? it.out - it.in : it.durationSec }
      const kinds = job!.items.map(it => it.kind)
      const at = (i: number) => +(starts[i] + 0.5).toFixed(2)
      exported = { status: latest.current.exportState?.status, message: latest.current.exportState?.message, items: kinds, expectedSec: +acc.toFixed(2),
        checks: kinds.flatMap((k, i) => (k === 'card' ? [{ name: `slide${i}`, t: at(i) }] : [])) }
    }

    // The card switches say on / off in words; marker 1's card with two lines of text on a navy
    // background (typed into the card bar), left open for the screenshot.
    log.cardSwitches = [...document.querySelectorAll('.card-toggle')].map(b => b.textContent)
    editCard(sc.id, 1); await sleep(400)
    const ta = document.querySelector<HTMLTextAreaElement>('[aria-label="カードの文字"]')!
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, '7番のアタック\nセット 1')
    ta.dispatchEvent(new Event('input', { bubbles: true })); await sleep(200)
    const color = document.querySelector<HTMLInputElement>('[aria-label="カードの背景色"]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(color, '#1e3a8a')
    color.dispatchEvent(new Event('input', { bubbles: true })); await sleep(400)
    log.card = { title: scene().markerCardTitles?.[1], background: latest.current.overlay.titleCard.background,
      planName: currentPlan('video').find(it => it.kind === 'card' && it.card.marker === 1)?.kind === 'card' ? (currentPlan('video').find(it => it.kind === 'card' && it.card.marker === 1) as { card: { name: string } }).card.name : null }
    return { ...log, videoExport: opts.videoExportTo ?? null, exported }
  }

  const smokeObjects = async (res: PlayRef[], opts: SmokeOpts) => {
    const r0 = res.find(x => x.play.rallyId !== null)!
    const sc = { ...addClips(newReel('object smoke'), [{ matchId: r0.matchId, play: r0.play }]).reel, scope: 'all' as const } // unmarked clip, so export everything
    smokeUse(sc)
    await waitFor(() => latest.current.reel?.id === sc.id || null, 20000, 'scene')
    const clip = latest.current.reel!.clips[sc.groups.none[0]]
    activateClip(clip)
    await waitFor(() => playback.attachedKey === r0.matchId && playback.current.ready ? true : null, 20000, 'video')
    const range = latest.current.clipInfo(clip).range!
    await playback.seekAndWait(range.in + 2)
    const canvas = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]'), 20000, 'canvas')
    // Measured on every event: the layout can move while panels change.
    const pt = (x: number, y: number) => { const b = canvas.getBoundingClientRect(); return { clientX: b.left + x * b.width, clientY: b.top + y * b.height, bubbles: true, pointerId: 1 } }
    const key = async (k: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await sleep(80) }
    const down = async (x: number, y: number) => { canvas.dispatchEvent(new PointerEvent('pointerdown', pt(x, y))); await sleep(40); canvas.dispatchEvent(new PointerEvent('pointerup', pt(x, y))); await sleep(60) }
    const stroke = async (path: [number, number][], shift = false) => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', pt(...path[0]))); await sleep(40)
      for (const q of path.slice(1)) { canvas.dispatchEvent(new PointerEvent('pointermove', { ...pt(...q), shiftKey: shift })); await sleep(25) }
      canvas.dispatchEvent(new PointerEvent('pointerup', pt(...path[path.length - 1]))); await sleep(120)
    }
    const dbl = async (x: number, y: number) => { canvas.dispatchEvent(new MouseEvent('dblclick', pt(x, y))); await sleep(150) }
    const anns = () => latest.current.reel!.clips[clip.id].annotations
    const find = (k: string) => anns().find(a => a.kind === k) as Record<string, unknown> | undefined
    const ctl = <T extends HTMLElement>(label: string) => document.querySelector<T>(`[aria-label="${label}"]`)!
    const setValue = async (label: string, value: string) => {
      const el = ctl<HTMLInputElement | HTMLSelectElement>(label)
      const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await sleep(120)
    }
    const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.ann-tools button')].find(b => b.textContent?.startsWith(text))!
    const log: Record<string, unknown> = {}

    // Polygon: three clicks, then a double-click (whose two clicks add one duplicate point).
    await key('p')
    await down(0.2, 0.2); await down(0.4, 0.2); await down(0.3, 0.4); await down(0.3, 0.4); await dbl(0.3, 0.4)
    log.polygon = (find('polygon')?.points as unknown[] | undefined)?.length ?? 0

    // Rect drawn, then resized by its bottom-right handle.
    await key('r'); await stroke([[0.55, 0.15], [0.65, 0.25], [0.75, 0.35]])
    await key('v'); await stroke([[0.75, 0.35], [0.8, 0.4], [0.85, 0.45]])
    const rect = find('rect')!
    log.rectResized = { w: +(rect.w as number).toFixed(3), h: +(rect.h as number).toFixed(3) }

    // Arrow drawn, then its end dragged.
    await key('a'); await stroke([[0.1, 0.6], [0.2, 0.65], [0.3, 0.7]])
    await key('v'); await stroke([[0.3, 0.7], [0.35, 0.75], [0.4, 0.8]])
    const arrow = find('arrow')!
    log.arrowEnd = [+(arrow.x2 as number).toFixed(3), +(arrow.y2 as number).toFixed(3)]
    await setValue('矢印の先', 'both')
    log.arrowHeads = find('arrow')!.heads

    // Polygon: select by its top edge, turn on Edit Points, drag the top edge's midpoint up (adds
    // one vertex however many moves arrive), then double-click the new vertex to delete it again.
    await down(0.3, 0.2)
    button('頂点の編集').click(); await sleep(120)
    log.probe = { sel: latest.current.selectedAnn?.slice(0, 4), kind: anns().find(a => a.id === latest.current.selectedAnn)?.kind, pressed: document.querySelector('.ann-tools [aria-pressed]')?.getAttribute('aria-pressed') }
    await stroke([[0.3, 0.2], [0.3, 0.18], [0.3, 0.16], [0.3, 0.14], [0.3, 0.12], [0.3, 0.1]])
    log.polygonAfterInsert = (find('polygon')!.points as unknown[]).length
    await dbl(0.3, 0.1)
    log.polygonAfterDelete = (find('polygon')!.points as unknown[]).length

    // Rect formats from the panel: fill on, 60% transparent, dashed outline.
    await down(0.85, 0.3) // right edge of the resized rect
    ctl<HTMLInputElement>('塗りつぶす').click(); await sleep(120)
    await setValue('塗りの透明度', '60')
    await setValue('線の種類', 'dash')
    const rf = find('rect')!
    log.rectFormat = { fill: rf.fill, fillOpacity: rf.fillOpacity, dash: rf.dash }

    // Text, then boxed.
    await key('t'); await down(0.08, 0.86)
    const input = await waitFor(() => document.querySelector<HTMLTextAreaElement>('.ann-text-input'), 5000, 'text input')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'BLOCK!')
    input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(50)
    // Alt+Enter starts a second line (Enter alone finishes).
    input.selectionStart = input.selectionEnd = input.value.length
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true })); await sleep(80)
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, input.value + 'TOUCH')
    input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(50)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(150)
    ctl<HTMLInputElement>('枠付き').click(); await sleep(150)
    log.text = { box: !!find('text')!.box, padding: (find('text')!.box as { padding?: number } | undefined)?.padding, lines: String(find('text')!.text).split('\n') }
    // Triangle by dragging a box; widened by its right box handle (all points scale), then a
    // vertex added in Edit Points mode.
    ;(document.activeElement as HTMLElement | null)?.blur() // the box checkbox has focus, and keys typed there are ignored
    await key('g'); await stroke([[0.55, 0.55], [0.6, 0.6], [0.65, 0.7]])
    const triId = latest.current.selectedAnn
    const tri = () => anns().find(a => a.id === triId) as { kind: string; points: number[][] } | undefined
    log.triangle = tri()?.points.length ?? 0
    await key('v'); await stroke([[0.65, 0.625], [0.7, 0.625], [0.75, 0.625]])
    log.triangleWidened = tri() ? +(Math.max(...tri()!.points.map(p => p[0])) - Math.min(...tri()!.points.map(p => p[0]))).toFixed(3) : null
    button('頂点の編集').click(); await sleep(120)
    await stroke([[0.65, 0.7], [0.65, 0.75], [0.65, 0.8]]) // bottom edge's midpoint
    log.triangleAfterInsert = tri()?.points.length ?? 0
    {
      // Shift on a vertex: it lines up with a neighbor (here the x of the vertex before it).
      const t = tri()!, i = 3, prev = t.points[2], v = t.points[i]
      await stroke([[v[0], v[1]], [prev[0] + 0.01, v[1] + 0.02], [prev[0] + 0.012, v[1] + 0.03]], true)
      const after = tri()!.points[i]
      log.shiftSnap = { x: +after[0].toFixed(4), neighborX: +prev[0].toFixed(4) }
    }

    // Pictures: an image file and page 1 of a PDF, placed in the corners.
    if (opts.assets?.length) {
      const ids: string[] = []
      for (const path of opts.assets) { const id = await insertImage(path); if (id) ids.push(id) }
      await sleep(300)
      // The PDF page fades in over 2 s (checked in the export: half at 1 s, whole at 2.5 s).
      setAnns(anns().map(a => a.kind !== 'image' ? a : { ...a, x: ids.indexOf(a.id) === 0 ? 0.02 : 0.68, y: 0.05, ...(ids.indexOf(a.id) === 1 ? { fadeIn: 2 } : {}) }))
      await sleep(300)
      log.images = anns().filter(a => a.kind === 'image').map(a => a.kind === 'image' ? { w: +a.w.toFixed(3), h: +a.h.toFixed(3), asset: a.assetId.slice(-4) } : null)

      // Cropping: the right handle narrows the frame, then the wheel zooms the picture in.
      const imgId = anns().find(a => a.kind === 'image')!.id
      const im = () => anns().find(a => a.id === imgId) as Extract<Annotation, { kind: 'image' }>
      setSelectedAnn(imgId); await sleep(200)
      button('トリミング').click(); await sleep(200)
      const i0 = im(), my = i0.y + i0.h / 2
      await stroke([[i0.x + i0.w, my], [i0.x + i0.w * 0.85, my], [i0.x + i0.w * 0.7, my]])
      canvas.dispatchEvent(new WheelEvent('wheel', { ...pt(i0.x + i0.w * 0.35, my), deltaY: -100, cancelable: true })); await sleep(200)
      const c1 = im().crop
      log.crop = c1 ? { x: +c1.x.toFixed(3), y: +c1.y.toFixed(3), w: +c1.w.toFixed(3), h: +c1.h.toFixed(3), frameW: +im().w.toFixed(3) } : null
    }
    // The selected object's show / hide span on the trim bar's track.
    const arrowId = anns().find(a => a.kind === 'arrow')!.id
    setSelectedAnn(arrowId); await sleep(200)
    button('ここから表示').click(); await sleep(200)
    log.objectSpan = !!document.querySelector('.trim-object')
    log.loopBox = (document.querySelector('.trim-head input[type=checkbox]') as HTMLInputElement | null)?.checked ?? null
    setSelectedAnn(null); await sleep(100)
    // Timeline: the arrow's start grip dragged right on the trim track; then the lanes opened.
    setSelectedAnn(arrowId); await sleep(200)
    {
      const grip = document.querySelector<HTMLElement>('.trim-track .trim-object.main .obj-grip.from')!
      const track = document.querySelector<HTMLElement>('.trim-track')!.getBoundingClientRect()
      const gb = grip.getBoundingClientRect(), gy = gb.top + gb.height / 2
      grip.dispatchEvent(new PointerEvent('pointerdown', { clientX: gb.left + 4, clientY: gy, bubbles: true, pointerId: 2 }))
      grip.dispatchEvent(new PointerEvent('pointermove', { clientX: track.left + track.width * 0.5, clientY: gy, bubbles: true, pointerId: 2 }))
      grip.dispatchEvent(new PointerEvent('pointerup', { clientX: track.left + track.width * 0.5, clientY: gy, bubbles: true, pointerId: 2 }))
      await sleep(200)
      const ar = anns().find(a => a.id === arrowId)!
      log.timelineDrag = { showFrom: ar.showFrom !== undefined ? +(ar.showFrom - range.in).toFixed(1) : null }
      // Snapping: let go 3 px off the key play's mark; the time sticks to the key play.
      {
        const g2 = document.querySelector<HTMLElement>('.trim-track .trim-object.main .obj-grip.from')!
        const kb = document.querySelector<HTMLElement>('.trim-track .trim-key')!.getBoundingClientRect()
        const g2b = g2.getBoundingClientRect(), y2 = g2b.top + g2b.height / 2, x2 = kb.left + kb.width / 2 + 3
        g2.dispatchEvent(new PointerEvent('pointerdown', { clientX: g2b.left + 4, clientY: y2, bubbles: true, pointerId: 3 }))
        g2.dispatchEvent(new PointerEvent('pointermove', { clientX: x2, clientY: y2, bubbles: true, pointerId: 3 }))
        await sleep(100)
        const guide = !!document.querySelector('.trim-track .trim-snap')
        g2.dispatchEvent(new PointerEvent('pointerup', { clientX: x2, clientY: y2, bubbles: true, pointerId: 3 }))
        await sleep(200)
        const inf = latest.current.clipInfo(latest.current.reel!.clips[clip.id])
        const keyT = inf.ref!.play.time + latest.current.matches[clip.matchId].offsetSec
        const sf = anns().find(a => a.id === arrowId)!.showFrom
        log.timeSnap = { guide, stuckToKey: sf !== undefined && Math.abs(sf - Math.round(keyT * 100) / 100) < 0.011 }
      }
      ;[...document.querySelectorAll<HTMLButtonElement>('.trim-lanes-head button')][0]?.click(); await sleep(200)
      log.lanes = document.querySelectorAll('.trim-lane-row').length
    }

    // Group: the arrow plus the polygon (Shift+click), grouped; dragging the arrow moves both.
    {
      const polyId = anns().find(a => a.kind === 'polygon')!.id
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...pt(0.3, 0.2), shiftKey: true })); await sleep(40)
      canvas.dispatchEvent(new PointerEvent('pointerup', pt(0.3, 0.2))); await sleep(150)
      log.extraSelected = extraSelRef.current.includes(polyId)
      button('グループ化').click(); await sleep(200)
      const g = anns().find(a => a.id === arrowId)!.groupId
      log.grouped = !!g && anns().find(a => a.id === polyId)!.groupId === g
      const p0 = (anns().find(a => a.id === polyId) as { points: number[][] }).points[0][0]
      const a0 = anns().find(a => a.id === arrowId) as { x1: number; y1: number; x2: number; y2: number }
      const mx = (a0.x1 + a0.x2) / 2, my = (a0.y1 + a0.y2) / 2
      await stroke([[mx, my], [mx + 0.02, my], [mx + 0.04, my]])
      log.groupMoved = +((anns().find(a => a.id === polyId) as { points: number[][] }).points[0][0] - p0).toFixed(3)

      // Palette (the accordion under the scene editor): save the group, put it back in: two more objects, with a new group of their own.
      const head = document.querySelector<HTMLButtonElement>('[data-accordion="palette"] .accordion-head')!
      if (head.getAttribute('aria-expanded') !== 'true') { head.click(); await sleep(200) }
      await setValue('パレットに保存する名前', 'smoke group')
      ;[...document.querySelectorAll<HTMLButtonElement>('[data-accordion="palette"] button')].find(b => b.textContent === '選択を保存')!.click()
      await waitFor(() => document.querySelector('[aria-label="smoke group を入れる"]'), 5000, 'palette item')
      const before = anns().length
      const useBtn = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('[aria-label="smoke group を入れる"]'); return b && !b.disabled ? b : null }, 5000, 'palette button')
      log.paletteBtn = { disabled: useBtn.disabled, items: document.querySelectorAll('.palette-item').length }
      useBtn.click(); await sleep(600)
      const added = anns().slice(before)
      const arrowCopy = added.find(a => a.kind === 'arrow'), arrowNow = anns().find(a => a.id === arrowId)
      log.palette = { added: added.length, newGroup: !!added[0]?.groupId && added[0].groupId !== g, sameShowFrom: arrowCopy?.showFrom === arrowNow?.showFrom && arrowCopy?.showFrom !== undefined }
      // Clean up: the copies would cover the export frame.
      setAnns(anns().filter(a => !added.some(x => x.id === a.id))); await sleep(200)
    }
    // Arrow keys: Down moves to the next play in the list.
    {
      const s0 = latest.current.selected
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await sleep(300)
      log.arrowDown = latest.current.selected?.playId !== s0?.playId
      activateClip(latest.current.reel!.clips[clip.id]); await sleep(600)
    }
    // 表示範囲: the rect to the whole scene, the triangle to the whole video, through the picker.
    const rectId = anns().find(a => a.kind === 'rect')!.id
    setSelectedAnn(rectId); await sleep(200); await setValue('表示範囲', 'scene')
    if (triId) { setSelectedAnn(triId); await sleep(200); await setValue('表示範囲', 'video') }
    await sleep(200)
    log.scopes = {
      clip: anns().map(a => a.kind), scene: (latest.current.reel!.annotations ?? []).map(a => a.kind),
      video: (latest.current.video?.annotations ?? []).map(a => a.kind),
      picker: (document.querySelector('[aria-label="表示範囲"]') as HTMLSelectElement | null)?.value,
    }
    // The headline field: typing makes one centered text at the top middle.
    await setValue('見出し', 'SIDE OUT'); await setValue('見出し', 'SIDE OUT!')
    const q = anns().filter(a => a.kind === 'text' && a.quick)
    log.headline = q.map(a => a.kind === 'text' ? { text: a.text, x: a.x, y: a.y, align: a.align } : null)
    await key('v'); setSelectedAnn(null); await sleep(300)
    // The overlay quick settings (gear in the auto-display row) open over the video.
    document.querySelector<HTMLButtonElement>('.ov-gear')?.click(); await sleep(150)
    log.gearPopup = !!document.querySelector('.ov-gear-pop')
    // A second (later) clip of the same scene shows the scene's and the video's objects too.
    const r1 = res.find(x => x.matchId === r0.matchId && x.play.rallyId !== null && x.play.rallyId !== r0.play.rallyId && x.play.time > r0.play.time + 30)!
    updateReel(addClips(latest.current.reel!, [{ matchId: r1.matchId, play: r1.play }]).reel); await sleep(300)
    const other = Object.values(latest.current.reel!.clips).find(x => x.id !== clip.id)!
    activateClip(other); await sleep(800)
    const sc2 = scopedNow()
    log.otherClip = sc2 ? mergeScoped(sc2).map(a => `${a.kind}:${scopeOf(sc2, a.id)}`) : []
    setSelectedAnn(rectId); await sleep(300)

    // Memory: play the clip (looping, with its objects, scene and video objects on screen) and
    // sample the JS heap after a forced GC, to see what the playing editor keeps allocating.
    if (opts.mem) {
      const gc = (window as unknown as { gc?: () => void }).gc
      const heap = () => { gc?.(); return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0 }
      const samples: number[] = []
      let frames = 0, raf = 0
      const count = () => { frames++; raf = requestAnimationFrame(count) }
      raf = requestAnimationFrame(count)
      if (playback.current.paused) playback.toggle()
      const draws0 = canvasStats.draws, reallocs0 = canvasStats.reallocs
      const t0 = performance.now()
      for (let i = 0; i < opts.mem; i++) { await sleep(1000); samples.push(heap()) }
      cancelAnimationFrame(raf)
      playback.pause()
      const mb = (b: number) => +(b / 1048576).toFixed(2)
      log.mem = { seconds: opts.mem, fps: Math.round(frames / ((performance.now() - t0) / 1000)), startMB: mb(samples[0]), endMB: mb(samples[samples.length - 1]),
        maxMB: mb(Math.max(...samples)), growthMBperMin: mb(((samples[samples.length - 1] - samples[0]) / (samples.length - 1)) * 60), gc: !!gc,
        layerDrawsPerSec: +((canvasStats.draws - draws0) / opts.mem).toFixed(1), reallocs: canvasStats.reallocs - reallocs0, playing: !playback.current.paused, assets: assetStats() }
    }

    if (opts.videoExportTo) {
      const job = await startExport(opts.videoExportTo)
      await waitFor(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') || null, 120000, 'export')
      log.exportStatus = latest.current.exportState?.status
      const t0 = job?.items[0]?.kind === 'card' ? (job.items[0] as { durationSec: number }).durationSec : 0
      return { ...log, videoExport: opts.videoExportTo, exported: { checks: [{ name: 'objects', t: t0 + 2.5 }, { name: 'fade-half', t: t0 + 1.0 }] } }
    }
    return log
  }

  // Videos made of shared scenes: "ハイライト" = attack scene (two marker groups) + serve scene,
  // "サーブ集" = the same serve scene. Checks the plan with scene and marker cards, that the scene
  // editor follows a through-play, that editing the shared scene changes both videos, undo across
  // a video edit and a scene edit, and (with exportTo) the exported file.
  const smokeVideo = async (res: PlayRef[], opts: SmokeOpts) => {
    if (opts.logo) { const [code, path] = opts.logo.split('|'); await window.api.smokeSetLogo!(code, path); forgetLogo(code) } // a logo for the title cards
    const ours = res.filter(x => x.teamRole === 'our')
    const kills = ours.filter(x => x.play.skill === 'A' && x.play.effect === '#').slice(0, 3)
    const serves = ours.filter(x => x.play.skill === 'S' && (x.play.effect === '#' || x.play.effect === '+')).slice(0, 2)
    let a = addClips(newReel('アタック'), kills.map(x => ({ matchId: x.matchId, play: x.play }))).reel
    const ai = a.groups.none.slice()
    a = toggleMarker(toggleMarker(toggleMarker(a, ai[0], 1), ai[1], 2), ai[2], 1)
    a = { ...a, markerNames: { ...a.markerNames, 1: 'Kills', 2: 'Second look' }, rangeDefaults: { mode: 'keyplay', rallyLead: 1.5, rallyTail: 2.5, keyBefore: 3, keyAfter: 3 } }
    let s = addClips(newReel('サーブ'), serves.map(x => ({ matchId: x.matchId, play: x.play }))).reel
    for (const id of s.groups.none.slice()) s = toggleMarker(s, id, 1)
    const cardsOn = { titleCard: { enabled: true, sceneCards: true, durationSec: 1 }, transition: { fade: true, durationSec: 0.3 } }
    const v1 = newVideo('ハイライト', [a.id, s.id], cardsOn), v2 = newVideo('サーブ集', [s.id], cardsOn)
    setReels(rs => [...rs, a, s]); setReelId(a.id)
    setVideos(vs => [...vs, v1, v2]); setVideoId(v1.id)
    await waitFor(() => latest.current.video?.id === v1.id && latest.current.reels.some(x => x.id === s.id) || null, 20000, 'videos')
    const describe = (p: PlanItem[]) => p.map(it => it.kind === 'card' ? (it.card.marker === null ? `[scene ${it.card.name}]` : `[${it.card.marker} ${it.card.name}]`) : `${latest.current.reels.find(x => x.id === it.sceneId)?.name}:${it.clip.playId}`)
    const planV1 = describe(currentPlan('video'))
    const lens = { attackKeyplay: kills.length ? +(latest.current.infoFor(a.clips[ai[0]], a).range!.out - latest.current.infoFor(a.clips[ai[0]], a).range!.in).toFixed(2) : null }

    // Through-play: which scene the editor shows a moment after each item starts.
    const timeline: string[] = []
    let last = -1
    const unsub = playback.subscribe(st => {
      if (!st.seq || st.seq.index === last) return
      last = st.seq.index
      const card = st.card
      setTimeout(() => timeline.push(card ? `card:${card.marker ?? 'scene'}:${card.name}` : `clip, editor=${latest.current.reel?.name}`), 250)
    })
    playThrough('video', 0)
    await waitFor(() => (playback.current.seq === null && timeline.length ? true : null), 180000, 'video through-play')
    unsub()
    await sleep(300)

    // Shared scene: unmark one serve. Both videos lose that clip.
    const sNow = latest.current.reels.find(x => x.id === s.id)!
    updateReel(toggleMarker(sNow, sNow.groups[1][0], null))
    await sleep(200)
    const v1After = describe(currentPlan('video'))
    setVideoId(v2.id); await waitFor(() => latest.current.video?.id === v2.id || null, 5000, 'v2')
    const v2After = describe(currentPlan('video'))
    setVideoId(v1.id); await waitFor(() => latest.current.video?.id === v1.id || null, 5000, 'v1')

    // Undo across kinds: rename the video, then edit the attack scene; Ctrl+Z twice.
    await sleep(700)
    updateVideo({ ...latest.current.video!, name: 'ハイライト（改）' })
    await sleep(700)
    const aNow = latest.current.reels.find(x => x.id === a.id)!
    updateReel({ ...aNow, name: 'アタック（改）' })
    await sleep(200)
    const key = async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await sleep(150) }
    const names = () => `${latest.current.videos.find(x => x.id === v1.id)?.name} / ${latest.current.reels.find(x => x.id === a.id)?.name}`
    const undo = [names()]
    await key(); undo.push(names())
    await key(); undo.push(names())

    let exported: unknown = null
    if (opts.videoExportTo) {
      const plan = currentPlan('video')
      const job = await startExport(opts.videoExportTo)
      await waitFor(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') || null, 180000, 'export')
      const starts: number[] = []; let acc = 0
      for (const it of job!.items) { starts.push(acc); acc += it.kind === 'clip' ? it.out - it.in : it.durationSec }
      exported = { status: latest.current.exportState?.status, items: job!.items.map(it => it.kind), expectedSec: +acc.toFixed(2),
        checks: [{ name: 'fade-start', t: 0.03 }, { name: 'scene-card', t: 0.5 }, { name: 'marker-card', t: starts[1] + 0.5 }, { name: 'clip', t: starts[2] + 1 },
          { name: 'second-scene-card', t: starts[plan.findIndex((it, i) => i > 0 && it.kind === 'card' && it.card.marker === null)] + 0.5 }] }
    }
    // Marker 2 of the attack scene switched off: out of the plan, greyed in the scene editor.
    const aLast = latest.current.reels.find(x => x.id === a.id)!
    setReelId(a.id); updateReel({ ...aLast, markerOff: { 2: true } }); await sleep(400)
    const planOff = describe(currentPlan('video'))

    // Drag the second scene of the video above the first: a line shows where it lands.
    const sceneRows = () => [...document.querySelectorAll<HTMLLIElement>('.video-scene')]
    const dt = new DataTransfer()
    const [first, second] = sceneRows()
    second.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const fb = first.getBoundingClientRect()
    first.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: fb.top + 2 }))
    await sleep(150)
    const dropLine = first.className.includes('drop-before')
    first.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: fb.top + 2 }))
    await sleep(300)
    const dragged = { dropLine, order: latest.current.video!.sceneIds.map(id => latest.current.reels.find(x => x.id === id)?.name) }

    // One marker group alone as an MP4 (its card and its clips).
    let markerExport: unknown = null
    if (opts.videoExportTo) {
      // Exported with the marker number off: its card shows a slim stripe instead (see -marker1.mp4).
      const tc = latest.current.overlay.titleCard
      setOverlay({ ...latest.current.overlay, titleCard: { ...tc, showMarkerNumber: false } }); await sleep(300)
      const job = await exportMarker(a.id, 1, opts.videoExportTo.replace(/\.mp4$/, '-marker1.mp4'))
      await waitFor(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') || null, 180000, 'marker export')
      markerExport = { status: latest.current.exportState?.status, items: job?.items.map(it => it.kind) }
      setOverlay({ ...latest.current.overlay, titleCard: { ...latest.current.overlay.titleCard, showMarkerNumber: true } }); await sleep(300)
    }
    // One MP4 per scene of the video, one after another, into the export's folder.
    let scenesExport: unknown = null
    if (opts.videoExportTo) {
      const dir = opts.videoExportTo.replace(/[\\/][^\\/]*$/, '')
      const seen: string[] = [] // the scenes the progress text named, in order
      const t0 = performance.now()
      await exportScenes(dir)
      await waitFor(() => {
        const st = latest.current.exportState, at = st?.message.match(/^シーン \d+ \/ \d+「[^」]*」/)?.[0]
        if (at && seen[seen.length - 1] !== at) seen.push(at)
        const finished = st?.status === 'error' || st?.status === 'cancelled' || (st?.status === 'done' && st.message.startsWith('シーンごと'))
        return finished || null
      }, 300000, 'scene exports')
      scenesExport = { status: latest.current.exportState?.status, message: latest.current.exportState?.message, outPath: latest.current.exportState?.outPath, seen, wallMs: Math.round(performance.now() - t0) }
    }

    // The gear on marker 1: its title card over the video; dragging the title moves it.
    editCard(a.id, 1); await sleep(400)
    const radio = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.card-edit-bar button')].find(b => b.textContent === label)!
    radio('タイトルの位置').click(); await sleep(200)
    const ed = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=card-editor]'), 5000, 'card editor')
    const eb = ed.getBoundingClientRect()
    const ept = (fx: number, fy: number) => ({ clientX: eb.left + fx * eb.width, clientY: eb.top + fy * eb.height, bubbles: true, pointerId: 1 })
    ed.dispatchEvent(new PointerEvent('pointerdown', ept(0.13, 0.36))); await sleep(40)
    ed.dispatchEvent(new PointerEvent('pointermove', ept(0.18, 0.36))); await sleep(40)
    ed.dispatchEvent(new PointerEvent('pointermove', ept(0.23, 0.41))); await sleep(40)
    ed.dispatchEvent(new PointerEvent('pointerup', ept(0.23, 0.41))); await sleep(300)
    const lay = latest.current.overlay.titleCard.markerLayout
    const cardLayout = lay ? { x: +lay.x.toFixed(2), y: +lay.y.toFixed(2), scale: lay.scale } : null

    // Objects on the card: back to 図形・文字, draw a rectangle on it.
    radio('図形・文字').click(); await sleep(200)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true })); await sleep(100)
    const ac = document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]')!
    const ab = ac.getBoundingClientRect()
    const apt = (fx: number, fy: number) => ({ clientX: ab.left + fx * ab.width, clientY: ab.top + fy * ab.height, bubbles: true, pointerId: 1 })
    ac.dispatchEvent(new PointerEvent('pointerdown', apt(0.6, 0.6))); await sleep(40)
    ac.dispatchEvent(new PointerEvent('pointermove', apt(0.7, 0.7))); await sleep(40)
    ac.dispatchEvent(new PointerEvent('pointermove', apt(0.8, 0.8))); await sleep(40)
    ac.dispatchEvent(new PointerEvent('pointerup', apt(0.8, 0.8))); await sleep(300)
    // マーカー全体: an object on marker 1's first clip moved to the marker group shows on its other
    // clip, not on marker 2's.
    let markerScope: unknown = null
    {
      const aR = latest.current.reels.find(x => x.id === a.id)!
      const g1 = aR.groups[1], g2 = aR.groups[2]
      activateClip(aR.clips[g1[0]], 1); await sleep(600)
      const rid = crypto.randomUUID()
      setAnns([...mergeScoped(scopedNow()!), { id: rid, kind: 'rect', color: '#EF4444', x: 0.1, y: 0.1, w: 0.1, h: 0.1, width: 4 }]); await sleep(200)
      setAnnScope(rid, 'marker'); await sleep(300)
      const stored = (latest.current.reels.find(x => x.id === a.id)!.markerAnnotations?.[1] ?? []).map(x => x.id === rid)
      activateClip(aR.clips[g1[1]], 1); await sleep(600)
      const onOtherClip = mergeScoped(scopedNow()!).some(x => x.id === rid)
      activateClip(aR.clips[g2[0]], 2); await sleep(600)
      const onMarker2 = mergeScoped(scopedNow()!).some(x => x.id === rid)
      const plan = currentPlan('video').filter(it => it.kind === 'clip' && it.sceneId === a.id)
      // Up / Down after a click in the scene editor walks its rows, not the left list.
      activateClip(aR.clips[g1[0]], 1); await sleep(400)
      document.querySelector('.right-col')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      const listSel = latest.current.selected
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await sleep(400)
      const sceneDown = { clip: latest.current.activeClipId === g1[1], group: latest.current.activeGroup }
      document.querySelector('.sidebar')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await sleep(400)
      const listMoved = latest.current.selected?.playId !== listSel?.playId
      markerScope = { stored, onOtherClip, onMarker2, planGroups: plan.map(it => (it.kind === 'clip' ? it.group : null)), sceneDown, listMoved }
    }

    // The export accordion lists what can be exported.
    {
      const head = document.querySelector<HTMLButtonElement>('[data-accordion="export"] .accordion-head')!
      if (head.getAttribute('aria-expanded') !== 'true') { head.click(); await sleep(200) }
    }
    const exportChoices = [...document.querySelectorAll('.export-target .export-label')].map(e => e.textContent)
    const cardObjects = (latest.current.reels.find(x => x.id === a.id)?.markerCardAnnotations?.[1] ?? []).map(x => x.kind)
    const planCard = currentPlan('video').find(it => it.kind === 'card' && it.card.marker === 1 && it.card.name === 'Kills')
    const planCardObjects = planCard?.kind === 'card' ? (planCard.card.annotations ?? []).length : null
    return { planV1, lens, timeline, v1After, v2After, undo, planOff, dragged, markerExport, scenesExport, cardLayout, cardObjects, planCardObjects, exportChoices, markerScope, videoExport: opts.videoExportTo ?? null, exported }
  }

  // Each smoke scene gets its own video, taking over the overlay the smoke set on the scene
  // (scene cards off, so timelines match the checks written before videos existed).
  const smokeUse = (r: Reel) => {
    const v = newVideo(`${r.name} video`, [r.id], { ...(r.overlay ?? {}), titleCard: { sceneCards: false, ...(r.overlay?.titleCard ?? {}) } })
    setReels(rs => [...rs, r]); setReelId(r.id)
    setVideos(vs => [...vs, v]); setVideoId(v.id)
  }

  // v3 home flow. 'scan': scan folders and leave the pairing dialog open. 'import-create': import
  // the sure pairs, create a project of every HTH/HTA match, open it. 'home' / 'picker': screens.
  const smokeHome = async (opts: SmokeOpts) => {
    setLibrary(await api.getLibrary())
    if (opts.home === 'home') { await sleep(300); return { library: latest.current.library?.matches.length } }
    if (opts.home === 'picker') { setPicker('create'); await sleep(400); return { library: latest.current.library?.matches.length } }
    if (opts.home === 'auto-create') {
      // "作成" in the picker twice with the same name: two folders in <library>/projects, no dialog.
      const made: string[] = []
      for (let i = 0; i < 2; i++) {
        setPicker('create'); await sleep(400)
        const input = document.querySelector<HTMLInputElement>('.modal input[placeholder^="例"]')!
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'スモーク: 自動作成?')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector<HTMLElement>('.match-row.pick')!.click(); await sleep(150) // tick a match
        const buttons = [...document.querySelectorAll<HTMLButtonElement>('.modal-actions button')]
        const other = buttons.some(b => b.textContent === '場所を選んで作成…')
        const before = latest.current.projectPath
        buttons.find(b => b.textContent === '作成')!.click()
        await waitFor(() => (latest.current.projectPath && latest.current.projectPath !== before ? true : null), 20000, 'project created')
        made.push(`${latest.current.projectPath}${other ? '' : ' (no choose-folder button)'}`)
      }
      return { made, name: (await api.getProject())?.name }
    }
    const r = await window.api.smokeScan!(opts.folders ?? [])
    const summary = {
      dvws: r.pairs.length, videos: r.videos.length, unreadable: r.unreadable.length,
      paired: r.pairs.filter(p => p.video).map(p => `${p.date} ${p.home}-${p.away} -> ${p.video?.split(/[\\/]/).pop()} [${p.note}${p.inLibrary ? ', in library' : ''}]`),
      unpaired: r.pairs.filter(p => !p.video).length,
    }
    if (opts.home === 'scan') { setScan(r); await sleep(400); return summary }
    const sure = r.pairs.filter(p => p.video && p.score >= 3 && !p.inLibrary).map(p => ({ dvwPath: p.dvwPath, video: p.video! }))
    const imported = await api.importPairs(sure)
    const lib = await api.getLibrary()
    setLibrary(lib)
    const codes = ['HTH', 'HTA']
    const ids = lib!.matches.filter(m => m.teams.some(t => codes.includes(t.code))).map(m => m.id)
    const p = await window.api.smokeCreateProject!(opts.newProject!, { name: 'v3 smoke', ourTeamCodes: codes, matchIds: ids })
    await loadProject(p)
    await sleep(400)
    return { ...summary, imported: imported.imported.map(m => m.name), failed: imported.failed, project: { name: p.name, matches: p.matches.map(m => m.name) } }
  }

  // M8 checks. 'relink': reel of 5 clips, the DVW copy gets an extra point and loses one play,
  // reload. 'flush-write': rename and return at once (quit must flush). 'report': reels, notices.
  // 'undo': trims, marker, rename, then Ctrl+Z / Ctrl+Y.
  // A match whose DVW was moved: the bar above the project names it, and pointing the match at
  // the file's new place (as "場所を指定…" does, without the dialog) brings its plays back.
  const smokeRelocate = async (path: string) => {
    const p = (await api.getProject())!
    await loadProject(p); await sleep(300)
    const id = Object.keys(p.missing)[0]
    const bar = document.querySelector('.missing-bar')?.textContent ?? null
    if (!id) return { before: p.missing, bar }
    const r = await api.smokeRelocate!(id, p.missing[id][0], path)
    await loadProject(r.project); await sleep(300)
    return { before: p.missing, bar, note: r.note, after: r.project?.missing, barAfter: !!document.querySelector('.missing-bar'), libraryMissing: r.library.missing, plays: latest.current.results.length }
  }

  const smokeM8 = async (res: PlayRef[], mode: string) => {
    if (mode === 'report') { await sleep(300); return { reels: latest.current.reels.map(r => r.name), notice: latest.current.notice } }
    if (mode === 'flush-write') {
      const r = latest.current.reels.find(x => x.name.startsWith('flush')) ?? latest.current.reels[0]
      const name = `flush ${Date.now()}`
      updateReel({ ...r, name })
      return { renamedTo: name } // returns before the autosave delay; closing must write it
    }
    if (mode === 'relink') {
      const picks = [10, 100, 300, 600, 900].map(i => res[i]).filter(Boolean)
      const built = addClips(newReel('relink smoke'), picks.map(x => ({ matchId: x.matchId, play: x.play }))).reel
      setReels(rs => [...rs, built]); setReelId(built.id)
      await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'relink reel')
      await sleep(SAVE_DELAY_MS + 600)
      const before = Object.values(built.clips).map(c => ({ id: c.id, playId: c.playId, code: picks.find(p => p.play.id === c.playId)!.play.code, time: picks.find(p => p.play.id === c.playId)!.play.time }))
      const edited = await window.api.smokeEditDvw!(picks[0].matchId, picks[4].play.code, picks[4].play.time)
      await loadProject(await api.getProject())
      await waitFor(() => latest.current.reels.some(x => x.id === built.id) || null, 20000, 'reloaded')
      const r = latest.current.reels.find(x => x.id === built.id)!
      const d = latest.current.dvwsRef!
      const after = Object.values(r.clips).map(c => ({ id: c.id, playId: c.playId, code: d[c.matchId].plays[c.playId]?.code, time: d[c.matchId].plays[c.playId]?.time }))
      const miss = relink(r, d).missing
      await sleep(SAVE_DELAY_MS + 600)
      const savedReel = (await api.listReels()).find(x => x.id === built.id)!
      return { edited, before, after, missing: [...miss].map(id => before.findIndex(b => b.id === id)), savedPlayIds: Object.values(savedReel.clips).map(c => c.playId) }
    }
    // undo
    const r0 = addClips(newReel('undo smoke'), [res[20]].map(x => ({ matchId: x.matchId, play: x.play })))
    setReels(rs => [...rs, r0.reel]); setReelId(r0.reel.id)
    await waitFor(() => latest.current.reel?.id === r0.reel.id || null, 20000, 'undo reel')
    const id = r0.ids[0]
    const info = () => latest.current.clipInfo(latest.current.reel!.clips[id])
    const snap = () => ({ in: +info().range!.in.toFixed(2), group: groupOf(latest.current.reel!, id), name: latest.current.reel!.name })
    const states = [snap()]
    for (let k = 1; k <= 5; k++) { updateReel(trimClip(latest.current.reel!, id, 'in', info().range!.in + 0.2, info().range!, info().def!)); await sleep(30) } // one drag
    await sleep(700); states.push(snap())
    updateReel(toggleMarker(latest.current.reel!, id, 3)); await sleep(700); states.push(snap())
    updateReel({ ...latest.current.reel!, name: 'undo renamed' }); await sleep(700); states.push(snap())
    const key = async (k: string, shift = false) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift, bubbles: true })); await sleep(120) }
    const undone: unknown[] = []
    for (let k = 0; k < 4; k++) { await key('z'); undone.push(snap()) }
    const redone: unknown[] = []
    await key('y'); redone.push(snap())
    await key('z', true); redone.push(snap())
    return { states, undone, redone }
  }

  // Export: three clips in two marker groups with title cards, a whole-clip and a timed annotation
  // on the first clip. Measures UI response while encoding, then cancels a second run.
  const smokeExport = async (res: PlayRef[], outPath: string) => {
    const picks = [res.find(x => x.play.skill === 'S' && x.play.effect === '#'), res.find(x => x.play.skill === 'R' && x.play.effect === '#'), res.find(x => x.play.skill === 'B' && x.play.effect === '#')]
      .filter((x): x is PlayRef => !!x)
    let r = addClips(newReel('export smoke'), picks.map(x => ({ matchId: x.matchId, play: x.play }))).reel
    const ids = r.groups.none.slice()
    r = toggleMarker(toggleMarker(toggleMarker(r, ids[0], 1), ids[1], 1), ids[2], 2)
    r = { ...r, markerNames: { ...r.markerNames, 1: 'Serve and pass', 2: 'Blocks' },
      overlay: { ...overlaySettings(undefined), titleCard: { enabled: true, durationSec: 1.5, showMarkerName: true, showMatch: true } } }
    smokeUse(r)
    await waitFor(() => latest.current.reel?.id === r.id && latest.current.order.length === 3 ? true : null, 20000, 'export reel')
    const c0 = latest.current.reel!.clips[ids[0]], r0 = latest.current.clipInfo(c0).range!
    const anns: Annotation[] = [
      { id: 'whole', kind: 'rect', color: '#FACC15', x: 0.4, y: 0.45, w: 0.2, h: 0.2, width: 6 },
      { id: 'timed', kind: 'text', color: '#22C55E', x: 0.62, y: 0.3, text: 'TIMED', size: 52, showFrom: r0.in + 1, showTo: r0.in + 3 },
    ]
    updateReel(setAnnotations(latest.current.reel!, ids[0], anns))
    await waitFor(() => latest.current.reel!.clips[ids[0]].annotations.length === 2 ? true : null, 5000, 'annotations')

    const wait = (pred: () => boolean, ms: number, label: string) => waitFor(() => (pred() ? true : null), ms, label)
    const t0 = performance.now()
    const job = await startExport(outPath)
    if (!job) throw new Error('export did not start')
    // UI response while ffmpeg runs: an IPC round trip and a frame.
    await wait(() => latest.current.exportState?.status === 'running', 20000, 'export running')
    const ipcSamples: number[] = []
    for (let k = 0; k < 6; k++) { const q = performance.now(); await api.getProject(); ipcSamples.push(Math.round(performance.now() - q)); await sleep(400) }
    const ipc0 = performance.now(); await api.parseMatch(picks[0].matchId); const ipcMs = Math.round(performance.now() - ipc0)
    const raf0 = performance.now(); await new Promise(ok => requestAnimationFrame(() => ok(null))); const frameMs = Math.round(performance.now() - raf0)
    await wait(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? ''), 180000, 'export done')
    const done = { ...latest.current.exportState, wallMs: Math.round(performance.now() - t0) }

    // Output timeline for frame checks.
    const starts: number[] = []
    let acc = 0
    for (const it of job.items) { starts.push(acc); acc += it.kind === 'clip' ? it.out - it.in : it.durationSec }
    const clip0At = starts[1]
    const checks = [
      { name: 'card1', t: 0.7 },
      { name: 'clip1-before-timed', t: clip0At + 0.5 },
      { name: 'clip1-timed', t: clip0At + 2 },
      { name: 'card2', t: starts[3] + 0.7 },
    ]

    // Cancel: start a second export and stop it after ~1.5s.
    const cancelPath = outPath.replace(/\.mp4$/, '-cancelled.mp4')
    await startExport(cancelPath)
    await wait(() => latest.current.exportState?.status === 'running', 20000, 'second export running')
    await sleep(1500)
    await api.cancelExport()
    await wait(() => latest.current.exportState?.status === 'cancelled', 20000, 'cancelled')
    await sleep(800)
    return {
      items: job.items.map(it => it.kind === 'clip' ? `clip ${(it.out - it.in).toFixed(2)}s layers=${it.layers.map(l => l.from === undefined ? 'whole' : `${l.from.toFixed(1)}-${l.to!.toFixed(1)}`).join(',')} png=${it.layers.map(l => l.png.length).join('/')}` : `card ${it.durationSec}s png=${it.png.length}`),
      size: `${job.width}x${job.height}@${job.fpsStr}`, expectedSec: +acc.toFixed(3), done, ipcMs, ipcSamples, frameMs,
      export: outPath, checks, cancelPath, cancelState: latest.current.exportState?.status,
    }
  }

  // Automatic overlays: three clips (markers 1, 1, 2), pixels where the scoreboard and caption
  // should be, a per-clip hide and caption rewrite, theme switch, then a through-play with title
  // cards. ov = 'dialog' leaves the settings dialog open for the screenshot.
  const smokeOverlay = async (res: PlayRef[], mode: string) => {
    const picks = [res.find(x => x.play.skill === 'S' && x.play.effect === '#'), res.find(x => x.play.skill === 'A' && x.play.effect === '#'), res.find(x => x.play.skill === 'R' && x.play.effect === '#')]
      .filter((x): x is PlayRef => !!x)
    let r = addClips(newReel('overlay smoke'), picks.map(x => ({ matchId: x.matchId, play: x.play }))).reel
    const ids = r.groups.none.slice()
    r = toggleMarker(toggleMarker(toggleMarker(r, ids[0], 1), ids[1], 1), ids[2], 2)
    r = { ...r, markerNames: { ...r.markerNames, 1: 'Big serves', 2: 'Perfect passes' },
      overlay: { ...overlaySettings(undefined), theme: { base: '#0B1F3A', accent: '#C9A227' }, titleCard: { enabled: true, durationSec: 1.5, showMarkerName: true, showMatch: true } } }
    smokeUse(r)
    await waitFor(() => latest.current.reel?.id === r.id || null, 20000, 'overlay reel')
    activateClip(latest.current.reel!.clips[ids[0]])
    await waitFor(() => playback.attachedKey === picks[0].matchId && playback.current.ready ? true : null, 20000, 'video')
    const range = latest.current.clipInfo(latest.current.reel!.clips[ids[0]]).range!
    await playback.seekAndWait(range.in + 1)
    await sleep(300)
    const alphaAt = (fx: number, fy: number) => {
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=overlay-canvas]')!
      return c.getContext('2d')!.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data[3]
    }
    // Scoreboard: top centre, ~4% down. Caption: bottom left, ~6% from the left, ~93% down.
    const shown = { scoreboard: alphaAt(0.5, 0.045), caption: alphaAt(0.06, 0.93) }
    const data = latest.current.overlayData!(latest.current.reel!.clips[ids[0]])

    updateReel(setOverlayOverride(latest.current.reel!, ids[0], { scoreboard: { hidden: true }, playerCaption: { line: 'what a serve' } }))
    await sleep(300)
    const hidden = { scoreboard: alphaAt(0.5, 0.045), caption: alphaAt(0.06, 0.93) }
    const rewritten = latest.current.overlayData!(latest.current.reel!.clips[ids[0]])?.caption.line
    setOverlay({ ...latest.current.overlay, theme: { base: '#111111', accent: '#C8102E' } })
    await sleep(200)
    const theme = latest.current.overlay.theme

    if (mode === 'dialog') { updateReel(setOverlayOverride(latest.current.reel!, ids[0], undefined)); await sleep(200); setOverlayOpen(true); await sleep(500); return { shown, hidden, rewritten, theme, data } }

    const t0 = performance.now()
    const timeline: { kind: string; at: number }[] = []
    let lastCard: unknown = null, lastIdx = -1
    const unsub = playback.subscribe(s => {
      if (s.card !== lastCard) { lastCard = s.card; if (s.card) timeline.push({ kind: `card ${s.card.marker} ${s.card.name} / ${s.card.match}`, at: Math.round(performance.now() - t0) }) }
      if (s.seq && s.seq.index !== lastIdx) { lastIdx = s.seq.index; if (!s.card) timeline.push({ kind: `clip (item ${s.seq.index})`, at: Math.round(performance.now() - t0) }) }
    })
    playThrough('video', 0)
    await waitFor(() => (playback.current.seq === null && timeline.length ? true : null), 120000, 'through-play')
    unsub()
    // Screenshot on the first title card.
    playThrough('video', 0); await sleep(600)
    return { shown, hidden, rewritten, theme, data, timeline, totalMs: Math.round(performance.now() - t0) }
  }

  // Annotations through real pointer/key events on the overlay canvas: draw four kinds, move one,
  // give the arrow a show-from time, and read canvas pixels on either side of it.
  // Ctrl+C on one of a grouped pair copies the pair (not the circle beside it); Ctrl+V on the same clip steps off the
  // originals, on another clip lands in place with the show time moved to that clip's IN.
  // Player photos (add-on packs): a pack read in, the play's player found in it and put on the clip
  // by a click; a photo set for a player the pack has none for, then taken off with ↺.
  const smokePhotos = async (res: PlayRef[], packFile: string) => {
    const packs = await api.smokeImportPack!(packFile)
    await refreshPacks()
    const inPack = (x: PlayRef) => {
      const d = latest.current.dvwsRef![x.matchId], pl = d.players[`${x.play.side}${x.play.jersey}`]
      return !!pl && !!findPhoto(packs, pl, d.teams[x.play.side === '*' ? 0 : 1].code)
    }
    const r = res.find(x => x.play.rallyId !== null && inPack(x))
    if (!r) throw new Error('no play by a player in the pack')
    const { reel: built, ids } = addClips(newReel('photo smoke'), [{ matchId: r.matchId, play: r.play }])
    setReels(rs => [...rs, built]); setReelId(built.id)
    await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'photo reel')
    activateClip(built.clips[ids[0]]); await sleep(400)
    const panel = await waitFor(() => document.querySelector<HTMLElement>('[data-accordion="player-photos"]'), 10000, 'photo panel')
    if (!panel.classList.contains('open')) { panel.querySelector<HTMLButtonElement>('.accordion-head')!.click(); await sleep(200) }
    const focus = await waitFor(() => panel.querySelector<HTMLButtonElement>('.photo-focus .photo-pick'), 10000, 'focused player photo')
    const focusName = focus.querySelector('.photo-name')?.textContent
    const tiles = () => ({ photos: panel.querySelectorAll('.photo-team .photo-pick').length, none: panel.querySelectorAll('.photo-team .photo-none').length, mine: panel.querySelectorAll('.photo-team .photo-pick.mine').length })
    const before = tiles()
    focus.click()
    const image = await waitFor(() => latest.current.reel!.clips[ids[0]].annotations.find(a => a.kind === 'image') ?? null, 10000, 'inserted photo') as { w: number; h: number }

    // A player with no photo: one set for them (the file dialog is skipped), then removed by ↺.
    const d = latest.current.dvwsRef![r.matchId], side = r.play.side, i = side === '*' ? 0 : 1
    const bare = Object.values(d.players).find(p => p.side === side && !findPhoto(packs, p, d.teams[i].code))!
    const tg = { key: bare.key, team: d.teams[i].code, jersey: bare.jersey, lastName: bare.lastName, firstName: bare.firstName }
    await api.smokeSetPhoto!(tg, 'build/icon.png')
    await refreshPacks(); await sleep(300)
    const afterSet = tiles()
    await api.smokeShot!('photos.png')
    const revert = panel.querySelector<HTMLButtonElement>('.photo-team .photo-cell .photo-edits .photo-edit:nth-child(2)')
    revert?.click()
    await waitFor(() => tiles().mine === 0 || null, 10000, 'photo removed')
    return { pack: packs.map(p => `${p.id}:${p.players.length}`), focusName, before, image: { w: +image.w.toFixed(3), h: +image.h.toFixed(3) }, setFor: `#${bare.jersey} ${bare.lastName}`, afterSet, afterRevert: tiles() }
  }

  // The video maximized: M fills the screen with the video (bigger box, the other bars hidden), Esc
  // leaves it without stopping a through-play; the scene's ⛶ plays it maximized and leaves when it ends.
  const smokeMaximize = async (res: PlayRef[]) => {
    const { reel: added } = addClips(newReel('max smoke'), res.slice(0, 2).map(r => ({ matchId: r.matchId, play: r.play })))
    const built = { ...added, scope: 'all' as const }
    setReels(rs => [...rs, built]); setReelId(built.id)
    await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'max reel')
    const box = () => document.querySelector<HTMLElement>('.video-box')!.getBoundingClientRect().width
    const shown = (sel: string) => !!document.querySelector<HTMLElement>(sel)?.offsetParent
    const full = () => document.fullscreenElement?.classList.contains('stage') ?? false
    const before = box()
    await api.smokeKey!('M')
    await waitFor(() => (full() && box() > before) || null, 5000, 'maximized by M')
    await sleep(300)
    const maxed = { boxBefore: Math.round(before), boxAfter: Math.round(box()), courtBarHidden: !shown('.court-bar'), transport: shown('.transport') }
    await api.smokeShot!('maximized.png')
    playThrough('scene', 0)
    await waitFor(() => playback.current.seq || null, 10000, 'playing')
    await api.smokeKey!('Escape')
    await waitFor(() => !full() || null, 5000, 'Esc leaves it')
    await sleep(300)
    const escKeepsPlaying = !!playback.current.seq
    playback.stopSequence(); await sleep(300)
    const btn = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.reel-controls button')].find(b => b.getAttribute('aria-label') === t('最大化して再生')) ?? null, 5000, 'play maximized button')
    const r = btn.getBoundingClientRect()
    await api.smokeDrag!([[r.left + r.width / 2, r.top + r.height / 2]])
    await waitFor(() => (full() && playback.current.seq) || null, 10000, 'playing maximized')
    await sleep(1500)
    await api.smokeShot!('maximized-playing.png')
    const t0 = Date.now()
    await waitFor(() => (!playback.current.seq && !full()) || null, 90000, 'back after the play ends')
    return { maximize: { ...maxed, escKeepsPlaying, leftAfterSec: +((Date.now() - t0) / 1000).toFixed(1), clips: Object.keys(built.clips).length } }
  }

  // Which way plays go on screen: unknown before the court is fitted, then the 向き buttons in the
  // filters split the plays into up and down, and the list's rows show the arrows.
  const smokeDirection = async () => {
    const p0 = await api.getProject()
    const m = p0!.matches[0]
    const beforeKnown = latest.current.results.filter(r => r.dir).length
    await api.setMatchCourt(m.id, { corners: [{ x: 0.36, y: 0.28 }, { x: 0.64, y: 0.28 }, { x: 0.14, y: 0.9 }, { x: 0.86, y: 0.9 }], nearSet1: '*' })
    await loadProject(await api.getProject())
    setFilter(EMPTY_FILTER)
    await waitFor(() => latest.current.results.some(r => r.dir) || null, 20000, 'directions known')
    const all = latest.current.results.length, sets = latest.current.results.filter(r => r.play.skill === 'E').length
    const press = async (label: string) => {
      const b = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.filters button[role=radio]')].find(x => x.textContent === label) ?? null, 5000, label)
      b.click(); await sleep(400)
      return latest.current.results
    }
    const up = await press(t('↑ 下から上')), upCount = up.length, upSkills = [...new Set(up.map(r => r.play.skill))].sort().join('')
    const arrowsUp = [...document.querySelectorAll('.play-row .dir')].map(e => e.textContent)
    const hint = !!document.querySelector('.filters .hint')
    await api.smokeShot!('direction-up.png')
    const down = await press(t('↓ 上から下')), downCount = down.length
    const allUp = up.every(r => r.dir === 'up'), allDown = down.every(r => r.dir === 'down')
    const other = all - upCount - downCount - sets // plays neither up nor down that aren't sets: none once the court is fitted
    await press(t('すべて'))
    return { direction: { beforeKnown, all, up: upCount, down: downCount, sets, other, setArrows: [...document.querySelectorAll('.play-row .skill-E .dir')].length, allUp, allDown, upSkills, arrowsShown: arrowsUp.length, arrowsAllUp: arrowsUp.every(a => a === '↑'), hint } }
  }

  // Slow and hold: the trim bar's ＋ スロー at IN+1 s and ＋ 停止 at IN+3 s; the loop plays the stretch at
  // half speed and stops on the hold for its seconds; the export is as long as the clip played.
  const smokeSlowHold = async (res: PlayRef[], exportTo?: string) => {
    const r = res[0]
    const { reel: added, ids } = addClips(newReel('slow smoke'), [{ matchId: r.matchId, play: r.play }])
    const built = { ...added, scope: 'all' as const }
    const v = newVideo('slow smoke', [built.id])
    setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
    await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'slow reel')
    const clip = () => latest.current.reel!.clips[ids[0]]
    activateClip(clip()); await sleep(800)
    const range = latest.current.clipInfo(clip()).range!
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.trim-timing button')].find(b => b.textContent === label)!
    playback.pause(); await playback.seekAndWait(range.in + 1)
    button(t('＋ スロー')).click(); await sleep(300)
    await playback.seekAndWait(range.in + 3)
    button(t('＋ 停止')).click(); await sleep(300)
    const timing = clip().timing
    if (!timing?.slows?.length || !timing.holds?.length) throw new Error('slow or hold not added: ' + JSON.stringify(timing))
    // An object shown across the hold.
    const hold = timing.holds[0].at
    updateReel(setAnnotations(latest.current.reel!, ids[0], [{ id: 'held', kind: 'text', color: '#FFFFFF', x: 0.1, y: 0.1, text: 'HOLD', size: 36, showFrom: hold - 0.3, showTo: hold + 0.3 }]))
    await sleep(300)
    const video = document.querySelector<HTMLVideoElement>('video')!
    await playback.seekAndWait(range.in); playback.toggle()
    const slowRate = await waitFor(() => (playback.current.time > timing.slows![0].from + 0.2 && playback.current.time < timing.slows![0].to ? video.playbackRate : null), 10000, 'in the slow stretch')
    await waitFor(() => (playback.current.paused && Math.abs(playback.current.time - hold) < 0.1) || null, 15000, 'stopped on the hold')
    const t0 = Date.now()
    await waitFor(() => !playback.current.paused || null, 10000, 'playing again after the hold')
    const heldSec = +((Date.now() - t0) / 1000).toFixed(2)
    const rateAfter = video.playbackRate
    playback.pause()
    await api.smokeShot!('slow-hold.png')
    let exported: unknown = null
    if (exportTo) {
      const job = await startExport(exportTo, { plan: currentPlan('scene'), name: 'slow smoke' })
      if (!job) throw new Error('export did not start')
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'slow export done')
      const item = job.items.find(i => i.kind === 'clip')
      exported = { state: latest.current.exportState?.status, message: latest.current.exportState?.message, layers: item && item.kind === 'clip' ? item.layers.map(l => [l.from ?? null, l.to ?? null]) : null }
    }
    return { slowHold: { range: [range.in, range.out], timing, slowRate, heldSec, rateAfter, playedSec: clipPlayedSec(range, timing), exported } }
  }

  // The caption's name for a player across the video: typed on one clip (whole video, the default),
  // it shows on the player's other clip and not on another player's; 'this clip only' changes one.
  const smokeCaptionNames = async (res: PlayRef[]) => {
    const byKey = new Map<string, PlayRef[]>()
    for (const r of res) byKey.set(r.play.playerKey, [...(byKey.get(r.play.playerKey) ?? []), r])
    const twice = [...byKey.values()].find(l => l.length >= 2)
    const other = res.find(r => r.play.playerKey !== twice?.[0].play.playerKey)
    if (!twice || !other) throw new Error('no player with two plays')
    const { reel: added, ids } = addClips(newReel('names smoke'), [twice[0], twice[1], other].map(r => ({ matchId: r.matchId, play: r.play })))
    const built = { ...added, scope: 'all' as const }
    const v = newVideo('names smoke', [built.id])
    setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
    await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'names reel')
    const clip = (i: number) => latest.current.reel!.clips[ids[i]]
    const nameOn = (i: number) => latest.current.overlayData!(clip(i))?.caption.name ?? null
    const type = async (text: string) => {
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('.clip-overlay input.ov-text'), 5000, 'name field')
      input.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(50)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(300)
      input.blur(); await sleep(200)
    }
    const before = [nameOn(0), nameOn(1), nameOn(2)]
    activateClip(clip(0)); await sleep(500)
    const scopeDefault = document.querySelector<HTMLSelectElement>('.clip-overlay select[aria-label="' + t('名前を使う範囲') + '"]')?.value
    await type('Whole Video Name')
    await waitFor(() => nameOn(1) === 'Whole Video Name' || null, 5000, 'name on the other clip')
    const afterVideo = [nameOn(0), nameOn(1), nameOn(2)], saved = latest.current.video?.captionNames
    activateClip(clip(1)); await sleep(500)
    const sel = await waitFor(() => document.querySelector<HTMLSelectElement>('.clip-overlay select[aria-label="' + t('名前を使う範囲') + '"]'), 5000, 'scope select')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'clip')
    sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(200)
    await type('Only Here')
    await waitFor(() => nameOn(1) === 'Only Here' || null, 5000, 'clip-only name')
    const afterClip = [nameOn(0), nameOn(1), nameOn(2)]
    await sleep(400)
    await api.smokeShot!('caption-names.png')
    return { captionNames: { player: twice[0].name, other: other.name, before, scopeDefault, afterVideo, saved, afterClip } }
  }

  // The caption's photo: off by default; on, a play whose player has a photo shows it above a
  // bottom-left caption and below a top-left one (read from the overlay canvas), and the export's
  // layer has it too.
  const smokeCaptionPhoto = async (res: PlayRef[], exportTo?: string) => {
    await refreshPacks()
    const packs = await api.listPacks()
    const dvws = latest.current.dvwsRef!
    const r = res.find(x => captionPhoto(packs, dvws[x.matchId], x.play))
    if (!r) throw new Error('no play whose player has a photo')
    const { reel: added, ids } = addClips(newReel('photo smoke'), [{ matchId: r.matchId, play: r.play }])
    const built = { ...added, scope: 'all' as const } // the clip has no marker
    const v = newVideo('photo smoke', [built.id])
    setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
    await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'photo reel')
    const byDefault = latest.current.overlay.playerCaption.photo
    activateClip(built.clips[ids[0]]); await sleep(600)
    const canvas = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=overlay-canvas]'), 10000, 'overlay canvas')
    // The middle of where the photo goes: the caption's left side, above it (bottom) or below it (top).
    const photoAt = (bottom: boolean, W: number, H: number) => {
      const k = H / 720, m = H * 0.025, h = 56 * k, ph = 132 * k, pw = ph * 0.8
      return { x: m + pw / 2, y: bottom ? H - m - h - 6 * k - ph / 2 : m + h + 6 * k + ph / 2 }
    }
    const alpha = (bottom: boolean) => {
      const { x, y } = photoAt(bottom, canvas.width, canvas.height)
      return canvas.getContext('2d')!.getImageData(Math.round(x), Math.round(y), 1, 1).data[3]
    }
    const offBottom = alpha(true)
    const cap = (o: Partial<OverlaySettings['playerCaption']>) => setOverlay({ ...latest.current.overlay, playerCaption: { ...latest.current.overlay.playerCaption, ...o } })
    cap({ photo: true, anchor: 'bl' })
    const onBottom = await waitFor(() => alpha(true) || null, 10000, 'photo above the caption')
    await api.smokeShot!('caption-photo-bl.png')
    cap({ anchor: 'tl' })
    const onTop = await waitFor(() => alpha(false) || null, 10000, 'photo below the caption')
    const topLeavesBottom = alpha(true)
    await api.smokeShot!('caption-photo-tl.png')
    cap({ anchor: 'bl' }); await sleep(300)
    let exported: unknown = null
    if (exportTo) {
      const job = await startExport(exportTo, { plan: currentPlan('scene'), name: 'photo smoke' })
      if (!job) throw new Error('export did not start')
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'photo export done')
      const clip = job.items.find(i => i.kind === 'clip')
      const layer = clip && clip.kind === 'clip' ? clip.layers[0] : null
      const bmp = layer ? await createImageBitmap(new Blob([layer.png as BlobPart])) : null
      let layerAlpha = 0
      if (bmp) {
        const off = new OffscreenCanvas(bmp.width, bmp.height), g = off.getContext('2d')!
        g.drawImage(bmp, 0, 0)
        const { x, y } = photoAt(true, bmp.width, bmp.height)
        layerAlpha = g.getImageData(Math.round(x), Math.round(y), 1, 1).data[3]
      }
      exported = { state: latest.current.exportState?.status, layerAlpha }
    }
    return { captionPhoto: { player: `#${r.play.jersey} ${r.name}`, byDefault, offBottom, onBottom, onTop, topLeavesBottom, exported } }
  }

  // Saved conditions, through the row at the top of the filters: saved under a name, cleared and put
  // back with its chip, saved again under the same name (replaced), removed with a right-click, and
  // the removal undone with Ctrl+Z. Each step is checked in project.json through the main process.
  const smokeSavedFilters = async (want: PlayFilter, shown: number) => {
    const name = 'smoke 条件'
    const row = () => [...document.querySelectorAll<HTMLElement>('.filters .filter-row')].find(r => r.textContent?.startsWith(t('保存条件'))) ?? null
    const chip = () => [...(row()?.querySelectorAll<HTMLButtonElement>('.chip') ?? [])].find(b => b.textContent === name) ?? null
    const savedNow = async () => (await api.getProject())?.settings.filters ?? []
    const until = async <T,>(get: () => Promise<T | null>, label: string): Promise<T> => {
      for (const end = Date.now() + 10000; ;) { const v = await get(); if (v) return v; if (Date.now() > end) throw new Error(`timeout waiting for ${label}`); await sleep(100) }
    }
    const saveAs = async () => {
      const add = await waitFor(() => [...(row()?.querySelectorAll<HTMLButtonElement>('.chip') ?? [])].find(b => b.textContent === t('＋ 今の条件を保存')) ?? null, 10000, 'save button')
      add.click()
      const input = await waitFor(() => row()?.querySelector<HTMLInputElement>('input.saved-filter-name') ?? null, 5000, 'name field')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, name)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
    for (const old of await savedNow()) if (old.name === name) throw new Error('left from an earlier run: use a fresh project')
    await saveAs()
    const first = await until(async () => (await savedNow()).find(s => s.name === name && sameFilter(s.filter, want)) ?? null, 'saved in project.json')
    const lit = await waitFor(() => chip()?.classList.contains('on') || null, 5000, 'chip lit after saving')
    setFilter(EMPTY_FILTER)
    await waitFor(() => (sameFilter(latest.current.filter, EMPTY_FILTER) && chip() && !chip()!.classList.contains('on')) || null, 5000, 'cleared')
    chip()!.click()
    await waitFor(() => (sameFilter(latest.current.filter, want) && latest.current.results.length === shown && chip()!.classList.contains('on')) || null, 5000, 'put back')
    await api.smokeShot!('saved-filters.png')
    const more = { ...want, effects: ['#'] }
    setFilter(more)
    await waitFor(() => (sameFilter(latest.current.filter, more) && !chip()!.classList.contains('on')) || null, 5000, 'changed')
    await saveAs()
    const replaced = await until(async () => { const l = await savedNow(); return l.length === 1 && sameFilter(l[0].filter, more) ? l : null }, 'replaced under the same name')
    chip()!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await until(async () => ((await savedNow()).length === 0 ? true : null), 'removed')
    await waitFor(() => (!row() || !chip()) || null, 5000, 'chip gone')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    const undone = await until(async () => { const l = await savedNow(); return l.length === 1 && l[0].id === first.id ? l : null }, 'removal undone')
    return { savedFilters: { lit, shown, replacedId: replaced[0].id === first.id, undone: undone[0].name } }
  }

  // Court grid: fitted from its bar, one corner dragged on the canvas, saved with the match; the
  // near side swapped; an attack's start and end zones lit.
  const smokeCourt = async (res: PlayRef[], exportTo?: string) => {
    const r = res.find(x => x.play.skill === 'A' && x.play.startZone && x.play.endZone) ?? res.find(x => x.play.startZone && x.play.endZone)
    if (!r) throw new Error('no play with start and end zones')
    jump(r)
    const bar = await waitFor(() => document.querySelector<HTMLElement>('.court-bar'), 20000, 'court bar')
    const button = (label: string) => [...bar.querySelectorAll('button')].find(b => b.textContent === label) ?? null
    const until = async <T,>(get: () => Promise<T | null>, ms: number, label: string): Promise<T> => {
      for (const end = Date.now() + ms; ;) { const v = await get(); if (v) return v; if (Date.now() > end) throw new Error(`timeout waiting for ${label}`); await sleep(100) }
    }
    const savedCourt = async () => (await api.getProject())?.matches.find(m => m.id === r.matchId)?.court ?? null
    if (await savedCourt()) { // left from an earlier run: removed through the gear menu first
      bar.querySelector<HTMLButtonElement>('.ov-gear')!.click(); await sleep(100)
      button(t('この試合のグリッドを消す'))!.click()
      await until(async () => (await savedCourt()) ? null : true, 10000, 'old fit removed')
    }
    ;(await waitFor(() => button(t('グリッドを合わせる')), 10000, 'fit button')).click()
    const canvas = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=court-canvas]'), 10000, 'court canvas')
    const box = canvas.getBoundingClientRect()
    const pt = (x: number, y: number) => ({ clientX: box.left + x * box.width, clientY: box.top + y * box.height, bubbles: true, pointerId: 1 })
    const from = (await until(savedCourt, 10000, 'first fit')).corners[0], to = { x: 0.3, y: 0.3 }
    canvas.dispatchEvent(new PointerEvent('pointerdown', pt(from.x, from.y))); await sleep(30)
    for (const f of [0.3, 0.6, 1]) { canvas.dispatchEvent(new PointerEvent('pointermove', pt(from.x + (to.x - from.x) * f, from.y + (to.y - from.y) * f))); await sleep(20) }
    canvas.dispatchEvent(new PointerEvent('pointerup', pt(to.x, to.y))); await sleep(100)
    const fitted = await until(async () => { const c = await savedCourt(); return c && Math.abs(c.corners[0].x - to.x) < 0.01 && Math.abs(c.corners[0].y - to.y) < 0.01 ? c : null }, 10000, 'dragged corner saved')
    const handlesOnTop = getComputedStyle(canvas).pointerEvents
    button(t('完了'))!.click(); await sleep(150)
    const afterDone = getComputedStyle(document.querySelector<HTMLCanvasElement>('[data-testid=court-canvas]')!).pointerEvents
    const setSelect = (label: string, value: string) => {
      const el = bar.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    await sleep(150)
    const zones1 = playZones(r.play, fitted)
    await api.smokeShot!('court.png')
    setSelect(t('手前（第1セット）'), fitted.nearSet1 === '*' ? 'a' : '*')
    const swapped = await until(async () => { const c = await savedCourt(); return c && c.nearSet1 !== fitted.nearSet1 ? c : null }, 10000, 'near side saved')
    // Sub-zones, on the set before the attack: from where it was set to where the attack started.
    setSelect(t('ゾーンの細かさ'), 'sub'); await sleep(150)
    const setRef = res.find(x => x.matchId === r.matchId && x.play.id === r.play.id - 1 && x.play.skill === 'E')
    if (setRef) { jump(setRef); await sleep(500) }
    const dvwPlays = latest.current.dvwsRef![r.matchId].plays
    const setZones = setRef ? playZones(setRef.play, swapped, dvwPlays[setRef.play.id + 1]) : null
    await api.smokeShot!('court-sub.png')
    const detail = JSON.parse(localStorage.getItem('vr.courtGrid') ?? '{}').detail

    // A heatmap-like picture on the clip, laid on the near half through the format panel's select,
    // one corner dragged, then drawn the way the export draws it.
    const { reel: built, ids } = addClips(newReel('court smoke'), [{ matchId: r.matchId, play: r.play }])
    setReels(rs => [...rs, built]); setReelId(built.id)
    await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'court reel')
    activateClip(built.clips[ids[0]]); await sleep(400)
    const pic = document.createElement('canvas'); pic.width = 300; pic.height = 300
    const g = pic.getContext('2d')!
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { g.fillStyle = `hsl(${(i * 3 + j) * 30}, 90%, 50%)`; g.fillRect(j * 100, i * 100, 100, 100) }
    const assetId = await api.saveAsset(new Uint8Array(await (await new Promise<Blob>(ok => pic.toBlob(b => ok(b!), 'image/png'))).arrayBuffer()))
    setAnns([{ id: 'heat', kind: 'image', color: '#FFFFFF', x: 0.35, y: 0.3, w: 0.3, h: 0.3, assetId }])
    setSelectedAnn('heat'); await sleep(400)
    const persp = await waitFor(() => document.querySelector<HTMLSelectElement>('select.persp'), 10000, 'perspective select')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(persp, 'near')
    persp.dispatchEvent(new Event('change', { bubbles: true }))
    const heat = () => latest.current.reel!.clips[ids[0]].annotations.find(a => a.id === 'heat') as Extract<Annotation, { kind: 'image' }> | undefined
    const laid = await waitFor(() => heat()?.quad ?? null, 10000, 'laid on the court')
    const want = courtQuad(swapped.corners, 'near')
    const onCourt = laid.every((p, i) => Math.abs(p[0] - want[i][0]) < 1e-3 && Math.abs(p[1] - want[i][1]) < 1e-3)
    const annCanvas = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]'), 10000, 'ann canvas')
    const ab = annCanvas.getBoundingClientRect()
    const apt = (x: number, y: number) => ({ clientX: ab.left + x * ab.width, clientY: ab.top + y * ab.height, bubbles: true, pointerId: 1 })
    const [qx, qy] = laid[1]
    annCanvas.dispatchEvent(new PointerEvent('pointerdown', apt(qx, qy))); await sleep(30)
    annCanvas.dispatchEvent(new PointerEvent('pointermove', apt(qx + 0.02, qy - 0.02))); await sleep(30)
    annCanvas.dispatchEvent(new PointerEvent('pointerup', apt(qx + 0.02, qy - 0.02))); await sleep(200)
    const dragged = heat()!.quad!
    // The transparency slider with the real mouse and keys: a drag, a click, then → (moves the
    // slider, not the video) and ↓ (stays on the slider, not the next play).
    const opacity = () => heat()?.opacity ?? 1
    const slider = () => [...document.querySelectorAll<HTMLInputElement>('.ann-tools input[type=range]')].find(i => i.getAttribute('aria-label') === t('透明度'))!
    const sr = slider().getBoundingClientRect(), sy = sr.top + sr.height / 2
    await api.smokeDrag!([[sr.left + 4, sy], [sr.left + sr.width * 0.25, sy], [sr.left + sr.width * 0.5, sy]]); await sleep(300)
    const dragged50 = opacity()
    await api.smokeDrag!([[sr.left + sr.width * 0.75, sy]]); await sleep(300)
    const clicked = opacity(), t0 = playback.current.time, play0 = latest.current.selected?.playId
    await api.smokeKey!('Right'); await sleep(150); await api.smokeKey!('Right'); await sleep(150); await api.smokeKey!('Down'); await sleep(300)
    const transparency = { dragged50, clicked, afterKeys: opacity(), videoMoved: +(playback.current.time - t0).toFixed(2), samePlay: latest.current.selected?.playId === play0, stillSelected: latest.current.selectedAnn === 'heat' }
    await api.smokeShot!('court-heatmap.png')
    // As in the export: an offscreen canvas at 1280 × 720.
    const W = 1280, H = 720, off = new OffscreenCanvas(W, H), octx = off.getContext('2d')!
    await waitFor(() => assetImage(assetId), 10000, 'picture loaded')
    drawAnnotation(octx, heat()!, W, H, assetImage)
    const alpha = (x: number, y: number) => octx.getImageData(Math.round(x * W), Math.round(y * H), 1, 1).data[3]
    const mid = dragged.reduce((m, p) => [m[0] + p[0] / 4, m[1] + p[1] / 4], [0, 0])
    const b = heat()!

    // With VR_SMOKE_EXPORT: the scene in a video, "コート（書き出し）" ticked in the clip's row, exported.
    let exported: unknown = null
    if (exportTo) {
      updateReel(toggleMarker(latest.current.reel!, ids[0], 1)) // the scene plays marked clips only
      await waitFor(() => latest.current.order.length === 1 || null, 10000, 'marked clip')
      const v = newVideo('court smoke', [built.id])
      setVideos(vs => [...vs, v]); setVideoId(v.id)
      await waitFor(() => latest.current.video?.id === v.id || null, 10000, 'court video')
      activateClip(latest.current.reel!.clips[ids[0]]); await sleep(400)
      const box = await waitFor(() => [...document.querySelectorAll<HTMLLabelElement>('.clip-overlay label')].find(l => l.textContent?.includes(t('コート（書き出し）')))?.querySelector('input') ?? null, 10000, 'court export box')
      if (!box.checked) box.click()
      await waitFor(() => latest.current.overlay.court.enabled || null, 10000, 'court export on')
      const job = await startExport(exportTo)
      if (!job) throw new Error('court export did not start')
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'court export done')
      const clip = job.items.find(it => it.kind === 'clip')
      exported = { state: latest.current.exportState?.status, path: exportTo, wholeLayer: clip?.kind === 'clip' ? clip.layers.filter(l => l.from === undefined).length : 0 }
    }
    return { play: `${r.play.code} set ${r.play.setNum}`, corner0: fitted.corners[0], handlesOnTop, afterDone, zones: zones1, nearSet1: swapped.nearSet1, zonesSwapped: playZones(r.play, swapped),
      set: setRef ? { code: setRef.play.code, zones: setZones } : null, detail,
      transparency, exported,
      heatmap: { onCourt, corner1Moved: +(dragged[1][0] - qx).toFixed(3), exportInside: alpha(mid[0], mid[1]), exportOutside: alpha(b.x + 0.005, b.y + 0.005) } }
  }

  const smokeCopy = async (res: PlayRef[]) => {
    const [p1, p2] = res.filter(x => x.play.rallyId !== null)
    const { reel: built, ids } = addClips(newReel('copy smoke'), [p1, p2].map(x => ({ matchId: x.matchId, play: x.play })))
    setReels(rs => [...rs, built]); setReelId(built.id)
    await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'copy reel')
    activateClip(built.clips[ids[0]]); await sleep(300)
    const in1 = latest.current.clipInfo(built.clips[ids[0]]).range!.in
    const anns = (i: number) => latest.current.reel!.clips[ids[i]].annotations
    setAnns([
      { id: 'c-rect', kind: 'rect', color: '#EF4444', x: 0.2, y: 0.2, w: 0.1, h: 0.1, width: 4, groupId: 'G', showFrom: in1 + 1 },
      { id: 'c-arrow', kind: 'arrow', color: '#EF4444', x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, width: 4, groupId: 'G' },
      { id: 'c-other', kind: 'circle', color: '#FACC15', x: 0.6, y: 0.6, w: 0.1, h: 0.1, width: 4 },
    ])
    setSelectedAnn('c-rect'); await sleep(300)
    const ctrl = async (k: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true, cancelable: true })); await sleep(300) }
    await ctrl('c')
    const notice = latest.current.notice
    await ctrl('v')
    const same = anns(0)
    const pasted = same.filter(a => !a.id.startsWith('c-'))
    const pr = pasted.find(a => a.kind === 'rect') as { x: number; showFrom?: number; groupId?: string } | undefined
    const selectedPasted = pasted.some(a => a.id === latest.current.selectedAnn)
    activateClip(built.clips[ids[1]]); await sleep(400)
    const in2 = latest.current.clipInfo(built.clips[ids[1]]).range!.in
    await ctrl('v')
    const other = anns(1)
    const or = other.find(a => a.kind === 'rect') as { x: number; showFrom?: number } | undefined

    // F / D: the next / previous clip of the scene (from the second clip: back to the first, and on).
    const keyStep = async (k: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); await sleep(300); return ids.indexOf(latest.current.activeClipId ?? '') }
    const fdSteps = [await keyStep('d'), await keyStep('f'), await keyStep('F')] // 0, 1, then stays at the last

    // A picture copied after the objects (a screenshot) is what Ctrl+V pastes; copying objects again
    // makes Ctrl+V paste objects again.
    await window.api.smokeClipboardImage!('build/icon.png')
    await ctrl('v')
    const image = await waitFor(() => anns(1).find(a => a.kind === 'image') ?? null, 10000, 'pasted image') as { id: string; w: number; h: number }
    const imageSelected = latest.current.selectedAnn === image.id
    setSelectedAnn(anns(1).find(a => a.kind === 'rect')!.id); await sleep(300) // the pasted rect (and its group)
    await ctrl('c')
    const beforeObjects = anns(1).length
    await ctrl('v'); await sleep(300)
    const afterObjects = anns(1).filter(a => a.kind === 'image').length
    const pasteAfterCopy = { added: anns(1).length - beforeObjects, images: afterObjects }

    // Palette tabs and floating (the smoke library's palette): a new tab named 矢印, the rect saved
    // into it, the picture saved under すべて then dragged onto 矢印, the panel floated and docked again.
    const q = <T extends Element>(s: string) => document.querySelector<T>(s)
    const tabs = () => [...document.querySelectorAll('.palette-tab')].map(t => `${t.textContent}${t.classList.contains('on') ? '*' : ''}`)
    const head = q<HTMLButtonElement>('[data-accordion=palette] .accordion-head')!
    if (head.getAttribute('aria-expanded') !== 'true') { head.click(); await sleep(200) }
    q<HTMLButtonElement>('.palette-tab-add')!.click()
    const tabInput = await waitFor(() => q<HTMLInputElement>('.palette-tab-name'), 5000, 'tab name')
    tabInput.value = '矢印'; tabInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400)
    const saveSel = async (id: string) => {
      setSelectedAnn(id); await sleep(300)
      ;[...document.querySelectorAll<HTMLButtonElement>('.palette-body button')].find(b => b.textContent === '選択を保存')!.click(); await sleep(500)
    }
    await saveSel(anns(1).find(a => a.kind === 'rect')!.id)
    const inArrowTab = [...document.querySelectorAll('.palette-item .palette-label')].map(e => e.textContent)
    ;[...document.querySelectorAll<HTMLElement>('.palette-tab')].find(t => t.textContent?.startsWith('すべて'))!.click(); await sleep(200)
    await saveSel(image.id)
    const tabsBefore = tabs()
    // Drag the newest item (the picture, first under すべて) onto the 矢印 tab.
    const dt = new DataTransfer()
    q('.palette-item')!.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const arrowTab = [...document.querySelectorAll<HTMLElement>('.palette-tab')].find(t => t.textContent?.startsWith('矢印'))!
    arrowTab.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
    arrowTab.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); await sleep(500)
    const tabsAfterDrop = tabs()
    ;[...document.querySelectorAll<HTMLButtonElement>('.palette-body button')].find(b => b.textContent === '⧉ 浮かせる')!.click(); await sleep(500)
    const fp = q<HTMLElement>('.floating-panel')
    const floated = fp ? { w: fp.offsetWidth, h: fp.offsetHeight, tabs: tabs(), thumbs: [...fp.querySelectorAll('.palette-thumb.big')].length } : null
    ;[...document.querySelectorAll<HTMLElement>('.floating-panel .palette-tab')].find(t => t.textContent?.startsWith('矢印'))?.click(); await sleep(300)
    await window.api.smokeShot!('palette-float.png')
    ;[...document.querySelectorAll<HTMLButtonElement>('.floating-head button')].find(b => b.textContent === '⧉ 戻す')!.click(); await sleep(300)
    ;[...document.querySelectorAll<HTMLElement>('.palette-tab')].find(t => t.textContent?.startsWith('すべて'))?.click() // leave the tab as it was
    const palette = { inArrowTab, tabsBefore, tabsAfterDrop, floated, docked: !q('.floating-panel') }
    return {
      palette, fdSteps, pastedImage: { w: +image.w.toFixed(3), h: +image.h.toFixed(3), selected: imageSelected }, pasteAfterCopy,
      notice, sameCount: same.length, pastedKinds: pasted.map(a => a.kind).sort(), pastedX: pr?.x, pastedShowFromRel: pr?.showFrom !== undefined ? +(pr.showFrom - in1).toFixed(2) : null,
      newGroup: !!pr?.groupId && pr.groupId !== 'G' && pasted.every(a => a.groupId === pr.groupId), selectedPasted,
      otherCount: other.length, otherX: or?.x, otherShowFromRel: or?.showFrom !== undefined ? +(or.showFrom - in2).toFixed(2) : null,
    }
  }

  const smokeAnn = async (res: PlayRef[]) => {
    const r0 = res.find(x => x.play.rallyId !== null)!
    const { reel: built, ids } = addClips(newReel('annotation smoke'), [{ matchId: r0.matchId, play: r0.play }])
    setReels(rs => [...rs, built]); setReelId(built.id)
    await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'ann reel')
    activateClip(built.clips[ids[0]])
    await waitFor(() => playback.attachedKey === r0.matchId && playback.current.ready ? true : null, 20000, 'video')
    const range = latest.current.clipInfo(built.clips[ids[0]]).range!
    await playback.seekAndWait(range.in + 2)
    const canvas = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]'), 20000, 'canvas')
    const box = canvas.getBoundingClientRect()
    const pt = (x: number, y: number) => ({ clientX: box.left + x * box.width, clientY: box.top + y * box.height, bubbles: true, pointerId: 1 })
    const key = async (k: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await sleep(80) }
    const stroke = async (path: [number, number][]) => {
      canvas.dispatchEvent(new PointerEvent('pointerdown', pt(...path[0]))); await sleep(30)
      for (const p of path.slice(1)) { canvas.dispatchEvent(new PointerEvent('pointermove', pt(...p))); await sleep(20) }
      canvas.dispatchEvent(new PointerEvent('pointerup', pt(...path[path.length - 1]))); await sleep(120)
    }
    const anns = () => latest.current.reel!.clips[ids[0]].annotations

    await key('a'); await stroke([[0.3, 0.3], [0.4, 0.4], [0.5, 0.5]])
    await key('r'); await stroke([[0.8, 0.4], [0.7, 0.3], [0.6, 0.2]])
    document.querySelector<HTMLButtonElement>('[role=radio][title="フリーハンド"]')!.click(); await sleep(80) // freehand has no key
    await stroke([[0.2, 0.6], [0.25, 0.62], [0.3, 0.6], [0.35, 0.65]])
    await key('t'); await stroke([[0.1, 0.8]])
    const input = await waitFor(() => document.querySelector<HTMLTextAreaElement>('.ann-text-input'), 5000, 'text input')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Watch the block')
    input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(50)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(150)
    const drawn = anns().map(a => a.kind)

    await key('v'); await stroke([[0.7, 0.21], [0.72, 0.23], [0.75, 0.26]]) // drag the rect by its top edge
    const rect = anns().find(a => a.kind === 'rect')

    await stroke([[0.4, 0.4]]) // select the arrow
    await playback.seekAndWait(range.in + 3)
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent === 'ここから表示')!
    btn.click(); await sleep(150)
    const arrow = anns().find(a => a.kind === 'arrow')!

    // Pixel on the arrow shaft, with the selection cleared so only the shape is drawn.
    await key('Escape'); setSelectedAnn(null); setAnnTool('select')
    const pixel = async (t: number) => {
      await playback.seekAndWait(t); await sleep(250)
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]')!
      const g = c.getContext('2d')!
      const d = g.getImageData(Math.round(c.width * 0.4), Math.round(c.height * 0.4), 1, 1).data
      return d[3]
    }
    // While editing, hidden annotations are drawn faint (alpha 0.3) so they can still be picked.
    const alphaBefore = await pixel(range.in + 1)
    const alphaAfter = await pixel(range.in + 4)
    await sleep(700)
    const saved = (await api.listReels()).find(x => x.id === built.id)
    return {
      drawn, rect, arrowShowFromRel: arrow.showFrom !== undefined ? +(arrow.showFrom - range.in).toFixed(2) : null,
      alphaBefore, alphaAfter, savedAnnotations: saved?.clips[ids[0]].annotations.length ?? 0,
      text: anns().find(a => a.kind === 'text'),
    }
  }

  // Trimming: two plays of one rally (must warn as overlapping) plus one more; the first loops
  // twice, then [ and ] at known playheads set IN/OUT, then the reel default switches mode.
  const smokeTrim = async (res: PlayRef[]) => {
    const r0 = res.find(x => x.play.rallyId !== null && res.some(y => y !== x && y.matchId === x.matchId && y.play.rallyId === x.play.rallyId))
    if (!r0) throw new Error('no rally with two plays in the results')
    const r1 = res.find(y => y !== r0 && y.matchId === r0.matchId && y.play.rallyId === r0.play.rallyId)!
    const r2 = res.find(y => y.matchId === r0.matchId && y.play.rallyId !== null && y.play.rallyId > r0.play.rallyId! + 2)!
    const { reel: built, ids } = addClips(newReel('trim smoke'), [r0, r1, r2].map(x => ({ matchId: x.matchId, play: x.play })))
    setReels(rs => [...rs, built]); setReelId(built.id)
    await waitFor(() => latest.current.reel?.id === built.id || null, 20000, 'trim reel')
    const info0 = latest.current.clipInfo(built.clips[ids[0]])
    const before = info0.range!
    const overlapsFound = [...overlapsRef.current.keys()].filter(k => ids.includes(k)).length

    activateClip(built.clips[ids[0]])
    await waitFor(() => playback.attachedKey === r0.matchId && playback.current.ready && playback.current.loop ? true : null, 20000, 'loop start')
    let wraps = 0, last = -1
    const unsub = playback.subscribe(s => { if (last >= 0 && s.time < last - 1) wraps++; last = s.time })
    const loopMs = Math.round((before.out - before.in) * 1000)
    await waitFor(() => (wraps >= 2 ? true : null), loopMs * 3 + 5000, () => `two loops (wraps=${wraps}, t=${playback.current.time}, ${playback.debugVideo})`)
    unsub()

    const press = async (key: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); await sleep(200) }
    await playback.seekAndWait(before.in + 1.0); await press('[')
    await playback.seekAndWait(before.out - 1.0); await press(']')
    const c0 = latest.current.reel!.clips[ids[0]]
    const after = latest.current.clipInfo(c0).range!

    const dur = (id: string) => { const r = latest.current.clipInfo(latest.current.reel!.clips[id]).range!; return +(r.out - r.in).toFixed(2) }
    const durRally = [dur(ids[0]), dur(ids[2])]
    updateReel({ ...latest.current.reel!, rangeDefaults: { ...rangeDefaults(latest.current.reel!), mode: 'keyplay' } })
    await sleep(300)
    const durKey = [dur(ids[0]), dur(ids[2])]

    playback.toggle()
    await sleep(800)
    return {
      clips: [r0, r1, r2].map(x => `${x.play.code} rally ${x.play.rallyId}`),
      overlapsFound, loopSec: (before.out - before.in).toFixed(2), wraps,
      before, inSec: c0.inSec, outSec: c0.outSec, after,
      expect: { in: +(before.in + 1).toFixed(3), out: +(before.out - 1).toFixed(3) },
      durationsRallyMode: durRally, durationsKeyplayMode: durKey,
    }
  }

  // Builds a fresh reel from the first results with the given markers, plays it through while
  // timing each switch, then restarts at `shotAt` so the screenshot shows a clip mid-play.
  const smokeReel = async (spec: NonNullable<SmokeOpts['reel']>, res: PlayRef[]) => {
    // Round-robin across matches, skipping plays past the end of their video, so the run crosses matches.
    const fits = (x: PlayRef) => { const m = latest.current.matches[x.matchId]; return x.play.time + m.offsetSec + 10 < m.durationSec }
    const byMatch = [...new Set(res.map(x => x.matchId))].map(id => res.filter(x => x.matchId === id && fits(x)))
    const picks: PlayRef[] = []
    for (let i = 0; picks.length < spec.markers.length && byMatch.some(l => l.length > i); i++) {
      for (const l of byMatch) if (l[i] && picks.length < spec.markers.length) picks.push(l[i])
    }
    const r0 = newReel('smoke')
    let r = addClips(r0, picks.map(x => ({ matchId: x.matchId, play: x.play }))).reel
    const ids = r.groups.none.slice()
    spec.markers.forEach((m, i) => { if (m) r = toggleMarker(r, ids[i], m) })
    r = { ...r, groupOrder: spec.groupOrder ?? r.groupOrder, scope: spec.scope ?? 'all' }
    smokeUse(r)
    await waitFor(() => latest.current.reel?.id === r.id && latest.current.order.length ? true : null, 20000, 'reel order')
    const o = latest.current.order, info = latest.current.clipInfo
    const plan = o.map(c => ({ match: latest.current.matches[c.matchId].name, play: c.playId, marker: groupOf(r, c.id), ...info(c).range! }))

    const t0 = performance.now()
    const timeline: { i: number; match: string; startedMs: number; onScreenMs: number | null; firstTime: number | null }[] = []
    const unsub = playback.subscribe(s => {
      const cur = timeline[timeline.length - 1]
      const it = plan[cur?.i ?? -1]
      if (cur && it && cur.onScreenMs === null && playback.attachedKey === o[cur.i].matchId && s.time >= it.in - 0.25 && s.time < it.out) {
        cur.onScreenMs = Math.round(performance.now() - t0 - cur.startedMs); cur.firstTime = +s.time.toFixed(2)
      }
      if (s.seq && s.seq.index !== cur?.i) timeline.push({ i: s.seq.index, match: plan[s.seq.index].match, startedMs: Math.round(performance.now() - t0), onScreenMs: null, firstTime: null })
    })
    playThrough('video', 0)
    await waitFor(() => (playback.current.seq === null && timeline.length ? true : null), 180000, () => `through-play end (at ${JSON.stringify(timeline.at(-1))}, t=${playback.current.time}, key=${playback.attachedKey}, ${playback.debugVideo})`)
    unsub()
    const totalMs = Math.round(performance.now() - t0)
    playThrough('video', Math.min(spec.shotAt ?? 1, o.length - 1))
    await sleep(1500)
    return { plan, timeline, totalMs, expectedMs: Math.round(plan.reduce((s, x) => s + (x.out - x.in) * 1000, 0)) }
  }
}
