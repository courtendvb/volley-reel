import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { displayName } from '../../../shared/dvw'
import { playLabel } from '../../../shared/labels'
import type { Match, ParsedDVW, Play } from '../../../shared/types'
import { formatTime, pad2 } from '../format'
import { playback } from '../playback'

interface Props {
  match: Match
  dvw: ParsedDVW
  selectedId: number | null
  onJump: (play: Play) => void
}

export function PlayList({ match, dvw, selectedId, onJump }: Props) {
  const nowId = useNowPlayId(dvw.plays, match.offsetSec)
  const teamCode = (p: Play) => match.allHome ? '—' : (p.side === '*' ? dvw.teams[0].code : dvw.teams[1].code)

  return (
    <div className="play-list" role="list">
      {dvw.plays.map(p => (
        <PlayRow
          key={p.id} play={p} team={teamCode(p)} name={displayName(dvw.players, p.side, p.jersey)}
          videoTime={p.time + match.offsetSec} selected={p.id === selectedId} now={p.id === nowId} onJump={onJump}
        />
      ))}
    </div>
  )
}

const PlayRow = memo(function PlayRow({ play: p, team, name, videoTime, selected, now, onJump }: {
  play: Play; team: string; name: string; videoTime: number; selected: boolean; now: boolean; onJump: (p: Play) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }) }, [selected])
  return (
    <button ref={ref} role="listitem" className={`play-row${selected ? ' selected' : ''}${now ? ' now' : ''}`} onClick={() => onJump(p)}>
      <span className="set">S{p.setNum}</span>
      <span className="score">{pad2(p.score.home)}-{pad2(p.score.away)}</span>
      <span className="team">{team}</span>
      <span className="player"><b>{p.jersey}</b> {name}</span>
      <span className={`skill skill-${p.skill}`}>{playLabel(p.skill, p.effect)}</span>
      <span className="vtime">{formatTime(videoTime)}</span>
    </button>
  )
})

// The play under the playhead. State changes only when the play changes, so the list doesn't re-render per frame.
function useNowPlayId(plays: Play[], offset: number): number | null {
  const times = useMemo(() => plays.map(p => p.time + offset), [plays, offset])
  const [id, setId] = useState<number | null>(null)
  useEffect(() => playback.subscribe(s => {
    let lo = 0, hi = times.length - 1, found = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= s.time + 0.25) { found = mid; lo = mid + 1 } else hi = mid - 1
    }
    setId(found >= 0 ? plays[found].id : null)
  }), [times, plays])
  return id
}
