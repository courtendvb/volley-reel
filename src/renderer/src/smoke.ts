// Dev self-checks (VR_SMOKE): scripted runs through the real UI that report what they saw.
import type { Dispatch, RefObject, SetStateAction } from 'react'
import { EMPTY_FILTER, sameFilter, type PlayFilter, type PlayRef } from '../../shared/filter'
import { addClips, findClip, groupOf, groupRows, newReel, rangeDefaults, relink, setAnnotations, setOverlayOverride, toggleMarker, trimClip, type Clip, type ClipMode, type Group, type Marker, type Reel, type SlideSpot , markersOf } from '../../shared/reel'
import type { ExportJob, LibraryInfo, ProjectInfo, ScanResult, SlideFile } from '../../shared/types'
import { drawAnnotation, type Annotation } from '../../shared/annotation'
import { mergeScoped, scopeOf, type AnnScope, type ScopedAnnotations } from '../../shared/annotationScope'
import { TELOP_LOOKS, overlaySettings, type OverlaySettings } from '../../shared/overlay'
import { newVideo, type PlanItem, type Video } from '../../shared/video'
import type { SlideHow } from './components/ReelPanel'
import type { Tool } from './components/AnnotationLayer'
import { assetStats, forgetLogo } from './assets'
import { canvasStats } from './canvas'
import { playback } from './playback'
import { refreshPacks } from './packs'
import { captionPhoto, findPhoto } from '../../shared/pack'
import { playTimes, serveMarkOf } from '../../shared/serveMark'
import { DEFAULT_GRID_STYLE, courtQuad, flightTiming, homography, nearSide, playZones, playerMarks, project } from '../../shared/court'
import { assetImage } from './assets'
import { t } from '../../shared/i18n'
import type { AppLatest } from './app/appState'
import { clipPlayedSec } from '../../shared/timing'

