// Video comparison: the saved ones (listed in the top bar's menu) and the one open (CompareView).
import { useCallback, useEffect, useState } from 'react'
import { newCompare, type CompareSession } from '../../../shared/videoCompare'
import { errorText } from '../format'
import { t } from '../../../shared/i18n'

const api = window.api

export function useCompare(setError: (m: string) => void) {
  const [compares, setCompares] = useState<CompareSession[]>([])
  const [open, setOpen] = useState<CompareSession | null>(null)
  const refresh = useCallback(() => api.listCompares().then(setCompares, e => setError(errorText(e))), [setError])
  useEffect(() => { void refresh() }, [refresh])

  return {
    compares, open, refresh,
    newCompare: () => setOpen(newCompare(t('新しい比較'))),
    openCompare: (s: CompareSession) => setOpen(s),
    closeCompare: (last: CompareSession) => { setOpen(null); setCompares(p => [last, ...p.filter(c => c.id !== last.id)]) },
    deleteCompare: async (s: CompareSession) => {
      try { await api.removeCompare(s.id); setCompares(p => p.filter(c => c.id !== s.id)) } catch (e) { setError(errorText(e)) }
    },
  }
}
