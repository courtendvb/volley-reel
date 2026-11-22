// The interface language. Strings are written in Japanese in the code and looked up here for
// English and Spanish: t('保存済み') → 'Saved' / 'Guardado'. {0}, {1}… stand for values: t('{0} 本', n). A string with no
// English yet shows in Japanese, so a missed one is visible rather than blank; one with no Spanish
// yet shows in English.
// The renderer and the main process each set the language once at start (src/renderer/src/lang.ts,
// src/main/index.ts); changing it in 設定 restarts the window.
import { EN } from './i18n-en'
import { ES } from './i18n-es'

export type Lang = 'ja' | 'en' | 'es'
export const LANGS: { id: Lang; name: string }[] = [{ id: 'ja', name: '日本語' }, { id: 'en', name: 'English' }, { id: 'es', name: 'Español' }]

let lang: Lang = 'ja'
export function setLang(l: Lang): void { lang = l === 'en' || l === 'es' ? l : 'ja' }
export function getLang(): Lang { return lang }

// For a label that starts a line on its own (a tab, a field name, a button): the translation
// with its first letter capitalised, where the same word is lowercase inside a sentence
// (t('シーン') is "scene" in "Couldn't save the scene" but "Scene" on its tab). Japanese is unchanged.
export function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

export function t(ja: string, ...args: (string | number | null | undefined)[]): string {
  const s = lang === 'en' ? EN[ja] ?? ja : lang === 'es' ? ES[ja] ?? EN[ja] ?? ja : ja
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] === undefined || args[+i] === null ? '' : String(args[+i]))) : s
}
