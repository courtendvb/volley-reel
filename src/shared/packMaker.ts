// Making a pack in the app (components/PackMaker.tsx): the players of the library's matches, photos
// given to them by file name or by hand, and the manifest for shared/pack.ts. Pure: no files, no DOM.
import { PACK_ID, type PackManifest, type PackPlayer } from './pack'
import type { ParsedDVW } from './types'

export interface RosterPlayer {
  key: string // as Player.key: the same person across matches
  team: string
  teamName: string
  teams: string[] // other codes they were scouted under
  jersey: number
  lastName: string
  firstName: string
  ids: string[]
}

const upper = (s: string) => s.trim().toUpperCase()
const bare = (s: string) => upper(s).replace(/[^A-Z0-9]/g, '')

// Everyone in the matches, once each; a later match's team and jersey win, as the newest.
export function rosterOf(dvws: ParsedDVW[]): RosterPlayer[] {
  const out = new Map<string, RosterPlayer>()
  for (const d of dvws) {
    for (const p of Object.values(d.players)) {
      if (!p.lastName.trim()) continue
      const t = d.teams[p.side === '*' ? 0 : 1], team = upper(t.code)
      const key = p.key ? upper(p.key) : `${team}|${bare(p.lastName)}|${bare(p.firstName)}`
      const had = out.get(key)
      out.set(key, {
        key, team, teamName: t.name, jersey: p.jersey, lastName: p.lastName.trim(), firstName: p.firstName.trim(),
        teams: [...new Set([...(had?.teams ?? []), ...(had && had.team !== team ? [had.team] : [])])].filter(c => c !== team),
        ids: p.key ? [p.key] : [],
      })
    }
  }
  return [...out.values()].sort((a, b) => a.team.localeCompare(b.team) || a.jersey - b.jersey)
}

// The player a photo's file name means: TEAM_7, TEAM-7 or "TEAM 7"; TEAM_SURNAME; or SURNAME when only
// one player has it. Null when it doesn't say, or says two players.
export function playerForFile(fileName: string, roster: RosterPlayer[]): RosterPlayer | null {
  const stem = upper(fileName.replace(/\.[^.]+$/, ''))
  const one = (list: RosterPlayer[]) => (list.length === 1 ? list[0] : null)
  const parts = stem.split(/[\s_-]+/).filter(Boolean)
  if (parts.length >= 2) {
    const inTeam = roster.filter(p => p.team === parts[0] || p.teams.includes(parts[0]))
    if (inTeam.length) {
      if (/^\d+$/.test(parts[1])) return one(inTeam.filter(p => p.jersey === Number(parts[1])))
      return one(inTeam.filter(p => bare(p.lastName) === bare(parts[1])))
    }
  }
  return one(roster.filter(p => bare(p.lastName) === bare(stem)))
}

// A name for the pack's file in the pack: PACK_PHOTO allows only these characters.
export const photoFile = (p: RosterPlayer) => `${p.team.replace(/[^A-Z0-9]/g, '')}_${p.jersey}_${bare(p.lastName).slice(0, 40)}.jpg`

// An id from the name, the same each time, so a pack made again replaces the old one. A name in
// Japanese has no letters to use, so a short hash stands in. 'local' is the app's own.
export function packIdOf(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
  let hash = 5381
  for (const c of name.trim()) hash = ((hash * 33) ^ c.codePointAt(0)!) >>> 0
  const id = slug && name.trim() === name.trim().replace(/[^\x20-\x7e]/g, '') ? slug : `pack-${hash.toString(36)}`
  return id === 'local' || !PACK_ID.test(id) ? `pack-${hash.toString(36)}` : id
}

export function packManifest(name: string, players: RosterPlayer[]): PackManifest {
  const entry = (p: RosterPlayer): PackPlayer => ({
    team: p.team, ...(p.teams.length ? { teams: p.teams } : {}), jersey: p.jersey, lastName: p.lastName,
    ...(p.firstName ? { firstName: p.firstName } : {}), ...(p.ids.length ? { ids: p.ids } : {}), photo: photoFile(p),
  })
  return { format: 'volley-reel-pack', version: 1, id: packIdOf(name), name: name.trim(), players: players.map(entry) }
}

// A pack photo's shape and size, and the part of a picture it shows, in the picture's pixels.
export const PHOTO_W = 600, PHOTO_H = 750
export interface Crop { x: number; y: number; w: number }
export const cropHeight = (c: Crop) => (c.w * PHOTO_H) / PHOTO_W

// The largest part that fits, in the middle across and near the top, where a face usually is.
export function firstCrop(width: number, height: number): Crop {
  const w = Math.min(width, (height * PHOTO_W) / PHOTO_H), h = (w * PHOTO_H) / PHOTO_W
  return keepCrop({ x: (width - w) / 2, y: (height - h) * 0.15, w }, width, height)
}

// A crop moved or zoomed stays inside the picture.
export function keepCrop(c: Crop, width: number, height: number): Crop {
  const w = Math.min(c.w, width, (height * PHOTO_W) / PHOTO_H), h = (w * PHOTO_H) / PHOTO_W
  return { x: Math.max(0, Math.min(width - w, c.x)), y: Math.max(0, Math.min(height - h, c.y)), w }
}
