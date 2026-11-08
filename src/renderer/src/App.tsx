import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FILTER, type PlayFilter, type PlayRef } from '../../shared/filter'
import { effectName, playLabel } from '../../shared/labels'
import {
  DEFAULT_RANGE, addClips, chronological, clipRange, defaultRange, findClip, findOverlaps, groupRows, markerCardOn, markersOf, newReel, newSlide, playOrder, putSlides, rangeDefaults, relink, setAnnotations, setOverlayOverride, setServeSpeed, setSkillTime, setSlide, setTag, setTiming, spotAt, toggleMarker, trimClip,
  type Clip, type ClipMode, type Group, type Marker, type Reel, type Slide, type SlideSpot,
} from '../../shared/reel'
import type { ImportProgress, MissingPart, ParsedDVW, Play, ProjectInfo, ProjectSettings, SlideFile } from '../../shared/types'
import { CheckPicker } from './components/CheckPicker'
import { applySettingsChange, settingsChange } from '../../shared/settingsUndo'
import { ShotPick, type ShotRow } from './components/ShotPick'
import { FilterPanel } from './components/FilterPanel'
import { PlayList, type PlayKey } from './components/PlayList'
import { ReelPanel, type ClipInfo, type SlideHow } from './components/ReelPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { TrimBar } from './components/TrimBar'
import { RIGHT_TABS, RightTabs, type RightTab } from './components/RightTabs'
import { AnnotationLayer, type AnnStyle, type Tool } from './components/AnnotationLayer'
import { AnnotationTools, KIND_LABEL } from './components/AnnotationTools'
import { HeadlineBar } from './components/HeadlineBar'
import { ObjectTimeline } from './components/ObjectTimeline'
import { freshIds, pasteCopies, shiftTimes, withGroups, type Annotation } from '../../shared/annotation'
import { changed, mergeScoped, moveToScope, scopeOf, splitScoped, type AnnScope, type ScopedAnnotations } from '../../shared/annotationScope'
import { captionData, overlaySettings, scoreboardData, type CaptionData, type CardLayout, type OverlaySettings, type ScoreboardData } from '../../shared/overlay'
import { OverlayLayer } from './components/OverlayLayer'
import { OverlayDialog } from './components/OverlayDialog'
import { ClipOverlayRow } from './components/ClipOverlayRow'
import { addScene, cardMatch, dropScene, newVideo, planScene, planVideo, slideCard, videoCard, type Card, type PlanItem, type Video } from '../../shared/video'
import { CardEditBar, CardEditor, BoardEditBar, SlideEditBar, type SlideMark } from './components/CardEditor'
import { FadeLayer } from './components/FadeLayer'
import { PalettePanel } from './components/PalettePanel'
import { PlayerPhotos } from './components/PlayerPhotos'
import { ExportPanel } from './components/ExportPanel'
import { VideoPanel } from './components/VideoPanel'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { PresetDialog } from './components/PresetDialog'
import { usePresetVideos } from './app/usePresetVideos'
import { withRoles } from '../../shared/roles'
import { Home, MissingNote } from './components/Home'
import { ScanDialog } from './components/ScanDialog'
import { MatchPicker } from './components/MatchPicker'
import type { LibraryInfo, RecentProject, ScanResult } from '../../shared/types'
import { VideoPane } from './components/VideoPane'
import { CourtLayer } from './components/CourtLayer'
import { CourtBar } from './components/CourtBar'
import { MatchReportDialog } from './components/MatchReportDialog'
import { boardSlide, keptByHand, type BoardPhoto } from '../../shared/board'
import { pdfFromJpegs } from '../../shared/pdf'
import { CARD_H, CARD_W, cardImages } from './exportRender'
import { DEFAULT_CHART, chartName, setChartColors } from '../../shared/chart'
import { setterCall } from '../../shared/setChart'
import { BoardDialog, type BoardChoice } from './components/BoardDialog'
import { DEFAULT_GRID_STYLE, cleanGridStyle, markStyle, marksBySkill, floorAt, homography, nearestShots, project as onPicture, serveSpeed, flightTiming, playMarks, playerMarks, zoneAt, zoneOfCell, type CourtFit, type GridStyle, type Pt } from '../../shared/court'
import { insertAsset, pdfPages, resetAssets } from './assets'
import type { SmokeHost } from './smoke'
import { playback, type SequenceItem } from './playback'
import { t } from '../../shared/i18n'
import { keyName } from '../../shared/keys'
import { captionPhoto, findPhoto } from '../../shared/pack'
import { usePacks } from './packs'
import { playMaximized } from './maximize'
import { clipPlayedSec } from '../../shared/timing'
import { markerFor, missingOf, overlaySample, type AppLatest } from './app/appState'
import { SAVE_DELAY_MS, useAutosave } from './app/useAutosave'
import { useUpdates } from './app/useUpdates'
import { useUndo, type Snapshot } from './app/useUndo'
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



