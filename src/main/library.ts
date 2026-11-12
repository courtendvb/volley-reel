// The library (v3): every match the app knows, in one folder — library.json, matches/<id>.json,
// cache/ for prepared copies. Videos and DVWs stay where they are and are referenced by path, so a
// scout fix in the DVW shows up on the next read. Projects pick matches from here by id.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { strFromU8, unzipSync } from 'fflate'
import { basename, extname, join } from 'node:path'
import { parseScout } from '../shared/vsm'

import { rosterOf, type RosterPlayer } from '../shared/packMaker'
import { LOCAL_PACK, PACK_ID, PACK_PHOTO, isFor, localEntry, readManifest, type PackInfo, type PackManifest, type PhotoTarget } from '../shared/pack'
import { VIDEO_EXTENSIONS, matchDate, pairFiles, type DvwInfo } from '../shared/pairing'
import type { Annotation } from '../shared/annotation'
import type { CourtFit } from '../shared/court'
import type { ImportProgress, LibraryInfo, Match, MissingFiles, MissingPart, Palette, ParsedDVW, ScanResult } from '../shared/types'
import { prepare, prepareReason, probe } from './media'
import { fmt, readJSON, safeId, writeJSON } from './store'
import { t } from '../shared/i18n'
import { withServeMark } from '../shared/serveMark'

// A scout file: a DataVolley .dvw (Windows-1252 text) or a VolleyStation .vsm (JSON, UTF-8), read alike.
export const SCOUT_EXTENSIONS = ['dvw', 'vsm']
const readScout = async (path: string): Promise<ParsedDVW> => parseScout(await readFile(path, extname(path).toLowerCase() === '.vsm' ? 'utf8' : 'latin1'))
const scoutStem = (path: string) => basename(path, extname(path))

const LOGO_EXT = ['png', 'jpg', 'webp', 'gif', 'bmp']
const cleanCode = (code: string) => {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,8}$/.test(c)) throw new Error(t('チームコードが不正です: {0}', code))
  return c
}

export class Library {
  private matches = new Map<string, Match>()
  notices: string[] = []

  private constructor(readonly dir: string) {}

  // The palette: palette.json (my colors, saved objects) and palette-assets/ (their pictures).
  async palette(): Promise<Palette> {
    const f = join(this.dir, 'palette.json')
    if (!existsSync(f)) return { colors: [], items: [] }
    const { data } = await readJSON<Partial<Palette>>(f)
    return { colors: Array.isArray(data.colors) ? data.colors : [], items: Array.isArray(data.items) ? data.items : [],
      categories: Array.isArray(data.categories) ? data.categories : [] }
  }

  private async savePalette(p: Palette): Promise<Palette> {
    await writeJSON(join(this.dir, 'palette.json'), p)
    return p
  }

