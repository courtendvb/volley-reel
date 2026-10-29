// The interface language. Strings are written in Japanese in the code and looked up here for
// English: t('保存済み') → 'Saved'. {0}, {1}… stand for values: t('{0} 本', n). A string with no
// English yet shows in Japanese, so a missed one is visible rather than blank.
// The renderer and the main process each set the language once at start (src/renderer/src/lang.ts,
// src/main/index.ts); changing it in 設定 restarts the window.
import { EN } from './i18n-en'

export type Lang = 'ja' | 'en'
export const LANGS: { id: Lang; name: string }[] = [{ id: 'ja', name: '日本語' }, { id: 'en', name: 'English' }]

let lang: Lang = 'ja'
export function setLang(l: Lang): void { lang = l === 'en' ? 'en' : 'ja' }
export function getLang(): Lang { return lang }

export function t(ja: string, ...args: (string | number | null | undefined)[]): string {
  const s = lang === 'en' ? EN[ja] ?? ja : ja
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[+i] === undefined || args[+i] === null ? '' : String(args[+i]))) : s
}
