import type { IpcMain } from 'electron'

import type { AuthenticationIpcHandlerDependencies } from '@main/ipc/authentication'
import { createAuthenticationIpcHandlers } from '@main/ipc/authentication'
import type { AppIpcHandlerDependencies } from '@main/ipc/handlers/app-handlers'
import { createAppIpcHandlers } from '@main/ipc/handlers/app-handlers'
import type { FirstRunIpcHandlerDependencies } from '@main/ipc/handlers/first-run-handlers'
import { createFirstRunIpcHandlers } from '@main/ipc/handlers/first-run-handlers'
import type { PatientIpcHandlerDependencies } from '@main/ipc/handlers/patient-handlers'
import { createPatientIpcHandlers } from '@main/ipc/handlers/patient-handlers'
import type { ScreeningSessionIpcHandlerDependencies } from '@main/ipc/handlers/screening-session-handlers'
import { createScreeningSessionIpcHandlers } from '@main/ipc/handlers/screening-session-handlers'
import { ipcChannels } from '@shared/ipc'

export type ApplicationIpcMain = Pick<IpcMain, 'handle' | 'removeHandler'>
export type ApplicationIpcDisposer = () => void
export interface ApplicationIpcHandlerDependencies extends AppIpcHandlerDependencies {
  readonly firstRun: FirstRunIpcHandlerDependencies
  readonly auth: AuthenticationIpcHandlerDependencies
  readonly patient: PatientIpcHandlerDependencies
  readonly screeningSessions: ScreeningSessionIpcHandlerDependencies
}

export function registerApplicationIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ApplicationIpcHandlerDependencies
): ApplicationIpcDisposer {
  disposeApplicationIpcHandlers(applicationIpcMain)

  const appHandlers = createAppIpcHandlers(dependencies)
  const firstRunHandlers = createFirstRunIpcHandlers(dependencies.firstRun)
  const authenticationHandlers = createAuthenticationIpcHandlers(dependencies.auth)
  const patientHandlers = createPatientIpcHandlers(dependencies.patient)

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
  applicationIpcMain.handle(ipcChannels.patient.get, patientHandlers.get)
  applicationIpcMain.handle(ipcChannels.patient.create, patientHandlers.create)
  applicationIpcMain.handle(
    ipcChannels.patient.amendDemographics,
    patientHandlers.amendDemographics
  )
  applicationIpcMain.handle(
    ipcChannels.patient.listDemographicAmendmentHistory,
    patientHandlers.listDemographicAmendmentHistory
  )
  applicationIpcMain.handle(
    ipcChannels.patient.recordAcknowledgment,
    patientHandlers.recordAcknowledgment
  )
  applicationIpcMain.handle(
    ipcChannels.patient.listAcknowledgmentHistory,
    patientHandlers.listAcknowledgmentHistory
  )
  applicationIpcMain.handle(ipcChannels.patient.listRecent, patientHandlers.listRecent)
  applicationIpcMain.handle(ipcChannels.patient.findDuplicates, patientHandlers.findDuplicates)
  applicationIpcMain.handle(ipcChannels.patient.markNotDuplicate, patientHandlers.markNotDuplicate)
  registerScreeningSessionIpcHandlers(applicationIpcMain, dependencies.screeningSessions)

  return () => {
    disposeApplicationIpcHandlers(applicationIpcMain)
    dependencies.auth.sessionPublisher.dispose()
  }
}

export function registerScreeningSessionIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ScreeningSessionIpcHandlerDependencies
): ApplicationIpcDisposer {
  disposeScreeningSessionIpcHandlers(applicationIpcMain)

  const screeningSessionHandlers = createScreeningSessionIpcHandlers(dependencies)

  applicationIpcMain.handle(
    ipcChannels.screeningSessions.getWorkspaceContext,
    screeningSessionHandlers.getWorkspaceContext
  )
  applicationIpcMain.handle(ipcChannels.screeningSessions.create, screeningSessionHandlers.create)
  applicationIpcMain.handle(ipcChannels.screeningSessions.close, screeningSessionHandlers.close)
  applicationIpcMain.handle(ipcChannels.screeningSessions.reopen, screeningSessionHandlers.reopen)
  applicationIpcMain.handle(ipcChannels.screeningSessions.getById, screeningSessionHandlers.getById)
  applicationIpcMain.handle(ipcChannels.screeningSessions.list, screeningSessionHandlers.list)

  return () => disposeScreeningSessionIpcHandlers(applicationIpcMain)
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
  applicationIpcMain.removeHandler(ipcChannels.patient.get)
  applicationIpcMain.removeHandler(ipcChannels.patient.create)
  applicationIpcMain.removeHandler(ipcChannels.patient.amendDemographics)
  applicationIpcMain.removeHandler(ipcChannels.patient.listDemographicAmendmentHistory)
  applicationIpcMain.removeHandler(ipcChannels.patient.recordAcknowledgment)
  applicationIpcMain.removeHandler(ipcChannels.patient.listAcknowledgmentHistory)
  applicationIpcMain.removeHandler(ipcChannels.patient.listRecent)
  applicationIpcMain.removeHandler(ipcChannels.patient.findDuplicates)
  applicationIpcMain.removeHandler(ipcChannels.patient.markNotDuplicate)
  disposeScreeningSessionIpcHandlers(applicationIpcMain)
}

export function disposeScreeningSessionIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  applicationIpcMain.removeHandler(ipcChannels.screeningSessions.getWorkspaceContext)
  applicationIpcMain.removeHandler(ipcChannels.screeningSessions.create)
  applicationIpcMain.removeHandler(ipcChannels.screeningSessions.close)
  applicationIpcMain.removeHandler(ipcChannels.screeningSessions.reopen)
  applicationIpcMain.removeHandler(ipcChannels.screeningSessions.getById)
  applicationIpcMain.removeHandler(ipcChannels.screeningSessions.list)
}
