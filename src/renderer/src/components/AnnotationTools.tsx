import type { ReactNode } from 'react'
import {
  COLORS, DEFAULT_TEXT_BOX, applyStyle, boxQuad, hasFill, isPoints, withGroups, withQuad,
  type Annotation, type Dash, type Heads, type StylePatch, type TextBox,
} from '../../../shared/annotation'
import { MAX_EDIT_POINTS, fullRect, setClosed, simplify, toPolygon, zoomCrop } from '../../../shared/annotationEdit'
import { forgetColor, rememberColor, usePalette } from '../palette'
import { playback } from '../playback'
import type { AnnScope } from '../../../shared/annotationScope'
import { courtQuad, type CourtFit, type CourtPart } from '../../../shared/court'
import { textStyle, type AnnStyle, type Tool } from './AnnotationLayer'
import { t } from '../../../shared/i18n'

interface Props {
  tool: Tool
  onTool: (t: Tool) => void
  style: AnnStyle
  onStyle: (s: AnnStyle) => void
  annotations: Annotation[]
  selectedId: string | null
  scopeOf: (id: string) => AnnScope | null
  onScope: (id: string, to: AnnScope) => void
  canVideo: boolean // a video is open, so objects can be put on all of it
  marker?: number | null // the marker group the clip is open in (objects can be put on all of its clips)
  cardMode?: boolean // objects on a title card: no clip timing, no display scope
  extraIds?: string[] // objects picked with Shift+click besides the selected one
  editPoints: boolean
  onEditPoints: (on: boolean) => void
  cropping: boolean
  onCropping: (on: boolean) => void
  onSelect: (id: string | null) => void
  onChange: (list: Annotation[]) => void
  onInsertImage: () => void
  court?: CourtFit['corners'] | null // the clip's match has its court fitted: pictures can be laid on it
  clip: { in: number; out: number }
  disabled: boolean // during through-play
}