  async setPaletteColors(colors: string[]): Promise<Palette> {
    const clean = [...new Set(colors.filter(c => /^#[0-9A-F]{6}$/i.test(c)).map(c => c.toUpperCase()))].slice(0, 16)
    return this.savePalette({ ...(await this.palette()), colors: clean })
  }

  // Saves objects; pictures are copied from the project's assets so other projects can use them.
  async savePaletteItem(name: string, annotations: Annotation[], projectAssets: string, category: string | null = null): Promise<Palette> {
    const dir = join(this.dir, 'palette-assets')
    await mkdir(dir, { recursive: true })
    await copyPictures(annotations, projectAssets, dir)
    const p = await this.palette()
    const known = category && p.categories?.some(c => c.id === category) ? category : null
    const item = { id: randomUUID(), name: name.trim() || t('オブジェクト'), createdAt: new Date().toISOString(), annotations, ...(known ? { category: known } : {}) }
    return this.savePalette({ ...p, items: [item, ...p.items] })
  }

  // A locked item stays until it is unlocked.
  async removePaletteItem(id: string): Promise<Palette> {
    const p = await this.palette()
    return this.savePalette({ ...p, items: p.items.filter(i => i.id !== id || i.locked) })
  }

  // Puts an item at `to` (counted among the others), for the order the palette shows.
  async movePaletteItem(id: string, to: number): Promise<Palette> {
    const p = await this.palette()
    const item = p.items.find(i => i.id === id)
    if (!item) return p
    const rest = p.items.filter(i => i.id !== id)
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, item)
    return this.savePalette({ ...p, items: rest })
  }

  // Categories: the palette's tabs. Items without one show only under すべて.
  async addPaletteCategory(name: string): Promise<Palette> {
    const p = await this.palette()
    return this.savePalette({ ...p, categories: [...(p.categories ?? []), { id: randomUUID(), name: name.trim() || t('カテゴリ') }] })
  }

  async renamePaletteCategory(id: string, name: string): Promise<Palette> {
    const p = await this.palette()
    if (!name.trim()) return p
    return this.savePalette({ ...p, categories: (p.categories ?? []).map(c => (c.id === id ? { ...c, name: name.trim() } : c)) })
  }

  // Puts a category at `to` (counted among the others), for the order of the tabs.
  async movePaletteCategory(id: string, to: number): Promise<Palette> {
    const p = await this.palette()
    const cat = p.categories?.find(c => c.id === id)
    if (!cat) return p
    const rest = (p.categories ?? []).filter(c => c.id !== id)
    rest.splice(Math.max(0, Math.min(to, rest.length)), 0, cat)
    return this.savePalette({ ...p, categories: rest })
  }

  // Only an empty category goes, so removing a tab never takes items with it.
  async removePaletteCategory(id: string): Promise<Palette> {
    const p = await this.palette()
    if (p.items.some(i => i.category === id)) return p
    return this.savePalette({ ...p, categories: (p.categories ?? []).filter(c => c.id !== id) })
  }

  // null: no category (under すべて only).
  async setPaletteItemCategory(id: string, category: string | null): Promise<Palette> {
    const p = await this.palette()
    if (category && !p.categories?.some(c => c.id === category)) return p
    const items = p.items.map(i => {
      if (i.id !== id) return i
      const { category: _, ...rest } = i
      return category ? { ...rest, category } : rest
    })
    return this.savePalette({ ...p, items })
  }

  async lockPaletteItem(id: string, locked: boolean): Promise<Palette> {
    const p = await this.palette()
    const items = p.items.map(i => {
      if (i.id !== id) return i
      const { locked: _, ...rest } = i
      return locked ? { ...rest, locked: true } : rest
    })
    return this.savePalette({ ...p, items })
  }

  // The item's objects for a project: their pictures copied into its assets/ when missing.
  async usePaletteItem(id: string, projectAssets: string): Promise<Annotation[]> {
    const item = (await this.palette()).items.find(i => i.id === id)
    if (!item) throw new Error(t('パレットに見つかりません'))
    await mkdir(projectAssets, { recursive: true })
    await copyPictures(item.annotations, join(this.dir, 'palette-assets'), projectAssets)
    return item.annotations
  }

  // Team logos for title cards: logos/<CODE>.<ext>, one per three-letter code, shared by every project.
  async logos(): Promise<Record<string, string>> {
    const dir = join(this.dir, 'logos')
    if (!existsSync(dir)) return {}
    const out: Record<string, string> = {}
    for (const f of await readdir(dir)) {
      const m = /^([A-Z0-9]{1,8})\.(png|jpg|webp|gif|bmp)$/i.exec(f)
      if (m) out[m[1].toUpperCase()] = f
    }
    return out
  }

  async setLogo(code: string, file: string): Promise<void> {
    const ext = extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg')
    if (!LOGO_EXT.includes(ext)) throw new Error(t('ロゴは画像（PNG・JPEG・WebP など）を選んでください'))
    await this.removeLogo(code)
    await mkdir(join(this.dir, 'logos'), { recursive: true })
    await copyFile(file, join(this.dir, 'logos', `${cleanCode(code)}.${ext}`))
  }

  async removeLogo(code: string): Promise<void> {
    const f = (await this.logos())[cleanCode(code)]
    if (f) await rm(join(this.dir, 'logos', f), { force: true })
  }

  async readLogo(code: string): Promise<Uint8Array | null> {
    const f = (await this.logos())[cleanCode(code)]
    return f ? new Uint8Array(await readFile(join(this.dir, 'logos', f))) : null
  }

  // Packs shipped with the app (resources/packs, or vendor/packs in development): set once at start.
  static bundledPacks: string | null = null

  // Add-on packs (shared/pack.ts): addons/<id>/manifest.json and photos/, one folder per pack, and
  // the packs shipped with the app, unless the library has one of the same id (read in later).
  async packs(): Promise<PackInfo[]> {
    const own = await readPacks(join(this.dir, 'addons'))
    const shipped = Library.bundledPacks ? (await readPacks(Library.bundledPacks)).filter(b => !own.some(o => o.id === b.id)).map(b => ({ ...b, bundled: true as const })) : []
    return [...own, ...shipped].sort((a, b) => a.name.localeCompare(b.name))
  }

  // Reads a .vrpack (a zip) into addons/<id>/, replacing a pack with the same id. Only manifest.json
  // and the photos it names are taken; the manifest may sit in one top folder (a zipped folder).
  async importPack(file: string): Promise<PackInfo> {
    return this.importPackData(new Uint8Array(await readFile(file)))
  }

  async importPackData(data: Uint8Array): Promise<PackInfo> {
    let zip: Record<string, Uint8Array>
    try { zip = unzipSync(data) } catch { throw new Error(t('パックを開けませんでした（.vrpack ではないようです）')) }
    const at = Object.keys(zip).find(k => /^([^/]+\/)?manifest\.json$/.test(k))
    if (!at) throw new Error(t('パックに manifest.json がありません'))
    const root = at.slice(0, -'manifest.json'.length)
    let m: PackManifest | null = null
    try { m = readManifest(JSON.parse(strFromU8(zip[at]))) } catch { /* reported below */ }
    if (!m) throw new Error(t('パックの manifest.json が読めません（形式・バージョン・id を確かめてください）'))
    if (m.id === LOCAL_PACK) throw new Error(t('id「{0}」はアプリが使うため、パックには使えません', LOCAL_PACK))
    const players = m.players.filter(p => zip[`${root}photos/${p.photo}`])
    if (!players.length) throw new Error(t('パックに使える写真がありません'))
    const tmp = join(this.dir, 'addons', `.${m.id}-${randomUUID()}`), to = join(this.dir, 'addons', m.id)
    await mkdir(join(tmp, 'photos'), { recursive: true })
    for (const photo of new Set(players.map(p => p.photo))) await writeFile(join(tmp, 'photos', photo), zip[`${root}photos/${photo}`])
    await writeJSON(join(tmp, 'manifest.json'), { ...m, players })
    await rm(to, { recursive: true, force: true })
    await rename(tmp, to)
    return { id: m.id, name: m.name, players }
  }

  // Photos set in the app: kept in addons/local/ (shared/pack.ts LOCAL_PACK), one per player; a new
  // one replaces the player's old one, file and all.
  private async localPlayers(): Promise<PackInfo['players']> {
    return (await this.packs()).find(p => p.id === LOCAL_PACK)?.players ?? []
  }

  private async saveLocal(players: PackInfo['players']): Promise<void> {
    const dir = join(this.dir, 'addons', LOCAL_PACK)
    if (!players.length) { await rm(dir, { recursive: true, force: true }); return }
    await writeJSON(join(dir, 'manifest.json'), { format: 'volley-reel-pack', version: 1, id: LOCAL_PACK, name: LOCAL_PACK, players })
  }

  async setPlayerPhoto(tg: PhotoTarget, file: string): Promise<void> {
    const ext = extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg')
    if (ext !== 'png' && ext !== 'jpg') throw new Error(t('写真は PNG か JPEG を選んでください'))
    const dir = join(this.dir, 'addons', LOCAL_PACK, 'photos')
    await mkdir(dir, { recursive: true })
    const photo = `${randomUUID()}.${ext}`
    await copyFile(file, join(dir, photo))
    const old = await this.localPlayers()
    await this.saveLocal([...old.filter(pp => !isFor(pp, tg)), localEntry(tg, photo)])
    for (const pp of old.filter(pp => isFor(pp, tg))) await rm(join(dir, pp.photo), { force: true })
  }

  async removePlayerPhoto(tg: PhotoTarget): Promise<void> {
    const old = await this.localPlayers()
    await this.saveLocal(old.filter(pp => !isFor(pp, tg)))
    for (const pp of old.filter(pp => isFor(pp, tg))) await rm(join(this.dir, 'addons', LOCAL_PACK, 'photos', pp.photo), { force: true })
  }

  async removePack(id: string): Promise<void> {
    if (!PACK_ID.test(id)) return
    await rm(join(this.dir, 'addons', id), { recursive: true, force: true })
  }

  private packPhotoPath(id: string, photo: string): string {
    if (!PACK_ID.test(id) || !PACK_PHOTO.test(photo)) throw new Error(t('写真が見つかりません'))
    const own = join(this.dir, 'addons', id), f = join(own, 'photos', photo)
    if (existsSync(f)) return f
    const shipped = Library.bundledPacks && !existsSync(join(own, 'manifest.json')) ? join(Library.bundledPacks, id, 'photos', photo) : null
    if (shipped && existsSync(shipped)) return shipped
    throw new Error(t('写真が見つかりません'))
  }

  async readPackPhoto(id: string, photo: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.packPhotoPath(id, photo)))
  }

