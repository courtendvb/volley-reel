import { t } from './i18n'
// A Windows-safe folder name for a project, and the first one not already taken: "name", "name (2)", …

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function folderName(name: string, fallback = t('プロジェクト')): string {
  const s = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_') // characters Windows forbids in a file name
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '') // trailing dots and spaces are dropped by Windows
    .slice(0, 80)
  if (!s) return fallback
  return RESERVED.test(s) ? `_${s}` : s
}

export function uniqueName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base
  for (let n = 2; ; n++) if (!taken(`${base} (${n})`)) return `${base} (${n})`
}
