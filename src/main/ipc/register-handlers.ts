import type { IpcMain } from 'electron'

import type { AuthenticationIpcHandlerDependencies } from '@main/ipc/authentication'
import { createAuthenticationIpcHandlers } from '@main/ipc/authentication'
import type { AppIpcHandlerDependencies } from '@main/ipc/handlers/app-handlers'
import { createAppIpcHandlers } from '@main/ipc/handlers/app-handlers'
import type { FirstRunIpcHandlerDependencies } from '@main/ipc/handlers/first-run-handlers'
import { createFirstRunIpcHandlers } from '@main/ipc/handlers/first-run-handlers'
import type { InstallationSettingsIpcHandlerDependencies } from '@main/ipc/handlers/installation-settings-handlers'
import { createInstallationSettingsIpcHandlers } from '@main/ipc/handlers/installation-settings-handlers'
import type { PatientIpcHandlerDependencies } from '@main/ipc/handlers/patient-handlers'
import { createPatientIpcHandlers } from '@main/ipc/handlers/patient-handlers'
import type { ScreeningEncounterIpcHandlerDependencies } from '@main/ipc/handlers/screening-encounter-handlers'
import { createScreeningEncounterIpcHandlers } from '@main/ipc/handlers/screening-encounter-handlers'
import type { ScreeningLifestyleIpcHandlerDependencies } from '@main/ipc/handlers/screening-lifestyle-handlers'
import { createScreeningLifestyleIpcHandlers } from '@main/ipc/handlers/screening-lifestyle-handlers'
import type { ScreeningSessionIpcHandlerDependencies } from '@main/ipc/handlers/screening-session-handlers'
import { createScreeningSessionIpcHandlers } from '@main/ipc/handlers/screening-session-handlers'
import {
  ipcChannels,
  type InstallationSettingsIpcChannel,
  type ScreeningEncounterIpcChannel,
  type ScreeningLifestyleIpcChannel,
  type ScreeningSessionIpcChannel
} from '@shared/ipc'

export type ApplicationIpcMain = Pick<IpcMain, 'handle' | 'removeHandler'>
export type ApplicationIpcDisposer = () => void
type ApplicationIpcListener = Parameters<ApplicationIpcMain['handle']>[1]
interface ApplicationRegistrationOwnership {
  readonly id: symbol
  readonly sessionPublisher: AuthenticationIpcHandlerDependencies['sessionPublisher']
}
interface ScreeningSessionRegistrationOwnership {
  readonly id: symbol
}
interface ScreeningEncounterRegistrationOwnership {
  readonly id: symbol
}
interface ScreeningLifestyleRegistrationOwnership {
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
  ipcChannels.screeningSessions.ensureCurrent,
  ipcChannels.screeningSessions.create,
  ipcChannels.screeningSessions.close,
  ipcChannels.screeningSessions.reopen,
  ipcChannels.screeningSessions.getById,
  ipcChannels.screeningSessions.list
])
const installationSettingsIpcChannels: readonly InstallationSettingsIpcChannel[] = Object.freeze([
  ipcChannels.installationSettings.getConfiguredLocation,
  ipcChannels.installationSettings.listEligibleLocations,
  ipcChannels.installationSettings.assignInitialLocation,
  ipcChannels.installationSettings.reconfigureLocation
])
const activeScreeningSessionRegistrations = new WeakMap<
  ApplicationIpcMain,
  ScreeningSessionRegistrationOwnership
>()
const activeApplicationRegistrations = new WeakMap<
  ApplicationIpcMain,
  ApplicationRegistrationOwnership
>()
const screeningEncounterIpcChannels: readonly ScreeningEncounterIpcChannel[] = Object.freeze([
  ipcChannels.screeningEncounters.start,
  ipcChannels.screeningEncounters.getVitalsDraft,
  ipcChannels.screeningEncounters.saveVitalsDraft,
  ipcChannels.screeningEncounters.completeVitalsStep
])
const activeScreeningEncounterRegistrations = new WeakMap<
  ApplicationIpcMain,
  ScreeningEncounterRegistrationOwnership
>()
const screeningLifestyleIpcChannels: readonly ScreeningLifestyleIpcChannel[] = Object.freeze([
  ipcChannels.screeningEncounters.lifestyle.getWorkspace,
  ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline,
  ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline,
  ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline,
  ipcChannels.screeningEncounters.lifestyle.saveDraft,
  ipcChannels.screeningEncounters.lifestyle.complete,
  ipcChannels.screeningEncounters.lifestyle.reopen
])
const activeScreeningLifestyleRegistrations = new WeakMap<
  ApplicationIpcMain,
  ScreeningLifestyleRegistrationOwnership
>()

