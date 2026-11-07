import { CHART_EFFECTS, lineColor, type ChartLook } from '../../../shared/chart'
import { EFFECTS } from '../../../shared/labels'
import { t } from '../../../shared/i18n'

// A colour for the chart's lines by evaluation: # + ! - / =.
export function LineColors({ look, skill = 'A', onChange }: { look: Pick<ChartLook, 'colors' | 'lineColors'>; skill?: 'A' | 'S'; onChange: (lineColors: Record<string, string>) => void }) {
  return (
    <span className="line-colors">
      <span className="field-label">{t('線の色')}</span>
      {CHART_EFFECTS.map(e => {
        const label = `${e} ${EFFECTS[skill][e]}`
        return (
          <label key={e} className="check" title={label}>{e}
            <input type="color" aria-label={t('{0} の色', label)} value={lineColor(look, e, skill)} onChange={ev => onChange({ ...look.lineColors, [e]: ev.target.value.toUpperCase() })} />
          </label>
        )
      })}
    </span>
  )
}
