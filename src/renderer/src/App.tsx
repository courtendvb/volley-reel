import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { composing } from './keys'
import { EMPTY_FILTER, applyFilter, buildRefs, detailOptions, listPeople, ourSide, type PlayFilter, type PlayRef } from '../../shared/filter'
import {
  DEFAULT_RANGE, addClips, clipRange, defaultRange, findClip, chronological, findOverlaps, markerCardOn, markersOf, newReel, newSlide, playOrder, putSlides, rangeDefaults, relink, setAnnotations, setOverlayOverride, setSlide, setTag, toggleMarker, trimClip,
  type Clip, type ClipMode, type Group, type Marker, type Reel, type Slide, type SlideSpot,
} from '../../shared/reel'
import type { ImportProgress, Match, MissingPart, ParsedDVW, ProjectInfo, ProjectSettings, SlideFile } from '../../shared/types'
import { FilterPanel, type Scope } from './components/FilterPanel'
import { PlayList, type PlayKey } from './components/PlayList'
import { ReelPanel, type ClipInfo, type SlideHow } from './components/ReelPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { TrimBar } from './components/TrimBar'
import { AnnotationLayer, type AnnStyle, type Tool } from './components/AnnotationLayer'
import { AnnotationTools, KIND_LABEL } from './components/AnnotationTools'
import { HeadlineBar } from './components/HeadlineBar'
import { freshIds, pasteCopies, shiftTimes, withGroups, type Annotation } from '../../shared/annotation'
import { changed, mergeScoped, moveToScope, scopeOf, splitScoped, type AnnScope, type ScopedAnnotations } from '../../shared/annotationScope'
import { captionData, overlaySettings, scoreboardData, type CaptionData, type OverlaySettings, type ScoreboardData } from '../../shared/overlay'
import { OverlayLayer } from './components/OverlayLayer'
import { OverlayDialog } from './components/OverlayDialog'
import { ClipOverlayRow } from './components/ClipOverlayRow'
import { EXPORT_HEIGHT, buildExportJob } from './exportRender'
import { addScene, cardMatch, dropScene, newVideo, planScene, planSceneWithCard, planVideo, planVideoChapters, sceneFileNames, slideCard, videoCard, type Card, type PlanItem, type Video } from '../../shared/video'
import { CardEditBar, CardEditor, SlideEditBar } from './components/CardEditor'
import { FadeLayer } from './components/FadeLayer'
import { PalettePanel } from './components/PalettePanel'
import { ExportPanel, type ExportTarget } from './components/ExportPanel'
import { VideoPanel } from './components/VideoPanel'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { Home, MissingNote } from './components/Home'
import { ScanDialog } from './components/ScanDialog'
import { MatchPicker } from './components/MatchPicker'
import type { LibraryInfo, RecentProject, ScanResult } from '../../shared/types'
import type { ExportEvent } from '../../shared/types'
import { VideoPane } from './components/VideoPane'
import { insertAsset, pdfPages, resetAssets } from './assets'
import type { SmokeHost } from './smoke'
import { playback, type SequenceItem } from './playback'

const api = window.api
// The main process loads the page with ?smoke when it runs a self-check (VR_SMOKE).
const SMOKE = new URLSearchParams(location.search).has('smoke')
const PREROLL_SEC = 2 // jump a little before the contact so the play is seen building up

// Clips whose play can't be found in the DVW, per scene object and DVW set (relink walks every clip).
// The marker group a clip is worked on in: the one it was opened from if it is still in it, else its
// first marker (null when it has none, so there are no marker-wide objects to show).
function markerFor(r: Reel, clipId: string, preferred: Group | null): Marker | null {
  if (preferred && preferred !== 'none' && r.groups[preferred].includes(clipId)) return preferred
  return markersOf(r, clipId)[0] ?? null
}