  // The photo copied into the project's assets (a project keeps its own pictures); its asset id.
  async usePackPhoto(id: string, photo: string, projectAssets: string): Promise<{ assetId: string; path: string }> {
    const from = this.packPhotoPath(id, photo)
    const assetId = `${randomUUID()}.${extname(photo).slice(1).toLowerCase().replace('jpeg', 'jpg')}`
    await mkdir(projectAssets, { recursive: true })
    await copyFile(from, join(projectAssets, assetId))
    return { assetId, path: from }
  }

  static async open(dir: string): Promise<Library> {
    const lib = new Library(dir)
    await mkdir(join(dir, 'matches'), { recursive: true })
    await mkdir(join(dir, 'cache'), { recursive: true })
    if (!existsSync(join(dir, 'library.json'))) await writeJSON(join(dir, 'library.json'), { version: 1, createdAt: new Date().toISOString() })
    for (const f of await readdir(join(dir, 'matches'))) {
      if (!f.endsWith('.json')) continue
      try {
        const { data: m, fromBackup } = await readJSON<Match>(join(dir, 'matches', f))
        if (fromBackup) lib.notices.push(t('試合「{0}」のファイルが読めなかったため、1つ前の保存から復元しました', m.name))
        lib.matches.set(m.id, m)
      } catch {
        lib.notices.push(t('試合のファイル {0} が読めませんでした（ファイルはそのまま残しています）', f))
      }
    }
    return lib
  }

