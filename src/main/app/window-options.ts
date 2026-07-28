import type { BrowserWindowConstructorOptions } from 'electron'

export interface MainWindowOptionsInput {
  preloadPath: string
  isDevelopment: boolean
  platform?: NodeJS.Platform
  iconPath?: string
}

export function createMainWindowOptions({
  preloadPath,
  isDevelopment,
  platform = process.platform,
  iconPath
}: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: 1100,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Health Screening Offline Desktop',
    autoHideMenuBar: true,
    ...(platform === 'linux' && iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      navigateOnDragDrop: false,
      devTools: isDevelopment
    }
  }
}
