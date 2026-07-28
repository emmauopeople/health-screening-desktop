import { app } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import {
  createOrFocusMainWindow,
  hasMainWindow,
  type MainWindowConfiguration
} from '@main/app/main-window'
import icon from '../../../resources/icon.png?asset'

export function startApplicationLifecycle(): void {
  const gotSingleInstanceLock = app.requestSingleInstanceLock()

  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }

  const configuration = createMainWindowConfiguration()

  app
    .whenReady()
    .then(async () => {
      electronApp.setAppUserModelId('org.healthscreening.desktop')

      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      app.on('second-instance', () => {
        void createOrFocusMainWindow(configuration).catch((error: unknown) => {
          logLifecycleError('Unable to restore or focus the primary window.', error)
        })
      })

      await createOrFocusMainWindow(configuration)

      app.on('activate', () => {
        if (!hasMainWindow()) {
          void createOrFocusMainWindow(configuration).catch((error: unknown) => {
            logLifecycleError('Unable to create the primary window on activation.', error)
          })
        }
      })
    })
    .catch((error: unknown) => {
      logLifecycleError('Unable to start the application lifecycle.', error)
      app.quit()
    })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

function createMainWindowConfiguration(): MainWindowConfiguration {
  return {
    isDevelopment: is.dev,
    rendererUrl: process.env['ELECTRON_RENDERER_URL'],
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererIndexPath: join(__dirname, '../renderer/index.html'),
    platform: process.platform,
    ...(process.platform === 'linux' ? { iconPath: icon } : {})
  }
}

function logLifecycleError(message: string, error: unknown): void {
  const errorName = error instanceof Error ? error.name : typeof error

  console.error(`${message} (${errorName})`)
}
