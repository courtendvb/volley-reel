import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from 'react'
import { Accordion } from './Accordion'
import { bounds, drawAnnotation, shiftTimes, type Annotation } from '../../../shared/annotation'
import { assetImage, subscribeAssets } from '../assets'
import {
  addPaletteCategory, lockPaletteItem, movePaletteCategory, movePaletteItem, removePaletteCategory, removePaletteItem, renamePaletteCategory,
  savePaletteItem, setPaletteItemCategory, usePalette, usePaletteItem,
} from '../palette'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'

const DT_ITEM = 'application/x-vr-palette-item'
const DT_TAB = 'application/x-vr-palette-tab'
const ALL = 'all' // the すべて tab: every item; saving there leaves the item without a category

// Saved objects to reuse (in the library, so every project has them): save the selection (with its
// group) under a name, put a saved one on the clip or card, or drop it. Folds away under its header,
// or floats over the app (⧉) to be moved and sized for a wide view. Tabs sort items into categories.
// Show / hide times are kept relative to the clip's IN, so a saved object appears and leaves at the
// same moments in whichever clip it is put on (on a title card it shows the whole time).
export function PalettePanel(p: {
  selection: Annotation[] // what "save" stores (the selected objects and their groups)
  onUse: (anns: Annotation[]) => void
  disabled: boolean
  clipIn: number | null // the active clip's IN (null: a title card is being edited)
  float?: { onDock: () => void } // always floating (the edit mode, with the side columns away); docking leaves it
}) {
  const palette = usePalette()
  const [floating, setFloating] = useState(() => load('vr.paletteFloating') === '1')
  useEffect(() => keep('vr.paletteFloating', floating ? '1' : '0'), [floating])
  const badge = palette.items.length ? t('{0} 個', palette.items.length) : undefined
  if (p.float) return <FloatingPanel title={t('パレット')} onDock={p.float.onDock} dockTitle={t('編集モードを終えて、右の列に戻す')}><PaletteBody {...p} wide onFloat={null} /></FloatingPanel>
  if (!floating) {
    return <Accordion id="palette" icon="◧" title={t('パレット')} badge={badge}><PaletteBody {...p} wide={false} onFloat={() => setFloating(true)} /></Accordion>
  }
  return (
    <>
      <Accordion id="palette" icon="◧" title={t('パレット')} badge={badge}>
        <p className="muted small">{t('パレットは浮かせて表示しています')} <button className="link" onClick={() => setFloating(false)}>{t('ここに戻す')}</button></p>
      </Accordion>
      <FloatingPanel title={t('パレット')} onDock={() => setFloating(false)}>
        <PaletteBody {...p} wide onFloat={null} />
      </FloatingPanel>
    </>
  )
}

