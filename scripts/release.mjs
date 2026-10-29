// npm run release: build the Windows installer and publish it (with latest.yml) as a release of
// courtendvb/volley-reel-releases, which installed copies check on start. Raise "version" in
// package.json first: the release is named after it, and the apps only take a higher version.
// The upload uses the GitHub CLI's login (gh auth token), so no token is kept in the project.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
let token
try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim() } catch { /* below */ }
if (!token) { console.error('GitHub CLI にログインしてください（gh auth login）'); process.exit(1) }

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env: { ...process.env, GH_TOKEN: token } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
console.log(`volley-reel ${version} を書き出して公開します`)
run('npx', ['electron-vite', 'build'])
run('npx', ['electron-builder', '--win', '--x64', '--publish', 'always'])
console.log(`公開しました: https://github.com/courtendvb/volley-reel-releases/releases/tag/v${version}`)
