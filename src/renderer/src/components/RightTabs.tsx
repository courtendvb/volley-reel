// The right column, one part at a time so the scene being edited has the room: the open scene (its
// clips, the palette, player photos), how the video is built from scenes, and the export. The video's
// name, play and settings stay above them.
import { t } from '../../../shared/i18n'

export const RIGHT_TABS = ['scene', 'video', 'export'] as const
export type RightTab = typeof RIGHT_TABS[number]

const LABELS: Record<RightTab, string> = { scene: t('シーン'), video: t('動画の構成'), export: t('書き出し') }

// badge: how the export is going, seen from the other tabs.
export function RightTabs({ tab, onTab, badge }: { tab: RightTab; onTab: (t: RightTab) => void; badge?: string }) {
  return (
    <div className="stage-tabs right-tabs" role="tablist" aria-label={t('右の欄')}>
      {RIGHT_TABS.map(r => (
        <button key={r} role="tab" aria-selected={tab === r} className={tab === r ? 'on' : ''} onClick={() => onTab(r)}>
          {LABELS[r]}{r === 'export' && badge ? ` ${badge}` : ''}</button>
      ))}
    </div>
  )
}
