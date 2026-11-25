// The court grid's on/off and 濃さ at the right of the tabs under the video, whichever tab is open, so
// they are at hand next to the picture. The same settings as in 表示 > コートの準備; the grid's on/off is
// the video's, its 濃さ the project's.
import type { GridStyle } from '../../../shared/court'
import { t } from '../../../shared/i18n'

export function GridQuick({ style: s, onStyle }: { style: GridStyle; onStyle: (s: GridStyle) => void }) {
  return (
    <span className="grid-quick">
      <label className="check" title={t('動画のコートにグリッドを重ねる（書き出しも同じ）。色・太さ・出す範囲は「表示」>「コートの準備」')}>
        <input type="checkbox" checked={s.grid} onChange={e => onStyle({ ...s, grid: e.target.checked })} /> {t('グリッド')}
      </label>
      <input type="range" min={0.1} max={1} step={0.05} value={s.opacity} disabled={!s.grid} aria-label={t('グリッドの濃さ')}
        title={t('グリッドの濃さ（プロジェクトのどの動画でも同じ）')} onChange={e => onStyle({ ...s, opacity: +e.target.value })} />
      <span className="grid-quick-pct">{Math.round(s.opacity * 100)}%</span>
    </span>
  )
}
