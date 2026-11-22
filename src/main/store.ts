// Durable JSON files shared by the library and projects.
import { existsSync } from 'node:fs'
import { copyFile, open, readFile, rename } from 'node:fs/promises'

// Saves to the same file run one after another, in the order asked: two at once would share the
// .tmp file, and an older save finishing last would overwrite a newer one.
const queues = new Map<string, Promise<void>>()

// Durable save: write a temp file and flush it to disk, keep the previous version as .bak, then
// rename into place. A crash or power cut leaves either the old file, the new one, or the .bak.
export function writeJSON(file: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data, null, 2) // the data as it is now, not when its turn comes
  const run = (queues.get(file) ?? Promise.resolve()).catch(() => {}).then(() => writeNow(file, json))
  queues.set(file, run)
  void run.catch(() => {}).finally(() => { if (queues.get(file) === run) queues.delete(file) })
  return run
}

async function writeNow(file: string, json: string): Promise<void> {
  const tmp = `${file}.tmp`
  const fh = await open(tmp, 'w')
  try {
    await fh.writeFile(json, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  if (existsSync(file)) await retryBusy(() => copyFile(file, `${file}.bak`))
  await retryBusy(() => rename(tmp, file))
}

// On Windows, antivirus scanners, OneDrive and Explorer's preview briefly hold files open, and a
// copy or rename then fails with EPERM / EBUSY / EACCES. Such locks clear within moments.
export async function retryBusy<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn()
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (i >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e
      await new Promise(r => setTimeout(r, 50 * i))
    }
  }
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
