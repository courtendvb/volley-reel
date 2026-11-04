// The numbers behind a search, for a card before the clips: rates per skill from the plays found.
// Pure, so it is unit-tested without the app; the card is ordinary text objects on a slide.
import type { Annotation } from './annotation'
import type { Person, PlayFilter, PlayRef } from './filter'
import { t } from './i18n'

export interface StatLine {
  skill: string
  label: string // "アタック 決定率"
  value: string // "52%", or a count
  detail: string // "26 / 50・効果率 42%"
}

const pct = (n: number, of: number) => `${Math.round((n / of) * 100)}%`

// One line per skill in the plays, the attack first. Sets have none.
export function playStats(refs: PlayRef[]): StatLine[] {
  const count = (skill: string) => {
    const list = refs.filter(r => r.play.skill === skill)
    return { n: list.length, of: (...effects: string[]) => list.filter(r => effects.includes(r.play.effect)).length }
  }
  const out: StatLine[] = []
  const a = count('A')
  if (a.n) {
    const kills = a.of('#'), errors = a.of('='), blocked = a.of('/')
    out.push({ skill: 'A', label: t('アタック 決定率'), value: pct(kills, a.n), detail: t('{0} / {1}・効果率 {2}（ミス {3}・被ブロック {4}）', kills, a.n, pct(kills - errors - blocked, a.n), errors, blocked) })
  }
  const s = count('S')
  if (s.n) {
    const aces = s.of('#'), errors = s.of('=')
    out.push({ skill: 'S', label: t('サーブ 効果率'), value: pct(aces - errors, s.n), detail: t('{0} 本・エース {1}・ミス {2}', s.n, aces, errors) })
  }
  const r = count('R')
  if (r.n) {
    const good = r.of('#', '+')
    out.push({ skill: 'R', label: t('レセプション 成功率'), value: pct(good, r.n), detail: t('{0} / {1}・ミス {2}', good, r.n, r.of('=')) })
  }
  const b = count('B')
  if (b.n) out.push({ skill: 'B', label: t('ブロック 決定'), value: String(b.of('#')), detail: t('{0} 本中', b.n) })
  const d = count('D')
  if (d.n) out.push({ skill: 'D', label: t('ディグ 成功率'), value: pct(d.n - d.of('='), d.n), detail: t('{0} / {1}', d.n - d.of('='), d.n) })
  return out
}

// The search in words, for the card's title. Evaluations are left out: the numbers are about all of them.
export function filterTitle(f: PlayFilter, people: Person[], targetCode: string): string {
  const person = f.person ? people.find(p => p.key === f.person) : null
  const parts = [
    person ? `#${person.jerseys[0]} ${person.name}` : f.team === 'our' ? targetCode : f.team === 'opp' ? t('相手') : '',
    f.sets.length ? t('第 {0} セット', [...f.sets].sort().join('・')) : '',
    f.rots.length ? t('ローテ {0}', [...f.rots].sort().join('・')) : '',
    f.oppRots?.length ? t('相手ローテ {0}', [...f.oppRots].sort().join('・')) : '',
    f.phase === 'reception' ? t('レセプション') : f.phase === 'transition' ? t('トランジション') : '',
    f.dir === 'up' ? t('↑ 下から上') : f.dir === 'down' ? t('↓ 上から下') : '',
  ].filter(Boolean)
  return parts.length ? parts.join('・') : t('すべてのプレー')
}

const MAX_LINES = 3

// The card's objects: the title, and for each line its label, big value and detail.
export function statAnnotations(title: string, lines: StatLine[], newId: () => string = () => crypto.randomUUID()): Annotation[] {
  const text = (x: number, y: number, s: string, size: number, bold = false): Annotation => ({ id: newId(), kind: 'text', color: '#FFFFFF', x, y, text: s, size, bold })
  const out = [text(0.08, 0.12, title, 44, true)]
  lines.slice(0, MAX_LINES).forEach((l, i) => {
    const y = 0.34 + i * 0.2
    out.push(text(0.08, y, l.label, 36), text(0.08, y + 0.07, l.detail, 24), text(0.68, y + 0.04, l.value, 84, true))
  })
  return out
}
