import type { IpcMain } from 'electron'

import type { AuthenticationIpcHandlerDependencies } from '@main/ipc/authentication'
import { createAuthenticationIpcHandlers } from '@main/ipc/authentication'
import type { AppIpcHandlerDependencies } from '@main/ipc/handlers/app-handlers'
import { createAppIpcHandlers } from '@main/ipc/handlers/app-handlers'
import type { FirstRunIpcHandlerDependencies } from '@main/ipc/handlers/first-run-handlers'
import { createFirstRunIpcHandlers } from '@main/ipc/handlers/first-run-handlers'
import type { PatientIpcHandlerDependencies } from '@main/ipc/handlers/patient-handlers'
import { createPatientIpcHandlers } from '@main/ipc/handlers/patient-handlers'
import { ipcChannels } from '@shared/ipc'

export type ApplicationIpcMain = Pick<IpcMain, 'handle' | 'removeHandler'>
export type ApplicationIpcDisposer = () => void
export interface ApplicationIpcHandlerDependencies extends AppIpcHandlerDependencies {
  readonly firstRun: FirstRunIpcHandlerDependencies
  readonly auth: AuthenticationIpcHandlerDependencies
  readonly patient: PatientIpcHandlerDependencies
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
  applicationIpcMain.handle(ipcChannels.patient.update, patientHandlers.update)
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
  applicationIpcMain.removeHandler(ipcChannels.patient.get)
  applicationIpcMain.removeHandler(ipcChannels.patient.create)
  applicationIpcMain.removeHandler(ipcChannels.patient.update)
  applicationIpcMain.removeHandler(ipcChannels.patient.amendDemographics)
  applicationIpcMain.removeHandler(ipcChannels.patient.listDemographicAmendmentHistory)
  applicationIpcMain.removeHandler(ipcChannels.patient.recordAcknowledgment)
  applicationIpcMain.removeHandler(ipcChannels.patient.listAcknowledgmentHistory)
  applicationIpcMain.removeHandler(ipcChannels.patient.listRecent)
  applicationIpcMain.removeHandler(ipcChannels.patient.findDuplicates)
  applicationIpcMain.removeHandler(ipcChannels.patient.markNotDuplicate)
}
