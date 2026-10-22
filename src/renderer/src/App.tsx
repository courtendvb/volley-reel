import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImportProgress, Match, ParsedDVW, Play, ProjectInfo } from '../../shared/types'
import { PlayList } from './components/PlayList'
import { VideoPane } from './components/VideoPane'
import { playback } from './playback'

const api = window.api
const PREROLL_SEC = 2 // jump a little before the contact so the play is seen building up

export function App() {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [matchId, setMatchId] = useState<string | null>(null)
  const [dvw, setDvw] = useState<{ id: string; data: ParsedDVW } | null>(null)
  const [selectedPlay, setSelectedPlay] = useState<number | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dvwRef = useRef(dvw)
  dvwRef.current = dvw

  const match = project?.matches.find(m => m.id === matchId) ?? null

  useEffect(() => {
    void api.getProject().then(p => { setProject(p); setMatchId(p?.matches[0]?.id ?? null) })
    return api.onImportProgress(setProgress)
  }, [])

  useEffect(() => {
    if (!matchId) { setDvw(null); return }
    let alive = true
    setSelectedPlay(null)
    api.parseMatch(matchId).then(data => { if (alive) setDvw({ id: matchId, data }) }, e => setError(String(e.message ?? e)))
    return () => { alive = false }
  }, [matchId])

  const currentMatch = useRef<Match | null>(null)
  currentMatch.current = match
  // Stable identity so memoized play rows don't re-render.
  const jump = useCallback((p: Play) => {
    const m = currentMatch.current
    if (!m) return
    setSelectedPlay(p.id)
    playback.seek(p.time + m.offsetSec - PREROLL_SEC, { play: true })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return
      if (e.code === 'Space') { e.preventDefault(); playback.toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? playback.stepFrames(-1) : playback.nudge(-0.5) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? playback.stepFrames(1) : playback.nudge(0.5) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Dev self-check driven by the main process (VR_SMOKE): open the first match, jump to play n, report.
  useEffect(() => {
    window.__smoke = async (n: number) => {
      const p = await api.getProject()
      const m = p?.matches[0]
      if (!p || !m) throw new Error('no match in project')
      setProject(p); setMatchId(m.id)
      const parsed = await waitFor(() => dvwRef.current?.id === m.id ? dvwRef.current.data : null)
      await waitFor(() => playback.current.ready || null)
      const play = parsed.plays[Math.min(n, parsed.plays.length - 1)]
      setSelectedPlay(play.id)
      const t = await playback.seekAndWait(play.time + m.offsetSec)
      return { match: m.name, plays: parsed.plays.length, rallies: parsed.rallies.length, play: play.code, dvwTime: play.time, videoTime: t, warnings: m.warnings }
    }
  }, [])

  const openProject = async () => {
    setError(null)
    const p = await api.chooseProject()
    if (p) { setProject(p); setMatchId(p.matches[0]?.id ?? null) }
  }

  const importMatch = async () => {
    setError(null)
    try {
      const m = await api.importMatch()
      if (m) { const p = await api.getProject(); setProject(p); setMatchId(m.id) }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">volley-reel</strong>
        <button onClick={openProject}>{project ? 'プロジェクトを変更' : 'プロジェクトを開く'}</button>
        {project && <span className="muted path">{project.path}</span>}
        <span className="spacer" />
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
            <select value={matchId ?? ''} onChange={e => setMatchId(e.target.value)} aria-label="試合">
              {project.matches.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            {match?.warnings.map(w => <p key={w} className="warning">{w}</p>)}
            {match && dvw?.id === match.id
              ? <PlayList match={match} dvw={dvw.data} selectedId={selectedPlay} onJump={jump} />
              : <p className="muted pad">読み込み中…</p>}
          </aside>
          <section className="stage">
            {match && <VideoPane key={match.id} match={match} />}
          </section>
        </main>
      )}
    </div>
  )
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