const missingMemo = new WeakMap<Reel, { dvws: Record<string, ParsedDVW>; missing: Set<string> }>()
function missingOf(r: Reel, dvws: Record<string, ParsedDVW>): Set<string> {
  const hit = missingMemo.get(r)
  if (hit && hit.dvws === dvws) return hit.missing
  const missing = relink(r, dvws).missing
  missingMemo.set(r, { dvws, missing })
  return missing
}
const SAVE_DELAY_MS = 400
const UNDO_MERGE_MS = 600
const UNDO_LIMIT = 100

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [dvws, setDvws] = useState<Record<string, ParsedDVW>>({})
  const [matchId, setMatchId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('all') // the list shows every match in the project unless one is picked
  // How plays added from the search are cut: around the key play, or from it to the end of the rally.
  const [extract, setExtract] = useState<ClipMode>(() => { try { return localStorage.getItem('vr.extract') === 'toEnd' ? 'toEnd' : 'keyplay' } catch { return 'keyplay' } })
  useEffect(() => { try { localStorage.setItem('vr.extract', extract) } catch { /* not kept */ } }, [extract])
  const extractRef = useRef(extract)
  extractRef.current = extract
  // With all matches listed: the order of the matches (each keeps its plays in time order).
  const [matchOrder, setMatchOrder] = useState<'old' | 'new'>(() => { try { return localStorage.getItem('vr.matchOrder') === 'new' ? 'new' : 'old' } catch { return 'old' } })
  useEffect(() => { try { localStorage.setItem('vr.matchOrder', matchOrder) } catch { /* not kept */ } }, [matchOrder])
  const [filter, setFilter] = useState<PlayFilter>(EMPTY_FILTER)
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
  const [exportState, setExportState] = useState<{ status: 'preparing' | 'running' | ExportEvent['type']; ratio: number; message: string; outPath?: string } | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [library, setLibrary] = useState<LibraryInfo | null>(null)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [picker, setPicker] = useState<'create' | 'edit' | null>(null)

  const matches = useMemo(() => Object.fromEntries((project?.matches ?? []).map(m => [m.id, m])), [project])
  const match = matchId ? matches[matchId] ?? null : null
  const reel = reels.find(r => r.id === reelId) ?? null
  const video = videos.find(v => v.id === videoId) ?? null

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
    saved.current = new Map<string, object>([
      ...relinked.filter(x => !x.changed).map(x => [`scene:${x.reel.id}`, x.reel] as const),
      ...vids.map(v => [`video:${v.id}`, v] as const),
    ])
    savedJson.current = new Map([...saved.current].map(([k, o]) => [k, JSON.stringify(o)] as const))
    undoStack.current = []; redoStack.current = []
    setReels(loaded)
    void checkSlideFiles(loaded)
    setVideos(vids)
    setVideoId(id => (id && vids.some(v => v.id === id) ? id : vids[0]?.id ?? null))
    const notes = await api.takeNotices()
    if (notes.length) setNotice(notes.join(' / '))
    setReelId(id => (id && loaded.some(r => r.id === id) ? id : loaded[0]?.id ?? null))
  }, [])

  // Autosave: any reel whose JSON differs from what was last written is saved shortly after.
  // Closing the window flushes whatever is still pending (see the main process's close handler).
  // The last saved object per "scene:id" / "video:id" (unchanged = the same object) and its JSON.
  const saved = useRef(new Map<string, object>())
  const savedJson = useRef(new Map<string, string>())
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved')
  const allClean = () => latest.current.reels.every(x => saved.current.get(`scene:${x.id}`) === x)
    && latest.current.videos.every(x => saved.current.get(`video:${x.id}`) === x)
  const saveNow = useCallback(async (kind: 'scene' | 'video', obj: Reel | Video) => {
    const key = `${kind}:${obj.id}`
    if (saved.current.get(key) === obj) return
    // Serialized only here, for an object that may have changed: an edit that ended where it
    // started is not written again.
    const json = JSON.stringify(obj)
    if (savedJson.current.get(key) === json) { saved.current.set(key, obj); if (allClean()) setSaveState('saved'); return }
    try {
      if (kind === 'scene') await api.saveReel(obj as Reel); else await api.saveVideo(obj as Video)
      saved.current.set(key, obj); savedJson.current.set(key, json)
      if (allClean()) setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      setError(`${kind === 'scene' ? 'シーン' : '動画'}を保存できませんでした: ${(e as Error).message}`)
    }
  }, [])
  const flushAll = useCallback(() => Promise.all([
    ...latest.current.reels.map(r => saveNow('scene', r)), ...latest.current.videos.map(v => saveNow('video', v)),
  ]), [saveNow])
  useEffect(() => {
    const dirty = [
      ...reels.filter(r => saved.current.get(`scene:${r.id}`) !== r).map(r => ['scene', r] as const),
      ...videos.filter(v => saved.current.get(`video:${v.id}`) !== v).map(v => ['video', v] as const),
    ]
    if (!dirty.length) return
    setSaveState(s => (s === 'error' ? s : 'pending'))
    const timers = dirty.map(([k, o]) => window.setTimeout(() => void saveNow(k, o), SAVE_DELAY_MS))
    return () => timers.forEach(t => clearTimeout(t))
  }, [reels, videos, saveNow])
  useEffect(() => api.onFlushRequest(async () => { await flushAll() }), [flushAll])

  const settings = project?.settings
  const refsByMatch = useMemo(() => {
    const out: Record<string, PlayRef[]> = {}
    if (settings) for (const m of project!.matches) if (dvws[m.id]) out[m.id] = buildRefs(m.id, dvws[m.id], settings)
    return out
  }, [dvws, settings, project])

  const scopeRefs = useMemo(() => {
    if (scope === 'match') return matchId ? refsByMatch[matchId] ?? [] : []
    const ms = project?.matches ?? [] // oldest first
    return (matchOrder === 'new' ? [...ms].reverse() : ms).flatMap(m => refsByMatch[m.id] ?? [])
  }, [scope, matchId, refsByMatch, project, matchOrder])
  const results = useMemo(() => applyFilter(scopeRefs, filter), [scopeRefs, filter])
  const people = useMemo(() => listPeople(scopeRefs), [scopeRefs])
  // Detailed search choices: those found in the plays in scope (of the chosen skills, when any).
  const details = useMemo(() => detailOptions(filter.skills.length ? scopeRefs.filter(r => filter.skills.includes(r.play.skill)) : scopeRefs), [scopeRefs, filter.skills])
  const teamFilterLimited = useMemo(() => scopeRefs.some(r => r.teamRole === null), [scopeRefs])
  // Where each match comes in the play list (old or new matches first): clips without a marker, and
  // clips just marked, go in this order too, so the scene reads like the list it was picked from.
  const matchRank = useMemo(() => {
    const ms = project?.matches ?? [] // oldest first
    const list = matchOrder === 'new' ? [...ms].reverse() : ms
    return Object.fromEntries(list.map((m, i) => [m.id, String(i).padStart(4, '0')]))
  }, [project, matchOrder])
  const matchLabels = useMemo(() => labelMatches(project?.matches ?? [], settings?.ourTeamCodes ?? []), [project, settings])

  // ---- reels --------------------------------------------------------------------------------
  // One undo history for scenes, videos and the project settings, in the order edits happened. Edits to the same thing
  // within UNDO_MERGE_MS (a handle drag, typing a name) become one step.
  type Snapshot = { kind: 'scene'; value: Reel } | { kind: 'video'; value: Video } | { kind: 'settings'; value: ProjectSettings }
  const undoStack = useRef<{ key: string; prev: Snapshot; at: number }[]>([])
  const redoStack = useRef<{ key: string; prev: Snapshot; at: number }[]>([])
  const record = useCallback((prev: Snapshot) => {
    const key = prev.kind === 'settings' ? 'settings' : `${prev.kind}:${prev.value.id}`, now = Date.now(), top = undoStack.current[undoStack.current.length - 1]
    if (top && top.key === key && now - top.at < UNDO_MERGE_MS) top.at = now
    else { undoStack.current.push({ key, prev, at: now }); if (undoStack.current.length > UNDO_LIMIT) undoStack.current.shift() }
    redoStack.current = []
  }, [])
  const putScene = (r: Reel) => {
    latest.current = { ...latest.current, reels: latest.current.reels.map(x => (x.id === r.id ? r : x)), reel: latest.current.reel?.id === r.id ? r : latest.current.reel }
    setReels(rs => rs.map(x => (x.id === r.id ? r : x)))
  }
  const putVideo = (v: Video) => {
    latest.current = { ...latest.current, videos: latest.current.videos.map(x => (x.id === v.id ? v : x)), video: latest.current.video?.id === v.id ? v : latest.current.video }
    setVideos(vs => vs.map(x => (x.id === v.id ? v : x)))
  }
  const updateReel = useCallback((r: Reel) => {
    const prev = latest.current.reels.find(x => x.id === r.id)
    if (prev && prev !== r) record({ kind: 'scene', value: prev })
    putScene(r)
  }, [record])
  const updateVideo = useCallback((v: Video) => {
    const prev = latest.current.videos.find(x => x.id === v.id)
    if (prev && prev !== v) record({ kind: 'video', value: prev })
    putVideo(v)
  }, [record])
  const undoRedo = useCallback((dir: 'undo' | 'redo') => {
    const [from, to] = dir === 'undo' ? [undoStack.current, redoStack.current] : [redoStack.current, undoStack.current]
    for (let e = from.pop(); e; e = from.pop()) {
      if (e.prev.kind === 'settings') {
        const now = latest.current.settings
        if (!now) continue
        to.push({ key: e.key, prev: { kind: 'settings', value: now }, at: 0 })
        void api.saveSettings(e.prev.value).then(setProject).catch(err => setError(String(err)))
        return
      }
      const id = e.prev.value.id
      const cur = e.prev.kind === 'scene' ? latest.current.reels.find(x => x.id === id) : latest.current.videos.find(x => x.id === id)
      if (!cur) continue // deleted since: skip to the next step
      to.push({ key: e.key, prev: { kind: e.prev.kind, value: cur } as Snapshot, at: 0 })
      if (e.prev.kind === 'scene') { putScene(e.prev.value); setReelId(e.prev.value.id) } else { putVideo(e.prev.value); setVideoId(e.prev.value.id) }
      return
    }
  }, [])
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
    const st = { clips: o.length, sec: o.reduce((t, c) => { const r = infoFor(c, s).range!; return t + r.out - r.in }, 0) }
    statsMemo.set(s, st)
    return st
  }, [orderOf, infoFor, statsMemo])
  const order = useMemo(() => {
    if (!reel) return []
    return playOrder(reel, c => { const i = clipInfo(c); return [i.matchKey, i.range?.in ?? 0] })
      .filter(c => !missing.has(c.id) && clipInfo(c).range)
  }, [reel, clipInfo, missing])
  const orderSec = useMemo(() => order.reduce((s, c) => { const r = clipInfo(c).range!; return s + r.out - r.in }, 0), [order, clipInfo])
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
    const next = fn(cur ?? newReel(`シーン ${rs.length + 1}`))
    if (cur) record({ kind: 'scene', value: cur })
    const all = cur ? rs.map(r => (r.id === cur.id ? next : r)) : [...rs, next]
    latest.current = { ...latest.current, reels: all, reelId: next.id, reel: next }
    setReels(all)
    setReelId(next.id)
    if (!cur) placeInVideo(next.id)
    return next
  }, [record])
  // A new scene goes into the current video; with no video yet, the first one is made for it.
  const placeInVideo = (sceneId: string) => {
    const v = latest.current.video
    if (v) { updateVideo(addScene(v, sceneId)); return }
    const nv = newVideo(`動画 ${latest.current.videos.length + 1}`, [sceneId])
    latest.current = { ...latest.current, videos: [...latest.current.videos, nv], video: nv }
    setVideos(vs => [...vs, nv]); setVideoId(nv.id)
  }

  const addPlays = useCallback((refs: PlayRef[], group: Group = 'none') => {
    withReel(r => addClips(r, refs.map(x => ({ matchId: x.matchId, play: x.play })), group, extractRef.current).reel)
  }, [withReel])
  // The 1–5 buttons on a list row: add the play to the scene with that marker (again: clear it).
  const markPlay = useCallback((ref: PlayRef, m: Marker) => {
    withReel(r => {
      const { reel: next, ids } = addClips(r, [{ matchId: ref.matchId, play: ref.play }], 'none', extractRef.current)
      return toggleMarker(next, ids[0], m, whenIn(next))
    })
  }, [withReel])

  const createReel = () => {
    const r = newReel(`シーン ${reels.length + 1}`)
    latest.current = { ...latest.current, reels: [...latest.current.reels, r] }
    setReels(rs => [...rs, r]); setReelId(r.id); setActiveClipId(null)
    placeInVideo(r.id)
  }
  // Deleting a scene takes it out of every video that used it.
  const deleteReel = async (id: string) => {
    await api.deleteReel(id)
    saved.current.delete(`scene:${id}`); savedJson.current.delete(`scene:${id}`)
    const rest = reels.filter(r => r.id !== id)
    setReels(rest); setReelId(rest[0]?.id ?? null); setActiveClipId(null)
    for (const v of latest.current.videos) if (v.sceneIds.includes(id)) updateVideo(dropScene(v, id))
  }
  // A new video starts empty; its scenes are added (or made) for it. Switching videos shows one of its scenes.
  const createVideo = () => {
    const v = newVideo(`動画 ${videos.length + 1}`, [])
    latest.current = { ...latest.current, videos: [...latest.current.videos, v], video: v }
    setVideos(vs => [...vs, v]); setVideoId(v.id); setReelId(null); setActiveClipId(null)
  }
  const selectVideo = (id: string) => {
    setVideoId(id)
    const v = videos.find(x => x.id === id)
    if (v && !(reelId && v.sceneIds.includes(reelId))) { setReelId(v.sceneIds.find(s => reels.some(r => r.id === s)) ?? null); setActiveClipId(null) }
  }
  const deleteVideo = async (id: string) => {
    await api.deleteVideo(id)
    saved.current.delete(`video:${id}`); savedJson.current.delete(`video:${id}`)
    const rest = videos.filter(v => v.id !== id)
    setVideos(rest); setVideoId(rest[0]?.id ?? null)
  }

  // The project's colors win over the video's (videos made before project colors keep their own).
  const overlay = useMemo(() => {
    const o = overlaySettings(video?.overlay)
    return project?.settings.theme ? { ...o, theme: project.settings.theme } : o
  }, [video?.overlay, project?.settings.theme])
  const latest = useRef({ results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, videos, videoId, video, orderOf, infoFor, overlayData: null as null | ((c: Clip | null) => { scoreboard: ScoreboardData; caption: CaptionData } | null), exportState: null as null | { status: string; ratio: number; message: string; outPath?: string }, notice: null as string | null, dvwsRef: null as null | Record<string, ParsedDVW>, library: null as LibraryInfo | null, projectPath: null as string | null, activeGroup: null as Group | null })
  latest.current = { ...latest.current, results, filter, matches, reels, reelId, reel, videos, videoId, video, orderOf, infoFor, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, exportState, notice, dvwsRef: dvws, library, activeGroup }

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
      items.push({ key: p.clip.matchId, ...inf(p.clip, byId[p.sceneId] ?? null).range! })
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
  const loopIn = activeInfo?.range?.in, loopOut = activeInfo?.range?.out
  // The active clip loops while it's being trimmed; a through-play overrides the loop.
  useEffect(() => {
    playback.setLoop(active && loopIn !== undefined && loopOut !== undefined && !seqPlaying && !listRun && loopOn ? { key: active.matchId, in: loopIn, out: loopOut } : null)
  }, [active, loopIn, loopOut, seqPlaying, listRun, loopOn])

  useEffect(() => setSelectedAnn(null), [activeClipId])

  // ---- annotations (design §3.6) --------------------------------------------------------------
  // Scoreboard and caption for a clip, from its play in the DVW.
  const overlayData = useCallback((c: Clip | null): { scoreboard: ScoreboardData; caption: CaptionData } | null => {
    const d = c ? dvws[c.matchId] : null, play = c && d ? d.plays[c.playId] : null
    if (!c || !d || !play) return null
    return { scoreboard: scoreboardData(d, play, settings?.ourTeamCodes ?? []), caption: captionData(d, play, overlay.playerCaption, c.overlayOverride?.playerCaption) }
  }, [dvws, settings, overlay])
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
  // The export panel's choices: the whole video, the open scene, each marker group of it.
  const planSec = (plan: PlanItem[]) => {
    const byId = Object.fromEntries(reels.map(s => [s.id, s]))
    let sec = 0, clips = 0, slides = 0
    for (const it of plan) {
      if (it.kind === 'card') { sec += it.durationSec; if (it.card.slide) slides++; continue }
      const r = infoFor(it.clip, byId[it.sceneId] ?? null).range
      if (r) { sec += r.out - r.in; clips++ }
    }
    return { sec, clips, slides, empty: !clips && !slides }
  }
  const slidesNote = (n: number) => (n ? `・スライド ${n}` : '')
  const fmtLen = (s: number) => `${Math.floor(Math.round(s) / 60)}分${String(Math.round(s) % 60).padStart(2, '0')}秒`
  const markerPlan = (sc: Reel, m: Marker) => {
    const only = { ...sc, markerOff: {}, scope: 'marked' as const, groupOrder: [m] }
    return planScene(orderOf(only), only, overlay, matches, settings?.ourTeamCodes ?? [])
  }
  // Each scene of the video with something to play, once, in the video's order: its plan as in the
  // video (its card, then its clips) and the file name it is saved under.
  const scenePlans = () => {
    const { video: v, reels: rs, orderOf: of, overlay: ov, matches: ms, settings: st } = latest.current
    if (!v) return []
    const byId = Object.fromEntries(rs.map(s => [s.id, s]))
    const list = [...new Set(v.sceneIds)].flatMap(id => {
      const s = byId[id]
      const plan = s ? planSceneWithCard(s, of(s), ov, ms, st?.ourTeamCodes ?? []) : []
      return s && plan.some(p => p.kind === 'clip' || p.card.slide) ? [{ name: s.name, plan }] : []
    })
    const files = sceneFileNames(list.map(x => x.name))
    return list.map((x, i) => ({ ...x, file: files[i] }))
  }
  // Rebuilt when the video, its scenes or the overlay change (planSec and markerPlan read the same state).
  const exportTargets: ExportTarget[] = useMemo(() => {
    if (!video) return []
    const out: ExportTarget[] = []
    const vp = planSec(currentPlan('video'))
    out.push({ key: 'video', label: 'すべて書き出し', detail: `${video.sceneIds.length} シーン・${vp.clips} クリップ${slidesNote(vp.slides)}・${fmtLen(vp.sec)}`, empty: vp.empty,
      hint: `動画「${video.name}」全体を 1 本に。YouTube のチャプター（.txt）も隣に書き出す` })
    const each = scenePlans()
    if (video.sceneIds.length > 1 || each.length > 1) {
      const sec = each.reduce((a, x) => a + planSec(x.plan).sec, 0)
      out.push({ key: 'scenes', label: 'シーンごとに書き出し', detail: `${each.length} 本・${fmtLen(sec)}`, empty: !each.length,
        hint: 'シーンを 1 本ずつ、シーンの名前のファイルに。フォルダを選ぶと順に書き出す' })
    }
    if (reel) {
      const sp = planSec(currentPlan('scene'))
      out.push({ key: 'scene', label: `シーン「${reel.name}」だけ`, detail: `${sp.clips} クリップ${slidesNote(sp.slides)}・${fmtLen(sp.sec)}`, empty: sp.empty })
      for (const m of reel.groupOrder) {
        if (!reel.groups[m].length && !reel.slides?.some(s => s.group === m)) continue
        const mp = planSec(markerPlan(reel, m))
        out.push({ key: `marker:${m}`, label: `マーカー ${m}「${reel.markerNames[m] || `マーカー ${m}`}」だけ`, detail: `${mp.clips} クリップ${slidesNote(mp.slides)}・${fmtLen(mp.sec)}`, empty: mp.empty })
      }
    }
    return out
  }, [video, reel, reels, overlay, matches, settings, dvws])
  const exportInfo = `${EXPORT_HEIGHT}p・${overlay.transition.fade ? 'フェードあり' : 'フェードなし'}・${overlay.titleCard.videoCard || overlay.titleCard.sceneCards || overlay.titleCard.enabled ? 'タイトルカードあり' : 'タイトルカードなし'}`
  const exportTarget = (key: string) => {
    if (key === 'video') { void startExport(); return }
    if (key === 'scenes') { void exportScenes(); return }
    const sc = latest.current.reel
    if (!sc) return
    if (key === 'scene') { void startExport(undefined, { plan: currentPlan('scene'), name: `${video?.name ?? sc.name} - ${sc.name}` }); return }
    void exportMarker(sc.id, Number(key.split(':')[1]) as Marker)
  }
  // One MP4 per scene, named after it, into a folder picked once. They export one after another:
  // the export events start the next (sceneRun), and an error or a cancel stops the rest.
  // dir: the folder without asking (smoke runs only).
  const exportScenes = async (dir?: string) => {
    const list = scenePlans()
    if (!list.length) return
    const r = dir ? { paths: list.map(x => `${dir}\\${x.file}.mp4`), existing: [] } : await api.chooseExportFolder(list.map(x => x.file))
    if (!r) return
    if (r.existing.length && !confirm(`同じ名前のファイルが ${r.existing.length} 本あります。上書きしますか？\n${r.existing.map(p => p.split(/[\\/]/).pop()).join('\n')}`)) return
    sceneRun.current = { items: list.map((x, i) => ({ name: x.name, plan: x.plan, path: r.paths[i] })), i: 0 }
    const first = sceneRun.current.items[0]
    if (!await startExport(first.path, { plan: first.plan, name: first.name })) sceneRun.current = null
  }
  // One marker group of a scene as its own MP4: its card (when on) and its clips, with the video's
  // overlays and objects. A group switched off can still be exported this way.
  const exportMarker = (sceneId: string, m: Marker, outPath?: string) => {
    const { reels: rs, orderOf: of, overlay: ov, matches: ms, settings: st, video: v } = latest.current
    const sc = rs.find(x => x.id === sceneId)
    if (!sc) return Promise.resolve(null)
    const only = { ...sc, markerOff: {}, scope: 'marked' as const, groupOrder: [m] }
    const plan = planScene(of(only), only, ov, ms, st?.ourTeamCodes ?? [])
    const name = `${v?.name ?? sc.name} - ${sc.markerNames[m] || `マーカー${m}`}`
    return startExport(outPath, { plan, name })
  }
  // The gears: edit a title card over the video window — its title's place and size, and objects on
  // it (text, pictures, shapes). sceneId null = the video's opening card; marker null = the scene's card.
  // slideId: a slide of the scene instead, edited the same way (its objects; no title).
  const [cardEdit, setCardEdit] = useState<{ sceneId: string | null; marker: Marker | null; slideId?: string } | null>(null)
  const [cardTool, setCardTool] = useState<'objects' | 'title'>('objects') // what the pointer edits on the card
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
      annotations: (m === null ? sc.cardAnnotations : sc.markerCardAnnotations?.[m]) ?? [] }
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
    const msg = `図形を ${sel.length} 個コピーしました（Ctrl+V で貼り付け）`
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
    playback.stopSequence(); playback.pause(); setSelectedAnn(null); setCardTool('objects'); setCardEdit({ sceneId, marker, ...(slideId ? { slideId } : {}) })
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
          setProgress({ stage: 'save', message: `${f.name} を読み込んでいます（${n} / ${total} ページ）`, ratio: n / total })
          pages.push(newSlide({ kind: 'image', assetId: await api.saveAsset(png), source: { ...source, page: n } }))
        })
        out.push(...pages.map(s => (s.bg.kind === 'image' && s.bg.source ? { ...s, bg: { ...s.bg, source: { ...s.bg.source, pages: total } } } : s)))
      }
    } finally {
      setProgress(null)
    }
    return out
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
      if (how === 'file') { const msg = `スライドを ${list.length} 枚入れました`; setNotice(msg); setTimeout(() => setNotice(n => (n === msg ? null : n)), 2500) }
      else editCard(sceneId, null, list[0].id)
    } catch (e) {
      setProgress(null)
      setError(`スライドを入れられませんでした: ${(e as Error).message}`)
    }
  }

  // Slides read from a file are checked against it when the project opens and whenever the window
  // comes back to the front (after exporting from PowerPoint again): a bar offers to read them again.
  const [staleSlides, setStaleSlides] = useState<string[]>([])
  const dismissedSlides = useRef(new Map<string, number>()) // "later": not asked again until the file changes again
  const sourcesOf = (rs: Reel[]) => {
    const out = new Map<string, number>() // path -> the oldest time a slide read it
    for (const r of rs) for (const s of r.slides ?? []) {
      if (s.bg.kind === 'image' && s.bg.source) out.set(s.bg.source.path, Math.min(out.get(s.bg.source.path) ?? Infinity, s.bg.source.mtimeMs))
    }
    return out
  }
  const checkSlideFiles = useCallback(async (rs: Reel[] = latest.current.reels) => {
    const srcs = sourcesOf(rs)
    if (!srcs.size) { setStaleSlides([]); return }
    const times = await api.slideFileTimes([...srcs.keys()]).catch(() => ({} as Record<string, number | null>))
    setStaleSlides([...srcs].filter(([path, t]) => {
      const now = times[path]
      return now != null && now > t + 1 && dismissedSlides.current.get(path) !== now
    }).map(([path]) => path))
  }, [])
  useEffect(() => {
    const onFocus = () => void checkSlideFiles()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [checkSlideFiles])
  const laterSlides = async () => {
    const paths = staleSlides
    setStaleSlides([])
    const times = await api.slideFileTimes(paths).catch(() => ({} as Record<string, number | null>))
    for (const path of paths) { const t = times[path]; if (t != null) dismissedSlides.current.set(path, t) }
  }
  // Each slide from the file gets its page again (a picture: the picture); pages the file no longer
  // has keep their old picture, and new pages are only reported.
  const reloadSlideFiles = async (paths: string[]) => {
    const notes: string[] = []
    setStaleSlides(s => s.filter(x => !paths.includes(x)))
    try {
      for (const path of paths) {
        const using = latest.current.reels.flatMap(r => (r.slides ?? []).flatMap(s => (s.bg.kind === 'image' && s.bg.source?.path === path ? [s.bg.source] : [])))
        if (!using.length) continue
        const name = using[0].name
        try {
          const f = await api.readSlideFile(path)
          const assets = new Map<number | null, string>()
          let total: number | undefined
          if (f.kind === 'image') assets.set(null, f.assetId)
          else {
            const want = new Set(using.map(s => s.page ?? 1))
            total = await pdfPages(f.data, async (n, png, all) => {
              setProgress({ stage: 'save', message: `${f.name} を読み直しています（${n} / ${all} ページ）`, ratio: n / all })
              if (want.has(n)) assets.set(n, await api.saveAsset(png))
            }, Math.max(...want))
            // pdfPages stops at the last page used; the page count comes from the file.
          }
          for (const r of latest.current.reels) {
            if (!r.slides?.some(s => s.bg.kind === 'image' && s.bg.source?.path === path)) continue
            updateReel({ ...r, updatedAt: new Date().toISOString(), slides: r.slides.map(s => {
              if (s.bg.kind !== 'image' || s.bg.source?.path !== path) return s
              const id = assets.get(f.kind === 'image' ? null : s.bg.source.page ?? 1)
              if (!id) return s
              return { ...s, bg: { ...s.bg, assetId: id, source: { ...s.bg.source, mtimeMs: f.mtimeMs, ...(total ? { pages: total } : {}) } } }
            }) })
          }
          if (f.kind === 'pdf' && total) {
            const gone = [...new Set(using.map(s => s.page ?? 1))].filter(n => n > total!).sort((a, b) => a - b)
            if (gone.length) notes.push(`${name} は ${total} ページになりました。p.${gone.join(', ')} のスライドは前のままです`)
            const before = Math.max(...using.map(s => s.pages ?? 0))
            if (before && total > before) notes.push(`${name} のページが ${before} → ${total} に増えました。増えたページは「＋」→「PDF・画像を読み込む」で入れられます`)
          }
        } catch (e) {
          notes.push(`${name} を読み直せませんでした: ${(e as Error).message}`)
        }
      }
    } finally {
      setProgress(null)
    }
    setNotice(notes.length ? notes.join(' / ') : 'スライドを読み直しました')
  }
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

  // Puts a picture (or page 1 of a PDF) in the middle of the frame, 30% of its width.
  const insertImage = useCallback(async (path?: string): Promise<string | null> => {
    const { reel: r, activeClipId: id, matches: ms } = latest.current
    const c = r && id ? r.clips[id] : null
    const onCard = !!cardEditRef.current
    if (!c && !onCard) return null
    try {
      const img = await insertAsset(path)
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

  const trim = useCallback((edge: 'in' | 'out', t: number | null) => {
    const { reel: r, activeClipId: id, clipInfo: info, matches: ms } = latest.current
    const c = r && id ? r.clips[id] : null
    const i = c ? info(c) : null
    if (!r || !c || !i?.range || !i.def) return
    updateReel(trimClip(r, c.id, edge, t, i.range, i.def, ms[c.matchId]?.durationSec))
  }, [updateReel])

  const copyObjectsRef = useRef(copyObjects)
  copyObjectsRef.current = copyObjects
  const pasteObjectsRef = useRef(pasteObjects)
  pasteObjectsRef.current = pasteObjects
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if ((t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || settingsOpen || composing(e)) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo('undo') }
        else if (k === 'c' && !e.shiftKey && !window.getSelection()?.toString()) { if (copyObjectsRef.current()) e.preventDefault() }
        else if (k === 'v' && !e.shiftKey) { if (pasteObjectsRef.current()) e.preventDefault() }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRedo('redo') }
        return
      }
      if (e.altKey) return
      if (e.key === '?') { setShortcutsOpen(o => !o); return }
      if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && focusPane.current === 'scene') {
        // Up / Down in the scene editor (last clicked): the clip above / below, opened like a click on it.
        e.preventDefault()
        const r = latest.current.reel
        if (!r) return
        const rows = [...r.groupOrder.flatMap(g => r.groups[g].map(id => ({ id, g: g as Group }))),
          ...chronological(r, r.groups.none, whenIn(r)).map(c => ({ id: c.id, g: 'none' as Group }))]
        const a = latest.current.activeClipId, ag = latest.current.activeGroup
        let i = rows.findIndex(x => x.id === a && (ag === null || x.g === ag))
        if (i < 0) i = rows.findIndex(x => x.id === a)
        const next = rows[e.key === 'ArrowDown' ? i + 1 : i < 0 ? 0 : i - 1]
        if (next) activateClip(r.clips[next.id], next.g)
      }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Up / Down: the previous / next play in the left list (played like a click on it).
        e.preventDefault()
        const res = latest.current.results, s = latest.current.selected
        const i = s ? res.findIndex(x => x.matchId === s.matchId && x.play.id === s.playId) : -1
        const next = res[e.key === 'ArrowDown' ? i + 1 : i < 0 ? 0 : i - 1]
        if (next) jumpRef.current(next)
      }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? playback.stepFrames(-1) : playback.nudge(-0.5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? playback.stepFrames(1) : playback.nudge(0.5) }
      else if (e.key === 'Escape') playback.stopSequence()
      else if ((latest.current.activeClipId || cardEditRef.current) && /^[vtacrfglp]$/i.test(e.key)) {
        const tools: Record<string, Tool> = { v: 'select', t: 'text', a: 'arrow', c: 'circle', r: 'rect', f: 'freehand', g: 'triangle', l: 'polyline', p: 'polygon' }
        setAnnTool(tools[e.key.toLowerCase()])
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && latest.current.selectedAnn) {
        const sel = latest.current.selectedAnn, now = scopedNow()
        // The selected object, the other selected ones and their groups.
        const drop = (list: Annotation[]) => { const ids = withGroups(list, [sel!, ...extraSelRef.current]); return list.filter(a => !ids.includes(a.id)) }
        if (cardEditRef.current) { e.preventDefault(); setCardAnns(drop(cardAnnsRef.current)); setSelectedAnn(null); setExtraSel([]) }
        else if (now) { e.preventDefault(); setAnns(drop(mergeScoped(now))); setSelectedAnn(null); setExtraSel([]) }
      }
      else if (e.key === '[' || e.key === ']') {
        const { reel: r, activeClipId: id } = latest.current
        if (r && id && r.clips[id]?.matchId === playback.attachedKey) { e.preventDefault(); trim(e.key === '[' ? 'in' : 'out', playback.current.time) }
      }
      else if (e.shiftKey && /^(Digit|Numpad)[0-5]$/.test(e.code)) {
        // Shift + 1–5: the active clip's tag (the same number takes it off; Shift + 0 always does).
        // By key position, as Shift + a digit types a symbol on most layouts.
        const { reel: r, activeClipId: id } = latest.current
        if (!r || !id || !r.clips[id]) return
        e.preventDefault()
        const n = e.code.slice(-1)
        updateReel(setTag(r, id, n === '0' || r.clips[id].tag === n ? null : n))
      }
      else if (/^[0-5]$/.test(e.key)) { e.preventDefault(); markerKey(e.key === '0' ? null : (Number(e.key) as Marker)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, markerKey, trim, updateReel])

  // ---- export (design §3.8) ------------------------------------------------------------------
  // The job is built here (PNG layers drawn with the preview's functions) and handed to the main
  // process, which encodes in the background; the app stays usable meanwhile.
  useEffect(() => api.onExportEvent(ev => {
    // Scene by scene: the bar shows the whole run, the text which scene is being written.
    const run = sceneRun.current
    const n = run?.items.length ?? 1, at = run ? `シーン ${run.i + 1} / ${n}「${run.items[run.i].name}」: ` : ''
    if (ev.type !== 'progress' && ev.type !== 'done') sceneRun.current = null
    if (ev.type === 'progress') setExportState(s => ({ ...(s ?? { message: '' }), status: 'running', ratio: ((run?.i ?? 0) + ev.ratio) / n, message: `${at}${ev.item + 1} / ${ev.items} 本目を書き出し中${eta(ev.ratio, ev.elapsedSec)}` }))
    else if (ev.type === 'done' && run && run.i + 1 < n) {
      run.i++
      const next = run.items[run.i]
      void startExportRef.current(next.path, { plan: next.plan, name: next.name }).then(job => { if (!job) sceneRun.current = null })
    }
    else if (ev.type === 'done' && run) { sceneRun.current = null; setExportState({ status: 'done', ratio: 1, outPath: ev.outPath, message: `シーンごとに ${n} 本を書き出しました` }) }
    else if (ev.type === 'done') {
      // YouTube only shows chapters when there are 3 or more and each is 10 seconds or longer.
      const short = ev.shortChapters ?? [], few = (ev.chapterCount ?? 0) < 3
      const why = [few ? `チャプターが ${ev.chapterCount} つだけ` : '', short.length ? `10 秒未満: ${short.join('、')}` : ''].filter(Boolean).join('・')
      const chapters = !ev.chaptersPath ? '' : `。YouTube のチャプターを「${ev.chaptersPath.split(/[\\/]/).pop()}」に書き出しました${
        why ? `（${why}。YouTube では 3 つ以上・各 10 秒以上でないとチャプターになりません）` : ''}`
      setExportState({ status: 'done', ratio: 1, outPath: ev.outPath, message: `書き出しました（${Math.round(ev.footageSec)} 秒分を ${Math.round(ev.elapsedSec)} 秒、${(ev.sizeBytes / 1e6).toFixed(1)} MB）${chapters}` })
    }
    else if (ev.type === 'error') setExportState({ status: 'error', ratio: 0, message: `${at}書き出しに失敗しました: ${ev.message}${run ? '（残りのシーンは書き出していません）' : ''}` })
    else setExportState({ status: 'cancelled', ratio: 0, message: `書き出しをキャンセルしました${run ? `（${run.i} / ${n} 本は書き出し済み）` : ''}` })
  }), [])
  const sceneRun = useRef<{ items: { name: string; plan: PlanItem[]; path: string }[]; i: number } | null>(null)

  // The whole video by default, with its YouTube chapters (a .txt beside the MP4); part of it (a
  // scene, one marker group) when a plan and a file name are given.
  const startExport = useCallback(async (outPathArg?: string, part?: { plan: PlanItem[]; name: string }) => {
    const { video: v, reels: rs, overlay: ov, matches: ms, infoFor: inf, orderOf: of, settings: st } = latest.current
    const whole = !part && v ? planVideoChapters(v, Object.fromEntries(rs.map(s => [s.id, s])), of, ov, ms, st?.ourTeamCodes ?? []) : null
    const plan = part?.plan ?? whole?.plan ?? []
    if (!v || !plan.some(p => p.kind === 'clip' || p.card.slide)) return null
    const outPath = outPathArg ?? await api.chooseExportPath(part?.name ?? v.name)
    if (!outPath) return null
    // Between the scenes of a scene-by-scene run the bar stays where it is.
    setExportState(s => ({ status: 'preparing', ratio: sceneRun.current ? s?.ratio ?? 0 : 0, message: 'オーバーレイを準備しています' }))
    try {
      const byId = Object.fromEntries(rs.map(s => [s.id, s]))
      const job = await buildExportJob(plan, ov,
        { range: (c, sceneId) => inf(c, byId[sceneId] ?? null).range, overlayData: c => latest.current.overlayData!(c), matches: ms,
          sceneAnnotations: id => byId[id]?.annotations ?? [], videoAnnotations: v.annotations ?? [],
          markerAnnotations: (id, g) => (g === 'none' ? [] : byId[id]?.markerAnnotations?.[g] ?? []) }, outPath, whole?.chapters)
      await api.startExport(job)
      return job
    } catch (e) {
      setExportState({ status: 'error', ratio: 0, message: `書き出しに失敗しました: ${(e as Error).message}` })
      return null
    }
  }, [currentPlan])
  const startExportRef = useRef(startExport)
  startExportRef.current = startExport

  // ---- dev self-check (VR_SMOKE): only loaded when the main process runs one (see smoke.ts)
  useEffect(() => {
    if (!SMOKE) return
    const host: SmokeHost = { activateClip, currentPlan, editCard, exportMarker, exportScenes, extraSelRef, insertImage, jump, latest, loadProject, overlapsRef, playThrough, putSlide, scopedNow, setAnnScope, setAnnTool, setAnns, setExtract, setFilter, setLibrary, setOverlay, setOverlayOpen, setPicker, setReelId, setReels, setScan, setScope, setSelectedAnn, setSettingsOpen, setVideoId, setVideos, startExport, updateReel, updateVideo, SAVE_DELAY_MS }
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
    if (r.failed.length) setError(`取り込めなかった試合があります: ${r.failed.map(f => `${f.dvwPath.split(/[\\/]/).pop()}（${f.message}）`).join(' / ')}`)
    else setNotice(`${r.imported.length} 試合を倉庫に取り込みました`)
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
  const saveSettings = async (s: ProjectSettings) => {
    const prev = latest.current.settings
    if (prev) record({ kind: 'settings', value: prev })
    setProject(await api.saveSettings(s))
  }



  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">volley-reel</strong>
        {project && <button onClick={() => void goHome()} title="倉庫とプロジェクトの一覧に戻る">ホーム</button>}
        {project && <strong className="project-name" title={project.path}>{project.name}</strong>}
        {project && <button onClick={() => setPicker('edit')} title="倉庫から試合を足す・外す">試合 {project.matches.length}</button>}
        <span className="spacer" />
        {project && <span className={`save-state ${saveState}`} title="シーンと動画は自動で保存されます">{saveState === 'saved' ? '保存済み' : saveState === 'pending' ? '保存中…' : '保存に失敗'}</span>}
        <button onClick={() => setShortcutsOpen(true)} title="ショートカット一覧 (?)">ショートカット</button>
        {project && <button onClick={() => setSettingsOpen(true)}>設定</button>}
      </header>

      {progress && (
        <div className="banner">
          {progress.message}
          {progress.ratio != null && <progress value={progress.ratio} max={1} />}
        </div>
      )}
      {error && <div className="banner error" onClick={() => setError(null)}>{error}</div>}
      {notice && <div className="banner notice" onClick={() => setNotice(null)}>{notice}</div>}
      {staleSlides.length > 0 && (
        <div className="banner slides-stale" role="status">
          <span>スライドの元のファイルが更新されています: {staleSlides.map(p => p.split(/[\\/]/).pop()).join('、')}</span>
          <button className="primary" onClick={() => void reloadSlideFiles(staleSlides)}>読み直す</button>
          <button className="link" onClick={() => void laterSlides()}>あとで</button>
        </div>
      )}
      {exportState && (
        <div className={`banner export ${exportState.status}`} role="status">
          <span>{exportState.message}</span>
          {(exportState.status === 'running' || exportState.status === 'preparing') && (
            <>
              <progress value={exportState.ratio} max={1} />
              <span className="muted">{Math.round(exportState.ratio * 100)}%</span>
              <button onClick={() => void api.cancelExport()}>キャンセル</button>
            </>
          )}
          {exportState.status === 'done' && exportState.outPath && <button onClick={() => void api.showInFolder(exportState.outPath!)}>フォルダを開く</button>}
          {exportState.status !== 'running' && exportState.status !== 'preparing' && <button className="link" onClick={() => setExportState(null)}>閉じる</button>}
        </div>
      )}

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
        <div className="empty"><h2>試合を選びましょう</h2>
          <p className="muted">倉庫から、このプロジェクトで使う試合を選びます。</p>
          <button className="primary" onClick={() => setPicker('edit')}>試合を選ぶ</button></div>
      ) : (
        <main className="workspace">
          <aside className="sidebar" onPointerDownCapture={() => { focusPane.current = 'list' }}>
            <select className="match-select" value={scope === 'all' ? '' : matchId ?? ''} aria-label="検索する試合"
              onChange={e => { if (e.target.value) { setScope('match'); setMatchId(e.target.value) } else setScope('all') }}>
              <option value="">すべての試合（{project.matches.length}）</option>
              {project.matches.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {scope === 'all' && project.matches.length > 1 && (
              <div className="segmented match-order" role="radiogroup" aria-label="試合の並び">
                {([['old', '古い試合から'], ['new', '新しい試合から']] as const).map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={matchOrder === v} className={matchOrder === v ? 'on' : ''} onClick={() => setMatchOrder(v)}>{l}</button>
                ))}
              </div>
            )}
            {match?.warnings.map(w => <p key={w} className="warning">{w}</p>)}
            <FilterPanel
              filter={filter} onChange={setFilter} people={people} details={details} targetCode={settings?.ourTeamCodes[0] ?? ''} extract={extract} onExtract={setExtract}
              range={reel ? rangeDefaults(reel) : DEFAULT_RANGE} onRange={reel ? d => updateReel({ ...reel, rangeDefaults: d, updatedAt: new Date().toISOString() }) : null}
              shown={results.length} total={scopeRefs.length} teamFilterLimited={teamFilterLimited}
              onAddAll={() => addPlays(results)}
            />
            {Object.keys(dvws).length
              ? <PlayList refs={results} matches={matches} showMatch={scope === 'all' && (project?.matches.length ?? 0) > 1}
                  currentMatchId={matchId} selected={selected} onJump={jump} reelGroups={reelGroups} onMark={markPlay} />
              : <p className="muted pad">読み込み中…</p>}
          </aside>
          <section className="stage">
            {match && (
              <VideoPane key={match.id} match={match} overlay={size => {
                const here = active && activeInfo?.range && active.matchId === match.id ? { key: active.matchId, ...activeInfo.range } : null
                if (cardEditCard) {
                  return (
                    <>
                      <CardEditor size={size} card={cardEditCard} settings={overlay} onChange={setOverlay} active={cardTool === 'title'} />
                      <AnnotationLayer
                        size={size} annotations={cardEditCard.annotations ?? []} clip={{ key: 'card', in: 0, out: 1e9 }} always
                        editable={cardTool === 'objects'} tool={annTool} style={annStyle}
                        selectedId={selectedAnn} extraIds={extraSel} onToggleExtra={toggleExtra} editPoints={editPoints} cropping={cropping} onSelect={selectAnn} onChange={setCardAnns}
                      />
                    </>
                  )
                }
                return (
                  <>
                    <OverlayLayer size={size} settings={overlay} clip={here} scoreboard={activeOverlay?.scoreboard ?? null}
                      caption={activeOverlay?.caption ?? null} override={active?.overlayOverride} />
                    {here && active && (
                      <AnnotationLayer
                        size={size} annotations={activeAnns} scopeOf={activeScopeOf} clip={here}
                        editable={!seqPlaying} tool={annTool} style={annStyle}
                        selectedId={selectedAnn} extraIds={extraSel} onToggleExtra={toggleExtra} editPoints={editPoints} cropping={cropping} onSelect={selectAnn} onChange={setAnns}
                      />
                    )}
                    {seqPlaying && overlay.transition.fade && <FadeLayer range={here} sec={overlay.transition.durationSec} />}
                  </>
                )
              }} />
            )}
            {cardEditCard && editingSlide && (
              <SlideEditBar slide={editingSlide} onDone={() => { setCardEdit(null); setSelectedAnn(null) }}
                onChange={s => cardEdit?.sceneId && updateScene(cardEdit.sceneId, r => setSlide(r, s))}
                onReload={editingSource ? () => void reloadSlideFiles([editingSource.path]) : null} />
            )}
            {cardEditCard && !editingSlide && (
              <CardEditBar card={cardEditCard} settings={overlay} onChange={setOverlay} onDone={() => { setCardEdit(null); setSelectedAnn(null) }}
                tool={cardTool} onTool={setCardTool} shown={cardShown} onShown={setCardShown}
                title={cardTitleNow.title} nameTitle={cardTitleNow.name} onTitle={setCardTitle} />
            )}
            {cardEditCard && cardTool === 'objects' && (
              <AnnotationTools
                tool={annTool} onTool={setAnnTool} style={annStyle} onStyle={setAnnStyle} cardMode
                annotations={cardEditCard.annotations ?? []} scopeOf={() => 'clip'} onScope={() => {}} canVideo={false} selectedId={selectedAnn}
                editPoints={editPoints} onEditPoints={setEditPoints} cropping={cropping} onCropping={setCropping} extraIds={extraSel}
                onSelect={selectAnn} onChange={setCardAnns} onInsertImage={() => void insertImage()} clip={{ in: 0, out: 0 }} disabled={false}
              />
            )}
            {!cardEdit && active && activeInfo?.range && active.matchId === matchId && (
              <HeadlineBar annotations={activeAnns} onChange={setAnns} style={annStyle} disabled={seqPlaying} clipIn={activeInfo.range.in}
                onFormat={id => { setAnnTool('select'); setSelectedAnn(id) }} />
            )}
            {!cardEdit && active && activeInfo?.range && activeInfo.def && activeInfo.ref && active.matchId === matchId && (
              <TrimBar
                label={`${activeInfo.matchLabel}  #${activeInfo.ref.play.jersey} ${activeInfo.ref.name}`}
                keyTime={activeInfo.ref.play.time + (matches[active.matchId]?.offsetSec ?? 0)}
                range={activeInfo.range} def={activeInfo.def} durationSec={matches[active.matchId]?.durationSec ?? 0}
                overrides={{ in: active.inSec !== null, out: active.outSec !== null }}
                overlapLabels={(overlaps.get(active.id) ?? []).map(id => {
                  const oi = reel!.clips[id] ? clipInfo(reel!.clips[id]) : null
                  return oi?.ref ? `#${oi.ref.play.jersey} ${oi.ref.name} ${oi.ref.play.skill}` : id
                })}
                onTrim={trim} loop={loopOn} onLoop={setLoopOn}
                objects={active.annotations.map(a => ({
                  id: a.id, label: a.kind === 'text' ? `T ${a.text}` : KIND_LABEL[a.kind],
                  from: a.showFrom ?? activeInfo.range!.in, to: a.showTo ?? activeInfo.range!.out, set: a.showFrom !== undefined || a.showTo !== undefined,
                }))}
                selectedObjectId={selectedAnn} onSelectObject={id => { setAnnTool('select'); setSelectedAnn(id) }}
                onObjectSpan={(id, edge, t) => {
                  const now = scopedNow()
                  if (!now) return
                  setAnns(mergeScoped(now).map(a => {
                    if (a.id !== id) return a
                    const key = edge === 'from' ? 'showFrom' : 'showTo'
                    const { [key]: _old, ...rest } = a
                    return (t === null ? rest : { ...rest, [key]: t }) as Annotation
                  }))
                }}
              />
            )}
            {!cardEdit && active && activeInfo?.range && active.matchId === matchId && (
              <AnnotationTools
                tool={annTool} onTool={setAnnTool} style={annStyle} onStyle={setAnnStyle}
                annotations={activeAnns} scopeOf={activeScopeOf} onScope={setAnnScope} canVideo={!!video} marker={activeMarker} selectedId={selectedAnn} editPoints={editPoints} onEditPoints={setEditPoints} cropping={cropping} onCropping={setCropping} extraIds={extraSel}
                onSelect={selectAnn} onChange={setAnns} onInsertImage={() => void insertImage()} clip={activeInfo.range} disabled={seqPlaying}
              />
            )}
            {!cardEdit && active && activeInfo?.ref && active.matchId === matchId && (
              <ClipOverlayRow
                override={active.overlayOverride} overlay={overlay} onOverlay={setOverlay}
                autoName={dvws[active.matchId] ? captionData(dvws[active.matchId], activeInfo.ref.play, { ...overlay.playerCaption, showName: true }).name ?? '' : ''}
                autoLine={dvws[active.matchId] ? captionData(dvws[active.matchId], activeInfo.ref.play, { ...overlay.playerCaption, showSkill: true, showEvaluation: true }).line ?? '' : ''}
                onChange={o => { const r = latest.current.reel; if (r) updateReel(setOverlayOverride(r, active.id, o)) }}
              />
            )}
          </section>
          <div className="right-col" onPointerDownCapture={() => { focusPane.current = 'scene' }}>
            <VideoPanel
              videos={videos} video={video} scenes={reels} sceneStats={sceneStats} currentSceneId={reelId}
              onSelectVideo={selectVideo} onNewVideo={createVideo} onDeleteVideo={id => void deleteVideo(id)} onChange={updateVideo}
              onSelectScene={id => { setReelId(id); setActiveClipId(null) }} onNewScene={createReel}
              onEditCard={id => editCard(id, null)} onEditVideoCard={() => editCard(null, null)}
              videoCardOn={!!overlay.titleCard.videoCard} onVideoCard={on => setOverlay({ ...overlay, titleCard: { ...overlay.titleCard, videoCard: on } })}
              sceneCardOn={s => s.sceneCard ?? overlay.titleCard.sceneCards}
              onSceneCard={(s, on) => updateReel({ ...s, sceneCard: on, updatedAt: new Date().toISOString() })}
              onRenameScene={(id, name) => { const r = latest.current.reels.find(x => x.id === id); if (r && r.name !== name) updateReel({ ...r, name, updatedAt: new Date().toISOString() }) }}
              onOpenOverlay={() => setOverlayOpen(true)} playing={seqPlaying} onPlay={() => playThrough('video', 0)} onStop={() => playback.stopSequence()}
            />
            <ReelPanel
              reels={reels} reel={reel} onSelectReel={id => { setReelId(id); setActiveClipId(null) }}
              onNewReel={createReel} onDeleteReel={id => void deleteReel(id)} onChange={updateReel}
              info={clipInfo} missing={missing} activeClipId={activeClipId} playingClipId={playingClipId}
              onActivate={(c, g) => { if (cardEditRef.current?.slideId) { setCardEdit(null); setSelectedAnn(null) } activateClip(c, g) }} playing={seqPlaying} onPlayThrough={() => playThrough('scene', 0)} onStop={() => playback.stopSequence()}
              orderCount={order.length} orderSec={orderSec} overlaps={overlaps} usedIn={reel ? videos.filter(v => v.sceneIds.includes(reel.id)).length : 0}
              videoSceneIds={video?.sceneIds ?? null} onAddToVideo={id => { if (video) updateVideo(addScene(video, id)) }}
              markerCardDefault={overlay.titleCard.enabled} onEditCard={m => reel && editCard(reel.id, m)}
              onSlide={(spot, how) => void putSlide(spot, how)} onEditSlide={id => reel && editCard(reel.id, null, id)}
              editingSlideId={cardEdit?.slideId ?? null} canFrame={!!match}
            />
            <PalettePanel disabled={!cardEditCard && !(active && activeInfo?.range)} selection={paletteSelection} onUse={putPaletteItem}
              clipIn={cardEditCard ? null : activeInfo?.range?.in ?? null} />
            <ExportPanel targets={exportTargets} info={exportInfo} state={exportState} onExport={exportTarget}
              onCancel={() => void api.cancelExport()} onShowFile={p => void api.showInFolder(p)} onOpenOverlay={() => setOverlayOpen(true)} />
          </div>
        </main>
      )}

      {overlayOpen && video && (
        <OverlayDialog settings={overlay} onChange={setOverlay} onClose={() => setOverlayOpen(false)}
          sample={overlaySample(overlayData(active ?? order[0] ?? (reel ? Object.values(reel.clips)[0] : null) ?? null), reel)} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {scan && <ScanDialog result={scan} onImport={p => void importPairs(p)} onClose={() => setScan(null)} />}
      {picker && library && (
        <MatchPicker mode={picker} matches={library.matches} onClose={() => setPicker(null)} onDone={r => void pickerDone(r)}
          initial={picker === 'create'
            ? { name: '', codes: ['HTH'].filter(c => library.matches.some(m => m.teams.some(t => t.code.toUpperCase() === c))), selected: [] }
            : { name: project?.name ?? '', codes: project?.settings.ourTeamCodes ?? [], selected: project?.matchIds ?? [] }} />
      )}
      {settingsOpen && settings && (
        <SettingsDialog settings={settings} theme={overlay.theme} teams={projectTeams} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}

// Dialog preview data: the active (or first) clip's real data, or a placeholder for an empty reel.
function overlaySample(d: { scoreboard: ScoreboardData; caption: CaptionData } | null, r: Reel | null) {
  const m = r?.groupOrder.find(g => r.groups[g].length) ?? 1
  return {
    scoreboard: d?.scoreboard ?? { left: 'HTH', right: 'OPP', ptsL: 17, ptsR: 9, setsL: 1, setsR: 0, winner: 'L' as const },
    caption: d?.caption ?? { number: 1, name: 'PLAYER', line: 'SERVE · ACE' },
    card: { marker: m, name: r?.markerNames[m] ?? '', match: null },
  }
}

// Short label for the match column: "10/11 SMT" (the opponent when one side is ours).
function labelMatches(ms: Match[], codes: string[]): Record<string, string> {
  return Object.fromEntries(ms.map(m => {
    const side = ourSide(m.teams, codes)
    const opp = side === '*' ? m.teams[1].code : side === 'a' ? m.teams[0].code : `${m.teams[0].code}-${m.teams[1].code}`
    const d = m.date ? `${+m.date.slice(5, 7)}/${+m.date.slice(8, 10)}` : ''
    return [m.id, `${d} ${opp}`.trim()]
  }))
}

function eta(ratio: number, elapsedSec: number): string {
  if (ratio < 0.03 || elapsedSec < 2) return ''
  const left = Math.max(0, Math.round(elapsedSec / ratio - elapsedSec))
  return `・残り約 ${left >= 60 ? `${Math.floor(left / 60)}分${left % 60}秒` : `${left}秒`}`
}

