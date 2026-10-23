// Where ffmpeg / ffprobe are: FFMPEG_DIR if set; in the installed app, resources/ffmpeg (copied
// there by the installer, outside the asar so they can run); in development, vendor/ffmpeg/bin.
import { app } from 'electron'
import { join } from 'node:path'

export function ffmpegDir(): string {
  if (process.env.FFMPEG_DIR) return process.env.FFMPEG_DIR
  return app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin')
}
