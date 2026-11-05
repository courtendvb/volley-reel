// The panels under the video, one at a time so the video keeps its size: editing the clip (headline,
// IN/OUT, slow and hold, and the objects, folded until used) and what shows on the picture (the auto
// overlays and the court). The open tab again closes it, for the biggest video.
import { t } from '../../../shared/i18n'

export const STAGE_PANELS = ['edit', 'view'] as const
export type StagePanel = typeof STAGE_PANELS[number]

const LABELS: Record<StagePanel, string> = { edit: t('編集'), view: t('表示') }
const TIPS: Record<StagePanel, string> = {
  edit: t('見出し、IN / OUT、スロー・停止、図形と書式'),
  view: t('スコアボード・テロップ、コートのグリッドとプレーの表示'),
}

export function StageTabs({ panel, onPanel, clip, fitting }: { panel: StagePanel | null; onPanel: (p: StagePanel | null) => void; clip: boolean; fitting: boolean }) {
  return (
    <div className="stage-tabs" role="tablist" aria-label={t('動画の下の欄')}>
      {STAGE_PANELS.map(p => {
        const needsClip = p === 'edit', on = panel === p || (p === 'view' && fitting)
        return (
          <button key={p} role="tab" aria-selected={on} className={on ? 'on' : ''} disabled={needsClip && !clip}
            title={needsClip && !clip ? t('シーンのクリップを選ぶと使えます') : on ? t('閉じて動画を大きく') : TIPS[p]}
            onClick={() => onPanel(panel === p ? null : p)}>{LABELS[p]}</button>
        )
      })}
      {panel === 'edit' && !clip && <span className="muted small">{t('シーンのクリップを選ぶと使えます')}</span>}
    </div>
  )
}
