export function formatTime(sec: number, withFrac = false): string {
  if (!isFinite(sec)) sec = 0
  const s = Math.floor(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  const base = `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  return withFrac ? `${base}.${String(Math.floor((sec - s) * 10))}` : base
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
