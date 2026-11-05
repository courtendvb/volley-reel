import type { Lang } from './i18n'
import type { Annotation } from './annotation'
import type { CourtFit } from './court'
import type { SavedFilter } from './filter'
// Types shared by main, preload and renderer.
import type { OverlayTheme } from './overlay'
import type { PackInfo, PhotoTarget } from './pack'
import type { Reel } from './reel'
import type { Video } from './video'
import type { ClipTiming } from './timing'

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

// A place on the court seen by the play's team from behind its own end line: u across (0–1), v from
// that end line (0) past the net (0.5) to the far one (1). Outside 0–1 is off the court.
export interface ClickPoint { u: number; v: number }

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
  startSub: string | null // A–D within the start zone, from where the scout clicked (not coded)
  endSub: string | null // A–D within the end zone: as coded, else from where the scout clicked
  startClick?: ClickPoint | null // where the scout clicked, or for a reception or dig where the ball came from (dvw.ts)
  endClick?: ClickPoint | null
  setTo?: string // a set: the tempo of the same team's attack right after it (dvw.ts)
  shotCode?: string // a reception or dig: the code of the serve or attack it answers, for the height the ball came from
  rallyId: number | null
  possibility?: boolean // the serve, blocks and first attack of a rally where the serving team got an attack (dvw.ts)
  before: string[] // codes of the last two contacts before this one in the rally, latest first, freeballs included
  after: string[] // the next two after it, in order
  phase: 'r' | 't' | null // reception phase or transition (dvw.ts phaseOf); null for serves
  recEffect?: string // in the reception phase: the evaluation of the reception it came from
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
  court?: CourtFit // the court grid fitted to this video (missing: not fitted yet)
}

export interface ProjectSettings {
  ourTeamCodes: string[] // e.g. ['HTH', 'HTA']: decides 自チーム/相手 per match
  theme?: OverlayTheme // overlay colors for the whole project (scoreboard, captions, title cards); missing = each video's own
  filters?: SavedFilter[] // search conditions saved under a name, in the order they were saved
}

export interface ProjectInfo {
  path: string
  name: string
  matches: Match[] // the project's matches found in the library
  matchIds: string[] // all ids the project refers to, including any missing from the library
  settings: ProjectSettings
  missing: MissingFiles
}

// Matches whose playable video or DVW is no longer where the library points (moved or deleted).
export type MissingPart = 'video' | 'dvw'
export type MissingFiles = Record<string, MissingPart[]>

