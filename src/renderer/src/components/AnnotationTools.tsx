import { COLORS, TEXT_SIZES, WIDTHS, applyStyle, type Annotation } from '../../../shared/annotation'
import { playback } from '../playback'
import type { AnnStyle, Tool } from './AnnotationLayer'

interface Props {
  tool: Tool
  onTool: (t: Tool) => void
  style: AnnStyle
  onStyle: (s: AnnStyle) => void
  annotations: Annotation[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[]) => void
  clip: { in: number; out: number }
  disabled: boolean // during through-play
}

const TOOLS: [Tool, string, string][] = [
  ['select', '選択', 'V'], ['text', 'T', 'T'], ['arrow', '↗', 'A'], ['circle', '○', 'C'], ['rect', '□', 'R'], ['freehand', '✎', 'F'],
]
const KIND_LABEL: Record<Annotation['kind'], string> = { text: 'テキスト', arrow: '矢印', circle: '円', rect: '四角', freehand: 'フリーハンド' }

export function AnnotationTools(p: Props) {
  const sel = p.annotations.find(a => a.id === p.selectedId) ?? null
  const update = (a: Annotation) => p.onChange(p.annotations.map(x => (x.id === a.id ? a : x)))
  // A style pick applies to the selection too, and becomes the style for the next shape.
  const pick = (patch: Partial<AnnStyle>) => {
    p.onStyle({ ...p.style, ...patch })
    if (sel) update(applyStyle(sel, patch))
  }
  const cur = sel ? { color: sel.color, width: sel.kind === 'text' ? p.style.width : sel.width, size: sel.kind === 'text' ? sel.size : p.style.size } : p.style
  const rel = (t: number | undefined, fallback: string) => (t === undefined ? fallback : `${(t - p.clip.in).toFixed(1)}秒`)

  return (
    <div className={`ann-tools${p.disabled ? ' disabled' : ''}`}>
      <div className="ann-row">
        <div className="segmented" role="radiogroup" aria-label="注釈ツール">
          {TOOLS.map(([t, label, key]) => (
            <button key={t} role="radio" aria-checked={p.tool === t} className={p.tool === t ? 'on' : ''} title={`${t === 'select' ? '選択・移動' : KIND_LABEL[t as Annotation['kind']]} (${key})`}
              onClick={() => p.onTool(t)} disabled={p.disabled}>{label}</button>
          ))}
        </div>
        <span className="ann-swatches" role="radiogroup" aria-label="色">
          {COLORS.map(c => (
            <button key={c} role="radio" aria-checked={cur.color === c} aria-label={c} className={`ann-swatch${cur.color === c ? ' on' : ''}`}
              style={{ background: c }} onClick={() => pick({ color: c })} disabled={p.disabled} />
          ))}
        </span>
        <span className="ann-group" aria-label="線の太さ">
          {WIDTHS.map(w => (
            <button key={w} className={cur.width === w ? 'on' : ''} title={`線 ${w}px`} onClick={() => pick({ width: w })} disabled={p.disabled}>
              <span className="ann-line" style={{ height: Math.max(1, w / 2) }} />
            </button>
          ))}
        </span>
        <span className="ann-group" aria-label="文字サイズ">
          {TEXT_SIZES.map((s, i) => (
            <button key={s} className={cur.size === s ? 'on' : ''} title={`文字 ${s}px`} onClick={() => pick({ size: s })} disabled={p.disabled}>
              {['小', '中', '大'][i]}
            </button>
          ))}
        </span>
      </div>

      <div className="ann-row">
        {sel ? (
          <>
            <span className="ann-sel">{KIND_LABEL[sel.kind]}{sel.kind === 'text' ? `「${sel.text}」` : ''}</span>
            <span className="muted">表示 {rel(sel.showFrom, '最初')} 〜 {rel(sel.showTo, '最後')}</span>
            <button onClick={() => update({ ...sel, showFrom: playback.current.time })} title="今の再生位置から表示する">ここから表示</button>
            <button onClick={() => update({ ...sel, showTo: playback.current.time })} title="今の再生位置で消す">ここで消す</button>
            {(sel.showFrom !== undefined || sel.showTo !== undefined) && (
              <button className="link" onClick={() => { const { showFrom: _f, showTo: _t, ...rest } = sel; update(rest as Annotation) }}>クリップ全体で表示</button>
            )}
            <span className="spacer" />
            <button onClick={() => { p.onChange(p.annotations.filter(a => a.id !== sel.id)); p.onSelect(null) }} title="削除 (Delete)">削除</button>
          </>
        ) : (
          <span className="hint">
            {p.annotations.length ? `注釈 ${p.annotations.length} 個。選択ツールでクリックすると選べます（ダブルクリックでテキスト編集）。` : '動画の上をドラッグして描きます。テキストはクリックした位置に入力します。'}
            表示時刻は「秒」がクリップの IN からの値です。
          </span>
        )}
      </div>
    </div>
  )
}
