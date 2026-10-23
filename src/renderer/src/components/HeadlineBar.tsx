import { applyStyle, type Annotation } from '../../../shared/annotation'
import { textStyle, type AnnStyle } from './AnnotationLayer'

interface Props {
  annotations: Annotation[] // the active clip's objects (merged with its scene's and video's)
  onChange: (list: Annotation[]) => void
  onFormat: (id: string) => void // select the headline so the format panel edits it
  style: AnnStyle
  disabled: boolean
}

// The headline, apart from the object tools: one centered text at the top middle (48 px at 720p),
// kept in step with this field. Typing creates it, clearing the field removes it.
export function HeadlineBar({ annotations, onChange, onFormat, style, disabled }: Props) {
  const quick = annotations.find(a => a.kind === 'text' && a.quick) as Extract<Annotation, { kind: 'text' }> | undefined
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
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur() }} />
      {quick && <button className="link" onClick={() => onFormat(quick.id)} title="書式（色・サイズ・枠・表示範囲）を変える">書式</button>}
    </div>
  )
}
