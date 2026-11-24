// The library's matches newest first, as the home screen lists them: by date, the latest at the top;
// matches of one day in the reverse of the library's order (its second match above its first); those
// without a date last. Pure.
import type { Match } from './types'

export function newestFirst<M extends Pick<Match, 'date'>>(ms: M[]): M[] {
  return ms.map((m, i) => ({ m, i }))
    .sort((a, b) => (b.m.date ?? '').localeCompare(a.m.date ?? '') || b.i - a.i)
    .map(x => x.m)
}
