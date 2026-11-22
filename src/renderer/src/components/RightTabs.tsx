// The right column, one part at a time so the scene being edited has the room: the open scene (its
// clips, the palette, player photos), how the video is built from scenes, and the export. The video's
// name, play and settings stay above them. The column folds to a thin strip (RightStrip) for a bigger
// video; its parts stay mounted under the strip, so nothing being edited is lost.
import { cap, t } from '../../../shared/i18n'

export const RIGHT_TABS = ['scene', 'video', 'export'] as const
export type RightTab = typeof RIGHT_TABS[number]

const LABELS = (): Record<RightTab, string> => ({ scene: cap(t('シーン')), video: t('動画の構成'), export: t('書き出し') })

// badge: how the export is going, seen from the other tabs.
export function RightTabs({ tab, onTab, badge, onFold }: { tab: RightTab; onTab: (t: RightTab) => void; badge?: string; onFold: () => void }) {
  const labels = LABELS()
  return (
    <div className="stage-tabs right-tabs" role="tablist" aria-label={t('右の欄')}>
      {RIGHT_TABS.map(r => (
        <button key={r} role="tab" aria-selected={tab === r} className={tab === r ? 'on' : ''} onClick={() => onTab(r)}>
          {labels[r]}{r === 'export' && badge ? ` ${badge}` : ''}</button>
      ))}
      <button className="right-fold" onClick={onFold} title={t('右の欄をたたんで動画を大きくする（Ctrl+B）')} aria-label={t('右の欄をたたむ')}>»</button>
    </div>
  )
}

// The folded column: a button to open it again, and each part's name to open it at that part.
export function RightStrip({ tab, badge, onOpen }: { tab: RightTab; badge?: string; onOpen: (t: RightTab) => void }) {
  const labels = LABELS()
  return (
    <div className="right-strip">
      <button className="right-fold" onClick={() => onOpen(tab)} title={t('右の欄を開く（Ctrl+B）')} aria-label={t('右の欄を開く')}>«</button>
      {RIGHT_TABS.map(r => (
        <button key={r} className={`right-strip-tab${tab === r ? ' on' : ''}`} onClick={() => onOpen(r)} title={t('右の欄を開く（Ctrl+B）')}>
          {labels[r]}{r === 'export' && badge ? ` ${badge}` : ''}</button>
      ))}
    </div>
  )
}
