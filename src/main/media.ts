// ffprobe / ffmpeg for import (design §3.1). Binaries: see ffmpegPath.
import { spawn } from 'node:child_process'
import { ffmpegBin, ffprobeBin } from './ffmpegPath'
import { t } from '../shared/i18n'


interface VideoInfo {
  codec: string
  pixFmt: string
  width: number
  height: number
  fps: number
  fpsStr: string
  durationSec: number
  audio: string[]
}

export async function probe(file: string): Promise<VideoInfo> {
  const out = await run(ffprobeBin(), ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])
  const j = JSON.parse(out)
  const v = j.streams.find((s: { codec_type: string }) => s.codec_type === 'video')
  if (!v) throw new Error(t('動画トラックが見つかりません'))
  const [n, d] = String(v.r_frame_rate || '0/1').split('/').map(Number)
  return {
    codec: v.codec_name, pixFmt: v.pix_fmt, width: v.width, height: v.height,
    fps: d ? n / d : 0, fpsStr: v.r_frame_rate,
    durationSec: parseFloat(j.format.duration),
    audio: j.streams.filter((s: { codec_type: string }) => s.codec_type === 'audio').map((s: { codec_name: string }) => s.codec_name),
  }
}

// Why the source can't be played as-is, or null when it can. AAC audio is fine (the <video> stays muted);
// LPCM in MP4 (XAVC S) makes Chromium refuse the whole file, and 4:2:2 / 10-bit H.264 won't decode.
export function prepareReason(info: VideoInfo): 'reencode' | 'strip-audio' | null {
  if (info.codec !== 'h264' || !['yuv420p', 'yuvj420p'].includes(info.pixFmt)) return 'reencode'
  if (info.audio.some(a => !['aac', 'mp3', 'opus'].includes(a))) return 'strip-audio'
  return null
}

export function prepare(src: string, dst: string, reason: 'reencode' | 'strip-audio', durationSec: number,
  onRatio: (r: number) => void): Promise<void> {
  const video = reason === 'reencode'
    ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'copy']
  return run(ffmpegBin(),
    ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats', '-i', src, '-map', '0:v:0', '-an', ...video, '-movflags', '+faststart', dst],
    chunk => { for (const m of chunk.matchAll(/out_time_us=(\d+)/g)) onRatio(Math.min(1, +m[1] / 1e6 / durationSec)) },
  ).then(() => undefined)
}

// One frame of a video as a PNG file (a slide made from the picture on screen), at full size.
export function grabFrame(src: string, sec: number, dst: string): Promise<void> {
  return run(ffmpegBin(), ['-hide_banner', '-y', '-ss', String(Math.max(0, sec)), '-i', src, '-frames:v', '1', dst]).then(() => undefined)
}

// One frame as raw RGB, w × h, for looking at its pixels.
export function rawFrame(src: string, sec: number, w: number, h: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegBin(), ['-v', 'error', '-ss', String(Math.max(0, sec)), '-i', src, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { windowsHide: true })
    const parts: Buffer[] = []
    let err = ''
    p.stdout.on('data', d => parts.push(d))
    p.stderr.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', code => {
      const all = Buffer.concat(parts)
      if (code === 0 && all.length === w * h * 3) resolve(new Uint8Array(all))
      else reject(new Error(err.trim() || `ffmpeg: ${all.length} bytes`))
    })
  })
}

function run(bin: string, args: string[], onStdout?: (s: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true })
    let out = '', err = ''
    p.stdout.on('data', d => { const s = d.toString(); out += s; onStdout?.(s) })
    p.stderr.on('data', d => { err += d.toString() })
    p.on('error', reject)
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').slice(-3).join('\n'))))
  })
}
