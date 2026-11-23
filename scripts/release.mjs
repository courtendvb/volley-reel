// npm run release: build the Windows installer and publish it (with latest.yml) as a release of
// courtendvb/syncscout-video-editor-releases, which installed copies check on start. Raise "version" in
// package.json first: the release is named after it, and the apps only take a higher version.
//
// npm run release:internal (--internal): the internal edition (src/internal/README.md), to the private
// courtendvb/syncscout-internal-releases. Its version is package.json's with the date and time after it
// (1.2.0-internal.202611231530), so it can be published as often as wanted without touching package.json,
// and a new sold version's internal builds come after the old ones. It needs VR_INTERNAL_UPDATE_TOKEN,
// the token installed copies read that repository with, and VR_INTERNAL_EMAILS, the accounts its features
// open for (both go into the app; electron.vite.config.ts).
// The upload uses the GitHub CLI's login (gh auth token), so no token is kept in the project.
//
// The release is made as a draft first and published once every file is up: electron-builder's
// uploads run side by side, and when they create the release themselves they race (one fails,
// leaving the release without latest.yml). Apps don't see a draft, so they never get half a release.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { packsToShip } from './packs-guard.mjs'
import { pruneReleases } from './prune-releases.mjs'

const internal = process.argv.includes('--internal')
const REPO = internal ? 'courtendvb/syncscout-internal-releases' : 'courtendvb/syncscout-video-editor-releases'
const NAME = internal ? 'SyncScout Video Editor Internal' : 'SyncScout Video Editor'
const base = JSON.parse(readFileSync('package.json', 'utf8')).version
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12) // UTC, to the minute
const version = internal ? `${base}-internal.${stamp}` : base
const tag = `v${version}`
if (internal && !process.env.VR_INTERNAL_UPDATE_TOKEN) {
  console.error('VR_INTERNAL_UPDATE_TOKEN がありません。インストールした身内版が更新を読むためのトークン（syncscout-internal-releases の Contents: Read-only）を環境変数に入れてください')
  process.exit(1)
}
if (internal && !(process.env.VR_INTERNAL_EMAILS ?? '').trim()) {
  console.error('VR_INTERNAL_EMAILS がありません。身内版の機能を使える人のメールアドレス（SyncScout のログインのもの）を、カンマ区切りで環境変数に入れてください')
  process.exit(1)
}
// Before anything is built or uploaded: no league photos in a public release by accident. (The internal
// edition's releases are private and carry them.)
const packs = internal ? [] : packsToShip()
if (packs.length && process.env.VR_RELEASE_WITH_PACKS !== '1') {
  console.error(`vendor/packs にパックがあります（${packs.join(', ')}）。インストーラーに入り、${REPO} は公開なので誰でもダウンロードできます。`)
  console.error('パックはモニターに .vrpack で渡し、vendor/packs から外してからリリースしてください（入れて公開するときだけ VR_RELEASE_WITH_PACKS=1）')
  process.exit(1)
}
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' }).trim()

let token
try { token = gh('auth', 'token') } catch { /* below */ }
if (!token) { console.error('GitHub CLI にログインしてください（gh auth login）'); process.exit(1) }

// The sold edition unless asked: its releases are public (src/internal/README.md).
const env = { ...process.env, GH_TOKEN: token }
if (internal) env.VR_EDITION = 'internal'
else { delete env.VR_EDITION; delete env.VR_INTERNAL_UPDATE_TOKEN; delete env.VR_INTERNAL_EMAILS }
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const existing = (() => { try { return JSON.parse(gh('release', 'view', tag, '--repo', REPO, '--json', 'isDraft')) } catch { return null } })()
if (existing && !existing.isDraft) { console.error(`${tag} はもう公開されています。${internal ? '1 分おいてからもう一度' : 'package.json の version を上げてください'}`); process.exit(1) }

console.log(`${NAME} ${version} を書き出して公開します`)
if (!existing) gh('release', 'create', tag, '--repo', REPO, '--draft', '--title', version, '--notes', `${NAME} ${version}`)
run('npx', ['electron-vite', 'build'])
run('node', ['scripts/edition-guard.mjs', ...(internal ? ['--internal'] : [])]) // the sold one: nothing of the internal edition in it
run('npx', ['electron-builder', '--win', '--x64', '--publish', 'always',
  ...(internal ? ['--config', 'electron-builder.internal.yml', `-c.extraMetadata.version=${version}`] : [])])

const files = JSON.parse(gh('release', 'view', tag, '--repo', REPO, '--json', 'assets')).assets.map(a => a.name)
const setup = `${internal ? 'syncscout-internal' : 'syncscout-video-editor'}-setup-${version}.exe`
const need = ['latest.yml', setup, `${setup}.blockmap`]
const missing = need.filter(n => !files.includes(n))
if (missing.length) { console.error(`アップロードされていないファイルがあります: ${missing.join(', ')}（下書きのまま）`); process.exit(1) }
gh('release', 'edit', tag, '--repo', REPO, '--draft=false', '--latest')
console.log(`公開しました: https://github.com/${REPO}/releases/tag/${tag}`)
const gone = internal ? [] : pruneReleases() // the old installers here; they stay on the releases repository
if (gone.length) console.log(`release/ の古いインストーラーを消しました: ${gone.join(', ')}`)
