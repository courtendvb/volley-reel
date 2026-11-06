import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { findPhoto } from '../../../shared/pack'
import { PHOTO_H, PHOTO_W, cropHeight, firstCrop, keepCrop, packManifest, photoFile, playerForFile, type Crop, type RosterPlayer } from '../../../shared/packMaker'
import type { Player } from '../../../shared/types'
import { savePack, usePacks } from '../packs'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'
import { errorText } from '../format'

interface Picture { name: string; image: ImageBitmap; crop: Crop }

const LONGEST = 1600 // big camera files are read down to this: enough for a 600 px photo, and light
const isPicture = (f: File) => /\.(png|jpe?g)$/i.test(f.name) || f.type === 'image/png' || f.type === 'image/jpeg'

async function readPicture(file: File): Promise<Picture> {
  const full = await createImageBitmap(file)
  const k = Math.min(1, LONGEST / Math.max(full.width, full.height))
  const image = k < 1 ? await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: 'high' }) : full
  if (image !== full) full.close()
  return { name: file.name, image, crop: firstCrop(image.width, image.height) }
}

const paint = (ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, p: Picture, w: number, h: number) =>
  ctx.drawImage(p.image, p.crop.x, p.crop.y, p.crop.w, cropHeight(p.crop), 0, 0, w, h)

