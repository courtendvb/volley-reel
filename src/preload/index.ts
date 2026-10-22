import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ImportProgress } from '../shared/types'

const api: Api = {
  getProject: () => ipcRenderer.invoke('project:get'),
  chooseProject: () => ipcRenderer.invoke('project:choose'),
  importMatch: () => ipcRenderer.invoke('match:import'),
  parseMatch: id => ipcRenderer.invoke('match:parse', id),
  saveSettings: s => ipcRenderer.invoke('project:saveSettings', s),
  onImportProgress: cb => {
    const h = (_e: unknown, p: ImportProgress) => cb(p)
    ipcRenderer.on('import:progress', h)
    return () => ipcRenderer.off('import:progress', h)
  },
}

contextBridge.exposeInMainWorld('api', api)
