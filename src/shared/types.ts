// Types shared by main, preload and renderer.
import type { Reel } from './reel'

export type Side = '*' | 'a'

export interface Team {
  code: string
  name: string
}

export interface Player {
  key: string // DataVolley player ID with the scrimmage "-a" suffix removed; same person across matches
  side: Side
  jersey: number
  lastName: string
  firstName: string
}

export interface Play {
  id: number // order of appearance; the skip rule in dvw.ts is fixed so this is stable per file
  fingerprint: string // `${setNum}|${home}-${away}|${code}|${time}` — re-links clips if ids shift
  code: string
  time: number // DVW time (offset not applied)
  side: Side
  jersey: number
  playerKey: string
  skill: string
  effect: string
  setNum: number
  setsBefore: { home: number; away: number }
  score: { home: number; away: number } // before the rally
  homeRot: number | null
  awayRot: number | null
  startZone: number | null
  endZone: number | null
  rallyId: number | null
}

export interface Rally {
  id: number
  setNum: number
  serveTime: number
  lastActionTime: number // the point line is logged ~10s after this, so clips end here
  pointTime: number | null
  wonBy: Side | null
}

export interface ParsedDVW {
  date: string | null // 'YYYY-MM-DD' from [3MATCH]
  teams: [Team, Team] // home, away
  players: Record<string, Player> // `${side}${jersey}`
  plays: Play[]
  rallies: Rally[]
  allHome: boolean // every play coded as '*': side can't tell the teams apart
}

export interface Match {
  id: string
  name: string
  date: string | null
  sourceVideoPath: string
  videoPath: string // what <video> plays: the source, or a cache file with audio removed
  dvwPath: string
  offsetSec: number // DVW time + offset = video time
  fps: number
  fpsStr: string
  durationSec: number
  width: number
  height: number
  teams: [Team, Team]
  allHome: boolean
  warnings: string[]
  importedAt: string
}

export interface ProjectSettings {
  ourTeamCodes: string[] // e.g. ['HTH', 'HTA']: decides 自チーム/相手 per match
  playerAliases: Record<string, string> // player key -> the key it is the same person as (manual exceptions)
}

export interface ProjectInfo {
  path: string
  matches: Match[]
  settings: ProjectSettings
}

export interface ImportProgress {
  stage: 'probe' | 'prepare' | 'save'
  message: string
  ratio?: number
}

export interface Api {
  getProject(): Promise<ProjectInfo | null>
  chooseProject(): Promise<ProjectInfo | null>
  importMatch(): Promise<Match | null>
  parseMatch(id: string): Promise<ParsedDVW>
  saveSettings(s: ProjectSettings): Promise<ProjectInfo>
  listReels(): Promise<Reel[]>
  saveReel(r: Reel): Promise<void>
  deleteReel(id: string): Promise<void>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
}
