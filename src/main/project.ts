// Project folder (v3): project.json (name, our team codes, which library matches it
// uses) and reels/. Matches live in the library and are referenced by id. A pre-v3 project (with
// its own matches/) is migrated on open: its matches move into the library under the same ids.
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { cleanSavedFilters, type SavedFilter } from '../shared/filter'
import type { OverlayTheme } from '../shared/overlay'
import type { Reel } from '../shared/reel'
import { newVideo, type Video } from '../shared/video'
import type { Match, ParsedDVW, ProjectInfo, ProjectSettings } from '../shared/types'
import type { Library } from './library'
import { readJSON, safeId, writeJSON } from './store'
import { t } from '../shared/i18n'

const DEFAULT_SETTINGS: ProjectSettings = { ourTeamCodes: ['HTH'] }

interface ProjectFile {
  version: 2
  name: string
  ourTeamCodes: string[]
  playerAliases: Record<string, string> // the old 名寄せ table: no longer used, kept as saved
  theme?: OverlayTheme
  filters?: SavedFilter[]
  matchIds: string[]
  scenesVersion?: number // 1 = videos exist (v3 step 2); older projects get one video per reel
}

export class Project {
  private file: ProjectFile = { version: 2, name: '', ...DEFAULT_SETTINGS, playerAliases: {}, matchIds: [] }
  // Problems found while loading (recovered or unreadable files), shown once by the renderer.
  notices: string[] = []

  private constructor(readonly dir: string, private library: Library) {}

  static async create(dir: string, library: Library, init: { name: string; ourTeamCodes: string[]; matchIds: string[] }): Promise<Project> {
    if (existsSync(join(dir, 'project.json'))) throw new Error(t('このフォルダにはすでにプロジェクトがあります。「開く」で開いてください'))
    const p = new Project(dir, library)
    await makeFolders(dir)
    p.file = { version: 2, name: init.name.trim() || basename(dir), ourTeamCodes: cleanCodes(init.ourTeamCodes).slice(0, 1), playerAliases: {}, matchIds: [...new Set(init.matchIds)], scenesVersion: 1 }
    await p.save()
    return p
  }

  static async open(dir: string, library: Library): Promise<Project> {
    const p = new Project(dir, library)
    const file = join(dir, 'project.json')
    if (!existsSync(file) && !existsSync(`${file}.bak`)) throw new Error(t('プロジェクトが見つかりません（project.json がありません）'))
    await makeFolders(dir)
    const { data: saved, fromBackup } = await readJSON<Partial<ProjectFile> & { version?: number }>(file)
    if (fromBackup) p.notices.push(t('プロジェクトの設定ファイルが読めなかったため、1つ前の保存から復元しました'))
    p.file = {
      version: 2,
      name: saved.name || basename(dir),
      // One target team per project: older projects with several codes keep the first.
      ourTeamCodes: Array.isArray(saved.ourTeamCodes) && saved.ourTeamCodes.length ? saved.ourTeamCodes.slice(0, 1) : DEFAULT_SETTINGS.ourTeamCodes,
      playerAliases: saved.playerAliases && typeof saved.playerAliases === 'object' ? saved.playerAliases : {},
      ...(validTheme(saved.theme) ? { theme: saved.theme } : {}),
      filters: cleanSavedFilters(saved.filters),
      matchIds: Array.isArray(saved.matchIds) ? saved.matchIds : [],
      scenesVersion: saved.scenesVersion,
    }
    if ((saved.version ?? 1) < 2) await p.migrateV1()
    if (!p.file.scenesVersion) await p.migrateToVideos()
    const missing = p.file.matchIds.filter(id => !library.getMatch(id))
    if (missing.length) p.notices.push(t('倉庫に見つからない試合が {0} 件あります（倉庫を変えた可能性があります）', missing.length))
    return p
  }

  // v1 projects kept matches/<id>.json themselves. Hand them to the library, keep the old folder
  // renamed (never deleted), and remember the ids. A match the library already has (same video and
  // DVW) is not duplicated: the project's reels are re-pointed to the library's id instead.
  private async migrateV1(): Promise<void> {
    const old = join(this.dir, 'matches')
    if (existsSync(old)) {
      const remap = new Map<string, string>()
      for (const f of await readdir(old)) {
        if (!f.endsWith('.json')) continue
        try {
          const { data } = await readJSON<Match>(join(old, f))
          const id = await this.library.adopt(data)
          if (id !== data.id) remap.set(data.id, id)
          if (!this.file.matchIds.includes(id)) this.file.matchIds.push(id)
        } catch {
          this.notices.push(t('古い形式の試合ファイル {0} を移せませんでした', f))
        }
      }
      if (remap.size) {
        for (const r of await this.listReels()) {
          let changed = false
          for (const c of Object.values(r.clips)) { const to = remap.get(c.matchId); if (to) { c.matchId = to; changed = true } }
          if (changed) await this.saveReel(r)
        }
      }
      await rename(old, join(this.dir, `matches.v1-${Date.now()}`))
      this.notices.push(t('古い形式のプロジェクトでした。試合 {0} 件を倉庫に移しました', this.file.matchIds.length))
    }
    await this.save()
  }

