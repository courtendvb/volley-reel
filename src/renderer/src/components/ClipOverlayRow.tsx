import { useEffect, useState } from 'react'
import { THEME_PRESETS, type Anchor, type ClipOverlayOverride, type OverlaySettings } from '../../../shared/overlay'

interface Props {
  override: ClipOverlayOverride | undefined
  overlay: OverlaySettings // the video's settings: the scoreboard position and the colors are set here too
  onOverlay: (s: OverlaySettings) => void
  autoName: string
  autoLine: string
  onChange: (o: ClipOverlayOverride | undefined) => void
}

// Per-clip exceptions to the reel's overlay settings: hide an element, or rewrite the caption.
const SB_POSITIONS: [Anchor, string][] = [['tl', '左上'], ['tc', '中央上'], ['tr', '右上']]

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
      <span className="field-label">自動表示</span>
      <label className="check"><input type="checkbox" checked={!o?.scoreboard?.hidden}
        onChange={e => write({ ...o, scoreboard: { hidden: !e.target.checked } })} /> スコアボード</label>
      <select className="ov-pos" aria-label="スコアボードの位置（動画全体）" title="スコアボードの位置（この動画のすべてのクリップ）" value={s.scoreboard.anchor}
        onChange={e => onOverlay({ ...s, scoreboard: { ...s.scoreboard, anchor: e.target.value as Anchor } })}>
        {SB_POSITIONS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
        {!SB_POSITIONS.some(([a]) => a === s.scoreboard.anchor) && <option value={s.scoreboard.anchor}>下</option>}
      </select>
      <label className="check"><input type="checkbox" checked={!o?.playerCaption?.hidden}
        onChange={e => write({ ...o, playerCaption: { ...o?.playerCaption, hidden: !e.target.checked } })} /> テロップ</label>
      <input className="ov-text" value={name} placeholder={autoName} aria-label="テロップの名前（空欄で自動）"
        onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      <input className="ov-text wide" value={line} placeholder={autoLine} aria-label="テロップの2行目（空欄で自動）"
        onChange={e => setLine(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      <span className="spacer" />
      <span className="ov-gear-wrap">
        <button className="ov-gear" aria-label="色とタイトルカードの秒数" aria-expanded={gear} title="色とタイトルカードの秒数（動画全体）" onClick={() => setGear(g => !g)}>⚙</button>
        {gear && (
          <div className="ov-gear-pop" role="dialog" aria-label="色とタイトルカード">
            <div className="ov-presets">
              {THEME_PRESETS.map(p => (
                <button key={p.name} title={p.name} aria-label={p.name}
                  className={`ov-preset${p.theme.base === s.theme.base && p.theme.accent === s.theme.accent ? ' on' : ''}`}
                  onClick={() => onOverlay({ ...s, theme: p.theme })}>
                  <span style={{ background: p.theme.base }} /><span style={{ background: p.theme.accent }} />
                </button>
              ))}
            </div>
            <div className="filter-row">
              <label className="check">ベース <input type="color" value={s.theme.base} onChange={e => onOverlay({ ...s, theme: { ...s.theme, base: e.target.value.toUpperCase() } })} /></label>
              <label className="check">アクセント <input type="color" value={s.theme.accent} onChange={e => onOverlay({ ...s, theme: { ...s.theme, accent: e.target.value.toUpperCase() } })} /></label>
            </div>
            <label className="check">タイトルカード（シーン・マーカー）
              <input type="number" min={1} max={8} step={0.5} value={s.titleCard.durationSec} aria-label="タイトルカードの秒数（一括）"
                onChange={e => { const n = parseFloat(e.target.value); if (n >= 1 && n <= 8) onOverlay({ ...s, titleCard: { ...s.titleCard, durationSec: n } }) }} /> 秒</label>
          </div>
        )}
      </span>
    </div>
  )
}
