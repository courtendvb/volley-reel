// Project folder: project.json, matches/<id>.json, cache/ (design §5).
// Videos are referenced by path; only files Chromium can't play get a stripped copy in cache/.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import type { Reel } from '../shared/reel'
import { basename, join } from 'node:path'
import { parseDVW } from '../shared/dvw'
import type { ImportProgress, Match, ParsedDVW, ProjectInfo, ProjectSettings } from '../shared/types'
import { prepare, prepareReason, probe } from './media'

const DEFAULT_SETTINGS: ProjectSettings = { ourTeamCodes: ['HTH', 'HTA'], playerAliases: {} }

export class Project {
  private matches = new Map<string, Match>()
  private settings: ProjectSettings = DEFAULT_SETTINGS

  private constructor(readonly dir: string) {}

  static async open(dir: string): Promise<Project> {
    const p = new Project(dir)
    await mkdir(join(dir, 'matches'), { recursive: true })
    await mkdir(join(dir, 'cache'), { recursive: true })
    await mkdir(join(dir, 'reels', 'deleted'), { recursive: true })
    const file = join(dir, 'project.json')
    const saved = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : {}
    p.settings = {
      ourTeamCodes: Array.isArray(saved.ourTeamCodes) ? saved.ourTeamCodes : DEFAULT_SETTINGS.ourTeamCodes,
      playerAliases: saved.playerAliases && typeof saved.playerAliases === 'object' ? saved.playerAliases : {},
    }
    if (!existsSync(file)) await p.saveSettings(p.settings)
    for (const f of await readdir(join(dir, 'matches'))) {
      if (!f.endsWith('.json')) continue
      const m: Match = JSON.parse(await readFile(join(dir, 'matches', f), 'utf8'))
      p.matches.set(m.id, m)
    }
    return p
  }

  info(): ProjectInfo {
    const matches = [...this.matches.values()].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.name.localeCompare(b.name))
    return { path: this.dir, matches, settings: this.settings }
  }

  // One file per reel (design §5), so a bad write can only ever cost one reel.
  async listReels(): Promise<Reel[]> {
    const out: Reel[] = []
    for (const f of await readdir(join(this.dir, 'reels'))) {
      if (!f.endsWith('.json')) continue
      try { out.push(JSON.parse(await readFile(join(this.dir, 'reels', f), 'utf8'))) } catch { /* skip unreadable file; it stays on disk */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveReel(r: Reel): Promise<void> {
    await writeJSON(join(this.dir, 'reels', `${safeId(r.id)}.json`), r)
  }

  // Deleting moves the file to reels/deleted/ rather than erasing it.
  async deleteReel(id: string): Promise<void> {
    const f = join(this.dir, 'reels', `${safeId(id)}.json`)
    if (existsSync(f)) await rename(f, join(this.dir, 'reels', 'deleted', `${safeId(id)}-${Date.now()}.json`))
  }

  async saveSettings(s: ProjectSettings): Promise<void> {
    const ourTeamCodes = [...new Set(s.ourTeamCodes.map(c => c.trim().toUpperCase()).filter(Boolean))]
    const playerAliases = Object.fromEntries(Object.entries(s.playerAliases).filter(([k, v]) => k && v && k !== v))
    this.settings = { ourTeamCodes, playerAliases }
    await writeJSON(join(this.dir, 'project.json'), { version: 1, ...this.settings })
  }

  getMatch(id: string): Match | undefined {
    return this.matches.get(id)
  }

  findBySources(videoPath: string, dvwPath: string): Match | undefined {
    return [...this.matches.values()].find(m => m.sourceVideoPath === videoPath && m.dvwPath === dvwPath)
  }

  // Parsed every time from the DVW; plays are never saved (design §6).
  async parse(id: string): Promise<ParsedDVW> {
    const m = this.matches.get(id)
    if (!m) throw new Error(`試合が見つかりません: ${id}`)
    return parseDVW(await readFile(m.dvwPath, 'latin1'))
  }

  async importMatch(videoPath: string, dvwPath: string, progress: (p: ImportProgress) => void): Promise<Match> {
    const dvw = parseDVW(await readFile(dvwPath, 'latin1'))
    if (!dvw.plays.length) throw new Error(`${basename(dvwPath)} にプレーがありません`)

    progress({ stage: 'probe', message: '動画を確認しています' })
    const info = await probe(videoPath)
    const id = randomUUID()
    const reason = prepareReason(info)
    let playable = videoPath
    if (reason) {
      playable = join(this.dir, 'cache', `${id}.mp4`)
      const what = reason === 'reencode' ? '再生できる形式に変換' : '音声トラックを除去'
      progress({ stage: 'prepare', message: `${what}しています（${info.codec}/${info.pixFmt}, audio=${info.audio.join(',') || 'none'}）`, ratio: 0 })
      await prepare(videoPath, playable, reason, info.durationSec,
        ratio => progress({ stage: 'prepare', message: `${what}しています`, ratio }))
    }

    const warnings: string[] = []
    const first = dvw.plays[0].time, last = dvw.plays[dvw.plays.length - 1].time
    if (last > info.durationSec) {
      warnings.push(`DVW の時刻（${fmt(first)}〜${fmt(last)}）が動画の長さ（${fmt(info.durationSec)}）を超えています。別の動画かオフセットのずれの可能性があります`)
    }
    if (dvw.allHome) warnings.push('全プレーがホーム側で入力されています（全部ホーム入力）。チームの区別はできません')

    const [home, away] = dvw.teams
    const match: Match = {
      id,
      name: `${dvw.date ?? basename(dvwPath, '.dvw')} ${home.code}-${away.code}`,
      date: dvw.date,
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
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`invalid id: ${id}`)
  return id
}

// Write to a temp file then rename, so a crash never leaves half a JSON behind.
async function writeJSON(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await rename(tmp, file)
}

function fmt(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