  // Before videos existed, each reel was exported on its own. Keep that: one video per reel, with
  // the reel's overlay look (now a video setting). Reels themselves become scenes unchanged.
  private async migrateToVideos(): Promise<void> {
    const reels = await this.listReels()
    for (const r of reels) {
      const legacy = (r as Reel & { overlay?: Video['overlay'] }).overlay
      await this.saveVideo(newVideo(r.name, [r.id], { ...(legacy ?? {}), titleCard: { sceneCards: false, ...(legacy?.titleCard ?? {}) } }))
    }
    if (reels.length) this.notices.push(t('リールはシーンになりました。これまでどおり書き出せるよう、リール1本ごとに同じ名前の動画を作りました（{0} 本）', reels.length))
    this.file.scenesVersion = 1
    await this.save()
  }

  async listVideos(): Promise<Video[]> {
    const out: Video[] = []
    for (const f of await readdir(join(this.dir, 'videos'))) {
      if (!f.endsWith('.json')) continue
      try {
        const { data, fromBackup } = await readJSON<Video>(join(this.dir, 'videos', f))
        if (fromBackup) this.notices.push(t('動画「{0}」のファイルが読めなかったため、1つ前の保存から復元しました', data.name))
        out.push(data)
      } catch {
        this.notices.push(t('動画のファイル {0} が読めませんでした（ファイルはそのまま残しています）', f))
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveVideo(v: Video): Promise<void> {
    await writeJSON(join(this.dir, 'videos', `${safeId(v.id)}.json`), v)
  }

  async deleteVideo(id: string): Promise<void> {
    const f = join(this.dir, 'videos', `${safeId(id)}.json`)
    if (existsSync(f)) await rename(f, join(this.dir, 'videos', 'deleted', `${safeId(id)}-${Date.now()}.json`))
  }

  get name(): string { return this.file.name }

  info(): ProjectInfo {
    const matches = this.file.matchIds.map(id => this.library.getMatch(id)).filter((m): m is Match => !!m)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.name.localeCompare(b.name))
    return {
      path: this.dir, name: this.file.name, matches, matchIds: [...this.file.matchIds],
      settings: { ourTeamCodes: this.file.ourTeamCodes, ...(this.file.theme ? { theme: this.file.theme } : {}), filters: this.file.filters ?? [] },
      missing: this.library.missing(matches),
    }
  }

  getMatch(id: string): Match | undefined {
    return this.file.matchIds.includes(id) ? this.library.getMatch(id) : undefined
  }

  parse(id: string): Promise<ParsedDVW> {
    if (!this.file.matchIds.includes(id)) throw new Error(t('この試合はプロジェクトに入っていません: {0}', id))
    return this.library.parse(id)
  }

  async setMatches(ids: string[]): Promise<void> {
    this.file.matchIds = [...new Set(ids)].filter(id => this.library.getMatch(id))
    await this.save()
  }

  async saveSettings(s: ProjectSettings): Promise<void> {
    this.file.ourTeamCodes = cleanCodes(s.ourTeamCodes).slice(0, 1)
    if (validTheme(s.theme)) this.file.theme = { base: s.theme.base, accent: s.theme.accent }
    if (s.filters) this.file.filters = cleanSavedFilters(s.filters)
    await this.save()
  }

  // One file per reel (design §5), so a bad write can only ever cost one reel.
  async listReels(): Promise<Reel[]> {
    const out: Reel[] = []
    for (const f of await readdir(join(this.dir, 'reels'))) {
      if (!f.endsWith('.json')) continue
      try {
        const { data, fromBackup } = await readJSON<Reel>(join(this.dir, 'reels', f))
        if (fromBackup) this.notices.push(t('リール「{0}」のファイルが読めなかったため、1つ前の保存から復元しました', data.name))
        out.push(data)
      } catch {
        this.notices.push(t('リールのファイル {0} が読めませんでした（ファイルはそのまま残しています）', f))
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  takeNotices(): string[] {
    return [...this.library.notices.splice(0), ...this.notices.splice(0)]
  }

  async saveReel(r: Reel): Promise<void> {
    await writeJSON(join(this.dir, 'reels', `${safeId(r.id)}.json`), r)
  }

  // Deleting moves the file to reels/deleted/ rather than erasing it.
  async deleteReel(id: string): Promise<void> {
    const f = join(this.dir, 'reels', `${safeId(id)}.json`)
    if (existsSync(f)) await rename(f, join(this.dir, 'reels', 'deleted', `${safeId(id)}-${Date.now()}.json`))
  }

  private save(): Promise<void> {
    return writeJSON(join(this.dir, 'project.json'), this.file)
  }
}

async function makeFolders(dir: string): Promise<void> {
  await mkdir(join(dir, 'reels', 'deleted'), { recursive: true })
  await mkdir(join(dir, 'videos', 'deleted'), { recursive: true })
}

function validTheme(t: unknown): t is OverlayTheme {
  const hex = (v: unknown) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
  return !!t && typeof t === 'object' && hex((t as OverlayTheme).base) && hex((t as OverlayTheme).accent)
}

function cleanCodes(codes: string[]): string[] {
  return [...new Set(codes.map(c => c.trim().toUpperCase()).filter(Boolean))]
}
