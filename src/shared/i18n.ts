// The interface language. Strings are written in Japanese in the code and looked up here for
// English and Spanish: t('保存済み') → 'Saved' / 'Guardado'. {0}, {1}… stand for values: t('{0} 本', n). A string with no
// English yet shows in Japanese, so a missed one is visible rather than blank; one with no Spanish
// yet shows in English.
// The renderer and the main process each set the language once at start (src/renderer/src/lang.ts,
// src/main/index.ts); changing it in 設定 restarts the window.
import { EN as SHARED_EN } from './i18n-en'
import { ES as SHARED_ES } from './i18n-es'
import { INTERNAL_EN } from '../internal/i18n-en'
import { INTERNAL_ES } from '../internal/i18n-es'

// The team's own features' strings (src/internal/i18n-*.ts) are kept with their code.
const EN = { ...SHARED_EN, ...INTERNAL_EN }
const ES = { ...SHARED_ES, ...INTERNAL_ES }

export type Lang = 'ja' | 'en' | 'es'
export const LANGS: { id: Lang; name: string }[] = [{ id: 'ja', name: '日本語' }, { id: 'en', name: 'English' }, { id: 'es', name: 'Español' }]

let lang: Lang = 'ja'
export function setLang(l: Lang): void { lang = l === 'en' || l === 'es' ? l : 'ja' }
export function getLang(): Lang { return lang }
export const isLang = (l: unknown): l is Lang => l === 'ja' || l === 'en' || l === 'es'
// Text made in another language than the interface's (a video's headlines): the language is
// switched for the call and back.
export function inLang<T>(l: Lang, f: () => T): T {
  const was = lang
  setLang(l)
  try { return f() } finally { lang = was }
}

// For a label that starts a line on its own (a tab, a field name, a button): the translation
// with its first letter capitalised, where the same word is lowercase inside a sentence
// (t('シーン') is "scene" in "Couldn't save the scene" but "Scene" on its tab). Japanese is unchanged.
export function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export function t(ja: string, ...args: (string | number | null | undefined)[]): string {
  const s = lang === 'en' ? EN[ja] ?? ja : lang === 'es' ? ES[ja] ?? EN[ja] ?? ja : ja
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] === undefined || args[+i] === null ? '' : String(args[+i]))) : s
}
