// Where ffmpeg / ffprobe are: FFMPEG_DIR if set; in the installed app, resources/ffmpeg (copied
// there by the installer, outside the asar so they can run); in development, vendor/ffmpeg/bin, or
// vendor/ffmpeg-mac/<arch> on a Mac (npm run ffmpeg:mac).
import { app } from 'electron'
import { join } from 'node:path'

function ffmpegDir(): string {
  if (process.env.FFMPEG_DIR) return process.env.FFMPEG_DIR
  if (app.isPackaged) return join(process.resourcesPath, 'ffmpeg')
  return process.platform === 'darwin' ? join(app.getAppPath(), 'vendor', 'ffmpeg-mac', process.arch) : join(app.getAppPath(), 'vendor', 'ffmpeg', 'bin')
}

const tool = (name: string) => join(ffmpegDir(), process.platform === 'win32' ? `${name}.exe` : name)
export const ffmpegBin = () => tool('ffmpeg')
export const ffprobeBin = () => tool('ffprobe')