const BOARD_SEC = 10 // a slide comparing players stays up long enough to read
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
  const [selected, setSelected] = useState<PlayKey | null>(null)
  const [reels, setReels] = useState<Reel[]>([])
  const [reelId, setReelId] = useState<string | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [videoId, setVideoId] = useState<string | null>(null)
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [library, setLibrary] = useState<LibraryInfo | null>(null)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [picker, setPicker] = useState<'create' | 'edit' | null>(null)
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
  const reel = reels.find(r => r.id === reelId) ?? null
  const video = videos.find(v => v.id === videoId) ?? null
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

  useEffect(() => {
    void api.getLibrary().then(setLibrary)
    void api.recentProjects().then(setRecent)
    void api.getProject().then(p => p && loadProject(p))
    return api.onImportProgress(setProgress)
  }, [])

  // Every match's DVW is parsed up front (a few ms each) so "all matches" search is instant.
  // Reels are re-linked to the fresh parse, in case a DVW was edited since they were saved.
  // Only the latest call applies its results, so overlapping loads can't overwrite newer state.
  const loadGen = useRef(0)
  const loadProject = useCallback(async (p: ProjectInfo | null) => {
    const gen = ++loadGen.current
    if (p?.path !== latest.current.projectPath) resetAssets() // another project's pictures go
    latest.current.projectPath = p?.path ?? null
    setProject(p)
    setMatchId(id => (p && id && p.matches.some(m => m.id === id) ? id : p?.matches[0]?.id ?? null))
    setMatchIds(ids => ids.filter(id => p?.matches.some(m => m.id === id)))
    if (!p) { setDvws({}); setReels([]); setReelId(null); setVideos([]); setVideoId(null); return }
    const parsed: Record<string, ParsedDVW> = {}
    for (const m of p.matches) {
      try { parsed[m.id] = await api.parseMatch(m.id) } catch (e) { setError(`${m.name}: ${(e as Error).message}`) }
    }
    if (gen !== loadGen.current) return
    setDvws(parsed)
    const listed = await api.listReels()
    if (gen !== loadGen.current) return
    const vids = await api.listVideos()
    if (gen !== loadGen.current) return
    // Scenes whose clips were re-pointed to their plays (the DVW changed) count as unsaved, so the
    // new pointers are written; the rest are clean as loaded.
    const relinked = listed.map(r => relink(r, parsed))
    const loaded = relinked.map(x => x.reel)
    markSaved([
      ...relinked.filter(x => !x.changed).map(x => [`scene:${x.reel.id}`, x.reel] as [string, object]),
      ...vids.map(v => [`video:${v.id}`, v] as [string, object]),
    ])
    clearHistory()
    setReels(loaded)
    void checkSlideFiles(loaded)
    setVideos(vids)
    setVideoId(id => (id && vids.some(v => v.id === id) ? id : vids[0]?.id ?? null))
    const notes = await api.takeNotices()
    if (notes.length) setNotice(notes.join(' / '))
    setReelId(id => (id && loaded.some(r => r.id === id) ? id : loaded[0]?.id ?? null))
  }, [])


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

  // ---- reels --------------------------------------------------------------------------------
  // Undo puts back a scene or video (and shows it), or the project settings.
  const { record, undoRedo, clearHistory } = useUndo({
    now: e => (e.kind === 'settings' ? latest.current.settings ?? null : e.kind === 'scene' ? latest.current.reels.find(x => x.id === e.id) ?? null : latest.current.videos.find(x => x.id === e.id) ?? null),
    // Each scene or video back as it was: changed back, made again (saved anew), or taken out again.
    restore: list => {
      let scene: string | null = null, video: string | null = null
      for (const e of list) {
        if (e.kind === 'settings') { const cur = latest.current.settings; if (cur) void api.saveSettings(applySettingsChange(cur, e.value)).then(setProject).catch(err => setError(String(err))) }
        else if (e.kind === 'scene') {
          const has = latest.current.reels.some(x => x.id === e.id)
          if (!e.value) { if (has) removeScenes([e.id]) } else { if (has) putScene(e.value); else addScenes([e.value]); scene = e.id }
        } else {
          const has = latest.current.videos.some(x => x.id === e.id)
          if (!e.value) { if (has) removeVideo(e.id) } else { if (has) putVideo(e.value); else addVideo(e.value); video = e.id }
        }
      }
      if (video) setVideoId(video)
      if (scene) showScene(scene)
    },
  })
  const putScene = (r: Reel) => {
    latest.current = { ...latest.current, reels: latest.current.reels.map(x => (x.id === r.id ? r : x)), reel: latest.current.reel?.id === r.id ? r : latest.current.reel }
    setReels(rs => rs.map(x => (x.id === r.id ? r : x)))
  }
  const putVideo = (v: Video) => {
    latest.current = { ...latest.current, videos: latest.current.videos.map(x => (x.id === v.id ? v : x)), video: latest.current.video?.id === v.id ? v : latest.current.video }
    setVideos(vs => vs.map(x => (x.id === v.id ? v : x)))
  }
  // New scenes and a new video: in the state, and in latest at once for steps that follow in the same tick.
  const addScenes = (rs: Reel[]) => {
    latest.current = { ...latest.current, reels: [...latest.current.reels, ...rs] }
    setReels(x => [...x, ...rs])
  }
  const addVideo = (v: Video) => {
    latest.current = { ...latest.current, videos: [...latest.current.videos, v], video: v }
    setVideos(x => [...x, v]); setVideoId(v.id)
  }
  const showScene = (id: string) => { setReelId(id); setActiveClipId(null) }
  // Scenes and a video taken out, their files moved to deleted/ (undo puts them back and saves them anew).
  const removeScenes = (ids: string[]) => {
    if (!ids.length) return
    const gone = new Set(ids)
    latest.current = { ...latest.current, reels: latest.current.reels.filter(r => !gone.has(r.id)) }
    setReels(rs => rs.filter(r => !gone.has(r.id)))
    if (latest.current.reelId && gone.has(latest.current.reelId)) { setReelId(null); setActiveClipId(null) }
    for (const id of ids) { forget(`scene:${id}`); void api.deleteReel(id) }
  }
  const removeVideo = (id: string) => {
    const rest = latest.current.videos.filter(v => v.id !== id)
    latest.current = { ...latest.current, videos: rest, video: latest.current.video?.id === id ? rest[0] ?? null : latest.current.video }
    setVideos(rest); setVideoId(cur => (cur === id ? rest[0]?.id ?? null : cur))
    forget(`video:${id}`); void api.deleteVideo(id)
  }
  // A scene or video as it is now, for undo (null: not there).
  const sceneSnap = (id: string): Snapshot => ({ kind: 'scene', id, value: latest.current.reels.find(x => x.id === id) ?? null })
  const videoSnap = (id: string): Snapshot => ({ kind: 'video', id, value: latest.current.videos.find(x => x.id === id) ?? null })

  const updateReel = useCallback((r: Reel) => {
    const prev = latest.current.reels.find(x => x.id === r.id)
    if (prev && prev !== r) record({ kind: 'scene', id: prev.id, value: prev })
    putScene(r)
  }, [record])
  const updateVideo = useCallback((v: Video) => {
    const prev = latest.current.videos.find(x => x.id === v.id)
    if (prev && prev !== v) record({ kind: 'video', id: prev.id, value: prev })
    putVideo(v)
  }, [record])
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

  // The reel to add to: the current one, or a new one on first use. Computed outside a state
  // updater because new clips get random ids, and StrictMode runs updaters twice.
  const withReel = useCallback((fn: (r: Reel) => Reel): Reel => {
    const rs = latest.current.reels
    const cur = rs.find(r => r.id === latest.current.reelId)
    const next = fn(cur ?? newReel(t('シーン {0}', rs.length + 1)))
    if (cur) record({ kind: 'scene', id: cur.id, value: cur })
    const all = cur ? rs.map(r => (r.id === cur.id ? next : r)) : [...rs, next]
    latest.current = { ...latest.current, reels: all, reelId: next.id, reel: next }
    setReels(all)
    setReelId(next.id)
    if (!cur) record([{ kind: 'scene', id: next.id, value: null }, placeInVideo(next.id)], false)
    return next
  }, [record])
  // A new scene goes into the current video; with no video yet, the first one is made for it.
  // Returns the video as it was, for the caller's undo step.
  const placeInVideo = (sceneId: string): Snapshot => {
    const v = latest.current.video
    if (v) { const was = videoSnap(v.id); putVideo(addScene(v, sceneId)); return was }
    const nv = newVideo(t('動画 {0}', latest.current.videos.length + 1), [sceneId])
    addVideo(nv)
    return { kind: 'video', id: nv.id, value: null }
  }


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

  const createReel = () => {
    const r = newReel(t('シーン {0}', reels.length + 1))
    addScenes([r]); showScene(r.id)
    record([{ kind: 'scene', id: r.id, value: null }, placeInVideo(r.id)], false)
  }
  // Deleting a scene takes it out of every video that used it (one undo step for all of it).
  const deleteReel = (id: string) => {
    const users = latest.current.videos.filter(v => v.sceneIds.includes(id))
    record([sceneSnap(id), ...users.map(v => videoSnap(v.id))], false)
    for (const v of users) putVideo(dropScene(v, id))
    removeScenes([id])
    const first = latest.current.reels[0]?.id ?? null
    setReelId(first); setActiveClipId(null)
  }
  // A new video starts empty; its scenes are added (or made) for it. Switching videos shows one of its scenes.
  const createVideo = () => {
    const v = newVideo(t('動画 {0}', videos.length + 1), [])
    addVideo(v); record({ kind: 'video', id: v.id, value: null }, false)
    setReelId(null); setActiveClipId(null)
  }
  // The scenes no other video uses.
  const scenesOnlyIn = (v: Video) => [...new Set(v.sceneIds)].filter(id => !latest.current.videos.some(o => o.id !== v.id && o.sceneIds.includes(id)))
  const selectVideo = (id: string) => {
    setVideoId(id)
    const v = videos.find(x => x.id === id)
    if (v && !(reelId && v.sceneIds.includes(reelId))) { setReelId(v.sceneIds.find(s => reels.some(r => r.id === s)) ?? null); setActiveClipId(null) }
  }
  // withScenes: also the scenes no other video uses. One undo step puts it all back.
  const deleteVideo = (id: string, withScenes = false) => {
    const v = latest.current.videos.find(x => x.id === id)
    if (!v) return
    const own = withScenes ? scenesOnlyIn(v) : []
    record([videoSnap(id), ...own.map(sceneSnap)], false)
    removeVideo(id)
    removeScenes(own)
  }


  // The project's colors win over the video's (videos made before project colors keep their own).
  const overlay = useMemo(() => {
    const o = overlaySettings(video?.overlay)
    return project?.settings.theme ? { ...o, theme: project.settings.theme } : o
  }, [video?.overlay, project?.settings.theme])
  const latest = useRef<AppLatest>({ results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, videos, videoId, video, orderOf, infoFor, overlayData: null, exportState: null, notice: null, dvwsRef: null, library: null, projectPath: null, activeGroup: null })
  latest.current = { ...latest.current, results, filter, matches, reels, reelId, reel, videos, videoId, video, orderOf, infoFor, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, notice, dvwsRef: dvws, library, activeGroup }
  const { saveState, flushAll, markSaved, forget } = useAutosave(reels, videos, latest, setError)
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
  const currentPlan = useCallback((target: 'video' | 'scene'): PlanItem[] => {
    const { video: v, reel: r, reels: rs, overlay: ov, matches: ms, settings: st, orderOf: of } = latest.current
    const codes = st?.ourTeamCodes ?? []
    if (target === 'scene') return r ? planScene(of(r), r, ov, ms, codes) : []
    return v ? planVideo(v, Object.fromEntries(rs.map(s => [s.id, s])), of, ov, ms, codes) : []
  }, [])

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
    { video, reel, reels, overlay, matches, settings, dvws, infoFor, orderOf }, latest, currentPlan, gridStyleRef)
  latest.current.exportState = exportState
  const exportBadge = exportState?.status === 'running' || exportState?.status === 'preparing' ? `${Math.round(exportState.ratio * 100)}%` : exportState?.status === 'done' ? '✓' : undefined
  // The gears: edit a title card over the video window — its title's place and size, and objects on
  // it (text, pictures, shapes). sceneId null = the video's opening card; marker null = the scene's card.
  // slideId: a slide of the scene instead, edited the same way (its objects; no title).
  const [cardEdit, setCardEdit] = useState<{ sceneId: string | null; marker: Marker | null; slideId?: string } | null>(null)
  // The edit mode: the side columns put away, the stage (a slide, a card or a clip) and its editing as large as can be.
  const [focusEdit, setFocusEdit] = useState(false)
  const [cardTool, setCardTool] = useState<'objects' | 'title' | 'logo'>('objects') // what the pointer edits on the card
  const [cardToolsOpen, setCardToolsOpen] = useState(false) // the object tools under a card or slide: folded until wanted
  useEffect(() => { if (cardEdit && selectedAnn) setCardToolsOpen(true) }, [cardEdit, selectedAnn]) // an object picked on it opens them
  const cardEditCard = useMemo((): Card | null => {
    if (!cardEdit) return null
    const codes = settings?.ourTeamCodes ?? []
    if (cardEdit.sceneId === null) return video ? videoCard(video, Object.fromEntries(reels.map(r => [r.id, r])), matches, codes) : null
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return null
    if (cardEdit.slideId) { const sl = sc.slides?.find(s => s.id === cardEdit.slideId); return sl ? slideCard(sl) : null }
    const m = cardEdit.marker
    const ids = m === null ? Object.keys(sc.clips) : sc.groups[m]
    return { marker: m, name: (m === null ? sc.cardTitle || sc.name : sc.markerCardTitles?.[m] || sc.markerNames[m]), ...cardMatch(sc, ids, matches, codes),
      annotations: (m === null ? sc.cardAnnotations : sc.markerCardAnnotations?.[m]) ?? [], layout: m === null ? sc.cardLayout : sc.markerCardLayouts?.[m] }
  }, [cardEdit, reels, video, matches, settings])
  const setCardAnns = useCallback((list: Annotation[]) => {
    const ce = cardEditRef.current
    if (!ce) return
    const now = new Date().toISOString()
    if (ce.sceneId === null) { const v = latest.current.video; if (v) updateVideo({ ...v, cardAnnotations: list, updatedAt: now }); return }
    const sc = latest.current.reels.find(x => x.id === ce.sceneId)
    if (!sc) return
    if (ce.slideId) { const sl = sc.slides?.find(s => s.id === ce.slideId); if (sl) updateReel(setSlide(sc, { ...sl, annotations: list })); return }
    updateReel(ce.marker === null ? { ...sc, cardAnnotations: list, updatedAt: now }
      : { ...sc, markerCardAnnotations: { ...sc.markerCardAnnotations, [ce.marker]: list }, updatedAt: now })
  }, [updateReel, updateVideo])
  const cardEditRef = useRef(cardEdit)
  cardEditRef.current = cardEdit
  const cardAnnsRef = useRef<Annotation[]>([])
  cardAnnsRef.current = cardEditCard?.annotations ?? []
  // The card's own text ('' = its name) and the name it falls back to.
  const cardTitleNow = (() => {
    if (!cardEdit || cardEdit.slideId) return { title: '', name: '' }
    if (cardEdit.sceneId === null) return { title: video?.cardTitle ?? '', name: video?.name ?? '' }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    const m = cardEdit.marker
    return m === null ? { title: sc?.cardTitle ?? '', name: sc?.name ?? '' } : { title: sc?.markerCardTitles?.[m] ?? '', name: sc?.markerNames[m] ?? '' }
  })()
  const setCardTitle = (t: string) => {
    if (!cardEdit) return
    const now = new Date().toISOString(), value = t.trim() ? t : undefined
    if (cardEdit.sceneId === null) { if (video) updateVideo({ ...video, cardTitle: value, updatedAt: now }); return }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return
    const m = cardEdit.marker
    updateReel(m === null ? { ...sc, cardTitle: value, updatedAt: now } : { ...sc, markerCardTitles: { ...sc.markerCardTitles, [m]: value }, updatedAt: now })
  }
  // This card's own title place and size, apart from the others of its kind (undefined: back with them).
  const setCardLayout = (l: CardLayout | undefined) => {
    if (!cardEdit) return
    const now = new Date().toISOString()
    if (cardEdit.sceneId === null) { if (video) updateVideo({ ...video, cardLayout: l, updatedAt: now }); return }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (!sc) return
    const m = cardEdit.marker
    updateReel(m === null ? { ...sc, cardLayout: l, updatedAt: now } : { ...sc, markerCardLayouts: { ...sc.markerCardLayouts, [m]: l }, updatedAt: now })
  }
  // Whether this card is shown at all (the same switches as the overlay dialog and the scene editor).
  const cardShown = !cardEdit ? false : cardEdit.sceneId === null ? !!overlay.titleCard.videoCard
    : cardEdit.marker === null ? (reels.find(x => x.id === cardEdit.sceneId)?.sceneCard ?? overlay.titleCard.sceneCards)
    : (() => { const sc = reels.find(x => x.id === cardEdit.sceneId); return sc ? markerCardOn(sc, cardEdit.marker!, overlay.titleCard.enabled) : false })()
  const setCardShown = (on: boolean) => {
    if (!cardEdit) return
    if (cardEdit.sceneId === null) { setOverlay({ ...overlay, titleCard: { ...overlay.titleCard, videoCard: on } }); return }
    if (cardEdit.marker === null) {
      const s = reels.find(x => x.id === cardEdit.sceneId)
      if (s) updateReel({ ...s, sceneCard: on, updatedAt: new Date().toISOString() })
      return
    }
    const sc = reels.find(x => x.id === cardEdit.sceneId)
    if (sc) updateReel({ ...sc, markerCards: { ...sc.markerCards, [cardEdit.marker]: on }, updatedAt: new Date().toISOString() })
  }
  // The palette works on the card being edited, else on the active clip: what "save" stores is the
  // selection with its groups; a used item goes on top and is selected.
  const paletteSelection = useMemo(() => {
    const list = cardEditCard ? cardEditCard.annotations ?? [] : activeAnns
    if (!selectedAnn) return []
    const ids = withGroups(list, [selectedAnn, ...extraSel])
    return list.filter(a => ids.includes(a.id))
  }, [cardEditCard, activeAnns, selectedAnn, extraSel])
  const putPaletteItem = (anns: Annotation[]) => {
    if (!anns.length) return
    if (cardEditRef.current) setCardAnns([...cardAnnsRef.current, ...anns])
    else { const now = scopedNow(); if (!now) return; setAnns([...mergeScoped(now), ...anns]) }
    setAnnTool('select'); selectAnn(anns[0].id)
  }
  // Ctrl+C / Ctrl+V: the selected objects (with their groups) are kept here with times relative to
  // the clip's IN, like a palette item, and pasted as new objects on the clip or card being edited.
  // Only within the project: pictures are the project's own files.
  const paletteSelRef = useRef<Annotation[]>([])
  paletteSelRef.current = paletteSelection
  const copied = useRef<{ projectPath: string | null; anns: Annotation[] } | null>(null)
  // The edited clip's IN, or null on a title card; undefined when nothing can take objects.
  const editInNow = (): number | null | undefined => {
    if (cardEditRef.current) return null
    const { reel: r, activeClipId: id, clipInfo: info } = latest.current
    const c = r && id ? r.clips[id] : null
    return c ? info(c).range?.in : undefined
  }
  const copyObjects = (): boolean => {
    const sel = paletteSelRef.current, at = editInNow()
    if (!sel.length || at === undefined) return false
    copied.current = { projectPath: latest.current.projectPath, anns: sel.map(a => shiftTimes(a, at === null ? null : -at)) }
    void api.markObjectsCopied() // so Ctrl+V pastes these until something else is copied

    const msg = keyName(t('図形を {0} 個コピーしました（Ctrl+V で貼り付け）', sel.length))
    setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 2500) // a short note, not one to dismiss
    return true
  }
  const pasteObjects = (): boolean => {
    const c = copied.current, at = editInNow()
    if (!c || c.projectPath !== latest.current.projectPath || at === undefined || playback.current.seq) return false
    const list = cardEditRef.current ? cardAnnsRef.current : mergeScoped(scopedNow()!)
    const copies = pasteCopies(freshIds(c.anns.map(a => shiftTimes(a, at))), list)
    putPaletteItem(copies)
    setExtraSel(copies.slice(1).map(a => a.id))
    return true
  }
  const editCard = (sceneId: string | null, marker: Marker | null, slideId?: string) => {
    playback.stopSequence(); playback.pause(); setSelectedAnn(null); setCardTool('objects'); setCardToolsOpen(false); setCardEdit({ sceneId, marker, ...(slideId ? { slideId } : {}) })
  }
  // A slide that was removed (or undone away) while open: back to the clips.
  useEffect(() => { if (cardEdit?.slideId && !cardEditCard) setCardEdit(null) }, [cardEdit, cardEditCard])
  const editingSlide = useMemo(() => {
    const ce = cardEdit
    return ce?.slideId ? reels.find(x => x.id === ce.sceneId)?.slides?.find(s => s.id === ce.slideId) ?? null : null
  }, [cardEdit, reels])
  const editingSource = editingSlide?.bg.kind === 'image' ? editingSlide.bg.source : undefined

  // ---- slides ---------------------------------------------------------------------------------
  // The ＋ in the scene editor: a blank page, the pages of PDFs and pictures (they remember their
  // file, to be read again when it changes), or the picture on screen. Blank and on-screen slides
  // open for editing right away.
  const updateScene = (id: string, fn: (r: Reel) => Reel) => {
    const sc = latest.current.reels.find(x => x.id === id)
    if (sc) updateReel(fn(sc))
  }
  const slidesFrom = async (files: SlideFile[]): Promise<Slide[]> => {
    const out: Slide[] = []
    try {
      for (const f of files) {
        const source = { path: f.path, name: f.name, mtimeMs: f.mtimeMs }
        if (f.kind === 'image') { out.push(newSlide({ kind: 'image', assetId: f.assetId, source: { ...source, page: null } })); continue }
        const pages: Slide[] = []
        const total = await pdfPages(f.data, async (n, png, total) => {
          setProgress({ stage: 'save', message: t('{0} を読み込んでいます（{1} / {2} ページ）', f.name, n, total), ratio: n / total })
          pages.push(newSlide({ kind: 'image', assetId: await api.saveAsset(png), source: { ...source, page: n } }))
        })
        out.push(...pages.map(s => (s.bg.kind === 'image' && s.bg.source ? { ...s, bg: { ...s.bg, source: { ...s.bg.source, pages: total } } } : s)))
      }
    } finally {
      setProgress(null)
    }
    return out
  }
  // The picture on screen as a slide right after the open clip, in the group it was opened from.
  const frameAfterClip = () => {
    const r = latest.current.reel, id = latest.current.activeClipId
    if (!r || !id) return
    const group = activeGroup !== null && r.groups[activeGroup].includes(id) ? activeGroup : markersOf(r, id)[0] ?? 'none'
    const ids = group === 'none' ? chronological(r, r.groups.none, whenIn(r)).map(c => c.id) : r.groups[group]
    const rows = groupRows(r, group, ids)
    return putSlide(spotAt(rows, group, rows.findIndex(x => x.kind === 'clip' && x.id === id) + 1), 'frame')
  }
  // The data slides read positions from the players: the project's positions put on them.
  const boardDvws = useMemo(() => Object.values(dvws).map(d => withRoles(d, settings?.roles)), [dvws, settings?.roles])
  // Slides comparing players: each lays out its players, with their photos copied into the project.
  // They go at the end of the open scene's first marker, or into a new scene when none is open.
  const [boardOpen, setBoardOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false) // the match report
  const [boardEdit, setBoardEdit] = useState<Slide | null>(null) // the card whose make-up is being changed
  const makeBoard = async (c: BoardChoice) => {
    const { setView, display, skill, columns, split, notes, noteSize, noteFills, photos: withPhotos, background, marker, team, searched } = c, perSlide = columns.length
    const old = boardEdit
    setBoardOpen(false); setBoardEdit(null)
    try {
      const photos: Record<string, BoardPhoto> = {}
      for (const p of withPhotos ? columns : []) {
        const found = photos[p.key] ? null : findPhoto(packs, p.player, p.team)
        if (found) photos[p.key] = await api.usePackPhoto(found.pack, found.player.photo)
      }
      const list: Slide[] = []
      const kept = old ? keptByHand(old) : { hand: [], noteTexts: [] }
      for (let i = 0; i < columns.length; i += perSlide) {
        const s = newSlide({ kind: 'blank', color: background }, old?.durationSec ?? BOARD_SEC), part = columns.slice(i, i + perSlide)
        const { annotations, charts, noteIds } = boardSlide(part, skill, { setView, split, notes, noteSize, noteFills, background, display, ...(markStyle(gridStyle, skill).chart ? { style: markStyle(gridStyle, skill).chart } : {}), ...(i ? {} : { noteTexts: kept.noteTexts }) }, photos)
        const config = { setView, display, skill, team, split, notes, noteSize, noteFills, photos: withPhotos, background, searched, columns: part.map(x => ({ key: x.key, code: x.code ?? null, ...(x.attention ? { attention: true } : {}) })) }
        list.push({ ...s, annotations: i ? annotations : [...annotations, ...kept.hand], charts, board: { config, made: annotations.map(a => a.id), noteIds } })
      }
      if (old && cardEdit?.sceneId) {
        // In place of the card; if it no longer fits on one, the rest right after it.
        const sceneId = cardEdit.sceneId
        updateScene(sceneId, r => {
          const at = (r.slides ?? []).filter(x => x.group === old.group && x.after === old.after).findIndex(x => x.id === old.id)
          const [first, ...rest] = list
          return putSlides(setSlide(r, { ...first, id: old.id, group: old.group, after: old.after }), rest, { group: old.group, after: old.after, index: at + 1 })
        })
        return
      }
      let scene = latest.current.reel
      if (!scene) {
        scene = newReel(t('シーン {0}', latest.current.reels.length + 1))
        addScenes([scene]); latest.current = { ...latest.current, reel: scene }; showScene(scene.id)
        record([{ kind: 'scene', id: scene.id, value: null }, placeInVideo(scene.id)], false)
      }
      // At the head of the marker, where its title card would be.
      const group = marker, sceneId = scene.id
      updateScene(sceneId, r => putSlides(r, list, spotAt(groupRows(scene, group), group, 0)))
      editCard(sceneId, null, list[0].id)
    } catch (e) {
      setError(String(e))
    }
  }

  // The open card as a picture, or all the scene's cards and slides, in order, as a PDF.
  const saveCards = async (as: 'png' | 'pdf', slide: Slide) => {
    try {
      const scene = latest.current.reel
      const name = scene?.name || t('データスライド')
      if (as === 'png') {
        const [png] = await cardImages([slideCard(slide)], overlay, gridStyle.heatOpacity, 'image/png')
        const path = await api.saveCard(name, 'png', png)
        if (path) setNotice(t('書き出しました: {0}', path))
        return
      }
      const all = scene ? [...scene.groupOrder, 'none' as const].flatMap(g => groupRows(scene, g).flatMap(r => (r.kind === 'slide' ? [r.slide] : []))) : [slide]
      const pages = await cardImages(all.map(slideCard), overlay, gridStyle.heatOpacity, 'image/jpeg')
      const path = await api.saveCard(name, 'pdf', pdfFromJpegs(pages.map(jpeg => ({ jpeg, width: CARD_W, height: CARD_H }))))
      if (path) setNotice(t('書き出しました: {0}', path))
    } catch (e) {
      setError(String(e))
    }
  }

  const putSlide = async (spot: SlideSpot, how: SlideHow, files?: SlideFile[]) => {
    const sceneId = latest.current.reel?.id
    if (!sceneId) return
    try {
      let list: Slide[]
      if (how === 'blank') list = [newSlide({ kind: 'blank' })]
      else if (how === 'frame') {
        const key = playback.attachedKey
        if (!key) return
        list = [newSlide({ kind: 'image', assetId: await api.grabFrame(key, playback.current.time) })]
      } else list = await slidesFrom(files ?? await api.pickSlides())
      if (!list.length) return
      updateScene(sceneId, r => putSlides(r, list, spot))
      if (how === 'file') { const msg = t('スライドを {0} 枚入れました', list.length); setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 2500) }
      else editCard(sceneId, null, list[0].id)
    } catch (e) {
      setProgress(null)
      setError(t('スライドを入れられませんでした: {0}', (e as Error).message))
    }
  }

  const { staleSlides, checkSlideFiles, laterSlides, reloadSlideFiles } = useSlideFiles(() => latest.current.reels, updateReel, setProgress, setNotice)
  const setOverlay = useCallback((s: OverlaySettings) => {
    const v = latest.current.video
    if (v) updateVideo({ ...v, overlay: s, updatedAt: new Date().toISOString() })
  }, [updateVideo])

  // The active clip's objects with its scene's and its video's (表示範囲). The editor gets them
  // merged; edits are split back to where each object lives.
  const scopedNow = (): ScopedAnnotations | null => {
    const { reel: r, activeClipId: id, video: v } = latest.current
    const c = r && id ? r.clips[id] : null
    const m = c ? markerFor(r!, c.id, latest.current.activeGroup) : null
    return c ? { video: v?.annotations ?? [], scene: r!.annotations ?? [], marker: m ? r!.markerAnnotations?.[m] ?? [] : [], clip: c.annotations } : null
  }
  const applyScoped = useCallback((next: ScopedAnnotations) => {
    const { reel: r, activeClipId: id, video: v } = latest.current
    const prev = scopedNow()
    if (!r || !id || !prev) return
    const now = new Date().toISOString()
    const m = markerFor(r, id, latest.current.activeGroup)
    if (changed(prev.clip, next.clip) || changed(prev.scene, next.scene) || (m && changed(prev.marker, next.marker))) {
      let nr = changed(prev.clip, next.clip) ? setAnnotations(r, id, next.clip) : r
      if (changed(prev.scene, next.scene)) nr = { ...nr, annotations: next.scene, updatedAt: now }
      if (m && changed(prev.marker, next.marker)) nr = { ...nr, markerAnnotations: { ...nr.markerAnnotations, [m]: next.marker }, updatedAt: now }
      updateReel(nr)
    }
    if (v && changed(prev.video, next.video)) updateVideo({ ...v, annotations: next.video, updatedAt: now })
  }, [updateReel, updateVideo])
  const setAnns = useCallback((list: Annotation[]) => {
    const prev = scopedNow()
    if (prev) applyScoped(splitScoped(prev, list))
  }, [applyScoped])
  const setAnnScope = useCallback((annId: string, to: AnnScope) => {
    const prev = scopedNow()
    if (prev) applyScoped(moveToScope(prev, annId, to))
  }, [applyScoped])
  // When an object shows (video times; null = the clip's edge), from the timeline under 編集 or 図形.
  const setObjectSpan = useCallback((id: string, span: { from?: number | null; to?: number | null }) => {
    const now = scopedNow()
    if (!now) return
    setAnns(mergeScoped(now).map(a => {
      if (a.id !== id) return a
      let next: Annotation = a
      for (const [edge, v] of Object.entries(span) as ['from' | 'to', number | null | undefined][]) {
        if (v === undefined) continue
        const key = edge === 'from' ? 'showFrom' : 'showTo'
        const { [key]: _old, ...rest } = next
        next = (v === null ? rest : { ...rest, [key]: v }) as Annotation
      }
      return next
    }))
  }, [setAnns])

  // Puts a picture (or page 1 of a PDF) in the middle of the frame, 30% of its width.
  // A picture (from get) in the middle of the open clip or card, selected to move or resize.
  // tell: say so when nothing is open to put it on (a paste can come at any time).
  const placeImage = useCallback(async (get: () => Promise<{ assetId: string; width: number; height: number } | null>, tell = false): Promise<string | null> => {
    const { reel: r, activeClipId: id, matches: ms } = latest.current
    const c = r && id ? r.clips[id] : null
    const onCard = !!cardEditRef.current
    if (!c && !onCard) { if (tell) setNotice(t('画像を貼り付けるには、クリップかカードを開いてください')); return null }
    try {
      const img = await get()
      if (!img) return null
      const m = c ? ms[c.matchId] : undefined
      const frame = m?.width && m.height ? m.width / m.height : 16 / 9
      const ratio = (img.height / img.width) * frame // normalized height per normalized width
      let w = 0.3, h = w * ratio
      if (h > 0.8) { h = 0.8; w = h / ratio }
      const a: Annotation = { id: crypto.randomUUID(), kind: 'image', color: '#FFFFFF', x: (1 - w) / 2, y: (1 - h) / 2, w, h, assetId: img.assetId }
      if (cardEditRef.current) { setCardAnns([...cardAnnsRef.current, a]) } else {
        const now = scopedNow()
        if (now) setAnns([...mergeScoped(now), a])
      }
      setSelectedAnn(a.id); setAnnTool('select')
      return a.id
    } catch (e) {
      setError((e as Error).message)
      return null
    }
  }, [setAnns, setCardAnns])
  const insertImage = useCallback((path?: string) => placeImage(() => insertAsset(path)), [placeImage])
  // Ctrl+V with a picture on the system clipboard (a screenshot, an image copied elsewhere).
  const pasteImage = useCallback(() => placeImage(() => api.saveClipboardImage(), true), [placeImage])

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

  // ---- project ------------------------------------------------------------------------------
  // ---- library and projects (v3) -------------------------------------------------------------
  const guard = async (fn: () => Promise<void>) => {
    setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setProgress(null) }
  }
  const resetView = () => { setFilter(EMPTY_FILTER); setSelected(null); setActiveClipId(null); setMatchId(null) }
  const openProject = (path?: string) => guard(async () => {
    const p = await api.openProject(path)
    if (p) { resetView(); await loadProject(p); setRecent(await api.recentProjects()) }
  })
  const goHome = async () => {
    await flushAll() // nothing pending is lost on the way out
    playback.stopSequence()
    await api.closeProject()
    resetView()
    setProject(null); setReels([]); setReelId(null); setVideos([]); setVideoId(null); setDvws({})
    setLibrary(await api.getLibrary()); setRecent(await api.recentProjects())
  }
  const chooseLibrary = () => guard(async () => { const l = await api.chooseLibrary(); if (l) { setLibrary(l); setProject(null) } })
  const scanFolders = () => guard(async () => { const r = await api.scanFolders(); if (r) setScan(r) })
  const importPairs = (pairs: { dvwPath: string; video: string }[]) => guard(async () => {
    setScan(null)
    const r = await api.importPairs(pairs)
    setLibrary(await api.getLibrary())
    if (r.failed.length) setError(t('取り込めなかった試合があります: {0}', r.failed.map(f => t('{0}（{1}）', f.dvwPath.split(/[\\/]/).pop(), f.message)).join(' / ')))
    else setNotice(t('{0} 試合を倉庫に取り込みました', r.imported.length))
  })
  const relocate = (id: string, part: MissingPart) => guard(async () => {
    const r = await api.relocateMatch(id, part)
    if (!r) return
    setLibrary(r.library)
    if (r.project) await loadProject(r.project)
    setNotice(r.note)
  })
  const importOne = () => guard(async () => { const m = await api.importMatch(); if (m) setLibrary(await api.getLibrary()) })
  const pickerDone = (r: { name: string; codes: string[]; matchIds: string[]; chooseFolder?: boolean }) => guard(async () => {
    setPicker(null)
    if (picker === 'create') {
      const p = await api.createProject({ name: r.name, ourTeamCodes: r.codes, matchIds: r.matchIds, chooseFolder: r.chooseFolder })
      if (p) { resetView(); await loadProject(p); setRecent(await api.recentProjects()) }
      return
    }
    await api.saveSettings({ ...latest.current.settings!, ourTeamCodes: r.codes })
    await loadProject(await api.setProjectMatches(r.matchIds))
  })

  // The teams in the project's matches for the logo list: opponents first, then ours.
  const projectTeams = useMemo(() => {
    const map = new Map<string, { code: string; name: string }>()
    for (const m of project?.matches ?? []) for (const t of m.teams) if (!map.has(t.code)) map.set(t.code, { code: t.code, name: t.name })
    const ours = settings?.ourTeamCodes ?? []
    return [...map.values()].sort((a, b) => Number(ours.includes(a.code)) - Number(ours.includes(b.code)) || a.code.localeCompare(b.code))
  }, [project, settings])
  const saveSettings = async (s: ProjectSettings, merge = true) => {
    const prev = latest.current.settings
    const change = prev ? settingsChange(prev, s) : {}
    if (Object.keys(change).length) record({ kind: 'settings', value: change }, merge)
    setProject(await api.saveSettings(s))
  }



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
                        size={size} annotations={cardEditCard.annotations ?? []} clip={{ key: 'card', in: 0, out: 1e9 }} always
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
                title={cardTitleNow.title} nameTitle={cardTitleNow.name} onTitle={setCardTitle} />
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
              onSelectScene={id => { setReelId(id); setActiveClipId(null); setRightTab('scene') }} onNewScene={() => { createReel(); setRightTab('scene') }}
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
              onNewReel={createReel} onDeleteReel={deleteReel} onChange={updateReel}
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
