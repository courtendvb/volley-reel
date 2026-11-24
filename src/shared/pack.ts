// Add-on packs (.vrpack): pictures for a league kept apart from the app, so the app itself holds no
// league's data. A pack is a zip with manifest.json and photos/; it is read into the library's
// addons/<id>/ and taken out again as a whole. Today a pack holds player photos, picked from a list
// and put on a clip or card as a picture.
import type { ParsedDVW, Play, Player } from './types'

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

// bundled: shipped with the app (resources/packs), read-only; a pack of the same id in the library wins.
export interface PackInfo { id: string; name: string; players: PackPlayer[]; bundled?: true }

export const PACK_PHOTO = /^[A-Za-z0-9_.-]{1,80}\.(png|jpg|jpeg)$/i // PNG or JPEG: what the app reads sizes of
export const PACK_ID = /^[a-z0-9_-]{1,40}$/

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
const words = (s: string | undefined) => (s ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)
const sorted = (s: string | undefined) => [...words(s)].sort().join(' ')
// A Japanese long vowel spelt either way: KAMIJOU, KAMIJOH, KAMIJOO and KAMIJO; YUUKI and YUKI.
const plain = (s: string) => s.replace(/O[UHO](?![AEIOUY])/g, 'O').replace(/UU/g, 'U')

// Two spellings of a surname: 'same', 'like' (a long vowel spelt another way, or one with more words
// than the other: LOPEZ CASTRO and LOPEZ), or null (another name, or one missing).
function surnames(a: string | undefined, b: string | undefined): 'same' | 'like' | null {
  const x = norm(a), y = norm(b)
  if (!x || !y) return null
  if (x === y) return 'same'
  if (plain(x) === plain(y)) return 'like'
  const [short, long] = words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)]
  return short.length < long.length && short.every((w, i) => w === long[i]) ? 'like' : null
}

// Two first names: 'same' (alike, or the same words in another order: Larry Ik and IK Larry), 'like'
// (sharing an initial: one written short), 'other', or null when one is missing.
function firstNames(a: string | undefined, b: string | undefined): 'same' | 'like' | 'other' | null {
  const x = norm(a), y = norm(b)
  if (!x || !y) return null
  if (x === y || sorted(a) === sorted(b)) return 'same'
  const initials = words(b).map(w => w[0])
  return words(a).some(w => initials.includes(w[0])) ? 'like' : 'other'
}

// A name written in full on one side and short on the other (ZACHARY and ZACH), or alike.
const alike = (a: string | undefined, b: string | undefined) => {
  const x = norm(a), y = norm(b)
  return !!x && !!y && (x === y || sorted(a) === sorted(b) || plain(x) === plain(y) || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x))))
}

// How well a pack player fits a scouted one; 0 = not this person. Player IDs differ between scouts,
// so an ID is enough on its own; otherwise the team must match and then the names (a jersey alone would
// put a teammate's face on a player), the first name and jersey telling same-surname players apart.
// The names as written fit best; then a surname spelt another way; then a scout that has the two
// names the other way round (NUNES/Judson for JUDSON/Nunes); last, the same jersey and first name
// under a surname romanised another way (LEE and RI).
export function fit(pp: PackPlayer, p: Player, teamCode: string): number {
  if (pp.ids?.some(id => id.replace(/-a$/i, '').toUpperCase() === p.key.toUpperCase())) return 100
  const code = teamCode.toUpperCase()
  if (pp.team !== code && !pp.teams?.includes(code)) return 0
  const jersey = pp.jersey !== undefined && pp.jersey === p.jersey ? 5 : 0
  const sur = surnames(pp.lastName, p.lastName)
  if (sur) {
    const first = firstNames(pp.firstName, p.firstName)
    if (first === 'other') return 0 // another first name: a teammate with the same surname
    return (sur === 'same' ? 10 : 8) + (first === 'same' ? 3 : first === 'like' ? 1 : 0) + jersey
  }
  if (alike(pp.lastName, p.firstName) && alike(pp.firstName, p.lastName)) return 7 + jersey
  if (jersey && norm(pp.firstName).length >= 3 && firstNames(pp.firstName, p.firstName) === 'same') return 6
  return 0
}

export interface PackPhoto { pack: string; player: PackPlayer }

// Photos added or replaced in the app go to this pack of the user's own (not a league's), so reading
// a league pack in again keeps them; one that fits a player wins over any league pack's.
export const LOCAL_PACK = 'local'

// The player a photo is set for in the app: the scouted player and their team's code.
export interface PhotoTarget { key: string; team: string; jersey: number; lastName: string; firstName: string; label?: string } // label: kept from a league pack's photo

export function localEntry(tg: PhotoTarget, photo: string): PackPlayer {
  return { team: tg.team.toUpperCase(), jersey: tg.jersey, lastName: tg.lastName, ...(tg.firstName ? { firstName: tg.firstName } : {}), ...(tg.label ? { label: tg.label } : {}), ids: [tg.key], photo }
}

// A local entry made for this player (by ID, or by team, surname and jersey): replaced by a new photo.
export function isFor(pp: PackPlayer, tg: PhotoTarget): boolean {
  return !!pp.ids?.some(id => id.toUpperCase() === tg.key.toUpperCase())
    || (pp.team === tg.team.toUpperCase() && norm(pp.lastName) === norm(tg.lastName) && pp.jersey === tg.jersey)
}

// The photo that best fits a scouted player, across every pack; null when none fits or two fit equally.
export function findPhoto(packs: PackInfo[], p: Player, teamCode: string): PackPhoto | null {
  let best: PackPhoto | null = null, top = 0, tie = false
  for (const pk of packs) {
    for (const pp of pk.players) {
      let s = fit(pp, p, teamCode)
      if (s > 0 && pk.id === LOCAL_PACK) s += 1000
      if (s > top) { best = { pack: pk.id, player: pp }; top = s; tie = false } else if (s && s === top) tie = true
    }
  }
  return tie ? null : best
}

// The photo for a play's player on the caption: the player as scouted, and their team's code.
export function captionPhoto(packs: PackInfo[], dvw: ParsedDVW, play: Play): { pack: string; photo: string } | null {
  const p = dvw.players[`${play.side}${play.jersey}`]
  if (!p) return null
  const hit = findPhoto(packs, p, dvw.teams[play.side === '*' ? 0 : 1].code)
  return hit ? { pack: hit.pack, photo: hit.player.photo } : null
}

// For the picker's search box: the label, the names and the team code.
export function matchesQuery(pp: PackPlayer, q: string): boolean {
  const words = q.toUpperCase().split(/\s+/).filter(Boolean)
  const hay = [pp.label ?? '', pp.lastName, pp.firstName ?? '', pp.team, ...(pp.teams ?? []), pp.jersey ?? ''].join(' ').toUpperCase()
  return words.every(w => hay.includes(w))
}
