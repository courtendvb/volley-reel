// npm run ffmpeg:mac: puts the macOS ffmpeg and ffprobe into vendor/ffmpeg-mac/<arch> for both Mac
// processors (electron-builder.yml takes them from there). Static GPL builds with libx264, pinned
// to one version and checked against its SHA-256, so a build can't change without a change here.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const VERSION = '9.0.2'
const SITE = 'https://ffmpeg.martin-riedl.de'
const BUILDS = {
  arm64: { dir: 'arm64/1789931890_9.0.2', ffmpeg: 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924', ffprobe: 'fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6' },
  x64: { dir: 'amd64/1789931006_9.0.2', ffmpeg: '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4', ffprobe: '2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd' },
}
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar' // reads zip files

async function get(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${url}: ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}

const license = await get('https://raw.githubusercontent.com/FFmpeg/FFmpeg/n8.0/COPYING.GPLv3')
for (const [arch, b] of Object.entries(BUILDS)) {
  const out = join('vendor', 'ffmpeg-mac', arch)
  mkdirSync(out, { recursive: true })
  for (const name of ['ffmpeg', 'ffprobe']) {
    const file = join(out, name)
    if (existsSync(file)) { console.log(`${file}: already there`); continue }
    const url = `${SITE}/download/macos/${b.dir}/${name}.zip`
    console.log(`${url} ...`)
    const zip = await get(url)
    const sum = createHash('sha256').update(zip).digest('hex')
    if (sum !== b[name]) throw new Error(`${url}: SHA-256 is ${sum}, expected ${b[name]}`)
    const tmp = join(tmpdir(), `vr-${arch}-${name}.zip`)
    writeFileSync(tmp, zip)
    const r = spawnSync(TAR, ['-xf', tmp, '-C', out], { stdio: 'inherit' })
    rmSync(tmp, { force: true })
    if (r.status !== 0 || !existsSync(file)) throw new Error(`${url}: could not unpack ${name}`)
    chmodSync(file, 0o755)
  }
  // The build is GPL: its license and where its source is ship next to it.
  writeFileSync(join(out, 'LICENSE'), license)
  writeFileSync(join(out, 'README.txt'), `FFmpeg ${VERSION} for macOS (${arch}), a static GPL build by Martin Riedl.\nBuilds and the sources of each library: ${SITE}/\nFFmpeg source: https://ffmpeg.org/download.html\n`)
}