function PaletteBody({ selection, onUse, disabled, clipIn, wide, onFloat }: Parameters<typeof PalettePanel>[0] & { wide: boolean; onFloat: (() => void) | null }) {
  const palette = usePalette()
  const cats = palette.categories ?? []
  const [tab, setTab] = useState(() => load('vr.paletteTab') ?? ALL)
  const current = tab === ALL || cats.some(c => c.id === tab) ? tab : ALL // a removed tab falls back to すべて
  useEffect(() => keep('vr.paletteTab', current), [current])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null) // where a dragged item will land
  const [overTab, setOverTab] = useState<string | null>(null) // the tab a dragged item would move to
  const [tabAt, setTabAt] = useState<{ id: string; after: boolean } | null>(null) // where a dragged tab will land
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  const save = () => run(async () => {
    const clean = selection.map(a => shiftTimes(a, clipIn === null ? null : -clipIn))
    await savePaletteItem(name || defaultName(selection), clean, current === ALL ? null : current)
    setName('')
  })
  const addTab = () => run(async () => {
    const after = await addPaletteCategory(t('カテゴリ {0}', cats.length + 1))
    const made = after.categories?.[after.categories.length - 1]
    if (made) { setTab(made.id); setRenaming(made.id) }
  })
  const shown = current === ALL ? palette.items : palette.items.filter(it => it.category === current)
  const count = (id: string) => palette.items.filter(it => it.category === id).length
  // Dropped on a tab: the item moves to that category (すべて: none).
  // A dragged tab lands before (left half) or after (right half) the one it is dropped on; すべて stays first.
  const tabDrop = (id: string) => ({
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (e.dataTransfer.types.includes(DT_ITEM)) { e.preventDefault(); setOverTab(id) }
      else if (e.dataTransfer.types.includes(DT_TAB) && id !== ALL) {
        e.preventDefault()
        const b = e.currentTarget.getBoundingClientRect()
        setTabAt({ id, after: e.clientX > b.left + b.width / 2 })
      }
    },
    onDragLeave: () => { setOverTab(t => (t === id ? null : t)); setTabAt(t => (t?.id === id ? null : t)) },
    onDrop: (e: DragEvent<HTMLElement>) => {
      const item = e.dataTransfer.getData(DT_ITEM), tabId = e.dataTransfer.getData(DT_TAB)
      const after = tabAt?.id === id && tabAt.after
      setOverTab(null); setDropAt(null); setTabAt(null)
      if (item) void run(() => setPaletteItemCategory(item, id === ALL ? null : id))
      else if (tabId && id !== ALL) {
        const from = cats.findIndex(c => c.id === tabId), slot = cats.findIndex(c => c.id === id) + (after ? 1 : 0)
        if (from < 0 || from === slot || from + 1 === slot) return
        void run(() => movePaletteCategory(tabId, from < slot ? slot - 1 : slot))
      }
    },
  })

  return (
    <div className={`palette-body${wide ? ' wide' : ''}`}>
      <div className="ann-row">
        {disabled ? <span className="muted small">{t('クリップかタイトルカードを開くと、入れたり保存したりできます')}</span> : selection.length > 0 ? (
          <>
            <input className="palette-name" value={name} placeholder={defaultName(selection)} aria-label={t('パレットに保存する名前')} disabled={disabled || busy}
              onChange={e => setName(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !composing(e)) void save() }} />
            <button disabled={disabled || busy} onClick={() => void save()}
              title={t('選んだ図形（グループごと）をパレットに保存{0}。ほかのプロジェクトでも使えます', current === ALL ? '' : t('（「{0}」に）', cats.find(c => c.id === current)?.name))}>{t('選択を保存')}</button>
          </>
        ) : <span className="muted small">{t('図形を選ぶと、パレットに保存できます（どのプロジェクトからも使えます）')}</span>}
        <span className="spacer" />
        {onFloat && <button className="link" onClick={onFloat} title={t('パレットを画面の上に浮かせて、広く使う（動かす・大きさを変える）')}>{t('⧉ 浮かせる')}</button>}
      </div>

      <div className="palette-tabs" role="tablist" aria-label={t('パレットのカテゴリ')}>
        {[{ id: ALL, name: t('すべて') }, ...cats].map(c => (
          <span key={c.id} role="tab" aria-selected={current === c.id} className={`palette-tab${current === c.id ? ' on' : ''}${overTab === c.id ? ' drop-into' : ''}${tabAt?.id === c.id ? (tabAt.after ? ' drop-after' : ' drop-before') : ''}`}
            title={c.id === ALL ? t('すべてのアイテム（ここに落とすとカテゴリから外す）') : t('ダブルクリックで名前を変える。ドラッグで並べ替え。アイテムをここに落とすとこのカテゴリへ')}
            draggable={c.id !== ALL && renaming !== c.id}
            onDragStart={e => { e.dataTransfer.setData(DT_TAB, c.id); e.dataTransfer.effectAllowed = 'move' }}
            onDragEnd={() => setTabAt(null)}
            onClick={() => setTab(c.id)} onDoubleClick={() => { if (c.id !== ALL) setRenaming(c.id) }} {...tabDrop(c.id)}>
            {renaming === c.id ? (
              <input className="palette-tab-name" autoFocus defaultValue={c.name} aria-label={t('カテゴリの名前')} onClick={e => e.stopPropagation()}
                onFocus={e => e.currentTarget.select()}
                onBlur={e => { setRenaming(null); const v = e.currentTarget.value; if (v.trim() && v !== c.name) void run(() => renamePaletteCategory(c.id, v)) }}
                onKeyDown={e => { if (e.key === 'Enter' && !composing(e)) e.currentTarget.blur(); else if (e.key === 'Escape') { e.currentTarget.value = c.name; e.currentTarget.blur() } }} />
            ) : (
              <>{c.name}<span className="palette-tab-count">{c.id === ALL ? palette.items.length : count(c.id)}</span></>
            )}
            {c.id !== ALL && current === c.id && !count(c.id) && renaming !== c.id && (
              <button className="link palette-tab-remove" aria-label={t('カテゴリ「{0}」を削除', c.name)} title={t('空のカテゴリを削除')}
                onClick={e => { e.stopPropagation(); void run(() => removePaletteCategory(c.id)) }}>×</button>
            )}
          </span>
        ))}
        <button className="link palette-tab-add" disabled={busy} onClick={() => void addTab()} title={t('カテゴリ（タブ）を足す')}>＋</button>
      </div>

      {shown.length > 0 && (
        <div className="palette-items" onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null) }}>
          {shown.map(it => (
            // Drag an item onto another to put it before (left half) or after (right half) that one,
            // or onto a tab to move it to that category.
            <span key={it.id} draggable className={`palette-item${dropAt?.id === it.id ? (dropAt.after ? ' drop-after' : ' drop-before') : ''}`}
              title={t('{0}（クリックで入れる・ドラッグで並べ替え、タブに落とすとそのカテゴリへ）', it.name)}
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
                // Positions in the whole list (a tab shows part of it).
                const from = palette.items.findIndex(x => x.id === id), slot = palette.items.findIndex(x => x.id === it.id) + (after ? 1 : 0)
                if (from < 0 || from === slot || from + 1 === slot) return
                void run(() => movePaletteItem(id, from < slot ? slot - 1 : slot)) // counted without the moved one
              }}
              onDragEnd={() => { setDropAt(null); setOverTab(null) }}>
              <button className="palette-use" disabled={disabled || busy} aria-label={t('{0} を入れる', it.name)}
                onClick={() => void run(async () => onUse((await usePaletteItem(it.id)).map(a => shiftTimes(a, clipIn))))}>
                <Thumb annotations={it.annotations} big={wide} /><span className="palette-label">{it.name}</span>
              </button>
              <button className={`palette-lock${it.locked ? ' on' : ''}`} aria-pressed={!!it.locked} aria-label={t('{0} を保護', it.name)} disabled={busy}
                title={it.locked ? t('保護中: 外せません（クリックで保護をやめる）') : t('保護する（誤って外さないように）')}
                onClick={() => void run(() => lockPaletteItem(it.id, !it.locked))}>{it.locked ? '🔒' : '🔓'}</button>
              {!it.locked && <button className="link" aria-label={t('{0} をパレットから外す', it.name)} disabled={busy} onClick={() => void run(() => removePaletteItem(it.id))}>×</button>}
            </span>
          ))}
        </div>
      )}
      {!shown.length && <p className="muted small">{palette.items.length ? t('このカテゴリにはまだありません（アイテムをタブに落とすと移せます）') : t('まだ何も保存されていません')}</p>}
    </div>
  )
}

