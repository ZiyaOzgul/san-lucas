const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs   = require('fs')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

ipcMain.on('get-user-data-path', (event) => {
  event.returnValue = app.getPath('userData')
})

ipcMain.on('get-version', (event) => {
  event.returnValue = app.getVersion()
})

// ── SQLite file persistence ───────────────────────────────────────
const DB_FILE = () => path.join(app.getPath('userData'), 'san-lucas.db')

ipcMain.handle('db-read', () => {
  try {
    const buf = fs.readFileSync(DB_FILE())
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  } catch {
    return null // first run — no file yet
  }
})

ipcMain.handle('db-write', (event, data) => {
  try {
    fs.writeFileSync(DB_FILE(), Buffer.from(data))
  } catch (err) {
    console.error('[db-write] failed:', err)
  }
})

// ── Product image helpers ─────────────────────────────────────────
ipcMain.handle('images:pick', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Görseller', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
  })
  if (canceled || !filePaths.length) return null
  return filePaths[0]
})

ipcMain.handle('images:save', async (_event, sourcePath) => {
  const ext = path.extname(sourcePath)
  const filename = `${Date.now()}${ext}`
  const destDir = path.join(__dirname, '..', 'public', 'products')
  await fs.promises.mkdir(destDir, { recursive: true })
  await fs.promises.copyFile(sourcePath, path.join(destDir, filename))
  return `/products/${filename}`
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
