// MP4 export (design §3.8), the pipeline M0 measured: each clip is trimmed and its overlay PNGs
// burnt in with one ffmpeg run, title cards are encoded from their PNG, and the segments are joined
// with the concat demuxer. Every segment uses identical encoder settings, so the join is a copy.
// Runs in the main process; the renderer only gets progress events, so the app stays usable.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportEvent, ExportItem, ExportJob, ExportLayer } from '../shared/types'
import { chapterMetadata, chapterText } from '../shared/video'
import { clipPlayedSec } from '../shared/timing'
import { ffmpegBin } from './ffmpegPath'
import { probe } from './media'
import { fps, retime } from './retime'
import { t } from '../shared/i18n'

class ExportCancelled extends Error {
  constructor() { super('cancelled') }
}

export class Exporter {
  private child: ChildProcess | null = null
  private cancelled = false
  running = false

  // videoOf maps a match id to the file to read (the playable source or its prepared copy).
  async run(job: ExportJob, workDir: string, videoOf: (matchId: string) => string | undefined, emit: (e: ExportEvent) => void): Promise<void> {
    if (this.running) throw new Error(t('書き出し中です。終わるか、キャンセルしてからもう一度試してください'))
    this.running = true
    this.cancelled = false
    const t0 = Date.now()
    const elapsed = () => (Date.now() - t0) / 1000
    const dur = (it: ExportItem) => (it.kind === 'clip' ? clipPlayedSec(it, it.timing) : it.durationSec)
    const total = job.items.reduce((s, it) => s + dur(it), 0)
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true })
    // The result is reported only after the work folder is cleaned up and the exporter is free, so a
    // next export started from it (scene by scene) can't have its files removed under it.
    let result: ExportEvent | null = null
    try {
      if (!job.items.length) throw new Error(t('書き出すクリップがありません'))
      const enc = encoderArgs(job.fpsStr)
      const segments: string[] = []
      const segStart: number[] = [0] // with chapters: where each segment starts in the joined file
      let doneSec = 0
      for (const [i, it] of job.items.entries()) {
        const seg = join(workDir, `seg${String(i).padStart(4, '0')}.mp4`)
        const report = (sec: number) => emit({ type: 'progress', ratio: Math.min(1, (doneSec + sec) / total), item: i, items: job.items.length, elapsedSec: elapsed() })
        report(0)
        if (it.kind === 'card') {
          const png = join(workDir, `card${i}.png`)
          await writeFile(png, it.png)
          await this.ffmpeg(await cardArgs(it, png, job, workDir, i, enc, seg), report)
        } else {
          const video = videoOf(it.matchId)
          if (!video || !existsSync(video)) throw new Error(t('動画が見つかりません（試合 {0}）', it.matchId))
          await this.ffmpeg(await clipArgs(it, video, job, workDir, i, enc), report)
        }
        segments.push(seg)
        // With chapters, each segment's real length (whole frames) times them, so they match the file.
        if (job.chapters) segStart.push((segStart[i] ?? 0) + (await probe(seg)).durationSec)
        doneSec += dur(it)
      }
      const list = join(workDir, 'concat.txt')
      await writeFile(list, segments.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
      // With chapters, they go into the MP4 too (VLC and the like list them); still a stream copy.
      const chapterList = job.chapters?.length ? job.chapters.map(c => ({ startSec: segStart[c.item], title: c.title })) : null
      const meta = join(workDir, 'chapters.ffmeta')
      if (chapterList) await writeFile(meta, chapterMetadata(chapterList, segStart[segments.length]), 'utf8')
      await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, ...(chapterList ? ['-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1'] : []),
        '-c', 'copy', '-movflags', '+faststart', job.outPath], () => {})
      const sizeBytes = (await stat(job.outPath)).size
      result = { type: 'done', outPath: job.outPath, elapsedSec: elapsed(), footageSec: total, sizeBytes, ...(chapterList ? { chapterCount: chapterList.length } : {}) }
      if (job.chapters?.length && job.chaptersText) {
        // "<video> チャプター.txt" beside the MP4, ready to paste into a YouTube description.
        const ch = chapterText(chapterList!, segStart[segments.length])
        const chaptersPath = job.outPath.replace(/\.mp4$/i, '') + t(' チャプター.txt')
        await writeFile(chaptersPath, ch.text, 'utf8')
        result = { ...result, chaptersPath, chapterCount: job.chapters.length, shortChapters: ch.short }
      }
    } catch (e) {
      if (e instanceof ExportCancelled || this.cancelled) {
        await rm(job.outPath, { force: true }) // never leave half a file behind
        result = { type: 'cancelled' }
      } else {
        result = { type: 'error', message: (e as Error).message }
      }
    } finally {
      this.child = null
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      this.running = false
      if (result) emit(result)
    }
  }

  cancel(): void {
    if (!this.running) return
    this.cancelled = true
    this.child?.kill()
  }

  private ffmpeg(args: string[], onSec: (sec: number) => void): Promise<void> {
    if (this.cancelled) return Promise.reject(new ExportCancelled())
    return new Promise((resolve, reject) => {
      const p = spawn(ffmpegBin(), ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true })
      this.child = p
      let err = ''
      p.stdout.on('data', d => { for (const m of String(d).matchAll(/out_time_us=(\d+)/g)) onSec(+m[1] / 1e6) })
      p.stderr.on('data', d => { err = (err + String(d)).slice(-4000) })
      p.on('error', reject)
      p.on('close', code => {
        this.child = null
        if (this.cancelled) reject(new ExportCancelled())
        else if (code === 0) resolve()
        else reject(new Error(t('ffmpeg が失敗しました: {0}', err.trim().split('\n').slice(-3).join(' / '))))
      })
    })
  }
}

