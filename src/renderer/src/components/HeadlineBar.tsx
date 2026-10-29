import { applyStyle, type Annotation } from '../../../shared/annotation'
import { playback } from '../playback'
import { textStyle, type AnnStyle } from './AnnotationLayer'
import { composing } from '../keys'

interface Props {
  annotations: Annotation[] // the active clip's objects (merged with its scene's and video's)
  onChange: (list: Annotation[]) => void
  onFormat: (id: string) => void // select the headline so the format panel edits it
  style: AnnStyle
  disabled: boolean
  clipIn: number // the clip's IN: show / hide times are shown in seconds from it
}

// The headline, apart from the object tools: one centered text at the top middle (48 px at 720p),
// kept in step with this field. Typing creates it, clearing the field removes it.
export function HeadlineBar({ annotations, onChange, onFormat, style, disabled, clipIn }: Props) {
  const quick = annotations.find(a => a.kind === 'text' && a.quick) as Extract<Annotation, { kind: 'text' }> | undefined
  // Setting when it shows also selects it, so the timeline below draws its bar to adjust.
  const setTimes = (patch: { showFrom?: number; showTo?: number }) => {
    if (!quick) return
    onChange(annotations.map(a => (a.id === quick.id ? { ...quick, ...patch } : a)))
    onFormat(quick.id)
  }
  const setText = (text: string) => {
    if (!text) { if (quick) onChange(annotations.filter(a => a.id !== quick.id)); return }
    if (quick) { onChange(annotations.map(a => (a.id === quick.id ? { ...quick, text } : a))); return }
    const ts = { ...textStyle(style), size: 48 }
    onChange([...annotations, applyStyle({ id: crypto.randomUUID(), kind: 'text', color: ts.color, x: 0.5, y: 0.05, text, size: 48, align: 'center', quick: true }, ts)])
  }
  return (
    <div className={`headline-bar${disabled ? ' disabled' : ''}`}>
      <label className="field-label" htmlFor="headline">見出し</label>
      <input id="headline" aria-label="見出し" value={quick?.text ?? ''} placeholder="ここに入力すると、動画の中央上部に表示します" disabled={disabled}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === 'Escape') && !composing(e)) e.currentTarget.blur() }} />
      {quick && (
        <span className="headline-times">
          <span className="muted">{quick.showFrom === undefined ? '最初' : `${(quick.showFrom - clipIn).toFixed(1)}秒`} 〜 {quick.showTo === undefined ? '最後' : `${(quick.showTo - clipIn).toFixed(1)}秒`}</span>
          <button disabled={disabled} title="今の再生位置から見出しを出す（下のバーで調整できる）" onClick={() => setTimes({ showFrom: playback.current.time })}>ここから表示</button>
          <button disabled={disabled} title="今の再生位置で見出しを消す（下のバーで調整できる）" onClick={() => setTimes({ showTo: playback.current.time })}>ここで消す</button>
          {(quick.showFrom !== undefined || quick.showTo !== undefined) && (
            <button className="link" disabled={disabled} title="クリップの最初から最後まで出す"
              onClick={() => { const { showFrom: _f, showTo: _t, ...rest } = quick; onChange(annotations.map(a => (a.id === quick.id ? rest as Annotation : a))) }}>全体</button>
          )}
        </span>
      )}
      {quick && <button className="link" onClick={() => onFormat(quick.id)} title="書式（色・サイズ・枠・表示範囲）を変える">書式</button>}
    </div>
  )
}
