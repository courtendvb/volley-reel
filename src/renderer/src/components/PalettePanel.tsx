import { useEffect, useRef, useState } from 'react'
import { Accordion } from './Accordion'
import { bounds, drawAnnotation, shiftTimes, type Annotation } from '../../../shared/annotation'
import { assetImage, subscribeAssets } from '../assets'
import { lockPaletteItem, movePaletteItem, removePaletteItem, savePaletteItem, usePalette, usePaletteItem } from '../palette'
import { composing } from '../keys'

const DT_ITEM = 'application/x-vr-palette-item'

// Saved objects to reuse (in the library, so every project has them): save the selection (with its
// group) under a name, put a saved one on the clip or card, or drop it. Folds away under its header.
// Show / hide times are kept relative to the clip's IN, so a saved object appears and leaves at the
// same moments in whichever clip it is put on (on a title card it shows the whole time).
export function PalettePanel({ selection, onUse, disabled, clipIn }: {
  selection: Annotation[] // what "save" stores (the selected objects and their groups)
  onUse: (anns: Annotation[]) => void
  disabled: boolean
  clipIn: number | null // the active clip's IN (null: a title card is being edited)
}) {
  const palette = usePalette()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null) // where a dragged item will land
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  const save = () => run(async () => {
    const clean = selection.map(a => shiftTimes(a, clipIn === null ? null : -clipIn))
    await savePaletteItem(name || defaultName(selection), clean)
    setName('')
  })
  return (
    <Accordion id="palette" icon="◧" title="パレット" badge={palette.items.length ? `${palette.items.length} 個` : undefined}>
      <div className="palette-body">
      <div className="ann-row">
        {disabled ? <span className="muted small">クリップかタイトルカードを開くと、入れたり保存したりできます</span> : selection.length > 0 ? (
          <>
            <input className="palette-name" value={name} placeholder={defaultName(selection)} aria-label="パレットに保存する名前" disabled={disabled || busy}
              onChange={e => setName(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !composing(e)) void save() }} />
            <button disabled={disabled || busy} onClick={() => void save()} title="選んだ図形（グループごと）をパレットに保存。ほかのプロジェクトでも使えます">選択を保存</button>
          </>
        ) : <span className="muted small">図形を選ぶと、パレットに保存できます（どのプロジェクトからも使えます）</span>}
      </div>
      {palette.items.length > 0 && (
        <div className="palette-items" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null) }}>
          {palette.items.map((it, i) => (
            // Drag an item onto another to put it before (left half) or after (right half) that one.
            <span key={it.id} draggable className={`palette-item${dropAt?.id === it.id ? (dropAt.after ? ' drop-after' : ' drop-before') : ''}`}
              title={`${it.name}（クリックで入れる・ドラッグで並べ替え）`}
              onDragStart={e => { e.dataTransfer.setData(DT_ITEM, it.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={e => {
                if (!e.dataTransfer.types.includes(DT_ITEM)) return
                e.preventDefault()
                const b = e.currentTarget.getBoundingClientRect()
                setDropAt({ id: it.id, after: e.clientX > b.left + b.width / 2 })
              }}
              onDrop={e => {
                const id = e.dataTransfer.getData(DT_ITEM), after = dropAt?.id === it.id && dropAt.after
                setDropAt(null)
                const from = palette.items.findIndex(x => x.id === id), slot = i + (after ? 1 : 0)
                if (from < 0 || from === slot || from + 1 === slot) return
                void run(() => movePaletteItem(id, from < slot ? slot - 1 : slot)) // counted without the moved one
              }}
              onDragEnd={() => setDropAt(null)}>
              <button className="palette-use" disabled={disabled || busy} aria-label={`${it.name} を入れる`}
                onClick={() => void run(async () => onUse((await usePaletteItem(it.id)).map(a => shiftTimes(a, clipIn))))}>
                <Thumb annotations={it.annotations} /><span className="palette-label">{it.name}</span>
              </button>
              <button className={`palette-lock${it.locked ? ' on' : ''}`} aria-pressed={!!it.locked} aria-label={`${it.name} を保護`} disabled={busy}
                title={it.locked ? '保護中: 外せません（クリックで保護をやめる）' : '保護する（誤って外さないように）'}
                onClick={() => void run(() => lockPaletteItem(it.id, !it.locked))}>{it.locked ? '🔒' : '🔓'}</button>
              {!it.locked && <button className="link" aria-label={`${it.name} をパレットから外す`} disabled={busy} onClick={() => void run(() => removePaletteItem(it.id))}>×</button>}
            </span>
          ))}
        </div>
      )}
      {!palette.items.length && <p className="muted small">まだ何も保存されていません</p>}
      </div>
    </Accordion>
  )
}

function defaultName(sel: Annotation[]): string {
  const t = sel.find(a => a.kind === 'text')
  return t && t.kind === 'text' ? t.text.slice(0, 16) : sel.length > 1 ? `図形 ${sel.length} 個` : 'オブジェクト'
}

// The saved objects scaled to fit a small box.
function Thumb({ annotations }: { annotations: Annotation[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => subscribeAssets(() => setTick(n => n + 1)), [])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    const W = 1280, H = 720
    const bs = annotations.map(a => bounds(ctx, a, W, H))
    if (!bs.length) return
    const x0 = Math.min(...bs.map(b => b.x)) * W, y0 = Math.min(...bs.map(b => b.y)) * H
    const x1 = Math.max(...bs.map(b => b.x + b.w)) * W, y1 = Math.max(...bs.map(b => b.y + b.h)) * H
    const s = Math.min((c.width - 4) / Math.max(1, x1 - x0), (c.height - 4) / Math.max(1, y1 - y0))
    ctx.setTransform(s, 0, 0, s, (c.width - (x1 - x0) * s) / 2 - x0 * s, (c.height - (y1 - y0) * s) / 2 - y0 * s)
    for (const a of annotations) drawAnnotation(ctx, a, W, H, assetImage)
  }, [annotations, tick])
  return <canvas ref={canvas} className="palette-thumb" width={56} height={32} aria-hidden />
}
