import { useEffect, useState } from 'react'
import { type Anchor, type ClipOverlayOverride, type OverlaySettings } from '../../../shared/overlay'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

interface Props {
  override: ClipOverlayOverride | undefined
  overlay: OverlaySettings // the video's settings: the scoreboard position and the colors are set here too
  onOverlay: (s: OverlaySettings) => void
  autoName: string
  autoLine: string
  onChange: (o: ClipOverlayOverride | undefined) => void
}

// Per-clip exceptions to the reel's overlay settings: hide an element, or rewrite the caption.
const SB_POSITIONS: [Anchor, string][] = [['tl', t('左上')], ['tc', t('中央上')], ['tr', t('右上')]]

export function ClipOverlayRow({ override: o, overlay: s, onOverlay, autoName, autoLine, onChange }: Props) {
  const [gear, setGear] = useState(false)
  const [name, setName] = useState(o?.playerCaption?.name ?? '')
  const [line, setLine] = useState(o?.playerCaption?.line ?? '')
  useEffect(() => { setName(o?.playerCaption?.name ?? ''); setLine(o?.playerCaption?.line ?? '') }, [o])

  const write = (next: ClipOverlayOverride) => {
    const sb = next.scoreboard?.hidden ? { hidden: true } : undefined
    const pc = next.playerCaption
    const cap = pc && (pc.hidden || pc.name || pc.line) ? { ...(pc.hidden ? { hidden: true } : {}), ...(pc.name ? { name: pc.name } : {}), ...(pc.line ? { line: pc.line } : {}) } : undefined
    onChange(sb || cap ? { ...(sb ? { scoreboard: sb } : {}), ...(cap ? { playerCaption: cap } : {}) } : undefined)
  }
  const commit = () => write({ ...o, playerCaption: { ...o?.playerCaption, name: name.trim() || undefined, line: line.trim() || undefined } })

  return (
    <div className="ann-row clip-overlay">
      <span className="field-label">{t('自動表示')}</span>
      {/* On for the clip and the video: ticking it while the video has the scoreboard off turns it on for the video. */}
      <label className="check"><input type="checkbox" checked={s.scoreboard.enabled && !o?.scoreboard?.hidden}
        onChange={e => {
          if (e.target.checked && !s.scoreboard.enabled) onOverlay({ ...s, scoreboard: { ...s.scoreboard, enabled: true } })
          write({ ...o, scoreboard: { hidden: !e.target.checked } })
        }} /> {t('スコアボード')}</label>
      <select className="ov-pos" aria-label={t('スコアボードの位置（動画全体）')} title={t('スコアボードの位置（この動画のすべてのクリップ）')} value={s.scoreboard.anchor}
        onChange={e => onOverlay({ ...s, scoreboard: { ...s.scoreboard, anchor: e.target.value as Anchor } })}>
        {SB_POSITIONS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
        {!SB_POSITIONS.some(([a]) => a === s.scoreboard.anchor) && <option value={s.scoreboard.anchor}>{t('下')}</option>}
      </select>
      <label className="check"><input type="checkbox" checked={!o?.playerCaption?.hidden}
        onChange={e => write({ ...o, playerCaption: { ...o?.playerCaption, hidden: !e.target.checked } })} /> {t('テロップ')}</label>
      <label className="check" title={t('コートのグリッドとプレーのゾーンを書き出しに入れる（この動画のすべてのクリップ。見た目は動画の下の「コート」の設定。コートを合わせた試合だけ）')}>
        <input type="checkbox" checked={s.court.enabled} onChange={e => onOverlay({ ...s, court: { enabled: e.target.checked } })} /> {t('コート（書き出し）')}</label>
      <input className="ov-text" value={name} placeholder={autoName} aria-label={t('テロップの名前（空欄で自動）')}
        onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter' && !composing(e)) commit() }} />
      <input className="ov-text wide" value={line} placeholder={autoLine} aria-label={t('テロップの2行目（空欄で自動）')}
        onChange={e => setLine(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter' && !composing(e)) commit() }} />
      <span className="spacer" />
      <span className="ov-gear-wrap">
        <button className="ov-gear" aria-label={t('タイトルカードとフェード')} aria-expanded={gear} title={t('タイトルカードの秒数とフェード（動画全体）。配色は上部の「設定」')} onClick={() => setGear(g => !g)}>⚙</button>
        {gear && (
          <div className="ov-gear-pop" role="dialog" aria-label={t('タイトルカード')}>
            <label className="check">{t('タイトルカード（シーン・マーカー）')}
              <input type="number" min={1} max={8} step={0.5} value={s.titleCard.durationSec} aria-label={t('タイトルカードの秒数（一括）')}
                onChange={e => { const n = parseFloat(e.target.value); if (n >= 1 && n <= 8) onOverlay({ ...s, titleCard: { ...s.titleCard, durationSec: n } }) }} /> {t('秒')}</label>
            <label className="check"><input type="checkbox" checked={s.transition.fade} aria-label={t('フェード')}
              onChange={e => onOverlay({ ...s, transition: { ...s.transition, fade: e.target.checked } })} /> {t('クリップとカードの切り替えでフェード（イン・アウト）')}</label>
            {s.transition.fade && (
              <label className="check">{t('フェードの秒数')}
                <input type="number" min={0.1} max={2} step={0.1} value={s.transition.durationSec} aria-label={t('フェードの秒数')}
                  onChange={e => { const n = parseFloat(e.target.value); if (n >= 0.1 && n <= 2) onOverlay({ ...s, transition: { ...s.transition, durationSec: n } }) }} /> {t('秒')}</label>
            )}
            <span className="hint">{t('配色はプロジェクト全体の設定です（上部の「設定」）')}</span>
          </div>
        )}
      </span>
    </div>
  )
}
