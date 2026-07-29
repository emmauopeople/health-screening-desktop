import { app, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import { createElectronApplicationInfoProvider } from '@main/app/application-info'
import {
  createOrFocusMainWindow,
  hasMainWindow,
  type MainWindowConfiguration
} from '@main/app/main-window'
import { createRendererNavigationPolicy } from '@main/app/navigation-policy'
import { registerApplicationShutdown } from '@main/app/shutdown'
import {
  createDatabaseHealthProvider,
  createDatabaseRuntime,
  createProductionDatabaseMigrationRunner,
  getDatabasePath,
  type DatabaseRuntime
} from '@main/database'
import { registerApplicationIpcHandlers } from '@main/ipc/register-handlers'
import { configureSessionSecurity } from '@main/security/session-security'
import icon from '../../../resources/icon.png?asset'

export function startApplicationLifecycle(): void {
  const gotSingleInstanceLock = app.requestSingleInstanceLock()

  if (!gotSingleInstanceLock) {
    app.quit()
    return
  }

  const baseConfiguration = createMainWindowConfiguration()
  const navigationPolicy = createRendererNavigationPolicy(baseConfiguration)
  const configuration: MainWindowConfiguration = {
    ...baseConfiguration,
    navigationPolicy
  }

  app.whenReady().then(async () => {
    let databaseRuntime: DatabaseRuntime | undefined

    try {
      electronApp.setAppUserModelId('org.healthscreening.desktop')

      app.on('browser-window-created', (_, window) => {
        optimizer.watchWindowShortcuts(window)
      })

      configureSessionSecurity(session.defaultSession, {
        isDevelopment: configuration.isDevelopment,
        rendererUrl: configuration.rendererUrl
      })

      databaseRuntime = createDatabaseRuntime({
        databasePath: getDatabasePath(app.getPath('userData')),
        migrationRunner: createProductionDatabaseMigrationRunner({
          applicationVersion: app.getVersion(),
          logger: console
        }),
        logger: console
      })
      databaseRuntime.initialize()

      const applicationInfoProvider = createElectronApplicationInfoProvider(app)
      const databaseHealthProvider = createDatabaseHealthProvider(databaseRuntime)
      const disposeIpcHandlers = registerApplicationIpcHandlers(ipcMain, {
        navigationPolicy,
        applicationInfoProvider,
        databaseHealthProvider,
        logger: console
      })

      registerApplicationShutdown(app, disposeIpcHandlers, () => databaseRuntime?.close())

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
    } catch (error) {
      databaseRuntime?.close()
      logDatabaseStartupFailure(error)
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

function createMainWindowConfiguration(): Omit<MainWindowConfiguration, 'navigationPolicy'> {
  const rendererUrl = process.env['ELECTRON_RENDERER_URL']

  return {
    isDevelopment: is.dev && Boolean(rendererUrl),
    rendererUrl,
    preloadPath: join(__dirname, '../preload/index.js'),
    rendererIndexPath: join(__dirname, '../renderer/index.html'),
    platform: process.platform,
    ...(process.platform === 'linux' ? { iconPath: icon } : {})
  }
}

function logLifecycleError(message: string, error: unknown): void {
  const errorName = error instanceof Error ? error.name : typeof error
  const errorMessage = error instanceof Error && error.message ? `: ${error.message}` : ''

  console.error(`${message} (${errorName}${errorMessage})`)
}

function logDatabaseStartupFailure(error: unknown): void {
  const errorType = error instanceof Error ? error.name : typeof error

  console.error(`Database runtime initialization failed; phase=startup; errorType=${errorType}`)
}
