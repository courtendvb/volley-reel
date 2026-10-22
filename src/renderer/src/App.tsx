import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FILTER, applyFilter, buildRefs, listPeople, ourSide, type PlayFilter, type PlayRef } from '../../shared/filter'
import {
  addClips, clipRange, findClip, groupOf, newReel, playOrder, relink, toggleMarker,
  type Clip, type Group, type Marker, type Reel,
} from '../../shared/reel'
import type { ImportProgress, Match, ParsedDVW, ProjectInfo, ProjectSettings } from '../../shared/types'
import { FilterPanel, type Scope } from './components/FilterPanel'
import { PlayList, type PlayKey } from './components/PlayList'
import { ReelPanel, type ClipInfo } from './components/ReelPanel'
import { SettingsDialog } from './components/SettingsDialog'
import { VideoPane } from './components/VideoPane'
import { playback, type SeqItem } from './playback'

const api = window.api
const PREROLL_SEC = 2 // jump a little before the contact so the play is seen building up
const NO_ALIASES: ProjectSettings['playerAliases'] = {}
const SAVE_DELAY_MS = 400

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
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

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
    setReelId(id => (id && loaded.some(r => r.id === id) ? id : loaded[0]?.id ?? null))
  }, [])

  // Autosave: any reel whose JSON differs from what was last written is saved shortly after.
  const saved = useRef(new Map<string, string>())
  useEffect(() => {
    const timers: number[] = []
    for (const r of reels) {
      const json = JSON.stringify(r)
      if (saved.current.get(r.id) === json) continue
      timers.push(window.setTimeout(() => {
        api.saveReel(r).then(() => saved.current.set(r.id, json), e => setError(`リールを保存できませんでした: ${(e as Error).message}`))
      }, SAVE_DELAY_MS))
    }
    return () => timers.forEach(t => clearTimeout(t))
  }, [reels])

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
  const updateReel = useCallback((r: Reel) => setReels(rs => rs.map(x => (x.id === r.id ? r : x))), [])
  const missing = useMemo(() => (reel ? relink(reel, dvws).missing : new Set<string>()), [reel, dvws])
  const clipInfo = useCallback((c: Clip): ClipInfo => {
    const m = matches[c.matchId], d = dvws[c.matchId]
    return {
      ref: refsByMatch[c.matchId]?.[c.playId],
      range: d && m ? clipRange(c, d, m.offsetSec) : null,
      matchLabel: matchLabels[c.matchId] ?? '?',
      date: m?.date ?? '',
    }
  }, [matches, dvws, refsByMatch, matchLabels])
  const order = useMemo(() => {
    if (!reel) return []
    return playOrder(reel, c => { const i = clipInfo(c); return [i.date, i.range?.in ?? 0] })
      .filter(c => !missing.has(c.id) && clipInfo(c).range)
  }, [reel, clipInfo, missing])
  const orderSec = useMemo(() => order.reduce((s, c) => { const r = clipInfo(c).range!; return s + r.out - r.in }, 0), [order, clipInfo])
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
    const all = cur ? rs.map(r => (r.id === cur.id ? next : r)) : [...rs, next]
    latest.current = { ...latest.current, reels: all, reelId: next.id, reel: next }
    setReels(all)
    setReelId(next.id)
    return next
  }, [])

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

  const latest = useRef({ results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo })
  latest.current = { results, filter, matches, reels, reelId, reel, selected, activeClipId, order, clipInfo }

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

  const playThrough = useCallback((startAt = 0) => {
    const { order: o, clipInfo: info } = latest.current
    const items: SeqItem[] = o.map(c => ({ key: c.matchId, ...info(c).range! }))
    playback.playSequence(items, i => {
      const c = i === null ? null : o[i]
      setPlayingClipId(c?.id ?? null)
      if (c) { setActiveClipId(c.id); setSelected({ matchId: c.matchId, playId: c.playId }); setMatchId(c.matchId) }
    }, startAt)
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if ((t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLSelectElement || settingsOpen) return
      if (e.ctrlKey || e.altKey || e.metaKey) return
      if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? playback.stepFrames(-1) : playback.nudge(-0.5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? playback.stepFrames(1) : playback.nudge(0.5) }
      else if (e.key === 'Escape') playback.stopSequence()
      else if (/^[0-5]$/.test(e.key)) { e.preventDefault(); markerKey(e.key === '0' ? null : (Number(e.key) as Marker)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, markerKey])

  const [seqPlaying, setSeqPlaying] = useState(false)
  useEffect(() => playback.subscribe(s => setSeqPlaying(s.seq !== null)), [])

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
  }, [jump, loadProject, playThrough])

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
            {match && <VideoPane key={match.id} match={match} />}
          </section>
          <ReelPanel
            reels={reels} reel={reel} onSelectReel={id => { setReelId(id); setActiveClipId(null) }}
            onNewReel={createReel} onDeleteReel={deleteReel} onChange={updateReel}
            info={clipInfo} missing={missing} activeClipId={activeClipId} playingClipId={playingClipId}
            onActivate={activateClip} playing={seqPlaying} onPlayThrough={() => playThrough(0)} onStop={() => playback.stopSequence()}
            orderCount={order.length} orderSec={orderSec}
          />
        </main>
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
  reel?: { markers: (Marker | null)[]; groupOrder?: Marker[]; scope?: 'marked' | 'all'; shotAt?: number }
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
