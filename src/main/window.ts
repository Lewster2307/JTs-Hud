import { app, BrowserWindow, shell, screen, Rectangle } from 'electron'
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
  displayBounds?: Rectangle
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
        const displayBounds =
          data.displayBounds &&
          typeof data.displayBounds.x === 'number' &&
          typeof data.displayBounds.y === 'number' &&
          typeof data.displayBounds.width === 'number' &&
          typeof data.displayBounds.height === 'number'
            ? {
                x: data.displayBounds.x,
                y: data.displayBounds.y,
                width: data.displayBounds.width,
                height: data.displayBounds.height
              }
            : undefined

        return {
          width: Math.max(DEFAULT_WIDTH, data.width),
          height: Math.max(DEFAULT_HEIGHT, data.height),
          x: typeof data.x === 'number' ? data.x : undefined,
          y: typeof data.y === 'number' ? data.y : undefined,
          isMaximized: Boolean(data.isMaximized),
          isFullScreen: Boolean(data.isFullScreen),
          displayBounds
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
  const allDisplays = screen.getAllDisplays()

  let targetDisplay: Electron.Display | undefined

  if (savedState.displayBounds) {
    targetDisplay = allDisplays.find(
      (d) =>
        d.bounds.x === savedState.displayBounds?.x &&
        d.bounds.y === savedState.displayBounds?.y &&
        d.bounds.width === savedState.displayBounds?.width &&
        d.bounds.height === savedState.displayBounds?.height
    )
  }

  if (!targetDisplay && typeof savedState.x === 'number' && typeof savedState.y === 'number') {
    targetDisplay = screen.getDisplayMatching({
      x: savedState.x,
      y: savedState.y,
      width: savedState.width,
      height: savedState.height
    })
  }

  if (!targetDisplay) {
    targetDisplay = screen.getPrimaryDisplay()
  }

  const hasValidPosition =
    typeof savedState.x === 'number' &&
    typeof savedState.y === 'number' &&
    isPositionOnAnyDisplay(savedState.x, savedState.y)

  let initialX: number
  let initialY: number
  let initialWidth = savedState.width
  let initialHeight = savedState.height

  if (savedState.isFullScreen) {
    initialX = targetDisplay.bounds.x
    initialY = targetDisplay.bounds.y
    initialWidth = targetDisplay.bounds.width
    initialHeight = targetDisplay.bounds.height
  } else if (hasValidPosition) {
    initialX = savedState.x!
    initialY = savedState.y!
  } else {
    initialX = targetDisplay.bounds.x + Math.max(0, Math.round((targetDisplay.bounds.width - initialWidth) / 2))
    initialY = targetDisplay.bounds.y + Math.max(0, Math.round((targetDisplay.bounds.height - initialHeight) / 2))
  }

  const mainWindow = new BrowserWindow({
    title: 'JTs Hud Manager - Lewster2307s fork',
    minWidth: DEFAULT_WIDTH,
    minHeight: DEFAULT_HEIGHT,
    width: initialWidth,
    height: initialHeight,
    x: initialX,
    y: initialY,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // Explicitly position the window on the target display before entering fullscreen / maximize
  if (savedState.isFullScreen) {
    mainWindow.setBounds(targetDisplay.bounds)
    mainWindow.setFullScreen(true)
  } else if (savedState.isMaximized) {
    mainWindow.maximize()
  }

  mainWindow.on('ready-to-show', () => {
    if (savedState.isFullScreen) {
      mainWindow.setBounds(targetDisplay.bounds)
      if (!mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(true)
      }
    }
    mainWindow.show()
  })

  let saveTimeout: ReturnType<typeof setTimeout> | null = null

  const saveWindowState = () => {
    try {
      if (mainWindow.isDestroyed()) return
      const isMax = mainWindow.isMaximized()
      const isFS = mainWindow.isFullScreen()

      const currentBounds = mainWindow.getBounds()
      const currentDisplay = screen.getDisplayMatching(currentBounds)

      let normalWidth = savedState.width
      let normalHeight = savedState.height
      let normalX = savedState.x
      let normalY = savedState.y

      if (!isMax && !isFS) {
        normalWidth = currentBounds.width
        normalHeight = currentBounds.height
        normalX = currentBounds.x
        normalY = currentBounds.y
      } else {
        const isNormalOnDisplay =
          typeof normalX === 'number' &&
          typeof normalY === 'number' &&
          normalX >= currentDisplay.bounds.x &&
          normalX < currentDisplay.bounds.x + currentDisplay.bounds.width &&
          normalY >= currentDisplay.bounds.y &&
          normalY < currentDisplay.bounds.y + currentDisplay.bounds.height

        if (!isNormalOnDisplay) {
          normalX = currentDisplay.bounds.x + Math.max(0, Math.round((currentDisplay.bounds.width - normalWidth) / 2))
          normalY = currentDisplay.bounds.y + Math.max(0, Math.round((currentDisplay.bounds.height - normalHeight) / 2))
        }
      }

      const stateToSave: WindowState = {
        width: normalWidth,
        height: normalHeight,
        x: normalX,
        y: normalY,
        isMaximized: isMax,
        isFullScreen: isFS,
        displayBounds: currentDisplay.bounds
      }

      savedState.width = stateToSave.width
      savedState.height = stateToSave.height
      savedState.x = stateToSave.x
      savedState.y = stateToSave.y
      savedState.isMaximized = isMax
      savedState.isFullScreen = isFS
      savedState.displayBounds = stateToSave.displayBounds

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
