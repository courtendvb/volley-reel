// Who and which teams a title card is about, to put a player's photo or a team's logo on it: the
// players of the card's clips, the most clips first, then the rest of those matches' players; the
// teams of those matches, the most clips first. Pure, so it is unit-tested.
import type { Annotation } from './annotation'
import type { ParsedDVW, Player } from './types'
import type { Card, PlanItem } from './video'

export interface CardPlayer { player: Player; team: string; teamName: string; clips: number }
export interface CardTeam { code: string; name: string; clips: number }

type ClipRef = { matchId: string; playId: number }

export function cardPlayers(clips: ClipRef[], dvws: Record<string, ParsedDVW>): CardPlayer[] {
  const out = new Map<string, CardPlayer>()
  const keyOf = (team: string, p: Player) => `${team}|${p.key || p.jersey}`
  for (const c of clips) {
    const d = dvws[c.matchId], play = d?.plays[c.playId]
    const player = play ? d.players[`${play.side}${play.jersey}`] : undefined
    if (!d || !play || !player) continue
    const tm = d.teams[play.side === '*' ? 0 : 1], k = keyOf(tm.code.toUpperCase(), player)
    const had = out.get(k) ?? { player, team: tm.code.toUpperCase(), teamName: tm.name, clips: 0 }
    had.clips++
    out.set(k, had)
  }
  const rest: CardPlayer[] = []
  for (const id of new Set(clips.map(c => c.matchId))) {
    const d = dvws[id]
    if (!d) continue
    for (const p of Object.values(d.players)) {
      const tm = d.teams[p.side === '*' ? 0 : 1], k = keyOf(tm.code.toUpperCase(), p)
      if (out.has(k) || rest.some(r => keyOf(r.team, r.player) === k)) continue
      rest.push({ player: p, team: tm.code.toUpperCase(), teamName: tm.name, clips: 0 })
    }
  }
  const played = [...out.values()].sort((a, b) => b.clips - a.clips || a.team.localeCompare(b.team) || a.player.jersey - b.player.jersey)
  return [...played, ...rest.sort((a, b) => a.team.localeCompare(b.team) || a.player.jersey - b.player.jersey)]
}

export function cardTeams(clips: ClipRef[], dvws: Record<string, ParsedDVW>): CardTeam[] {
  const out = new Map<string, CardTeam>()
  for (const c of clips) {
    const d = dvws[c.matchId]
    if (!d) continue
    const play = d.plays[c.playId]
    d.teams.forEach((tm, i) => {
      const code = tm.code.toUpperCase(), had = out.get(code) ?? { code, name: tm.name, clips: 0 }
      if (play && (play.side === '*' ? 0 : 1) === i) had.clips++
      out.set(code, had)
    })
  }
  return [...out.values()].sort((a, b) => b.clips - a.clips || a.code.localeCompare(b.code))
}

// A card's photo frames filled: each takes `photo` (an image id), or goes when there is none, so an
// empty frame never shows in the video. Other objects stay as they are.
export function fillFrames(list: Annotation[] | undefined, photo: string | null): Annotation[] | undefined {
  if (!list?.some(a => a.kind === 'image' && a.frame)) return list
  return list.flatMap(a => (a.kind === 'image' && a.frame ? (photo ? [{ ...a, assetId: photo }] : []) : [a]))
}

// The cards of a plan with their frames filled; photoFor finds a card's photo (only asked for cards with a frame).
export function fillPlanFrames(plan: PlanItem[], photoFor: (card: Card) => string | null): PlanItem[] {
  return plan.map(it => {
    if (it.kind !== 'card' || it.card.slide || !it.card.annotations?.some(a => a.kind === 'image' && a.frame)) return it
    return { ...it, card: { ...it.card, annotations: fillFrames(it.card.annotations, photoFor(it.card)) } }
  })
}

// The player a card is about: the one with the most of its clips who has a photo (photoOf: their
// photo's image id, or null). Null when no one has.
export function topPhoto(clips: ClipRef[], dvws: Record<string, ParsedDVW>, photoOf: (p: CardPlayer) => string | null): string | null {
  for (const p of cardPlayers(clips, dvws)) {
    if (!p.clips) break
    const id = photoOf(p)
    if (id) return id
  }
  return null
}
