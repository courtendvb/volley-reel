import { useEffect, useState } from 'react'
import type { ClipOverlayOverride } from '../../../shared/overlay'

interface Props {
  override: ClipOverlayOverride | undefined
  autoName: string
  autoLine: string
  onChange: (o: ClipOverlayOverride | undefined) => void
}

// Per-clip exceptions to the reel's overlay settings: hide an element, or rewrite the caption.
export function ClipOverlayRow({ override: o, autoName, autoLine, onChange }: Props) {
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
      <label className="check"><input type="checkbox" checked={!o?.playerCaption?.hidden}
        onChange={e => write({ ...o, playerCaption: { ...o?.playerCaption, hidden: !e.target.checked } })} /> テロップ</label>
      <input className="ov-text" value={name} placeholder={autoName} aria-label="テロップの名前（空欄で自動）"
        onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
      <input className="ov-text wide" value={line} placeholder={autoLine} aria-label="テロップの2行目（空欄で自動）"
        onChange={e => setLine(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit() }} />
    </div>
  )
}
