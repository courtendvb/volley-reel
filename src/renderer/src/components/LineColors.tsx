import { CHART_EFFECTS, usualLineColor, usualPointColor } from '../../../shared/chart'
import { EFFECTS } from '../../../shared/labels'
import { t } from '../../../shared/i18n'
import { PaletteColor } from './PaletteColor'

// A colour by evaluation (# + ! - / =), for a chart's lines or its points, picked from the palette.
// value: the colours set; the rest show the usual ones.
export function LineColors({ value, skill, of = 'line', onChange }: { value: Record<string, string> | undefined; skill: 'A' | 'S'; of?: 'line' | 'point'; onChange: (v: Record<string, string>) => void }) {
  return (
    <span className="line-colors">
      {CHART_EFFECTS.map(e => {
        const label = `${e} ${EFFECTS[skill][e]}`, usual = of === 'line' ? usualLineColor(e, skill) : usualPointColor(e)
        return (
          <label key={e} className="check" title={label}>{e}
            <PaletteColor value={value?.[e] ?? usual} label={t('{0} の色', label)} onChange={c => onChange({ ...value, [e]: c })} />
          </label>
        )
      })}
    </span>
  )
}
