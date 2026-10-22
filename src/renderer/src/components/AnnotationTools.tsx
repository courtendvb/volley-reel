import type { ReactNode } from 'react'
import {
  COLORS, DEFAULT_TEXT_BOX, applyStyle, hasFill, isPoints,
  type Annotation, type Dash, type Heads, type StylePatch, type TextBox,
} from '../../../shared/annotation'
import { MAX_EDIT_POINTS, setClosed, simplify, toPolygon } from '../../../shared/annotationEdit'
import { playback } from '../playback'
import type { AnnStyle, Tool } from './AnnotationLayer'

interface Props {
  tool: Tool
  onTool: (t: Tool) => void
  style: AnnStyle
  onStyle: (s: AnnStyle) => void
  annotations: Annotation[]
  selectedId: string | null
  editPoints: boolean
  onEditPoints: (on: boolean) => void
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[]) => void
  onInsertImage: () => void
  clip: { in: number; out: number }
  disabled: boolean // during through-play
}

const TOOLS: [Tool, string, string, string][] = [
  ['select', '選択', 'V', '選択・移動・頂点の編集'], ['text', 'T', 'T', 'テキスト'], ['arrow', '↗', 'A', '矢印'],
  ['circle', '○', 'C', '円'], ['rect', '□', 'R', '四角'], ['triangle', '△', 'G', '三角形'], ['polyline', '⌇', 'L', '折れ線（クリックで頂点）'],
  ['polygon', '⬠', 'P', '多角形（クリックで頂点）'], ['freehand', '✎', 'F', 'フリーハンド'],
]
const KIND_LABEL: Record<Annotation['kind'], string> = {
  text: 'テキスト', arrow: '矢印', circle: '円', rect: '四角', freehand: 'フリーハンド', polyline: '折れ線', polygon: '多角形', image: '画像',
}

