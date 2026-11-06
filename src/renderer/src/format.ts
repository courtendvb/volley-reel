import { t } from '../../shared/i18n'

export function formatTime(sec: number, withFrac = false): string {
  if (!isFinite(sec)) sec = 0
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  const base = `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return withFrac ? `${base}.${String(Math.floor((sec - s) * 10))}` : base
}

export const pad2 = (n: number) => String(n).padStart(2, '0')

// A length for people: "2分05秒".
export function formatLength(sec: number): string {
  const s = Math.round(sec)
  return t('{0}分{1}秒', Math.floor(s / 60), pad2(s % 60))
}

// An error from the main process, without Electron's wrapping.
export const errorText = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
