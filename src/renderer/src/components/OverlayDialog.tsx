import { PaletteColor } from './PaletteColor'
import { useEffect, useRef } from 'react'
import { TELOP_LOOKS, lookTheme, type Anchor, type CaptionData, type OverlaySettings, type ScoreboardData } from '../../../shared/overlay'
import { cardBackground, drawCaption, drawScoreboard, drawServeSpeed, drawTitleCard } from '../../../shared/overlayDraw'
import { t } from '../../../shared/i18n'
import { packPhotoImage } from '../assets'

interface Props {
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
  onClose: () => void
  sample: { scoreboard: ScoreboardData; caption: CaptionData; card: { marker: number; name: string; match: string | null } }
}

const ANCHORS: [Anchor, string][] = [['tl', t('左上')], ['tc', t('上中央')], ['tr', t('右上')], ['bl', t('左下')], ['bc', t('下中央')], ['br', t('右下')]]
const PREVIEW_W = 560, PREVIEW_H = 315

// Reel-wide settings for the automatic overlays (design §3.7): every element separately, plus colors.
// Changes apply at once; the preview draws on the current video frame.
export function OverlayDialog({ settings: s, onChange, onClose, sample }: Props) {
  const frame = useRef<HTMLCanvasElement>(null)
  const card = useRef<HTMLCanvasElement>(null)
  const set = <K extends Exclude<keyof OverlaySettings, 'look'>>(k: K, patch: Partial<OverlaySettings[K]>) => onChange({ ...s, [k]: { ...s[k], ...patch } })

  useEffect(() => {
    const c = frame.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#6B5136'; ctx.fillRect(0, 0, c.width, c.height)
    const v = document.querySelector<HTMLVideoElement>('.video-box video')
    if (v && v.readyState >= 2) ctx.drawImage(v, 0, 0, c.width, c.height)
    if (s.scoreboard.enabled) drawScoreboard(ctx, c.width, c.height, sample.scoreboard, s.scoreboard, lookTheme(s))
    if (s.playerCaption.enabled) drawCaption(ctx, c.width, c.height, sample.caption, s.playerCaption, lookTheme(s), packPhotoImage(sample.caption.photo))
    if (s.serveSpeed.enabled) drawServeSpeed(ctx, c.width, c.height, 98, s.serveSpeed, lookTheme(s))
    const t = card.current
    if (t) drawTitleCard(t.getContext('2d')!, t.width, t.height, sample.card, s.titleCard, s.theme)
  }, [s, sample])

  const check = (label: string, value: boolean, on: (v: boolean) => void) => (
    <label className="check"><input type="checkbox" checked={value} onChange={e => on(e.target.checked)} /> {label}</label>
  )
  const anchor = (value: Anchor, on: (a: Anchor) => void, label: string) => (
    <select value={value} onChange={e => on(e.target.value as Anchor)} aria-label={label}>
      {ANCHORS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
    </select>
  )
  const scale = (value: number, on: (v: number) => void, label: string) => (
    <span className="ov-scale"><input type="range" min={0.6} max={1.6} step={0.1} value={value} aria-label={label} onChange={e => on(+e.target.value)} />{Math.round(value * 100)}%</span>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal overlay-modal" role="dialog" aria-label={t('動画の設定')} onClick={e => e.stopPropagation()}>
        <h2>{t('動画の設定（スコアボード・テロップ・タイトルカード・フェード）')}</h2>
        <div className="ov-body">
          <div className="ov-preview">
            <canvas ref={frame} width={PREVIEW_W * 2} height={PREVIEW_H * 2} style={{ width: PREVIEW_W, height: PREVIEW_H }} />
            {(s.titleCard.enabled || s.titleCard.sceneCards) && <canvas ref={card} width={PREVIEW_W} height={PREVIEW_H} style={{ width: PREVIEW_W / 2, height: PREVIEW_H / 2 }} />}
          </div>

          <div className="ov-settings">
            <section>
              <span className="field-label">{t('配色')}</span>
              <p className="hint">{t('配色はプロジェクト全体の設定です。上部の「設定」で変えます。')}</p>
            </section>

            <section>
              <span className="field-label">{t('デザイン')}</span>
              <div className="ov-looks" role="radiogroup" aria-label={t('スコアボード・テロップ・サーブ速度のデザイン')}>
                {TELOP_LOOKS.map(l => (
                  <LookButton key={l.look} name={l.name} on={(s.look ?? 'slant') === l.look} settings={{ ...s, look: l.look }} sample={sample}
                    onPick={() => onChange(l.look === 'slant' ? (({ look: _l, ...rest }) => rest)(s) : { ...s, look: l.look })} />
                ))}
              </div>
            </section>

            <section>
              <div className="filter-row">{check(t('スコアボード'), s.scoreboard.enabled, v => set('scoreboard', { enabled: v }))}<span className="spacer" />
                {anchor(s.scoreboard.anchor, v => set('scoreboard', { anchor: v }), t('スコアボードの位置'))}{scale(s.scoreboard.scale, v => set('scoreboard', { scale: v }), t('スコアボードのサイズ'))}</div>
              <div className="filter-row indent">{check(t('セット数'), s.scoreboard.showSets, v => set('scoreboard', { showSets: v }))}</div>
            </section>

            <section>
              <div className="filter-row">{check(t('選手テロップ'), s.playerCaption.enabled, v => set('playerCaption', { enabled: v }))}<span className="spacer" />
                {anchor(s.playerCaption.anchor, v => set('playerCaption', { anchor: v }), t('テロップの位置'))}{scale(s.playerCaption.scale, v => set('playerCaption', { scale: v }), t('テロップのサイズ'))}</div>
              <div className="filter-row indent">
                {check(t('背番号'), s.playerCaption.showNumber, v => set('playerCaption', { showNumber: v }))}
                {check(t('名前'), s.playerCaption.showName, v => set('playerCaption', { showName: v }))}
                {check(t('スキル'), s.playerCaption.showSkill, v => set('playerCaption', { showSkill: v }))}
                {check(t('評価'), s.playerCaption.showEvaluation, v => set('playerCaption', { showEvaluation: v }))}
                {check(t('写真（選手写真パックから。下のテロップは上に、上のテロップは下に出す）'), s.playerCaption.photo, v => set('playerCaption', { photo: v }))}
              </div>
            </section>

            <section>
              <div className="filter-row">{check(t('サーブ速度'), s.serveSpeed.enabled, v => set('serveSpeed', { enabled: v }))}<span className="spacer" />
                {anchor(s.serveSpeed.anchor, v => set('serveSpeed', { anchor: v }), t('サーブ速度の位置'))}{scale(s.serveSpeed.scale, v => set('serveSpeed', { scale: v }), t('サーブ速度のサイズ'))}</div>
              <p className="hint">{t('ヒットとタッチを打ったサーブに、タッチのコマから出ます')}</p>
            </section>

            <section>
              <div className="filter-row"><span className="field-label wide">{t('タイトルカード')}</span>
                {check(t('動画の頭（動画名）'), !!s.titleCard.videoCard, v => set('titleCard', { videoCard: v }))}
                {check(t('シーンの頭（シーン名。動画のシーン一覧の「カード」でシーンごとに変えられる）'), s.titleCard.sceneCards, v => set('titleCard', { sceneCards: v }))}
                {check(t('マーカーの頭（マーカー名。シーンの「カード」でマーカーごとに変えられる）'), s.titleCard.enabled, v => set('titleCard', { enabled: v }))}<span className="spacer" />
                <label className="check"><input type="number" min={1} max={8} step={0.5} value={s.titleCard.durationSec} aria-label={t('タイトルカードの秒数')} title={t('シーンとマーカーのカードの秒数（一括）')}
                  onChange={e => { const n = parseFloat(e.target.value); if (n >= 1 && n <= 8) set('titleCard', { durationSec: n }) }} /> {t('秒')}</label></div>
              <div className="filter-row">
                {check(t('切り替えでフェード（イン・アウト。クリップとカードの頭と終わり）'), s.transition.fade, v => set('transition', { fade: v }))}<span className="spacer" />
                {s.transition.fade && <label className="check"><input type="number" min={0.1} max={2} step={0.1} value={s.transition.durationSec} aria-label={t('フェードの秒数')}
                  onChange={e => { const n = parseFloat(e.target.value); if (n >= 0.1 && n <= 2) set('transition', { durationSec: n }) }} /> {t('秒')}</label>}</div>
              <div className="filter-row indent">
                {check(t('マーカー番号'), s.titleCard.showMarkerNumber !== false, v => set('titleCard', { showMarkerNumber: v }))}
                {check(t('マーカー名'), s.titleCard.showMarkerName, v => set('titleCard', { showMarkerName: v }))}
                {check(t('試合名'), s.titleCard.showMatch, v => set('titleCard', { showMatch: v }))}
                <label className="check" title={t('すべてのタイトルカードと無地のスライドの背景色')}>{t('背景')}
                  <PaletteColor label={t('カードの背景色')} value={cardBackground(s.titleCard, s.theme)} onChange={c => set('titleCard', { background: c })} /></label>
                {s.titleCard.background && <button className="link" onClick={() => { const { background: _bg, ...rest } = s.titleCard; onChange({ ...s, titleCard: rest }) }}>{t('配色に戻す')}</button>}
              </div>
            </section>
          </div>
        </div>
        <div className="modal-actions"><button className="primary" onClick={onClose}>{t('閉じる')}</button></div>
      </div>
    </div>
  )
}

// One design to pick: the caption and the speed plate drawn small in it, over a plain floor color.
function LookButton({ name, on, settings, sample, onPick }: { name: string; on: boolean; settings: OverlaySettings; sample: Props['sample']; onPick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#B08A5E'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.fillStyle = '#9C7650'; ctx.fillRect(0, c.height * 0.55, c.width, c.height * 0.45)
    const theme = lookTheme(settings)
    drawScoreboard(ctx, c.width, c.height, sample.scoreboard, { ...settings.scoreboard, anchor: 'tl', scale: 1.9 }, theme)
    drawCaption(ctx, c.width, c.height, { ...sample.caption, photo: null }, { ...settings.playerCaption, anchor: 'bl', scale: 2.6, photo: false }, theme)
    drawServeSpeed(ctx, c.width, c.height, 98, { ...settings.serveSpeed, anchor: 'tr', scale: 1.7 }, theme)
  }, [settings, sample])
  return (
    <button type="button" role="radio" aria-checked={on} className={`ov-look${on ? ' on' : ''}`} onClick={onPick}>
      <canvas ref={ref} width={LOOK_W * 2} height={LOOK_H * 2} style={{ width: LOOK_W, height: LOOK_H }} />
      <span>{name}</span>
    </button>
  )
}
const LOOK_W = 168, LOOK_H = 94
