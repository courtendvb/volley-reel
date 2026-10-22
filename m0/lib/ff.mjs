// ffmpeg / ffprobe runners. Binaries come from vendor/ffmpeg (or FFMPEG_DIR).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const BIN = process.env.FFMPEG_DIR || path.resolve(here, '../../vendor/ffmpeg/bin');
export const FFMPEG = path.join(BIN, 'ffmpeg.exe');
export const FFPROBE = path.join(BIN, 'ffprobe.exe');

// onProgress receives seconds of output written, parsed from `-progress pipe:1`.
export function run(bin, args, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const full = onProgress ? ['-progress', 'pipe:1', '-nostats', ...args] : args;
    const p = spawn(bin, full, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => {
      const s = d.toString(); out += s;
      if (onProgress) for (const m of s.matchAll(/out_time_us=(\d+)/g)) onProgress(+m[1] / 1e6);
    });
    p.stderr.on('data', d => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve({ out, err })
      : reject(new Error(`${path.basename(bin)} exited ${code}\n${err.slice(-2000)}`)));
  });
}

export async function probe(file) {
  const { out } = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const j = JSON.parse(out);
  const v = j.streams.find(s => s.codec_type === 'video');
  const [n, d] = (v?.r_frame_rate || '0/1').split('/').map(Number);
  return {
    codec: v?.codec_name, pixFmt: v?.pix_fmt, profile: v?.profile,
    width: v?.width, height: v?.height, fps: d ? n / d : 0,
    duration: parseFloat(j.format.duration),
    audio: j.streams.filter(s => s.codec_type === 'audio').map(s => s.codec_name),
    sizeBytes: +j.format.size,
  };
}

export const ffmpeg = (args, opts) => run(FFMPEG, ['-hide_banner', '-y', ...args], opts);
