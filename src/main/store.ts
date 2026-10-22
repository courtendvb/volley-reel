// Durable JSON files shared by the library and projects.
import { existsSync } from 'node:fs'
import { copyFile, open, readFile, rename } from 'node:fs/promises'

// Durable save: write a temp file and flush it to disk, keep the previous version as .bak, then
// rename into place. A crash or power cut leaves either the old file, the new one, or the .bak.
export async function writeJSON(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(data, null, 2), 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  if (existsSync(file)) await copyFile(file, `${file}.bak`)
  await rename(tmp, file)
}

// Reads a JSON file, falling back to its .bak when the file is missing or unreadable.
// A recovered file is restored from the backup right away; otherwise the next save would copy the
// broken file over the good backup.
export async function readJSON<T>(file: string): Promise<{ data: T; fromBackup: boolean }> {
  try {
    return { data: JSON.parse(await readFile(file, 'utf8')) as T, fromBackup: false }
  } catch (e) {
    const bak = `${file}.bak`
    if (!existsSync(bak)) throw e
    const data = JSON.parse(await readFile(bak, 'utf8')) as T
    if (existsSync(file)) await copyFile(file, `${file}.broken`) // kept for inspection
    await copyFile(bak, file)
    return { data, fromBackup: true }
  }
}

export function safeId(id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`invalid id: ${id}`)
  return id
}

export function fmt(sec: number): string {
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
