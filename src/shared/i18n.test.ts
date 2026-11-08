import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from './i18n-en'

// Every Japanese string the code passes to t() as a literal, from the source files.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return sources(p)
    return /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : []
  })
}
const unquote = (s: string) => s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
function interfaceStrings(): Map<string, string> {
  const out = new Map<string, string>()
  const src = join(__dirname, '..')
  for (const f of sources(src)) {
    for (const m of readFileSync(f, 'utf-8').matchAll(/\bt\('((?:[^'\\\n]|\\.)*)'/g)) {
      const s = unquote(m[1])
      if (/[぀-ヿ一-鿿]/.test(s) && !out.has(s)) out.set(s, f.slice(src.length + 1))
    }
  }
  return out
}

describe('English interface', () => {
  it('has an English string for every Japanese string shown', () => {
    const missing = [...interfaceStrings()].filter(([s]) => !(s in EN)).map(([s, f]) => `${f}: ${s}`)
    expect(missing).toEqual([])
  })
})
