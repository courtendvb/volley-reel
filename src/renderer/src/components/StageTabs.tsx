// The panels under the video, one at a time so the video keeps its size: trim (the main editing
// panel: headline, IN/OUT, slow and hold, object times), objects (the drawing tools), display (the
// auto overlays) and the court grid. The open tab again closes it, for the biggest video.
import { t } from '../../../shared/i18n'

export const STAGE_PANELS = ['trim', 'objects', 'display', 'court'] as const
export type StagePanel = typeof STAGE_PANELS[number]

const LABELS: Record<StagePanel, string> = { trim: t('トリム'), objects: t('図形'), display: t('表示'), court: t('コート') }
const TIPS: Record<StagePanel, string> = {
  trim: t('見出し、IN / OUT、スロー・停止、図形の表示時間'),
  objects: t('テキスト・矢印・図形・画像と書式'),
  display: t('スコアボード・テロップ'),
  court: t('コートのグリッドとプレーのゾーン'),
}

export function StageTabs({ panel, onPanel, clip, fitting }: { panel: StagePanel | null; onPanel: (p: StagePanel | null) => void; clip: boolean; fitting: boolean }) {
  return (
    <div className="stage-tabs" role="tablist" aria-label={t('動画の下の欄')}>
      {STAGE_PANELS.map(p => {
        const needsClip = p !== 'court', on = panel === p || (p === 'court' && fitting)
        return (
          <button key={p} role="tab" aria-selected={on} className={on ? 'on' : ''} disabled={needsClip && !clip}
            title={needsClip && !clip ? t('シーンのクリップを選ぶと使えます') : on ? t('閉じて動画を大きく') : TIPS[p]}
            onClick={() => onPanel(panel === p ? null : p)}>{LABELS[p]}</button>
        )
      })}
      {panel && panel !== 'court' && !clip && <span className="muted small">{t('シーンのクリップを選ぶと使えます')}</span>}
    </div>
  )
}
