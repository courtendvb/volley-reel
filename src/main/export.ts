// MP4 export (design §3.8), the pipeline M0 measured: each clip is trimmed and its overlay PNGs
// burnt in with one ffmpeg run, title cards are encoded from their PNG, and the segments are joined
// with the concat demuxer. Every segment uses identical encoder settings, so the join is a copy.
// Runs in the main process; the renderer only gets progress events, so the app stays usable.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportEvent, ExportItem, ExportJob } from '../shared/types'
import { chapterText } from '../shared/video'
import { clipPlayedSec, pieces } from '../shared/timing'
import { ffmpegBin } from './ffmpegPath'
import { probe } from './media'
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
      await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', job.outPath], () => {})
      const sizeBytes = (await stat(job.outPath)).size
      result = { type: 'done', outPath: job.outPath, elapsedSec: elapsed(), footageSec: total, sizeBytes }
      if (job.chapters?.length) {
        // "<video> チャプター.txt" beside the MP4, ready to paste into a YouTube description.
        const ch = chapterText(job.chapters.map(c => ({ startSec: segStart[c.item], title: c.title })), segStart[segments.length])
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

// '30000/1001' or '30' as a number.
function fps(fpsStr: string): number {
  const [n, d] = fpsStr.split('/').map(Number)
  return d ? n / d : n
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
    const enable = l.from !== undefined || l.to !== undefined ? `:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'` : ''
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

// The clip's slow stretches and holds as a filter chain on the trimmed clip (times from 0 at IN), or
// null when it has none: each piece cut from a copy of the clip, slowed by stretching its timestamps
// or held by cloning one frame, then joined and put back on the frame rate.
function retime(it: Extract<ExportItem, { kind: 'clip' }>, fpsStr: string): string | null {
  const ps = pieces(it.in, it.out, it.timing)
  if (ps.length < 2 && !(ps[0]?.kind === 'play' && ps[0].rate !== 1)) return null
  const frame = 1 / fps(fpsStr), last = Math.max(0, it.out - it.in - frame)
  const parts = ps.map((p, k) => {
    if (p.kind === 'play') return `[r${k}]trim=start=${(p.from - it.in).toFixed(4)}:end=${(p.to - it.in).toFixed(4)},setpts=(PTS-STARTPTS)/${p.rate}[q${k}]`
    const at = Math.min(last, Math.max(0, p.at - it.in))
    return `[r${k}]trim=start=${at.toFixed(4)}:end=${(at + frame).toFixed(4)},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${Math.max(0, p.sec - frame).toFixed(4)}[q${k}]`
  })
  return `split=${ps.length}${ps.map((_, k) => `[r${k}]`).join('')};${parts.join(';')};${ps.map((_, k) => `[q${k}]`).join('')}concat=n=${ps.length}:v=1:a=0,fps=${fpsStr}`
}

// ",fade=in…,fade=out…" for an item of dur seconds (at most a third of it each), or ''.
function fades(sec: number | undefined, dur: number): string {
  const d = Math.min(sec ?? 0, dur / 3)
  if (!(d > 0.01)) return ''
  return `,fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${(dur - d).toFixed(3)}:d=${d.toFixed(3)}`
}