export interface ApplicationIpcHandlerDependencies extends AppIpcHandlerDependencies {
  readonly firstRun: FirstRunIpcHandlerDependencies
  readonly auth: AuthenticationIpcHandlerDependencies
  readonly patient: PatientIpcHandlerDependencies
  readonly screeningSessions: ScreeningSessionIpcHandlerDependencies
  readonly screeningEncounters: ScreeningEncounterIpcHandlerDependencies
  readonly screeningLifestyle: ScreeningLifestyleIpcHandlerDependencies
  readonly installationSettings: InstallationSettingsIpcHandlerDependencies
}

export function registerApplicationIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ApplicationIpcHandlerDependencies
): ApplicationIpcDisposer {
  disposeActiveApplicationIpcRegistration(applicationIpcMain)

  const installedChannels: string[] = []
  let disposeScreeningSessionHandlers: ApplicationIpcDisposer | undefined
  let disposeScreeningEncounterHandlers: ApplicationIpcDisposer | undefined
  let disposeScreeningLifestyleHandlers: ApplicationIpcDisposer | undefined

  try {
    const appHandlers = createAppIpcHandlers(dependencies)
    const firstRunHandlers = createFirstRunIpcHandlers(dependencies.firstRun)
    const authenticationHandlers = createAuthenticationIpcHandlers(dependencies.auth)
    const patientHandlers = createPatientIpcHandlers(dependencies.patient)
    const installationSettingsHandlers = createInstallationSettingsIpcHandlers(
      dependencies.installationSettings
    )

    const registrations: ReadonlyArray<readonly [string, ApplicationIpcListener]> = [
      [ipcChannels.app.getInfo, appHandlers.getInfo],
      [ipcChannels.app.getHealth, appHandlers.getHealth],
      [ipcChannels.firstRun.getState, firstRunHandlers.getState],
      [ipcChannels.firstRun.initialize, firstRunHandlers.initialize],
      [ipcChannels.auth.getSession, authenticationHandlers.getSession],
      [ipcChannels.auth.login, authenticationHandlers.login],
      [ipcChannels.auth.changeRequiredPassword, authenticationHandlers.changeRequiredPassword],
      [ipcChannels.auth.unlock, authenticationHandlers.unlock],
      [ipcChannels.auth.lock, authenticationHandlers.lock],
      [ipcChannels.auth.logout, authenticationHandlers.logout],
      [ipcChannels.auth.recordActivity, authenticationHandlers.recordActivity],
      [ipcChannels.patient.search, patientHandlers.search],
      [ipcChannels.patient.get, patientHandlers.get],
      [ipcChannels.patient.create, patientHandlers.create],
      [ipcChannels.patient.amendDemographics, patientHandlers.amendDemographics],
      [
        ipcChannels.patient.listDemographicAmendmentHistory,
        patientHandlers.listDemographicAmendmentHistory
      ],
      [ipcChannels.patient.recordAcknowledgment, patientHandlers.recordAcknowledgment],
      [ipcChannels.patient.listAcknowledgmentHistory, patientHandlers.listAcknowledgmentHistory],
      [ipcChannels.patient.listRecent, patientHandlers.listRecent],
      [ipcChannels.patient.findDuplicates, patientHandlers.findDuplicates],
      [ipcChannels.patient.markNotDuplicate, patientHandlers.markNotDuplicate],
      [
        ipcChannels.installationSettings.getConfiguredLocation,
        installationSettingsHandlers.getConfiguredLocation
      ],
      [
        ipcChannels.installationSettings.listEligibleLocations,
        installationSettingsHandlers.listEligibleLocations
      ],
      [
        ipcChannels.installationSettings.assignInitialLocation,
        installationSettingsHandlers.assignInitialLocation
      ],
      [
        ipcChannels.installationSettings.reconfigureLocation,
        installationSettingsHandlers.reconfigureLocation
      ]
    ]

    for (const [channel, listener] of registrations) {
      applicationIpcMain.handle(channel, listener)
      installedChannels.push(channel)
    }

    disposeScreeningSessionHandlers = registerScreeningSessionIpcHandlers(
      applicationIpcMain,
      dependencies.screeningSessions
    )
    disposeScreeningEncounterHandlers = registerScreeningEncounterIpcHandlers(
      applicationIpcMain,
      dependencies.screeningEncounters
    )
    disposeScreeningLifestyleHandlers = registerScreeningLifestyleIpcHandlers(
      applicationIpcMain,
      dependencies.screeningLifestyle
    )
  } catch {
    disposeScreeningLifestyleHandlers?.()
    disposeScreeningEncounterHandlers?.()
    disposeScreeningSessionHandlers?.()

    for (const channel of installedChannels.reverse()) {
      applicationIpcMain.removeHandler(channel)
    }

    throw new ApplicationIpcRegistrationError()
  }

  const ownership: ApplicationRegistrationOwnership = Object.freeze({
    id: Symbol('application-ipc-registration'),
    sessionPublisher: dependencies.auth.sessionPublisher
  })
  activeApplicationRegistrations.set(applicationIpcMain, ownership)

  return () => {
    disposeApplicationIpcRegistration(applicationIpcMain, ownership)
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
    [ipcChannels.screeningSessions.ensureCurrent, screeningSessionHandlers.ensureCurrent],
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
  const registrations: ReadonlyArray<
    readonly [ScreeningEncounterIpcChannel, ApplicationIpcListener]
  > = [
    [ipcChannels.screeningEncounters.start, screeningEncounterHandlers.start],
    [ipcChannels.screeningEncounters.getVitalsDraft, screeningEncounterHandlers.getVitalsDraft],
    [ipcChannels.screeningEncounters.saveVitalsDraft, screeningEncounterHandlers.saveVitalsDraft],
    [
      ipcChannels.screeningEncounters.completeVitalsStep,
      screeningEncounterHandlers.completeVitalsStep
    ]
  ]
  const installedChannels: ScreeningEncounterIpcChannel[] = []

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

  activeScreeningEncounterRegistrations.set(applicationIpcMain, ownership)

  return () => disposeScreeningEncounterRegistration(applicationIpcMain, ownership)
}

export function registerScreeningLifestyleIpcHandlers(
  applicationIpcMain: ApplicationIpcMain,
  dependencies: ScreeningLifestyleIpcHandlerDependencies
): ApplicationIpcDisposer {
  if (activeScreeningLifestyleRegistrations.has(applicationIpcMain)) {
    throw new ApplicationIpcRegistrationError()
  }

  const ownership: ScreeningLifestyleRegistrationOwnership = Object.freeze({
    id: Symbol('screening-lifestyle-ipc-registration')
  })
  const handlers = createScreeningLifestyleIpcHandlers(dependencies)
  const registrations: ReadonlyArray<
    readonly [ScreeningLifestyleIpcChannel, ApplicationIpcListener]
  > = [
    [ipcChannels.screeningEncounters.lifestyle.getWorkspace, handlers.getWorkspace],
    [ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline, handlers.saveAlcoholBaseline],
    [ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline, handlers.saveTobaccoBaseline],
    [ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline, handlers.saveWorkBaseline],
    [ipcChannels.screeningEncounters.lifestyle.saveDraft, handlers.saveDraft],
    [ipcChannels.screeningEncounters.lifestyle.complete, handlers.complete],
    [ipcChannels.screeningEncounters.lifestyle.reopen, handlers.reopen]
  ]
  const installedChannels: ScreeningLifestyleIpcChannel[] = []

  try {
    for (const [channel, listener] of registrations) {
      applicationIpcMain.handle(channel, listener)
      installedChannels.push(channel)
    }
  } catch {
    for (const channel of installedChannels.reverse()) applicationIpcMain.removeHandler(channel)
    throw new ApplicationIpcRegistrationError()
  }

  activeScreeningLifestyleRegistrations.set(applicationIpcMain, ownership)
  return () => disposeScreeningLifestyleRegistration(applicationIpcMain, ownership)
}

export function disposeApplicationIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  disposeApplicationOwnedIpcHandlers(applicationIpcMain)
  activeApplicationRegistrations.delete(applicationIpcMain)
}

