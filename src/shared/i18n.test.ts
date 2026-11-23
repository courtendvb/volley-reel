import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN as SHARED_EN } from './i18n-en'
import { ES as SHARED_ES } from './i18n-es'
import { INTERNAL_EN } from '../internal/i18n-en'
import { INTERNAL_ES } from '../internal/i18n-es'
// @ts-expect-error a plain script, shared with the build's check (scripts/edition-guard.mjs)
import { editionStrings } from '../../scripts/edition-strings.mjs'
import { setLang, t } from './i18n'

// Both editions' strings (the tests run the internal edition's code too: vitest.config.ts).
const EN = { ...SHARED_EN, ...INTERNAL_EN }
const ES = { ...SHARED_ES, ...INTERNAL_ES }

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

// The sold edition carries shared/i18n-*.ts only: a string only the internal edition shows goes in
// internal/i18n-*.ts, so its words aren't in the sold app (src/internal/README.md).
describe('the editions\' strings', () => {
  const where = editionStrings(join(__dirname, '..')) as Map<string, { public: string[]; internal: string[] }>
  it('keeps the strings only the internal edition shows out of the shared dictionaries', () => {
    const misplaced = [...where].filter(([k, w]) => !w.public.length && (k in SHARED_EN || k in SHARED_ES)).map(([k, w]) => `${w.internal[0]}: ${k}`)
    expect(misplaced).toEqual([])
  })
  it('has the sold edition\'s strings in the shared dictionaries', () => {
    const missing = [...where].filter(([k, w]) => w.public.length && (k in INTERNAL_EN || k in INTERNAL_ES)).map(([k, w]) => `${w.public[0]}: ${k}`)
    expect(missing).toEqual([])
  })
  it('has the same strings in both internal dictionaries', () => {
    expect(Object.keys(INTERNAL_ES).sort()).toEqual(Object.keys(INTERNAL_EN).sort())
  })
})
