// The bars under the top bar: import progress, an update, an error or a note, slide files changed
// since they were read, and the export's progress.
import type { ImportProgress, UpdateEvent } from '../../../shared/types'
import type { ExportState } from './useExport'
import { t } from '../../../shared/i18n'

const api = window.api

interface Props {
  progress: ImportProgress | null
  update: UpdateEvent | null
  updateLater: boolean
  updateBusy: boolean
  onRestart: () => void
  onUpdateLater: () => void
  error: string | null
  onError: (e: string | null) => void
  notice: string | null
  onNotice: (n: string | null) => void
  staleSlides: string[]
  onReloadSlides: (paths: string[]) => void
  onLaterSlides: () => void
  exportState: ExportState | null
  onCloseExport: () => void
}

export function Banners({ progress, update, updateLater, updateBusy, onRestart, onUpdateLater, error, onError, notice, onNotice, staleSlides, onReloadSlides, onLaterSlides, exportState, onCloseExport }: Props) {
  return (
    <>
      {progress && (
        <div className="banner">
          {progress.message}
          {progress.ratio != null && <progress value={progress.ratio} max={1} />}
        </div>
      )}
      {update?.type === 'ready' && !updateLater && (
        <div className="banner update" role="status">
          {t('新しいバージョン')} {update.version} {t('の準備ができました')}
          <button className="primary" disabled={updateBusy} onClick={onRestart}>{t('再起動して更新')}</button>
          <button className="link" onClick={onUpdateLater} title={t('閉じても、アプリを終了するときに更新されます')}>{t('あとで')}</button>
        </div>
      )}
      {update?.type === 'error' && !updateLater && (
        // The installer couldn't be started: the download page always works (as installing by hand).
        <div className="banner update-failed" role="alert">
          {t('更新を入れられませんでした:')} {update.message}
          <button className="primary" onClick={() => void api.updateHelp('page')}>{t('ダウンロードページを開く')}</button>
          <button className="link" onClick={() => void api.updateHelp('log')} title={t('原因を調べるための記録（update.log）。送ってもらえると原因が分かります')}>{t('記録を見る')}</button>
          <button className="link" onClick={onUpdateLater}>{t('閉じる')}</button>
        </div>
      )}
      {error && <div className="banner error" onClick={() => onError(null)}>{error}</div>}
      {notice && <div className="banner notice" onClick={() => onNotice(null)}>{notice}</div>}
      {staleSlides.length > 0 && (
        <div className="banner slides-stale" role="status">
          <span>{t('スライドの元のファイルが更新されています:')} {staleSlides.map(p => p.split(/[\\/]/).pop()).join(t('、'))}</span>
          <button className="primary" onClick={() => onReloadSlides(staleSlides)}>{t('読み直す')}</button>
          <button className="link" onClick={onLaterSlides}>{t('あとで')}</button>
        </div>
      )}
      {exportState && (
        <div className={`banner export ${exportState.status}`} role="status">
          <span>{exportState.message}</span>
          {(exportState.status === 'running' || exportState.status === 'preparing') && (
            <>
              <progress value={exportState.ratio} max={1} />
              <span className="muted">{Math.round(exportState.ratio * 100)}%</span>
              <button onClick={() => void api.cancelExport()}>{t('キャンセル')}</button>
            </>
          )}
          {exportState.status === 'done' && exportState.outPath && <button onClick={() => void api.showInFolder(exportState.outPath!)}>{t('フォルダを開く')}</button>}
          {exportState.status !== 'running' && exportState.status !== 'preparing' && <button className="link" onClick={onCloseExport}>{t('閉じる')}</button>}
        </div>
      )}
    </>
  )
}
