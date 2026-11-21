// The plays of a match as a list to jump from in a comparison: each with the video time it happens at.
import { skillName, effectName } from './labels'
import { DEFAULT_CORNERS, nearSide } from './courtGeometry'
import type { ParsedDVW, Side } from './types'

export const JUMP_LEAD_SEC = 2 // a jump lands this far before the play, so it is seen coming

export interface PlayJumpRow {
  id: number; sec: number; setNum: number; score: string; team: string; who: string; what: string; skill: string; side: Side
  playerKey: string
  rally: { setNum: number; home: number; away: number } // what nearSide needs
}
export type NearFar = 'near' | 'far'
export interface PlayJumpFilter { setNum: number | null; skill: string | null; side: Side | null; playerKey: string | null; position: NearFar | null }
export const NO_FILTER: PlayJumpFilter = { setNum: null, skill: null, side: null, playerKey: null, position: null }

export function playJumpRows(d: ParsedDVW, offsetSec: number): PlayJumpRow[] {
  return d.plays.map(p => {
    const pl = d.players[`${p.side}${p.jersey}`]
    return {
      id: p.id, sec: p.time + offsetSec, setNum: p.setNum, score: `${p.score.home}-${p.score.away}`,
      team: d.teams[p.side === '*' ? 0 : 1].code,
      who: pl ? `#${p.jersey} ${pl.lastName}`.trim() : `#${p.jersey}`,
      what: `${skillName(p.skill)} ${effectName(p.skill, p.effect)}`, skill: p.skill, side: p.side,
      playerKey: p.playerKey, rally: { setNum: p.setNum, home: p.score.home, away: p.score.away },
    }
  })
}

// Whether the player's team is on the camera's near side for this play, given which team was near in set 1.
export function isNear(r: PlayJumpRow, nearSet1: Side): boolean {
  return nearSide({ corners: DEFAULT_CORNERS, nearSet1 }, { setNum: r.rally.setNum, score: { home: r.rally.home, away: r.rally.away } }) === r.side
}

// nearSet1 null: which side is near isn't known, so a position filter can't apply.
export function filterPlayRows(rows: PlayJumpRow[], f: PlayJumpFilter, nearSet1: Side | null = null): PlayJumpRow[] {
  return rows.filter(r =>
    (f.setNum === null || r.setNum === f.setNum) && (f.skill === null || r.skill === f.skill) && (f.side === null || r.side === f.side) &&
    (f.playerKey === null || r.playerKey === f.playerKey) &&
    (f.position === null || nearSet1 === null || isNear(r, nearSet1) === (f.position === 'near')))
}

// The players who have plays here, for choosing one: by team, then jersey. `side` narrows to one team.
export function playerChoices(rows: PlayJumpRow[], side: Side | null): { key: string; label: string }[] {
  const seen = new Map<string, { label: string; team: string; jersey: number }>()
  for (const r of rows) {
    if (side !== null && r.side !== side) continue
    if (!seen.has(r.playerKey)) seen.set(r.playerKey, { label: `${r.team} ${r.who}`, team: r.team, jersey: parseInt(r.who.slice(1), 10) || 0 })
  }
  return [...seen].sort((a, b) => a[1].team.localeCompare(b[1].team) || a[1].jersey - b[1].jersey).map(([key, v]) => ({ key, label: v.label }))
}

// Where a jump to a play lands.
export const jumpTime = (sec: number): number => Math.max(0, sec - JUMP_LEAD_SEC)

// The play the playhead is at: the last one whose jump point (a lead before it) has been passed.
export function currentPlay(rows: PlayJumpRow[], timeSec: number): PlayJumpRow | null {
  let cur: PlayJumpRow | null = null
  for (const r of rows) if (jumpTime(r.sec) <= timeSec + 0.05 && (!cur || r.sec > cur.sec)) cur = r
  return cur
}