// v3: the library holds every match; projects pick from it by id.
export interface LibraryInfo {
  path: string
  matches: Match[]
  missing: MissingFiles
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
  chooseFolder?: boolean // ask where to put it; otherwise a new folder in the library's projects/
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
  relocateMatch(id: string, part: MissingPart): Promise<{ library: LibraryInfo; project: ProjectInfo | null; note: string } | null> // choose where the moved file is now
  scanFolders(): Promise<ScanResult | null> // pick folders, propose DVW ↔ video pairs
  importPairs(pairs: { dvwPath: string; video: string }[]): Promise<{ imported: Match[]; failed: { dvwPath: string; message: string }[] }>
  recentProjects(): Promise<RecentProject[]>
  createProject(init: ProjectInit): Promise<ProjectInfo | null> // in <library>/projects/<name>, or a folder the user picks
  openProject(path?: string): Promise<ProjectInfo | null> // asks for a folder when no path
  closeProject(): Promise<void>
  setProjectMatches(ids: string[]): Promise<ProjectInfo>
  parseMatch(id: string): Promise<ParsedDVW>
  setMatchCourt(id: string, court: CourtFit | null): Promise<ProjectInfo | null> // null: forget the fit
  saveSettings(s: ProjectSettings): Promise<ProjectInfo>
  listReels(): Promise<Reel[]>
  saveReel(r: Reel): Promise<void>
  deleteReel(id: string): Promise<void>
  listVideos(): Promise<Video[]>
  saveVideo(v: Video): Promise<void>
  deleteVideo(id: string): Promise<void>
  chooseExportPath(defaultName: string): Promise<string | null>
  chooseExportFolder(fileNames: string[]): Promise<{ paths: string[]; existing: string[] } | null> // one .mp4 per name
  startExport(job: ExportJob): Promise<void>
  cancelExport(): Promise<void>
  onExportEvent(cb: (e: ExportEvent) => void): () => void
  onUpdateEvent(cb: (e: UpdateEvent) => void): () => void
  installUpdate(): Promise<void> // after saving: restart into the downloaded version
  updateHelp(what: 'page' | 'log'): Promise<void> // the releases page in the browser, or update.log in its folder
  appVersion(): Promise<string>
  lang: Lang // the interface language, read once when the window loads
  setLanguage(l: Lang): Promise<void> // kept for the next start; the window reloads to show it
  showInFolder(path: string): Promise<void>
  takeNotices(): Promise<string[]>
  // Images for annotations, kept in the project's assets/ folder. Picking an image copies it there;
  // picking a PDF returns its bytes, and the renderer saves page 1 as a PNG.
  pickAsset(): Promise<PickedAsset | null>
  saveAsset(png: Uint8Array): Promise<string>
  // Ctrl+V: what was copied last (objects in the app, a picture elsewhere), and the picture saved as an asset.
  clipboardKind(): Promise<'objects' | 'image' | 'other'>
  markObjectsCopied(): Promise<void>
  saveClipboardImage(): Promise<{ assetId: string; width: number; height: number } | null>
  readAsset(id: string): Promise<Uint8Array>
  smokePickAsset?: (path: string) => Promise<PickedAsset | null>
  // Slides: files picked as slides (several at once), read again by path when one changes, their
  // modified times (null: gone), and a frame of a match's video saved as a picture.
  pickSlides(): Promise<SlideFile[]>
  readSlideFile(path: string): Promise<SlideFile>
  slideFileTimes(paths: string[]): Promise<Record<string, number | null>>
  grabFrame(matchId: string, sec: number): Promise<string>
  smokePickSlides?: (paths: string[]) => Promise<SlideFile[]> // copies them into the project first
  smokeTouch?: (path: string) => Promise<void> // a file in the project: marked as just changed
  // Team logos (library, by team code) for title cards. Each returns the codes that have one -> file.
  // The palette (library, every project): my colors and saved objects. Pictures in saved objects
  // are copied into the library, and into the project again when the object is used.
  getPalette(): Promise<Palette>
  setPaletteColors(colors: string[]): Promise<Palette>
  savePaletteItem(name: string, annotations: Annotation[], category?: string | null): Promise<Palette>
  addPaletteCategory(name: string): Promise<Palette>
  renamePaletteCategory(id: string, name: string): Promise<Palette>
  removePaletteCategory(id: string): Promise<Palette> // only an empty one
  setPaletteItemCategory(id: string, category: string | null): Promise<Palette>
  removePaletteItem(id: string): Promise<Palette> // a locked item is kept
  movePaletteItem(id: string, to: number): Promise<Palette>
  lockPaletteItem(id: string, locked: boolean): Promise<Palette>
  usePaletteItem(id: string): Promise<Annotation[]> // its objects, with their pictures now in the project
  listLogos(): Promise<Record<string, string>>
  pickLogo(code: string): Promise<Record<string, string>>
  removeLogo(code: string): Promise<Record<string, string>>
  readLogo(code: string): Promise<Uint8Array | null>
  listPacks(): Promise<PackInfo[]>
  importPack(): Promise<PackInfo[]> // asks for a .vrpack; the packs after
  removePack(id: string): Promise<PackInfo[]>
  readPackPhoto(id: string, photo: string): Promise<Uint8Array>
  setPlayerPhoto(target: PhotoTarget): Promise<PackInfo[]> // asks for a picture; kept in the local pack
  removePlayerPhoto(target: PhotoTarget): Promise<PackInfo[]> // only a photo set in the app
  usePackPhoto(id: string, photo: string): Promise<{ assetId: string; width: number; height: number }> // copied into the project
  smokeImportPack?: (path: string) => Promise<PackInfo[]>
  smokeSetPhoto?: (target: PhotoTarget, path: string) => Promise<PackInfo[]>
  smokeRelocate?: (id: string, part: MissingPart, path: string) => Promise<{ library: LibraryInfo; project: ProjectInfo | null; note: string }>
  smokeSetLogo?: (code: string, path: string) => Promise<Record<string, string>>
  smokeClipboardImage?: (path: string) => Promise<void>
  smokeShot?: (path: string) => Promise<void>
  smokeDrag?: (points: [number, number][]) => Promise<void> // real mouse: press, move through, release
  smokeKey?: (key: string) => Promise<void> // a real key press
  // Closing the window: the main process asks for pending saves to be written, then closes.
  onFlushRequest(cb: () => Promise<void>): () => void
  // Dev smoke check only: edit a match's DVW copy (adds a point, deletes one play line).
  smokeEditDvw?: (matchId: string, deleteCode: string, deleteTime: number) => Promise<string>
  // Dev smoke check only: the dialog-free versions of scanning folders and creating a project.
  smokeScan?: (folders: string[]) => Promise<ScanResult>
  smokeCreateProject?: (dir: string, init: ProjectInit) => Promise<ProjectInfo>
  onImportProgress(cb: (p: ImportProgress) => void): () => void
}

