// Which interface strings (the Japanese passed to t()) belong to which edition (src/internal/README.md).
// A string is the internal edition's when every place that shows it is
//   - in src/internal/, or
//   - on a line with __INTERNAL__ on it, or inside a block opened by one (`if (__INTERNAL__ && …) {`).
// Those go in src/internal/i18n-*.ts, which only the internal edition's build takes in; the rest in
// src/shared/i18n-*.ts. Used by the i18n test (which side each string is on) and by edition-guard.mjs.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

function sources(dir) {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) && !/\.d\.ts$/.test(f) ? [p] : []
  })
}
const unquote = s => s.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
const T_CALL = /\bt\('((?:[^'\\\n]|\\.)*)'/g
const JAPANESE = /[぀-ヿ一-鿿＀-￯]/ // kana, kanji and the full-width forms ("M.PASS（! -）")

// key → { public: files that show it in the sold edition too, internal: files that show it in the internal one only }
export function editionStrings(src) {
  const out = new Map()
  const at = k => out.get(k) ?? (out.set(k, { public: [], internal: [] }), out.get(k))
  for (const f of sources(src)) {
    const file = relative(src, f).split(sep).join('/')
    const whole = file.startsWith('internal/')
    let depth = 0 // > 0: inside a block opened on a line with __INTERNAL__
    for (const line of readFileSync(f, 'utf-8').split('\n')) {
      const marked = line.includes('__INTERNAL__')
      const inside = whole || depth > 0 || marked
      for (const m of line.matchAll(T_CALL)) {
        const s = unquote(m[1])
        if (JAPANESE.test(s)) at(s)[inside ? 'internal' : 'public'].push(file)
      }
      const opens = (line.match(/\{/g) ?? []).length, closes = (line.match(/\}/g) ?? []).length
      if (depth > 0) depth = Math.max(0, depth + opens - closes)
      else if (marked && /\{\s*(\/\/.*)?$/.test(line)) depth = Math.max(0, opens - closes)
    }
  }
  return out
}

// The strings only the internal edition shows.
export const internalOnly = src => [...editionStrings(src)].filter(([, w]) => !w.public.length).map(([k]) => k)