const TOOLS: [Tool, string, string, string][] = [
  ['select', t('選択'), 'V', t('選択・移動・頂点の編集')], ['text', 'T', 'T', t('テキスト')], ['arrow', '↗', 'A', t('矢印')],
  ['circle', '○', 'C', t('円')], ['rect', '□', 'R', t('四角')], ['triangle', '△', 'G', t('三角形')], ['polyline', '⌇', 'L', t('折れ線（クリックで頂点）')],
  ['number', '①', '', t('丸付き数字（クリックするごとに 1、2、3…。ダブルクリックで数字を直す）')],
  ['polygon', '⬠', 'P', t('多角形（クリックで頂点）')], ['freehand', '✎', '', t('フリーハンド')], // no key: F and D step through the scene's clips
]
export const KIND_LABEL: Record<Annotation['kind'], string> = {
  text: t('テキスト'), arrow: t('矢印'), circle: t('円'), rect: t('四角'), freehand: t('フリーハンド'), polyline: t('折れ線'), polygon: t('多角形'), image: t('画像'),
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
  const scope = sel ? p.scopeOf(sel.id) ?? 'clip' : 'clip'
  const kind = sel?.kind ?? (p.tool === 'select' ? null : p.tool === 'triangle' ? 'polygon' : p.tool === 'number' ? 'text' : p.tool)
  const v = {
    color: sel?.color ?? p.style.color,
    width: sel && 'width' in sel ? sel.width : p.style.width,
    size: sel?.kind === 'text' ? sel.size : p.style.size,
    dash: (sel ? sel.dash : p.style.dash) ?? 'solid',
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
  const deleteButton = sel && <button onClick={() => { p.onChange(p.annotations.filter(a => a.id !== sel.id)); p.onSelect(null) }} title={t('削除 (Delete)')}>{t('削除')}</button>
  const rel = (at: number | undefined, fallback: string) => (at === undefined ? fallback : t('{0}秒', (at - p.clip.in).toFixed(1)))

  return (
    <div className={`ann-tools${p.disabled ? ' disabled' : ''}`}>
      <div className="ann-row">
        <div className="segmented" role="radiogroup" aria-label={t('注釈ツール')}>
          {TOOLS.map(([t, label, key, title]) => (
            <button key={t} role="radio" aria-checked={p.tool === t} className={p.tool === t ? 'on' : ''} title={key ? `${title} (${key})` : title}
              onClick={() => p.onTool(t)} disabled={p.disabled}>{label}</button>
          ))}
        </div>
        <button onClick={p.onInsertImage} disabled={p.disabled} title={t('画像ファイルか PDF（1ページ目）を動画の上に置く')}>{t('画像・PDF…')}</button>
        {sel && sel.kind !== 'text' && sel.kind !== 'arrow' && sel.kind !== 'image' && (
          <button className={p.editPoints ? 'on' : ''} aria-pressed={p.editPoints} disabled={p.disabled}
            title={t('頂点をドラッグして形を変える。辺の中点を引くと頂点が増え、頂点をダブルクリックで消せます。四角・円は多角形になります。')}
            onClick={() => {
              if (!p.editPoints && (sel.kind === 'rect' || sel.kind === 'circle')) update(toPolygon(sel))
              p.onEditPoints(!p.editPoints)
            }}>{t('頂点の編集')}</button>
        )}
        {sel && (p.extraIds?.length ?? 0) > 0 && (
          <button title={t('選んだ図形をまとめて、一緒に選択・移動できるようにする（Shift+クリックで選び足す）')} disabled={p.disabled}
            onClick={() => {
              const ids = withGroups(p.annotations, [sel.id, ...p.extraIds!]), g = crypto.randomUUID()
              p.onChange(p.annotations.map(a => (ids.includes(a.id) ? { ...a, groupId: g } : a)))
            }}>{t('グループ化')}</button>
        )}
        {sel?.groupId && !(p.extraIds?.length) && (
          <button title={t('グループを解いて、図形を一つずつ扱う')} disabled={p.disabled}
            onClick={() => p.onChange(p.annotations.map(a => {
              if (a.groupId !== sel.groupId) return a
              const { groupId: _g, ...rest } = a
              return rest as Annotation
            }))}>{t('グループ解除')}</button>
        )}
        {sel?.kind === 'image' && (
          <button className={p.cropping ? 'on' : ''} aria-pressed={p.cropping} disabled={p.disabled || !!sel.quad}
            title={sel.quad ? t('遠近をつけた画像はトリミングできません（遠近なしに戻してから）') : t('枠のつまみで切り取る範囲、画像のドラッグで位置、ホイールか ＋／− で拡大・縮小')}
            onClick={() => p.onCropping(!p.cropping)}>{t('トリミング')}</button>
        )}
        {sel?.kind === 'image' && p.cropping && (
          <>
            <button aria-label={t('画像を拡大')} title={t('画像を拡大（枠はそのまま）')} onClick={() => update(zoomCrop(sel, 1.15))}>＋</button>
            <button aria-label={t('画像を縮小')} title={t('画像を縮小（枠より小さくはならない）')} onClick={() => update(zoomCrop(sel, 1 / 1.15))}>−</button>
            {sel.crop && <button className="link" title={t('切り取りをやめて、画像全体を表示する')}
              onClick={() => { const { crop: _c, ...rest } = sel; update({ ...rest, ...fullRect(sel) }) }}>{t('元の画像に戻す')}</button>}
          </>
        )}
        {sel?.kind === 'image' && !p.cropping && (
          <>
            {/* Perspective: the picture's four corners dragged one by one, or laid on the fitted court. */}
            <select className="persp" value={sel.quad ? 'on' : 'off'} disabled={p.disabled} aria-label={t('遠近')}
              title={p.court ? t('画像の四隅を別々に動かして遠近をつけます。コートに合わせると、コートのグリッドの四隅に置きます（先にトリミングで画像をコートの線までにしておくと合います）') : t('画像の四隅を別々に動かして遠近をつけます。コートのグリッドを合わせてあれば、コートにも合わせられます')}
              onChange={e => {
                const v = e.target.value
                if (v === 'off') update(withQuad(sel, null))
                else if (v === 'here') update(withQuad(sel, boxQuad(sel)))
                else if (p.court) update(withQuad(sel, courtQuad(p.court, v as CourtPart)))
              }}>
              <option value="off">{t('遠近なし')}</option>
              {sel.quad ? <option value="on">{t('遠近あり（四隅をドラッグ）')}</option> : <option value="here">{t('遠近をつける（この位置で）')}</option>}
              <option value="full" disabled={!p.court}>{t('コート全体に合わせる')}</option>
              <option value="near" disabled={!p.court}>{t('手前のコートに合わせる')}</option>
              <option value="far" disabled={!p.court}>{t('奥のコートに合わせる')}</option>
            </select>
            {sel.quad && (
              <button disabled={p.disabled} title={t('画像を上下左右逆にする（反対側から見た図のとき）')}
                onClick={() => { const q = sel.quad!; update(withQuad(sel, [q[3], q[2], q[1], q[0]])) }}>{t('180°回転')}</button>
            )}
            <Pct label={t('透明度')} value={1 - (sel.opacity ?? 1)} disabled={p.disabled}
              onChange={x => update(x > 0 ? { ...sel, opacity: Math.round((1 - x) * 100) / 100 } : (({ opacity: _o, ...rest }) => rest)(sel))} />
          </>
        )}
        <span className="muted small">{sel ? t('{0}{1} を編集中', KIND_LABEL[sel.kind], sel.kind === 'text' ? t('「{0}」', sel.text) : '') : t('次に描く図形の書式')}</span>
      </div>

      <div className="fmt-grid">
        {lineKinds && (
          <Group title={kind === 'rect' || kind === 'circle' || kind === 'polygon' ? t('枠線') : t('線')}>
            <ColorPick label={t('線の色')} value={v.color} onChange={color => set({ color })} disabled={p.disabled} />
            <Num label={t('太さ')} value={v.width} min={0} max={30} step={1} onChange={width => set({ width })} disabled={p.disabled} />
            <select aria-label={t('線の種類')} value={v.dash} onChange={e => set({ dash: e.target.value as Dash })} disabled={p.disabled}>
              <option value="solid">{t('実線')}</option><option value="dash">{t('破線')}</option><option value="dot">{t('点線')}</option>
            </select>
            {(kind === null || kind === 'arrow') && (
              <select aria-label={t('矢印の先')} value={v.heads} onChange={e => set({ heads: e.target.value as Heads })} disabled={p.disabled}>
                <option value="end">{t('矢印: 終点')}</option><option value="both">{t('矢印: 両端')}</option><option value="none">{t('矢印: なし')}</option>
              </select>
            )}
            {(kind === 'rect' || kind === 'circle' || kind === 'polygon') && (
              // Fill only: no outline (turns the fill on, so the shape doesn't vanish).
              <label className="check"><input type="checkbox" checked={v.width === 0} aria-label={t('線なし')} disabled={p.disabled}
                onChange={e => set(e.target.checked ? { width: 0, ...(v.fill ? {} : { fill: v.color }) } : { width: 6 })} /> {t('線なし')}</label>
            )}
          </Group>
        )}
        {fillKinds && (
          <Group title={t('塗り')}>
            <label className="check"><input type="checkbox" checked={!!v.fill} aria-label={t('塗りつぶす')} disabled={p.disabled}
              onChange={e => set({ fill: e.target.checked ? v.fill ?? '#EF4444' : null })} /> {t('塗る')}</label>
            {v.fill && <ColorPick label={t('塗りの色')} value={v.fill} onChange={fill => set({ fill })} disabled={p.disabled} />}
            {v.fill && <Pct label={t('塗りの透明度')} value={1 - v.fillOpacity} onChange={t => set({ fillOpacity: 1 - t })} disabled={p.disabled} />}
          </Group>
        )}
        {textKinds && (
          <Group title={t('テキスト')}>
            <ColorPick label={t('文字の色')} value={sel ? v.color : textStyle(p.style).color} disabled={p.disabled}
              onChange={color => (sel ? set({ color }) : p.onStyle({ ...p.style, textColor: color }))} />
            <Num label={t('サイズ')} value={v.size} min={10} max={160} step={2} onChange={size => set({ size })} disabled={p.disabled} />
            <label className="check"><input type="checkbox" checked={v.bold} onChange={e => set({ bold: e.target.checked })} disabled={p.disabled} /> {t('太字')}</label>
            <label className="check"><input type="checkbox" checked={v.outline} onChange={e => set({ outline: e.target.checked })} disabled={p.disabled} /> {t('縁取り')}</label>
            <label className="check"><input type="checkbox" checked={!!v.box} aria-label={t('枠付き')} disabled={p.disabled}
              onChange={e => set({ box: e.target.checked ? { ...DEFAULT_TEXT_BOX } : null })} /> {t('枠付き')}</label>
          </Group>
        )}
        {textKinds && v.box && (
          <Group title={t('文字の枠')}>
            <label className="check"><input type="checkbox" checked={!!v.box.fill} aria-label={t('枠を塗る')} disabled={p.disabled}
              onChange={e => setBox({ fill: e.target.checked ? '#0F172A' : null })} /> {t('塗る')}</label>
            {v.box.fill && <ColorPick label={t('枠の塗り')} value={v.box.fill} onChange={fill => setBox({ fill })} disabled={p.disabled} />}
            {v.box.fill && <Pct label={t('枠の透明度')} value={1 - v.box.fillOpacity} onChange={t => setBox({ fillOpacity: 1 - t })} disabled={p.disabled} />}
            <label className="check"><input type="checkbox" checked={!!v.box.stroke} aria-label={t('枠線')} disabled={p.disabled}
              onChange={e => setBox({ stroke: e.target.checked ? '#FFFFFF' : null })} /> {t('枠線')}</label>
            {v.box.stroke && <ColorPick label={t('枠線の色')} value={v.box.stroke} onChange={stroke => setBox({ stroke })} disabled={p.disabled} />}
            {v.box.stroke && <Num label={t('枠線の太さ')} value={v.box.strokeWidth} min={1} max={20} step={1} onChange={strokeWidth => setBox({ strokeWidth })} disabled={p.disabled} />}
            <Num label={t('余白')} value={v.box.padding} min={0} max={60} step={2} onChange={padding => setBox({ padding })} disabled={p.disabled} />
          </Group>
        )}
        <Group title={t('全体')}>
          {sel && !p.cardMode && (
            <span className="fade-fields" title={t('出るときに透明から、消えるときに透明へ（秒）。0 でなし')}>
              <Num label={t('フェードイン')} value={sel.fadeIn ?? 0} min={0} max={5} step={0.1} disabled={p.disabled}
                onChange={v => { const { fadeIn: _f, ...rest } = sel; update((v > 0 ? { ...rest, fadeIn: v } : rest) as Annotation) }} />
              <Num label={t('アウト')} value={sel.fadeOut ?? 0} min={0} max={5} step={0.1} disabled={p.disabled}
                onChange={v => { const { fadeOut: _f, ...rest } = sel; update((v > 0 ? { ...rest, fadeOut: v } : rest) as Annotation) }} />
              <span className="muted">{t('秒')}</span>
            </span>
          )}
          {sel && !p.cardMode && (
            <select aria-label={t('表示範囲')} value={scope} disabled={p.disabled} className={`scope-${scope}`}
              title={t('このクリップだけ／このマーカーのすべてのクリップ／このシーンのすべてのクリップ／この動画のすべてのクリップ')}
              onChange={e => p.onScope(sel.id, e.target.value as AnnScope)}>
              <option value="clip">{t('表示: このクリップ')}</option>
              {(p.marker || scope === 'marker') && <option value="marker">{t('表示: マーカー全体{0}', p.marker ? t('（{0}）', p.marker) : '')}</option>}
              <option value="scene">{t('表示: シーン全体')}</option>
              {(p.canVideo || scope === 'video') && <option value="video">{t('表示: 動画全体')}</option>}
            </select>
          )}
          {sel && isPoints(sel) && sel.points.length > MAX_EDIT_POINTS && (
            <button onClick={() => update(simplify(sel, 2, 1280, 720))} title={t('形を保ったまま点を減らし、頂点を編集できるようにする')}>{t('点を減らす（')}{sel.points.length}{t('点）')}</button>
          )}
          {sel && (sel.kind === 'polyline' || sel.kind === 'freehand') && sel.points.length >= 3 && (
            <button onClick={() => update(setClosed(sel, true))} title={t('始点と終点をつないで多角形にする')}>{t('閉じる')}</button>
          )}
          {sel?.kind === 'polygon' && <button onClick={() => update(setClosed(sel, false))} title={t('多角形を折れ線に戻す')}>{t('開く')}</button>}
        </Group>
      </div>

      <div className="ann-row">
        {sel && p.cardMode ? (
          <>
            <span className="muted">{t('タイトルカードの上の図形です')}</span>
            <span className="spacer" />
            {deleteButton}
          </>
        ) : sel && scope !== 'clip' ? (
          <>
            <span className="muted">{scope === 'marker' ? t('マーカー {0} のすべてのクリップ', p.marker ?? '') : scope === 'scene' ? t('このシーンのすべてのクリップ') : t('この動画のすべてのクリップ')}{t('で、最初から最後まで表示します')}</span>
            <span className="spacer" />
            {deleteButton}
          </>
        ) : sel ? (
          <>
            <span className="muted">{t('表示')} {rel(sel.showFrom, t('最初'))} {t('〜')} {rel(sel.showTo, t('最後'))}</span>
            <button onClick={() => update({ ...sel, showFrom: playback.current.time })} title={t('今の再生位置から表示する')}>{t('ここから表示')}</button>
            <button onClick={() => update({ ...sel, showTo: playback.current.time })} title={t('今の再生位置で消す')}>{t('ここで消す')}</button>
            {(sel.showFrom !== undefined || sel.showTo !== undefined) && (
              <button className="link" onClick={() => { const { showFrom: _f, showTo: _t, ...rest } = sel; update(rest as Annotation) }}>{t('クリップ全体で表示')}</button>
            )}
            <span className="spacer" />
            {deleteButton}
          </>
        ) : (
          <span className="hint">
            {p.annotations.length ? t('注釈 {0} 個。選択ツールでクリックすると選べます。つまみで大きさを変え、「頂点の編集」で頂点を動かせます。', p.annotations.length) : t('動画の上をドラッグして描きます。折れ線・多角形はクリックで頂点を置きます。')}
            {t('表示時刻の「秒」はクリップの IN からの値です。')}
          </span>
        )}
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <div className="fmt-group"><span className="fmt-title">{title}</span><div className="fmt-body">{children}</div></div>
}

let colorTimer = 0

// The base colors, then my colors (colors picked freely are remembered there, in the library, so
// every project has them; right-click one to drop it), then the free picker.
function ColorPick({ label, value, onChange, disabled }: { label: string; value: string; onChange: (c: string) => void; disabled: boolean }) {
  const mine = usePalette().colors.filter(c => !COLORS.includes(c))
  const swatch = (c: string, own: boolean) => (
    <button key={c} role="radio" aria-checked={value.toUpperCase() === c} aria-label={`${label} ${c}`} className={`ann-swatch${value.toUpperCase() === c ? ' on' : ''}${own ? ' mine' : ''}`}
      style={{ background: c }} onClick={() => onChange(c)} disabled={disabled} title={own ? t('{0}（マイカラー。右クリックで外す）', c) : c}
      onContextMenu={own ? e => { e.preventDefault(); void forgetColor(c) } : undefined} />
  )
  return (
    <span className="ann-swatches" role="radiogroup" aria-label={label}>
      {COLORS.map(c => swatch(c, false))}
      {mine.length > 0 && <span className="swatch-sep" aria-hidden />}
      {mine.map(c => swatch(c, true))}
      <input type="color" aria-label={t('{0}（自由に選ぶ）', label)} value={value.length === 7 ? value : '#FFFFFF'} disabled={disabled}
        title={t('自由に選んだ色はマイカラーに残ります')}
        onChange={e => {
          const c = e.target.value.toUpperCase()
          onChange(c)
          // Remembered once the picker settles (it reports every step while dragging).
          clearTimeout(colorTimer)
          if (!COLORS.includes(c)) colorTimer = window.setTimeout(() => void rememberColor(c), 800)
        }} />
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
