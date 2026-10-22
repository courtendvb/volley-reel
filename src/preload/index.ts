import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ExportEvent, ImportProgress } from '../shared/types'

const api: Api = {
  getProject: () => ipcRenderer.invoke('project:get'),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  scanFolders: () => ipcRenderer.invoke('library:scan'),
  importPairs: pairs => ipcRenderer.invoke('library:importPairs', pairs),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  createProject: init => ipcRenderer.invoke('project:create', init),
  openProject: path => ipcRenderer.invoke('project:open', path),
  closeProject: () => ipcRenderer.invoke('project:close'),
  setProjectMatches: ids => ipcRenderer.invoke('project:setMatches', ids),
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
  smokeScan: folders => ipcRenderer.invoke('smoke:scan', folders),
  smokeCreateProject: (dir, init) => ipcRenderer.invoke('smoke:createProject', dir, init),
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
