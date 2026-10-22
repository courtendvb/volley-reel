import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EMPTY_FILTER, applyFilter, buildRefs, listPeople, ourSide, type PlayFilter, type PlayRef } from '../../shared/filter'
import type { ImportProgress, Match, ParsedDVW, ProjectInfo, ProjectSettings } from '../../shared/types'
import { FilterPanel, type Scope } from './components/FilterPanel'
import { PlayList, type PlayKey } from './components/PlayList'
import { SettingsDialog } from './components/SettingsDialog'
import { VideoPane } from './components/VideoPane'
import { playback } from './playback'

const api = window.api
const PREROLL_SEC = 2 // jump a little before the contact so the play is seen building up
const NO_ALIASES: ProjectSettings['playerAliases'] = {}

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [dvws, setDvws] = useState<Record<string, ParsedDVW>>({})
  const [matchId, setMatchId] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('match')
  const [filter, setFilter] = useState<PlayFilter>(EMPTY_FILTER)
  const [selected, setSelected] = useState<PlayKey | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  const matches = useMemo(() => Object.fromEntries((project?.matches ?? []).map(m => [m.id, m])), [project])
  const match = matchId ? matches[matchId] ?? null : null

  useEffect(() => {
    void api.getProject().then(loadProject)
    return api.onImportProgress(setProgress)
  }, [])

  // Every match's DVW is parsed up front (a few ms each) so "all matches" search is instant.
  const loadProject = useCallback(async (p: ProjectInfo | null) => {
    setProject(p)
    setMatchId(id => (p && id && p.matches.some(m => m.id === id) ? id : p?.matches[0]?.id ?? null))
    if (!p) { setDvws({}); return }
    const parsed: Record<string, ParsedDVW> = {}
    for (const m of p.matches) {
      try { parsed[m.id] = await api.parseMatch(m.id) } catch (e) { setError(`${m.name}: ${(e as Error).message}`) }
    }
    setDvws(parsed)
  }, [])

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

  const latest = useRef({ results, filter, matches })
  latest.current = { results, filter, matches }

  // Stable identity so memoized rows don't re-render. A play in another match switches the video
  // first; playback.seekIn holds the seek until that match's video is ready.
  const jump = useCallback((r: PlayRef) => {
    const m = latest.current.matches[r.matchId]
    if (!m) return
    setSelected({ matchId: r.matchId, playId: r.play.id })
    setMatchId(r.matchId)
    playback.seekIn(r.matchId, r.play.time + m.offsetSec - PREROLL_SEC, { play: true })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if ((t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLSelectElement || settingsOpen) return
      if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? playback.stepFrames(-1) : playback.nudge(-0.5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? playback.stepFrames(1) : playback.nudge(0.5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen])

  // Dev self-check driven by the main process (VR_SMOKE): set scope and filter, jump to result n, report.
  useEffect(() => {
    window.__smoke = async ({ play: n, filter: f, scope: sc, settings: openSettings }: { play: number; filter: Partial<PlayFilter> | null; scope: Scope; settings?: boolean }) => {
      const p = await api.getProject()
      if (!p?.matches.length) throw new Error('no match in project')
      await loadProject(p)
      setScope(sc)
      const want = { ...EMPTY_FILTER, ...(f ?? {}) }
      setFilter(want)
      const res = await waitFor(() => {
        const l = latest.current
        return JSON.stringify(l.filter) === JSON.stringify(want) && l.results.length ? l.results : null
      })
      const r = res[Math.min(n, res.length - 1)]
      jump(r)
      await waitFor(() => playback.attachedKey === r.matchId && playback.current.ready || null)
      const t = await playback.seekAndWait(r.play.time + latest.current.matches[r.matchId].offsetSec)
      if (openSettings) { setSettingsOpen(true); await new Promise(ok => setTimeout(ok, 300)) }
      return {
        matches: p.matches.map(m => m.name), scope: sc, results: res.length,
        perMatch: Object.fromEntries(p.matches.map(m => [m.name, res.filter(x => x.matchId === m.id).length])),
        jumped: { match: latest.current.matches[r.matchId].name, code: r.play.code, name: r.name, videoTime: t },
      }
    }
  }, [jump, loadProject])

  const openProject = async () => {
    setError(null)
    const p = await api.chooseProject()
    if (p) { setFilter(EMPTY_FILTER); setSelected(null); await loadProject(p) }
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
            />
            {Object.keys(dvws).length
              ? <PlayList refs={results} matches={matches} matchLabels={matchLabels} showMatch={scope === 'all'}
                  currentMatchId={matchId} selected={selected} onJump={jump} />
              : <p className="muted pad">読み込み中…</p>}
          </aside>
          <section className="stage">
            {match && <VideoPane key={match.id} match={match} />}
          </section>
        </main>
      )}

      {settingsOpen && settings && (
        <SettingsDialog settings={settings} rawRefs={rawRefs} onSave={saveSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  )
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

function waitFor<T>(get: () => T | null, timeoutMs = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      const v = get()
      if (v) return resolve(v)
      if (Date.now() - start > timeoutMs) return reject(new Error('timeout'))
      setTimeout(tick, 100)
    }
    tick()
  })
}
