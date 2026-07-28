import { BrowserWindow } from 'electron'

import {
  createDevelopmentNavigationPolicy,
  createProductionNavigationPolicy,
  isNavigationAllowed,
  type NavigationPolicy
} from '@main/app/navigation-policy'
import { createMainWindowOptions } from '@main/app/window-options'

export interface MainWindowConfiguration {
  isDevelopment: boolean
  preloadPath: string
  rendererIndexPath: string
  rendererUrl?: string
  platform?: NodeJS.Platform
  iconPath?: string
}

let mainWindow: BrowserWindow | null = null

export function hasMainWindow(): boolean {
  return mainWindow !== null && !mainWindow.isDestroyed()
}

export async function createOrFocusMainWindow(
  configuration: MainWindowConfiguration
): Promise<BrowserWindow> {
  if (hasMainWindow() && mainWindow) {
    restoreAndFocus(mainWindow)
    return mainWindow
  }

  const navigationPolicy = createNavigationPolicy(configuration)
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
  attachNavigationGuards(window, navigationPolicy)

  await loadApplication(window, configuration, navigationPolicy)

  return window
}

function createNavigationPolicy(configuration: MainWindowConfiguration): NavigationPolicy {
  if (configuration.isDevelopment) {
    if (!configuration.rendererUrl) {
      throw new Error('Development renderer URL is not configured.')
    }

    return createDevelopmentNavigationPolicy(configuration.rendererUrl)
  }

  return createProductionNavigationPolicy(configuration.rendererIndexPath)
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
  configuration: MainWindowConfiguration,
  navigationPolicy: NavigationPolicy
): Promise<void> {
  if (configuration.isDevelopment) {
    await window.loadURL(navigationPolicy.applicationUrl)
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
