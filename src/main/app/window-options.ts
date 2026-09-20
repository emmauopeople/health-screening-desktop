import type { BrowserWindowConstructorOptions } from 'electron'

export interface MainWindowOptionsInput {
  preloadPath: string
  isDevelopment: boolean
  platform?: NodeJS.Platform
  iconPath?: string
  workAreaSize?: { readonly width: number; readonly height: number }
}

export function createMainWindowOptions({
  preloadPath,
  isDevelopment,
  platform = process.platform,
  iconPath,
  workAreaSize
}: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: Math.min(1100, workAreaSize?.width ?? 1100),
    height: Math.min(720, workAreaSize?.height ?? 720),
    minWidth: Math.min(640, workAreaSize?.width ?? 640),
    minHeight: Math.min(480, workAreaSize?.height ?? 480),
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
