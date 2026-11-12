import { contextBridge, ipcRenderer } from 'electron'
import type { Api, ExportEvent, ImportProgress, UpdateEvent } from '../shared/types'

const api: Api = {
  getProject: () => ipcRenderer.invoke('project:get'),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  chooseLibrary: () => ipcRenderer.invoke('library:choose'),
  scanFolders: () => ipcRenderer.invoke('library:scan'),
  importPairs: pairs => ipcRenderer.invoke('library:importPairs', pairs),
  recentProjects: () => ipcRenderer.invoke('project:recent'),
  createProject: init => ipcRenderer.invoke('project:create', init),
  openProject: path => ipcRenderer.invoke('project:open', path),
  openMatchProject: (matchId, code) => ipcRenderer.invoke('project:openMatch', matchId, code),
  closeProject: () => ipcRenderer.invoke('project:close'),
  setProjectMatches: ids => ipcRenderer.invoke('project:setMatches', ids),
  importMatch: () => ipcRenderer.invoke('match:import'),
  relocateMatch: (id, part) => ipcRenderer.invoke('match:relocate', id, part),
  parseMatch: id => ipcRenderer.invoke('match:parse', id),
  setMatchCourt: (id, court) => ipcRenderer.invoke('match:setCourt', id, court),
  saveSettings: s => ipcRenderer.invoke('project:saveSettings', s),
  listReels: () => ipcRenderer.invoke('reel:list'),
  listVideos: () => ipcRenderer.invoke('video:list'),
  saveVideo: v => ipcRenderer.invoke('video:save', v),
  deleteVideo: id => ipcRenderer.invoke('video:delete', id),
  saveReel: r => ipcRenderer.invoke('reel:save', r),
  deleteReel: id => ipcRenderer.invoke('reel:delete', id),
  chooseExportPath: name => ipcRenderer.invoke('export:choosePath', name),
  chooseExportFolder: names => ipcRenderer.invoke('export:chooseFolder', names),
  startExport: job => ipcRenderer.invoke('export:start', job),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onUpdateEvent: cb => {
    const h = (_e: unknown, ev: UpdateEvent) => cb(ev)
    ipcRenderer.on('update:event', h)
    return () => ipcRenderer.off('update:event', h)
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  updateHelp: what => ipcRenderer.invoke('update:help', what),
  appVersion: () => ipcRenderer.invoke('app:version'),
  lang: ipcRenderer.sendSync('app:lang'),
  setLanguage: l => ipcRenderer.invoke('app:setLang', l),
  onExportEvent: cb => {
    const h = (_e: unknown, ev: ExportEvent) => cb(ev)
    ipcRenderer.on('export:event', h)
    return () => ipcRenderer.off('export:event', h)
  },
  showInFolder: p => ipcRenderer.invoke('shell:showInFolder', p),
  takeNotices: () => ipcRenderer.invoke('project:notices'),
  pickAsset: () => ipcRenderer.invoke('asset:pick'),
  saveAsset: png => ipcRenderer.invoke('asset:save', png),
  clipboardKind: () => ipcRenderer.invoke('clipboard:kind'),
  markObjectsCopied: () => ipcRenderer.invoke('clipboard:markObjects'),
  saveClipboardImage: () => ipcRenderer.invoke('clipboard:saveImage'),
  readAsset: id => ipcRenderer.invoke('asset:read', id),
  smokePickAsset: path => ipcRenderer.invoke('smoke:pickAsset', path),
  pickSlides: () => ipcRenderer.invoke('slide:pick'),
  readSlideFile: path => ipcRenderer.invoke('slide:read', path),
  slideFileTimes: paths => ipcRenderer.invoke('slide:times', paths),
  grabFrame: (matchId, sec) => ipcRenderer.invoke('slide:frame', matchId, sec),
  detectCourt: matchId => ipcRenderer.invoke('court:detect', matchId),
  smokePickSlides: paths => ipcRenderer.invoke('smoke:pickSlides', paths),
  smokeTouch: path => ipcRenderer.invoke('smoke:touch', path),
  getPalette: () => ipcRenderer.invoke('palette:get'),
  setPaletteColors: colors => ipcRenderer.invoke('palette:setColors', colors),
  savePaletteItem: (name, annotations, category) => ipcRenderer.invoke('palette:save', name, annotations, category ?? null),
  addPaletteCategory: name => ipcRenderer.invoke('palette:addCategory', name),
  renamePaletteCategory: (id, name) => ipcRenderer.invoke('palette:renameCategory', id, name),
  movePaletteCategory: (id, to) => ipcRenderer.invoke('palette:moveCategory', id, to),
  removePaletteCategory: id => ipcRenderer.invoke('palette:removeCategory', id),
  setPaletteItemCategory: (id, category) => ipcRenderer.invoke('palette:setCategory', id, category),
  removePaletteItem: id => ipcRenderer.invoke('palette:remove', id),
  movePaletteItem: (id, to) => ipcRenderer.invoke('palette:move', id, to),
  lockPaletteItem: (id, locked) => ipcRenderer.invoke('palette:lock', id, locked),
  usePaletteItem: id => ipcRenderer.invoke('palette:use', id),
  listLogos: () => ipcRenderer.invoke('logo:list'),
  pickLogo: code => ipcRenderer.invoke('logo:pick', code),
  removeLogo: code => ipcRenderer.invoke('logo:remove', code),
  readLogo: code => ipcRenderer.invoke('logo:read', code),
  useLogo: code => ipcRenderer.invoke('logo:use', code),
  listPacks: () => ipcRenderer.invoke('pack:list'),
  importPack: () => ipcRenderer.invoke('pack:import'),
  removePack: id => ipcRenderer.invoke('pack:remove', id),
  packRoster: () => ipcRenderer.invoke('pack:roster'),
  saveCard: (name, ext, data) => ipcRenderer.invoke('card:save', name, ext, data),
  saveReportPdf: (html, name) => ipcRenderer.invoke('report:pdf', html, name),
  savePack: (manifest, photos, install) => ipcRenderer.invoke('pack:save', manifest, photos, install),
  readPackPhoto: (id, photo) => ipcRenderer.invoke('pack:readPhoto', id, photo),
  setPlayerPhoto: target => ipcRenderer.invoke('pack:setPhoto', target),
  removePlayerPhoto: target => ipcRenderer.invoke('pack:removePhoto', target),
  usePackPhoto: (id, photo) => ipcRenderer.invoke('pack:usePhoto', id, photo),
  smokeImportPack: path => ipcRenderer.invoke('smoke:importPack', path),
  smokeSetPhoto: (target, path) => ipcRenderer.invoke('smoke:setPhoto', target, path),
  smokeRelocate: (id, part, path) => ipcRenderer.invoke('smoke:relocate', id, part, path),
  smokeSetLogo: (code, path) => ipcRenderer.invoke('smoke:setLogo', code, path),
  smokeClipboardImage: path => ipcRenderer.invoke('smoke:clipboardImage', path),
  smokeShot: path => ipcRenderer.invoke('smoke:shot', path),
  smokeDrag: pts => ipcRenderer.invoke('smoke:drag', pts),
  smokeRightClick: (x, y) => ipcRenderer.invoke('smoke:rightClick', x, y),
  smokeKey: key => ipcRenderer.invoke('smoke:key', key),
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
