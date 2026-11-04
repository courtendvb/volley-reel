// Installers pile up in release/ (180 MB each), and every version stays on the releases repository
// anyway. After a publish, only the newest few versions are kept here. Nothing but the installers
// and their blockmaps is touched: packs handed to testers (release/packs) and the rest stay.
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const INSTALLER = /^volley-reel-setup-(\d+)\.(\d+)\.(\d+)\.exe(\.blockmap)?$/

// Removes all but the `keep` newest versions from dir; returns the versions removed, newest first.
export function pruneReleases(dir = 'release', keep = 5) {
  const files = readdirSync(dir).flatMap(f => { const m = f.match(INSTALLER); return m ? [{ f, v: [+m[1], +m[2], +m[3]] }] : [] })
  const key = v => v.join('.')
  const versions = [...new Map(files.map(x => [key(x.v), x.v])).values()]
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
  const old = new Set(versions.slice(keep).map(key))
  for (const x of files) if (old.has(key(x.v))) rmSync(join(dir, x.f))
  return [...old]
}
