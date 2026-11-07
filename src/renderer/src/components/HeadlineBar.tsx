import { DEFAULT_TEXT_BOX, HEADLINE_SIZE, applyStyle, type Annotation, type HeadlineStyle } from '../../../shared/annotation'
import { playback } from '../playback'
import { textStyle, type AnnStyle } from './AnnotationLayer'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

interface Props {
  annotations: Annotation[] // the active clip's objects (merged with its scene's and video's)
  onChange: (list: Annotation[]) => void
  onFormat: (id: string) => void // select the headline so the format panel edits it
  style: AnnStyle
  headline?: HeadlineStyle // the project's look for new headlines (設定)
  disabled: boolean
  clipIn: number // the clip's IN: show / hide times are shown in seconds from it
  compact?: boolean // beside the tabs: the field and 書式 only (its times are on the timelines under 編集 and 図形)
}

// The headline, apart from the object tools: one centered text at the top middle (48 px at 720p unless 設定 says otherwise),
// kept in step with this field. Typing creates it, clearing the field removes it.
export function HeadlineBar({ annotations, onChange, onFormat, style, headline: h = {}, disabled, clipIn, compact }: Props) {
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
    const ts = { ...textStyle(style), size: h.size ?? HEADLINE_SIZE, ...(h.color ? { color: h.color } : {}), ...(h.bold !== undefined ? { bold: h.bold } : {}),
      ...(h.outline !== undefined ? { outline: h.outline } : {}), ...(h.box ? { box: { ...DEFAULT_TEXT_BOX, fill: h.box } } : {}) }
    onChange([...annotations, applyStyle({ id: crypto.randomUUID(), kind: 'text', color: ts.color, x: 0.5, y: 0.05, text, size: ts.size, align: 'center', quick: true, ...(h.font ? { font: h.font } : {}) }, ts)])
  }
  return (
    <div className={`headline-bar${disabled ? ' disabled' : ''}`}>
      <label className="field-label" htmlFor="headline">{t('見出し')}</label>
      <input id="headline" aria-label={t('見出し')} value={quick?.text ?? ''} placeholder={t('ここに入力すると、動画の中央上部に表示します')} disabled={disabled}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === 'Escape') && !composing(e)) e.currentTarget.blur() }} />
      {quick && !compact && (
        <span className="headline-times">
          <span className="muted">{quick.showFrom === undefined ? t('最初') : t('{0}秒', (quick.showFrom - clipIn).toFixed(1))} {t('〜')} {quick.showTo === undefined ? t('最後') : t('{0}秒', (quick.showTo - clipIn).toFixed(1))}</span>
          <button disabled={disabled} title={t('今の再生位置から見出しを出す（下のバーで調整できる）')} onClick={() => setTimes({ showFrom: playback.current.time })}>{t('ここから表示')}</button>
          <button disabled={disabled} title={t('今の再生位置で見出しを消す（下のバーで調整できる）')} onClick={() => setTimes({ showTo: playback.current.time })}>{t('ここで消す')}</button>
          {(quick.showFrom !== undefined || quick.showTo !== undefined) && (
            <button className="link" disabled={disabled} title={t('クリップの最初から最後まで出す')}
              onClick={() => { const { showFrom: _f, showTo: _t, ...rest } = quick; onChange(annotations.map(a => (a.id === quick.id ? rest as Annotation : a))) }}>{t('全体')}</button>
          )}
        </span>
      )}
      {quick && <button className="link" onClick={() => onFormat(quick.id)} title={t('書式（色・サイズ・枠・表示範囲）を変える')}>{t('書式')}</button>}
    </div>
  )
}
