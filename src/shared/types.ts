// Types shared by main, preload and renderer.
import type { OverlayTheme } from './overlay'
import type { Reel } from './reel'
import type { Video } from './video'

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
  codeNames: Record<string, string> // attack combinations and setter calls ([3ATTACKCOMBINATION], [3SETTERCALL]): code -> name
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
  theme?: OverlayTheme // overlay colors for the whole project (scoreboard, captions, title cards); missing = each video's own
}

export interface ProjectInfo {
  path: string
  name: string
  matches: Match[] // the project's matches found in the library
  matchIds: string[] // all ids the project refers to, including any missing from the library
  settings: ProjectSettings
}

// v3: the library holds every match; projects pick from it by id.
export interface LibraryInfo {
  path: string
  matches: Match[]
}

export interface ScanPair {
  dvwPath: string
  date: string | null
  home: string
  away: string
  video: string | null // proposed pairing; the user can change it before importing
  score: number
  note: string
  inLibrary: boolean
}

export interface ScanResult {
  pairs: ScanPair[]
  videos: string[] // every video found, for choosing a different one by hand
  unreadable: string[]
}

export interface RecentProject {
  path: string
  name: string
  openedAt: string
}

export interface ProjectInit {
  name: string
  ourTeamCodes: string[]
  matchIds: string[]
}

export interface ImportProgress {
  stage: 'probe' | 'prepare' | 'save'
  message: string
  ratio?: number
  item?: number // bulk import: which pair (0-based) of how many
  items?: number
}

export interface Api {
  getProject(): Promise<ProjectInfo | null>
  getLibrary(): Promise<LibraryInfo | null>
  chooseLibrary(): Promise<LibraryInfo | null>
  importMatch(): Promise<Match | null> // into the library, choosing a video and a DVW
  scanFolders(): Promise<ScanResult | null> // pick folders, propose DVW ↔ video pairs
  importPairs(pairs: { dvwPath: string; video: string }[]): Promise<{ imported: Match[]; failed: { dvwPath: string; message: string }[] }>
  recentProjects(): Promise<RecentProject[]>
  createProject(init: ProjectInit): Promise<ProjectInfo | null> // asks for a folder
  openProject(path?: string): Promise<ProjectInfo | null> // asks for a folder when no path
  closeProject(): Promise<void>
  setProjectMatches(ids: string[]): Promise<ProjectInfo>
  parseMatch(id: string): Promise<ParsedDVW>
  saveSettings(s: ProjectSettings): Promise<ProjectInfo>
  listReels(): Promise<Reel[]>
  saveReel(r: Reel): Promise<void>
  deleteReel(id: string): Promise<void>
  listVideos(): Promise<Video[]>
  saveVideo(v: Video): Promise<void>
  deleteVideo(id: string): Promise<void>
  chooseExportPath(defaultName: string): Promise<string | null>
  startExport(job: ExportJob): Promise<void>
  cancelExport(): Promise<void>
  onExportEvent(cb: (e: ExportEvent) => void): () => void
  showInFolder(path: string): Promise<void>
  takeNotices(): Promise<string[]>
  // Images for annotations, kept in the project's assets/ folder. Picking an image copies it there;
  // picking a PDF returns its bytes, and the renderer saves page 1 as a PNG.
  pickAsset(): Promise<PickedAsset | null>
  saveAsset(png: Uint8Array): Promise<string>
  readAsset(id: string): Promise<Uint8Array>
  smokePickAsset?: (path: string) => Promise<PickedAsset | null>
  // Team logos (library, by team code) for title cards. Each returns the codes that have one -> file.
  listLogos(): Promise<Record<string, string>>
  pickLogo(code: string): Promise<Record<string, string>>
  removeLogo(code: string): Promise<Record<string, string>>
  readLogo(code: string): Promise<Uint8Array | null>
  smokeSetLogo?: (code: string, path: string) => Promise<Record<string, string>>
  // Closing the window: the main process asks for pending saves to be written, then closes.
  onFlushRequest(cb: () => Promise<void>): () => void
  // Dev smoke check only: edit a match's DVW copy (adds a point, deletes one play line).
  smokeEditDvw?: (matchId: string, deleteCode: string, deleteTime: number) => Promise<string>
  // Dev smoke check only: the dialog-free versions of scanning folders and creating a project.
  smokeScan?: (folders: string[]) => Promise<ScanResult>
  smokeCreateProject?: (dir: string, init: ProjectInit) => Promise<ProjectInfo>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
}

export type PickedAsset = { kind: 'image'; assetId: string } | { kind: 'pdf'; data: Uint8Array; name: string }

// ---- export (design §3.8) --------------------------------------------------------------------
// The renderer draws every overlay to PNG with the same functions as the preview; the main
// process trims, overlays, encodes and concatenates with ffmpeg.
export interface ExportLayer {
  png: Uint8Array // full-frame transparent PNG at the output size
  from?: number // seconds from the clip's IN; omitted = the whole clip
  to?: number
}

export type ExportItem =
  | { kind: 'clip'; matchId: string; in: number; out: number; layers: ExportLayer[] }
  | { kind: 'card'; png: Uint8Array; durationSec: number }

export interface ExportJob {
  outPath: string
  width: number
  height: number
  fpsStr: string // e.g. '30000/1001'
  items: ExportItem[]
}

export type ExportEvent =
  | { type: 'progress'; ratio: number; item: number; items: number; elapsedSec: number }
  | { type: 'done'; outPath: string; elapsedSec: number; footageSec: number; sizeBytes: number }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
