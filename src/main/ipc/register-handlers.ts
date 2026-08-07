import type { IpcMain } from 'electron'

import type { AuthenticationIpcHandlerDependencies } from '@main/ipc/authentication'
import { createAuthenticationIpcHandlers } from '@main/ipc/authentication'
import type { AppIpcHandlerDependencies } from '@main/ipc/handlers/app-handlers'
import { createAppIpcHandlers } from '@main/ipc/handlers/app-handlers'
import type { FirstRunIpcHandlerDependencies } from '@main/ipc/handlers/first-run-handlers'
import { createFirstRunIpcHandlers } from '@main/ipc/handlers/first-run-handlers'
import type { PatientIpcHandlerDependencies } from '@main/ipc/handlers/patient-handlers'
import { createPatientIpcHandlers } from '@main/ipc/handlers/patient-handlers'
import type { ScreeningEncounterIpcHandlerDependencies } from '@main/ipc/handlers/screening-encounter-handlers'
import { createScreeningEncounterIpcHandlers } from '@main/ipc/handlers/screening-encounter-handlers'
import type { ScreeningSessionIpcHandlerDependencies } from '@main/ipc/handlers/screening-session-handlers'
import { createScreeningSessionIpcHandlers } from '@main/ipc/handlers/screening-session-handlers'
import {
  ipcChannels,
  type ScreeningEncounterIpcChannel,
  type ScreeningSessionIpcChannel
} from '@shared/ipc'

export type ApplicationIpcMain = Pick<IpcMain, 'handle' | 'removeHandler'>
export type ApplicationIpcDisposer = () => void
type ApplicationIpcListener = Parameters<ApplicationIpcMain['handle']>[1]
interface ScreeningSessionRegistrationOwnership {
  readonly id: symbol
}
interface ScreeningEncounterRegistrationOwnership {
  readonly id: symbol
}

export class ApplicationIpcRegistrationError extends Error {
  constructor() {
    super('Application IPC handler registration failed.')
    this.name = 'ApplicationIpcRegistrationError'
    delete this.stack
  }
}

const screeningSessionIpcChannels: readonly ScreeningSessionIpcChannel[] = Object.freeze([
  ipcChannels.screeningSessions.getWorkspaceContext,
  ipcChannels.screeningSessions.create,
  ipcChannels.screeningSessions.close,
  ipcChannels.screeningSessions.reopen,
  ipcChannels.screeningSessions.getById,
  ipcChannels.screeningSessions.list
])
const activeScreeningSessionRegistrations = new WeakMap<
  ApplicationIpcMain,
  ScreeningSessionRegistrationOwnership
>()
const screeningEncounterIpcChannels: readonly ScreeningEncounterIpcChannel[] = Object.freeze([
  ipcChannels.screeningEncounters.start
])
const activeScreeningEncounterRegistrations = new WeakMap<
  ApplicationIpcMain,
  ScreeningEncounterRegistrationOwnership
>()

export interface ApplicationIpcHandlerDependencies extends AppIpcHandlerDependencies {
  readonly firstRun: FirstRunIpcHandlerDependencies
  readonly auth: AuthenticationIpcHandlerDependencies
  readonly patient: PatientIpcHandlerDependencies
  readonly screeningSessions: ScreeningSessionIpcHandlerDependencies
  readonly screeningEncounters: ScreeningEncounterIpcHandlerDependencies
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
  registerScreeningEncounterIpcHandlers(applicationIpcMain, dependencies.screeningEncounters)

  return () => {
    disposeApplicationIpcHandlers(applicationIpcMain)
    dependencies.auth.sessionPublisher.dispose()
  }
}

