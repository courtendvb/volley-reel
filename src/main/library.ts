// The library (v3): every match the app knows, in one folder — library.json, matches/<id>.json,
// cache/ for prepared copies. Videos and DVWs stay where they are and are referenced by path, so a
// scout fix in the DVW shows up on the next read. Projects pick matches from here by id.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { parseDVW } from '../shared/dvw'
import { VIDEO_EXTENSIONS, matchDate, pairFiles, type DvwInfo } from '../shared/pairing'
import type { Annotation } from '../shared/annotation'
import type { ImportProgress, LibraryInfo, Match, Palette, ParsedDVW, ScanResult } from '../shared/types'
import { prepare, prepareReason, probe } from './media'
import { fmt, readJSON, safeId, writeJSON } from './store'

const LOGO_EXT = ['png', 'jpg', 'webp', 'gif', 'bmp']
const cleanCode = (code: string) => {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,8}$/.test(c)) throw new Error(`チームコードが不正です: ${code}`)
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
    return { colors: Array.isArray(data.colors) ? data.colors : [], items: Array.isArray(data.items) ? data.items : [] }
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
  async savePaletteItem(name: string, annotations: Annotation[], projectAssets: string): Promise<Palette> {
    const dir = join(this.dir, 'palette-assets')
    await mkdir(dir, { recursive: true })
    for (const a of annotations) {
      if (a.kind !== 'image' || !/^[0-9a-f-]{36}\.(png|jpg|webp|gif|bmp)$/.test(a.assetId)) continue
      const from = join(projectAssets, a.assetId), to = join(dir, a.assetId)
      if (existsSync(from) && !existsSync(to)) await copyFile(from, to)
    }
    const p = await this.palette()
    const item = { id: randomUUID(), name: name.trim() || 'オブジェクト', createdAt: new Date().toISOString(), annotations }
    return this.savePalette({ ...p, items: [item, ...p.items] })
  }

  async removePaletteItem(id: string): Promise<Palette> {
    const p = await this.palette()
    return this.savePalette({ ...p, items: p.items.filter(i => i.id !== id) })
  }

  // The item's objects for a project: their pictures copied into its assets/ when missing.
  async usePaletteItem(id: string, projectAssets: string): Promise<Annotation[]> {
    const item = (await this.palette()).items.find(i => i.id === id)
    if (!item) throw new Error('パレットに見つかりません')
    await mkdir(projectAssets, { recursive: true })
    for (const a of item.annotations) {
      if (a.kind !== 'image' || !/^[0-9a-f-]{36}\.(png|jpg|webp|gif|bmp)$/.test(a.assetId)) continue
      const from = join(this.dir, 'palette-assets', a.assetId), to = join(projectAssets, a.assetId)
      if (existsSync(from) && !existsSync(to)) await copyFile(from, to)
    }
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
    if (!LOGO_EXT.includes(ext)) throw new Error('ロゴは画像（PNG・JPEG・WebP など）を選んでください')
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

  static async open(dir: string): Promise<Library> {
    const lib = new Library(dir)
    await mkdir(join(dir, 'matches'), { recursive: true })
    await mkdir(join(dir, 'cache'), { recursive: true })
    if (!existsSync(join(dir, 'library.json'))) await writeJSON(join(dir, 'library.json'), { version: 1, createdAt: new Date().toISOString() })
    for (const f of await readdir(join(dir, 'matches'))) {
      if (!f.endsWith('.json')) continue
      try {
        const { data: m, fromBackup } = await readJSON<Match>(join(dir, 'matches', f))
        if (fromBackup) lib.notices.push(`試合「${m.name}」のファイルが読めなかったため、1つ前の保存から復元しました`)
        lib.matches.set(m.id, m)
      } catch {
        lib.notices.push(`試合のファイル ${f} が読めませんでした（ファイルはそのまま残しています）`)
      }
    }
    return lib
  }

  info(): LibraryInfo {
    return { path: this.dir, matches: this.list() }
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

  // Parsed every time from the DVW; plays are never saved (design §6).
  async parse(id: string): Promise<ParsedDVW> {
    const m = this.matches.get(id)
    if (!m) throw new Error(`試合が見つかりません: ${id}`)
    if (!existsSync(m.dvwPath)) throw new Error(`${m.name}: DVW が見つかりません（${m.dvwPath}）`)
    return parseDVW(await readFile(m.dvwPath, 'latin1'))
  }

  // Takes over a match from a pre-v3 project. Returns the library id to use: the same id, or the
  // id of a match already in the library with the same video and DVW (no duplicates).
  async adopt(m: Match): Promise<string> {
    if (this.matches.has(m.id)) return m.id
    const same = this.findBySources(m.sourceVideoPath, m.dvwPath)
    if (same) return same.id
    await writeJSON(join(this.dir, 'matches', `${safeId(m.id)}.json`), m)
    this.matches.set(m.id, m)
    return m.id
  }

  async importMatch(videoPath: string, dvwPath: string, progress: (p: ImportProgress) => void): Promise<Match> {
    const existing = this.findBySources(videoPath, dvwPath)
    if (existing) return existing
    const dvw = parseDVW(await readFile(dvwPath, 'latin1'))
    if (!dvw.plays.length) throw new Error(`${basename(dvwPath)} にプレーがありません`)

    progress({ stage: 'probe', message: `${basename(videoPath)} を確認しています` })
    const info = await probe(videoPath)
    const id = randomUUID()
    const reason = prepareReason(info)
    let playable = videoPath
    if (reason) {
      playable = join(this.dir, 'cache', `${id}.mp4`)
      const what = reason === 'reencode' ? '再生できる形式に変換' : '音声トラックを除去'
      progress({ stage: 'prepare', message: `${what}しています（${info.codec}/${info.pixFmt}, audio=${info.audio.join(',') || 'none'}）`, ratio: 0 })
      await prepare(videoPath, playable, reason, info.durationSec, ratio => progress({ stage: 'prepare', message: `${what}しています`, ratio }))
    }

    const warnings: string[] = []
    const first = dvw.plays[0].time, last = dvw.plays[dvw.plays.length - 1].time
    if (last > info.durationSec) {
      warnings.push(`DVW の時刻（${fmt(first)}〜${fmt(last)}）が動画の長さ（${fmt(info.durationSec)}）を超えています。別の動画かオフセットのずれの可能性があります`)
    }
    if (dvw.allHome) warnings.push('全プレーがホーム側で入力されています（全部ホーム入力）。チームの区別はできません')

    const [home, away] = dvw.teams
    const date = matchDate(dvw.date, dvwPath)
    const match: Match = {
      id,
      name: `${date ?? basename(dvwPath, '.dvw')} ${home.code}-${away.code}`,
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
    progress({ stage: 'save', message: '保存しています' })
    await writeJSON(join(this.dir, 'matches', `${id}.json`), match)
    this.matches.set(id, match)
    return match
  }

  // Bulk import, step 1: find DVWs and videos under the folders and propose pairs. DVWs already
  // in the library are listed but marked, so a second scan of the same folders is harmless.
  async scan(folders: string[]): Promise<ScanResult> {
    const dvwPaths: string[] = [], videos: string[] = []
    for (const f of folders) await walk(f, 3, p => {
      const ext = extname(p).slice(1).toLowerCase()
      if (ext === 'dvw') dvwPaths.push(p)
      else if (VIDEO_EXTENSIONS.includes(ext)) videos.push(p)
    })
    const infos: DvwInfo[] = []
    const unreadable: string[] = []
    for (const p of dvwPaths) {
      try {
        const d = parseDVW(await readFile(p, 'latin1'))
        infos.push({ path: p, date: matchDate(d.date, p), home: d.teams[0].code, away: d.teams[1].code })
      } catch {
        unreadable.push(p)
      }
    }
    const inLibrary = new Set(this.list().map(m => norm(m.dvwPath)))
    const pairs = pairFiles(infos, videos).map(p => ({
      dvwPath: p.dvw.path, date: p.dvw.date, home: p.dvw.home, away: p.dvw.away,
      video: p.video, score: p.score, note: p.note, inLibrary: inLibrary.has(norm(p.dvw.path)),
    }))
    return { pairs, videos, unreadable }
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

// Windows paths compare case-insensitively and with either slash.
const norm = (p: string) => p.replace(/\//g, '\\').toLowerCase()
const same = (a: string, b: string) => norm(a) === norm(b)
