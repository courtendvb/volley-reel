import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FILTER, type PlayFilter, type PlayRef } from '../../shared/filter'
import { effectName, playLabel } from '../../shared/labels'
import {
  DEFAULT_RANGE, addClips, clipRange, defaultRange, findClip, findOverlaps, groupRows, markersOf, playOrder, rangeDefaults, setOverlayOverride, setServeSpeed, setSkillTime, setSlide, setTag, setTiming, spotAt, toggleMarker, trimClip,
  type Clip, type ClipMode, type Group, type Marker, type Reel, type Slide,
} from '../../shared/reel'
import type { ImportProgress, ParsedDVW, Play, ProjectInfo } from '../../shared/types'
import { CheckPicker } from './components/CheckPicker'
import { ShotPick, type ShotRow } from './components/ShotPick'
import { FilterPanel } from './components/FilterPanel'
import { PlayList, type PlayKey } from './components/PlayList'
import { ReelPanel, type ClipInfo } from './components/ReelPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { TrimBar } from './components/TrimBar'
import { RIGHT_TABS, RightTabs, type RightTab } from './components/RightTabs'
import { AnnotationLayer, type AnnStyle, type Tool } from './components/AnnotationLayer'
import { AnnotationTools, KIND_LABEL } from './components/AnnotationTools'
import { HeadlineBar } from './components/HeadlineBar'
import { ObjectTimeline } from './components/ObjectTimeline'
import { mergeScoped, scopeOf, type ScopedAnnotations } from '../../shared/annotationScope'
import { captionData, overlaySettings, scoreboardData, type CaptionData, type OverlaySettings, type ScoreboardData } from '../../shared/overlay'
import { OverlayLayer } from './components/OverlayLayer'
import { OverlayDialog } from './components/OverlayDialog'
import { ClipOverlayRow } from './components/ClipOverlayRow'
import { addScene, planScene, planVideo, type Card, type PlanItem } from '../../shared/video'
import { assetImage, packAssetId } from './assets'
import type { ImageLookup } from '../../shared/annotation'
import { CardEditBar, CardEditor, BoardEditBar, SlideEditBar, type CardInserts, type SlideMark } from './components/CardEditor'
import { cardPlayers, cardTeams, fillPlanFrames, topPhoto } from '../../shared/cardPeople'
import { FadeLayer } from './components/FadeLayer'
import { PalettePanel } from './components/PalettePanel'
import { PlayerPhotos } from './components/PlayerPhotos'
import { ExportPanel } from './components/ExportPanel'
import { VideoPanel } from './components/VideoPanel'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { PresetDialog } from './components/PresetDialog'
import { usePresetVideos } from './app/usePresetVideos'
import { Home, MissingNote } from './components/Home'
import { ScanDialog } from './components/ScanDialog'
import { MatchPicker } from './components/MatchPicker'
import { VideoPane } from './components/VideoPane'
import { CourtLayer } from './components/CourtLayer'
import { CourtBar } from './components/CourtBar'
import { MatchReportDialog } from './components/MatchReportDialog'
import { DEFAULT_CHART, chartName, setChartColors } from '../../shared/chart'
import { setterCall } from '../../shared/setChart'
import { BoardDialog } from './components/BoardDialog'
import { DEFAULT_GRID_STYLE, cleanGridStyle, markStyle, marksBySkill, floorAt, homography, nearestShots, project as onPicture, serveSpeed, flightTiming, playMarks, playerMarks, zoneAt, zoneOfCell, type CourtFit, type GridStyle, type Pt } from '../../shared/court'
import type { SmokeHost } from './smoke'
import { playback, type SequenceItem } from './playback'
import { t } from '../../shared/i18n'
import { captionPhoto, findPhoto } from '../../shared/pack'
import { usePacks } from './packs'
import { playMaximized } from './maximize'
import { clipPlayedSec } from '../../shared/timing'
import { markerFor, missingOf, overlaySample, type AppLatest } from './app/appState'
import { SAVE_DELAY_MS } from './app/useAutosave'
import { useUpdates } from './app/useUpdates'
import { useSceneStore } from './app/useSceneStore'
import { useCardEdit } from './app/useCardEdit'
import { useObjects } from './app/useObjects'
import { useSlides } from './app/useSlides'
import { useProjectFlow } from './app/useProjectFlow'
import { usePlaySearch } from './app/usePlaySearch'
import { useSlideFiles } from './app/useSlideFiles'
import { useExport } from './app/useExport'
import { useShortcuts } from './app/useShortcuts'
import { Banners } from './app/Banners'
import { STAGE_PANELS, StageTabs, type StagePanel } from './components/StageTabs'

const api = window.api
// The main process loads the page with ?smoke when it runs a self-check (VR_SMOKE).
const SMOKE = new URLSearchParams(location.search).has('smoke')
const PREROLL_SEC = 2 // jump a little before the contact so the play is seen building up



