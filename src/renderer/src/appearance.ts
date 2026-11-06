import { t } from '../../shared/i18n'
// The app's own look (not the video overlay colors): light / dark and the accent color.
// Kept on this computer (localStorage), the same in every project.
export type ThemeMode = 'light' | 'dark' | 'system'
export interface Appearance { mode: ThemeMode; accent: string }

export const ACCENTS: { name: string; color: string }[] = [
  { name: t('ブルー'), color: '#4B61D1' },
  { name: t('ティール'), color: '#0D9488' },
  { name: t('グリーン'), color: '#16A34A' },
  { name: t('オレンジ'), color: '#EA580C' },
  { name: t('レッド'), color: '#DC2626' },
  { name: t('パープル'), color: '#7C3AED' },
  { name: t('グレー'), color: '#475569' },
]

const KEY = 'vr.appearance'
const DEFAULT_APPEARANCE: Appearance = { mode: 'system', accent: ACCENTS[0].color }

export function loadAppearance(): Appearance {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Appearance> | null
    return {
      mode: a?.mode === 'light' || a?.mode === 'dark' || a?.mode === 'system' ? a.mode : DEFAULT_APPEARANCE.mode,
      accent: typeof a?.accent === 'string' && /^#[0-9A-Fa-f]{6}$/.test(a.accent) ? a.accent : DEFAULT_APPEARANCE.accent,
    }
  } catch { return DEFAULT_APPEARANCE }
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
let current = DEFAULT_APPEARANCE

function paint(): void {
  const dark = current.mode === 'dark' || (current.mode === 'system' && darkQuery.matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.setProperty('--accent', current.accent)
}

// "System" follows Windows' setting as it changes.
darkQuery.addEventListener('change', () => { if (current.mode === 'system') paint() })

export function applyAppearance(a: Appearance, save = true): void {
  current = a
  paint()
  if (save) try { localStorage.setItem(KEY, JSON.stringify(a)) } catch { /* not kept */ }
}
