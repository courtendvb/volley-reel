import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FILTER, applyFilter, buildRefs, listPeople, ourSide, type PlayFilter, type PlayRef } from '../../shared/filter'
import {
  addClips, clipRange, defaultRange, findClip, findOverlaps, groupOf, newReel, playOrder, rangeDefaults, relink, setAnnotations, setOverlayOverride, toggleMarker, trimClip,
  type Clip, type Group, type Marker, type Reel,
} from '../../shared/reel'
import type { ImportProgress, Match, ParsedDVW, ProjectInfo, ProjectSettings } from '../../shared/types'
import { FilterPanel, type Scope } from './components/FilterPanel'
import { PlayList, type PlayKey } from './components/PlayList'
import { ReelPanel, type ClipInfo } from './components/ReelPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { TrimBar } from './components/TrimBar'
import { AnnotationLayer, type AnnStyle, type Tool } from './components/AnnotationLayer'
import { AnnotationTools } from './components/AnnotationTools'
import type { Annotation } from '../../shared/annotation'
import { captionData, overlaySettings, scoreboardData, type CaptionData, type OverlaySettings, type ScoreboardData } from '../../shared/overlay'
import { OverlayLayer } from './components/OverlayLayer'
import { OverlayDialog } from './components/OverlayDialog'
import { ClipOverlayRow } from './components/ClipOverlayRow'
import { buildExportJob } from './exportRender'
import { addScene, dropScene, newVideo, planScene, planVideo, type PlanItem, type Video } from '../../shared/video'
import { VideoPanel } from './components/VideoPanel'
import { ShortcutsDialog } from './components/ShortcutsDialog'
import { Home } from './components/Home'
import { ScanDialog } from './components/ScanDialog'
import { MatchPicker } from './components/MatchPicker'
import type { LibraryInfo, RecentProject, ScanResult } from '../../shared/types'
import type { ExportEvent } from '../../shared/types'
import { VideoPane } from './components/VideoPane'
import { playback, type SequenceItem } from './playback'