export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [dvws, setDvws] = useState<Record<string, ParsedDVW>>({})
  const [matchId, setMatchId] = useState<string | null>(null)
  const [shotPick, setShotPick] = useState<{ at: Pt; rows: ShotRow[]; zone: number | null } | null>(null) // a click on the heatmap
  const [matchIds, setMatchIds] = useState<string[]>([]) // the matches the list shows; none picked: all of the project's
  // How plays added from the search are cut: around the key play, or from it to the end of the rally.
  const [extract, setExtract] = useState<ClipMode>(() => { try { return localStorage.getItem('vr.extract') === 'toEnd' ? 'toEnd' : 'keyplay' } catch { return 'keyplay' } })
  useEffect(() => { try { localStorage.setItem('vr.extract', extract) } catch { /* not kept */ } }, [extract])
  const extractRef = useRef(extract)
  extractRef.current = extract
  // With all matches listed: the order of the matches (each keeps its plays in time order).
  const [matchOrder, setMatchOrder] = useState<'old' | 'new'>(() => { try { return localStorage.getItem('vr.matchOrder') === 'new' ? 'new' : 'old' } catch { return 'old' } })
  useEffect(() => { try { localStorage.setItem('vr.matchOrder', matchOrder) } catch { /* not kept */ } }, [matchOrder])
  const [filter, setFilter] = useState<PlayFilter>(EMPTY_FILTER)
  const packs = usePacks() // player photos, for the caption's photo
  const packsRef = useRef(packs)
  packsRef.current = packs
  const [selected, setSelected] = useState<PlayKey | null>(null)
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  // The marker group the open clip was opened from (a clip can be in several); null = its first.
  const [activeGroup, setActiveGroup] = useState<Group | null>(null)
  const [playingClipId, setPlayingClipId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [annTool, setAnnTool] = useState<Tool>('select')
  // Edit Points mode belongs to one selection; picking another object leaves it.
  const [editPoints, setEditPoints] = useState(false)
  const [annStyle, setAnnStyle] = useState<AnnStyle>({ color: '#EF4444', width: 6, size: 36 }) // red by default
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null)
  const [cropping, setCropping] = useState(false) // the selected picture is being cropped
  // More objects picked with Shift+click: moved, deleted and grouped with the selected one.
  const [extraSel, setExtraSel] = useState<string[]>([])
  const extraSelRef = useRef(extraSel)
  extraSelRef.current = extraSel
  const selectAnn = useCallback((id: string | null) => { setSelectedAnn(id); setExtraSel([]) }, [])
  const toggleExtra = useCallback((id: string) => setExtraSel(xs => (xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id])), [])
  useEffect(() => { setEditPoints(false); setCropping(false) }, [selectedAnn])
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // The latest state for callbacks and steps in the same tick; filled in on every render below.
  const latest = useRef<AppLatest>({ overlayData: null, exportState: null, notice: null, dvwsRef: null, library: null, projectPath: null, activeGroup: null } as AppLatest)
  const {
    reels, setReels, reelId, setReelId, videos, setVideos, videoId, setVideoId, reel, video,
    saveState, flushAll, markSaved, record, undoRedo, clearHistory,
    putVideo, addScenes, addVideo, showScene, removeScenes, sceneSnap, videoSnap,
    updateReel, updateVideo, updateScene, withReel, makeScene, deleteReel, createVideo, scenesOnlyIn, selectVideo, deleteVideo,
  } = useSceneStore({ latest, setActiveClipId, setProject, setError })
  const { staleSlides, checkSlideFiles, laterSlides, reloadSlideFiles } = useSlideFiles(() => latest.current.reels, updateReel, setProgress, setNotice)
  const {
    library, setLibrary, recent, scan, setScan, picker, setPicker, loadProject,
    openProject, goHome, chooseLibrary, scanFolders, importPairs, relocate, importOne, pickerDone, projectTeams, saveSettings,
  } = useProjectFlow({
    latest, project, setProject, setDvws, setMatchId, setMatchIds, setFilter, setSelected, setActiveClipId, setReels, setReelId, setVideos, setVideoId,
    setError, setNotice, setProgress, markSaved, clearHistory, flushAll, record, checkSlideFiles,
  })
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  // The court grid's look is this computer's, for every match; the corners belong to each match.
  const [gridStyle, setGridStyle] = useState<GridStyle>(() => { try { return cleanGridStyle(JSON.parse(localStorage.getItem('vr.courtGrid') ?? '{}')) } catch { return marksBySkill(DEFAULT_GRID_STYLE) } })
  useEffect(() => { try { localStorage.setItem('vr.courtGrid', JSON.stringify(gridStyle)) } catch { /* not kept */ } }, [gridStyle])
  const [courtFitting, setCourtFitting] = useState(false)
  // The right column's tab, kept on this computer.
  const [rightTab, setRightTab] = useState<RightTab>(() => { try { const r = localStorage.getItem('vr.rightTab'); return RIGHT_TABS.find(x => x === r) ?? 'scene' } catch { return 'scene' } })
  useEffect(() => { try { localStorage.setItem('vr.rightTab', rightTab) } catch { /* not kept */ } }, [rightTab])
  // The one panel under the video (StageTabs), or none for the biggest video; kept on this computer.
  const [stagePanel, setStagePanel] = useState<StagePanel | null>(() => { try { const v = localStorage.getItem('vr.stagePanel'); return v === 'none' ? null : (STAGE_PANELS as readonly string[]).includes(v ?? '') ? v as StagePanel : v === 'display' || v === 'court' ? 'view' : 'edit' } catch { return 'edit' } })
  useEffect(() => { try { localStorage.setItem('vr.stagePanel', stagePanel ?? 'none') } catch { /* not kept */ } }, [stagePanel])
  // An object picked on the video (or a headline's 書式) opens the objects panel, unless the trim panel is up (its lanes show the object's times).
  const showObjects = () => setStagePanel('objects')
  const gridStyleRef = useRef(gridStyle)
  gridStyleRef.current = gridStyle

  const matches = useMemo(() => Object.fromEntries((project?.matches ?? []).map(m => [m.id, m])), [project])
  const match = matchId ? matches[matchId] ?? null : null
  useEffect(() => setCourtFitting(false), [matchId])
  // Shown at once, then saved to the match in the library.
  // The court found in the video, left open for the corners to be finished by hand.
  const autoFit = async (id: string) => {
    try {
      const corners = await api.detectCourt(id)
      if (!corners) { setNotice(t('コートを見つけられませんでした。四隅を手で合わせてください')); return }
      setCourt(id, { corners, nearSet1: matches[id]?.court?.nearSet1 ?? '*' })
      setCourtFitting(true)
      setNotice(t('コートの候補を置きました。線に合っているか確かめて、ずれていれば四隅を直してください'))
    } catch (e) {
      setError(String(e))
    }
  }
  const setCourt = (id: string, court: CourtFit | null) => {
    setProject(p => p && { ...p, matches: p.matches.map(m => (m.id !== id ? m : court ? { ...m, court } : (({ court: _c, ...rest }) => rest)(m))) })
    void api.setMatchCourt(id, court).then(p => p && setProject(p)).catch(err => setError(String(err)))
  }
  const chartColors = { lines: project?.settings.lineColors, points: project?.settings.pointColors, pointScale: project?.settings.pointScale }
  setChartColors(chartColors) // before anything below draws a chart
  const lineKey = JSON.stringify(chartColors) // charts already drawn are drawn again
  const selectedPlay = match && selected?.matchId === match.id ? dvws[match.id]?.plays[selected.playId] ?? null : null
  const nextPlay = selectedPlay && match ? dvws[match.id]?.plays[selectedPlay.id + 1] ?? null : null

  const settings = project?.settings
  // The setter calls coded in the matches (K1, KA...), with their names, for the set filter on the 表示 tab.
  const setterCalls = useMemo(() => {
    const names: Record<string, string> = Object.assign({}, ...Object.values(dvws).map(d => d.codeNames))
    const codes = new Set(Object.values(dvws).flatMap(d => d.plays.filter(p => p.skill === 'E').map(setterCall)).filter(Boolean))
    return [...codes].sort().map(code => ({ code, ...(names[code] ? { name: names[code] } : {}) }))
  }, [dvws])
  const { refsByMatch, scopeRefs, results, people, details, teamFilterLimited, dirUnknown, matchRank, matchLabels } = usePlaySearch(project, dvws, matchIds, matchOrder, filter)
  const courtZones = useMemo(() => (match?.court && selectedPlay
    ? playMarks(selectedPlay, match.court, nextPlay, gridStyle, () => Object.values(dvws).flatMap(d => d.plays), { filtered: () => results.map(r => r.play), name: chartName(dvws[match.id], selectedPlay), setterName: set => chartName(dvws[match.id], set) })
    : null), [match?.court, selectedPlay, nextPlay, gridStyle.bySkill, gridStyle.coneColor, lineKey, Object.values(gridStyle.bySkill ?? {}).some(m => m?.chart?.scope === 'filter') ? results : null, dvws])

  const missing = useMemo(() => (reel ? missingOf(reel, dvws) : new Set<string>()), [reel, dvws])
  // A clip's range uses its own scene's length defaults, so a video mixing scenes stays right.
  const infoFor = useCallback((c: Clip, scene: Reel | null): ClipInfo => {
    const m = matches[c.matchId], d = dvws[c.matchId], play = d?.plays[c.playId]
    const defaults = scene ? rangeDefaults(scene) : undefined
    return {
      ref: refsByMatch[c.matchId]?.[c.playId],
      range: d && m ? clipRange(c, d, m.offsetSec, defaults) : null,
      def: d && m && play ? defaultRange(d, play, m.offsetSec, defaults, c.mode) : null,
      matchLabel: matchLabels[c.matchId] ?? '?',
      matchKey: matchRank[c.matchId] ?? '9999',
    }
  }, [matches, dvws, refsByMatch, matchLabels, matchRank])
  const clipInfo = useCallback((c: Clip): ClipInfo => infoFor(c, reel), [infoFor, reel])
  // A scene's clips in play order (its scope), leaving out clips that can't be played.
  // A scene's play order and stats are asked for many times per render (the scene editor, the
  // video's scene list, the plan, the export choices); scenes are immutable, so each result is kept
  // per scene object (and dropped with it) until the DVWs or the matches change.
  // A clip's [match in list order, IN time] in a scene: where a newly marked clip goes in its group.
  const whenIn = (s: Reel) => (c: Clip): [string, number] => { const i = latest.current.infoFor(c, s); return [i.matchKey, i.range?.in ?? 0] }
  const orderMemo = useMemo(() => new WeakMap<Reel, Clip[]>(), [dvws, infoFor])
  const orderOf = useCallback((s: Reel): Clip[] => {
    const hit = orderMemo.get(s)
    if (hit) return hit
    const miss = missingOf(s, dvws)
    const o = playOrder(s, c => { const i = infoFor(c, s); return [i.matchKey, i.range?.in ?? 0] }).filter(c => !miss.has(c.id) && infoFor(c, s).range)
    orderMemo.set(s, o)
    return o
  }, [dvws, infoFor, orderMemo])
  const statsMemo = useMemo(() => new WeakMap<Reel, { clips: number; sec: number }>(), [orderOf])
  const sceneStats = useCallback((s: Reel) => {
    const hit = statsMemo.get(s)
    if (hit) return hit
    const o = orderOf(s)
    const st = { clips: o.length, sec: o.reduce((t, c) => { return t + clipPlayedSec(infoFor(c, s).range!, c.timing) }, 0) }
    statsMemo.set(s, st)
    return st
  }, [orderOf, infoFor, statsMemo])
  const order = useMemo(() => {
    if (!reel) return []
    return playOrder(reel, c => { const i = clipInfo(c); return [i.matchKey, i.range?.in ?? 0] })
      .filter(c => !missing.has(c.id) && clipInfo(c).range)
  }, [reel, clipInfo, missing])
  const orderSec = useMemo(() => order.reduce((s, c) => s + clipPlayedSec(clipInfo(c).range!, c.timing), 0), [order, clipInfo])
  // Clips of one match whose ranges overlap (e.g. two plays of the same rally): warned, both kept.
  const overlaps = useMemo(() => {
    if (!reel) return new Map<string, string[]>()
    return findOverlaps(Object.values(reel.clips).flatMap(c => {
      const r = clipInfo(c).range
      return r ? [{ id: c.id, matchId: c.matchId, ...r }] : []
    }))
  }, [reel, clipInfo])

  const overlapsRef = useRef(overlaps)
  overlapsRef.current = overlaps

  // Plays in the current scene -> their markers as "1,3" ('' = in the scene without a marker).
  const reelGroups = useMemo(() => {
    const out = new Map<string, string>()
    if (reel) for (const c of Object.values(reel.clips)) out.set(`${c.matchId}:${c.playId}`, markersOf(reel, c.id).join(','))
    return out
  }, [reel])

  const addPlays = useCallback((refs: PlayRef[], group: Group = 'none') => {
    withReel(r => addClips(r, refs.map(x => ({ matchId: x.matchId, play: x.play })), group, extractRef.current).reel)
  }, [withReel])
  // The court's marks on a slide: taken from the play selected in the list, and fixed there.
  const slideTarget = selectedPlay && match?.court ? `#${selectedPlay.jersey} ${playLabel(selectedPlay.skill, selectedPlay.effect)}` : null
  const markSlide = (s: Slide, mark: SlideMark, on: boolean) => {
    const r = latest.current.reel
    if (!r) return
    if (!on) { const { [mark]: _gone, ...rest } = s; updateReel(setSlide(r, rest as Slide)); return }
    const fit = match?.court
    if (!selectedPlay || !fit) return
    const all = () => Object.values(dvws).flatMap(d => d.plays)
    const shots = playerMarks(selectedPlay, fit, { ...DEFAULT_GRID_STYLE, heat: true, landings: true, serveFlights: true, cones: true, coneColor: gridStyle.coneColor, chart: markStyle(gridStyle, selectedPlay.skill).chart ?? DEFAULT_CHART }, all, { filtered: () => latest.current.results.map(r => r.play), name: chartName(dvws[match!.id], selectedPlay) })
    const add: Partial<Slide> | null = mark === 'zones' ? { zones: { fit, zones: playMarks(selectedPlay, fit, nextPlay), detail: gridStyle.detail } }
      : mark === 'heat' && shots?.heat ? { heat: { fit, points: shots.heat.points, ...(shots.heat.rough ? { rough: shots.heat.rough } : {}) } }
      : mark === 'landings' && shots?.landings ? { landings: { fit, points: shots.landings.points, ...(shots.landings.rough ? { rough: shots.landings.rough } : {}) } }
      : mark === 'flights' && shots?.flights ? { flights: shots.flights }
      : mark === 'cones' && shots?.cones ? { cones: shots.cones }
      : mark === 'chart' && shots?.chart ? { chart: shots.chart }
      : null
    if (add) updateReel(setSlide(r, { ...s, ...add }))
    else setNotice(mark === 'flights' ? t('サーブ軌道はサーブを選ぶと載せられます') : mark === 'cones' ? t('コーンはアタックを選ぶと載せられます') : t('サーブかアタックを選ぶと載せられます'))
  }
  // A shot on the court: the row it has in the list of its match.
  const goToShot = (p: Play) => {
    setShotPick(null)
    for (const id of Object.keys(dvws)) if (dvws[id].plays[p.id] === p) { const r = refsByMatch[id]?.[p.id]; if (r) jump(r); return }
  }
  // A click on the court tab's marks: a landing point goes to that shot; the heatmap offers the
  // shots nearest to the click. Anything else is left to the layers above.
  const courtClick = (at: Pt) => {
    const marks = courtZones?.player, fit = match?.court
    setShotPick(null)
    if (!marks || !fit) return false
    if (marks.landings) {
      const H = homography(fit.corners), w = match!.width, h = match!.height
      const away = marks.landings.points.map(p => { const q = onPicture(H, p.x, p.y); return Math.hypot((q.x - at.x) * w, (q.y - at.y) * h) })
      const i = away.indexOf(Math.min(...away))
      if (away[i] < w / 80) { goToShot(marks.landings.plays[i]); return true }
    }
    const floor = marks.heat && marks.heat.points.length ? floorAt(fit, at) : null
    if (!floor || floor.x < -0.15 || floor.x > 1.15 || floor.y < -0.15 || floor.y > 1.15) return false
    const heat = marks.heat!
    const rows = nearestShots(heat.points, floor, 5).map(i => {
      const p = heat.plays[i], id = Object.keys(dvws).find(m => dvws[m].plays[p.id] === p)
      return { play: p, label: `${id ? matchLabels[id] ?? '' : ''} S${p.setNum} ${p.score.home}-${p.score.away} ${effectName(p.skill, p.effect)}` }
    })
    setShotPick({ at, rows, zone: zoneAt(floor) })
    return true
  }
  // Everything of this player's that landed in the zone clicked, in the list.
  const zoneList = () => {
    const p = shotPick?.rows[0]?.play
    if (!p || shotPick?.zone === null) return
    setMatchIds([])
    setFilter({ ...EMPTY_FILTER, skills: [p.skill], persons: [p.playerKey], endZones: [shotPick!.zone!] })
    setShotPick(null)
  }
  // The 1–5 buttons on a list row: add the play to the scene with that marker (again: clear it).
  const markPlay = useCallback((ref: PlayRef, m: Marker) => {
    withReel(r => {
      const { reel: next, ids } = addClips(r, [{ matchId: ref.matchId, play: ref.play }], 'none', extractRef.current)
      return toggleMarker(next, ids[0], m, whenIn(next))
    })
  }, [withReel])

  // The project's colors win over the video's (videos made before project colors keep their own).
  const overlay = useMemo(() => {
    const o = overlaySettings(video?.overlay)
    return project?.settings.theme ? { ...o, theme: project.settings.theme } : o
  }, [video?.overlay, project?.settings.theme])
  latest.current = { ...latest.current, results, filter, matches, reels, reelId, reel, videos, videoId, video, orderOf, infoFor, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, notice, dvwsRef: dvws, library, activeGroup }
  const { presetOpen, setPresetOpen, presetLook, makePresetVideo, remakePresetVideo } = usePresetVideos({
    latest, dvws, roles: settings?.roles, team: settings?.ourTeamCodes[0] ?? '', scopeRefs, results,
    addScenes, addVideo, putVideo, scenesOnlyIn, removeScenes, showScene, setNotice, record, sceneSnap, videoSnap,
  })
  const { appVersion, update, updateLater, setUpdateLater, updateBusy, restartToUpdate } = useUpdates(flushAll,
    () => { const st = latest.current.exportState?.status; return st === 'running' || st === 'preparing' }, setError)

  // ---- navigation ---------------------------------------------------------------------------
  // Stable identity so memoized rows don't re-render. A play in another match switches the video
  // first; playback.seekIn holds the seek until that match's video is ready.
  // With 切り出し = プレー前後, a play picked in the list plays its key-play window and then the
  // next play in the list follows on its own (listRun), until the list ends or something else is played.
  const listRunRef = useRef<{ matchId: string; playId: number; start: number; end: number } | null>(null)
  const [listRun, setListRun] = useState(false)
  // Which list the Up / Down keys walk: the one clicked last (left: plays, right: the scene's clips).
  const focusPane = useRef<'list' | 'scene'>('list')
  const [loopOn, setLoopOn] = useState(true) // the trim bar's ループ再生 box: off lets the clip play on past OUT
  const stopListRun = useCallback(() => { listRunRef.current = null; setListRun(false) }, [])
  const jump = useCallback((r: PlayRef) => {
    const m = latest.current.matches[r.matchId]
    if (!m) return
    setSelected({ matchId: r.matchId, playId: r.play.id })
    const c = latest.current.reel && findClip(latest.current.reel, r.matchId, r.play.id)
    setActiveClipId(c ? c.id : null)
    setMatchId(r.matchId)
    const t = r.play.time + m.offsetSec
    if (extractRef.current === 'keyplay') {
      const d = latest.current.reel ? rangeDefaults(latest.current.reel) : DEFAULT_RANGE
      listRunRef.current = { matchId: r.matchId, playId: r.play.id, start: t - d.keyBefore, end: t + d.keyAfter }
      setListRun(true)
      playback.seekIn(r.matchId, Math.max(0, t - d.keyBefore), { play: true })
      return
    }
    stopListRun()
    playback.seekIn(r.matchId, t - PREROLL_SEC, { play: true })
  }, [stopListRun])
  const jumpRef = useRef(jump)
  jumpRef.current = jump
  useEffect(() => playback.subscribe(s => {
    const run = listRunRef.current
    // Only inside this play's window: right after a jump the time can still be the old one.
    if (!run || s.paused || playback.attachedKey !== run.matchId || s.time < run.end || s.time > run.end + 3 || s.time < run.start) return
    const res = latest.current.results
    const i = res.findIndex(x => x.matchId === run.matchId && x.play.id === run.playId)
    const next = i >= 0 ? res[i + 1] : undefined
    listRunRef.current = null
    if (next) jumpRef.current(next)
    else { setListRun(false); playback.pause() }
  }), [])

  const activateClip = useCallback((c: Clip, g?: Group) => {
    stopListRun()
    setActiveGroup(g ?? null)
    const range = latest.current.clipInfo(c).range
    setActiveClipId(c.id)
    setSelected({ matchId: c.matchId, playId: c.playId })
    if (!range) return
    setMatchId(c.matchId)
    playback.seekIn(c.matchId, range.in, { play: true })
  }, [])

  // The plan both the through-play and the export follow: a whole video (scenes with their cards),
  // or one scene on its own for previewing it.
  // A title card's photo frame: the photo of the player with the most clips of its marker (a marker
  // card), its scene (a scene card) or the video (the video's card), from the packs; null without one.
  const cardFramePhoto = useCallback((card: Card): string | null => {
    const { reels: rs, video: v, dvwsRef: ds } = latest.current
    const scenes = card.scene ? rs.filter(r => r.id === card.scene) : (v?.sceneIds ?? []).flatMap(id => rs.filter(r => r.id === id))
    const clips = scenes.flatMap(r => (card.marker !== null && card.scene ? r.groups[card.marker as Marker] ?? [] : Object.keys(r.clips)).map(id => r.clips[id]).filter(Boolean))
    return topPhoto(clips, ds ?? {}, cp => { const ph = findPhoto(packsRef.current, cp.player, cp.team); return ph ? packAssetId(ph.pack, ph.player.photo) : null })
  }, [])
  const currentPlan = useCallback((target: 'video' | 'scene'): PlanItem[] => {
    const { video: v, reel: r, reels: rs, overlay: ov, matches: ms, settings: st, orderOf: of } = latest.current
    const codes = st?.ourTeamCodes ?? []
    const plan = target === 'scene' ? (r ? planScene(of(r), r, ov, ms, codes) : []) : v ? planVideo(v, Object.fromEntries(rs.map(s => [s.id, s])), of, ov, ms, codes) : []
    return fillPlanFrames(plan, cardFramePhoto)
  }, [cardFramePhoto])

  // startAt and the reported index count clips, not cards. The scene editor follows the scene of
  // the clip on screen, so number keys tag the clip that is playing.
  const playThrough = useCallback((target: 'video' | 'scene', startAt = 0) => {
    stopListRun()
    const { reels: rs, infoFor: inf } = latest.current
    const byId = Object.fromEntries(rs.map(s => [s.id, s]))
    const items: SequenceItem[] = [], clipAt: ({ clip: Clip; sceneId: string; group: Group } | null)[] = []
    let startItem = -1, clipNo = 0
    for (const p of currentPlan(target)) {
      // The cards right before the start clip (a scene card, then a marker card) play first, so
      // the start points at the first of them.
      if (p.kind === 'card') { if (clipNo === startAt && startItem < 0) startItem = items.length; items.push({ card: p.card, durationSec: p.durationSec }); clipAt.push(null); continue }
      if (clipNo === startAt && startItem < 0) startItem = items.length
      items.push({ key: p.clip.matchId, ...inf(p.clip, byId[p.sceneId] ?? null).range!, timing: p.clip.timing })
      clipAt.push({ clip: p.clip, sceneId: p.sceneId, group: p.group })
      clipNo++
    }
    playback.playSequence(items, i => {
      // On a title card, the clip after it is the one the panels follow.
      const at = i === null ? null : clipAt[i] ?? clipAt[i + 1] ?? null
      setPlayingClipId(at?.clip.id ?? null)
      if (at) { setReelId(at.sceneId); setActiveClipId(at.clip.id); setActiveGroup(at.group); setSelected({ matchId: at.clip.matchId, playId: at.clip.playId }); setMatchId(at.clip.matchId) }
    }, Math.max(0, startItem))
  }, [currentPlan])

  // Number keys tag the active clip — the one playing in a through-play, or the last clicked.
  // With no clip active, the selected play in the list is added with that marker.
  const markerKey = useCallback((m: Marker | null) => {
    const { reel: r, activeClipId: a, selected: s } = latest.current
    if (r && a && r.clips[a]) { updateReel(toggleMarker(r, a, m, whenIn(r))); return }
    if (m === null || !s) return
    const ref = refsByMatchRef.current[s.matchId]?.[s.playId]
    if (!ref) return
    let added = ''
    withReel(cur => {
      const { reel: next, ids } = addClips(cur, [{ matchId: s.matchId, play: ref.play }], 'none', extractRef.current)
      added = ids[0]
      return toggleMarker(next, added, m, whenIn(next))
    })
    setActiveClipId(added)
  }, [updateReel, withReel])
  const refsByMatchRef = useRef(refsByMatch)
  refsByMatchRef.current = refsByMatch


  const [seqPlaying, setSeqPlaying] = useState(false)
  useEffect(() => playback.subscribe(s => setSeqPlaying(s.seq !== null)), [])

  // ---- trimming (design §3.5) -----------------------------------------------------------------
  const active = reel && activeClipId ? reel.clips[activeClipId] ?? null : null
  const activeInfo = active ? clipInfo(active) : null
  // The clip's own objects on the timelines under 編集 and 図形.
  const timelineObjects = active && activeInfo?.range ? active.annotations.map(a => ({
    id: a.id, label: a.kind === 'text' ? `T ${a.text}` : a.kind === 'polygon' && a.cell ? t('ゾーン {0}', zoneOfCell(a.cell)) : a.kind === 'polygon' && a.disc ? (a.disc.part === 'top' ? t('円柱') : t('円柱（側面）')) : KIND_LABEL[a.kind],
    from: a.showFrom ?? activeInfo.range!.in, to: a.showTo ?? activeInfo.range!.out, set: a.showFrom !== undefined || a.showTo !== undefined,
  })) : []
  const loopIn = activeInfo?.range?.in, loopOut = activeInfo?.range?.out
  // The active clip loops while it's being trimmed; a through-play overrides the loop.
  useEffect(() => {
    playback.setLoop(active && loopIn !== undefined && loopOut !== undefined && !seqPlaying && !listRun && loopOn ? { key: active.matchId, in: loopIn, out: loopOut, timing: active.timing } : null)
  }, [active, loopIn, loopOut, seqPlaying, listRun, loopOn])

  useEffect(() => setSelectedAnn(null), [activeClipId])

  // ---- annotations (design §3.6) --------------------------------------------------------------
  // Scoreboard and caption for a clip, from its play in the DVW.
  const overlayData = useCallback((c: Clip | null): { scoreboard: ScoreboardData; caption: CaptionData } | null => {
    const d = c ? dvws[c.matchId] : null, play = c && d ? d.plays[c.playId] : null
    if (!c || !d || !play) return null
    const caption = captionData(d, play, overlay.playerCaption, c.overlayOverride?.playerCaption, video?.captionNames)
    return { scoreboard: scoreboardData(d, play, settings?.ourTeamCodes ?? []), caption: overlay.playerCaption.photo ? { ...caption, photo: captionPhoto(packs, d, play) } : caption }
  }, [dvws, settings, overlay, packs, video?.captionNames])
  const activeOverlay = overlayData(active)
  const activeMarker = reel && active ? markerFor(reel, active.id, activeGroup) : null
  const activeScoped = useMemo<ScopedAnnotations | null>(() => active ? {
    video: video?.annotations ?? [], scene: reel?.annotations ?? [],
    marker: activeMarker && reel ? reel.markerAnnotations?.[activeMarker] ?? [] : [], clip: active.annotations,
  } : null,
    [active, reel?.annotations, video?.annotations])
  const activeAnns = useMemo(() => (activeScoped ? mergeScoped(activeScoped) : []), [activeScoped])
  const activeScopeOf = useCallback((annId: string) => (activeScoped ? scopeOf(activeScoped, annId) : null), [activeScoped])
  latest.current.overlayData = overlayData
  const { exportState, setExportState, startExport, exportScenes, exportMarker, exportTargets, exportInfo, exportTarget } = useExport(
    { video, reel, reels, overlay, matches, settings, dvws, infoFor, orderOf }, latest, currentPlan, gridStyleRef, cardFramePhoto)
  latest.current.exportState = exportState
  const exportBadge = exportState?.status === 'running' || exportState?.status === 'preparing' ? `${Math.round(exportState.ratio * 100)}%` : exportState?.status === 'done' ? '✓' : undefined
  const {
    cardEdit, setCardEdit, focusEdit, setFocusEdit, cardTool, setCardTool, cardToolsOpen, setCardToolsOpen,
    cardEditCard, cardEditRef, cardAnnsRef, setCardAnns, cardTitleNow, setCardTitle, setCardLayout, cardShown, setCardShown,
    editCard, editingSlide, editingSource,
  } = useCardEdit({ latest, settings, video, reels, matches, overlay, setOverlay: o => setOverlay(o), selectedAnn, setSelectedAnn, updateReel, updateVideo })
  const {
    scopedNow, setAnns, setAnnScope, setObjectSpan, insertImage, pasteImage, placeImage, paletteSelection, putPaletteItem, copyObjects, pasteObjects,
  } = useObjects({
    latest, updateReel, updateVideo, cardEditRef, cardAnnsRef, cardEditCard, setCardAnns,
    activeAnns, selectedAnn, extraSel, setExtraSel, selectAnn, setSelectedAnn, setAnnTool, setNotice, setError,
  })

  // ---- slides ---------------------------------------------------------------------------------
  const { putSlide, frameAfterClip, boardDvws, boardOpen, setBoardOpen, boardEdit, setBoardEdit, makeBoard, saveCards } = useSlides({
    latest, dvws, settings, packs, gridStyle, overlay, activeGroup, whenIn, cardEdit, editCard, updateScene, makeScene, setProgress, setNotice, setError,
  })
  const [reportOpen, setReportOpen] = useState(false) // the match report

  // A title card's pictures to put on it: the photos of its clips' players (then the rest of those
  // matches'), and the logos the library has for the teams (those matches' first). Its clips: a
  // marker card's group, a scene card's scene, the video card's scenes.
  const [logoCodes, setLogoCodes] = useState<string[]>([])
  const editingTitleCard = !!cardEditCard && !cardEdit?.slideId
  // While a card is edited its photo frame shows the photo it will have.
  const cardImages = useMemo((): ImageLookup => {
    const photo = editingTitleCard && cardEditCard ? cardFramePhoto(cardEditCard) : null
    return id => (id.startsWith('frame:') ? (photo ? assetImage(photo) : null) : assetImage(id))
  }, [editingTitleCard, cardEditCard, cardFramePhoto, reels, dvws, packs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editingTitleCard) void api.listLogos().then(l => setLogoCodes(Object.keys(l))) }, [editingTitleCard])
  const cardInserts = useMemo((): CardInserts | undefined => {
    if (!editingTitleCard || !cardEdit) return undefined
    const scenes = cardEdit.sceneId ? [reels.find(r => r.id === cardEdit.sceneId)].filter(Boolean) : (video?.sceneIds ?? []).map(id => reels.find(r => r.id === id)).filter(Boolean)
    const clips = (scenes as Reel[]).flatMap(r => (cardEdit.marker !== null ? r.groups[cardEdit.marker] : Object.keys(r.clips)).map(id => r.clips[id]).filter(Boolean))
    const photos = cardPlayers(clips, dvws).flatMap(cp => {
      const ph = findPhoto(packs, cp.player, cp.team)
      return ph ? [{ key: `${cp.team}|${cp.player.key}|${cp.player.jersey}`, label: `${cp.team} #${cp.player.jersey} ${ph.player.label ?? cp.player.lastName}`, own: cp.clips > 0, pack: ph.pack, photo: ph.player.photo }] : []
    })
    const teams = cardTeams(clips, dvws), have = new Set(logoCodes)
    const logos = [...teams.filter(tm => have.has(tm.code)).map(tm => ({ code: tm.code, label: `${tm.code} ${tm.name}` })),
      ...logoCodes.filter(c => !teams.some(tm => tm.code === c)).sort().map(c => ({ code: c, label: c }))]
    return {
      photos, logos,
      onPhoto: (pack, photo) => void placeImage(() => api.usePackPhoto(pack, photo), true, { w: 0.15, cx: 0.12, cy: 0.72 }), // lower left, clear of the title
      onLogo: code => void placeImage(() => api.useLogo(code), true, { w: 0.1, cx: 0.9, cy: 0.14 }), // top right
      // A portrait frame (3:4) lower left, clear of the title.
      onFrame: () => {
        const w = 0.14, h = (w * 4 / 3) * (16 / 9), id = crypto.randomUUID()
        setCardAnns([...(cardEditCard?.annotations ?? []), { id, kind: 'image', color: '#FFFFFF', x: 0.12 - w / 2, y: Math.min(1 - h, 0.78 - h / 2), w, h, assetId: 'frame:top', frame: 'top', fit: 'cover' }])
        setAnnTool('select'); setSelectedAnn(id)
      },
    }
  }, [editingTitleCard, cardEdit, cardEditCard, reels, video, dvws, packs, logoCodes, placeImage, setCardAnns, setAnnTool])

  const setOverlay = useCallback((s: OverlaySettings) => {
    const v = latest.current.video
    if (v) updateVideo({ ...v, overlay: s, updatedAt: new Date().toISOString() })
  }, [updateVideo])

  const trim = useCallback((edge: 'in' | 'out', t: number | null) => {
    const { reel: r, activeClipId: id, clipInfo: info, matches: ms } = latest.current
    const c = r && id ? r.clips[id] : null
    const i = c ? info(c) : null
    if (!r || !c || !i?.range || !i.def) return
    updateReel(trimClip(r, c.id, edge, t, i.range, i.def, ms[c.matchId]?.durationSec))
  }, [updateReel])

  useShortcuts({
    latest, paused: settingsOpen, focusPane, editingCard: () => !!cardEditRef.current, cardAnns: () => cardAnnsRef.current, setCardAnns,
    scopedNow, setAnns, extraSel: () => extraSelRef.current, clearSelection: () => { setSelectedAnn(null); setExtraSel([]) },
    undoRedo, copyObjects, pasteObjects, pasteImage: () => void pasteImage(), toggleShortcuts: () => setShortcutsOpen(o => !o),
    activateClip, whenIn, jump, setAnnTool, trim, markerKey,
    setTag: n => { const { reel: r, activeClipId: id } = latest.current; if (r && id && r.clips[id]) updateReel(setTag(r, id, n === '0' || r.clips[id].tag === n ? null : n)) },
  })


  // ---- dev self-check (VR_SMOKE): only loaded when the main process runs one (see smoke.ts)
  useEffect(() => {
    if (!SMOKE) return
    const host: SmokeHost = { activateClip, currentPlan, editCard, exportMarker, exportScenes, extraSelRef, insertImage, jump, latest, loadProject, overlapsRef, playThrough, putSlide, scopedNow, setAnnScope, setAnnTool, setAnns, setExtract, setFilter, setLibrary, setOverlay, setOverlayOpen, setPicker, setReelId, setReels, setScan, setMatchIds, setSelectedAnn, setSettingsOpen, setVideoId, setVideos, startExport, updateReel, updateVideo, SAVE_DELAY_MS }
    void import('./smoke').then(m => m.installSmoke(host))
  }, [jump, loadProject, playThrough, activateClip, updateReel, updateVideo, overlayData, setOverlay, startExport, currentPlan])

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">SyncScout Video Editor</strong>
        {appVersion && <span className="app-version" title={t('このアプリのバージョン')}>v{appVersion}</span>}
        {project && <button onClick={() => void goHome()} title={t('倉庫とプロジェクトの一覧に戻る')}>{t('ホーム')}</button>}
        {project && <strong className="project-name" title={project.path}>{project.name}</strong>}
        {project && <button onClick={() => setPicker('edit')} title={t('倉庫から試合を足す・外す')}>{t('試合')} {project.matches.length}</button>}
        <span className="spacer" />
        {project && <span className={`save-state ${saveState}`} title={t('シーンと動画は自動で保存されます')}>{saveState === 'saved' ? t('保存済み') : saveState === 'pending' ? t('保存中…') : t('保存に失敗')}</span>}
        {project && <button onClick={() => setBoardOpen(true)} title={t('複数の選手のサーブやアタックを、チャートとデータで並べたスライドを作る')}>{t('データスライド作成')}</button>}
        {project && <button onClick={() => setReportOpen(true)} title={t('試合ごとの選手とチームの数字を、A4 1 枚のレポートにする（PDF にも書き出せる）')}>{t('マッチレポート')}</button>}
        <button onClick={() => setShortcutsOpen(true)} title={t('ショートカット一覧 (?)')}>{t('ショートカット')}</button>
        {project && <button onClick={() => setSettingsOpen(true)}>{t('設定')}</button>}
      </header>

      <Banners progress={progress} update={update} updateLater={updateLater} updateBusy={updateBusy} onRestart={() => void restartToUpdate()} onUpdateLater={() => setUpdateLater(true)}
        error={error} onError={setError} notice={notice} onNotice={setNotice}
        staleSlides={staleSlides} onReloadSlides={paths => void reloadSlideFiles(paths)} onLaterSlides={() => void laterSlides()}
        exportState={exportState} onCloseExport={() => setExportState(null)} />

      {project && Object.keys(project.missing).length > 0 && (
        <div className="missing-bar" role="alert">
          {project.matches.filter(m => project.missing[m.id]).map(m => (
            <span key={m.id}><b>{m.name}</b> <MissingNote parts={project.missing[m.id]} busy={!!progress} onRelocate={part => void relocate(m.id, part)} /></span>
          ))}
        </div>
      )}
      {!project ? (
        <Home library={library} recent={recent} busy={!!progress} onChooseLibrary={chooseLibrary} onScan={scanFolders}
          onImportOne={importOne} onNewProject={() => setPicker('create')} onOpenProject={p => void openProject(p)}
          onRelocate={(id, part) => void relocate(id, part)} />
      ) : !project.matches.length ? (
        <div className="empty"><h2>{t('試合を選びましょう')}</h2>
          <p className="muted">{t('倉庫から、このプロジェクトで使う試合を選びます。')}</p>
          <button className="primary" onClick={() => setPicker('edit')}>{t('試合を選ぶ')}</button></div>
      ) : (
        <main className={`workspace${focusEdit ? ' focus-edit' : ''}`}>
          <aside className="sidebar" onPointerDownCapture={() => { focusPane.current = 'list' }}>
            <CheckPicker className="match-select" label={t('検索する試合')} all={t('すべての試合（{0}）', project.matches.length)}
              options={project.matches.map(m => ({ key: m.id, label: m.name }))} selected={matchIds}
              onChange={ids => { setMatchIds(ids); if (ids.length && !ids.includes(matchId ?? '')) setMatchId(ids[0]) }} />
            {matchIds.length !== 1 && project.matches.length > 1 && (
              <div className="segmented match-order" role="radiogroup" aria-label={t('試合の並び')}>
                {([['old', t('古い試合から')], ['new', t('新しい試合から')]] as const).map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={matchOrder === v} className={matchOrder === v ? 'on' : ''} onClick={() => setMatchOrder(v)}>{l}</button>
                ))}
              </div>
            )}
            {match?.warnings.map(w => <p key={w} className="warning">{w}</p>)}
            <FilterPanel
              filter={filter} onChange={setFilter} people={people} details={details} targetCode={settings?.ourTeamCodes[0] ?? ''} extract={extract} onExtract={setExtract}
              range={reel ? rangeDefaults(reel) : DEFAULT_RANGE} onRange={reel ? d => updateReel({ ...reel, rangeDefaults: d, updatedAt: new Date().toISOString() }) : null}
              shown={results.length} total={scopeRefs.length} teamFilterLimited={teamFilterLimited} dirUnknown={dirUnknown}
              onAddAll={() => addPlays(results)} onPreset={() => setPresetOpen(true)}
              saved={settings?.filters ?? []} onSaved={filters => { if (settings) void saveSettings({ ...settings, filters }, false) }}
            />
            {Object.keys(dvws).length
              ? <PlayList refs={results} matches={matches} showMatch={matchIds.length !== 1 && (project?.matches.length ?? 0) > 1}
                  currentMatchId={matchId} selected={selected} onJump={jump} reelGroups={reelGroups} onMark={markPlay} />
              : <p className="muted pad">{t('読み込み中…')}</p>}
          </aside>
          <section className="stage">
            {focusEdit && (
              // The edit mode puts the right column away, palette and all: the palette floats instead.
              <PalettePanel disabled={!cardEditCard && !(active && activeInfo?.range)} selection={paletteSelection} onUse={putPaletteItem}
                clipIn={cardEditCard ? null : activeInfo?.range?.in ?? null} float={{ onDock: () => setFocusEdit(false) }} />
            )}
            {match && (
              <VideoPane key={match.id} match={match} editMode={{ on: focusEdit, onToggle: () => setFocusEdit(f => !f) }} overlay={size => {
                const here = active && activeInfo?.range && active.matchId === match.id ? { key: active.matchId, ...activeInfo.range } : null
                if (cardEditCard) {
                  return (
                    <>
                      <CardEditor key={lineKey} heatOpacity={gridStyle.heatOpacity} size={size} card={cardEditCard} settings={overlay} onChange={setOverlay} onOwn={setCardLayout} active={cardTool === 'title' || cardTool === 'logo'} target={cardTool === 'logo' ? 'logo' : 'title'} />
                      <AnnotationLayer onMade={() => setAnnTool('select')}
                        size={size} annotations={cardEditCard.annotations ?? []} clip={{ key: 'card', in: 0, out: 1e9 }} always images={cardImages}
                        editable={cardTool === 'objects'} tool={annTool} style={annStyle}
                        selectedId={selectedAnn} extraIds={extraSel} onToggleExtra={toggleExtra} editPoints={editPoints} cropping={cropping} onSelect={selectAnn} onChange={setCardAnns}
                      />
                    </>
                  )
                }
                const court = match.court && (
                  <CourtLayer key={lineKey} size={size} fit={match.court} style={gridStyle} zones={courtZones} flight={selectedPlay ? flightTiming(selectedPlay, match.offsetSec, active?.matchId === match.id && active.playId === selectedPlay.id ? active : null) : null} fitting={courtFitting}
                    onCorners={corners => match.court && setCourt(match.id, { ...match.court, corners })}
                    onPoint={!courtFitting && !seqPlaying && annTool === 'select' && stagePanel !== 'objects' ? courtClick : undefined} />
                )
                return (
                  <>
                    {!courtFitting && court}
                    <OverlayLayer key={lineKey} heatOpacity={gridStyle.heatOpacity} size={size} settings={overlay} clip={here} scoreboard={activeOverlay?.scoreboard ?? null}
                      caption={activeOverlay?.caption ?? null} override={active?.overlayOverride} />
                    {here && active && (
                      <AnnotationLayer onMade={() => setAnnTool('select')}
                        size={size} annotations={activeAnns} scopeOf={activeScopeOf} clip={here} floor={match.court?.corners ?? null}
                        editable={!seqPlaying} tool={annTool} style={annStyle}
                        selectedId={selectedAnn} extraIds={extraSel} onToggleExtra={toggleExtra} editPoints={editPoints} cropping={cropping} onSelect={id => { selectAnn(id); if (id) showObjects() }} onChange={setAnns}
                      />
                    )}
                    {seqPlaying && overlay.transition.fade && <FadeLayer range={here} sec={overlay.transition.durationSec} />}
                    {courtFitting && court}
                    {shotPick && (
                      <ShotPick x={shotPick.at.x * size.w} y={shotPick.at.y * size.h} size={size} rows={shotPick.rows} zone={shotPick.zone}
                        onPick={goToShot} onZone={zoneList} onClose={() => setShotPick(null)} />
                    )}
                  </>
                )
              }} />
            )}
            {cardEditCard && editingSlide?.board && (
              <BoardEditBar slide={editingSlide} onDone={() => { setCardEdit(null); setSelectedAnn(null) }}
                onChange={s => cardEdit?.sceneId && updateScene(cardEdit.sceneId, r => setSlide(r, s))}
                onBoard={() => setBoardEdit(editingSlide)} onSave={as => void saveCards(as, editingSlide)} />
            )}
            {cardEditCard && editingSlide && !editingSlide.board && (
              <SlideEditBar slide={editingSlide} onDone={() => { setCardEdit(null); setSelectedAnn(null) }}
                target={slideTarget} onMark={(mark, on) => markSlide(editingSlide, mark, on)}
                onChange={s => cardEdit?.sceneId && updateScene(cardEdit.sceneId, r => setSlide(r, s))}
                onReload={editingSource ? () => void reloadSlideFiles([editingSource.path]) : null}
                onSave={as => void saveCards(as, editingSlide)} />
            )}
            {cardEditCard && !editingSlide && (
              <CardEditBar card={cardEditCard} settings={overlay} onChange={setOverlay} onOwn={setCardLayout} onDone={() => { setCardEdit(null); setSelectedAnn(null) }}
                tool={cardTool} onTool={setCardTool} shown={cardShown} onShown={setCardShown}
                title={cardTitleNow.title} nameTitle={cardTitleNow.name} onTitle={setCardTitle} inserts={cardInserts} />
            )}
            {cardEditCard && cardTool === 'objects' && (
              <div className="filter-row">
                <button className="link" aria-expanded={cardToolsOpen} onClick={() => setCardToolsOpen(o => !o)}>{cardToolsOpen ? '▾' : '▸'} {t('図形')}</button>
              </div>
            )}
            {cardEditCard && cardTool === 'objects' && (
              <div className="stage-panel" hidden={!cardToolsOpen}>
              <AnnotationTools
                tool={annTool} onTool={setAnnTool} style={annStyle} onStyle={setAnnStyle} cardMode
                annotations={cardEditCard.annotations ?? []} scopeOf={() => 'clip'} onScope={() => {}} canVideo={false} selectedId={selectedAnn}
                editPoints={editPoints} onEditPoints={setEditPoints} cropping={cropping} onCropping={setCropping} extraIds={extraSel}
                onSelect={selectAnn} onChange={setCardAnns} onInsertImage={() => void insertImage()} clip={{ in: 0, out: 0 }} disabled={false}
              />
              </div>
            )}
            {!cardEdit && match && (
              <StageTabs panel={stagePanel} onPanel={setStagePanel} clip={!!(active && activeInfo?.range && active.matchId === matchId)} fitting={courtFitting}>
                {active && activeInfo?.range && active.matchId === matchId && (stagePanel === 'edit' || stagePanel === 'objects') && (
                  <HeadlineBar annotations={activeAnns} onChange={setAnns} style={annStyle} headline={settings?.headline} disabled={seqPlaying} clipIn={activeInfo.range.in} compact
                    onFormat={id => { setAnnTool('select'); setSelectedAnn(id); showObjects() }} />
                )}
              </StageTabs>
            )}
            {!cardEdit && match && (
              <div className="stage-panel" hidden={stagePanel !== 'view' && !courtFitting}>
              <CourtBar playSkill={selectedPlay?.skill ?? null} setterCalls={setterCalls} match={match} style={gridStyle} onStyle={setGridStyle} fitting={courtFitting} onFitting={setCourtFitting}
                onFit={fit => setCourt(match.id, fit)} onAuto={() => autoFit(match.id)} />
              </div>
            )}
            {!cardEdit && active && activeInfo?.range && activeInfo.def && activeInfo.ref && active.matchId === matchId && (
              <div className="stage-panel" hidden={stagePanel !== 'edit'}>
              <TrimBar
                label={`${activeInfo.matchLabel}  #${activeInfo.ref.play.jersey} ${activeInfo.ref.name}`}
                keyTime={activeInfo.ref.play.time + (matches[active.matchId]?.offsetSec ?? 0)}
                range={activeInfo.range} def={activeInfo.def} durationSec={matches[active.matchId]?.durationSec ?? 0}
                overrides={{ in: active.inSec !== null, out: active.outSec !== null }}
                overlapLabels={(overlaps.get(active.id) ?? []).map(id => {
                  const oi = reel!.clips[id] ? clipInfo(reel!.clips[id]) : null
                  return oi?.ref ? `#${oi.ref.play.jersey} ${oi.ref.name} ${oi.ref.play.skill}` : id
                })}
                onTrim={trim} loop={loopOn} onLoop={setLoopOn} onFrameSlide={() => void frameAfterClip()}
                speed={activeInfo.ref.play.skill === 'S' ? { value: active.speedKmh ?? null, usual: serveSpeed(activeInfo.ref.play) } : null}
                onSpeed={kmh => { const r = latest.current.reel; if (r) updateReel(setServeSpeed(r, active.id, kmh)) }}
                skillTime={active.skillSec ?? null}
                onSkillTime={sec => { const r = latest.current.reel; if (r) updateReel(setSkillTime(r, active.id, sec)) }}
                timing={active.timing} onTiming={tm => { const r = latest.current.reel; if (r) updateReel(setTiming(r, active.id, tm)) }}
                objects={timelineObjects}
                selectedObjectId={selectedAnn} onSelectObject={id => { setAnnTool('select'); setSelectedAnn(id) }}
                onObjectSpan={(id, edge, t) => setObjectSpan(id, { [edge]: t })}
              />
              </div>
            )}
            {!cardEdit && active && activeInfo?.range && active.matchId === matchId && (
              <div className="stage-panel" hidden={stagePanel !== 'objects'}>
              <AnnotationTools
                tool={annTool} onTool={setAnnTool} style={annStyle} onStyle={setAnnStyle}
                annotations={activeAnns} scopeOf={activeScopeOf} onScope={setAnnScope} canVideo={!!video} marker={activeMarker} selectedId={selectedAnn} editPoints={editPoints} onEditPoints={setEditPoints} cropping={cropping} onCropping={setCropping} extraIds={extraSel}
                onSelect={selectAnn} onChange={setAnns} onInsertImage={() => void insertImage()} clip={activeInfo.range} disabled={seqPlaying}
                court={matches[active.matchId]?.court?.corners ?? null}
              />
              <ObjectTimeline range={activeInfo.range} objects={timelineObjects} selectedId={selectedAnn} disabled={seqPlaying}
                onSelect={id => { setAnnTool('select'); setSelectedAnn(id) }} onSpan={setObjectSpan} />
              </div>
            )}
            {!cardEdit && active && activeInfo?.ref && activeInfo.range && active.matchId === matchId && (
              <div className="stage-panel" hidden={stagePanel !== 'view'}>
              <ClipOverlayRow
                override={active.overlayOverride} overlay={overlay} onOverlay={setOverlay}
                autoName={dvws[active.matchId] ? captionData(dvws[active.matchId], activeInfo.ref.play, { ...overlay.playerCaption, showName: true }).name ?? '' : ''}
                videoName={video?.captionNames?.[activeInfo.ref.play.playerKey]} canVideo={!!video}
                onVideoName={name => {
                  const v = latest.current.video, key = activeInfo.ref!.play.playerKey
                  if (!v) return
                  const { [key]: _old, ...rest } = v.captionNames ?? {}
                  const names = name ? { ...rest, [key]: name } : rest
                  updateVideo({ ...v, captionNames: Object.keys(names).length ? names : undefined, updatedAt: new Date().toISOString() })
                }}
                autoLine={dvws[active.matchId] ? captionData(dvws[active.matchId], activeInfo.ref.play, { ...overlay.playerCaption, showSkill: true, showEvaluation: true }).line ?? '' : ''}
                onChange={o => { const r = latest.current.reel; if (r) updateReel(setOverlayOverride(r, active.id, o)) }}
              />
              </div>
            )}
          </section>
          <div className="right-col" onPointerDownCapture={() => { focusPane.current = 'scene' }}>
            {(['head', 'list'] as const).map(part => {
              const panel = <VideoPanel key={part} part={part}
              videos={videos} video={video} scenes={reels} sceneStats={sceneStats} currentSceneId={reelId}
              onSelectVideo={selectVideo} onNewVideo={createVideo} onDeleteVideo={deleteVideo} onRemake={id => void remakePresetVideo(id)} onChange={updateVideo}
              onSelectScene={id => { setReelId(id); setActiveClipId(null); setRightTab('scene') }} onNewScene={() => { makeScene(); setRightTab('scene') }}
              onEditCard={id => editCard(id, null)} onEditVideoCard={() => editCard(null, null)}
              videoCardOn={!!overlay.titleCard.videoCard} onVideoCard={on => setOverlay({ ...overlay, titleCard: { ...overlay.titleCard, videoCard: on } })}
              sceneCardOn={s => s.sceneCard ?? overlay.titleCard.sceneCards}
              onSceneCard={(s, on) => updateReel({ ...s, sceneCard: on, updatedAt: new Date().toISOString() })}
              onRenameScene={(id, name) => { const r = latest.current.reels.find(x => x.id === id); if (r && r.name !== name) updateReel({ ...r, name, updatedAt: new Date().toISOString() }) }}
              onOpenOverlay={() => setOverlayOpen(true)} playing={seqPlaying} onPlay={() => playThrough('video', 0)} onPlayMax={() => void playMaximized(() => playThrough('video', 0))} onStop={() => playback.stopSequence()}
                        />
              return part === 'head' ? panel : (
                <Fragment key={part}>
                  <RightTabs tab={rightTab} onTab={setRightTab} badge={exportBadge} />
                  <div className="right-pane" hidden={rightTab !== 'video'}>{panel}</div>
                </Fragment>
              )
            })}
            <div className="right-pane" hidden={rightTab !== 'scene'}>
            <ReelPanel
              reels={reels} reel={reel} onSelectReel={id => { setReelId(id); setActiveClipId(null) }}
              onNewReel={makeScene} onDeleteReel={deleteReel} onChange={updateReel}
              info={clipInfo} missing={missing} activeClipId={activeClipId} playingClipId={playingClipId}
              onActivate={(c, g) => { if (cardEditRef.current?.slideId) { setCardEdit(null); setSelectedAnn(null) } activateClip(c, g) }} playing={seqPlaying} onPlayThrough={() => playThrough('scene', 0)} onPlayMax={() => void playMaximized(() => playThrough('scene', 0))} onStop={() => playback.stopSequence()}
              orderCount={order.length} orderSec={orderSec} overlaps={overlaps} usedIn={reel ? videos.filter(v => v.sceneIds.includes(reel.id)).length : 0}
              videoSceneIds={video?.sceneIds ?? null} onAddToVideo={id => { if (video) updateVideo(addScene(video, id)) }}
              markerCardDefault={overlay.titleCard.enabled} onEditCard={m => reel && editCard(reel.id, m)}
              onSlide={(spot, how) => void putSlide(spot, how)} onEditSlide={id => reel && editCard(reel.id, null, id)}
              editingSlideId={cardEdit?.slideId ?? null} canFrame={!!match}
            />
            <PalettePanel disabled={!cardEditCard && !(active && activeInfo?.range)} selection={paletteSelection} onUse={putPaletteItem}
              clipIn={cardEditCard ? null : activeInfo?.range?.in ?? null} />
            <PlayerPhotos dvw={!cardEditCard && active ? dvws[active.matchId] ?? null : null}
              focus={!cardEditCard && activeInfo?.ref ? { side: activeInfo.ref.play.side, jersey: activeInfo.ref.play.jersey } : null}
              disabled={!cardEditCard && !(active && activeInfo?.range)}
              onPick={async (pack, photo) => { await placeImage(() => api.usePackPhoto(pack, photo), true) }} />
            </div>
            <div className="right-pane" hidden={rightTab !== 'export'}>
            <ExportPanel targets={exportTargets} info={exportInfo} chapters={overlay.chapters.enabled} onChapters={on => setOverlay({ ...overlay, chapters: { enabled: on } })} state={exportState} onExport={exportTarget}
              onCancel={() => void api.cancelExport()} onShowFile={p => void api.showInFolder(p)} onOpenOverlay={() => setOverlayOpen(true)} />
            </div>
          </div>
        </main>
      )}

      {overlayOpen && video && (
        <OverlayDialog settings={overlay} onChange={setOverlay} onClose={() => setOverlayOpen(false)}
          sample={overlaySample(overlayData(active ?? order[0] ?? (reel ? Object.values(reel.clips)[0] : null) ?? null), reel)} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {presetOpen && <PresetDialog results={results} scope={scopeRefs} targetCode={settings?.ourTeamCodes[0] ?? ''} look={presetLook} roles={settings?.roles ?? {}} rosterRoleOf={r => dvws[r.matchId]?.players[`${r.play.side}${r.play.jersey}`]?.role} onRoles={r => { if (settings) void saveSettings({ ...settings, roles: r }, false) }} onMake={makePresetVideo} onClose={() => setPresetOpen(false)} />}
      {scan && <ScanDialog result={scan} onImport={p => void importPairs(p)} onClose={() => setScan(null)} />}
      {picker && library && (
        <MatchPicker mode={picker} matches={library.matches} onClose={() => setPicker(null)} onDone={r => void pickerDone(r)}
          initial={picker === 'create'
            ? { name: '', codes: ['HTH'].filter(c => library.matches.some(m => m.teams.some(t => t.code.toUpperCase() === c))), selected: [] }
            : { name: project?.name ?? '', codes: project?.settings.ourTeamCodes ?? [], selected: project?.matchIds ?? [] }} />
      )}
      {reportOpen && project && (
        <MatchReportDialog matches={project.matches.filter(m => dvws[m.id])} dvws={dvws} initial={match?.id ?? null} ourCodes={settings?.ourTeamCodes ?? []} onClose={() => setReportOpen(false)} />
      )}
      {(boardOpen || boardEdit) && (
        <BoardDialog chartStyle={k => markStyle(gridStyle, k).chart} dvws={boardDvws} results={results.map(r => r.play)} ourTeam={settings?.ourTeamCodes[0] ?? ''} scene={reel}
          {...(boardEdit?.board ? { initial: boardEdit.board.config } : {})}
          onCreate={c => void makeBoard(c)} onClose={() => { setBoardOpen(false); setBoardEdit(null) }}
          onImport={m => { setBoardOpen(false); setBoardEdit(null); if (reel) void putSlide(spotAt(groupRows(reel, m), m, 0), 'file') }} />
      )}
      {settingsOpen && settings && (
        <SettingsDialog settings={settings} theme={overlay.theme} teams={projectTeams} onSave={saveSettings} onClose={() => setSettingsOpen(false)}
          onLanguage={l => void (async () => { await flushAll(); await api.setLanguage(l); location.reload() })()} />
      )}
    </div>
  )
}
