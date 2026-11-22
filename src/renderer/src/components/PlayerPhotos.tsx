import { useEffect, useMemo, useRef, useState } from 'react'
import { Accordion } from './Accordion'
import { LOCAL_PACK, findPhoto, matchesQuery, type PackPhoto, type PhotoTarget } from '../../../shared/pack'
import type { ParsedDVW, Player, Side } from '../../../shared/types'
import { packPhoto, removePlayerPhoto, setPlayerPhoto, usePacks } from '../packs'
import { composing } from '../keys'
import { t } from '../../../shared/i18n'
import { errorText } from '../format'

// Player photos from add-on packs (shared/pack.ts): the open clip's players with the photo that
// fits each, the play's own player first; a search finds any photo in the packs for a player the
// pack doesn't match. A click puts the photo on the clip or card as a picture; ✎ gives a player
// another photo (＋ one without), kept in the user's own pack, and ↺ goes back to the league's.
// Shown only when a pack is installed, so the app without one looks as before.
export function PlayerPhotos({ dvw, focus, disabled, onPick }: {
  dvw: ParsedDVW | null // the open clip's match (null on a card: search only)
  focus: { side: Side; jersey: number } | null // the clip's play's player
  disabled: boolean
  onPick: (pack: string, photo: string) => Promise<void>
}) {
  const packs = usePacks()
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The match's players, each with the photo that fits (or none), by team; the play's player first.
  const teams = useMemo(() => {
    if (!dvw) return []
    return (['*', 'a'] as Side[]).map((side, i) => {
      const code = dvw.teams[i].code
      const players = Object.values(dvw.players).filter(p => p.side === side).sort((a, b) => a.jersey - b.jersey)
        .map(p => ({ p, photo: findPhoto(packs, p, code) }))
      return { side, code, name: dvw.teams[i].name, players }
    })
  }, [dvw, packs])
  const focused = focus ? teams.find(tm => tm.side === focus.side)?.players.find(x => x.p.jersey === focus.jersey) : undefined
  const found = useMemo(() => q.trim() ? packs.flatMap(pk => pk.players.filter(pp => matchesQuery(pp, q)).map(pp => ({ pack: pk.id, player: pp }))).slice(0, 60) : [], [packs, q])

  if (!packs.some(p => p.players.length)) return null
  const pick = async (ph: PackPhoto) => { setBusy(true); try { await onPick(ph.pack, ph.player.photo) } finally { setBusy(false) } }
  const off = disabled || busy
  const edit = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  const target = (p: Player, team: string, photo: PackPhoto | null): PhotoTarget =>
    ({ key: p.key, team, jersey: p.jersey, lastName: p.lastName, firstName: p.firstName, ...(photo?.player.label ? { label: photo.player.label } : {}) })
  const tile = (p: Player, team: string, photo: PackPhoto | null) => {
    const tg = target(p, team, photo)
    const set = <button className="photo-edit" disabled={busy} aria-label={t('{0} の写真を変える', p.lastName)}
      title={photo ? t('写真を差し替える（自分の写真として保存）') : t('写真を足す（自分の写真として保存）')}
      onClick={() => void edit(() => setPlayerPhoto(tg))}>{photo ? '✎' : '＋'}</button>
    if (!photo) return <span key={p.jersey} className="photo-cell"><span className="photo-none" title={t('パックに合う写真がありません（上の検索で探せます）')}>{`#${p.jersey} ${p.lastName}`}</span>{set}</span>
    return (
      <span key={p.jersey} className="photo-cell">
        <PhotoButton photo={photo} name={photo.player.label ?? p.lastName} sub={`#${p.jersey}`} disabled={off} onPick={pick} mine={photo.pack === LOCAL_PACK} />
        <span className="photo-edits">
          {set}
          {photo.pack === LOCAL_PACK && <button className="photo-edit" disabled={busy} aria-label={t('{0} の自分の写真を外す', p.lastName)}
            title={t('自分で足した写真を外す（パックの写真があればそれに戻る）')} onClick={() => void edit(() => removePlayerPhoto(tg))}>↺</button>}
        </span>
      </span>
    )
  }
  const focusTeam = focus ? teams.find(tm => tm.side === focus.side)?.code ?? '' : ''

  return (
    <Accordion id="player-photos" icon="☺" title={t('選手写真')} badge={t('{0} 人', packs.reduce((n, p) => n + p.players.length, 0))}>
      {disabled && <p className="muted small">{t('クリップかタイトルカードを開くと、写真を入れられます')}</p>}
      {error && <p className="pack-error small">{error}</p>}
      <input className="photo-search" value={q} placeholder={t('名前・チームで探す')} aria-label={t('選手写真を探す')}
        onChange={e => setQ(e.target.value)} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape' && !composing(e)) setQ('') }} />
      {q.trim() ? (
        <div className="photo-grid">
          {found.map(ph => <PhotoButton key={`${ph.pack}/${ph.player.photo}`} photo={ph} name={ph.player.label ?? ph.player.lastName} sub={`${ph.player.team}${ph.player.jersey !== undefined ? ` #${ph.player.jersey}` : ''}`} disabled={off} onPick={pick} />)}
          {!found.length && <p className="muted small">{t('見つかりません')}</p>}
        </div>
      ) : (
        <>
          {focused?.photo && (
            <div className="photo-focus">
              <span className="muted small">{t('このプレーの選手')}</span>
              <div className="photo-grid">{tile(focused.p, focusTeam, focused.photo)}</div>
            </div>
          )}
          {teams.map(tm => (
            <div key={tm.side} className="photo-team">
              <span className="muted small">{`${tm.code} — ${tm.name}`}</span>
              <div className="photo-grid">
                {tm.players.map(({ p, photo }) => tile(p, tm.code, photo))}
              </div>
            </div>
          ))}
          {!dvw && <p className="muted small">{t('名前で探して入れます')}</p>}
        </>
      )}
    </Accordion>
  )
}

function PhotoButton({ photo, name, sub, disabled, onPick, mine }: { photo: PackPhoto; name: string; sub: string; disabled: boolean; onPick: (p: PackPhoto) => Promise<void>; mine?: boolean }) {
  return (
    <button className={`photo-pick${mine ? ' mine' : ''}`} disabled={disabled} title={t('{0} の写真を入れる', name)} onClick={() => void onPick(photo)}>
      <PhotoThumb pack={photo.pack} photo={photo.player.photo} />
      <span className="photo-name">{name}</span>
      <span className="photo-sub muted">{sub}</span>
    </button>
  )
}

function PhotoThumb({ pack, photo }: { pack: string; photo: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    void packPhoto(pack, photo).then(img => {
      const c = canvas.current
      if (!live || !c || !img) return
      const ctx = c.getContext('2d')!
      ctx.clearRect(0, 0, c.width, c.height)
      const s = Math.max(c.width / img.width, c.height / img.height) // fills the box, cropped at the edges
      ctx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 3, img.width * s, img.height * s) // faces sit high
    })
    return () => { live = false }
  }, [pack, photo])
  return <canvas ref={canvas} className="photo-thumb" width={48} height={60} aria-hidden />
}
