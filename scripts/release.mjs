// npm run release: build the Windows installer and publish it (with latest.yml) as a release of
// courtendvb/volley-reel-releases, which installed copies check on start. Raise "version" in
// package.json first: the release is named after it, and the apps only take a higher version.
// The upload uses the GitHub CLI's login (gh auth token), so no token is kept in the project.
//
// The release is made as a draft first and published once every file is up: electron-builder's
// uploads run side by side, and when they create the release themselves they race (one fails,
// leaving the release without latest.yml). Apps don't see a draft, so they never get half a release.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { packsToShip } from './packs-guard.mjs'

const REPO = 'courtendvb/volley-reel-releases'
const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`
// Before anything is built or uploaded: no league photos in a public release by accident.
const packs = packsToShip()
if (packs.length && process.env.VR_RELEASE_WITH_PACKS !== '1') {
  console.error(`vendor/packs にパックがあります（${packs.join(', ')}）。インストーラーに入り、${REPO} は公開なので誰でもダウンロードできます。`)
  console.error('パックはモニターに .vrpack で渡し、vendor/packs から外してからリリースしてください（入れて公開するときだけ VR_RELEASE_WITH_PACKS=1）')
  process.exit(1)
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

let token
try { token = gh('auth', 'token') } catch { /* below */ }
if (!token) { console.error('GitHub CLI にログインしてください（gh auth login）'); process.exit(1) }

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, GH_TOKEN: token } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const existing = (() => { try { return JSON.parse(gh('release', 'view', tag, '--repo', REPO, '--json', 'isDraft')) } catch { return null } })()
if (existing && !existing.isDraft) { console.error(`${tag} はもう公開されています。package.json の version を上げてください`); process.exit(1) }

console.log(`volley-reel ${version} を書き出して公開します`)
if (!existing) gh('release', 'create', tag, '--repo', REPO, '--draft', '--title', version, '--notes', `volley-reel ${version}`)
run('npx', ['electron-vite', 'build'])
run('npx', ['electron-builder', '--win', '--x64', '--publish', 'always'])

const files = JSON.parse(gh('release', 'view', tag, '--repo', REPO, '--json', 'assets')).assets.map(a => a.name)
const need = ['latest.yml', `volley-reel-setup-${version}.exe`, `volley-reel-setup-${version}.exe.blockmap`]
const missing = need.filter(n => !files.includes(n))
if (missing.length) { console.error(`アップロードされていないファイルがあります: ${missing.join(', ')}（下書きのまま）`); process.exit(1) }
gh('release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest')
console.log(`公開しました: https://github.com/${REPO}/releases/tag/${tag}`)
