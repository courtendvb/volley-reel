import { COLS, ROWS, ZONE_NUMBERS } from '../../../shared/court'
import { t } from '../../../shared/i18n'

interface Props {
  start: number[]
  end: number[]
  onStart: (zones: number[]) => void
  onEnd: (zones: number[]) => void
}

// The two halves of the court as the app's grid has them, from the starting side: left stays left, so
// a line shot runs straight from one to the other. Any number of zones in each; none means any.
export function ZoneCourts({ start, end, onStart, onEnd }: Props) {
  const half = ROWS / 2
  return (
    <div className="zone-courts">
      <Half name={t('始点')} rows={ZONE_NUMBERS.slice(half)} net="top" title={t('始点のゾーン。複数選べます。上がネット')} selected={start} onChange={onStart} />
      <Half name={t('終点')} rows={ZONE_NUMBERS.slice(0, half)} net="bottom" title={t('終点のゾーン。複数選べます。下がネット')} selected={end} onChange={onEnd} />
    </div>
  )
}

function Half({ name, rows, net, title, selected, onChange }: {
  name: string; rows: number[][]; net: 'top' | 'bottom'; title: string; selected: number[]; onChange: (zones: number[]) => void
}) {
  const toggle = (z: number) => onChange(selected.includes(z) ? selected.filter(x => x !== z) : [...selected, z])
  return (
    <div className="zone-court" role="group" aria-label={t('{0}のゾーン', name)} title={title}>
      <span className="zone-court-name">{name}</span>
      <div className={`zone-grid net-${net}`} style={{ gridTemplateColumns: `repeat(${COLS}, 32px)` }}>
        {rows.flat().map(z => (
          <button key={z} className={selected.includes(z) ? 'on' : ''} aria-pressed={selected.includes(z)} onClick={() => toggle(z)}>{z}</button>
        ))}
      </div>
    </div>
  )
}