// Format panel in the spirit of Office's shape format pane: line, fill and text for the selected
// object — or, with nothing selected, for the next one drawn — plus show/hide timing.
export function AnnotationTools(p: Props) {
  const sel = p.annotations.find(a => a.id === p.selectedId) ?? null
  const update = (a: Annotation) => p.onChange(p.annotations.map(x => (x.id === a.id ? a : x)))
  const set = (patch: StylePatch) => {
    if (sel) update(applyStyle(sel, patch))
    else p.onStyle({ ...p.style, ...patch } as AnnStyle)
  }

  // What the controls show: the selection's values with the old-look defaults filled in.
  const kind = sel?.kind ?? (p.tool === 'select' ? null : p.tool === 'triangle' ? 'polygon' : p.tool)
  const v = {
    color: sel?.color ?? p.style.color,
    width: sel && 'width' in sel ? sel.width : p.style.width,
    size: sel?.kind === 'text' ? sel.size : p.style.size,
    dash: (sel ? sel.dash : p.style.dash) ?? 'solid',
    opacity: (sel ? sel.opacity : p.style.opacity) ?? 1,
    fill: sel && hasFill(sel) ? (sel as { fill?: string | null }).fill ?? null : p.style.fill ?? null,
    fillOpacity: sel && hasFill(sel) ? (sel as { fillOpacity?: number }).fillOpacity ?? 1 : p.style.fillOpacity ?? 1,
    heads: (sel?.kind === 'arrow' ? sel.heads : p.style.heads) ?? 'end',
    bold: (sel?.kind === 'text' ? sel.bold : p.style.bold) ?? true,
    outline: (sel?.kind === 'text' ? sel.outline : p.style.outline) ?? true,
    box: (sel?.kind === 'text' ? sel.box : p.style.box) ?? null,
  }
  const lineKinds = kind === null || (kind !== 'text' && kind !== 'image')
  const fillKinds = kind === null || kind === 'rect' || kind === 'circle' || kind === 'polygon'
  const textKinds = kind === null || kind === 'text'
  const setBox = (patch: Partial<TextBox>) => set({ box: { ...(v.box ?? DEFAULT_TEXT_BOX), ...patch } })
  const rel = (t: number | undefined, fallback: string) => (t === undefined ? fallback : `${(t - p.clip.in).toFixed(1)}秒`)

  return (
    <div className={`ann-tools${p.disabled ? ' disabled' : ''}`}>
      <div className="ann-row">
        <div className="segmented" role="radiogroup" aria-label="注釈ツール">
          {TOOLS.map(([t, label, key, title]) => (
            <button key={t} role="radio" aria-checked={p.tool === t} className={p.tool === t ? 'on' : ''} title={`${title} (${key})`}
              onClick={() => p.onTool(t)} disabled={p.disabled}>{label}</button>
          ))}
        </div>
        <button onClick={p.onInsertImage} disabled={p.disabled} title="画像ファイルか PDF（1ページ目）を動画の上に置く">画像・PDF…</button>
        {sel && sel.kind !== 'text' && sel.kind !== 'arrow' && sel.kind !== 'image' && (
          <button className={p.editPoints ? 'on' : ''} aria-pressed={p.editPoints} disabled={p.disabled}
            title="頂点をドラッグして形を変える。辺の中点を引くと頂点が増え、頂点をダブルクリックで消せます。四角・円は多角形になります。"
            onClick={() => {
              if (!p.editPoints && (sel.kind === 'rect' || sel.kind === 'circle')) update(toPolygon(sel))
              p.onEditPoints(!p.editPoints)
            }}>頂点の編集</button>
        )}
        <span className="muted small">{sel ? `${KIND_LABEL[sel.kind]}${sel.kind === 'text' ? `「${sel.text}」` : ''} を編集中` : '次に描く図形の書式'}</span>
      </div>

      <div className="fmt-grid">
        {lineKinds && (
          <Group title={kind === 'rect' || kind === 'circle' || kind === 'polygon' ? '枠線' : '線'}>
            <ColorPick label="線の色" value={v.color} onChange={color => set({ color })} disabled={p.disabled} />
            <Num label="太さ" value={v.width} min={0} max={30} step={1} onChange={width => set({ width })} disabled={p.disabled} />
            <select aria-label="線の種類" value={v.dash} onChange={e => set({ dash: e.target.value as Dash })} disabled={p.disabled}>
              <option value="solid">実線</option><option value="dash">破線</option><option value="dot">点線</option>
            </select>
            {(kind === null || kind === 'arrow') && (
              <select aria-label="矢印の先" value={v.heads} onChange={e => set({ heads: e.target.value as Heads })} disabled={p.disabled}>
                <option value="end">矢印: 終点</option><option value="both">矢印: 両端</option><option value="none">矢印: なし</option>
              </select>
            )}
          </Group>
        )}
        {fillKinds && (
          <Group title="塗り">
            <label className="check"><input type="checkbox" checked={!!v.fill} aria-label="塗りつぶす" disabled={p.disabled}
              onChange={e => set({ fill: e.target.checked ? v.fill ?? '#FACC15' : null })} /> 塗る</label>
            {v.fill && <ColorPick label="塗りの色" value={v.fill} onChange={fill => set({ fill })} disabled={p.disabled} />}
            {v.fill && <Pct label="塗りの透明度" value={1 - v.fillOpacity} onChange={t => set({ fillOpacity: 1 - t })} disabled={p.disabled} />}
          </Group>
        )}
        {textKinds && (
          <Group title="テキスト">
            <ColorPick label="文字の色" value={v.color} onChange={color => set({ color })} disabled={p.disabled} />
            <Num label="サイズ" value={v.size} min={10} max={160} step={2} onChange={size => set({ size })} disabled={p.disabled} />
            <label className="check"><input type="checkbox" checked={v.bold} onChange={e => set({ bold: e.target.checked })} disabled={p.disabled} /> 太字</label>
            <label className="check"><input type="checkbox" checked={v.outline} onChange={e => set({ outline: e.target.checked })} disabled={p.disabled} /> 縁取り</label>
            <label className="check"><input type="checkbox" checked={!!v.box} aria-label="枠付き" disabled={p.disabled}
              onChange={e => set({ box: e.target.checked ? { ...DEFAULT_TEXT_BOX } : null })} /> 枠付き</label>
          </Group>
        )}
        {textKinds && v.box && (
          <Group title="文字の枠">
            <label className="check"><input type="checkbox" checked={!!v.box.fill} aria-label="枠を塗る" disabled={p.disabled}
              onChange={e => setBox({ fill: e.target.checked ? '#0F172A' : null })} /> 塗る</label>
            {v.box.fill && <ColorPick label="枠の塗り" value={v.box.fill} onChange={fill => setBox({ fill })} disabled={p.disabled} />}
            {v.box.fill && <Pct label="枠の透明度" value={1 - v.box.fillOpacity} onChange={t => setBox({ fillOpacity: 1 - t })} disabled={p.disabled} />}
            <label className="check"><input type="checkbox" checked={!!v.box.stroke} aria-label="枠線" disabled={p.disabled}
              onChange={e => setBox({ stroke: e.target.checked ? '#FFFFFF' : null })} /> 枠線</label>
            {v.box.stroke && <ColorPick label="枠線の色" value={v.box.stroke} onChange={stroke => setBox({ stroke })} disabled={p.disabled} />}
            {v.box.stroke && <Num label="枠線の太さ" value={v.box.strokeWidth} min={1} max={20} step={1} onChange={strokeWidth => setBox({ strokeWidth })} disabled={p.disabled} />}
            <Num label="余白" value={v.box.padding} min={0} max={60} step={2} onChange={padding => setBox({ padding })} disabled={p.disabled} />
          </Group>
        )}
        <Group title="全体">
          <Pct label="透明度" value={1 - v.opacity} onChange={t => set({ opacity: 1 - t })} disabled={p.disabled} />
          {sel && isPoints(sel) && sel.points.length > MAX_EDIT_POINTS && (
            <button onClick={() => update(simplify(sel, 2, 1280, 720))} title="形を保ったまま点を減らし、頂点を編集できるようにする">点を減らす（{sel.points.length}点）</button>
          )}
          {sel && (sel.kind === 'polyline' || sel.kind === 'freehand') && sel.points.length >= 3 && (
            <button onClick={() => update(setClosed(sel, true))} title="始点と終点をつないで多角形にする">閉じる</button>
          )}
          {sel?.kind === 'polygon' && <button onClick={() => update(setClosed(sel, false))} title="多角形を折れ線に戻す">開く</button>}
        </Group>
      </div>

      <div className="ann-row">
        {sel ? (
          <>
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
            {p.annotations.length ? `注釈 ${p.annotations.length} 個。選択ツールでクリックすると選べます。つまみで大きさを変え、「頂点の編集」で頂点を動かせます。` : '動画の上をドラッグして描きます。折れ線・多角形はクリックで頂点を置きます。'}
            表示時刻の「秒」はクリップの IN からの値です。
          </span>
        )}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="fmt-group"><span className="fmt-title">{title}</span><div className="fmt-body">{children}</div></div>
}

function ColorPick({ label, value, onChange, disabled }: { label: string; value: string; onChange: (c: string) => void; disabled: boolean }) {
  return (
    <span className="ann-swatches" role="radiogroup" aria-label={label}>
      {COLORS.map(c => (
        <button key={c} role="radio" aria-checked={value.toUpperCase() === c} aria-label={`${label} ${c}`} className={`ann-swatch${value.toUpperCase() === c ? ' on' : ''}`}
          style={{ background: c }} onClick={() => onChange(c)} disabled={disabled} />
      ))}
      <input type="color" aria-label={`${label}（自由に選ぶ）`} value={value.length === 7 ? value : '#FFFFFF'} onChange={e => onChange(e.target.value.toUpperCase())} disabled={disabled} />
    </span>
  )
}

function Num({ label, value, min, max, step, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <label className="check">{label}
      <input type="number" aria-label={label} value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={e => { const n = parseFloat(e.target.value); if (isFinite(n)) onChange(Math.max(min, Math.min(max, n))) }} />
    </label>
  )
}

// Transparency as Office shows it: 0% = solid, 100% = invisible.
function Pct({ label, value, onChange, disabled }: { label: string; value: number; onChange: (t: number) => void; disabled: boolean }) {
  return (
    <label className="check fmt-pct">{label}
      <input type="range" aria-label={label} min={0} max={100} step={5} value={Math.round(value * 100)} disabled={disabled}
        onChange={e => onChange(+e.target.value / 100)} />
      <span>{Math.round(value * 100)}%</span>
    </label>
  )
}