function disposeActiveApplicationIpcRegistration(applicationIpcMain: ApplicationIpcMain): void {
  const activeRegistration = activeApplicationRegistrations.get(applicationIpcMain)

  if (activeRegistration) {
    disposeApplicationIpcRegistration(applicationIpcMain, activeRegistration)
    return
  }

  disposeApplicationIpcHandlers(applicationIpcMain)
}

function disposeApplicationIpcRegistration(
  applicationIpcMain: ApplicationIpcMain,
  ownership: ApplicationRegistrationOwnership
): void {
  if (activeApplicationRegistrations.get(applicationIpcMain) !== ownership) {
    return
  }

  disposeApplicationOwnedIpcHandlers(applicationIpcMain)
  activeApplicationRegistrations.delete(applicationIpcMain)
  ownership.sessionPublisher.dispose()
}

function disposeApplicationOwnedIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
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
  for (const channel of installationSettingsIpcChannels) {
    applicationIpcMain.removeHandler(channel)
  }
  disposeScreeningSessionIpcHandlers(applicationIpcMain)
  disposeScreeningEncounterIpcHandlers(applicationIpcMain)
  disposeScreeningLifestyleIpcHandlers(applicationIpcMain)
}

export function disposeScreeningLifestyleIpcHandlers(applicationIpcMain: ApplicationIpcMain): void {
  for (const channel of screeningLifestyleIpcChannels) applicationIpcMain.removeHandler(channel)
  activeScreeningLifestyleRegistrations.delete(applicationIpcMain)
}

function disposeScreeningLifestyleRegistration(
  applicationIpcMain: ApplicationIpcMain,
  ownership: ScreeningLifestyleRegistrationOwnership
): void {
  if (activeScreeningLifestyleRegistrations.get(applicationIpcMain) !== ownership) return
  disposeScreeningLifestyleIpcHandlers(applicationIpcMain)
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