const api = window.api
const PREROLL_SEC = 2 // jump a little before the contact so the play is seen building up
const NO_ALIASES: ProjectSettings['playerAliases'] = {}
const SAVE_DELAY_MS = 400
const UNDO_MERGE_MS = 600
const UNDO_LIMIT = 100

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [dvws, setDvws] = useState<Record<string, ParsedDVW>>({})
  const [matchId, setMatchId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('match')
  const [filter, setFilter] = useState<PlayFilter>(EMPTY_FILTER)
  const [selected, setSelected] = useState<PlayKey | null>(null)
  const [reels, setReels] = useState<Reel[]>([])
  const [reelId, setReelId] = useState<string | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [videoId, setVideoId] = useState<string | null>(null)
  const [activeClipId, setActiveClipId] = useState<string | null>(null)
  const [playingClipId, setPlayingClipId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [annTool, setAnnTool] = useState<Tool>('select')
  const [annStyle, setAnnStyle] = useState<AnnStyle>({ color: '#FACC15', width: 6, size: 36 })
  const [selectedAnn, setSelectedAnn] = useState<string | null>(null)
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
    const loaded = listed.map(r => relink(r, parsed).reel)
    saved.current = new Map([...loaded.map(r => [`scene:${r.id}`, JSON.stringify(r)] as const), ...vids.map(v => [`video:${v.id}`, JSON.stringify(v)] as const)])
    for (const r of loaded) if (relink(r, parsed).changed) saved.current.delete(`scene:${r.id}`)
    undoStack.current = []; redoStack.current = []
    setReels(loaded)
    setVideos(vids)
    setVideoId(id => (id && vids.some(v => v.id === id) ? id : vids[0]?.id ?? null))
    const notes = await api.takeNotices()
    if (notes.length) setNotice(notes.join(' / '))
    setReelId(id => (id && loaded.some(r => r.id === id) ? id : loaded[0]?.id ?? null))
  }, [])

  // Autosave: any reel whose JSON differs from what was last written is saved shortly after.
  // Closing the window flushes whatever is still pending (see the main process's close handler).
  const saved = useRef(new Map<string, string>())
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved')
  const allClean = () => latest.current.reels.every(x => saved.current.get(`scene:${x.id}`) === JSON.stringify(x))
    && latest.current.videos.every(x => saved.current.get(`video:${x.id}`) === JSON.stringify(x))
  const saveNow = useCallback(async (kind: 'scene' | 'video', obj: Reel | Video) => {
    const key = `${kind}:${obj.id}`, json = JSON.stringify(obj)
    if (saved.current.get(key) === json) return
    try {
      if (kind === 'scene') await api.saveReel(obj as Reel); else await api.saveVideo(obj as Video)
      saved.current.set(key, json)
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
      ...reels.filter(r => saved.current.get(`scene:${r.id}`) !== JSON.stringify(r)).map(r => ['scene', r] as const),
      ...videos.filter(v => saved.current.get(`video:${v.id}`) !== JSON.stringify(v)).map(v => ['video', v] as const),
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
    return (project?.matches ?? []).flatMap(m => refsByMatch[m.id] ?? [])
  }, [scope, matchId, refsByMatch, project])
  const results = useMemo(() => applyFilter(scopeRefs, filter), [scopeRefs, filter])
  const people = useMemo(() => listPeople(scopeRefs), [scopeRefs])
  const teamFilterLimited = useMemo(() => scopeRefs.some(r => r.teamRole === null), [scopeRefs])
  const matchLabels = useMemo(() => labelMatches(project?.matches ?? [], settings?.ourTeamCodes ?? []), [project, settings])

  // ---- reels --------------------------------------------------------------------------------
  // One undo history for scenes and videos, in the order edits happened. Edits to the same thing
  // within UNDO_MERGE_MS (a handle drag, typing a name) become one step.
  type Snapshot = { kind: 'scene'; value: Reel } | { kind: 'video'; value: Video }
  const undoStack = useRef<{ key: string; prev: Snapshot; at: number }[]>([])
  const redoStack = useRef<{ key: string; prev: Snapshot; at: number }[]>([])
  const record = useCallback((prev: Snapshot) => {
    const key = `${prev.kind}:${prev.value.id}`, now = Date.now(), top = undoStack.current[undoStack.current.length - 1]
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
      const cur = e.prev.kind === 'scene' ? latest.current.reels.find(x => x.id === e!.prev.value.id) : latest.current.videos.find(x => x.id === e!.prev.value.id)
      if (!cur) continue // deleted since: skip to the next step
      to.push({ key: e.key, prev: { kind: e.prev.kind, value: cur } as Snapshot, at: 0 })
      if (e.prev.kind === 'scene') { putScene(e.prev.value); setReelId(e.prev.value.id) } else { putVideo(e.prev.value); setVideoId(e.prev.value.id) }
      return
    }
  }, [])
  const missing = useMemo(() => (reel ? relink(reel, dvws).missing : new Set<string>()), [reel, dvws])
  // A clip's range uses its own scene's length defaults, so a video mixing scenes stays right.
  const infoFor = useCallback((c: Clip, scene: Reel | null): ClipInfo => {
    const m = matches[c.matchId], d = dvws[c.matchId], play = d?.plays[c.playId]
    const defaults = scene ? rangeDefaults(scene) : undefined
    return {
      ref: refsByMatch[c.matchId]?.[c.playId],
      range: d && m ? clipRange(c, d, m.offsetSec, defaults) : null,
      def: d && m && play ? defaultRange(d, play, m.offsetSec, defaults) : null,
      matchLabel: matchLabels[c.matchId] ?? '?',
      date: m?.date ?? '',
    }
  }, [matches, dvws, refsByMatch, matchLabels])
  const clipInfo = useCallback((c: Clip): ClipInfo => infoFor(c, reel), [infoFor, reel])
  // A scene's clips in play order (its scope), leaving out clips that can't be played.
  const orderOf = useCallback((s: Reel): Clip[] => {
    const miss = relink(s, dvws).missing
    return playOrder(s, c => { const i = infoFor(c, s); return [i.date, i.range?.in ?? 0] }).filter(c => !miss.has(c.id) && infoFor(c, s).range)
  }, [dvws, infoFor])
  const sceneStats = useCallback((s: Reel) => {
    const o = orderOf(s)
    return { clips: o.length, sec: o.reduce((t, c) => { const r = infoFor(c, s).range!; return t + r.out - r.in }, 0) }
  }, [orderOf, infoFor])
  const order = useMemo(() => {
    if (!reel) return []
    return playOrder(reel, c => { const i = clipInfo(c); return [i.date, i.range?.in ?? 0] })
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

  const reelGroups = useMemo(() => {
    const out = new Map<string, Group>()
    if (reel) for (const c of Object.values(reel.clips)) out.set(`${c.matchId}:${c.playId}`, groupOf(reel, c.id) ?? 'none')
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
    withReel(r => addClips(r, refs.map(x => ({ matchId: x.matchId, play: x.play })), group).reel)
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
    saved.current.delete(`scene:${id}`)
    const rest = reels.filter(r => r.id !== id)
    setReels(rest); setReelId(rest[0]?.id ?? null); setActiveClipId(null)
    for (const v of latest.current.videos) if (v.sceneIds.includes(id)) updateVideo(dropScene(v, id))
  }
  const createVideo = () => {
    const v = newVideo(`動画 ${videos.length + 1}`, reel ? [reel.id] : [])
    setVideos(vs => [...vs, v]); setVideoId(v.id)
  }
  const deleteVideo = async (id: string) => {
    await api.deleteVideo(id)
    saved.current.delete(`video:${id}`)
    const rest = videos.filter(v => v.id !== id)
    setVideos(rest); setVideoId(rest[0]?.id ?? null)
  }

  const overlay = useMemo(() => overlaySettings(video?.overlay), [video?.overlay])
  const latest = useRef({ results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, videos, videoId, video, orderOf, infoFor, overlayData: null as null | ((c: Clip | null) => { scoreboard: ScoreboardData; caption: CaptionData } | null), exportState: null as null | { status: string; ratio: number; message: string; outPath?: string }, notice: null as string | null, dvwsRef: null as null | Record<string, ParsedDVW>, library: null as LibraryInfo | null })
  latest.current = { ...latest.current, results, filter, matches, reels, reelId, reel, videos, videoId, video, orderOf, infoFor, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, exportState, notice, dvwsRef: dvws, library }

  // ---- navigation ---------------------------------------------------------------------------
  // Stable identity so memoized rows don't re-render. A play in another match switches the video
  // first; playback.seekIn holds the seek until that match's video is ready.
  const jump = useCallback((r: PlayRef) => {
    const m = latest.current.matches[r.matchId]
    if (!m) return
    setSelected({ matchId: r.matchId, playId: r.play.id })
    const c = latest.current.reel && findClip(latest.current.reel, r.matchId, r.play.id)
    setActiveClipId(c ? c.id : null)
    setMatchId(r.matchId)
    playback.seekIn(r.matchId, r.play.time + m.offsetSec - PREROLL_SEC, { play: true })
  }, [])

  const activateClip = useCallback((c: Clip) => {
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
    const { reels: rs, infoFor: inf } = latest.current
    const byId = Object.fromEntries(rs.map(s => [s.id, s]))
    const items: SequenceItem[] = [], clipAt: ({ clip: Clip; sceneId: string } | null)[] = []
    let startItem = -1, clipNo = 0
    for (const p of currentPlan(target)) {
      // The cards right before the start clip (a scene card, then a marker card) play first, so
      // the start points at the first of them.
      if (p.kind === 'card') { if (clipNo === startAt && startItem < 0) startItem = items.length; items.push({ card: p.card, durationSec: p.durationSec }); clipAt.push(null); continue }
      if (clipNo === startAt && startItem < 0) startItem = items.length
      items.push({ key: p.clip.matchId, ...inf(p.clip, byId[p.sceneId] ?? null).range! })
      clipAt.push({ clip: p.clip, sceneId: p.sceneId })
      clipNo++
    }
    playback.playSequence(items, i => {
      // On a title card, the clip after it is the one the panels follow.
      const at = i === null ? null : clipAt[i] ?? clipAt[i + 1] ?? null
      setPlayingClipId(at?.clip.id ?? null)
      if (at) { setReelId(at.sceneId); setActiveClipId(at.clip.id); setSelected({ matchId: at.clip.matchId, playId: at.clip.playId }); setMatchId(at.clip.matchId) }
    }, Math.max(0, startItem))
  }, [currentPlan])

  // Number keys tag the active clip — the one playing in a through-play, or the last clicked.
  // With no clip active, the selected play in the list is added with that marker.
  const markerKey = useCallback((m: Marker | null) => {
    const { reel: r, activeClipId: a, selected: s } = latest.current
    if (r && a && r.clips[a]) { updateReel(toggleMarker(r, a, m)); return }
    if (m === null || !s) return
    const ref = refsByMatchRef.current[s.matchId]?.[s.playId]
    if (!ref) return
    let added = ''
    withReel(cur => {
      const { reel: next, ids } = addClips(cur, [{ matchId: s.matchId, play: ref.play }])
      added = ids[0]
      return toggleMarker(next, added, m)
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
    playback.setLoop(active && loopIn !== undefined && loopOut !== undefined && !seqPlaying ? { key: active.matchId, in: loopIn, out: loopOut } : null)
  }, [active, loopIn, loopOut, seqPlaying])

  useEffect(() => setSelectedAnn(null), [activeClipId])

  // ---- annotations (design §3.6) --------------------------------------------------------------
  // Scoreboard and caption for a clip, from its play in the DVW.
  const overlayData = useCallback((c: Clip | null): { scoreboard: ScoreboardData; caption: CaptionData } | null => {
    const d = c ? dvws[c.matchId] : null, play = c && d ? d.plays[c.playId] : null
    if (!c || !d || !play) return null
    return { scoreboard: scoreboardData(d, play, settings?.ourTeamCodes ?? []), caption: captionData(d, play, overlay.playerCaption, c.overlayOverride?.playerCaption) }
  }, [dvws, settings, overlay])
  const activeOverlay = overlayData(active)
  latest.current.overlayData = overlayData
  const setOverlay = useCallback((s: OverlaySettings) => {
    const v = latest.current.video
    if (v) updateVideo({ ...v, overlay: s, updatedAt: new Date().toISOString() })
  }, [updateVideo])

  const setAnns = useCallback((list: Annotation[]) => {
    const { reel: r, activeClipId: id } = latest.current
    if (r && id && r.clips[id]) updateReel(setAnnotations(r, id, list))
  }, [updateReel])

  const trim = useCallback((edge: 'in' | 'out', t: number | null) => {
    const { reel: r, activeClipId: id, clipInfo: info, matches: ms } = latest.current
    const c = r && id ? r.clips[id] : null
    const i = c ? info(c) : null
    if (!r || !c || !i?.range || !i.def) return
    updateReel(trimClip(r, c.id, edge, t, i.range, i.def, ms[c.matchId]?.durationSec))
  }, [updateReel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if ((t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLSelectElement || settingsOpen) return
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRedo('undo') }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); undoRedo('redo') }
        return
      }
      if (e.altKey) return
      if (e.key === '?') { setShortcutsOpen(o => !o); return }
      if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? playback.stepFrames(-1) : playback.nudge(-0.5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? playback.stepFrames(1) : playback.nudge(0.5) }
      else if (e.key === 'Escape') playback.stopSequence()
      else if (latest.current.activeClipId && /^[vtacrflp]$/i.test(e.key)) {
        const tools: Record<string, Tool> = { v: 'select', t: 'text', a: 'arrow', c: 'circle', r: 'rect', f: 'freehand', l: 'polyline', p: 'polygon' }
        setAnnTool(tools[e.key.toLowerCase()])
      }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && latest.current.selectedAnn) {
        const { reel: r, activeClipId: id, selectedAnn: sel } = latest.current
        const c = r && id ? r.clips[id] : null
        if (r && c) { e.preventDefault(); updateReel(setAnnotations(r, c.id, c.annotations.filter(a => a.id !== sel))); setSelectedAnn(null) }
      }
      else if (e.key === '[' || e.key === ']') {
        const { reel: r, activeClipId: id } = latest.current
        if (r && id && r.clips[id]?.matchId === playback.attachedKey) { e.preventDefault(); trim(e.key === '[' ? 'in' : 'out', playback.current.time) }
      }
      else if (/^[0-5]$/.test(e.key)) { e.preventDefault(); markerKey(e.key === '0' ? null : (Number(e.key) as Marker)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, markerKey, trim])

  // ---- export (design §3.8) ------------------------------------------------------------------
  // The job is built here (PNG layers drawn with the preview's functions) and handed to the main
  // process, which encodes in the background; the app stays usable meanwhile.
  useEffect(() => api.onExportEvent(ev => {
    if (ev.type === 'progress') setExportState(s => ({ ...(s ?? { message: '' }), status: 'running', ratio: ev.ratio, message: `${ev.item + 1} / ${ev.items} 本目を書き出し中${eta(ev.ratio, ev.elapsedSec)}` }))
    else if (ev.type === 'done') setExportState({ status: 'done', ratio: 1, outPath: ev.outPath, message: `書き出しました（${Math.round(ev.footageSec)} 秒分を ${Math.round(ev.elapsedSec)} 秒、${(ev.sizeBytes / 1e6).toFixed(1)} MB）` })
    else if (ev.type === 'error') setExportState({ status: 'error', ratio: 0, message: `書き出しに失敗しました: ${ev.message}` })
    else setExportState({ status: 'cancelled', ratio: 0, message: '書き出しをキャンセルしました' })
  }), [])

  const startExport = useCallback(async (outPathArg?: string) => {
    const { video: v, reels: rs, overlay: ov, matches: ms, infoFor: inf } = latest.current
    const plan = currentPlan('video')
    if (!v || !plan.some(p => p.kind === 'clip')) return null
    const outPath = outPathArg ?? await api.chooseExportPath(v.name)
    if (!outPath) return null
    setExportState({ status: 'preparing', ratio: 0, message: 'オーバーレイを準備しています' })
    try {
      const byId = Object.fromEntries(rs.map(s => [s.id, s]))
      const job = await buildExportJob(plan, ov,
        { range: (c, sceneId) => inf(c, byId[sceneId] ?? null).range, overlayData: c => latest.current.overlayData!(c), matches: ms }, outPath)
      await api.startExport(job)
      return job
    } catch (e) {
      setExportState({ status: 'error', ratio: 0, message: `書き出しに失敗しました: ${(e as Error).message}` })
      return null
    }
  }, [currentPlan])

  // ---- dev self-check (VR_SMOKE) ------------------------------------------------------------
  useEffect(() => {
    window.__smoke = async (opts: SmokeOpts) => {
      if (opts.home) return smokeHome(opts)
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
      if (opts.ov) return smokeOverlay(res, opts.ov)
      if (opts.exportTo) return smokeExport(res, opts.exportTo)
      if (opts.m8) return smokeM8(res, opts.m8)
      if (opts.video) return smokeVideo(res, opts)
      if (opts.obj) return smokeObjects(res, opts)
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
        jumped: { match: latest.current.matches[r.matchId].name, code: r.play.code, name: r.name, videoTime: t },
        keys: opts.keys ?? [], groupAfterEachKey: afterKeys, reel: latest.current.reel?.name ?? null,
      }
    }

    // Objects through real pointer, key and form events: a polygon by clicks, a box resized by its
    // corner, an arrow end dragged, a vertex inserted from a midpoint and one deleted, then fill,
    // transparency, dash, arrow heads and a boxed text set from the format panel; optional export.
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

      // Polygon: select by its top edge, drag the top edge's midpoint up (adds a vertex), then
      // double-click the new vertex to delete it again.
      await down(0.3, 0.2)
      await stroke([[0.3, 0.2], [0.3, 0.15], [0.3, 0.1]])
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
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('.ann-text-input'), 5000, 'text input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'BLOCK!')
      input.dispatchEvent(new Event('input', { bubbles: true })); await sleep(50)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(150)
      ctl<HTMLInputElement>('枠付き').click(); await sleep(150)
      log.text = { box: !!find('text')!.box, padding: (find('text')!.box as { padding?: number } | undefined)?.padding }
      await key('v'); setSelectedAnn(null); await sleep(300)

      if (opts.videoExportTo) {
        const job = await startExport(opts.videoExportTo)
        await waitFor(() => ['done', 'error', 'cancelled'].includes(latest.current.exportState?.status ?? '') || null, 120000, 'export')
        log.exportStatus = latest.current.exportState?.status
        return { ...log, videoExport: opts.videoExportTo, exported: { checks: [{ name: 'objects', t: (job?.items[0]?.kind === 'card' ? (job.items[0] as { durationSec: number }).durationSec : 0) + 2.5 }] } }
      }
      return log
    }

    // Videos made of shared scenes: "ハイライト" = attack scene (two marker groups) + serve scene,
    // "サーブ集" = the same serve scene. Checks the plan with scene and marker cards, that the scene
    // editor follows a through-play, that editing the shared scene changes both videos, undo across
    // a video edit and a scene edit, and (with exportTo) the exported file.
    const smokeVideo = async (res: PlayRef[], opts: SmokeOpts) => {
      const ours = res.filter(x => x.teamRole === 'our')
      const kills = ours.filter(x => x.play.skill === 'A' && x.play.effect === '#').slice(0, 3)
      const serves = ours.filter(x => x.play.skill === 'S' && (x.play.effect === '#' || x.play.effect === '+')).slice(0, 2)
      let a = addClips(newReel('アタック'), kills.map(x => ({ matchId: x.matchId, play: x.play }))).reel
      const ai = a.groups.none.slice()
      a = toggleMarker(toggleMarker(toggleMarker(a, ai[0], 1), ai[1], 2), ai[2], 1)
      a = { ...a, markerNames: { ...a.markerNames, 1: 'Kills', 2: 'Second look' }, rangeDefaults: { mode: 'keyplay', rallyLead: 1.5, rallyTail: 2.5, keyBefore: 3, keyAfter: 3 } }
      let s = addClips(newReel('サーブ'), serves.map(x => ({ matchId: x.matchId, play: x.play }))).reel
      for (const id of s.groups.none.slice()) s = toggleMarker(s, id, 1)
      const cardsOn = { titleCard: { enabled: true, sceneCards: true, durationSec: 1 } }
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
          checks: [{ name: 'scene-card', t: 0.5 }, { name: 'marker-card', t: starts[1] + 0.5 }, { name: 'clip', t: starts[2] + 1 },
            { name: 'second-scene-card', t: starts[plan.findIndex((it, i) => i > 0 && it.kind === 'card' && it.card.marker === null)] + 0.5 }] }
      }
      return { planV1, lens, timeline, v1After, v2After, undo, videoExport: opts.videoExportTo ?? null, exported }
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
      await key('f'); await stroke([[0.2, 0.6], [0.25, 0.62], [0.3, 0.6], [0.35, 0.65]])
      await key('t'); await stroke([[0.1, 0.8]])
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('.ann-text-input'), 5000, 'text input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Watch the block')
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
  const importOne = () => guard(async () => { const m = await api.importMatch(); if (m) setLibrary(await api.getLibrary()) })
  const pickerDone = (r: { name: string; codes: string[]; matchIds: string[] }) => guard(async () => {
    setPicker(null)
    if (picker === 'create') {
      const p = await api.createProject({ name: r.name, ourTeamCodes: r.codes, matchIds: r.matchIds })
      if (p) { resetView(); await loadProject(p); setRecent(await api.recentProjects()) }
      return
    }
    await api.saveSettings({ ...latest.current.settings!, ourTeamCodes: r.codes })
    await loadProject(await api.setProjectMatches(r.matchIds))
  })

  const saveSettings = async (s: ProjectSettings) => setProject(await api.saveSettings(s))


  const rawRefs = useMemo(() => settingsOpen && settings
    ? (project?.matches ?? []).flatMap(m => dvws[m.id] ? buildRefs(m.id, dvws[m.id], { ...settings, playerAliases: NO_ALIASES }) : [])
    : [], [settingsOpen, settings, project, dvws])

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

      {!project ? (
        <Home library={library} recent={recent} busy={!!progress} onChooseLibrary={chooseLibrary} onScan={scanFolders}
          onImportOne={importOne} onNewProject={() => setPicker('create')} onOpenProject={p => void openProject(p)} />
      ) : !project.matches.length ? (
        <div className="empty"><h2>試合を選びましょう</h2>
          <p className="muted">倉庫から、このプロジェクトで使う試合を選びます。</p>
          <button className="primary" onClick={() => setPicker('edit')}>試合を選ぶ</button></div>
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <select className="match-select" value={matchId ?? ''} onChange={e => setMatchId(e.target.value)} aria-label="試合">
              {project.matches.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {match?.warnings.map(w => <p key={w} className="warning">{w}</p>)}
            <FilterPanel
              filter={filter} onChange={setFilter} people={people} scope={scope} onScope={setScope}
              shown={results.length} total={scopeRefs.length} teamFilterLimited={teamFilterLimited}
              onAddAll={() => addPlays(results)}
            />
            {Object.keys(dvws).length
              ? <PlayList refs={results} matches={matches} matchLabels={matchLabels} showMatch={scope === 'all'}
                  currentMatchId={matchId} selected={selected} onJump={jump} reelGroups={reelGroups} onAdd={r => addPlays([r])} />
              : <p className="muted pad">読み込み中…</p>}
          </aside>
          <section className="stage">
            {match && (
              <VideoPane key={match.id} match={match} overlay={size => {
                const here = active && activeInfo?.range && active.matchId === match.id ? { key: active.matchId, ...activeInfo.range } : null
                return (
                  <>
                    <OverlayLayer size={size} settings={overlay} clip={here} scoreboard={activeOverlay?.scoreboard ?? null}
                      caption={activeOverlay?.caption ?? null} override={active?.overlayOverride} />
                    {here && active && (
                      <AnnotationLayer
                        size={size} annotations={active.annotations} clip={here}
                        editable={!seqPlaying} tool={annTool} style={annStyle}
                        selectedId={selectedAnn} onSelect={setSelectedAnn} onChange={setAnns}
                      />
                    )}
                  </>
                )
              }} />
            )}
            {active && activeInfo?.range && activeInfo.def && activeInfo.ref && active.matchId === matchId && (
              <TrimBar
                label={`${activeInfo.matchLabel}  #${activeInfo.ref.play.jersey} ${activeInfo.ref.name}`}
                keyTime={activeInfo.ref.play.time + (matches[active.matchId]?.offsetSec ?? 0)}
                range={activeInfo.range} def={activeInfo.def} durationSec={matches[active.matchId]?.durationSec ?? 0}
                overrides={{ in: active.inSec !== null, out: active.outSec !== null }}
                overlapLabels={(overlaps.get(active.id) ?? []).map(id => {
                  const oi = reel!.clips[id] ? clipInfo(reel!.clips[id]) : null
                  return oi?.ref ? `#${oi.ref.play.jersey} ${oi.ref.name} ${oi.ref.play.skill}` : id
                })}
                onTrim={trim}
              />
            )}
            {active && activeInfo?.range && active.matchId === matchId && (
              <AnnotationTools
                tool={annTool} onTool={setAnnTool} style={annStyle} onStyle={setAnnStyle}
                annotations={active.annotations} selectedId={selectedAnn} onSelect={setSelectedAnn} onChange={setAnns}
                clip={activeInfo.range} disabled={seqPlaying}
              />
            )}
            {active && activeInfo?.ref && active.matchId === matchId && (
              <ClipOverlayRow
                override={active.overlayOverride}
                autoName={dvws[active.matchId] ? captionData(dvws[active.matchId], activeInfo.ref.play, { ...overlay.playerCaption, showName: true }).name ?? '' : ''}
                autoLine={dvws[active.matchId] ? captionData(dvws[active.matchId], activeInfo.ref.play, { ...overlay.playerCaption, showSkill: true, showEvaluation: true }).line ?? '' : ''}
                onChange={o => { const r = latest.current.reel; if (r) updateReel(setOverlayOverride(r, active.id, o)) }}
              />
            )}
          </section>
          <div className="right-col">
            <VideoPanel
              videos={videos} video={video} scenes={reels} sceneStats={sceneStats} currentSceneId={reelId}
              onSelectVideo={setVideoId} onNewVideo={createVideo} onDeleteVideo={id => void deleteVideo(id)} onChange={updateVideo}
              onSelectScene={id => { setReelId(id); setActiveClipId(null) }} onNewScene={createReel}
              onOpenOverlay={() => setOverlayOpen(true)} playing={seqPlaying} onPlay={() => playThrough('video', 0)} onStop={() => playback.stopSequence()}
              onExport={() => void startExport()} exporting={exportState?.status === 'running' || exportState?.status === 'preparing'}
            />
            <ReelPanel
              reels={reels} reel={reel} onSelectReel={id => { setReelId(id); setActiveClipId(null) }}
              onNewReel={createReel} onDeleteReel={id => void deleteReel(id)} onChange={updateReel}
              info={clipInfo} missing={missing} activeClipId={activeClipId} playingClipId={playingClipId}
              onActivate={activateClip} playing={seqPlaying} onPlayThrough={() => playThrough('scene', 0)} onStop={() => playback.stopSequence()}
              orderCount={order.length} orderSec={orderSec} overlaps={overlaps} usedIn={reel ? videos.filter(v => v.sceneIds.includes(reel.id)).length : 0}
            />
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
            ? { name: '', codes: ['HTH', 'HTA'], selected: [] }
            : { name: project?.name ?? '', codes: project?.settings.ourTeamCodes ?? [], selected: project?.matchIds ?? [] }} />
      )}
      {settingsOpen && settings && (
        <SettingsDialog settings={settings} rawRefs={rawRefs} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
}

interface SmokeOpts {
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
  videoExportTo?: string
  home?: string
  folders?: string[]
  newProject?: string
  reel?: { markers: (Marker | null)[]; groupOrder?: Marker[]; scope?: 'marked' | 'all'; shotAt?: number }
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