export interface PaletteItem { id: string; name: string; createdAt: string; annotations: Annotation[]; locked?: boolean; category?: string } // locked: can't be removed
export interface PaletteCategory { id: string; name: string }
export interface Palette { colors: string[]; items: PaletteItem[]; categories?: PaletteCategory[] } // categories: the tabs, in order

// A picture is copied into assets/ right away; a PDF's pages are rendered by the renderer.
export type SlideFile = { path: string; name: string; mtimeMs: number } & ({ kind: 'image'; assetId: string } | { kind: 'pdf'; data: Uint8Array })

export type PickedAsset = { kind: 'image'; assetId: string } | { kind: 'pdf'; data: Uint8Array; name: string }

// ---- export (design §3.8) --------------------------------------------------------------------
// The renderer draws every overlay to PNG with the same functions as the preview; the main
// process trims, overlays, encodes and concatenates with ffmpeg.
export interface ExportLayer {
  png: Uint8Array // full-frame transparent PNG at the output size
  from?: number // seconds from the clip's IN; omitted = the whole clip
  to?: number
  fadeIn?: number // seconds the layer fades in from `from` (0 / missing: none)
  fadeOut?: number // seconds the layer fades out before `to`
}

export type ExportItem =
  | { kind: 'clip'; matchId: string; in: number; out: number; layers: ExportLayer[]; timing?: ClipTiming } // layers' from / to: seconds into the clip as played (with its slows and holds)
  | { kind: 'card'; png: Uint8Array; durationSec: number; layers?: ExportLayer[] } // layers' from / to: seconds into the card

export interface ExportJob {
  outPath: string
  width: number
  height: number
  fpsStr: string // e.g. '30000/1001'
  items: ExportItem[]
  fadeSec?: number // fade in and out of black on every item (clips and cards)
  chapters?: { item: number; title: string }[] // YouTube chapters starting at these items: a .txt next to the MP4
}

// A newer version for an installed copy: found, downloading, then ready to restart into.
export type UpdateEvent = { type: 'available'; version: string } | { type: 'progress'; ratio: number } | { type: 'ready'; version: string }
  | { type: 'error'; message: string } // the update couldn't be installed (the download page still works)

export type ExportEvent =
  | { type: 'progress'; ratio: number; item: number; items: number; elapsedSec: number }
  | { type: 'done'; outPath: string; elapsedSec: number; footageSec: number; sizeBytes: number
      chaptersPath?: string; chapterCount?: number; shortChapters?: string[] } // the chapter list written, how many, those under 10 s
  | { type: 'error'; message: string }
  | { type: 'cancelled' }
