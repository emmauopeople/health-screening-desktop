import { app, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import { createElectronApplicationInfoProvider } from '@main/app/application-info'
import {
  createOrFocusMainWindow,
  getMainWindowWebContents,
  hasMainWindow,
  type MainWindowConfiguration
} from '@main/app/main-window'
import { createRendererNavigationPolicy } from '@main/app/navigation-policy'
import { registerApplicationShutdown } from '@main/app/shutdown'
import {
  createProductionFirstRunBootstrapService,
  createProductionCurrentScreeningSessionService,
  createProductionInstallationLocationService,
  createProductionLocalAuthenticationSessionService,
  createProductionPatientAcknowledgmentService,
  createProductionPatientDemographicAmendmentService,
  createProductionPatientRegistryService,
  createProductionScreeningEncounterStartService,
  createProductionScreeningEncounterManagementService,
  createProductionReferralService,
  createProductionScreeningCompletionService,
  createProductionScreeningFoodService,
  createProductionScreeningLifestyleService,
  createProductionScreeningOtcService,
  createProductionScreeningVitalsDraftService,
  createProductionScreeningSessionService,
  createProductionScreeningSessionWorkspaceContextService,
  createProductionSyncWorkerService,
  createSyncWorkerScheduler
} from '@main/application'
import {
  createDatabaseHealthProvider,
  createDatabaseRuntime,
  createProductionDatabaseMigrationRunner,
  createLocationRepository,
  getDatabasePath,
  targetSchemaVersion,
  type DatabaseRuntime
} from '@main/database'
import { createAuthenticationSessionPublisher } from '@main/ipc/authentication'
import { createElectronSyncCredentialProtector } from '@main/application/sync-transport/electron-credential-protector'
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
      const firstRunBootstrapService = createProductionFirstRunBootstrapService({
        connection: databaseRuntime.getConnection(),
        logger: console
      })
      const authenticationSessionService = await createProductionLocalAuthenticationSessionService({
        connection: databaseRuntime.getConnection(),
        logger: console
      })
      const patientRegistryService = createProductionPatientRegistryService({
        connection: databaseRuntime.getConnection(),
        logger: console
      })
      const patientDemographicAmendmentService = createProductionPatientDemographicAmendmentService(
        {
          connection: databaseRuntime.getConnection(),
          logger: console
        }
      )
      const patientAcknowledgmentService = createProductionPatientAcknowledgmentService({
        connection: databaseRuntime.getConnection(),
        logger: console
      })
      const screeningSessionService = createProductionScreeningSessionService({
        connection: databaseRuntime.getConnection(),
        logger: console
      })
      const currentScreeningSessionService = createProductionCurrentScreeningSessionService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        logger: console
      })
      const screeningEncounterStartService = createProductionScreeningEncounterStartService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        logger: console
      })
      const screeningSessionWorkspaceContextService =
        createProductionScreeningSessionWorkspaceContextService({
          connection: databaseRuntime.getConnection()
        })
      const installationLocationService = createProductionInstallationLocationService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        logger: console
      })
      const screeningVitalsDraftService = createProductionScreeningVitalsDraftService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        logger: console
      })
      const screeningLifestyleService = createProductionScreeningLifestyleService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        logger: console
      })
      const screeningFoodService = createProductionScreeningFoodService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        logger: console
      })
      const screeningOtcService = createProductionScreeningOtcService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        logger: console
      })
      const screeningCompletionService = createProductionScreeningCompletionService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        currentScreeningSessionService,
        installationLocationService,
        logger: console
      })
      const screeningEncounterManagementService =
        createProductionScreeningEncounterManagementService({
          connection: databaseRuntime.getConnection(),
          authenticationSessionService,
          installationLocationService,
          currentScreeningSessionService,
          logger: console
        })
      const referralService = createProductionReferralService({
        connection: databaseRuntime.getConnection(),
        authenticationSessionService,
        installationLocationService,
        logger: console
      })
      const syncWorkerScheduler = createSyncWorkerScheduler(
        createProductionSyncWorkerService({
          connection: databaseRuntime.getConnection(),
          desktopApplicationVersion: app.getVersion(),
          desktopSchemaVersion: targetSchemaVersion,
          credentialProtector: createElectronSyncCredentialProtector(),
          logger: console
        })
      )
      const locationRepository = createLocationRepository(databaseRuntime.getConnection())
      const authenticationSessionPublisher = createAuthenticationSessionPublisher({
        navigationPolicy,
        getWebContents: getMainWindowWebContents
      })
      const disposeIpcHandlers = registerApplicationIpcHandlers(ipcMain, {
        navigationPolicy,
        applicationInfoProvider,
        databaseHealthProvider,
        firstRun: {
          navigationPolicy,
          firstRunBootstrapService,
          logger: console
        },
        auth: {
          navigationPolicy,
          authenticationSessionService,
          sessionPublisher: authenticationSessionPublisher,
          logger: console
        },
        patient: {
          navigationPolicy,
          authenticationSessionService,
          patientRegistryService,
          patientDemographicAmendmentService,
          patientAcknowledgmentService,
          logger: console
        },
        referrals: {
          navigationPolicy,
          referralService,
          logger: console
        },
        screeningSessions: {
          navigationPolicy,
          authenticationSessionService,
          currentScreeningSessionService,
          screeningSessionService,
          screeningSessionWorkspaceContextService,
          logger: console
        },
        screeningEncounters: {
          navigationPolicy,
          screeningEncounterStartService,
          screeningCompletionService,
          screeningEncounterManagementService,
          screeningVitalsDraftService,
          logger: console
        },
        screeningLifestyle: {
          navigationPolicy,
          screeningLifestyleService,
          logger: console
        },
        screeningFood: {
          navigationPolicy,
          screeningFoodService,
          logger: console
        },
        screeningOtc: {
          navigationPolicy,
          screeningOtcService,
          logger: console
        },
        installationSettings: {
          navigationPolicy,
          authenticationSessionService,
          installationLocationService,
          locationRepository,
          logger: console
        },
        logger: console
      })

      registerApplicationShutdown(
        app,
        () => {
          syncWorkerScheduler.stop()
          disposeIpcHandlers()
        },
        () => databaseRuntime?.close()
      )

      syncWorkerScheduler.start()

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
