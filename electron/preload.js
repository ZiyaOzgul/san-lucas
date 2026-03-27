const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion:      () => ipcRenderer.sendSync('get-version'),
  getUserDataPath: () => ipcRenderer.sendSync('get-user-data-path'),
  db: {
    read:  ()     => ipcRenderer.invoke('db-read'),
    write: (data) => ipcRenderer.invoke('db-write', data),
  },
  images: {
    pickAndSave: async () => {
      const srcPath = await ipcRenderer.invoke('images:pick')
      if (!srcPath) return null
      return ipcRenderer.invoke('images:save', srcPath)
    },
  },
})
