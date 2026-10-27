import { useEffect, useRef } from 'react'
import type { Anchor, CaptionData, OverlaySettings, ScoreboardData } from '../../../shared/overlay'
import { cardBackground, drawCaption, drawScoreboard, drawTitleCard } from '../../../shared/overlayDraw'

interface Props {
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
  onClose: () => void
  sample: { scoreboard: ScoreboardData; caption: CaptionData; card: { marker: number; name: string; match: string | null } }
}

const ANCHORS: [Anchor, string][] = [['tl', '左上'], ['tc', '上中央'], ['tr', '右上'], ['bl', '左下'], ['bc', '下中央'], ['br', '右下']]
const PREVIEW_W = 560, PREVIEW_H = 315

// Reel-wide settings for the automatic overlays (design §3.7): every element separately, plus colors.
// Changes apply at once; the preview draws on the current video frame.
export function OverlayDialog({ settings: s, onChange, onClose, sample }: Props) {
  const frame = useRef<HTMLCanvasElement>(null)
  const card = useRef<HTMLCanvasElement>(null)
  const set = <K extends keyof OverlaySettings>(k: K, patch: Partial<OverlaySettings[K]>) => onChange({ ...s, [k]: { ...s[k], ...patch } })

  useEffect(() => {
    const c = frame.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#6B5136'; ctx.fillRect(0, 0, c.width, c.height)
    const v = document.querySelector<HTMLVideoElement>('.video-box video')
    if (v && v.readyState >= 2) ctx.drawImage(v, 0, 0, c.width, c.height)
    if (s.scoreboard.enabled) drawScoreboard(ctx, c.width, c.height, sample.scoreboard, s.scoreboard, s.theme)
    if (s.playerCaption.enabled) drawCaption(ctx, c.width, c.height, sample.caption, s.playerCaption, s.theme)
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
      <div className="modal overlay-modal" role="dialog" aria-label="動画の設定" onClick={e => e.stopPropagation()}>
        <h2>動画の設定（スコアボード・テロップ・タイトルカード・フェード）</h2>
        <div className="ov-body">
          <div className="ov-preview">
            <canvas ref={frame} width={PREVIEW_W * 2} height={PREVIEW_H * 2} style={{ width: PREVIEW_W, height: PREVIEW_H }} />
            {(s.titleCard.enabled || s.titleCard.sceneCards) && <canvas ref={card} width={PREVIEW_W} height={PREVIEW_H} style={{ width: PREVIEW_W / 2, height: PREVIEW_H / 2 }} />}
          </div>

          <div className="ov-settings">
            <section>
              <span className="field-label">配色</span>
              <p className="hint">配色はプロジェクト全体の設定です。上部の「設定」で変えます。</p>
            </section>

            <section>
              <div className="filter-row">{check('スコアボード', s.scoreboard.enabled, v => set('scoreboard', { enabled: v }))}<span className="spacer" />
                {anchor(s.scoreboard.anchor, v => set('scoreboard', { anchor: v }), 'スコアボードの位置')}{scale(s.scoreboard.scale, v => set('scoreboard', { scale: v }), 'スコアボードのサイズ')}</div>
              <div className="filter-row indent">{check('セット数', s.scoreboard.showSets, v => set('scoreboard', { showSets: v }))}</div>
            </section>

            <section>
              <div className="filter-row">{check('選手テロップ', s.playerCaption.enabled, v => set('playerCaption', { enabled: v }))}<span className="spacer" />
                {anchor(s.playerCaption.anchor, v => set('playerCaption', { anchor: v }), 'テロップの位置')}{scale(s.playerCaption.scale, v => set('playerCaption', { scale: v }), 'テロップのサイズ')}</div>
              <div className="filter-row indent">
                {check('背番号', s.playerCaption.showNumber, v => set('playerCaption', { showNumber: v }))}
                {check('名前', s.playerCaption.showName, v => set('playerCaption', { showName: v }))}
                {check('スキル', s.playerCaption.showSkill, v => set('playerCaption', { showSkill: v }))}
                {check('評価', s.playerCaption.showEvaluation, v => set('playerCaption', { showEvaluation: v }))}
              </div>
            </section>

            <section>
              <div className="filter-row"><span className="field-label wide">タイトルカード</span>
                {check('動画の頭（動画名）', !!s.titleCard.videoCard, v => set('titleCard', { videoCard: v }))}
                {check('シーンの頭（シーン名。動画のシーン一覧の「カード」でシーンごとに変えられる）', s.titleCard.sceneCards, v => set('titleCard', { sceneCards: v }))}
                {check('マーカーの頭（マーカー名。シーンの「カード」でマーカーごとに変えられる）', s.titleCard.enabled, v => set('titleCard', { enabled: v }))}<span className="spacer" />
                <label className="check"><input type="number" min={1} max={8} step={0.5} value={s.titleCard.durationSec} aria-label="タイトルカードの秒数" title="シーンとマーカーのカードの秒数（一括）"
                  onChange={e => { const n = parseFloat(e.target.value); if (n >= 1 && n <= 8) set('titleCard', { durationSec: n }) }} /> 秒</label></div>
              <div className="filter-row">
                {check('切り替えでフェード（イン・アウト。クリップとカードの頭と終わり）', s.transition.fade, v => set('transition', { fade: v }))}<span className="spacer" />
                {s.transition.fade && <label className="check"><input type="number" min={0.1} max={2} step={0.1} value={s.transition.durationSec} aria-label="フェードの秒数"
                  onChange={e => { const n = parseFloat(e.target.value); if (n >= 0.1 && n <= 2) set('transition', { durationSec: n }) }} /> 秒</label>}</div>
              <div className="filter-row indent">
                {check('マーカー名', s.titleCard.showMarkerName, v => set('titleCard', { showMarkerName: v }))}
                {check('試合名', s.titleCard.showMatch, v => set('titleCard', { showMatch: v }))}
                <label className="check" title="すべてのタイトルカードと無地のスライドの背景色">背景
                  <input type="color" aria-label="カードの背景色" value={cardBackground(s.titleCard, s.theme)} onChange={e => set('titleCard', { background: e.target.value })} /></label>
                {s.titleCard.background && <button className="link" onClick={() => { const { background: _bg, ...rest } = s.titleCard; onChange({ ...s, titleCard: rest }) }}>配色に戻す</button>}
              </div>
            </section>
          </div>
        </div>
        <div className="modal-actions"><button className="primary" onClick={onClose}>閉じる</button></div>
      </div>
    </div>
  )
}