  info(): LibraryInfo {
    return { path: this.dir, matches: this.list(), missing: this.missing(this.list()) }
  }

  missing(ms: Match[]): MissingFiles {
    const out: MissingFiles = {}
    for (const m of ms) {
      const parts: MissingPart[] = []
      if (!existsSync(m.videoPath)) parts.push('video')
      if (!existsSync(m.dvwPath)) parts.push('dvw')
      if (parts.length) out[m.id] = parts
    }
    return out
  }

  // Points a match at its video or DVW after the file moved. A video is checked like on import
  // (and prepared again when it needs it); a DVW must parse and have plays. Returns a note for the user.
  async relocate(id: string, part: MissingPart, path: string, progress: (p: ImportProgress) => void): Promise<string> {
    const m = this.matches.get(id)
    if (!m) throw new Error(t('試合が見つかりません: {0}', id))
    let next: Match, note: string
    if (part === 'dvw') {
      const dvw = await readScout(path)
      if (!dvw.plays.length) throw new Error(t('{0} にプレーがありません', basename(path)))
      const codes = dvw.teams.map(t => t.code).join('-'), was = m.teams.map(t => t.code).join('-')
      next = { ...m, dvwPath: path }
      note = codes === was ? t('{0}: DVW の場所を更新しました', m.name) : t('{0}: DVW の場所を更新しました（チームが {1} から {2} に変わっています。別の試合でないか確認してください）', m.name, was, codes)
    } else {
      progress({ stage: 'probe', message: t('{0} を確認しています', basename(path)) })
      const info = await probe(path)
      const reason = prepareReason(info)
      let playable = path
      if (reason) {
        playable = join(this.dir, 'cache', `${safeId(id)}.mp4`)
        const what = reason === 'reencode' ? t('再生できる形式に変換') : t('音声トラックを除去')
        progress({ stage: 'prepare', message: t('{0}しています', what), ratio: 0 })
        await prepare(path, playable, reason, info.durationSec, ratio => progress({ stage: 'prepare', message: t('{0}しています', what), ratio }))
      }
      next = { ...m, sourceVideoPath: path, videoPath: playable, fps: info.fps, fpsStr: info.fpsStr, durationSec: info.durationSec, width: info.width, height: info.height }
      note = Math.abs(info.durationSec - m.durationSec) > 2
        ? t('{0}: 動画の場所を更新しました（長さが {1} から {2} に変わっています。別の動画でないか確認してください）', m.name, fmt(m.durationSec), fmt(info.durationSec))
        : t('{0}: 動画の場所を更新しました', m.name)
    }
    progress({ stage: 'save', message: t('保存しています') })
    await this.saveMatch(next)
    return note
  }

