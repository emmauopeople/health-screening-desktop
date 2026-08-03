import type { IpcMain } from 'electron'

import type { AuthenticationIpcHandlerDependencies } from '@main/ipc/authentication'
import { createAuthenticationIpcHandlers } from '@main/ipc/authentication'
import type { AppIpcHandlerDependencies } from '@main/ipc/handlers/app-handlers'
import { createAppIpcHandlers } from '@main/ipc/handlers/app-handlers'
import type { FirstRunIpcHandlerDependencies } from '@main/ipc/handlers/first-run-handlers'
import { createFirstRunIpcHandlers } from '@main/ipc/handlers/first-run-handlers'
import type { PatientIpcHandlerDependencies } from '@main/ipc/handlers/patient-handlers'
import { createPatientIpcHandlers } from '@main/ipc/handlers/patient-handlers'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication'
import { ipcChannels } from '@shared/ipc'

export type ApplicationIpcMain = Pick<IpcMain, 'handle' | 'removeHandler'>
export type ApplicationIpcDisposer = () => void
export interface ApplicationIpcHandlerDependencies extends AppIpcHandlerDependencies {
  readonly firstRun: FirstRunIpcHandlerDependencies
  readonly auth: AuthenticationIpcHandlerDependencies
  readonly patient: Omit<PatientIpcHandlerDependencies, 'authorization'>
}

export function registerApplicationIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ApplicationIpcHandlerDependencies
): ApplicationIpcDisposer {
  disposeApplicationIpcHandlers(applicationIpcMain)

  const appHandlers = createAppIpcHandlers(dependencies)
  const firstRunHandlers = createFirstRunIpcHandlers(dependencies.firstRun)
  const authenticationHandlers = createAuthenticationIpcHandlers(dependencies.auth)
  const authenticatedAuthorization = createAuthenticatedHandlerAuthorization({
    navigationPolicy: dependencies.patient.navigationPolicy,
    authenticationSessionService: dependencies.auth.authenticationSessionService,
    logger: dependencies.patient.logger
  })
  const patientHandlers = createPatientIpcHandlers({
    ...dependencies.patient,
    authorization: authenticatedAuthorization
  })

  applicationIpcMain.handle(ipcChannels.app.getInfo, appHandlers.getInfo)
  applicationIpcMain.handle(ipcChannels.app.getHealth, appHandlers.getHealth)
  applicationIpcMain.handle(ipcChannels.firstRun.getState, firstRunHandlers.getState)
  applicationIpcMain.handle(ipcChannels.firstRun.initialize, firstRunHandlers.initialize)
  applicationIpcMain.handle(ipcChannels.auth.getSession, authenticationHandlers.getSession)
  applicationIpcMain.handle(ipcChannels.auth.login, authenticationHandlers.login)
  applicationIpcMain.handle(
    ipcChannels.auth.changeRequiredPassword,
    authenticationHandlers.changeRequiredPassword
  )
  applicationIpcMain.handle(ipcChannels.auth.unlock, authenticationHandlers.unlock)
  applicationIpcMain.handle(ipcChannels.auth.lock, authenticationHandlers.lock)
  applicationIpcMain.handle(ipcChannels.auth.logout, authenticationHandlers.logout)
  applicationIpcMain.handle(ipcChannels.auth.recordActivity, authenticationHandlers.recordActivity)
  applicationIpcMain.handle(ipcChannels.patient.search, patientHandlers.search)
  applicationIpcMain.handle(ipcChannels.patient.getSummary, patientHandlers.getSummary)
  applicationIpcMain.handle(ipcChannels.patient.findDuplicates, patientHandlers.findDuplicates)
  applicationIpcMain.handle(ipcChannels.patient.create, patientHandlers.create)

  return () => {
    disposeApplicationIpcHandlers(applicationIpcMain)
    dependencies.auth.sessionPublisher.dispose()
  }
}

export function disposeApplicationIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  applicationIpcMain.removeHandler(ipcChannels.app.getInfo)
  applicationIpcMain.removeHandler(ipcChannels.app.getHealth)
  applicationIpcMain.removeHandler(ipcChannels.firstRun.getState)
  applicationIpcMain.removeHandler(ipcChannels.firstRun.initialize)
  applicationIpcMain.removeHandler(ipcChannels.auth.getSession)
  applicationIpcMain.removeHandler(ipcChannels.auth.login)
  applicationIpcMain.removeHandler(ipcChannels.auth.changeRequiredPassword)
  applicationIpcMain.removeHandler(ipcChannels.auth.unlock)
  applicationIpcMain.removeHandler(ipcChannels.auth.lock)
  applicationIpcMain.removeHandler(ipcChannels.auth.logout)
  applicationIpcMain.removeHandler(ipcChannels.auth.recordActivity)
  applicationIpcMain.removeHandler(ipcChannels.patient.search)
  applicationIpcMain.removeHandler(ipcChannels.patient.getSummary)
  applicationIpcMain.removeHandler(ipcChannels.patient.findDuplicates)
  applicationIpcMain.removeHandler(ipcChannels.patient.create)
}