// A panel floating over the app: dragged by its header, sized from its corner (both remembered),
// kept inside the window. ▾ folds it to its header (remembered too), out of the way of the picture.
function FloatingPanel({ title, onDock, dockTitle, children }: { title: string; onDock: () => void; dockTitle?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState(() => {
    const saved = (() => { try { return JSON.parse(load('vr.paletteRect') ?? 'null') as { x: number; y: number; w: number; h: number } | null } catch { return null } })()
    return fit(saved ?? { x: window.innerWidth - 760, y: 120, w: 640, h: 420 })
  })
  useEffect(() => keep('vr.paletteRect', JSON.stringify(rect)), [rect])
  const [folded, setFolded] = useState(() => load('vr.paletteFolded') === '1')
  useEffect(() => keep('vr.paletteFolded', folded ? '1' : '0'), [folded])
  const foldedRef = useRef(folded)
  foldedRef.current = folded
  // The corner handle is the browser's own (CSS resize); its size is read back when it changes.
  useEffect(() => {
    const el = box.current
    if (!el) return
    // Folded, its height is the header's alone: the size it unfolds to stays as it was.
    const ro = new ResizeObserver(() => { if (!foldedRef.current) setRect(r => (r.w === el.offsetWidth && r.h === el.offsetHeight ? r : { ...r, w: el.offsetWidth, h: el.offsetHeight })) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { const f = () => setRect(r => fit(r)); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [])
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y }
  }
  const move = (e: PointerEvent<HTMLDivElement>) => { const d = drag.current; if (d) setRect(r => fit({ ...r, x: e.clientX - d.dx, y: e.clientY - d.dy })) }
  return (
    <div ref={box} className={`floating-panel${folded ? ' folded' : ''}`} role="dialog" aria-label={title} style={{ left: rect.x, top: rect.y, width: rect.w, ...(folded ? {} : { height: rect.h }) }}>
      <div className="floating-head" onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null }} onDoubleClick={() => setFolded(f => !f)}
        title={t('ドラッグで動かす（右下の角で大きさを変える。ダブルクリックでたたむ）')}>
        <button className="link floating-fold" aria-expanded={!folded} onClick={() => setFolded(f => !f)} title={folded ? t('開く') : t('たたむ')}>{folded ? '▸' : '▾'}</button>
        <span className="accordion-icon" aria-hidden>◧</span><b>{title}</b>
        <span className="spacer" />
        <button className="link" onClick={onDock} title={dockTitle ?? t('右の列に戻す')}>{t('⧉ 戻す')}</button>
      </div>
      {!folded && <div className="floating-body">{children}</div>}
    </div>
  )
}

// Inside the window, at least 320 × 200.
function fit(r: { x: number; y: number; w: number; h: number }) {
  const w = Math.max(320, Math.min(r.w, window.innerWidth - 16)), h = Math.max(200, Math.min(r.h, window.innerHeight - 16))
  return { w, h, x: Math.max(8, Math.min(r.x, window.innerWidth - w - 8)), y: Math.max(8, Math.min(r.y, window.innerHeight - h - 8)) }
}

const load = (k: string): string | null => { try { return localStorage.getItem(k) } catch { return null } }
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* not kept */ } }

function defaultName(sel: Annotation[]): string {
  const txt = sel.find(a => a.kind === 'text')
  return txt && txt.kind === 'text' ? txt.text.slice(0, 16) : sel.length > 1 ? t('図形 {0} 個', sel.length) : t('オブジェクト')
}

// The saved objects scaled to fit a small box (twice as large in the floating palette).
function Thumb({ annotations, big }: { annotations: Annotation[]; big: boolean }) {
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
  }, [annotations, tick, big])
  return <canvas ref={canvas} className={`palette-thumb${big ? ' big' : ''}`} width={big ? 112 : 56} height={big ? 64 : 32} aria-hidden />
}
