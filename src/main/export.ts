// MP4 export (design §3.8), the pipeline M0 measured: each clip is trimmed and its overlay PNGs
// burnt in with one ffmpeg run, title cards are encoded from their PNG, and the segments are joined
// with the concat demuxer. Every segment uses identical encoder settings, so the join is a copy.
// Runs in the main process; the renderer only gets progress events, so the app stays usable.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExportEvent, ExportItem, ExportJob } from '../shared/types'
import { ffmpegDir } from './ffmpegPath'

const binDir = ffmpegDir

export class ExportCancelled extends Error {
  constructor() { super('cancelled') }
}

export class Exporter {
  private child: ChildProcess | null = null
  private cancelled = false
  running = false

  // videoOf maps a match id to the file to read (the playable source or its prepared copy).
  async run(job: ExportJob, workDir: string, videoOf: (matchId: string) => string | undefined, emit: (e: ExportEvent) => void): Promise<void> {
    if (this.running) throw new Error('書き出し中です。終わるか、キャンセルしてからもう一度試してください')
    this.running = true
    this.cancelled = false
    const t0 = Date.now()
    const elapsed = () => (Date.now() - t0) / 1000
    const dur = (it: ExportItem) => (it.kind === 'clip' ? it.out - it.in : it.durationSec)
    const total = job.items.reduce((s, it) => s + dur(it), 0)
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true })
    try {
      if (!job.items.length) throw new Error('書き出すクリップがありません')
      const enc = encoderArgs(job.fpsStr)
      const segments: string[] = []
      let doneSec = 0
      for (const [i, it] of job.items.entries()) {
        const seg = join(workDir, `seg${String(i).padStart(4, '0')}.mp4`)
        const report = (sec: number) => emit({ type: 'progress', ratio: Math.min(1, (doneSec + sec) / total), item: i, items: job.items.length, elapsedSec: elapsed() })
        report(0)
        if (it.kind === 'card') {
          const png = join(workDir, `card${i}.png`)
          await writeFile(png, it.png)
          await this.ffmpeg(['-loop', '1', '-framerate', job.fpsStr, '-t', it.durationSec.toFixed(3), '-i', png,
            '-vf', `scale=${job.width}:${job.height},format=yuv420p,setsar=1${fades(job.fadeSec, it.durationSec)}`, ...enc, seg], report)
        } else {
          const video = videoOf(it.matchId)
          if (!video || !existsSync(video)) throw new Error(`動画が見つかりません（試合 ${it.matchId}）`)
          await this.ffmpeg(await clipArgs(it, video, job, workDir, i, enc), report)
        }
        segments.push(seg)
        doneSec += dur(it)
      }
      const list = join(workDir, 'concat.txt')
      await writeFile(list, segments.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n'))
      await this.ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', job.outPath], () => {})
      const sizeBytes = (await stat(job.outPath)).size
      emit({ type: 'done', outPath: job.outPath, elapsedSec: elapsed(), footageSec: total, sizeBytes })
    } catch (e) {
      if (e instanceof ExportCancelled || this.cancelled) {
        await rm(job.outPath, { force: true }) // never leave half a file behind
        emit({ type: 'cancelled' })
      } else {
        emit({ type: 'error', message: (e as Error).message })
      }
    } finally {
      this.running = false
      this.child = null
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
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
      const p = spawn(join(binDir(), 'ffmpeg.exe'), ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats', ...args], { windowsHide: true })
      this.child = p
      let err = ''
      p.stdout.on('data', d => { for (const m of String(d).matchAll(/out_time_us=(\d+)/g)) onSec(+m[1] / 1e6) })
      p.stderr.on('data', d => { err = (err + String(d)).slice(-4000) })
      p.on('error', reject)
      p.on('close', code => {
        this.child = null
        if (this.cancelled) reject(new ExportCancelled())
        else if (code === 0) resolve()
        else reject(new Error(`ffmpeg が失敗しました: ${err.trim().split('\n').slice(-3).join(' / ')}`))
      })
    })
  }
}

// Same settings for every segment so the concat demuxer can join them without re-encoding.
// libx264 veryfast at CRF 21 measured 5.5x realtime at 720p in M0.
function encoderArgs(fpsStr: string): string[] {
  const [n, d] = fpsStr.split('/').map(Number)
  const gop = Math.round((d ? n / d : n) * 2)
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-r', fpsStr, '-g', String(gop),
    '-video_track_timescale', '15360', '-an']
}

// -ss before -i seeks fast and, because we re-encode, still cuts on the exact frame. Overlay
// filters see t from 0 at the clip's IN, which is what the layers' from/to are relative to.
async function clipArgs(it: Extract<ExportItem, { kind: 'clip' }>, video: string, job: ExportJob, dir: string, i: number, enc: string[]): Promise<string[]> {
  const args = ['-ss', it.in.toFixed(3), '-t', (it.out - it.in).toFixed(3), '-i', video]
  let fc = `[0:v]scale=${job.width}:${job.height}:flags=lanczos,fps=${job.fpsStr},format=yuv420p,setsar=1[v0]`
  let last = 'v0'
  for (const [j, l] of it.layers.entries()) {
    const png = join(dir, `clip${i}-layer${j}.png`)
    await writeFile(png, l.png)
    args.push('-i', png)
    const enable = l.from !== undefined || l.to !== undefined
      ? `:enable='between(t,${(l.from ?? 0).toFixed(3)},${(l.to ?? it.out - it.in).toFixed(3)})'` : ''
    fc += `;[${last}][${j + 1}:v]overlay=0:0${enable}[v${j + 1}]`
    last = `v${j + 1}`
  }
  const f = fades(job.fadeSec, it.out - it.in)
  if (f) { fc += `;[${last}]${f.slice(1)}[vf]`; last = 'vf' }
  return [...args, '-filter_complex', fc, '-map', `[${last}]`, ...enc, join(dir, `seg${String(i).padStart(4, '0')}.mp4`)]
}

// ",fade=in…,fade=out…" for an item of dur seconds (at most a third of it each), or ''.
function fades(sec: number | undefined, dur: number): string {
  const d = Math.min(sec ?? 0, dur / 3)
  if (!(d > 0.01)) return ''
  return `,fade=t=in:st=0:d=${d.toFixed(3)},fade=t=out:st=${(dur - d).toFixed(3)}:d=${d.toFixed(3)}`
}
