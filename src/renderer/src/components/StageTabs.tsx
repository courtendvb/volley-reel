// The panels under the video, one at a time so the video keeps its size: editing the clip (headline,
// IN/OUT, slow and hold), the objects and comments drawn on it, and what shows on the picture (the
// auto overlays and the court). The open tab again closes it, for the biggest video.
import type { ReactNode } from 'react'
import { t } from '../../../shared/i18n'

export const STAGE_PANELS = ['edit', 'objects', 'view'] as const
export type StagePanel = typeof STAGE_PANELS[number]

const LABELS: Record<StagePanel, string> = { edit: t('編集'), objects: t('図形・コメント'), view: t('表示') }
const TIPS: Record<StagePanel, string> = {
  edit: t('IN / OUT、スロー・停止、図形の表示時間'),
  objects: t('テキスト・矢印・図形・画像と書式'),
  view: t('スコアボード・テロップ、コートのグリッドとプレーの表示'),
}

// children: shown at the right of the tabs (the headline, so it can be written with either tab open).
export function StageTabs({ panel, onPanel, clip, fitting, children }: { panel: StagePanel | null; onPanel: (p: StagePanel | null) => void; clip: boolean; fitting: boolean; children?: ReactNode }) {
  return (
    <div className="stage-tabs" role="tablist" aria-label={t('動画の下の欄')}>
      {STAGE_PANELS.map(p => {
        const needsClip = p !== 'view', on = panel === p || (p === 'view' && fitting)
        return (
          <button key={p} role="tab" aria-selected={on} className={on ? 'on' : ''} disabled={needsClip && !clip}
            title={needsClip && !clip ? t('シーンのクリップを選ぶと使えます') : on ? t('閉じて動画を大きく') : TIPS[p]}
            onClick={() => onPanel(panel === p ? null : p)}>{LABELS[p]}</button>
        )
      })}
      {panel !== 'view' && panel && !clip && <span className="muted small">{t('シーンのクリップを選ぶと使えます')}</span>}
      {children}
    </div>
  )
}
