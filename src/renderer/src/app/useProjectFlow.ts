// The library and projects (v3): what the home screen shows, opening and loading a project,
// importing matches, picking a project's matches, and saving its settings.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { EMPTY_FILTER, type PlayFilter } from '../../../shared/filter'
import { relink, type Reel } from '../../../shared/reel'
import { settingsChange } from '../../../shared/settingsUndo'
import type { ImportProgress, LibraryInfo, Match, MissingPart, ParsedDVW, ProjectInfo, ProjectSettings, RecentProject, ScanResult } from '../../../shared/types'
import type { Video } from '../../../shared/video'
import { resetAssets } from '../assets'
import { playback } from '../playback'
import type { AppLatest } from './appState'
import type { Snapshot } from './useUndo'
import { t } from '../../../shared/i18n'

const api = window.api
type Set<T> = Dispatch<SetStateAction<T>>

interface Host {
  latest: RefObject<AppLatest>
  project: ProjectInfo | null
  setProject: (p: ProjectInfo | null) => void
  setDvws: (d: Record<string, ParsedDVW>) => void
  setSceneMatches: (m: Match[]) => void // matches the scenes use that aren't the project's targets
  setMatchId: Set<string | null>
  setMatchIds: Set<string[]>
  setFilter: (f: PlayFilter) => void
  setSelected: (s: null) => void
  setActiveClipId: (id: string | null) => void
  setReels: (r: Reel[]) => void
  setReelId: Set<string | null>
  setVideos: (v: Video[]) => void
  setVideoId: Set<string | null>
  setError: (e: string | null) => void
  setNotice: (n: string) => void
  setProgress: (p: ImportProgress | null) => void
  markSaved: (objs: [string, object][]) => void
  clearHistory: () => void
  flushAll: () => Promise<unknown>
  record: (s: Snapshot, merge?: boolean) => void
  checkSlideFiles: (rs: Reel[]) => Promise<void>
}

export function useProjectFlow(h: Host) {
  const { latest, project, setProject, setDvws, setSceneMatches, setMatchId, setMatchIds, setFilter, setSelected, setActiveClipId, setReels, setReelId, setVideos, setVideoId, setError, setNotice, setProgress, markSaved, clearHistory, flushAll, record } = h
  const [library, setLibrary] = useState<LibraryInfo | null>(null)
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [picker, setPicker] = useState<'create' | 'edit' | null>(null)
  const checkSlideFilesRef = useRef(h.checkSlideFiles)
  checkSlideFilesRef.current = h.checkSlideFiles

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
    if (!p) { setDvws({}); setSceneMatches([]); setReels([]); setReelId(null); setVideos([]); setVideoId(null); return }
    const parsed: Record<string, ParsedDVW> = {}
    for (const m of p.matches) {
      try { parsed[m.id] = await api.parseMatch(m.id) } catch (e) { setError(`${m.name}: ${(e as Error).message}`) }
    }
    if (gen !== loadGen.current) return
    const listed = await api.listReels()
    if (gen !== loadGen.current) return
    // Matches the scenes' clips use but the project no longer searches (taken off its list): loaded
    // too, so those clips keep their plays. Only a match gone from the library stays missing.
    const used = [...new Set(listed.flatMap(r => Object.values(r.clips).map(c => c.matchId)))].filter(id => !parsed[id])
    const lib = used.length ? await api.getLibrary() : null
    const extra = (lib?.matches ?? []).filter(m => used.includes(m.id))
    for (const m of extra) {
      try { parsed[m.id] = await api.parseMatch(m.id) } catch (e) { setError(`${m.name}: ${(e as Error).message}`) }
    }
    if (gen !== loadGen.current) return
    setSceneMatches(extra.filter(m => parsed[m.id]))
    setDvws(parsed)
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
    void checkSlideFilesRef.current(loaded)
    setVideos(vids)
    setVideoId(id => (id && vids.some(v => v.id === id) ? id : vids[0]?.id ?? null))
    const notes = await api.takeNotices()
    if (notes.length) setNotice(notes.join(' / '))
    setReelId(id => (id && loaded.some(r => r.id === id) ? id : loaded[0]?.id ?? null))
  }, [])

  const guard = async (fn: () => Promise<void>) => {
    setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setProgress(null) }
  }
  const resetView = () => { setFilter(EMPTY_FILTER); setSelected(null); setActiveClipId(null); setMatchId(null) }
  const openProject = (path?: string) => guard(async () => {
    const p = await api.openProject(path)
    if (p) { resetView(); await loadProject(p); setRecent(await api.recentProjects()) }
  })
  // A match alone from the home list, with one of its teams as ours (the project is found or made in main).
  const openMatch = (matchId: string, code: string) => guard(async () => {
    const p = await api.openMatchProject(matchId, code)
    resetView(); await loadProject(p); setRecent(await api.recentProjects())
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
    const ours = project?.settings.ourTeamCodes ?? []
    return [...map.values()].sort((a, b) => Number(ours.includes(a.code)) - Number(ours.includes(b.code)) || a.code.localeCompare(b.code))
  }, [project])
  const saveSettings = async (s: ProjectSettings, merge = true) => {
    const prev = latest.current.settings
    const change = prev ? settingsChange(prev, s) : {}
    if (Object.keys(change).length) record({ kind: 'settings', value: change }, merge)
    setProject(await api.saveSettings(s))
  }

  return {
    library, setLibrary, recent, scan, setScan, picker, setPicker, loadProject,
    openProject, openMatch, goHome, chooseLibrary, scanFolders, importPairs, relocate, importOne, pickerDone, projectTeams, saveSettings,
  }
}