export function registerScreeningSessionIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ScreeningSessionIpcHandlerDependencies
): ApplicationIpcDisposer {
  if (activeScreeningSessionRegistrations.has(applicationIpcMain)) {
    throw new ApplicationIpcRegistrationError()
  }

  const ownership: ScreeningSessionRegistrationOwnership = Object.freeze({
    id: Symbol('screening-session-ipc-registration')
  })
  const screeningSessionHandlers = createScreeningSessionIpcHandlers(dependencies)
  const registrations: ReadonlyArray<
    readonly [ScreeningSessionIpcChannel, ApplicationIpcListener]
  > = [
    [
      ipcChannels.screeningSessions.getWorkspaceContext,
      screeningSessionHandlers.getWorkspaceContext
    ],
    [ipcChannels.screeningSessions.create, screeningSessionHandlers.create],
    [ipcChannels.screeningSessions.close, screeningSessionHandlers.close],
    [ipcChannels.screeningSessions.reopen, screeningSessionHandlers.reopen],
    [ipcChannels.screeningSessions.getById, screeningSessionHandlers.getById],
    [ipcChannels.screeningSessions.list, screeningSessionHandlers.list]
  ]
  const installedChannels: ScreeningSessionIpcChannel[] = []

  try {
    for (const [channel, listener] of registrations) {
      applicationIpcMain.handle(channel, listener)
      installedChannels.push(channel)
    }
  } catch {
    for (const channel of installedChannels.reverse()) {
      applicationIpcMain.removeHandler(channel)
    }

    throw new ApplicationIpcRegistrationError()
  }

  activeScreeningSessionRegistrations.set(applicationIpcMain, ownership)

  return () => disposeScreeningSessionRegistration(applicationIpcMain, ownership)
}

export function registerScreeningEncounterIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ScreeningEncounterIpcHandlerDependencies
): ApplicationIpcDisposer {
  if (activeScreeningEncounterRegistrations.has(applicationIpcMain)) {
    throw new ApplicationIpcRegistrationError()
  }

  const ownership: ScreeningEncounterRegistrationOwnership = Object.freeze({
    id: Symbol('screening-encounter-ipc-registration')
  })
  const screeningEncounterHandlers = createScreeningEncounterIpcHandlers(dependencies)
  const installedChannels: ScreeningEncounterIpcChannel[] = []

  try {
    applicationIpcMain.handle(
      ipcChannels.screeningEncounters.start,
      screeningEncounterHandlers.start
    )
    installedChannels.push(ipcChannels.screeningEncounters.start)
  } catch {
    for (const channel of installedChannels.reverse()) {
      applicationIpcMain.removeHandler(channel)
    }

    throw new ApplicationIpcRegistrationError()
  }

  activeScreeningEncounterRegistrations.set(applicationIpcMain, ownership)

  return () => disposeScreeningEncounterRegistration(applicationIpcMain, ownership)
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
  disposeScreeningEncounterIpcHandlers(applicationIpcMain)
}

export function disposeScreeningSessionIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  for (const channel of screeningSessionIpcChannels) {
    applicationIpcMain.removeHandler(channel)
  }

  activeScreeningSessionRegistrations.delete(applicationIpcMain)
}

function disposeScreeningSessionRegistration(
  applicationIpcMain: ApplicationIpcMain,
  ownership: ScreeningSessionRegistrationOwnership
): void {
  if (activeScreeningSessionRegistrations.get(applicationIpcMain) !== ownership) {
    return
  }

  disposeScreeningSessionIpcHandlers(applicationIpcMain)
}

export function disposeScreeningEncounterIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  for (const channel of screeningEncounterIpcChannels) {
    applicationIpcMain.removeHandler(channel)
  }

  activeScreeningEncounterRegistrations.delete(applicationIpcMain)
}

function disposeScreeningEncounterRegistration(
  applicationIpcMain: ApplicationIpcMain,
  ownership: ScreeningEncounterRegistrationOwnership
): void {
  if (activeScreeningEncounterRegistrations.get(applicationIpcMain) !== ownership) {
    return
  }

  disposeScreeningEncounterIpcHandlers(applicationIpcMain)
}
