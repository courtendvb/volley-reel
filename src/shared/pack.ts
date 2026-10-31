// Add-on packs (.vrpack): pictures for a league kept apart from the app, so the app itself holds no
// league's data. A pack is a zip with manifest.json and photos/; it is read into the library's
// addons/<id>/ and taken out again as a whole. Today a pack holds player photos, picked from a list
// and put on a clip or card as a picture.
import type { Player } from './types'

export interface PackPlayer {
  team: string // team code as scouted (e.g. 'SUN'); teams: other codes the same team is scouted under
  teams?: string[]
  jersey?: number
  lastName: string // as the DVW spells it (romaji); matched ignoring case, spaces and hyphens
  firstName?: string
  label?: string // shown in the picker in place of the DVW name (e.g. 山田 太郎)
  ids?: string[] // DataVolley player IDs this player has been scouted under
  photo: string // a file in the pack's photos/
}

export interface PackManifest {
  format: 'volley-reel-pack'
  version: 1
  id: string // folder name in addons/: [a-z0-9_-]
  name: string
  players: PackPlayer[]
}

export interface PackInfo { id: string; name: string; players: PackPlayer[] }

export const PACK_PHOTO = /^[A-Za-z0-9_.-]{1,80}\.(png|jpg|jpeg)$/i // PNG or JPEG: what the app reads sizes of
const PACK_ID = /^[a-z0-9_-]{1,40}$/

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// The manifest as read from a pack: players without a usable photo name or last name are dropped;
// a wrong format, version or id is an error (null: the reason is given to the user by the caller).
export function readManifest(raw: unknown): PackManifest | null {
  const m = raw as Partial<PackManifest> | null
  if (!m || m.format !== 'volley-reel-pack' || m.version !== 1 || !PACK_ID.test(str(m.id)) || !Array.isArray(m.players)) return null
  const players: PackPlayer[] = []
  for (const p of m.players as Partial<PackPlayer>[]) {
    if (!p || !str(p.team) || !str(p.lastName) || !PACK_PHOTO.test(str(p.photo))) continue
    const jersey = Number(p.jersey)
    players.push({
      team: str(p.team).toUpperCase(),
      ...(Array.isArray(p.teams) ? { teams: p.teams.map(str).filter(Boolean).map(s => s.toUpperCase()) } : {}),
      ...(Number.isInteger(jersey) && jersey >= 0 ? { jersey } : {}),
      lastName: str(p.lastName),
      ...(str(p.firstName) ? { firstName: str(p.firstName) } : {}),
      ...(str(p.label) ? { label: str(p.label) } : {}),
      ...(Array.isArray(p.ids) ? { ids: p.ids.map(str).filter(Boolean) } : {}),
      photo: str(p.photo),
    })
  }
  return { format: 'volley-reel-pack', version: 1, id: str(m.id), name: str(m.name) || str(m.id), players }
}

const norm = (s: string | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// How well a pack player fits a scouted one; 0 = not this person. Player IDs differ between scouts,
// so an ID is enough on its own, and otherwise the team must match and then the name and jersey count.
export function fit(pp: PackPlayer, p: Player, teamCode: string): number {
  if (pp.ids?.some(id => id.replace(/-a$/i, '').toUpperCase() === p.key.toUpperCase())) return 100
  const code = teamCode.toUpperCase()
  if (pp.team !== code && !pp.teams?.includes(code)) return 0
  let s = 0
  if (norm(pp.lastName) && norm(pp.lastName) === norm(p.lastName)) {
    s += 10
    const a = norm(pp.firstName), b = norm(p.firstName)
    if (a && b) s += a === b ? 3 : a[0] === b[0] ? 1 : -10 // another first name: a teammate with the same surname
  }
  if (pp.jersey !== undefined && pp.jersey === p.jersey) s += 5
  return s
}

export interface PackPhoto { pack: string; player: PackPlayer }

// The photo that best fits a scouted player, across every pack; null when none fits or two fit equally.
export function findPhoto(packs: PackInfo[], p: Player, teamCode: string): PackPhoto | null {
  let best: PackPhoto | null = null, top = 0, tie = false
  for (const pk of packs) {
    for (const pp of pk.players) {
      const s = fit(pp, p, teamCode)
      if (s > top) { best = { pack: pk.id, player: pp }; top = s; tie = false } else if (s && s === top) tie = true
    }
  }
  return tie ? null : best
}

// For the picker's search box: the label, the names and the team code.
export function matchesQuery(pp: PackPlayer, q: string): boolean {
  const words = q.toUpperCase().split(/\s+/).filter(Boolean)
  const hay = [pp.label ?? '', pp.lastName, pp.firstName ?? '', pp.team, ...(pp.teams ?? []), pp.jersey ?? ''].join(' ').toUpperCase()
  return words.every(w => hay.includes(w))
}
