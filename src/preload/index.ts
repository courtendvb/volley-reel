import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ExportEvent, ImportProgress } from '../shared/types'

const api: Api = {
  getProject: () => ipcRenderer.invoke('project:get'),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  importMatch: () => ipcRenderer.invoke('match:import'),
  parseMatch: id => ipcRenderer.invoke('match:parse', id),
  saveSettings: s => ipcRenderer.invoke('project:saveSettings', s),
  listReels: () => ipcRenderer.invoke('reel:list'),
  saveReel: r => ipcRenderer.invoke('reel:save', r),
  deleteReel: id => ipcRenderer.invoke('reel:delete', id),
  chooseExportPath: name => ipcRenderer.invoke('export:choosePath', name),
  startExport: job => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportEvent: cb => {
    const h = (_e: unknown, ev: ExportEvent) => cb(ev)
    ipcRenderer.on('export:event', h)
    return () => ipcRenderer.off('export:event', h)
  },
  showInFolder: p => ipcRenderer.invoke('shell:showInFolder', p),
  takeNotices: () => ipcRenderer.invoke('project:notices'),
  smokeEditDvw: (id, code, time) => ipcRenderer.invoke('smoke:editDvw', id, code, time),
  onFlushRequest: cb => {
    const h = () => { void cb().finally(() => ipcRenderer.send('app:flushed')) }
    ipcRenderer.on('app:flush', h)
    return () => ipcRenderer.off('app:flush', h)
  },
  onImportProgress: cb => {
    const h = (_e: unknown, p: ImportProgress) => cb(p)
    ipcRenderer.on('import:progress', h)
    return () => ipcRenderer.off('import:progress', h)
  },
}

contextBridge.exposeInMainWorld('api', api)
