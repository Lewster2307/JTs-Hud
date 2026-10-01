import { app, BrowserWindow, shell, screen } from 'electron'
import { join } from 'path'
import fs from 'fs'
import { is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
  isFullScreen: boolean
}

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720

function getStateFilePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWindowState(): WindowState {
  try {
    const filePath = getStateFilePath()
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (typeof data.width === 'number' && typeof data.height === 'number') {
        return {
          width: Math.max(DEFAULT_WIDTH, data.width),
          height: Math.max(DEFAULT_HEIGHT, data.height),
          x: typeof data.x === 'number' ? data.x : undefined,
          y: typeof data.y === 'number' ? data.y : undefined,
          isMaximized: Boolean(data.isMaximized),
          isFullScreen: Boolean(data.isFullScreen)
        }
      }
    }
  } catch {
    // fallback to default on error
  }
  return {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    isMaximized: false,
    isFullScreen: false
  }
}

function isPositionOnAnyDisplay(x: number, y: number): boolean {
  const displays = screen.getAllDisplays()
  return displays.some((display) => {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds
    return x >= dx && x < dx + dw && y >= dy && y < dy + dh
  })
}

export function createWindow(): void {
  const savedState = loadWindowState()

  const hasValidPosition =
    typeof savedState.x === 'number' &&
    typeof savedState.y === 'number' &&
    isPositionOnAnyDisplay(savedState.x, savedState.y)

  const mainWindow = new BrowserWindow({
    minWidth: DEFAULT_WIDTH,
    minHeight: DEFAULT_HEIGHT,
    width: savedState.width,
    height: savedState.height,
    ...(hasValidPosition ? { x: savedState.x, y: savedState.y } : {}),
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Restore maximized or fullscreen state
  if (savedState.isFullScreen) {
    mainWindow.setFullScreen(true)
  } else if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  let saveTimeout: ReturnType<typeof setTimeout> | null = null

  const saveWindowState = () => {
    try {
      if (mainWindow.isDestroyed()) return
      const isMax = mainWindow.isMaximized()
      const isFS = mainWindow.isFullScreen()

      const currentBounds = mainWindow.getBounds()
      const stateToSave: WindowState = {
        width: !isMax && !isFS ? currentBounds.width : savedState.width,
        height: !isMax && !isFS ? currentBounds.height : savedState.height,
        x: !isMax && !isFS ? currentBounds.x : savedState.x,
        y: !isMax && !isFS ? currentBounds.y : savedState.y,
        isMaximized: isMax,
        isFullScreen: isFS
      }

      savedState.width = stateToSave.width
      savedState.height = stateToSave.height
      savedState.x = stateToSave.x
      savedState.y = stateToSave.y
      savedState.isMaximized = isMax
      savedState.isFullScreen = isFS

      fs.writeFileSync(getStateFilePath(), JSON.stringify(stateToSave, null, 2), 'utf-8')
    } catch {
      // ignore write errors
    }
  }

  const debouncedSave = () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveTimeout = setTimeout(saveWindowState, 300)
  }

  mainWindow.on('resize', debouncedSave)
  mainWindow.on('move', debouncedSave)
  mainWindow.on('maximize', () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveWindowState()
  })
  mainWindow.on('unmaximize', () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveWindowState()
  })
  mainWindow.on('enter-full-screen', () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveWindowState()
  })
  mainWindow.on('leave-full-screen', () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveWindowState()
  })

  // When the main window closes, close all other windows
  mainWindow.on('close', () => {
    if (saveTimeout) clearTimeout(saveTimeout)
    saveWindowState()
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.id !== mainWindow.id) win.destroy()
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}