  async setCourt(id: string, court: CourtFit | null): Promise<void> {
    const m = this.matches.get(id)
    if (!m) throw new Error(t('試合が見つかりません: {0}', id))
    if (court && !(court.corners?.length === 4 && court.corners.every(p => Number.isFinite(p?.x) && Number.isFinite(p?.y)) && (court.nearSet1 === '*' || court.nearSet1 === 'a')))
      throw new Error(t('コートの四隅が不正です'))
    const { court: _old, ...rest } = m
    const next: Match = court ? { ...rest, court } : rest
    await this.saveMatch(next)
  }

  // A serve's hit or touch on a match (serveMark.ts); null clears it.
  async setServeMark(id: string, fingerprint: string, patch: { hit?: number | null; touch?: number | null }): Promise<void> {
    const m = this.matches.get(id)
    if (!m) throw new Error(t('試合が見つかりません: {0}', id))
    const next = withServeMark(m, fingerprint, patch)
    this.matches.set(id, next) // before the write, so a mark set right after builds on this one
    await this.saveMatch(next)
  }

  private async saveMatch(m: Match): Promise<void> {
    await writeJSON(join(this.dir, 'matches', `${safeId(m.id)}.json`), m)
    this.matches.set(m.id, m)
  }

  list(): Match[] {
    return [...this.matches.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.name.localeCompare(b.name))
  }

  getMatch(id: string): Match | undefined {
    return this.matches.get(id)
  }

  findBySources(videoPath: string, dvwPath: string): Match | undefined {
    return this.list().find(m => same(m.sourceVideoPath, videoPath) && same(m.dvwPath, dvwPath))
  }

  // Everyone in the library's matches, for making a pack. A DVW that can't be read is left out.
  async roster(): Promise<RosterPlayer[]> {
    const dvws = await Promise.all([...this.matches.keys()].map(id => this.parse(id).catch(() => null)))
    return rosterOf(dvws.filter(d => d !== null))
  }

  // Parsed every time from the DVW; plays are never saved (design §6).
  async parse(id: string): Promise<ParsedDVW> {
    const m = this.matches.get(id)
    if (!m) throw new Error(t('試合が見つかりません: {0}', id))
    if (!existsSync(m.dvwPath)) throw new Error(t('{0}: DVW が見つかりません（{1}）', m.name, m.dvwPath))
    return readScout(m.dvwPath)
  }

  // Takes over a match from a pre-v3 project. Returns the library id to use: the same id, or the
  // id of a match already in the library with the same video and DVW (no duplicates).
  async adopt(m: Match): Promise<string> {
    if (this.matches.has(m.id)) return m.id
    const same = this.findBySources(m.sourceVideoPath, m.dvwPath)
    if (same) return same.id
    await this.saveMatch(m)
    return m.id
  }

  async importMatch(videoPath: string, dvwPath: string, progress: (p: ImportProgress) => void): Promise<Match> {
    const existing = this.findBySources(videoPath, dvwPath)
    if (existing) return existing
    const dvw = await readScout(dvwPath)
    if (!dvw.plays.length) throw new Error(t('{0} にプレーがありません', basename(dvwPath)))

    progress({ stage: 'probe', message: t('{0} を確認しています', basename(videoPath)) })
    const info = await probe(videoPath)
    const id = randomUUID()
    const reason = prepareReason(info)
    let playable = videoPath
    if (reason) {
      playable = join(this.dir, 'cache', `${id}.mp4`)
      const what = reason === 'reencode' ? t('再生できる形式に変換') : t('音声トラックを除去')
      progress({ stage: 'prepare', message: t('{0}しています（{1}/{2}, audio={3}）', what, info.codec, info.pixFmt, info.audio.join(',') || 'none'), ratio: 0 })
      await prepare(videoPath, playable, reason, info.durationSec, ratio => progress({ stage: 'prepare', message: t('{0}しています', what), ratio }))
    }

    const warnings: string[] = []
    const first = dvw.plays[0].time, last = dvw.plays[dvw.plays.length - 1].time
    if (last > info.durationSec) {
      warnings.push(t('DVW の時刻（{0}〜{1}）が動画の長さ（{2}）を超えています。別の動画かオフセットのずれの可能性があります', fmt(first), fmt(last), fmt(info.durationSec)))
    }
    if (dvw.allHome) warnings.push(t('全プレーがホーム側で入力されています（全部ホーム入力）。チームの区別はできません'))

    const [home, away] = dvw.teams
    const date = matchDate(dvw.date, dvwPath)
    const match: Match = {
      id,
      name: `${date ?? scoutStem(dvwPath)} ${home.code}-${away.code}`,
      date,
      sourceVideoPath: videoPath,
      videoPath: playable,
      dvwPath,
      offsetSec: 0,
      fps: info.fps,
      fpsStr: info.fpsStr,
      durationSec: info.durationSec,
      width: info.width,
      height: info.height,
      teams: dvw.teams,
      allHome: dvw.allHome,
      warnings,
      importedAt: new Date().toISOString(),
    }
    progress({ stage: 'save', message: t('保存しています') })
    await this.saveMatch(match)
    return match
  }

