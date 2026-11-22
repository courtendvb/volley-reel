// Video comparison (shared/videoCompare.ts): sessions saved one file each, and video files with no
// DVW made playable. A file is served as media://<token>/ (see serveMedia); one Chromium can't play
// is first prepared into a cache copy, the way a library match's video is.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { cleanCompare, type CompareFile, type CompareSession } from '../shared/videoCompare'
import type { ImportProgress } from '../shared/types'
import { prepare, prepareReason, probe } from './media'
import { readJSON, safeId, writeJSON } from './store'
import { t } from '../shared/i18n'

export class CompareStore {
  // token → the file <video> plays (the source, or its prepared copy)
  private playable = new Map<string, string>()
  constructor(private dir: string) {}

  fileOf(token: string): string | undefined { return this.playable.get(token) }

  async open(path: string, progress: (p: ImportProgress) => void): Promise<CompareFile> {
    if (!existsSync(path)) throw new Error(t('動画が見つかりません: {0}', path))
    const token = `f${createHash('sha1').update(path).digest('hex').slice(0, 32)}`
    progress({ stage: 'probe', message: t('{0} を確認しています', basename(path)) })
    const info = await probe(path)
    const reason = prepareReason(info)
    let file = path
    if (reason) {
      await mkdir(join(this.dir, 'cache'), { recursive: true })
      file = join(this.dir, 'cache', `${token}.mp4`)
      // a copy older than its source is made again
      const fresh = existsSync(file) && (await stat(file)).mtimeMs >= (await stat(path)).mtimeMs
      if (!fresh) {
        const what = reason === 'reencode' ? t('再生できる形式に変換') : t('音声を外したコピーを作成')
        progress({ stage: 'prepare', message: t('{0}しています', what), ratio: 0 })
        await prepare(path, file, reason, info.durationSec, ratio => progress({ stage: 'prepare', message: t('{0}しています', what), ratio }))
      }
    }
    this.playable.set(token, file)
    return { token, path, name: basename(path), width: info.width, height: info.height, fps: info.fps, durationSec: info.durationSec }
  }

  private sessions = () => join(this.dir, 'sessions')

  async list(): Promise<CompareSession[]> {
    const dir = this.sessions()
    if (!existsSync(dir)) return []
    const out: CompareSession[] = []
    for (const f of await readdir(dir)) {
      if (!f.endsWith('.json')) continue
      try { const c = cleanCompare((await readJSON<unknown>(join(dir, f))).data); if (c) out.push(c) } catch { /* unreadable: left out */ }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async save(s: CompareSession): Promise<void> {
    const c = cleanCompare(s)
    if (!c) throw new Error('invalid compare session')
    await mkdir(this.sessions(), { recursive: true })
    await writeJSON(join(this.sessions(), `${safeId(c.id)}.json`), c)
  }

  async remove(id: string): Promise<void> {
    for (const ext of ['json', 'json.bak']) await rm(join(this.sessions(), `${safeId(id)}.${ext}`), { force: true })
  }
}
