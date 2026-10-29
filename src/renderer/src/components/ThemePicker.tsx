import { THEME_PRESETS, type OverlayTheme } from '../../../shared/overlay'
import { t } from '../../../shared/i18n'

// Overlay colors: a preset, or base and accent picked freely.
export function ThemePicker({ value, onChange }: { value: OverlayTheme; onChange: (t: OverlayTheme) => void }) {
  return (
    <>
      <div className="ov-presets">
        {THEME_PRESETS.map(p => (
          <button key={p.name} title={p.name} aria-label={p.name}
            className={`ov-preset${p.theme.base === value.base && p.theme.accent === value.accent ? ' on' : ''}`}
            onClick={() => onChange(p.theme)}>
            <span style={{ background: p.theme.base }} /><span style={{ background: p.theme.accent }} />
          </button>
        ))}
      </div>
      <div className="filter-row">
        <label className="check">{t('ベース')} <input type="color" value={value.base} onChange={e => onChange({ ...value, base: e.target.value.toUpperCase() })} /></label>
        <label className="check">{t('アクセント')} <input type="color" value={value.accent} onChange={e => onChange({ ...value, accent: e.target.value.toUpperCase() })} /></label>
      </div>
    </>
  )
}
