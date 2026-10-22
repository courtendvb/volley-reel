import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PlayRef } from '../../../shared/filter'
import { playLabel } from '../../../shared/labels'
import { MARKER_COLORS, type Group, type Marker } from '../../../shared/reel'
import type { Match } from '../../../shared/types'
import { formatTime, pad2 } from '../format'
import { playback } from '../playback'

const ROW = 30 // px; fixed so the list can be windowed

export interface PlayKey { matchId: string; playId: number }

interface Props {
  refs: PlayRef[]
  matches: Record<string, Match>
  matchLabels: Record<string, string>
  showMatch: boolean
  currentMatchId: string | null
  selected: PlayKey | null
  onJump: (r: PlayRef) => void
  reelGroups: Map<string, Group> // `${matchId}:${playId}` -> group, for plays already in the reel
  onMark: (r: PlayRef, m: Marker) => void
}

// Only the rows in view are rendered: "all matches" can be tens of thousands of plays.
export function PlayList({ refs, matches, matchLabels, showMatch, currentMatchId, selected, onJump, reelGroups, onMark }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  const nowId = useNowPlayId(refs, currentMatchId, currentMatchId ? matches[currentMatchId]?.offsetSec ?? 0 : 0)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the selected play visible (also when it was chosen by the smoke check or from elsewhere).
  const selIndex = useMemo(
    () => selected ? refs.findIndex(r => r.matchId === selected.matchId && r.play.id === selected.playId) : -1,
    [refs, selected],
  )
  useEffect(() => {
    const el = box.current
    if (!el || selIndex < 0) return
    const top = selIndex * ROW
    if (top < el.scrollTop || top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top - el.clientHeight / 2
  }, [selIndex])

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 10)
  const last = Math.min(refs.length, Math.ceil((scrollTop + height) / ROW) + 10)
  const rows = []
  for (let i = first; i < last; i++) {
    const r = refs[i]
    rows.push(
      <PlayRow
        key={`${r.matchId}:${r.play.id}`} r={r} top={i * ROW} showMatch={showMatch} matchLabel={matchLabels[r.matchId]}
        videoTime={r.play.time + (matches[r.matchId]?.offsetSec ?? 0)}
        selected={i === selIndex} now={r.matchId === currentMatchId && r.play.id === nowId} onJump={onJump}
        group={reelGroups.get(`${r.matchId}:${r.play.id}`) ?? null} onMark={onMark}
      />,
    )
  }

  return (
    <div className={`play-list${showMatch ? ' with-match' : ''}`} ref={box} role="list" onScroll={e => setScrollTop(e.currentTarget.scrollTop)}>
      {refs.length === 0
        ? <p className="muted pad">条件に合うプレーがありません</p>
        : <div style={{ height: refs.length * ROW, position: 'relative' }}>{rows}</div>}
    </div>
  )
}

const MARKERS: Marker[] = [1, 2, 3, 4, 5]

const PlayRow = memo(function PlayRow({ r, top, showMatch, matchLabel, videoTime, selected, now, onJump, group, onMark }: {
  r: PlayRef; top: number; showMatch: boolean; matchLabel: string; videoTime: number; selected: boolean; now: boolean
  onJump: (r: PlayRef) => void; group: Group | null; onMark: (r: PlayRef, m: Marker) => void
}) {
  const p = r.play
  return (
    <div role="listitem" style={{ top, height: ROW }}
      className={`play-row${selected ? ' selected' : ''}${now ? ' now' : ''}${group === 'none' ? ' in-scene' : ''}`} onClick={() => onJump(r)}
      title={`映像 ${formatTime(videoTime)}${group === 'none' ? '・シーンに入っています（マーカーなし）' : ''}`}>
      {showMatch && <span className="match">{matchLabel}</span>}
      <span className="set">S{p.setNum}</span>
      <span className="score">{pad2(p.score.home)}-{pad2(p.score.away)}</span>
      <span className={`team${r.teamRole === 'our' ? ' ours' : ''}`}>{r.teamCode}</span>
      <span className="player"><b>{p.jersey}</b> {r.name}</span>
      <span className={`skill skill-${p.skill}`}>{playLabel(p.skill, p.effect)}</span>
      <span className="marks">
        {MARKERS.map(m => (
          <button key={m} className={`mark${group === m ? ' on' : ''}`} style={group === m ? { background: MARKER_COLORS[m], borderColor: MARKER_COLORS[m] } : undefined}
            title={group === m ? `マーカー ${m} を外す` : `今のシーンにマーカー ${m} で入れる`}
            onClick={e => { e.stopPropagation(); onMark(r, m) }}>{m}</button>
        ))}
      </span>
    </div>
  )
})

// The play under the playhead in the match on screen. State changes only when that play changes.
function useNowPlayId(refs: PlayRef[], matchId: string | null, offset: number): number | null {
  const list = useMemo(() => refs.filter(r => r.matchId === matchId).map(r => ({ id: r.play.id, t: r.play.time + offset })), [refs, matchId, offset])
  const [id, setId] = useState<number | null>(null)
  useEffect(() => playback.subscribe(s => {
    let lo = 0, hi = list.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid].t <= s.time + 0.25) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    setId(found >= 0 ? list[found].id : null)
  }), [list])
  return id
}
