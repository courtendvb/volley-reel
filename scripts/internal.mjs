// The internal edition (src/internal/README.md), by name on any system (Windows' shell can't set a
// variable in front of a command):
//   node scripts/internal.mjs dev        electron-vite dev
//   node scripts/internal.mjs dist       the Windows installer → release-internal/
//   node scripts/internal.mjs dist:mac   the Mac disk images (on a Mac)
import { spawnSync } from 'node:child_process'

const env = { ...process.env, VR_EDITION: 'internal' }
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, env })
  if (r.status !== 0) process.exit(r.status ?? 1)
}
const builder = target => ['electron-builder', ...target, '--config', 'electron-builder.internal.yml', '--publish', 'never']
const what = process.argv[2]
// Built without them, the app works, but opens its features for nobody, or never updates.
if (what !== 'dev' && !(process.env.VR_INTERNAL_EMAILS ?? '').trim()) console.warn('注意: VR_INTERNAL_EMAILS がないので、この身内版では誰にも身内版の機能が開きません')
if (what !== 'dev' && !process.env.VR_INTERNAL_UPDATE_TOKEN) console.warn('注意: VR_INTERNAL_UPDATE_TOKEN がないので、この身内版は更新を探しません')
if (what === 'dev') run('npx', ['electron-vite', 'dev'])
else if (what === 'dist' || what === 'dist:mac') {
  run('npx', ['electron-vite', 'build'])
  run('node', ['scripts/edition-guard.mjs', '--internal'])
  run('npx', builder(what === 'dist' ? ['--win', '--x64'] : ['--mac']))
} else {
  console.error('node scripts/internal.mjs dev | dist | dist:mac')
  process.exit(1)
}