  // Bulk import, step 1: find DVWs and videos under the folders and propose pairs. DVWs already
  // in the library are listed but marked, so a second scan of the same folders is harmless.
  async scan(folders: string[]): Promise<ScanResult> {
    const dvwPaths: string[] = [], videos: string[] = []
    for (const f of folders) await walk(f, 3, p => {
      const ext = extname(p).slice(1).toLowerCase()
      if (SCOUT_EXTENSIONS.includes(ext)) dvwPaths.push(p)
      else if (VIDEO_EXTENSIONS.includes(ext)) videos.push(p)
    })
    const infos: DvwInfo[] = []
    const unreadable: string[] = []
    for (const p of dvwPaths) {
      try {
        const d = await readScout(p)
        infos.push({ path: p, date: matchDate(d.date, p), home: d.teams[0].code, away: d.teams[1].code })
      } catch {
        unreadable.push(p)
      }
    }
    // The same match as a .dvw and a .vsm (VolleyStation writes both): the .dvw only.
    const key = (i: DvwInfo) => `${i.date}|${i.home}|${i.away}`
    const dvwKeys = new Set(infos.filter(i => extname(i.path).toLowerCase() === '.dvw').map(key))
    for (let k = infos.length - 1; k >= 0; k--) if (extname(infos[k].path).toLowerCase() === '.vsm' && dvwKeys.has(key(infos[k]))) infos.splice(k, 1)
    const inLibrary = new Set(this.list().map(m => norm(m.dvwPath)))
    const pairs = pairFiles(infos, videos).map(p => ({
      dvwPath: p.dvw.path, date: p.dvw.date, home: p.dvw.home, away: p.dvw.away,
      video: p.video, score: p.score, note: p.note, inLibrary: inLibrary.has(norm(p.dvw.path)),
    }))
    return { pairs, videos, unreadable }
  }
}

// The objects' pictures from one assets folder to another, unless they are there already.
async function copyPictures(annotations: Annotation[], fromDir: string, toDir: string): Promise<void> {
  for (const a of annotations) {
    if (a.kind !== 'image' || !/^[0-9a-f-]{36}\.(png|jpg|webp|gif|bmp)$/.test(a.assetId)) continue
    const from = join(fromDir, a.assetId), to = join(toDir, a.assetId)
    if (existsSync(from) && !existsSync(to)) await copyFile(from, to)
  }
}

async function walk(dir: string, depth: number, visit: (p: string) => void): Promise<void> {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) { if (depth > 0 && !e.name.startsWith('.')) await walk(p, depth - 1, visit) }
    else visit(p)
  }
}

// Paths compare case-insensitively, with either slash, and however the system spells 濁点 (a Mac's
// file names can decompose them).
const norm = (p: string) => p.normalize('NFC').replace(/\\/g, '/').toLowerCase()
const same = (a: string, b: string) => norm(a) === norm(b)

// The packs in a folder: <id>/manifest.json (with its photos/ beside it); unreadable ones are left out.
async function readPacks(dir: string): Promise<PackInfo[]> {
  if (!existsSync(dir)) return []
  const out: PackInfo[] = []
  for (const id of await readdir(dir)) {
    const f = join(dir, id, 'manifest.json')
    if (!existsSync(f)) continue
    try {
      const m = readManifest(JSON.parse(await readFile(f, 'utf8')))
      if (m && m.id === id) out.push({ id: m.id, name: m.name, players: m.players })
    } catch { /* an unreadable pack is left out */ }
  }
  return out
}
