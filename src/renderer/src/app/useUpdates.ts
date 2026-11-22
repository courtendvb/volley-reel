// Updates (installed copies): the main process finds and downloads a newer version; once it is
// ready a banner offers to restart into it, after saving everything here.
import { useEffect, useState } from 'react'
import type { UpdateEvent } from '../../../shared/types'
import { t } from '../../../shared/i18n'

const api = window.api

export function useUpdates(flushAll: () => Promise<unknown>, exporting: () => boolean, setError: (e: string) => void) {
  const [appVersion, setAppVersion] = useState('')
  const [update, setUpdate] = useState<UpdateEvent | null>(null)
  const [updateLater, setUpdateLater] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  useEffect(() => {
    void api.appVersion().then(setAppVersion)
    return api.onUpdateEvent(ev => {
      if (ev.type === 'error') { setUpdateBusy(false); setUpdateLater(false) }
      setUpdate(u => (u?.type === 'ready' && ev.type !== 'error' ? u : ev))
    })
  }, [])
  const restartToUpdate = async () => {
    if (exporting() && !confirm(t('書き出し中です。書き出しを中止して再起動しますか？'))) return
    setUpdateBusy(true)
    try {
      await flushAll()
      await api.installUpdate()
    } catch (e) {
      setError(t('更新できませんでした: {0}', (e as Error).message))
      setUpdateBusy(false)
    }
  }
  return { appVersion, update, updateLater, setUpdateLater, updateBusy, restartToUpdate }
}
