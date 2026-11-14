import { useEffect, useState } from 'react'
import { t } from '../../../shared/i18n'
import type { Slide } from '../../../shared/reel'

// Picking which of a scene's slides go into a PowerPoint file: a small picture of each, in the
// scene's order, all ticked at first. They are saved in that order, one to a slide.
export function SlidePickDialog({ slides, current, thumbs, onSave, onClose }: {
  slides: Slide[]
  current: string // the slide open when this was asked for
  thumbs: (slides: Slide[]) => Promise<Uint8Array[]> // JPEGs
  onSave: (slides: Slide[]) => Promise<void>
  onClose: () => void
}) {
  const [picked, setPicked] = useState(() => new Set(slides.map(s => s.id)))
  const [urls, setUrls] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // As data: URLs (the page's policy allows no blob: pictures); they are small.
  useEffect(() => {
    let gone = false
    void thumbs(slides).then(jpegs => { if (!gone) setUrls(jpegs.map(dataUrl)) }).catch(() => {})
    return () => { gone = true }
  }, [slides])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const chosen = slides.filter(s => picked.has(s.id))
  const save = async () => { setBusy(true); try { await onSave(chosen) } finally { setBusy(false) } }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal slide-pick" role="dialog" aria-label={t('PowerPoint に書き出す')} onClick={e => e.stopPropagation()}>
        <h2>{t('PowerPoint に書き出す')}</h2>
        <p className="hint">{t('書き出すスライドを選んでください。シーンの順に、1 枚ずつ PowerPoint のスライドになります（画像として貼られます）。')}</p>
        <div className="slide-pick-actions">
          <button className="link" onClick={() => setPicked(new Set(slides.map(s => s.id)))}>{t('すべて選ぶ')}</button>
          <button className="link" onClick={() => setPicked(new Set())}>{t('すべて外す')}</button>
          <button className="link" onClick={() => setPicked(new Set([current]))}>{t('開いているスライドだけ')}</button>
          <span className="muted">{t('{0} / {1} 枚', chosen.length, slides.length)}</span>
        </div>
        <div className="slide-pick-grid">
          {slides.map((s, i) => (
            <label key={s.id} className={`slide-pick-item${picked.has(s.id) ? ' on' : ''}${s.id === current ? ' current' : ''}`}>
              {urls[i] ? <img src={urls[i]} alt="" /> : <span className="slide-pick-blank" />}
              <span className="slide-pick-label">
                <input type="checkbox" checked={picked.has(s.id)} onChange={() => toggle(s.id)} aria-label={t('スライド {0}', i + 1)} />
                {i + 1}{s.id === current ? t('（開いている）') : ''}
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>{t('キャンセル')}</button>
          <button className="primary" onClick={() => void save()} disabled={busy || !chosen.length}>
            {busy ? t('書き出しています…') : t('{0} 枚を書き出す…', chosen.length)}</button>
        </div>
      </div>
    </div>
  )
}

function dataUrl(jpeg: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < jpeg.length; i += 0x8000) bin += String.fromCharCode(...jpeg.subarray(i, i + 0x8000))
  return `data:image/jpeg;base64,${btoa(bin)}`
}
