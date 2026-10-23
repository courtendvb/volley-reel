// Project folder (v3): project.json (name, our team codes, alias table, which library matches it
// uses) and reels/. Matches live in the library and are referenced by id. A pre-v3 project (with
// its own matches/) is migrated on open: its matches move into the library under the same ids.
import { existsSync } from 'node:fs'
import { mkdir, readdir, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { OverlayTheme } from '../shared/overlay'
import type { Reel } from '../shared/reel'
import { newVideo, type Video } from '../shared/video'
import type { Match, ParsedDVW, ProjectInfo, ProjectSettings } from '../shared/types'
import type { Library } from './library'
import { readJSON, safeId, writeJSON } from './store'

const DEFAULT_SETTINGS: ProjectSettings = { ourTeamCodes: ['HTH', 'HTA'], playerAliases: {} }

interface ProjectFile {
  version: 2
  name: string
  ourTeamCodes: string[]
  playerAliases: Record<string, string>
  theme?: OverlayTheme
  matchIds: string[]
  scenesVersion?: number // 1 = videos exist (v3 step 2); older projects get one video per reel
}

export class Project {
  private file: ProjectFile = { version: 2, name: '', ...DEFAULT_SETTINGS, matchIds: [] }
  // Problems found while loading (recovered or unreadable files), shown once by the renderer.
  notices: string[] = []

  private constructor(readonly dir: string, private library: Library) {}

  static async create(dir: string, library: Library, init: { name: string; ourTeamCodes: string[]; matchIds: string[] }): Promise<Project> {
    if (existsSync(join(dir, 'project.json'))) throw new Error('このフォルダにはすでにプロジェクトがあります。「開く」で開いてください')
    const p = new Project(dir, library)
    await mkdir(join(dir, 'reels', 'deleted'), { recursive: true })
    await mkdir(join(dir, 'videos', 'deleted'), { recursive: true })
    p.file = { version: 2, name: init.name.trim() || basename(dir), ourTeamCodes: cleanCodes(init.ourTeamCodes), playerAliases: {}, matchIds: [...new Set(init.matchIds)], scenesVersion: 1 }
    await p.save()
    return p
  }

  static async open(dir: string, library: Library): Promise<Project> {
    const p = new Project(dir, library)
    const file = join(dir, 'project.json')
    if (!existsSync(file) && !existsSync(`${file}.bak`)) throw new Error('プロジェクトが見つかりません（project.json がありません）')
    await mkdir(join(dir, 'reels', 'deleted'), { recursive: true })
    await mkdir(join(dir, 'videos', 'deleted'), { recursive: true })
    const { data: saved, fromBackup } = await readJSON<Partial<ProjectFile> & { version?: number }>(file)
    if (fromBackup) p.notices.push('プロジェクトの設定ファイルが読めなかったため、1つ前の保存から復元しました')
    p.file = {
      version: 2,
      name: saved.name || basename(dir),
      ourTeamCodes: Array.isArray(saved.ourTeamCodes) ? saved.ourTeamCodes : DEFAULT_SETTINGS.ourTeamCodes,
      playerAliases: saved.playerAliases && typeof saved.playerAliases === 'object' ? saved.playerAliases : {},
      ...(validTheme(saved.theme) ? { theme: saved.theme } : {}),
      matchIds: Array.isArray(saved.matchIds) ? saved.matchIds : [],
      scenesVersion: saved.scenesVersion,
    }
    if ((saved.version ?? 1) < 2) await p.migrateV1()
    if (!p.file.scenesVersion) await p.migrateToVideos()
    const missing = p.file.matchIds.filter(id => !library.getMatch(id))
    if (missing.length) p.notices.push(`倉庫に見つからない試合が ${missing.length} 件あります（倉庫を変えた可能性があります）`)
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
          this.notices.push(`古い形式の試合ファイル ${f} を移せませんでした`)
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
      this.notices.push(`古い形式のプロジェクトでした。試合 ${this.file.matchIds.length} 件を倉庫に移しました`)
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
    if (reels.length) this.notices.push(`リールはシーンになりました。これまでどおり書き出せるよう、リール1本ごとに同じ名前の動画を作りました（${reels.length} 本）`)
    this.file.scenesVersion = 1
    await this.save()
  }

  async listVideos(): Promise<Video[]> {
    const out: Video[] = []
    for (const f of await readdir(join(this.dir, 'videos'))) {
      if (!f.endsWith('.json')) continue
      try {
        const { data, fromBackup } = await readJSON<Video>(join(this.dir, 'videos', f))
        if (fromBackup) this.notices.push(`動画「${data.name}」のファイルが読めなかったため、1つ前の保存から復元しました`)
        out.push(data)
      } catch {
        this.notices.push(`動画のファイル ${f} が読めませんでした（ファイルはそのまま残しています）`)
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
      settings: { ourTeamCodes: this.file.ourTeamCodes, playerAliases: this.file.playerAliases, ...(this.file.theme ? { theme: this.file.theme } : {}) },
    }
  }

  getMatch(id: string): Match | undefined {
    return this.file.matchIds.includes(id) ? this.library.getMatch(id) : undefined
  }

  parse(id: string): Promise<ParsedDVW> {
    if (!this.file.matchIds.includes(id)) throw new Error(`この試合はプロジェクトに入っていません: ${id}`)
    return this.library.parse(id)
  }

  async setMatches(ids: string[]): Promise<void> {
    this.file.matchIds = [...new Set(ids)].filter(id => this.library.getMatch(id))
    await this.save()
  }

  async rename(name: string): Promise<void> {
    this.file.name = name.trim() || this.file.name
    await this.save()
  }

  async saveSettings(s: ProjectSettings): Promise<void> {
    this.file.ourTeamCodes = cleanCodes(s.ourTeamCodes)
    this.file.playerAliases = Object.fromEntries(Object.entries(s.playerAliases).filter(([k, v]) => k && v && k !== v))
    if (validTheme(s.theme)) this.file.theme = { base: s.theme.base, accent: s.theme.accent }
    await this.save()
  }

  // One file per reel (design §5), so a bad write can only ever cost one reel.
  async listReels(): Promise<Reel[]> {
    const out: Reel[] = []
    for (const f of await readdir(join(this.dir, 'reels'))) {
      if (!f.endsWith('.json')) continue
      try {
        const { data, fromBackup } = await readJSON<Reel>(join(this.dir, 'reels', f))
        if (fromBackup) this.notices.push(`リール「${data.name}」のファイルが読めなかったため、1つ前の保存から復元しました`)
        out.push(data)
      } catch {
        this.notices.push(`リールのファイル ${f} が読めませんでした（ファイルはそのまま残しています）`)
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

function validTheme(t: unknown): t is OverlayTheme {
  const hex = (v: unknown) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
  return !!t && typeof t === 'object' && hex((t as OverlayTheme).base) && hex((t as OverlayTheme).accent)
}

function cleanCodes(codes: string[]): string[] {
  return [...new Set(codes.map(c => c.trim().toUpperCase()).filter(Boolean))]
}
