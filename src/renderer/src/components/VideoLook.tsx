import { useEffect, useState, type CSSProperties } from 'react'
import { cleanLook, LOOK_MAX, LOOK_MIN, lookSvg, type VideoLook } from '../../../shared/videoLook'
import { useAnchoredPop } from './anchoredPop'
import { t } from '../../../shared/i18n'

// The match's picture correction on the <video> (shared/videoLook.ts): an SVG filter doing the export's
// maths, in sRGB like ffmpeg. `id` must be unique on the page (one per <video> shown).
export function LookFilter({ id, look }: { id: string; look: VideoLook | null | undefined }) {
  const p = lookSvg(look)
  if (!p) return null
  return (
    <svg className="look-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
        {p.gamma !== 1 && (
          <feComponentTransfer>
            <feFuncR type="gamma" amplitude={1} exponent={p.gamma} offset={0} />
            <feFuncG type="gamma" amplitude={1} exponent={p.gamma} offset={0} />
            <feFuncB type="gamma" amplitude={1} exponent={p.gamma} offset={0} />
          </feComponentTransfer>
        )}
        {p.slope !== 1 && (
          <feComponentTransfer>
            <feFuncR type="linear" slope={p.slope} intercept={p.intercept} />
            <feFuncG type="linear" slope={p.slope} intercept={p.intercept} />
            <feFuncB type="linear" slope={p.slope} intercept={p.intercept} />
          </feComponentTransfer>
        )}
        {p.sat !== 1 && <feColorMatrix type="saturate" values={String(p.sat)} />}
      </filter>
    </svg>
  )
}

// The <video>'s style for the filter above (none when the look changes nothing).
export function lookStyle(id: string, look: VideoLook | null | undefined): CSSProperties | undefined {
  return cleanLook(look) ? { filter: `url(#${id})` } : undefined
}

const ROWS: { key: keyof VideoLook; label: () => string }[] = [
  { key: 'brightness', label: () => t('明るさ') },
  { key: 'contrast', label: () => t('コントラスト') },
  { key: 'saturation', label: () => t('彩度') },
]

// The ☀ button by the video: sliders for the match's picture, kept with the match and used by every export.
export function LookButton({ look, onLook }: { look: VideoLook | undefined; onLook: (look: VideoLook | null) => void }) {
  const [open, setOpen] = useState(false)
  const pop = useAnchoredPop<HTMLSpanElement>(open, 'above-right')
  const on = !!cleanLook(look)
  useEffect(() => {
    if (!open) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])
  return (
    <span className="look-wrap" ref={pop.anchor}>
      <button className={`look-btn${on ? ' on' : ''}`} aria-expanded={open} aria-label={t('映像の補正')} onClick={() => setOpen(o => !o)}
        title={t('映像の補正: 暗い動画を明るくするなど。この試合の動画すべてに効き、書き出しにも入ります')}>☀</button>
      {open && (
        <div className="look-pop" style={pop.style} role="dialog" aria-label={t('映像の補正')}>
          <div className="look-head">{t('映像の補正（この試合）')}</div>
          {ROWS.map(r => {
            const v = look?.[r.key] ?? 0
            return (
              <label key={r.key} className="look-row">
                <span className="look-label">{r.label()}</span>
                <input type="range" min={LOOK_MIN} max={LOOK_MAX} step={1} value={v} aria-label={r.label()}
                  onChange={e => onLook({ ...look, [r.key]: +e.target.value })}
                  onDoubleClick={() => onLook({ ...look, [r.key]: 0 })} />
                <span className="look-val">{v > 0 ? `+${v}` : v}</span>
              </label>
            )
          })}
          <div className="look-foot">
            <span className="look-hint">{t('書き出しにも同じ補正が入ります')}</span>
            <button className="link" disabled={!on} onClick={() => onLook(null)}>{t('元に戻す')}</button>
          </div>
        </div>
      )}
    </span>
  )
}
