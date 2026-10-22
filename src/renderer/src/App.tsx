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
import { buildExportJob, planSequence } from './exportRender'
import { ShortcutsDialog } from './components/ShortcutsDialog'
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

  const matches = useMemo(() => Object.fromEntries((project?.matches ?? []).map(m => [m.id, m])), [project])
  const match = matchId ? matches[matchId] ?? null : null
  const reel = reels.find(r => r.id === reelId) ?? null

  useEffect(() => {
    void api.getProject().then(loadProject)
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
    if (!p) { setDvws({}); setReels([]); setReelId(null); return }
    const parsed: Record<string, ParsedDVW> = {}
    for (const m of p.matches) {
      try { parsed[m.id] = await api.parseMatch(m.id) } catch (e) { setError(`${m.name}: ${(e as Error).message}`) }
    }
    if (gen !== loadGen.current) return
    setDvws(parsed)
    const listed = await api.listReels()
    if (gen !== loadGen.current) return
    const loaded = listed.map(r => relink(r, parsed).reel)
    saved.current = new Map(loaded.map(r => [r.id, JSON.stringify(r)]))
    for (const r of loaded) if (relink(r, parsed).changed) saved.current.delete(r.id)
    setReels(loaded)
    const notes = await api.takeNotices()
    if (notes.length) setNotice(notes.join(' / '))
    setReelId(id => (id && loaded.some(r => r.id === id) ? id : loaded[0]?.id ?? null))
  }, [])

  // Autosave: any reel whose JSON differs from what was last written is saved shortly after.
  // Closing the window flushes whatever is still pending (see the main process's close handler).
  const saved = useRef(new Map<string, string>())
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved')
  const saveNow = useCallback(async (r: Reel) => {
    const json = JSON.stringify(r)
    if (saved.current.get(r.id) === json) return
    try {
      await api.saveReel(r)
      saved.current.set(r.id, json)
      if (latest.current.reels.every(x => saved.current.get(x.id) === JSON.stringify(x))) setSaveState('saved')
    } catch (e) {
      setSaveState('error')
      setError(`リールを保存できませんでした: ${(e as Error).message}`)
    }
  }, [])
  useEffect(() => {
    const dirty = reels.filter(r => saved.current.get(r.id) !== JSON.stringify(r))
    if (!dirty.length) return
    setSaveState(s => (s === 'error' ? s : 'pending'))
    const timers = dirty.map(r => window.setTimeout(() => void saveNow(r), SAVE_DELAY_MS))
    return () => timers.forEach(t => clearTimeout(t))
  }, [reels, saveNow])
  useEffect(() => api.onFlushRequest(async () => { await Promise.all(latest.current.reels.map(saveNow)) }), [saveNow])

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
  // Undo history per reel. Edits within UNDO_MERGE_MS of each other (a handle drag, typing a
  // name) become one step, so undo goes back to before the gesture, not one pixel.
  const history = useRef(new Map<string, { past: Reel[]; future: Reel[]; lastAt: number }>())
  const record = useCallback((prev: Reel) => {
    const h = history.current.get(prev.id) ?? { past: [], future: [], lastAt: 0 }
    const now = Date.now()
    if (now - h.lastAt > UNDO_MERGE_MS) { h.past.push(prev); if (h.past.length > UNDO_LIMIT) h.past.shift() }
    h.lastAt = now
    h.future = []
    history.current.set(prev.id, h)
  }, [])
  const updateReel = useCallback((r: Reel) => {
    const prev = latest.current.reels.find(x => x.id === r.id)
    if (prev && prev !== r) record(prev)
    latest.current = { ...latest.current, reels: latest.current.reels.map(x => (x.id === r.id ? r : x)), reel: latest.current.reel?.id === r.id ? r : latest.current.reel }
    setReels(rs => rs.map(x => (x.id === r.id ? r : x)))
  }, [record])
  const undoRedo = useCallback((dir: 'undo' | 'redo') => {
    const cur = latest.current.reel
    const h = cur && history.current.get(cur.id)
    if (!cur || !h) return
    const [from, to] = dir === 'undo' ? [h.past, h.future] : [h.future, h.past]
    const next = from.pop()
    if (!next) return
    to.push(cur)
    h.lastAt = 0
    latest.current = { ...latest.current, reels: latest.current.reels.map(x => (x.id === cur.id ? next : x)), reel: next }
    setReels(rs => rs.map(x => (x.id === cur.id ? next : x)))
  }, [])
  const missing = useMemo(() => (reel ? relink(reel, dvws).missing : new Set<string>()), [reel, dvws])
  const defaults = useMemo(() => (reel ? rangeDefaults(reel) : undefined), [reel])
  const clipInfo = useCallback((c: Clip): ClipInfo => {
    const m = matches[c.matchId], d = dvws[c.matchId], play = d?.plays[c.playId]
    return {
      ref: refsByMatch[c.matchId]?.[c.playId],
      range: d && m ? clipRange(c, d, m.offsetSec, defaults) : null,
      def: d && m && play ? defaultRange(d, play, m.offsetSec, defaults) : null,
      matchLabel: matchLabels[c.matchId] ?? '?',
      date: m?.date ?? '',
    }
  }, [matches, dvws, refsByMatch, matchLabels, defaults])
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
    const next = fn(cur ?? newReel(`リール ${rs.length + 1}`))
    if (cur) record(cur)
    const all = cur ? rs.map(r => (r.id === cur.id ? next : r)) : [...rs, next]
    latest.current = { ...latest.current, reels: all, reelId: next.id, reel: next }
    setReels(all)
    setReelId(next.id)
    return next
  }, [record])

  const addPlays = useCallback((refs: PlayRef[], group: Group = 'none') => {
    withReel(r => addClips(r, refs.map(x => ({ matchId: x.matchId, play: x.play })), group).reel)
  }, [withReel])

  const createReel = () => {
    const r = newReel(`リール ${reels.length + 1}`)
    setReels(rs => [...rs, r]); setReelId(r.id); setActiveClipId(null)
  }
  const deleteReel = async (id: string) => {
    await api.deleteReel(id)
    saved.current.delete(id)
    const rest = reels.filter(r => r.id !== id)
    setReels(rest); setReelId(rest[0]?.id ?? null); setActiveClipId(null)
  }

  const overlay = useMemo(() => overlaySettings(reel?.overlay), [reel?.overlay])
  const latest = useRef({ results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, overlayData: null as null | ((c: Clip | null) => { scoreboard: ScoreboardData; caption: CaptionData } | null), exportState: null as null | { status: string; ratio: number; message: string; outPath?: string }, notice: null as string | null, dvwsRef: null as null | Record<string, ParsedDVW> })
  latest.current = { ...latest.current, results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo, selectedAnn, overlay, settings, exportState, notice, dvwsRef: dvws }

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

  // Through-play items: the same plan the export uses (clips, with title cards when enabled).
  // startAt and the reported index count clips, not cards.
  const playThrough = useCallback((startAt = 0) => {
    const { order: o, clipInfo: info, reel: r, overlay: ov, matches: ms, settings: st } = latest.current
    if (!r) return
    const items: SequenceItem[] = [], clipAt: (Clip | null)[] = []
    let startItem = 0, clipNo = 0
    for (const p of planSequence(o, r, ov, ms, st?.ourTeamCodes ?? [])) {
      // A card right before the start clip plays first, so the start points at the card.
      if (p.kind === 'card') { if (clipNo === startAt) startItem = items.length; items.push({ card: p.card, durationSec: p.durationSec }); clipAt.push(null); continue }
      if (clipNo === startAt && clipAt[items.length - 1] !== null) startItem = items.length
      items.push({ key: p.clip.matchId, ...info(p.clip).range! })
      clipAt.push(p.clip)
      clipNo++
    }
    playback.playSequence(items, i => {
      // On a title card, the clip after it is the one the panels follow.
      const c = i === null ? null : clipAt[i] ?? clipAt[i + 1] ?? null
      setPlayingClipId(c?.id ?? null)
      if (c) { setActiveClipId(c.id); setSelected({ matchId: c.matchId, playId: c.playId }); setMatchId(c.matchId) }
    }, startItem)
  }, [])

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
    const r = latest.current.reel
    if (r) updateReel({ ...r, overlay: s, updatedAt: new Date().toISOString() })
  }, [updateReel])

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
      else if (latest.current.activeClipId && /^[vtacrf]$/i.test(e.key)) {
        const tools: Record<string, Tool> = { v: 'select', t: 'text', a: 'arrow', c: 'circle', r: 'rect', f: 'freehand' }
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
    const { reel: r, order: o, overlay: ov, matches: ms, settings: st, clipInfo: info } = latest.current
    if (!r || !o.length) return null
    const outPath = outPathArg ?? await api.chooseExportPath(r.name)
    if (!outPath) return null
    setExportState({ status: 'preparing', ratio: 0, message: 'オーバーレイを準備しています' })
    try {
      const job = await buildExportJob(planSequence(o, r, ov, ms, st?.ourTeamCodes ?? []), ov,
        { range: c => info(c).range, overlayData: c => latest.current.overlayData!(c), matches: ms }, outPath)
      await api.startExport(job)
      return job
    } catch (e) {
      setExportState({ status: 'error', ratio: 0, message: `書き出しに失敗しました: ${(e as Error).message}` })
      return null
    }
  }, [])

  // ---- dev self-check (VR_SMOKE) ------------------------------------------------------------
  useEffect(() => {
    window.__smoke = async (opts: SmokeOpts) => {
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
      setReels(rs => [...rs, r]); setReelId(r.id)
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
      setReels(rs => [...rs, r]); setReelId(r.id)
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
      playThrough(0)
      await waitFor(() => (playback.current.seq === null && timeline.length ? true : null), 120000, 'through-play')
      unsub()
      // Screenshot on the first title card.
      playThrough(0); await sleep(600)
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
      setReels(rs => [...rs, r]); setReelId(r.id)
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
      playThrough(0)
      await waitFor(() => (playback.current.seq === null && timeline.length ? true : null), 180000, () => `through-play end (at ${JSON.stringify(timeline.at(-1))}, t=${playback.current.time}, key=${playback.attachedKey}, ${playback.debugVideo})`)
      unsub()
      const totalMs = Math.round(performance.now() - t0)
      playThrough(Math.min(spec.shotAt ?? 1, o.length - 1))
      await sleep(1500)
      return { plan, timeline, totalMs, expectedMs: Math.round(plan.reduce((s, x) => s + (x.out - x.in) * 1000, 0)) }
    }
  }, [jump, loadProject, playThrough, activateClip, updateReel, overlayData, setOverlay, startExport])

  // ---- project ------------------------------------------------------------------------------
  const openProject = async () => {
    setError(null)
    const p = await api.chooseProject()
    if (p) { setFilter(EMPTY_FILTER); setSelected(null); setActiveClipId(null); await loadProject(p) }
  }

  const importMatch = async () => {
    setError(null)
    try {
      const m = await api.importMatch()
      if (m) { await loadProject(await api.getProject()); setMatchId(m.id) }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const saveSettings = async (s: ProjectSettings) => setProject(await api.saveSettings(s))


  const rawRefs = useMemo(() => settingsOpen && settings
    ? (project?.matches ?? []).flatMap(m => dvws[m.id] ? buildRefs(m.id, dvws[m.id], { ...settings, playerAliases: NO_ALIASES }) : [])
    : [], [settingsOpen, settings, project, dvws])

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">volley-reel</strong>
        <button onClick={openProject}>{project ? 'プロジェクトを変更' : 'プロジェクトを開く'}</button>
        {project && <span className="muted path">{project.path}</span>}
        <span className="spacer" />
        {project && <span className={`save-state ${saveState}`} title="リールは自動で保存されます">{saveState === 'saved' ? '保存済み' : saveState === 'pending' ? '保存中…' : '保存に失敗'}</span>}
        <button onClick={() => setShortcutsOpen(true)} title="ショートカット一覧 (?)">ショートカット</button>
        {project && <button onClick={() => setSettingsOpen(true)}>設定</button>}
        {project && <button className="primary" onClick={importMatch} disabled={!!progress}>試合を取り込む</button>}
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
        <Empty title="プロジェクトフォルダを開いてください" body="試合・リールの JSON はこのフォルダに保存されます。動画はコピーせず、元の場所を参照します。" />
      ) : !project.matches.length ? (
        <Empty title="最初の試合を取り込みましょう" body="動画ファイルと .dvw を選ぶと、コーデックを確認して試合として登録します。" />
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
          <ReelPanel
            reels={reels} reel={reel} onSelectReel={id => { setReelId(id); setActiveClipId(null) }}
            onNewReel={createReel} onDeleteReel={deleteReel} onChange={updateReel}
            info={clipInfo} missing={missing} activeClipId={activeClipId} playingClipId={playingClipId}
            onActivate={activateClip} playing={seqPlaying} onPlayThrough={() => playThrough(0)} onStop={() => playback.stopSequence()}
            orderCount={order.length} orderSec={orderSec} overlaps={overlaps} onOpenOverlay={() => setOverlayOpen(true)}
            onExport={() => void startExport()} exporting={exportState?.status === 'running' || exportState?.status === 'preparing'}
          />
        </main>
      )}

      {overlayOpen && reel && (
        <OverlayDialog settings={overlay} onChange={setOverlay} onClose={() => setOverlayOpen(false)}
          sample={overlaySample(overlayData(active ?? order[0] ?? Object.values(reel.clips)[0] ?? null), reel)} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
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
  reel?: { markers: (Marker | null)[]; groupOrder?: Marker[]; scope?: 'marked' | 'all'; shotAt?: number }
}

// Dialog preview data: the active (or first) clip's real data, or a placeholder for an empty reel.
function overlaySample(d: { scoreboard: ScoreboardData; caption: CaptionData } | null, r: Reel) {
  const m = r.groupOrder.find(g => r.groups[g].length) ?? 1
  return {
    scoreboard: d?.scoreboard ?? { left: 'HTH', right: 'OPP', ptsL: 17, ptsR: 9, setsL: 1, setsR: 0, winner: 'L' as const },
    caption: d?.caption ?? { number: 1, name: 'PLAYER', line: 'SERVE · ACE' },
    card: { marker: m, name: r.markerNames[m], match: null },
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

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty"><h2>{title}</h2><p className="muted">{body}</p></div>
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