// Same settings for every segment so the concat demuxer can join them without re-encoding.
// libx264 veryfast at CRF 21 measured 5.5x realtime at 720p in M0.
function encoderArgs(fpsStr: string): string[] {
  const gop = Math.round(fps(fpsStr) * 2)
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', fpsStr, '-g', String(gop),
    '-video_track_timescale', '15360', '-an']
}

// A card is its picture held for its length, with any layers over it in their windows.
async function cardArgs(it: Extract<ExportItem, { kind: 'card' }>, png: string, job: ExportJob, dir: string, i: number, enc: string[], seg: string): Promise<string[]> {
  const args = ['-loop', '1', '-framerate', job.fpsStr, '-t', it.durationSec.toFixed(3), '-i', png]
  const base = `scale=${job.width}:${job.height},format=yuv420p,setsar=1`
  const f = fades(job.fadeSec, it.durationSec)
  if (!it.layers?.length) return [...args, '-vf', `${base}${f}`, ...enc, seg]
  let fc = `[0:v]${base}[v0]`, last = 'v0'
  for (const [j, l] of it.layers.entries()) {
    const file = join(dir, `card${i}-layer${j}.png`)
    await writeFile(file, l.png)
    args.push('-i', file)
    fc += `;[${last}][${j + 1}:v]overlay=0:0:enable='between(t,${(l.from ?? 0).toFixed(3)},${(l.to ?? it.durationSec).toFixed(3)})'[v${j + 1}]`
    last = `v${j + 1}`
  }
  if (f) { fc += `;[${last}]${f.slice(1)}[vf]`; last = 'vf' }
  return [...args, '-filter_complex', fc, '-map', `[${last}]`, ...enc, seg]
}

// -ss before -i seeks fast and, because we re-encode, still cuts on the exact frame. Overlay
// filters see t from 0 at the clip's IN, as played: its slow stretches and holds (retime) come
// first, and the layers' from/to are times in the played clip.
async function clipArgs(it: Extract<ExportItem, { kind: 'clip' }>, video: string, job: ExportJob, dir: string, i: number, enc: string[]): Promise<string[]> {
  const args = ['-ss', it.in.toFixed(3), '-t', (it.out - it.in).toFixed(3), '-i', video]
  let fc = `[0:v]scale=${job.width}:${job.height}:flags=lanczos,fps=${job.fpsStr},format=yuv420p,setsar=1[v0]`
  let last = 'v0'
  const rt = retime(it, job.fpsStr)
  if (rt) { fc += `;[v0]${rt}[vt]`; last = 'vt' }
  const dur = clipPlayedSec(it, it.timing)
  for (const [j, l] of it.layers.entries()) {
    const png = join(dir, `clip${i}-layer${j}.png`)
    await writeFile(png, l.png)
    const from = l.from ?? 0, to = l.to ?? dur
    const enable = layerEnable(l, from, to)
    if (l.fadeIn || l.fadeOut) {
      // A fading layer is the picture looped over the clip, its alpha faded at its window's ends.
      args.push('-loop', '1', '-framerate', job.fpsStr, '-t', dur.toFixed(3), '-i', png)
      const fi = Math.min(l.fadeIn ?? 0, (to - from) / 2), fo = Math.min(l.fadeOut ?? 0, (to - from) / 2)
      const f = [fi > 0 ? `fade=t=in:st=${from.toFixed(3)}:d=${fi.toFixed(3)}:alpha=1` : '', fo > 0 ? `fade=t=out:st=${(to - fo).toFixed(3)}:d=${fo.toFixed(3)}:alpha=1` : ''].filter(Boolean).join(',')
      fc += `;[${j + 1}:v]format=rgba,${f}[f${j + 1}];[${last}][f${j + 1}]overlay=0:0${enable}[v${j + 1}]`
    } else {
      args.push('-i', png)
      fc += `;[${last}][${j + 1}:v]overlay=0:0${enable}[v${j + 1}]`
    }
    last = `v${j + 1}`
  }
  const f = fades(job.fadeSec, dur)
  if (f) { fc += `;[${last}]${f.slice(1)}[vf]`; last = 'vf' }
  return [...args, '-filter_complex', fc, '-map', `[${last}]`, ...enc, join(dir, `seg${String(i).padStart(4, '0')}.mp4`)]
}

// ":enable='…'" for a layer with a window (and a share of each period in it), or ''.
export function layerEnable(l: Pick<ExportLayer, 'from' | 'to' | 'every'>, from: number, to: number): string {
  const f = (n: number) => n.toFixed(3)
  const parts = [...(l.from !== undefined || l.to !== undefined || l.every ? [`between(t,${f(from)},${f(to)})`] : [])]
  if (l.every) {
    const m = `mod(t-${f(from)},${f(l.every.period)})`
    parts.push(`gte(${m},${f(l.every.at)})`, `lt(${m},${f(l.every.at + l.every.len)})`)
  }
  return parts.length ? `:enable='${parts.join('*')}'` : ''
}

// ",fade=in…,fade=out…" for an item of dur seconds (at most a third of it each), or ''.
function fades(sec: number | undefined, dur: number): string {
  const d = Math.min(sec ?? 0, dur / 3)
  if (!(d > 0.01)) return ''
  return `,fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${(dur - d).toFixed(3)}:d=${d.toFixed(3)}`
}
