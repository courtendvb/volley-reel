import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from './i18n-en'
import { ES } from './i18n-es'
import { setLang, t } from './i18n'

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

describe('Spanish interface', () => {
  const holes = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(',')
  it('has a Spanish string for every Japanese string shown', () => {
    const missing = [...interfaceStrings()].filter(([s]) => !(s in ES)).map(([s, f]) => `${f}: ${s}`)
    expect(missing).toEqual([])
  })
  it('has the same {0}, {1}… as the English', () => {
    const off = Object.keys(ES).filter(k => k in EN && holes(ES[k]) !== holes(EN[k]))
    expect(off).toEqual([])
  })
  it('keeps no string the English no longer has', () => {
    expect(Object.keys(ES).filter(k => !(k in EN))).toEqual([])
  })
  it('looks strings up in Spanish, falling back to English', () => {
    try {
      setLang('es')
      expect(t('保存済み')).toBe(ES['保存済み'])
      expect(t('__not_a_key__')).toBe('__not_a_key__')
    } finally { setLang('ja') }
  })
})
