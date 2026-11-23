// node scripts/edition-guard.mjs [--internal]: after `electron-vite build`, checks which edition out/ holds
// (src/internal/README.md). Without --internal it must be the sold one: none of the internal edition's
// words or code in it. It looks for
//   - the strings only the internal edition shows (src/internal/i18n-*.ts: the Japanese and the translations), and
//   - the text written in src/internal's code (the slides' labels, say) that the rest of the code doesn't have.
// With --internal, the other way round: they must be there (so the check above is looking for the right things).
// Exits 1 when the build isn't the edition asked for. npm run dist / dist:mac / release run it.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { internalOnly } from './edition-strings.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const src = join(root, 'src'), out = join(root, 'out')

const files = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p] })
const code = (dir, skip = () => false) => files(dir).filter(p => /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p) && !skip(p))

// What to look for, each with where it comes from.
export function markers() {
  const found = new Map()
  const add = (s, from) => { if (s.length >= 6 && !found.has(s)) found.set(s, from) }
  // The translations of the internal strings: long ones only, a short word ("Side") may be anywhere.
  for (const f of ['i18n-en.ts', 'i18n-es.ts']) {
    const text = readFileSync(join(src, 'internal', f), 'utf8')
    for (const m of text.matchAll(/^ {2}("(?:[^"\\]|\\.)*"): ("(?:[^"\\]|\\.)*"),?$/gm)) {
      const [ja, tr] = [JSON.parse(m[1]), JSON.parse(m[2])]
      add(ja, `internal/${f}`)
      if (tr.length >= 14) add(tr, `internal/${f}`)
    }
  }
  for (const s of internalOnly(src)) add(s, 'an internal string')
  // Where the internal edition's updates are, and what a lease opens its features with.
  add('syncscout-internal-releases', 'src/main/updater.ts')
  add('editor-internal', 'shared/edition.ts INTERNAL_APP')
  // The token its updates are read with, when this computer has it: never in the sold app.
  const token = process.env.VR_INTERNAL_UPDATE_TOKEN
  if (token) found.set(token, 'VR_INTERNAL_UPDATE_TOKEN')
  // Text in the internal code's quotes that the rest of the code doesn't have anywhere.
  const shared = code(src, p => p.includes(`${join(src, 'internal')}`)).map(p => readFileSync(p, 'utf8')).join('\n')
  for (const p of code(join(src, 'internal'), p => /i18n-..\.ts$/.test(p))) {
    for (const m of readFileSync(p, 'utf8').matchAll(/'([^'\\\n]{10,})'/g)) {
      const s = m[1]
      if (/[A-Za-z぀-ヿ一-鿿]{3}/.test(s) && !/^[./@]/.test(s) && !shared.includes(s)) add(s, p.slice(src.length + 1))
    }
  }
  return found
}

// JS escapes non-ASCII in some outputs (サ…): the built text is read both ways.
const unescape = s => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const internal = process.argv.includes('--internal')
  let built
  try { built = files(out).filter(p => /\.(js|mjs|cjs|html)$/.test(p)).map(p => [p.slice(out.length + 1), readFileSync(p, 'utf8')]) } catch { built = [] }
  if (!built.length) { console.error('out/ がありません。先に electron-vite build を'); process.exit(1) }
  const text = built.map(([p, s]) => [p, `${s}\n${unescape(s)}`])
  const look = [...markers()]
  const hits = look.flatMap(([s, from]) => text.filter(([, b]) => b.includes(s)).map(([p]) => ({ s, from, p })))
  if (!internal) {
    if (hits.length) {
      console.error('販売版のビルドに身内用の中身が入っています（src/internal/README.md）:')
      const shown = h => (h.from === 'VR_INTERNAL_UPDATE_TOKEN' ? '（トークン）' : h.s.slice(0, 60)) // never print the token
      for (const h of hits.slice(0, 30)) console.error(`  ${h.p}: "${shown(h)}"（${h.from}）`)
      if (hits.length > 30) console.error(`  ほか ${hits.length - 30} 件`)
      process.exit(1)
    }
    console.log(`販売版: 身内用の中身なし（${look.length} 個の目印を確認）`)
  } else {
    const seen = new Set(hits.map(h => h.s))
    const missing = look.filter(([s]) => !seen.has(s))
    // Not every marker need show (a string can be built up in code), but most must: else the check looks for nothing.
    if (seen.size < look.length * 0.6) {
      console.error(`身内版のビルドに目印が ${seen.size} / ${look.length} 個しかありません。身内版のビルドですか（VR_EDITION=internal）`)
      for (const [s, from] of missing.slice(0, 20)) console.error(`  "${from === 'VR_INTERNAL_UPDATE_TOKEN' ? '（トークン）' : s.slice(0, 60)}"（${from}）`)
      process.exit(1)
    }
    console.log(`身内版: 目印 ${seen.size} / ${look.length} 個あり`)
  }
}
