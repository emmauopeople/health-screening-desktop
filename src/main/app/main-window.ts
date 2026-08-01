import { BrowserWindow } from 'electron'

import { isNavigationAllowed, type NavigationPolicy } from '@main/app/navigation-policy'
import { createMainWindowOptions } from '@main/app/window-options'

export interface MainWindowConfiguration {
  isDevelopment: boolean
  preloadPath: string
  rendererIndexPath: string
  navigationPolicy: NavigationPolicy
  rendererUrl?: string
  platform?: NodeJS.Platform
  iconPath?: string
}

let mainWindow: BrowserWindow | null = null

export function hasMainWindow(): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed()
}

export function getMainWindowWebContents(): BrowserWindow['webContents'] | null {
  return hasMainWindow() && mainWindow ? mainWindow.webContents : null
}

export async function createOrFocusMainWindow(
  configuration: MainWindowConfiguration
): Promise<BrowserWindow> {
  if (hasMainWindow() && mainWindow) {
    restoreAndFocus(mainWindow)
    return mainWindow
  }

  const window = new BrowserWindow(
    createMainWindowOptions({
      preloadPath: configuration.preloadPath,
      isDevelopment: configuration.isDevelopment,
      platform: configuration.platform,
      iconPath: configuration.iconPath
    })
  )

  mainWindow = window

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  attachWindowFailureVisibility(window)
  attachNavigationGuards(window, configuration.navigationPolicy)

  await loadApplication(window, configuration)

  return window
}

function attachNavigationGuards(window: BrowserWindow, navigationPolicy: NavigationPolicy): void {
  const { webContents } = window

  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  webContents.on('will-navigate', (event) => {
    if (!isNavigationAllowed(event.url, navigationPolicy)) {
      event.preventDefault()
    }
  })

  webContents.on('will-redirect', (event) => {
    if (!isNavigationAllowed(event.url, navigationPolicy)) {
      event.preventDefault()
    }
  })

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

function attachWindowFailureVisibility(window: BrowserWindow): void {
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `Renderer process ended unexpectedly. reason=${details.reason}; exitCode=${details.exitCode}`
    )
  })

  window.webContents.on('unresponsive', () => {
    console.error('Renderer process became unresponsive.')
  })
}

async function loadApplication(
  window: BrowserWindow,
  configuration: MainWindowConfiguration
): Promise<void> {
  if (configuration.isDevelopment) {
    await window.loadURL(configuration.navigationPolicy.applicationUrl)
    return
  }

  await window.loadFile(configuration.rendererIndexPath)
}

function restoreAndFocus(window: BrowserWindow): void {
  if (window.isMinimized()) {
    window.restore()
  }

  window.focus()
}