// A photo as it will be in the pack.
function Shot({ picture, width }: { picture: Picture; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const height = Math.round((width * PHOTO_H) / PHOTO_W)
  useEffect(() => { const c = ref.current?.getContext('2d'); if (c) paint(c, picture, width, height) }, [picture, width, height])
  return <canvas ref={ref} width={width} height={height} />
}

// Makes a .vrpack from the players of the library's matches: photos dropped in find their player by
// file name (HTH_7.jpg), the rest are given by hand, and each is cropped to the same shape.
export function PackMaker({ onClose }: { onClose: () => void }) {
  const packs = usePacks()
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null)
  const [photos, setPhotos] = useState<Record<string, Picture>>({})
  const [loose, setLoose] = useState<Picture[]>([]) // photos no player was found for
  const [picked, setPicked] = useState<number | null>(null) // a loose photo, waiting for a click on a player
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [lacking, setLacking] = useState(false)
  const [rights, setRights] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const forPlayer = useRef<string | null>(null) // the player the file picker is open for

  useEffect(() => { void window.api.packRoster().then(setRoster).catch(e => { setRoster([]); setError(errorText(e)) }) }, [])
  const teams = useMemo(() => [...new Map((roster ?? []).map(p => [p.team, p.teamName])).entries()], [roster])
  const inPack = (p: RosterPlayer) => !!findPhoto(packs, { key: p.key, side: '*', jersey: p.jersey, lastName: p.lastName, firstName: p.firstName } as Player, p.team)
  const shown = (roster ?? []).filter(p => (!team || p.team === team) && (!lacking || !(photos[p.key] || inPack(p))))
  const given = (roster ?? []).filter(p => photos[p.key])

  const add = async (files: File[]) => {
    const pictures = files.filter(isPicture)
    if (!pictures.length) return
    setBusy(true); setError(null); setDone(null)
    const unread: string[] = [], one = forPlayer.current
    forPlayer.current = null
    const found: Record<string, Picture> = {}, rest: Picture[] = []
    for (const f of pictures) {
      try {
        const pic = await readPicture(f), who = one ?? playerForFile(f.name, roster ?? [])?.key
        if (who) found[who] = pic; else rest.push(pic)
      } catch { unread.push(f.name) }
    }
    setPhotos(p => ({ ...p, ...found }))
    setLoose(l => [...l, ...rest])
    if (unread.length) setError(t('読めない写真がありました: {0}', unread.join(', ')))
    setBusy(false)
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); void add([...e.dataTransfer.files]) }

  const clickPlayer = (p: RosterPlayer) => {
    if (picked !== null) {
      const pic = loose[picked]
      setPhotos(x => ({ ...x, [p.key]: pic }))
      setLoose(l => l.filter((_, i) => i !== picked))
      setPicked(null)
    } else if (photos[p.key]) setEditing(p.key)
    else { forPlayer.current = p.key; input.current?.click() }
  }
  const drop = (key: string) => { setPhotos(({ [key]: _gone, ...rest }) => rest); setEditing(null) }

  const close = () => { if (!given.length || done || confirm(t('作りかけのパックを閉じますか？（写真の割り当ては残りません）'))) onClose() }

  const save = async (install: boolean) => {
    setBusy(true); setError(null); setDone(null)
    try {
      const files: Record<string, Uint8Array> = {}
      for (const p of given) {
        const canvas = new OffscreenCanvas(PHOTO_W, PHOTO_H)
        paint(canvas.getContext('2d')!, photos[p.key], PHOTO_W, PHOTO_H)
        files[photoFile(p)] = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer())
      }
      const saved = await savePack(packManifest(name, given), files, install)
      if (saved) setDone(install ? t('パックを読み込みました（{0} 人）', given.length) : t('パックを書き出しました: {0}', saved))
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  const editingPlayer = editing ? roster?.find(p => p.key === editing) : null
  const ready = !!name.trim() && !!given.length && rights && !busy
  return (
    <div className="modal-backdrop" onClick={e => e.stopPropagation()}>
      <div className="modal pack-maker" role="dialog" aria-label={t('パックを作る')} onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        <h2>{t('パックを作る')}</h2>
        <div className="filter-row">
          <label className="field-label" htmlFor="pack-name">{t('パック名')}</label>
          <input id="pack-name" value={name} placeholder={t('例: 2026 シーズン')} onChange={e => setName(e.target.value)} onKeyDown={e => e.stopPropagation()} />
          <button onClick={() => { forPlayer.current = null; input.current?.click() }} disabled={busy}>{t('写真を追加…')}</button>
          <input ref={input} type="file" accept="image/png,image/jpeg" multiple hidden onChange={e => { void add([...(e.target.files ?? [])]); e.target.value = '' }} />
        </div>
        <p className="hint">{t('写真をここにドラッグするか「写真を追加」で入れます。HTH_7.jpg のようなファイル名（チームコードと背番号）か、HTH_TANAKA.jpg、TANAKA.jpg なら自動で選手に割り当てます。選手をクリックすると 1 人ずつ入れられ、入れた写真をクリックすると切り抜きを直せます。')}</p>
        <div className="filter-row">
          <select value={team} aria-label={t('チーム')} onChange={e => setTeam(e.target.value)}>
            <option value="">{t('すべてのチーム')}</option>
            {teams.map(([code, label]) => <option key={code} value={code}>{`${code} — ${label}`}</option>)}
          </select>
          <label className="check" title={t('このパックにも読み込み済みのパックにも写真がない選手だけ')}><input type="checkbox" checked={lacking} onChange={e => setLacking(e.target.checked)} /> {t('写真がない選手だけ')}</label>
          <span className="spacer" />
          <span className="muted">{t('{0} 人に写真あり / 全 {1} 人', given.length, roster?.length ?? 0)}</span>
        </div>
        {loose.length > 0 && (
          <div className="pack-loose">
            <span className="muted small">{picked === null ? t('選手が分からない写真: クリックしてから、下の選手をクリック') : t('下の選手をクリックすると、この写真を割り当てます')}</span>
            <div className="pack-loose-row">
              {loose.map((p, i) => (
                <button key={`${p.name}-${i}`} className={picked === i ? 'on' : ''} title={p.name} aria-pressed={picked === i} onClick={() => setPicked(picked === i ? null : i)}><Shot picture={p} width={48} /></button>
              ))}
            </div>
          </div>
        )}
        <div className="pack-grid">
          {roster === null && <p className="muted">{t('読み込んでいます…')}</p>}
          {roster?.length === 0 && <p className="muted">{t('倉庫に試合がありません。先に試合を取り込むと、DVW の選手が並びます。')}</p>}
          {shown.map(p => (
            <button key={p.key} className={`pack-tile${photos[p.key] ? ' has' : ''}`} onClick={() => clickPlayer(p)} title={p.firstName ? `${p.lastName} ${p.firstName}` : p.lastName}>
              {photos[p.key] ? <Shot picture={photos[p.key]} width={72} /> : <span className="pack-empty">＋</span>}
              <span className="pack-tile-name"><b>{p.team} {p.jersey}</b> {p.lastName}</span>
              {!photos[p.key] && inPack(p) && <span className="muted small">{t('パックにあり')}</span>}
            </button>
          ))}
        </div>
        {error && <p className="pack-error small">{error}</p>}
        {done && <p className="hint">{done}</p>}
        <label className="check"><input type="checkbox" checked={rights} onChange={e => setRights(e.target.checked)} /> {t('これらの写真を使う権利があることを確認しました（撮影者・選手・所属先などの許可）')}</label>
        <div className="modal-actions">
          <button onClick={close}>{t('閉じる')}</button>
          <button disabled={!ready} onClick={() => void save(false)} title={t('.vrpack ファイルに保存します。ほかのパソコンでも読み込めます')}>{t('ファイルに書き出す…')}</button>
          <button className="primary" disabled={!ready} onClick={() => void save(true)} title={t('このパソコンの倉庫に読み込みます。同じ名前のパックは置き換えます')}>{t('この倉庫に読み込む')}</button>
        </div>
      </div>
      {editing && editingPlayer && photos[editing] && (
        <CropDialog player={editingPlayer} picture={photos[editing]} onChange={crop => setPhotos(x => ({ ...x, [editing]: { ...x[editing], crop } }))}
          onRemove={() => drop(editing)} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

// Drag the picture to place the face, and zoom with the slider.
function CropDialog({ player, picture, onChange, onRemove, onClose }: {
  player: RosterPlayer; picture: Picture; onChange: (c: Crop) => void; onRemove: () => void; onClose: () => void
}) {
  const { image, crop } = picture
  const W = 280, H = Math.round((W * PHOTO_H) / PHOTO_W)
  const ref = useRef<HTMLCanvasElement>(null)
  const from = useRef<{ x: number; y: number; crop: Crop } | null>(null)
  useEffect(() => { const c = ref.current?.getContext('2d'); if (c) paint(c, picture, W, H) }, [picture, W, H])
  const widest = keepCrop({ x: 0, y: 0, w: Infinity }, image.width, image.height).w
  const move = (e: PointerEvent) => {
    const f = from.current
    if (!f) return
    const k = f.crop.w / W
    onChange(keepCrop({ ...f.crop, x: f.crop.x - (e.clientX - f.x) * k, y: f.crop.y - (e.clientY - f.y) * k }, image.width, image.height))
  }
  const zoom = (z: number) => {
    const w = widest / z, cx = crop.x + crop.w / 2, cy = crop.y + cropHeight(crop) / 2
    onChange(keepCrop({ x: cx - w / 2, y: cy - (w * PHOTO_H) / PHOTO_W / 2, w }, image.width, image.height))
  }
  return (
    <div className="modal-backdrop" onClick={e => { e.stopPropagation(); onClose() }}>
      <div className="modal pack-crop" role="dialog" aria-label={t('写真の切り抜き')} onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape' && !composing(e)) onClose() }}>
        <h2>{`${player.team} ${player.jersey} ${player.lastName}`}</h2>
        <canvas ref={ref} width={W} height={H} className="pack-crop-view"
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); from.current = { x: e.clientX, y: e.clientY, crop } }}
          onPointerMove={move} onPointerUp={() => { from.current = null }} />
        <label className="check">{t('拡大')}
          <input type="range" min={1} max={4} step={0.05} value={widest / crop.w} aria-label={t('拡大')} onChange={e => zoom(+e.target.value)} /></label>
        <p className="hint">{t('ドラッグで写す位置を動かします')}</p>
        <div className="modal-actions">
          <button onClick={onRemove}>{t('写真を外す')}</button>
          <button className="primary" onClick={onClose}>{t('完了')}</button>
        </div>
      </div>
    </div>
  )
}