export interface SmokeOpts {
  play: number
  filter: Partial<PlayFilter> | null
  scope: 'match' | 'all'
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
  serveTouch?: boolean // a serve's hit and its reception's touch marked on the trim bar: the measured speed in the bar and the caption
  slowHold?: boolean // a slow stretch and a hold put from the trim bar's buttons, played in the loop, and exported
  cardOwn?: boolean // 「このカードだけ」: one marker card's title moved and scaled apart from the others, then back
  flightStill?: boolean // with courtPoints: the animation off, the whole curve on one layer
  courtPoints?: string // a CourtFit as JSON: the fit set on the match, 座標（点） picked, plays shown, one exported
  captionNames?: boolean // a name typed on one clip goes to every clip of that player in the video; 'this clip only' stays on the clip
  captionPhoto?: boolean // with VR_PACKS_DIR: the player's photo by the caption, bottom-left then top-left, and in the export
  savedFilters?: boolean // the filter saved under a name, put back, saved again, removed and the removal undone
  picker?: boolean // the player picker opened, a player ticked, closed by its button, Esc and a click outside
  sceneTitle?: boolean // a scene card with a long name: its title's top-left stays, and dragging it saves a top-left
  cardInsert?: string // "<pack.vrpack>|<logo image>": a player's photo and a team's logo put on a marker card from its bar
  setter?: string // 'reception' | 'rotation': a setter's data slide made from the dialog's buttons
  clipMenu?: boolean // a clip's right-click menu: copied and moved to another scene, exported alone (with exportTo)
  presetBlock?: boolean // the block preset by middle split by the opposing setter, made with the newest matches first
  presetServe?: boolean // the serve preset's two choices: players by count, markers by zone, then in order (the dialog left open)
  presets?: boolean // a preset video made from the dialog, made again, a position set and undone, the video deleted with its scenes, undone and redone
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
  exportClip: (sceneId: string, clipId: string, g: Group, outPath?: string) => Promise<ExportJob | null>
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
  setMatchIds: Dispatch<SetStateAction<string[]>>
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

// Opens one of the panels under the video (StageTabs) by its tab, for steps that use it with the real mouse.
async function openPanel(p: 'trim' | 'objects' | 'display' | 'court'): Promise<void> {
  const label = p === 'trim' ? t('編集') : p === 'objects' ? t('図形・コメント') : t('表示')
  const tab = await waitFor(() => [...document.querySelectorAll<HTMLButtonElement>('.stage-tabs button')].find(b => b.textContent === label && !b.disabled) ?? null, 10000, `${label} tab`)
  if (tab.getAttribute('aria-selected') !== 'true') { tab.click(); await sleep(250) }
}

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
  const { activateClip, currentPlan, editCard, exportClip, exportMarker, exportScenes, extraSelRef, insertImage, jump, latest, loadProject, overlapsRef, playThrough, putSlide, scopedNow, setAnnScope, setAnnTool, setAnns, setExtract, setFilter, setLibrary, setOverlay, setOverlayOpen, setPicker, setReelId, setReels, setScan, setMatchIds, setSelectedAnn, setSettingsOpen, setVideoId, setVideos, startExport, updateReel, updateVideo, SAVE_DELAY_MS } = h
  // A failure's stack is logged here: only its message reaches the main process.
  window.__smoke = (opts: SmokeOpts) => run(opts).catch(e => { console.error(`[smoke stack] ${(e as Error).stack}`); throw e })
  const run = async (opts: SmokeOpts) => {
    if (opts.home) return smokeHome(opts)
    if (opts.m8?.startsWith('relocate:')) return smokeRelocate(opts.m8.slice('relocate:'.length))
    const p = await api.getProject()
    if (!p?.matches.length) throw new Error('no match in project')
    await loadProject(p)
    setMatchIds(opts.scope === 'match' ? [p.matches[0].id] : [])
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
    if (opts.cardInsert) return smokeCardInsert(res, opts.cardInsert)
    if (opts.sceneTitle) return smokeSceneTitle(res)
    if (opts.court) return smokeCourt(res, opts.exportTo)
    if (opts.savedFilters) return smokeSavedFilters(want, res.length)
    if (opts.clipMenu) return smokeClipMenu(opts.exportTo)
    if (opts.presets || opts.presetServe || opts.presetBlock) return smokePresets(opts.presetServe ? 'serve' : opts.presetBlock ? 'block' : 'all')
    if (opts.picker) return smokePicker()
    if (opts.setter) return smokeSetter(opts.setter)
    if (opts.captionPhoto) return smokeCaptionPhoto(res, opts.exportTo)
    if (opts.captionNames) return smokeCaptionNames(res)
    if (opts.cardOwn) return smokeCardOwn(res)
    if (opts.courtPoints) return smokeCourtPoints(opts.courtPoints, opts.exportTo, opts.flightStill)
    if (opts.serveTouch) return smokeServeTouch(res, opts.exportTo)
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
    await rightClick(document.querySelector('.reel-groups .group:not(.head) .group-head')!)
    log.headMenu = document.querySelector('.slide-menu-title')?.textContent
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(100)
    log.headMenuClosed = !document.querySelector('.slide-menu')
    log.gapButtons = document.querySelectorAll('.slide-gap').length // the hover ＋ between rows is gone
    await rightClick(document.querySelector('.reel-groups .group:not(.head) .clip-row')!)
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
    const firstRow = document.querySelector<HTMLElement>('.reel-groups .group:not(.head) .clip-row')!
    const dt = new DataTransfer()
    blankRow.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
    const fb = firstRow.getBoundingClientRect()
    firstRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: fb.top + 2 }))
    await sleep(150)
    firstRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: fb.top + 2 }))
    await sleep(300)
    log.afterDrag = rows()

    // The scene's head: not shown while empty; a blank slide put there shows it, and it plays before marker 1.
    log.sceneHeadHidden = !document.querySelector('.reel-groups .group.head')
    await putSlide({ group: 'head', after: null, index: 0 }, 'blank')
    await waitFor(() => (scene().slides ?? []).some(x => x.group === 'head') || null, 5000, 'head slide')
    await sleep(200)
    log.sceneHeadRows = document.querySelectorAll('.reel-groups .group.head .slide-row').length

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
    // The background from the card bar's palette: its swatch opens the 20 colours, one is clicked.
    const swatch = await waitFor(() => document.querySelector<HTMLButtonElement>(`button.palette-swatch[aria-label="${t('カードの背景色')}"]`), 5000, 'card background swatch')
    swatch.click()
    const navy = await waitFor(() => document.querySelector<HTMLButtonElement>('.palette-pop [role=option][title="#3F48CC"]'), 5000, 'palette colour')
    navy.click(); await sleep(400)
    if (latest.current.overlay.titleCard.background?.toUpperCase() !== '#3F48CC') throw new Error(`card background not set: ${latest.current.overlay.titleCard.background}`)
    log.card = { title: scene().markerCardTitles?.[1], background: latest.current.overlay.titleCard.background,
      planName: currentPlan('video').find(it => it.kind === 'card' && it.card.marker === 1)?.kind === 'card' ? (currentPlan('video').find(it => it.kind === 'card' && it.card.marker === 1) as { card: { name: string } }).card.name : null }
    // The scene's rows for the screenshot (the head section on top).
    ;[...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(b => b.textContent === t('シーン'))?.click(); await sleep(300)
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

    // Curved arrow (B): dragged from start to end it is an arc; its control point then dragged on its
    // own, and the arrow made straight and curved again from the format panel.
    {
      await key('b'); await stroke([[0.8, 0.95], [0.88, 0.8], [0.95, 0.65]])
      const curveId = latest.current.selectedAnn
      const cv = () => anns().find(a => a.id === curveId) as Extract<Annotation, { kind: 'arrow' }> | undefined
      log.curve = { made: !!cv()?.c1 }
      const c2 = cv()?.c2
      if (c2) await stroke([[c2[0], c2[1]], [0.96, c2[1] + 0.05], [0.97, c2[1] + 0.1]])
      log.curveCtrl = cv()?.c2?.map(v => +v.toFixed(3))
      button('まっすぐにする').click(); await sleep(120)
      log.curveStraight = !cv()?.c1
      button('曲線にする').click(); await sleep(120)
      log.curveAgain = !!cv()?.c1
      await api.smokeShot!('curve.png')
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

    // The export tab lists what can be exported.
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
    if (opts.home === 'open-match') {
      // A library row's "<team> で開く": a one-match project made, the same one opened again from
      // home, and the other team's its own.
      const openAs = async (i: number) => {
        const row = await waitFor(() => document.querySelector('.home .match-row'), 10000, 'library row')
        const b = row.querySelectorAll<HTMLButtonElement>('.match-open button')[i]
        b.click()
        await waitFor(() => (!document.querySelector('.home') && latest.current.projectPath ? true : null), 30000, 'project opened')
        await sleep(800)
        const p = (await api.getProject())!
        return { label: b.textContent, path: latest.current.projectPath!, name: p.name, matches: p.matchIds.length, codes: p.settings.ourTeamCodes }
      }
      const home = async () => {
        [...document.querySelectorAll<HTMLButtonElement>('header button')].find(b => b.textContent === t('ホーム'))!.click()
        await waitFor(() => document.querySelector('.home .match-row'), 10000, 'home')
        await sleep(300)
      }
      const first = await openAs(0)
      await api.smokeShot!('open-match-project.png')
      await home()
      await api.smokeShot!('open-match-home.png')
      const again = await openAs(0)
      await home()
      const other = await openAs(1)
      if (again.path !== first.path) throw new Error(`opened again as a new project: ${first.path} / ${again.path}`)
      if (other.path === first.path || first.matches !== 1) throw new Error(`other team: ${JSON.stringify([first, other])}`)
      return { first, reopenedSame: true, other }
    }
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
  // The card bar's ＋ 選手の写真 and ＋ ロゴ: a pack and a logo for the first play's team, a marker card
  // of a scene of that play, then a photo and the logo picked from the bar's lists.
  const smokeSceneTitle = async (res: PlayRef[]) => {
    const r0 = res.find(x => x.play.rallyId !== null)!
    const sc = { ...addClips(newReel('A very long scene name: serves of the opposite in rotation one'), [{ matchId: r0.matchId, play: r0.play }]).reel, sceneCard: true }
    smokeUse(sc)
    await waitFor(() => latest.current.reel?.id === sc.id || null, 20000, 'scene')
    editCard(sc.id, null); await sleep(400)
    ;[...document.querySelectorAll<HTMLButtonElement>('.card-edit-bar button')].find(b => b.textContent === t('タイトルの位置'))!.click(); await sleep(200)
    const ed = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=card-editor]'), 5000, 'card editor')
    const eb = ed.getBoundingClientRect()
    const ept = (fx: number, fy: number) => ({ clientX: eb.left + fx * eb.width, clientY: eb.top + fy * eb.height, bubbles: true, pointerId: 1 })
    // The title's top-left is at 10% / 40% by default: grab it just inside and move it 5% right and down.
    ed.dispatchEvent(new PointerEvent('pointerdown', ept(0.13, 0.5))); await sleep(40)
    ed.dispatchEvent(new PointerEvent('pointermove', ept(0.16, 0.53))); await sleep(40)
    ed.dispatchEvent(new PointerEvent('pointermove', ept(0.18, 0.55))); await sleep(40)
    ed.dispatchEvent(new PointerEvent('pointerup', ept(0.18, 0.55))); await sleep(300)
    const lay = latest.current.overlay.titleCard.sceneLayout
    if (!lay || lay.origin !== 'tl' || Math.abs(lay.x - 0.15) > 0.01 || Math.abs(lay.y - 0.45) > 0.01) throw new Error(`scene layout after the drag: ${JSON.stringify(lay)}`)
    return { sceneLayout: { x: +lay.x.toFixed(3), y: +lay.y.toFixed(3), scale: lay.scale, origin: lay.origin } }
  }

  const smokeCardInsert = async (res: PlayRef[], spec: string) => {
    const [packFile, logoFile] = spec.split('|')
    const r0 = res.find(x => x.play.rallyId !== null)!
    const d = latest.current.dvwsRef![r0.matchId], team = d.teams[r0.play.side === '*' ? 0 : 1].code.toUpperCase()
    await api.smokeImportPack!(packFile); await refreshPacks()
    await window.api.smokeSetLogo!(team, logoFile)
    // Marker 1: a play of r0's player; marker 2: a play of #21 (the pack has both photos).
    const r1 = res.find(x => x.play.rallyId !== null && x.play.jersey === 21 && x.play.side === r0.play.side)!
    const made = addClips(newReel('card insert smoke'), [{ matchId: r0.matchId, play: r0.play }, { matchId: r1.matchId, play: r1.play }])
    let sc = toggleMarker(toggleMarker(made.reel, made.ids[0], 1), made.ids[1], 2)
    smokeUse(sc)
    await waitFor(() => latest.current.reel?.id === sc.id || null, 20000, 'scene')
    editCard(sc.id, 1)
    const pick = async (label: string) => {
      const sel = await waitFor(() => document.querySelector<HTMLSelectElement>(`.card-edit-bar select[aria-label="${t(label)}"]`), 8000, label)
      const options = [...sel.querySelectorAll('option')].map(o => o.textContent ?? '')
      const v = [...sel.options].find(o => o.value)!.value
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, v)
      sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(800)
      return options
    }
    const photoOptions = await pick('選手の写真を入れる')
    const logoOptions = await pick('ロゴを入れる')
    // The photo on this card only; the logo on every marker card (the video's).
    const own = () => latest.current.reels.find(x => x.id === sc.id)?.markerCardAnnotations?.[1] ?? []
    const shared = () => latest.current.overlay.titleCard.objects?.marker ?? []
    await waitFor(() => (own().length === 1 && shared().length === 1) || null, 8000, () => `photo on the card, logo on all (own ${own().length}, all ${shared().length})`)
    // ＋ 写真枠: on every marker card too, each filled with its own marker's player.
    ;[...document.querySelectorAll<HTMLButtonElement>('.card-edit-bar button')].find(b => b.textContent === t('＋ 写真枠'))!.click()
    await waitFor(() => shared().some(a => a.kind === 'image' && a.frame) || null, 5000, 'photo frame on every marker card')
    updateReel({ ...latest.current.reels.find(x => x.id === sc.id)!, markerCards: { 1: true, 2: true } })
    await sleep(300)
    const frameOn = (m: number) => {
      const card = currentPlan('scene').find(it => it.kind === 'card' && it.card.marker === m)
      const f = card?.kind === 'card' ? card.card.annotations?.find(a => a.kind === 'image' && a.frame) : undefined
      return f?.kind === 'image' ? decodeURIComponent(f.assetId) : null
    }
    const frames = { 1: frameOn(1), 2: frameOn(2) }
    if (!frames[1]?.endsWith('miwa.png') || !frames[2]?.endsWith('eiro.png')) throw new Error(`frames: ${JSON.stringify(frames)}`)
    // Left off marker 2's card: gone there, still on marker 1's.
    const frameId = shared().find(a => a.kind === 'image' && a.frame)!.id
    updateReel({ ...latest.current.reels.find(x => x.id === sc.id)!, markerCardHidden: { 2: [frameId] } })
    await sleep(300)
    if (frameOn(2) !== null || !frameOn(1)) throw new Error(`hidden on 2: ${frameOn(2)} / on 1: ${frameOn(1)}`)
    await sleep(500)
    return { team, photoOptions, logoOptions, own: own().length, shared: shared().map(a => (a.kind === 'image' && a.frame ? 'frame' : a.kind)), frames }
  }

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
  // A serve's hit (起点) and its reception's touch (タッチ) set at the playhead from the trim bar: the bar
  // shows the speed from one to the other, the caption carries it, the flight lasts that long, and 外す clears it.
  const smokeServeTouch = async (res: PlayRef[], exportTo?: string) => {
    const r = res.find(x => x.play.skill === 'S' && x.play.startClick && x.play.endClick)
    if (!r) throw new Error('no serve with both clicks in the results (VR_SMOKE_FILTER {"skills":["S"]})')
    const { reel: added, ids } = addClips(newReel('touch smoke'), [{ matchId: r.matchId, play: r.play }])
    const built = { ...added, scope: 'all' as const }
    const v = newVideo('touch smoke', [built.id])
    setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
    await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'touch reel')
    const clip = () => latest.current.reel!.clips[ids[0]]
    activateClip(clip()); await sleep(800)
    await openPanel('trim')
    const key = r.play.time + latest.current.matches[r.matchId].offsetSec
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.trim-fields button')].find(b => b.textContent === label)!
    const before = { marker: !!document.querySelector('.trim-touch'), speedField: !!document.querySelector('input[aria-label="' + t('サーブの速度（km/h）') + '"]') }
    playback.pause(); await playback.seekAndWait(key + 0.2)
    button('◎ ' + t('起点')).click(); await sleep(300)
    await playback.seekAndWait(key + 0.9)
    button('◎ ' + t('タッチ')).click(); await sleep(400)
    const c = clip(), markOf = () => serveMarkOf(latest.current.matches[r.matchId], r.play)
    const mark = markOf()
    const measured = document.querySelector('.trim-measured')?.textContent ?? null
    const caption = latest.current.overlayData!(c)?.speed ?? null
    const flight = flightTiming(r.play, latest.current.matches[r.matchId].offsetSec, playTimes(mark, c))
    await api.smokeShot!('serve-touch.png')
    button(t('外す')).click(); await sleep(300)
    const cleared = { touch: markOf()?.touch ?? null, marker: !!document.querySelector('.trim-touch'), measured: !!document.querySelector('.trim-measured') }
    // Another serve, picked in the list with no clip of it: the bar beside the tabs marks it.
    const r2 = res.find(x => x !== r && x.play.skill === 'S' && x.play.startClick && x.play.endClick)
    if (!r2) throw new Error('no second serve with both clicks')
    const key2 = r2.play.time + latest.current.matches[r2.matchId].offsetSec, mark2 = () => serveMarkOf(latest.current.matches[r2.matchId], r2.play)
    jump(r2); await sleep(800); playback.pause()
    const listButton = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.serve-mark button')].find(b => b.textContent === label)
    if (!listButton('◎ ' + t('タッチ'))) throw new Error('no serve bar for the list play')
    await playback.seekAndWait(key2 + 0.1)
    listButton('◎ ' + t('ヒット'))!.click(); await sleep(200)
    await playback.seekAndWait(key2 + 0.85)
    listButton('◎ ' + t('タッチ'))!.click(); await sleep(400)
    const list = { mark: mark2(), speed: document.querySelector('.serve-mark-speed')?.textContent ?? null, caption: null as unknown, plate: false }
    // The plate comes up from the touch: a pixel of the theme's accent where it sits (top right).
    const plateAt = () => { const cv = document.querySelector<HTMLCanvasElement>('.overlay-layer'); if (!cv) return null; const g = cv.getContext('2d')!; let n = 0; const d = g.getImageData(Math.floor(cv.width * 0.7), 0, Math.floor(cv.width * 0.3), Math.floor(cv.height * 0.15)).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n }
    const beforeTouch = (await playback.seekAndWait(key2 + 0.5), await sleep(300), plateAt())
    await playback.seekAndWait(key2 + 1.2); await sleep(300)
    list.plate = beforeTouch === 0 && (plateAt() ?? 0) > 100
    await api.smokeShot!('serve-touch-list.png')
    await sleep(500) // the mark is saved a moment after the last change
    const saved = (await api.getProject())?.matches.find(m => m.id === r2.matchId)?.serveMarks?.[r2.play.fingerprint] ?? null
    // A clip made of it afterwards carries the speed already.
    const { reel: withIt, ids: ids2 } = addClips(latest.current.reel!, [{ matchId: r2.matchId, play: r2.play }])
    updateReel(withIt); await sleep(300)
    list.caption = latest.current.overlayData!(latest.current.reel!.clips[ids2[0]])?.speed ?? null
    // With VR_SMOKE_EXPORT: the scene exported; the plate is a layer from the touch to the clip's end.
    let exported: unknown = null
    if (exportTo) {
      const job = await startExport(exportTo, { plan: currentPlan('scene'), name: 'touch smoke' })
      if (!job) throw new Error('export did not start')
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'touch export done')
      exported = { state: latest.current.exportState?.status, clips: job.items.filter(i => i.kind === 'clip').map(i => (i.kind === 'clip' ? { in: i.in, out: i.out, layers: i.layers.map(l => [l.from ?? null, l.to ?? null]) } : null)) }
    }
    // Each design of the scoreboard, caption and speed plate on the clip, after the touch (look-*.png),
    // then the settings with their thumbnails.
    activateClip(latest.current.reel!.clips[ids2[0]]); await sleep(800); playback.pause()
    await playback.seekAndWait(key2 + 1.3); await sleep(300)
    const looks: string[] = []
    for (const l of TELOP_LOOKS) {
      setOverlay({ ...latest.current.overlay, look: l.look }); await sleep(400)
      await api.smokeShot!(`look-${l.look}.png`)
      looks.push(latest.current.overlay.look ?? 'slant')
    }
    setOverlayOpen(true); await sleep(600)
    await api.smokeShot!('look-dialog.png')
    setOverlayOpen(false)
    return { serveTouch: { play: r.play.code, before, mark, measured, caption, flight, cleared, list, saved, exported, looks } }
  }

  const smokeSlowHold = async (res: PlayRef[], exportTo?: string) => {
    const r = res[0]
    const { reel: added, ids } = addClips(newReel('slow smoke'), [{ matchId: r.matchId, play: r.play }])
    const built = { ...added, scope: 'all' as const }
    const v = newVideo('slow smoke', [built.id])
    setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
    await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'slow reel')
    const clip = () => latest.current.reel!.clips[ids[0]]
    activateClip(clip()); await sleep(800)
    await openPanel('trim') // the buttons are on the trim panel
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

  // The scout's clicks as points: the given court fit on the match, 座標（点） from the court panel, a
  // serve, attack, reception and block on screen (the block has no click: zones), then an export.
  const smokeCourtPoints = async (fitJson: string, exportTo?: string, still?: boolean) => {
    const p0 = await api.getProject()
    const m = p0!.matches[0]
    await api.setMatchCourt(m.id, JSON.parse(fitJson))
    await loadProject(await api.getProject())
    setFilter(EMPTY_FILTER)
    await waitFor(() => (latest.current.results.length && latest.current.matches[m.id]?.court ? true : null), 20000, 'plays and court')
    const all = latest.current.results
    const pick = (skill: string) => all.find(r => r.play.skill === skill && r.play.startClick && r.play.endClick) ?? all.find(r => r.play.skill === skill)!
    const shots: Record<string, unknown> = {}
    const show = async (name: string, r: PlayRef) => {
      jump(r)
      await waitFor(() => (latest.current.selected?.playId === r.play.id ? true : null), 10000, name)
      await sleep(700); playback.pause(); await sleep(300)
      await api.smokeShot!(`points-${name}.png`)
      shots[name] = { code: r.play.code, near: nearSide(latest.current.matches[m.id].court!, r.play) === r.play.side, start: r.play.startClick ?? null, end: r.play.endClick ?? null }
    }
    await show('first', pick('S')) // something selected, so the bar is up
    await openPanel('court')
    const sel = await waitFor(() => document.querySelector<HTMLSelectElement>('select[aria-label="' + t('ゾーンの細かさ') + '"]'), 5000, 'detail select')
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'point')
    sel.dispatchEvent(new Event('change', { bubbles: true })); await sleep(300)
    await show('serve', pick('S')); await show('attack', pick('A')); await show('reception', pick('R')); await show('block', pick('B'))
    // The flight curve: ticked in the court panel, the serve seen part way along it.
    const flightBox = await waitFor(() => [...document.querySelectorAll<HTMLLabelElement>('.court-bar label')].find(l => l.textContent?.includes(t('軌道（放物線）')))?.querySelector('input') ?? null, 5000, 'flight box')
    if (!flightBox.checked) flightBox.click()
    await sleep(300)
    const flyServe = pick('S')
    await show('flight-start', flyServe)
    const shotOf = (want: (c: string) => boolean) => all.find(r => r.play.startClick && r.play.endClick && want(r.play.code))
    const tip = shotOf(c => c.charAt(3) === 'A' && (c.charAt(12) === 'T' || c.charAt(12) === 'P'))
    // Many DVWs leave out where a set was struck: the check takes any that says where it went.
    const highSet = all.find(r => r.play.skill === 'E' && r.play.code.charAt(4) === 'H' && r.play.endClick)
    const midSet = all.find(r => r.play.skill === 'E' && r.play.setTo === 'M' && r.play.code.charAt(4) !== 'Q' && r.play.endClick)
    for (const [name, r] of [['flight-tip', tip], ['flight-set', highSet], ['flight-set-m', midSet]] as const) {
      if (!r) continue
      await show(name, r)
      const f = flightTiming(r.play, latest.current.matches[m.id].offsetSec)
      await playback.seekAndWait(f.startSec + f.sec + 0.1); await sleep(400)
      await api.smokeShot!(`points-${name}-end.png`)
    }
    const fl = flightTiming(flyServe.play, latest.current.matches[m.id].offsetSec)
    await playback.seekAndWait(fl.startSec + fl.sec * 0.6); await sleep(400)
    await api.smokeShot!('points-flight-mid.png')
    const counts = Object.fromEntries('SRADEB'.split('').map(k => { const l = all.filter(r => r.play.skill === k); return [k, `${l.filter(r => r.play.startClick && r.play.endClick).length}/${l.length}`] }))
    if (still) {
      const anim = await waitFor(() => [...document.querySelectorAll<HTMLLabelElement>('.court-bar label')].find(l => l.textContent?.includes(t('アニメーション')))?.querySelector('input') ?? null, 5000, 'animation box')
      if (anim.checked) anim.click()
      await sleep(300)
    }
    // The court tab's heatmap and serve paths: the player's serves flying with the one selected.
    const tick = async (label: string) => {
      const box = await waitFor(() => [...document.querySelectorAll<HTMLLabelElement>('.court-bar label')].find(l => l.textContent?.trim() === t(label))?.querySelector('input') ?? null, 5000, label)
      if (!box.checked) box.click()
      await sleep(300)
    }
    await tick('ヒートマップ'); await tick('サーブ軌道')
    const ps = pick('S')
    await show('player-serve', ps)
    const pf = flightTiming(ps.play, latest.current.matches[m.id].offsetSec)
    await playback.seekAndWait(pf.startSec + pf.sec * 0.5); await sleep(400)
    await api.smokeShot!('player-serve-mid.png')
    await show('player-attack', pick('A'))
    await tick('落下点')
    await api.smokeShot!('player-landings.png')
    // A landing clicked goes to that shot; the heatmap clicked offers the nearest five.
    const clickAt = async (p: { x: number; y: number }) => { const canvas = document.querySelector<HTMLCanvasElement>('.court-layer')!, box = canvas.getBoundingClientRect(); canvas.parentElement!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: box.left + p.x * box.width, clientY: box.top + p.y * box.height })); await sleep(600) }
    const zoned = latest.current.selected
    await clickAt({ x: 0.5, y: 0.75 })
    await api.smokeShot!('shot-pick.png')
    const pickRows = [...document.querySelectorAll<HTMLButtonElement>('.shot-pick button')].map(b => b.textContent)
    document.querySelectorAll<HTMLButtonElement>('.shot-pick button:not(.link)')[1]?.click(); await sleep(800)
    console.log(`[smoke-shot] ${JSON.stringify({ pickRows, before: zoned, after: latest.current.selected })}`)
    const chosen = latest.current.selected!, cur = latest.current.matches[chosen.matchId], play = latest.current.dvwsRef![chosen.matchId].plays[chosen.playId]
    const marks = playerMarks(play, cur.court!, { ...DEFAULT_GRID_STYLE, landings: true }, () => latest.current.dvwsRef![chosen.matchId].plays)!.landings!
    const k = marks.plays.findIndex(p => p.id !== play.id), to = project(homography(cur.court!.corners), marks.points[k].x, marks.points[k].y)
    await clickAt(to); await sleep(400)
    console.log(`[smoke-landing] ${JSON.stringify({ wanted: marks.plays[k].id, got: latest.current.selected?.playId })}`)
    const found = await api.detectCourt(m.id)
    console.log(`[smoke-court] ${JSON.stringify(found)}`)
    // Two players ticked in the list's picker, and how far the arrow keys move.
    const picker = [...document.querySelectorAll<HTMLButtonElement>('.filters .check-picker')][0]
    const everyone = latest.current.results.length
    picker.click(); await sleep(200)
    const boxes = [...document.querySelectorAll<HTMLInputElement>('.check-picker-list input')]
    boxes[1].click(); await sleep(200)
    const onePlayer = latest.current.results.length
    document.querySelectorAll<HTMLInputElement>('.check-picker-list input')[2].click(); await sleep(200)
    const twoPlayers = latest.current.results.length
    await api.smokeShot!('player-picker.png')
    document.querySelector<HTMLElement>('.menu-backdrop')!.click(); await sleep(200)
    console.log(`[smoke-picker] ${JSON.stringify({ everyone, choices: boxes.length - 1, onePlayer, twoPlayers, button: picker.textContent })}`)
    setFilter({ ...EMPTY_FILTER }); await sleep(200)
    localStorage.setItem('vr.arrowSec', '2')
    const t0 = playback.current.time
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await sleep(400)
    console.log(`[smoke-arrow] ${JSON.stringify({ moved: +(playback.current.time - t0).toFixed(2) })}`)
    localStorage.removeItem('vr.arrowSec')
    document.querySelector('video')?.pause(); await sleep(200)
    const t1 = playback.current.time
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true })); await sleep(400)
    console.log(`[smoke-ctrl-arrow] ${JSON.stringify({ moved: +(playback.current.time - t1).toFixed(2) })}`)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })); await sleep(300)
    await api.smokeShot!('shortcuts.png')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true })); await sleep(200)
    // The heatmap's strength and the height line, switched in the court tab.
    const heatRange = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="' + t('ヒートマップの濃さ') + '"]'), 5000, 'heat strength')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(heatRange, '0.3')
    heatRange.dispatchEvent(new Event('input', { bubbles: true })); await sleep(300)
    const liftBox = [...document.querySelectorAll<HTMLLabelElement>('.court-bar label')].find(l => l.textContent?.trim() === t('打点の高さの線'))?.querySelector('input')
    liftBox?.click(); await sleep(300)
    await api.smokeShot!('heat-faint-no-lift.png')
    let exported: unknown = null
    if (exportTo) {
      const { reel: added } = addClips(newReel('points smoke'), [pick('S'), pick('A')].map(r => ({ matchId: r.matchId, play: r.play })))
      const built = { ...added, scope: 'all' as const }
      const v = newVideo('points smoke', [built.id])
      setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
      await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'points reel')
      setOverlay({ ...latest.current.overlay, court: { enabled: true } }); await sleep(400)
      const job = await startExport(exportTo, { plan: currentPlan('scene'), name: 'points smoke' })
      if (!job) throw new Error('export did not start')
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'points export done')
      const clip = job.items.find(i => i.kind === 'clip')
      // The red line, dragged in the trim tab: the first clip's flight leaves from there in the export.
      const first = Object.values(latest.current.reel!.clips).sort((a, b) => a.playId - b.playId)[0]
      activateClip(first); await sleep(600)
      await openPanel('trim')
      const line = await waitFor(() => document.querySelector<HTMLElement>('.trim-key'), 5000, 'red line')
      const lb = line.getBoundingClientRect(), ptr = (x: number) => ({ clientX: x, clientY: lb.top + 5, bubbles: true, pointerId: 1 })
      line.dispatchEvent(new PointerEvent('pointerdown', ptr(lb.left + 5))); await sleep(40)
      line.dispatchEvent(new PointerEvent('pointermove', ptr(lb.left + 45))); await sleep(40)
      line.dispatchEvent(new PointerEvent('pointerup', ptr(lb.left + 45))); await sleep(300)
      await api.smokeShot!('skill-line.png')
      const skillSec = latest.current.reel!.clips[first.id].skillSec ?? null
      const movedJob = await startExport(exportTo.replace(/\.mp4$/i, '-moved.mp4'), { plan: currentPlan('scene'), name: 'moved' })
      await sleep(500)
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'moved export done')
      const movedClip = movedJob?.items.find(i => i.kind === 'clip')
      const firstJobClip = job.items.find(i => i.kind === 'clip')
      const layer = (c: typeof movedClip) => (c?.kind === 'clip' ? c.layers[1]?.to ?? null : null)
      // The serve's speed, typed in the trim tab: the flight's last step ends sooner or later with it.
      const speedBox = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="' + t('サーブの速度（km/h）') + '"]'), 5000, 'speed field')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(speedBox, '110')
      speedBox.dispatchEvent(new Event('input', { bubbles: true })); await sleep(100)
      speedBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(400)
      await api.smokeShot!('serve-speed.png')
      const speedClip = latest.current.reel!.clips[first.id]
      const fastJob = await startExport(exportTo.replace(/\.mp4$/i, '-fast.mp4'), { plan: currentPlan('scene'), name: 'fast' })
      await sleep(500)
      await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 180000, 'fast export done')
      const flightEnd = (c: unknown) => { const it = c as { layers: { to?: number }[] } | undefined; const l = it?.layers ?? []; return l[l.length - 2]?.to ?? null }
      const speedLine = { kmh: speedClip.speedKmh ?? null, usual: speedBox.placeholder, before: flightEnd(movedClip), after: flightEnd(fastJob?.items.find(i => i.kind === 'clip')) }
      const skillLine = { speedLine, skillSec, before: layer(firstJobClip), after: layer(movedClip) }
      exported = { skillLine, state: latest.current.exportState?.status, flight: fl, firstClip: clip?.kind === 'clip' ? { in: clip.in, out: clip.out, layers: clip.layers.map(l => [l.from ?? null, l.to ?? null]) } : null }
    }
    // The trim tab's button: the picture on screen as a slide right after the open clip.
    {
      const rl = latest.current.reel!, id = Object.keys(rl.clips)[0]
      activateClip(rl.clips[id], rl.groups.none.includes(id) ? 'none' : markersOf(rl, id)[0])
      await sleep(800)
      const tab = [...document.querySelectorAll<HTMLButtonElement>('.stage-tabs button')].find(b => b.textContent === t('編集'))!
      if (!tab.classList.contains('on')) tab.click()
      await sleep(300)
      const before = latest.current.reel!.slides?.length ?? 0
      const add = [...document.querySelectorAll<HTMLButtonElement>('.trim button')].find(b => b.textContent === t('＋ 今の画面をスライドに'))
      await api.smokeShot!('trim-slide-button.png')
      add?.click()
      await waitFor(() => ((latest.current.reel!.slides?.length ?? 0) > before ? true : null), 10000, 'frame slide')
      const made = latest.current.reel!.slides!.at(-1)!
      await sleep(800)
      for (const box of document.querySelectorAll<HTMLInputElement>('.slide-marks input')) { box.click(); await sleep(250) }
      await sleep(500)
      await api.smokeShot!('slide-marks.png')
      const sl = latest.current.reel!.slides!.find(x => x.zones)!
      console.log(`[smoke-slide-marks] ${JSON.stringify({ zones: !!sl.zones, heat: sl.heat?.points.length, landings: sl.landings?.points.length, flights: sl.flights?.paths.length, notice: latest.current.notice })}`)
      if (exportTo) {
        const out = exportTo.replace(/\.mp4$/i, '-slide.mp4')
        await startExport(out, { plan: currentPlan('scene').filter(p => p.kind === 'card' && p.card.slide?.id === sl.id), name: 'slide marks' })
        await waitFor(() => (['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') ? true : null), 120000, 'slide export')
        console.log(`[smoke-slide-export] ${JSON.stringify({ state: latest.current.exportState?.status, out })}`)
      }
      console.log(`[smoke-frame] ${JSON.stringify({ button: !!add, after: made.after === id, group: made.group })}`)
      await sleep(500)
      ;[...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === t('完了'))?.click()
      await sleep(300)
    }
    // The right column's tabs, each on its own.
    for (const [i, name] of ['scene', 'video', 'export'].entries()) {
      document.querySelectorAll<HTMLButtonElement>('.right-tabs button')[i].click(); await sleep(300)
      await api.smokeShot!(`right-${name}.png`)
    }
    // Play from the line above the tabs: the video runs through, then is stopped.
    document.querySelector<HTMLButtonElement>('.video-head .primary')!.click()
    await waitFor(() => (playback.current.seq ? true : null), 10000, 'video playing from the head')
    await sleep(1000)
    const playedFromHead = !!playback.current.seq
    document.querySelector<HTMLButtonElement>('.video-head > button')?.click()
    playback.stopSequence()
    shots.playedFromHead = playedFromHead
    return { courtPoints: { counts, shots, exported } }
  }

  // 「このカードだけ」: marker 1's card gets its own title place and size; marker 2's and the shared
  // layout stay, and unticking goes back to the shared one.
  const smokeCardOwn = async (res: PlayRef[]) => {
    const { reel: added, ids } = addClips(newReel('card smoke'), res.slice(0, 2).map(r => ({ matchId: r.matchId, play: r.play })))
    const built = toggleMarker(toggleMarker(added, ids[0], 1, () => ['0', 0]), ids[1], 2, () => ['0', 0])
    const v = newVideo('card smoke', [built.id], { titleCard: { ...overlaySettings(undefined).titleCard, enabled: true } })
    setReels(rs => [...rs, built]); setVideos(vs => [...vs, v]); setReelId(built.id); setVideoId(v.id)
    await waitFor(() => (latest.current.reel?.id === built.id && latest.current.video?.id === v.id) || null, 20000, 'card reel')
    const cards = () => currentPlan('scene').flatMap(p => (p.kind === 'card' ? [{ marker: p.card.marker, layout: p.card.layout ?? null }] : []))
    const shared = () => latest.current.overlay.titleCard.markerLayout ?? null
    editCard(built.id, 1); await sleep(500)
    const pick = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.card-edit-bar button')].find(b => b.textContent === label)!
    pick(t('タイトルの位置')).click(); await sleep(300)
    const box = await waitFor(() => [...document.querySelectorAll<HTMLLabelElement>('.card-edit-bar label')].find(l => l.textContent?.includes(t('このカードだけ')))?.querySelector('input') ?? null, 5000, 'own box')
    box.click(); await sleep(300)
    const range = document.querySelector<HTMLInputElement>('.card-edit-bar input[type=range]')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(range, '60')
    range.dispatchEvent(new Event('input', { bubbles: true })); await sleep(300)
    const own = { cards: cards(), shared: shared(), saved: latest.current.reel!.markerCardLayouts ?? null }
    await api.smokeShot!('card-own.png')
    box.click(); await sleep(300)
    return { cardOwn: { own, back: { cards: cards(), shared: shared() } } }
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

  // The player picker in the left column, through its real buttons: its list inside the window,
  // a player ticked (which adds the saved-filter row above and moves the column: the list must
  // follow and leave the field uncovered), then closed by 閉じる, by Esc and by a click outside it.
  const smokePicker = async () => {
    const trigger = await waitFor(() => document.querySelector<HTMLButtonElement>(`button.check-picker[aria-label="${t('選手')}"]`), 10000, 'player picker')
    const list = () => document.querySelector<HTMLElement>(`.check-picker-list[aria-label="${t('選手')}"]`)
    const openIt = async () => { trigger.click(); return waitFor(list, 3000, 'list open') }
    const closed = (how: string) => waitFor(() => (!list() && trigger.getAttribute('aria-expanded') === 'false' ? true : null), 3000, `closed by ${how}`)
    const el = await openIt()
    const box = el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')[1]
    const fieldBefore = trigger.getBoundingClientRect().top
    box.click(); await sleep(200)
    await api.smokeShot!('picker-open.png')
    const ticked = latest.current.filter.persons.length
    const field = trigger.getBoundingClientRect(), after = el.getBoundingClientRect()
    const fieldMoved = Math.round(field.top - fieldBefore)
    const covers = after.top < field.bottom && after.bottom > field.top
    const inside = after.top >= 0 && after.bottom <= window.innerHeight && after.left >= 0
    const closeButton = [...el.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === t('閉じる'))
    if (!closeButton) throw new Error('no 閉じる button')
    const footVisible = closeButton.getBoundingClientRect().bottom <= after.bottom + 1
    closeButton.click(); await closed('閉じる')
    await openIt()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await closed('Esc')
    await openIt()
    document.querySelector<HTMLElement>('.menu-backdrop')!.click(); await closed('a click outside')
    if (!inside || !footVisible || ticked !== 1 || covers) throw new Error(`picker: inside ${inside}, foot visible ${footVisible}, ticked ${ticked}, covers the field ${covers} (moved ${fieldMoved}px)`)
    return { picker: { inside, footVisible, ticked, fieldMoved, covers, rows: el.querySelectorAll('label').length, closedBy: ['閉じる', 'Esc', 'outside'] } }
  }

  // Presets through the dialog's real buttons: a block video by middle made and checked against
  // its preview (scenes, names, title cards, markers, clips, on disk); made again from its 作り直す;
  // a position set by hand (saved, moving a player's attacks) and undone; the video deleted
  // with its scenes, then the deletion undone (back on disk) and redone.
  // A setter's slide: データスライド作成, セット, the layout, 作成; the slide's court titles and how many
  // sets each holds, read back from the made slide (the screenshot shows it in the editor).
  const smokeSetter = async (layout: string) => {
    const button = (root: ParentNode, text: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text)
    button(document, t('データスライド作成'))!.click()
    const dialog = await waitFor(() => document.querySelector<HTMLElement>('.board-dialog'), 5000, 'board dialog')
    if (layout === 'serve') {
      // サーブ, points and the heatmap without lines, 始点 on (the default): the preview shot with and
      // without the starts, then the slide made with them.
      const box = (text: string) => [...dialog.querySelectorAll<HTMLLabelElement>('label.check')].find(l => l.textContent?.trim() === text)!.querySelector('input')!
      const turn = async (text: string, on: boolean) => { if (box(text).checked !== on) box(text).click(); await sleep(300) }
      button(dialog, t('サーブ'))!.click(); await sleep(400)
      await turn(t('線'), false); await turn(t('ヒートマップ'), true)
      const startsDefault = box(t('始点')).checked
      await turn(t('始点'), false); await sleep(600); await api.smokeShot!('serve-board-nostarts.png')
      await turn(t('始点'), true); await sleep(600); await api.smokeShot!('serve-board-starts.png')
      button(dialog, t('作成'))!.click()
      const slide = await waitFor(() => latest.current.reel?.slides?.find(x => x.board?.config.skill === 'S') ?? null, 10000, 'serve slide')
      await sleep(800)
      const look = slide.charts?.[0]?.chart.look
      if (!look?.starts || look.lines || !look.heat) throw new Error(`serve look: ${JSON.stringify(look)}`)
      return { startsDefault, look: { points: look.points, lines: look.lines, heat: look.heat, starts: look.starts }, charts: slide.charts!.length, starts: slide.charts!.map(c => c.chart.dots.filter(d => d.start).length) }
    }
    if (layout.startsWith('target')) {
      // サーブの狙い: the team's receivers with their photos (from a pack read in first), and the zones.
      const [, pack, logoFile] = layout.split('|')
      if (pack) { await api.smokeImportPack!(pack); await refreshPacks() }
      if (logoFile) { await window.api.smokeSetLogo!('HTH', logoFile); forgetLogo('HTH') } // the team's logo, above its column
      button(dialog, t('サーブの狙い'))!.click(); await sleep(400)
      button(dialog, t('作成'))!.click()
      const slide = await waitFor(() => latest.current.reel?.slides?.find(x => x.board?.config.skill === 'T') ?? null, 15000, 'serve target slide')
      await sleep(800)
      const texts = slide.annotations.flatMap(a => (a.kind === 'text' ? [a.text] : []))
      const names = texts.filter(x => /^#\d+ /.test(x))
      if (!names.length || !texts.includes('Zone1') || !texts.includes('Team RA') || texts.some(x => x.startsWith('All · Zone'))) throw new Error(`serve target: ${texts.slice(0, 20).join(' | ')}`)
      const images = slide.annotations.filter(a => a.kind === 'image')
      const teamX = slide.annotations.find(a => a.kind === 'text' && a.text === 'HTH')
      const logoAbove = !!logoFile && teamX?.kind === 'text' && images.some(a => a.kind === 'image' && Math.abs(a.x + a.w / 2 - teamX.x) < 0.01)
      if (logoFile && !logoAbove) throw new Error('no logo above the team column')
      return { team: slide.board!.config.team, heading: texts[0], receivers: names, pictures: images.length, logoAbove }
    }
    if (layout === 'rot') {
      // ローテーション: a slide per rotation, P1 P6 P5 P4 P3 P2, each with its players and tables.
      button(dialog, t('ローテーション'))!.click(); await sleep(400)
      const setter = dialog.querySelector<HTMLSelectElement>('.board-slot select')?.selectedOptions[0]?.textContent
      button(dialog, t('作成'))!.click()
      const slides = await waitFor(() => { const l = (latest.current.reel?.slides ?? []).filter(x => x.board?.config.skill === 'R'); return l.length === 6 ? l : null }, 10000, 'six rotation slides')
      await sleep(600)
      const each = slides.map(s => {
        const texts = s.annotations.flatMap(a => (a.kind === 'text' ? [a.text] : []))
        return { p: texts.find(x => /^P\d$/.test(x)), so: texts.find(x => x.startsWith('Side-out')), tables: texts.filter(x => /pass$|^CALL /.test(x)).length, discs: s.annotations.filter(a => a.kind === 'polygon' && a.disc?.part === 'top').length }
      })
      if (each.map(e => e.p).join() !== 'P1,P6,P5,P4,P3,P2') throw new Error(`rotations: ${JSON.stringify(each)}`)
      return { setter, each }
    }
    button(dialog, t('セット'))!.click(); await sleep(300)
    button(dialog, layout === 'rotation' ? t('ローテ別サイドアウト') : t('レセプション・コール別'))!.click(); await sleep(300)
    const setter = dialog.querySelector<HTMLSelectElement>('.board-slot select')?.selectedOptions[0]?.textContent
    const slotLabel = dialog.querySelector('.board-slot-no')?.textContent
    button(dialog, t('作成'))!.click()
    const slide = await waitFor(() => latest.current.reel?.slides?.find(x => x.board?.config.setLayout === layout) ?? null, 10000, 'setter slide')
    await sleep(600)
    const texts = slide.annotations.flatMap(a => (a.kind === 'text' ? [a.text] : []))
    const titles = layout === 'rotation' ? ['S1', 'S6', 'S5', 'S4', 'S3', 'S2'] : texts.filter(x => /Reception$/.test(x))
    if (layout === 'rotation' && !titles.every(x => texts.includes(x))) throw new Error(`rotation titles: ${texts.join(' | ')}`)
    return { setter, slotLabel, layout: slide.board!.config.setLayout, titles, counts: texts.filter(x => /^n \d+ · K/.test(x)), zone21: texts.filter(x => x === 'Zone2/1').length }
  }

  // A clip's right-click menu through its real rows and buttons: the menu shot; a clip copied to
  // another scene (the copy keeps its length, objects and markers; the source keeps it); another clip
  // moved (gone from the source); undo puts both scenes back; with exportTo, one clip exported alone.
  const smokeClipMenu = async (exportTo?: string) => {
    const start = latest.current.reels.find(r => Object.keys(r.clips).length >= 2 && latest.current.video?.sceneIds.includes(r.id))
    if (!start || latest.current.reels.length < 2) throw new Error('needs a scene with 2 clips in the video, and another scene')
    setReelId(start.id); await sleep(500)
    const rows = () => [...document.querySelectorAll<HTMLElement>('.reel-groups .clip-row:not(.slide-row)')]
    const menu = () => document.querySelector<HTMLElement>('.slide-menu')
    const item = (label: string) => [...menu()!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.startsWith(label)) ?? null
    // Opens the clip's menu on row i and returns that clip (a click makes it the open clip first).
    const rightClick = async (i: number) => {
      const el = (await waitFor(() => rows()[i] ?? null, 5000, `row ${i}`))
      el.click(); await sleep(200)
      const id = latest.current.activeClipId!
      const b = el.getBoundingClientRect()
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 60, clientY: b.top + b.height / 2 }))
      await waitFor(menu, 3000, 'menu')
      return latest.current.reel!.clips[id]
    }
    const into = async (label: string): Promise<string> => {
      item(label)!.click(); await sleep(200)
      const first = await waitFor(() => menu()!.querySelector<HTMLButtonElement>('.menu-scenes button'), 3000, 'scene list')
      await api.smokeShot!(`clip-menu-${label === t('別のシーンへ移動') ? 'move' : 'copy'}.png`)
      const name = first.title
      first.click(); await sleep(300)
      return latest.current.reels.find(r => r.name === name && r.id !== start.id)!.id
    }
    const sameIn = (sceneId: string, c: Clip) => findClip(latest.current.reels.find(r => r.id === sceneId)!, c.matchId, c.playId)
    // 0. With the real mouse: the menu closes on a click anywhere outside it (the video, the play
    // list, the scene list) and on Esc.
    const closes: Record<string, boolean> = {}
    const center = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] as [number, number] }
    for (const [what, act] of [
      ['video', () => api.smokeDrag!([center('video')])],
      ['play list', () => api.smokeDrag!([center('.sidebar')])],
      ['scene head', () => api.smokeDrag!([center('.reel-head')])],
      ['another row', () => { const r = rows()[3].getBoundingClientRect(); return api.smokeDrag!([[r.left + 30, r.top + r.height / 2]]) }],
      ['esc', () => api.smokeKey!('Escape')],
    ] as [string, () => Promise<void>][]) {
      const r = rows()[0].getBoundingClientRect()
      await api.smokeRightClick!(r.left + 60, r.top + r.height / 2)
      await waitFor(menu, 3000, `menu (real right click, before ${what})`)
      await act(); await sleep(300)
      closes[what] = !menu()
    }
    if (Object.values(closes).some(x => !x)) { await api.smokeShot!('clip-menu-stuck.png'); throw new Error(`menu stays open: ${JSON.stringify(closes)}`) }
    // 1. The menu, then a copy.
    const a = await rightClick(0)
    const labels = [...menu()!.querySelectorAll('button')].map(b => b.textContent)
    await api.smokeShot!('clip-menu.png')
    const before = latest.current.reels.map(r => ({ id: r.id, n: Object.keys(r.clips).length }))
    const toA = await into(t('別のシーンへコピー'))
    const copy = sameIn(toA, a)
    if (!copy || !latest.current.reel!.clips[a.id]) throw new Error('copy: not in the target, or gone from the source')
    const fresh = before.find(x => x.id === toA)!.n < Object.keys(latest.current.reels.find(r => r.id === toA)!.clips).length
    if (fresh && (copy.inSec !== a.inSec || copy.outSec !== a.outSec || copy.annotations.length !== a.annotations.length)) throw new Error(`copy lost its edits: ${JSON.stringify([copy.inSec, a.inSec, copy.annotations.length, a.annotations.length])}`)
    const copyMarkers = markersOf(latest.current.reels.find(r => r.id === toA)!, copy.id)
    // 2. A move.
    const b = await rightClick(1)
    const toB = await into(t('別のシーンへ移動'))
    if (!sameIn(toB, b) || latest.current.reel!.clips[b.id]) throw new Error('move: not in the target, or still in the source')
    const notice = latest.current.notice
    // 3. Undo: the move, then the copy, each one step for both scenes.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await sleep(300)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await sleep(300)
    const after = latest.current.reels.map(r => ({ id: r.id, n: Object.keys(r.clips).length }))
    const undone = JSON.stringify(after) === JSON.stringify(before)
    // 4. One clip alone.
    let exported: unknown = null
    if (exportTo) {
      const sc = latest.current.reels.find(r => r.id === start.id)!
      const g = groupOf(sc, a.id)!
      const job = await exportClip(sc.id, a.id, g, exportTo)
      await waitFor(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') || null, 180000, 'clip export')
      exported = { status: latest.current.exportState?.status, items: job?.items.map(it => it.kind), message: latest.current.exportState?.message }
    }
    return { clipMenu: { closes, labels, copied: { fresh, markers: copyMarkers, annotations: copy.annotations.length, trimmed: copy.inSec !== null || copy.outSec !== null }, moved: true, notice, undone, exported } }
  }

  const smokePresets = async (only: 'all' | 'serve' | 'block') => {
    const serveOnly = only === 'serve'
    const until = async <T,>(get: () => Promise<T | null>, label: string, ms = 10000): Promise<T> => {
      for (const end = Date.now() + ms; ;) { const v = await get(); if (v) return v; if (Date.now() > end) throw new Error(`timeout waiting for ${label}`); await sleep(100) }
    }
    const button = (root: ParentNode, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === label && !b.disabled) ?? null
    const dialog = () => document.querySelector<HTMLElement>('.preset-dialog')
    const open = async () => {
      (await waitFor(() => button(document, t('プリセットから作る')), 10000, 'preset button')).click()
      return waitFor(dialog, 5000, 'preset dialog')
    }
    // A segmented choice in the dialog, by its row's label and the option's text.
    const pick = async (label: string, option: string) => {
      const row = await waitFor(() => [...dialog()!.querySelectorAll('.filter-row')].find(r => r.querySelector('.field-label')?.textContent === label) ?? null, 5000, `${label} row`)
      ;(await waitFor(() => button(row, option), 5000, `${label}: ${option}`)).click()
      await sleep(150)
    }
    // The preview: each scene's title, total and markers ("name n").
    const preview = () => [...dialog()!.querySelectorAll('.preset-row')].map(r => ({
      title: r.querySelector('b')!.textContent!, total: parseInt(r.querySelector('.preset-total')!.textContent!),
      markers: [...r.querySelectorAll('.preset-marker:not(.muted)')].map(m => { const s = m.textContent!; const i = s.lastIndexOf(' '); return { name: s.slice(0, i), n: Number(s.slice(i + 1)) } }),
    }))
    const realConfirm = window.confirm
    window.confirm = () => true // 作り直す and 削除 ask first
    try {
      const code = latest.current.settings?.ourTeamCodes[0] ?? ''
      if (serveOnly) {
        // Serves: the order of servers and their markers chosen apart.
        await open()
        await pick(t('ビデオ'), t('サーブ'))
        await pick(t('選手の並べ方'), t('打数順'))
        await pick(t('マーカーの分け方'), t('ゾーン別'))
        const byZone = await waitFor(() => { const p = preview(); return p.length ? p : null }, 5000, 'preview rows')
        const names = new Set(byZone.flatMap(r => r.markers.map(m => m.name)))
        if ([...names].some(n => !['Zone1', 'Zone6', 'Zone5', t('ショート')].includes(n))) throw new Error(`zone markers: ${[...names].join(', ')}`)
        if (byZone.some((r, i) => i && r.total > byZone[i - 1].total)) throw new Error('servers not by count')
        await pick(t('マーカーの分け方'), t('時系列'))
        const byTime = preview()
        if (byTime.some(r => r.markers.length !== 1 || r.markers[0].n !== r.total)) throw new Error(`time markers: ${JSON.stringify(byTime.slice(0, 3))}`)
        await pick(t('マーカーの分け方'), t('ゾーン別'))
        return { byZone: byZone.slice(0, 4), timeRows: byTime.length, hint: dialog()!.querySelectorAll('.hint')[1]?.textContent }
      }
      if (only === 'block') {
        // Middles by reception, then by the opposing setter: fewer attacks (good receptions only),
        // markers back row / front row; made with the newest matches first.
        await open()
        await pick(t('ビデオ'), t('ブロック'))
        await pick(t('作り方'), t('ミドル別'))
        await pick(t('マーカーの分け方'), t('レセプション別'))
        const byPhase = await waitFor(() => { const p = preview(); return p.length ? p : null }, 5000, 'preview rows')
        await pick(t('マーカーの分け方'), t('相手セッター位置別'))
        const bySetter = preview()
        const names = new Set(bySetter.flatMap(r => r.markers.map(m => m.name)))
        if ([...names].some(n => n !== t('相手セッター後衛') && n !== t('相手セッター前衛'))) throw new Error(`setter markers: ${[...names].join(', ')}`)
        if (bySetter.some(r => r.markers.reduce((n, m) => n + m.n, 0) !== r.total)) throw new Error('unmarked attacks in a setter scene')
        if (bySetter.some((r, i) => i && r.total > bySetter[i - 1].total)) throw new Error('middles not by count')
        const good = new Map(byPhase.map(r => [r.title, r.markers.find(m => m.name === t('良いレセプション'))?.n ?? 0]))
        await pick(t('試合の並び'), t('新しい試合から'))
        await api.smokeShot!('preset-block-setter.png')
        const hints = [...dialog()!.querySelectorAll('.hint')].map(h => h.textContent)
        const before = new Set(latest.current.videos.map(v => v.id))
        button(dialog()!, t('作る'))!.click()
        const video = await waitFor(() => latest.current.videos.find(v => !before.has(v.id)) ?? null, 5000, 'new video')
        if (video.preset?.how.blockMarks !== 'setter' || video.preset.how.order !== 'new') throw new Error(`preset not kept: ${JSON.stringify(video.preset)}`)
        const rank = Object.keys(latest.current.matches) // oldest first
        const orders = video.sceneIds.map(id => {
          const s = latest.current.reels.find(r => r.id === id)!
          const seq = s.groups[1].map(c => rank.indexOf(s.clips[c].matchId))
          if (seq.some((x, i) => i && x > seq[i - 1])) throw new Error(`scene ${s.name}: matches not newest first ${seq.join(',')}`)
          return [...new Set(seq)].join('>')
        })
        await sleep(600)
        return { byPhase: byPhase.map(r => `${r.title} ${r.total} (good ${good.get(r.title)})`), bySetter: bySetter.map(r => `${r.title} ${r.total} (${r.markers.map(m => `${m.name} ${m.n}`).join(', ')})`), name: video.name, matchesInMarker1: orders, hints: hints.slice(0, 3) }
      }
      // 1. A block video by middle, for the target team.
      await open()
      await pick(t('ビデオ'), t('ブロック'))
      await pick(t('作り方'), t('ミドル別'))
      const rows = await waitFor(() => { const p = preview(); return p.length ? p : null }, 5000, 'preview rows')
      const before = new Set(latest.current.videos.map(v => v.id))
      button(dialog()!, t('作る'))!.click()
      const video = await waitFor(() => latest.current.videos.find(v => !before.has(v.id)) ?? null, 5000, 'new video')
      if (video.preset?.kind !== 'block' || video.preset.how.block !== 'middle') throw new Error(`preset not kept: ${JSON.stringify(video.preset)}`)
      const scenes = video.sceneIds.map(id => latest.current.reels.find(r => r.id === id)!)
      if (scenes.length !== rows.length) throw new Error(`${scenes.length} scenes, preview had ${rows.length}`)
      scenes.forEach((s, i) => {
        const row = rows[i]
        if (s.name !== `${code} ${t('ブロック')} ${row.title}` || s.cardTitle !== row.title || !s.sceneCard) throw new Error(`scene ${i}: ${s.name} / ${s.cardTitle}`)
        if (Object.keys(s.clips).length !== row.total) throw new Error(`scene ${s.name}: ${Object.keys(s.clips).length} clips, preview ${row.total}`)
        for (const m of row.markers) {
          const marker = Object.entries(s.markerNames).find(([, n]) => n === m.name)?.[0]
          const got = marker ? s.groups[Number(marker) as Marker].length : null
          if (got !== m.n) throw new Error(`scene ${s.name}: marker ${m.name} has ${got ?? 'no group'}, preview ${m.n}`)
        }
      })
      await until(async () => ((await api.listVideos()).find(v => v.id === video.id)?.preset ? true : null), 'video saved with its preset', SAVE_DELAY_MS + 10000)
      await api.smokeShot!('presets-made.png')

      // 2. Made again from 作り直す in 動画の構成: new scenes, the old ones gone (also from disk).
      ;(await waitFor(() => button(document.querySelector('.right-tabs')!, t('動画の構成')), 5000, 'video tab')).click()
      ;(await waitFor(() => button(document.querySelector('.video-panel') ?? document, t('作り直す')), 5000, 'remake button')).click()
      const remade = await waitFor(() => { const v = latest.current.videos.find(x => x.id === video.id); return v && v.sceneIds.every(id => !video.sceneIds.includes(id)) ? v : null }, 10000, 'remade')
      if (remade.sceneIds.length !== video.sceneIds.length) throw new Error(`remade with ${remade.sceneIds.length} scenes, had ${video.sceneIds.length}`)
      await waitFor(() => (video.sceneIds.every(id => !latest.current.reels.some(r => r.id === id)) ? true : null), 10000, 'old scenes gone')
      await until(async () => { const ids = (await api.listReels()).map(r => r.id); return video.sceneIds.every(id => !ids.includes(id)) && remade.sceneIds.every(id => ids.includes(id)) ? true : null }, 'remade scenes on disk', SAVE_DELAY_MS + 10000)

      // 3. A position set by hand: attack by position, an outside hitter made a middle, then undone.
      await open()
      await pick(t('ビデオ'), t('アタック'))
      await pick(t('作り方'), t('ポジション別'))
      const mbTotal = () => preview().find(r => r.title === t('ミドルブロッカー'))?.total ?? 0
      const mbBefore = mbTotal()
      const details = await waitFor(() => dialog()!.querySelector<HTMLDetailsElement>('.preset-roles'), 5000, 'positions')
      details.open = true
      await sleep(150)
      // One who attacked: a marker of the outside hitters' scene.
      const hitters = new Set(preview().find(r => r.title === t('アウトサイドヒッター'))?.markers.map(m => m.name) ?? [])
      const sel = await waitFor(() => [...details.querySelectorAll<HTMLSelectElement>('.preset-role select')].find(s => s.options[0].textContent?.includes(t('アウトサイドヒッター')) && hitters.has(s.closest('label')!.querySelector('span')!.textContent!)) ?? null, 5000, 'an outside hitter who attacked')
      const who = sel.closest('label')!.querySelector('span')!.textContent!
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, 'MB')
      sel.dispatchEvent(new Event('change', { bubbles: true }))
      const saved = await until(async () => { const r = (await api.getProject())?.settings.roles; return r && Object.values(r).includes('MB') ? r : null }, 'position saved')
      const mbAfter = await waitFor(() => (mbTotal() > mbBefore ? mbTotal() : null), 5000, 'the player counted as a middle')
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
      await until(async () => (!(await api.getProject())?.settings.roles ? true : null), 'position undone')
      await waitFor(() => (mbTotal() === mbBefore ? true : null), 5000, 'preview back')
      button(dialog()!, t('キャンセル'))!.click()

      // 4. Deleted with the scenes only it uses.
      const panel = await waitFor(() => document.querySelector('.video-panel'), 5000, 'video panel')
      ;(await waitFor(() => button(panel, t('削除')), 5000, 'delete button')).click()
      const onDisk = async () => { const vs = await api.listVideos(), ids = (await api.listReels()).map(r => r.id); return { video: vs.some(v => v.id === video.id), scenes: remade.sceneIds.filter(id => ids.includes(id)).length } }
      await until(async () => { const d = await onDisk(); return !d.video && !d.scenes ? true : null }, 'video and scenes deleted', SAVE_DELAY_MS + 10000)

      // 5. Ctrl+Z puts the video and its scenes back (saved anew), Ctrl+Y deletes them again.
      const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, bubbles: true }))
      key('z')
      await until(async () => { const d = await onDisk(); return d.video && d.scenes === remade.sceneIds.length ? true : null }, 'deletion undone on disk', SAVE_DELAY_MS + 10000)
      if (!latest.current.videos.some(v => v.id === video.id && v.sceneIds.join() === remade.sceneIds.join())) throw new Error('undone video lacks its scenes')
      key('y')
      await until(async () => { const d = await onDisk(); return !d.video && !d.scenes ? true : null }, 'deletion redone', SAVE_DELAY_MS + 10000)
      return { presets: { scenes: rows.map(r => `${r.title} ${r.total} (${r.markers.map(m => `${m.name} ${m.n}`).join(', ')})`), remade: remade.sceneIds.length, position: { who, saved: Object.keys(saved).length, middles: [mbBefore, mbAfter] }, deleted: true, undoRedo: true } }
    } finally {
      window.confirm = realConfirm
    }
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
    await openPanel('objects') // the slider is in the objects panel under the video
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

    // With VR_SMOKE_EXPORT: the scene in a video, exported (the court goes in as the player shows it).
    let exported: unknown = null
    if (exportTo) {
      updateReel(toggleMarker(latest.current.reel!, ids[0], 1)) // the scene plays marked clips only
      await waitFor(() => latest.current.order.length === 1 || null, 10000, 'marked clip')
      const v = newVideo('court smoke', [built.id])
      setVideos(vs => [...vs, v]); setVideoId(v.id)
      await waitFor(() => latest.current.video?.id === v.id || null, 10000, 'court video')
      activateClip(latest.current.reel!.clips[ids[0]]); await sleep(400)
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
    await openPanel('objects') // the object tools (freehand, show times) are in the panel under the video
    const canvas = await waitFor(() => document.querySelector<HTMLCanvasElement>('[data-testid=ann-canvas]'), 20000, 'canvas')
    // Measured on every event: the panels under the video change size as objects are drawn and picked.
    const pt = (x: number, y: number) => { const box = canvas.getBoundingClientRect(); return { clientX: box.left + x * box.width, clientY: box.top + y * box.height, bubbles: true, pointerId: 1 } }
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

    ;(document.activeElement as HTMLElement | null)?.blur() // out of the text box, as a click elsewhere would: keys go to the tools again
    await key('v'); await stroke([[0.7, 0.21], [0.72, 0.23], [0.75, 0.26]]) // drag the rect by its top edge
    const rect = anns().find(a => a.kind === 'rect')

    await stroke([[0.4, 0.4]]) // select the arrow
    const selAfterClick = latest.current.selectedAnn
    // The arrow keys nudge it: three presses right, one Shift+Down (five times as far), and back.
    const arrowAt = () => { const a = anns().find(x => x.kind === 'arrow') as { x1: number; y1: number } | undefined; return a ? [a.x1, a.y1] : [NaN, NaN] }
    const press = async (k: string, shift = false) => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true })); await sleep(80) }
    const [nx0, ny0] = arrowAt()
    for (let i = 0; i < 3; i++) await press('ArrowRight')
    await press('ArrowDown', true)
    const [nx1, ny1] = arrowAt()
    const nudged = { dx: Math.round((nx1 - nx0) * 1920), dy: Math.round((ny1 - ny0) * 1080), playerTime: playback.current.time }
    for (let i = 0; i < 3; i++) await press('ArrowLeft')
    await press('ArrowUp', true)
    const [nx2, ny2] = arrowAt()
    if (nudged.dx !== 6 || nudged.dy !== 10 || Math.abs(nx2 - nx0) > 1e-6 || Math.abs(ny2 - ny0) > 1e-6) throw new Error(`arrow-key nudge: ${JSON.stringify({ nudged, back: [nx2 - nx0, ny2 - ny0] })}`)
    await playback.seekAndWait(range.in + 3)
    // The object tools' button (the headline bar has one of the same name: told apart by its tooltip).
    const btn = await waitFor(() => document.querySelector<HTMLButtonElement>(`button[title="${t('今の再生位置から表示する')}"]`), 5000, () => `ここから表示 (selected: ${latest.current.selectedAnn}, objects: ${anns().map(x => `${x.kind}:${x.id.slice(0, 4)}`).join(' ')}, panel tabs: ${[...document.querySelectorAll('.stage-tabs button[aria-selected=true]')].map(b => b.textContent).join('/')}, drawn: ${drawn.join(',')}, after click: ${selAfterClick}, rect: ${JSON.stringify(rect && { x: (rect as { x?: number }).x, y: (rect as { y?: number }).y })})`)
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
      alphaBefore, alphaAfter, savedAnnotations: saved?.clips[ids[0]].annotations.length ?? 0, nudged,
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
