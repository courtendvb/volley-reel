// Every module the packed app requires has to be inside its app.asar. electron-builder copies them
// from node_modules, and where it can't follow them (1.0.7: built in a worktree whose node_modules was
// a junction to another checkout's) it only warns "cannot find path for dependency" and packs the app
// without them. That app stops on start with "Cannot find module 'fs-extra'", and the copies that
// updated to it can't update again. npm run release checks the asar before it publishes.
import { createRequire } from 'node:module'

// Package folder ("" for the app itself, "node_modules/a", "node_modules/a/node_modules/b") -> its
// package.json. Returns "needer -> name" for each dependency that Node's lookup (the package's own
// node_modules, then each one further up) doesn't find among them.
export function unresolvedDeps(pkgs) {
  const missing = []
  for (const [dir, pkg] of pkgs) {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (pkg.optionalDependencies?.[name] !== undefined) continue
      let found = false
      for (let d = dir; ; d = parentModulesDir(d)) {
        if (pkgs.has(d ? `${d}/node_modules/${name}` : `node_modules/${name}`)) { found = true; break }
        if (!d) break
      }
      if (!found) missing.push(`${pkg.name ?? 'app'} -> ${name}`)
    }
  }
  return missing
}

// "node_modules/a/node_modules/b" -> "node_modules/a"; "node_modules/a" (or "node_modules/@s/a") -> "".
function parentModulesDir(dir) {
  const i = dir.lastIndexOf('/node_modules/')
  return i < 0 ? '' : dir.slice(0, i)
}

// The package folders inside an app.asar, read with @electron/asar (electron-builder's own).
export function asarPackages(asarPath, asar = createRequire(import.meta.url)('@electron/asar')) {
  const pkgs = new Map()
  for (const entry of asar.listPackage(asarPath)) {
    const p = entry.replace(/\\/g, '/').replace(/^\//, '')
    if (!/(^|\/)package\.json$/.test(p)) continue
    const dir = p.slice(0, -'package.json'.length).replace(/\/$/, '')
    if (dir && !/(^|\/)node_modules\/(@[^/]+\/)?[^/@][^/]*$/.test(dir)) continue // a package.json deeper in a package
    pkgs.set(dir, JSON.parse(asar.extractFile(asarPath, entry.replace(/^[\\/]/, '')).toString('utf8'))) // its own separators
  }
  return pkgs
}

export function missingInAsar(asarPath) { return unresolvedDeps(asarPackages(asarPath)) }
