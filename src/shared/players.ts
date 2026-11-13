// One person per team and jersey across the library's matches. The DataVolley player ID (Player.key)
// can differ between matches when the team files drift, and a jersey missing from one match's roster
// gets a per-match key (`*11`), so the same player would split in two. The library's matches are read
// together: a team code and jersey name one person, under the ID seen in the most matches.
import type { ParsedDVW, Player, Side } from './types'

export type PlayerIndex = Map<string, Player> // `${teamCode}#${jersey}` → that person (side as in the first match seen)

const slot = (team: string, jersey: number) => `${team}#${jersey}`
const teamOf = (d: ParsedDVW, side: Side) => d.teams[side === '*' ? 0 : 1].code
// A key made from the name (no ID in the file) loses to any real ID.
const fromName = (key: string) => key.includes('|')

export function playerIndex(dvws: ParsedDVW[]): PlayerIndex {
  const seen = new Map<string, Map<string, { n: number; p: Player }>>()
  for (const d of dvws) {
    for (const p of Object.values(d.players)) {
      const team = teamOf(d, p.side)
      if (!team) continue
      const keys = seen.get(slot(team, p.jersey)) ?? new Map()
      const k = keys.get(p.key)
      keys.set(p.key, { n: (k?.n ?? 0) + 1, p: k && k.p.lastName ? k.p : p })
      seen.set(slot(team, p.jersey), keys)
    }
  }
  const index: PlayerIndex = new Map()
  for (const [s, keys] of seen) {
    const best = [...keys.entries()].sort(([a, x], [b, y]) =>
      Number(fromName(a)) - Number(fromName(b)) || y.n - x.n || a.localeCompare(b))[0]
    const { sets: _sets, ...p } = best[1].p
    index.set(s, { ...p, key: best[0] })
  }
  return index
}

// The match with every player under the library's key; a jersey that played but is missing from this
// match's roster takes the name from the other matches. A new object: the parsed file is not changed.
export function unifyPlayers(d: ParsedDVW, index: PlayerIndex): ParsedDVW {
  if (!index.size) return d
  const rename = new Map<string, string>()
  const players: Record<string, Player> = {}
  for (const [at, p] of Object.entries(d.players)) {
    const to = index.get(slot(teamOf(d, p.side), p.jersey))
    if (to && to.key !== p.key) rename.set(p.key, to.key)
    players[at] = to ? { ...p, key: to.key } : p
  }
  // Plays by a jersey not in the roster carry `${side}${jersey}`. With every play coded as home the
  // side does not say the team, so those stay as they are.
  if (!d.allHome) {
    for (const pl of d.plays) {
      const at = `${pl.side}${pl.jersey}`
      if (players[at] || pl.playerKey !== at) continue
      const to = index.get(slot(teamOf(d, pl.side), pl.jersey))
      if (!to) continue
      rename.set(at, to.key)
      players[at] = { ...to, side: pl.side }
    }
  }
  if (!rename.size) return { ...d, players }
  const re = (k: string) => rename.get(k) ?? k
  return {
    ...d, players,
    plays: d.plays.map(pl => {
      const playerKey = re(pl.playerKey)
      const front = pl.front?.map(re)
      return playerKey === pl.playerKey && !front?.some((k, i) => k !== pl.front![i]) ? pl : { ...pl, playerKey, ...(front ? { front } : {}) }
    }),
  }
}
