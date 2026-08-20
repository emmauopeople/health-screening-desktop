import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { ApplicationInfoProvider } from '@main/app/application-info'
import {
  createAppIpcHandlers,
  type AppIpcHandlers,
  type IpcOperationalLogger
} from '@main/ipc/handlers/app-handlers'
import {
  ApplicationIpcRegistrationError,
  disposeApplicationIpcHandlers,
  registerApplicationIpcHandlers,
  registerScreeningEncounterIpcHandlers,
  registerScreeningFoodIpcHandlers,
  registerScreeningOtcIpcHandlers,
  registerScreeningLifestyleIpcHandlers,
  registerScreeningSessionIpcHandlers,
  type ApplicationIpcHandlerDependencies,
  type ApplicationIpcMain
} from '@main/ipc/register-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { ipcChannels, type AppHealth, type AppInfo } from '@shared/ipc'
import type {
  FirstRunBootstrapService,
  CurrentScreeningSessionService,
  InstallationLocationService,
  LocalAuthenticationSessionService,
  PatientAcknowledgmentService,
  PatientDemographicAmendmentService,
  PatientRegistryService,
  ScreeningEncounterStartService,
  ScreeningFoodService,
  ScreeningOtcService,
  ScreeningVitalsDraftService,
  ScreeningLifestyleService,
  ScreeningSessionService,
  ScreeningSessionWorkspaceContextService
} from '@main/application'
import type { LocationRepository } from '@main/database'

const validInfo: AppInfo = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  platform: 'win32',
  architecture: 'x64',
  packaged: false
}

const validHealth: AppHealth = {
  status: 'ready',
  ipc: 'available',
  database: 'ready',
  clinicalFeatures: 'not-implemented'
}

const applicationOwnedHandlerChannels = Object.freeze([
  ipcChannels.app.getInfo,
  ipcChannels.app.getHealth,
  ipcChannels.firstRun.getState,
  ipcChannels.firstRun.initialize,
  ipcChannels.installationSettings.getConfiguredLocation,
  ipcChannels.installationSettings.listEligibleLocations,
  ipcChannels.installationSettings.assignInitialLocation,
  ipcChannels.installationSettings.reconfigureLocation,
  ipcChannels.auth.getSession,
  ipcChannels.auth.login,
  ipcChannels.auth.changeRequiredPassword,
  ipcChannels.auth.unlock,
  ipcChannels.auth.lock,
  ipcChannels.auth.logout,
  ipcChannels.auth.recordActivity,
  ipcChannels.patient.search,
  ipcChannels.patient.get,
  ipcChannels.patient.create,
  ipcChannels.patient.amendDemographics,
  ipcChannels.patient.listDemographicAmendmentHistory,
  ipcChannels.patient.recordAcknowledgment,
  ipcChannels.patient.listAcknowledgmentHistory,
  ipcChannels.patient.listRecent,
  ipcChannels.patient.findDuplicates,
  ipcChannels.patient.markNotDuplicate,
  ipcChannels.screeningSessions.getWorkspaceContext,
  ipcChannels.screeningSessions.ensureCurrent,
  ipcChannels.screeningSessions.create,
  ipcChannels.screeningSessions.close,
  ipcChannels.screeningSessions.reopen,
  ipcChannels.screeningSessions.getById,
  ipcChannels.screeningSessions.list,
  ipcChannels.screeningEncounters.start,
  ipcChannels.screeningEncounters.getVitalsDraft,
  ipcChannels.screeningEncounters.saveVitalsDraft,
  ipcChannels.screeningEncounters.completeVitalsStep,
  ipcChannels.screeningEncounters.lifestyle.getWorkspace,
  ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline,
  ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline,
  ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline,
  ipcChannels.screeningEncounters.lifestyle.saveDraft,
  ipcChannels.screeningEncounters.lifestyle.complete,
  ipcChannels.screeningEncounters.lifestyle.reopen,
  ipcChannels.screeningEncounters.food.getWorkspace,
  ipcChannels.screeningEncounters.food.saveDraft,
  ipcChannels.screeningEncounters.otc.getWorkspace,
  ipcChannels.screeningEncounters.otc.saveDraft
])

describe('application IPC handlers', () => {
  it('returns validated safe app metadata', async () => {
    const getInfo = vi.fn(() => validInfo)
    const handlers = createHandlers({ getInfo })

    await expect(handlers.getInfo(createAllowedEvent(), {})).resolves.toEqual({
      ok: true,
      data: validInfo
    })
    expect(getInfo).toHaveBeenCalledOnce()
  })

  it('returns the exact shell health contract', async () => {
    const getHealth = vi.fn(() => validHealth)
    const handlers = createHandlers({ getHealth })

    await expect(handlers.getHealth(createAllowedEvent(), {})).resolves.toEqual({
      ok: true,
      data: validHealth
    })
    expect(getHealth).toHaveBeenCalledOnce()
  })

  it('rejects malformed requests before execution', async () => {
    const getInfo = vi.fn(() => validInfo)
    const getHealth = vi.fn(() => validHealth)
    const handlers = createHandlers({ getInfo, getHealth })

    await expect(handlers.getInfo(createAllowedEvent(), { extra: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.'
      }
    })
    await expect(handlers.getHealth(createAllowedEvent(), { extra: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The request could not be processed.'
      }
    })
    expect(getInfo).not.toHaveBeenCalled()
    expect(getHealth).not.toHaveBeenCalled()
  })

  it('rejects untrusted senders before request parsing or execution', async () => {
    const getInfo = vi.fn(() => validInfo)
    const handlers = createHandlers({ getInfo })

    await expect(handlers.getInfo(createForbiddenEvent(), { extra: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'IPC_FORBIDDEN',
        message: 'This operation is unavailable from the current window.'
      }
    })
    expect(getInfo).not.toHaveBeenCalled()
  })

  it('maps thrown provider errors to safe internal failures', async () => {
    const logger = createLogger()
    const handlers = createHandlers({
      getInfo: () => {
        throw new Error('C:\\secret\\path')
      },
      getHealth: () => {
        throw new Error('hostname-secret')
      },
      logger
    })

    await expect(handlers.getInfo(createAllowedEvent(), {})).resolves.toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The application could not complete the request.'
      }
    })
    await expect(handlers.getHealth(createAllowedEvent(), {})).resolves.toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'The application could not complete the request.'
      }
    })
    expect(logger.error.mock.calls.join('\n')).not.toContain('secret')
  })

  it('maps invalid trusted output to safe internal failures', async () => {
    const handlers = createHandlers({
      getInfo: () => ({ ...validInfo, applicationVersion: '' }),
      getHealth: () => ({ ...validHealth, database: 'connected' })
    })

    await expect(handlers.getInfo(createAllowedEvent(), {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' }
    })
    await expect(handlers.getHealth(createAllowedEvent(), {})).resolves.toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR' }
    })
  })
})

describe('application IPC handler registration', () => {
  it('registers exactly the owned handlers and preserves unrelated handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())

    const dispose = registerApplicationIpcHandlers(ipcMain, createDependencies())

    expect(ipcMain.handle).toHaveBeenCalledTimes(53)
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-health',
      'health-screening:app:get-info',
      'health-screening:auth:change-required-password',
      'health-screening:auth:get-session',
      'health-screening:auth:lock',
      'health-screening:auth:login',
      'health-screening:auth:logout',
      'health-screening:auth:record-activity',
      'health-screening:auth:unlock',
      'health-screening:first-run:get-state',
      'health-screening:first-run:initialize',
      'health-screening:installation-settings:assign-initial-location',
      'health-screening:installation-settings:get-configured-location',
      'health-screening:installation-settings:list-eligible-locations',
      'health-screening:installation-settings:reconfigure-location',
      'health-screening:patient:amend-demographics',
      'health-screening:patient:create',
      'health-screening:patient:find-duplicates',
      'health-screening:patient:get',
      'health-screening:patient:list-acknowledgment-history',
      'health-screening:patient:list-demographic-amendment-history',
      'health-screening:patient:list-recent',
      'health-screening:patient:mark-not-duplicate',
      'health-screening:patient:record-acknowledgment',
      'health-screening:patient:search',
      'health-screening:screening-encounters:complete',
      'health-screening:screening-encounters:food:get-workspace',
      'health-screening:screening-encounters:food:save-draft',
      'health-screening:screening-encounters:lifestyle:complete',
      'health-screening:screening-encounters:lifestyle:get-workspace',
      'health-screening:screening-encounters:lifestyle:reopen',
      'health-screening:screening-encounters:lifestyle:save-alcohol-baseline',
      'health-screening:screening-encounters:lifestyle:save-draft',
      'health-screening:screening-encounters:lifestyle:save-tobacco-baseline',
      'health-screening:screening-encounters:lifestyle:save-work-baseline',
      'health-screening:screening-encounters:management:add-addendum',
      'health-screening:screening-encounters:management:get-detail',
      'health-screening:screening-encounters:management:open-flag',
      'health-screening:screening-encounters:management:resolve-flag',
      'health-screening:screening-encounters:management:search',
      'health-screening:screening-encounters:otc:get-workspace',
      'health-screening:screening-encounters:otc:save-draft',
      'health-screening:screening-encounters:start',
      'health-screening:screening-encounters:vitals:complete-step',
      'health-screening:screening-encounters:vitals:get-draft',
      'health-screening:screening-encounters:vitals:save-draft',
      'health-screening:screening-sessions:close',
      'health-screening:screening-sessions:create',
      'health-screening:screening-sessions:ensure-current',
      'health-screening:screening-sessions:get-by-id',
      'health-screening:screening-sessions:get-workspace-context',
      'health-screening:screening-sessions:list',
      'health-screening:screening-sessions:reopen',
      'unrelated:channel'
    ])

    dispose()

    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
  })

  it('registers exactly seven Lifestyle handlers and disposes only its owned channels', () => {
    const ipcMain = createMockIpcMain()
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    const dispose = registerScreeningLifestyleIpcHandlers(
      ipcMain,
      createDependencies().screeningLifestyle
    )

    expect(ipcMain.handle).toHaveBeenCalledTimes(7)
    expect([...ipcMain.handlers.keys()]).toEqual([
      'unrelated:channel',
      ipcChannels.screeningEncounters.lifestyle.getWorkspace,
      ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveDraft,
      ipcChannels.screeningEncounters.lifestyle.complete,
      ipcChannels.screeningEncounters.lifestyle.reopen
    ])

    dispose()
    dispose()
    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
    expect(ipcMain.removeHandler.mock.calls.flat()).toEqual([
      ipcChannels.screeningEncounters.lifestyle.getWorkspace,
      ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveDraft,
      ipcChannels.screeningEncounters.lifestyle.complete,
      ipcChannels.screeningEncounters.lifestyle.reopen
    ])
    expect(ipcMain.handlers.get('unrelated:channel')).toBe(unrelatedHandler)
  })

  it('rejects duplicate focused registration without replacing the original handlers', () => {
    const ipcMain = createMockIpcMain()
    const firstDispose = registerScreeningLifestyleIpcHandlers(
      ipcMain,
      createDependencies().screeningLifestyle
    )
    const originalHandlers = new Map(ipcMain.handlers)

    expect(() =>
      registerScreeningLifestyleIpcHandlers(ipcMain, createDependencies().screeningLifestyle)
    ).toThrow(ApplicationIpcRegistrationError)
    expectHandlerMapsEqual(ipcMain.handlers, originalHandlers)

    firstDispose()
  })

  it('does not let a stale focused disposer remove a newer registration', () => {
    const ipcMain = createMockIpcMain()
    const firstDispose = registerScreeningLifestyleIpcHandlers(
      ipcMain,
      createDependencies().screeningLifestyle
    )
    firstDispose()
    const secondDispose = registerScreeningLifestyleIpcHandlers(
      ipcMain,
      createDependencies().screeningLifestyle
    )
    const newerHandlers = new Map(ipcMain.handlers)

    firstDispose()
    expectHandlerMapsEqual(ipcMain.handlers, newerHandlers)

    secondDispose()
  })

  it('rolls back only Lifestyle handlers after a partial focused registration failure', () => {
    const failingChannel = ipcChannels.screeningEncounters.lifestyle.saveDraft
    const ipcMain = createMockIpcMain({ throwOnHandleChannel: failingChannel })
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() =>
      registerScreeningLifestyleIpcHandlers(ipcMain, createDependencies().screeningLifestyle)
    ).toThrow(ApplicationIpcRegistrationError)
    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expect(ipcMain.removeHandler.mock.calls.flat()).toEqual([
      ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline,
      ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline,
      ipcChannels.screeningEncounters.lifestyle.getWorkspace
    ])

    ipcMain.setThrowOnHandleChannel(undefined)
    const dispose = registerScreeningLifestyleIpcHandlers(
      ipcMain,
      createDependencies().screeningLifestyle
    )
    expect([...ipcMain.handlers.keys()]).toContain(failingChannel)
    dispose()
  })

  it('registers exactly two Food handlers and disposes only its owned channels', () => {
    const ipcMain = createMockIpcMain()
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    const dispose = registerScreeningFoodIpcHandlers(ipcMain, createDependencies().screeningFood)

    expect(ipcMain.handle).toHaveBeenCalledTimes(2)
    expect([...ipcMain.handlers.keys()]).toEqual([
      'unrelated:channel',
      ipcChannels.screeningEncounters.food.getWorkspace,
      ipcChannels.screeningEncounters.food.saveDraft
    ])

    dispose()
    dispose()
    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
    expect(ipcMain.removeHandler.mock.calls.flat()).toEqual([
      ipcChannels.screeningEncounters.food.getWorkspace,
      ipcChannels.screeningEncounters.food.saveDraft
    ])
    expect(ipcMain.handlers.get('unrelated:channel')).toBe(unrelatedHandler)
  })

  it('rejects duplicate Food registration without replacing the original handlers', () => {
    const ipcMain = createMockIpcMain()
    const firstDispose = registerScreeningFoodIpcHandlers(
      ipcMain,
      createDependencies().screeningFood
    )
    const originalHandlers = new Map(ipcMain.handlers)

    expect(() =>
      registerScreeningFoodIpcHandlers(ipcMain, createDependencies().screeningFood)
    ).toThrow(ApplicationIpcRegistrationError)
    expectHandlerMapsEqual(ipcMain.handlers, originalHandlers)

    firstDispose()
  })

  it('does not let a stale Food disposer remove a newer registration', () => {
    const ipcMain = createMockIpcMain()
    const firstDispose = registerScreeningFoodIpcHandlers(
      ipcMain,
      createDependencies().screeningFood
    )
    firstDispose()
    const secondDispose = registerScreeningFoodIpcHandlers(
      ipcMain,
      createDependencies().screeningFood
    )
    const newerHandlers = new Map(ipcMain.handlers)

    firstDispose()
    expectHandlerMapsEqual(ipcMain.handlers, newerHandlers)

    secondDispose()
  })

  it('rolls back only Food handlers after a partial focused registration failure', () => {
    const failingChannel = ipcChannels.screeningEncounters.food.saveDraft
    const ipcMain = createMockIpcMain({ throwOnHandleChannel: failingChannel })
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() =>
      registerScreeningFoodIpcHandlers(ipcMain, createDependencies().screeningFood)
    ).toThrow(ApplicationIpcRegistrationError)
    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expect(ipcMain.removeHandler.mock.calls.flat()).toEqual([
      ipcChannels.screeningEncounters.food.getWorkspace
    ])

    ipcMain.setThrowOnHandleChannel(undefined)
    const dispose = registerScreeningFoodIpcHandlers(ipcMain, createDependencies().screeningFood)
    expect([...ipcMain.handlers.keys()]).toContain(failingChannel)
    dispose()
  })

  it('registers exactly two OTC handlers and disposes only its owned channels', () => {
    const ipcMain = createMockIpcMain()
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    const dispose = registerScreeningOtcIpcHandlers(ipcMain, createDependencies().screeningOtc)

    expect(ipcMain.handle).toHaveBeenCalledTimes(2)
    expect([...ipcMain.handlers.keys()]).toEqual([
      'unrelated:channel',
      ipcChannels.screeningEncounters.otc.getWorkspace,
      ipcChannels.screeningEncounters.otc.saveDraft
    ])

    dispose()
    dispose()
    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
    expect(ipcMain.removeHandler.mock.calls.flat()).toEqual([
      ipcChannels.screeningEncounters.otc.getWorkspace,
      ipcChannels.screeningEncounters.otc.saveDraft
    ])
    expect(ipcMain.handlers.get('unrelated:channel')).toBe(unrelatedHandler)
  })

  it('rolls back OTC handlers after partial registration failure', () => {
    const failingChannel = ipcChannels.screeningEncounters.otc.saveDraft
    const ipcMain = createMockIpcMain({ throwOnHandleChannel: failingChannel })
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() =>
      registerScreeningOtcIpcHandlers(ipcMain, createDependencies().screeningOtc)
    ).toThrow(ApplicationIpcRegistrationError)
    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expect(ipcMain.removeHandler.mock.calls.flat()).toEqual([
      ipcChannels.screeningEncounters.otc.getWorkspace
    ])
  })

  it('rejects duplicate OTC registration without replacing the original handlers', () => {
    const ipcMain = createMockIpcMain()
    const firstDispose = registerScreeningOtcIpcHandlers(ipcMain, createDependencies().screeningOtc)
    const originalHandlers = new Map(ipcMain.handlers)

    expect(() =>
      registerScreeningOtcIpcHandlers(ipcMain, createDependencies().screeningOtc)
    ).toThrow(ApplicationIpcRegistrationError)
    expectHandlerMapsEqual(ipcMain.handlers, originalHandlers)

    firstDispose()
  })

  it('does not let a stale OTC disposer remove a newer registration', () => {
    const ipcMain = createMockIpcMain()
    const firstDispose = registerScreeningOtcIpcHandlers(ipcMain, createDependencies().screeningOtc)
    firstDispose()
    const secondDispose = registerScreeningOtcIpcHandlers(
      ipcMain,
      createDependencies().screeningOtc
    )
    const newerHandlers = new Map(ipcMain.handlers)

    firstDispose()
    expectHandlerMapsEqual(ipcMain.handlers, newerHandlers)

    secondDispose()
  })

  it('re-registration removes only application-owned handlers before replacement', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())

    registerApplicationIpcHandlers(ipcMain, createDependencies())
    registerApplicationIpcHandlers(ipcMain, createDependencies())

    expect(ipcMain.handle).toHaveBeenCalledTimes(106)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getInfo)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getHealth)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.firstRun.getState)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.firstRun.initialize)
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-health',
      'health-screening:app:get-info',
      'health-screening:auth:change-required-password',
      'health-screening:auth:get-session',
      'health-screening:auth:lock',
      'health-screening:auth:login',
      'health-screening:auth:logout',
      'health-screening:auth:record-activity',
      'health-screening:auth:unlock',
      'health-screening:first-run:get-state',
      'health-screening:first-run:initialize',
      'health-screening:installation-settings:assign-initial-location',
      'health-screening:installation-settings:get-configured-location',
      'health-screening:installation-settings:list-eligible-locations',
      'health-screening:installation-settings:reconfigure-location',
      'health-screening:patient:amend-demographics',
      'health-screening:patient:create',
      'health-screening:patient:find-duplicates',
      'health-screening:patient:get',
      'health-screening:patient:list-acknowledgment-history',
      'health-screening:patient:list-demographic-amendment-history',
      'health-screening:patient:list-recent',
      'health-screening:patient:mark-not-duplicate',
      'health-screening:patient:record-acknowledgment',
      'health-screening:patient:search',
      'health-screening:screening-encounters:complete',
      'health-screening:screening-encounters:food:get-workspace',
      'health-screening:screening-encounters:food:save-draft',
      'health-screening:screening-encounters:lifestyle:complete',
      'health-screening:screening-encounters:lifestyle:get-workspace',
      'health-screening:screening-encounters:lifestyle:reopen',
      'health-screening:screening-encounters:lifestyle:save-alcohol-baseline',
      'health-screening:screening-encounters:lifestyle:save-draft',
      'health-screening:screening-encounters:lifestyle:save-tobacco-baseline',
      'health-screening:screening-encounters:lifestyle:save-work-baseline',
      'health-screening:screening-encounters:management:add-addendum',
      'health-screening:screening-encounters:management:get-detail',
      'health-screening:screening-encounters:management:open-flag',
      'health-screening:screening-encounters:management:resolve-flag',
      'health-screening:screening-encounters:management:search',
      'health-screening:screening-encounters:otc:get-workspace',
      'health-screening:screening-encounters:otc:save-draft',
      'health-screening:screening-encounters:start',
      'health-screening:screening-encounters:vitals:complete-step',
      'health-screening:screening-encounters:vitals:get-draft',
      'health-screening:screening-encounters:vitals:save-draft',
      'health-screening:screening-sessions:close',
      'health-screening:screening-sessions:create',
      'health-screening:screening-sessions:ensure-current',
      'health-screening:screening-sessions:get-by-id',
      'health-screening:screening-sessions:get-workspace-context',
      'health-screening:screening-sessions:list',
      'health-screening:screening-sessions:reopen',
      'unrelated:channel'
    ])
  })

  it('rolls back a failed early application registration without removing unrelated handlers', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.app.getInfo
    })
    const unrelatedHandler = vi.fn()
    const dependencies = createDependencies()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    let error: unknown

    try {
      registerApplicationIpcHandlers(ipcMain, dependencies)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(ApplicationIpcRegistrationError)
    expect(String(error)).toBe(
      'ApplicationIpcRegistrationError: Application IPC handler registration failed.'
    )
    expect(String(error)).not.toContain('secret')
    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expectNoApplicationOwnedHandlers(ipcMain)
    expect(dependencies.auth.sessionPublisher.dispose).not.toHaveBeenCalled()

    ipcMain.setThrowOnHandleChannel(undefined)

    const dispose = registerApplicationIpcHandlers(ipcMain, dependencies)

    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    dispose()
  })

  it('rolls back patient registration failure across earlier application handlers', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.patient.listRecent
    })
    const unrelatedHandler = vi.fn()
    const dependencies = createDependencies()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() => registerApplicationIpcHandlers(ipcMain, dependencies)).toThrow(
      ApplicationIpcRegistrationError
    )

    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expectNoApplicationOwnedHandlers(ipcMain)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.app.getInfo)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.firstRun.getState)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.auth.login)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.patient.recordAcknowledgment)
    expect(dependencies.auth.sessionPublisher.dispose).not.toHaveBeenCalled()

    ipcMain.setThrowOnHandleChannel(undefined)

    const dispose = registerApplicationIpcHandlers(ipcMain, dependencies)

    expect(ipcMain.handlers.has(ipcChannels.patient.search)).toBe(true)

    dispose()
  })

  it('rolls back screening-session registration failure and clears focused ownership', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.screeningSessions.reopen
    })
    const unrelatedHandler = vi.fn()
    const dependencies = createDependencies()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() => registerApplicationIpcHandlers(ipcMain, dependencies)).toThrow(
      ApplicationIpcRegistrationError
    )

    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expectNoApplicationOwnedHandlers(ipcMain)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      ipcChannels.screeningSessions.getWorkspaceContext
    )
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.screeningSessions.ensureCurrent)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.screeningSessions.close)
    expect(dependencies.auth.sessionPublisher.dispose).not.toHaveBeenCalled()

    ipcMain.setThrowOnHandleChannel(undefined)

    const focusedDispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      dependencies.screeningSessions
    )

    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(true)

    focusedDispose()

    const dispose = registerApplicationIpcHandlers(ipcMain, dependencies)

    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    dispose()
  })

  it('rolls back screening-encounter registration failure and clears focused ownership', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.screeningEncounters.start
    })
    const unrelatedHandler = vi.fn()
    const dependencies = createDependencies()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() => registerApplicationIpcHandlers(ipcMain, dependencies)).toThrow(
      ApplicationIpcRegistrationError
    )

    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expectNoApplicationOwnedHandlers(ipcMain)
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(
      ipcChannels.screeningSessions.getWorkspaceContext
    )
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(ipcChannels.screeningSessions.list)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(false)
    expect(dependencies.auth.sessionPublisher.dispose).not.toHaveBeenCalled()

    ipcMain.setThrowOnHandleChannel(undefined)

    const focusedSessionDispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      dependencies.screeningSessions
    )
    const focusedEncounterDispose = registerScreeningEncounterIpcHandlers(
      ipcMain,
      dependencies.screeningEncounters
    )

    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.list)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    focusedEncounterDispose()
    focusedSessionDispose()

    const dispose = registerApplicationIpcHandlers(ipcMain, dependencies)

    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    dispose()
  })

  it('prevents stale application disposers from removing newer registrations', () => {
    const ipcMain = createMockIpcMain()
    const unrelatedHandler = vi.fn()
    const firstDependencies = createDependencies()
    const secondDependencies = createDependencies()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    const firstDispose = registerApplicationIpcHandlers(ipcMain, firstDependencies)
    const firstHandlers = new Map(ipcMain.handlers)

    expect(firstHandlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    const secondDispose = registerApplicationIpcHandlers(ipcMain, secondDependencies)
    const secondHandlers = new Map(ipcMain.handlers)

    expect(firstDependencies.auth.sessionPublisher.dispose).toHaveBeenCalledOnce()

    firstDispose()

    expectHandlerMapsEqual(ipcMain.handlers, secondHandlers)
    expect(firstDependencies.auth.sessionPublisher.dispose).toHaveBeenCalledOnce()
    expect(secondDependencies.auth.sessionPublisher.dispose).not.toHaveBeenCalled()

    secondDispose()

    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expect(secondDependencies.auth.sessionPublisher.dispose).toHaveBeenCalledOnce()

    secondDispose()

    expectOnlyUnrelatedHandler(ipcMain, unrelatedHandler)
    expect(secondDependencies.auth.sessionPublisher.dispose).toHaveBeenCalledOnce()
  })

  it('disposes only application-owned handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set('unrelated:channel', vi.fn())
    ipcMain.handlers.set(ipcChannels.app.getInfo, vi.fn())
    ipcMain.handlers.set(ipcChannels.app.getHealth, vi.fn())
    ipcMain.handlers.set(ipcChannels.firstRun.getState, vi.fn())
    ipcMain.handlers.set(ipcChannels.firstRun.initialize, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.getSession, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.login, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.changeRequiredPassword, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.unlock, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.lock, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.logout, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.recordActivity, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.search, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.get, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.create, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.amendDemographics, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.listDemographicAmendmentHistory, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.recordAcknowledgment, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.listAcknowledgmentHistory, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.listRecent, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.findDuplicates, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.markNotDuplicate, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.getWorkspaceContext, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.ensureCurrent, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.create, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.close, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.reopen, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.getById, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningSessions.list, vi.fn())
    ipcMain.handlers.set(ipcChannels.screeningEncounters.start, vi.fn())

    disposeApplicationIpcHandlers(ipcMain)

    expect([...ipcMain.handlers.keys()]).toEqual(['unrelated:channel'])
  })

  it('can register and dispose only screening-session handlers', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set(ipcChannels.app.getInfo, vi.fn())
    ipcMain.handlers.set(ipcChannels.firstRun.getState, vi.fn())
    ipcMain.handlers.set(ipcChannels.auth.login, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.search, vi.fn())

    const dispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )
    const firstHandlers = new Map(ipcMain.handlers)

    expect(ipcMain.handle).toHaveBeenCalledTimes(7)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.patient.search)).toBe(true)
    expect(firstHandlers.has(ipcChannels.screeningSessions.getWorkspaceContext)).toBe(true)

    dispose()

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:auth:login',
      'health-screening:first-run:get-state',
      'health-screening:patient:search'
    ])

    dispose()

    const secondDispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )
    const secondHandlers = new Map(ipcMain.handlers)

    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(true)

    dispose()

    for (const [channel, handler] of secondHandlers) {
      expect(ipcMain.handlers.get(channel)).toBe(handler)
    }

    expect(() =>
      registerScreeningSessionIpcHandlers(ipcMain, createDependencies().screeningSessions)
    ).toThrow(ApplicationIpcRegistrationError)

    secondDispose()

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:auth:login',
      'health-screening:first-run:get-state',
      'health-screening:patient:search'
    ])

    secondDispose()

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:auth:login',
      'health-screening:first-run:get-state',
      'health-screening:patient:search'
    ])

    const thirdDispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )

    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.list)).toBe(true)

    thirdDispose()
  })

  it('can register and dispose only screening-encounter handlers with ownership protection', () => {
    const ipcMain = createMockIpcMain()
    ipcMain.handlers.set(ipcChannels.app.getInfo, vi.fn())
    ipcMain.handlers.set(ipcChannels.patient.search, vi.fn())

    const dispose = registerScreeningEncounterIpcHandlers(
      ipcMain,
      createDependencies().screeningEncounters
    )
    const firstHandlers = new Map(ipcMain.handlers)

    expect(ipcMain.handle).toHaveBeenCalledTimes(10)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.complete)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.getVitalsDraft)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.saveVitalsDraft)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.completeVitalsStep)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.management.search)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.management.getDetail)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.management.addAddendum)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.management.openFlag)).toBe(true)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.management.resolveFlag)).toBe(true)

    dispose()

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:patient:search'
    ])

    dispose()

    const secondDispose = registerScreeningEncounterIpcHandlers(
      ipcMain,
      createDependencies().screeningEncounters
    )
    const secondHandlers = new Map(ipcMain.handlers)

    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    dispose()

    for (const [channel, handler] of secondHandlers) {
      expect(ipcMain.handlers.get(channel)).toBe(handler)
    }

    expect(() =>
      registerScreeningEncounterIpcHandlers(ipcMain, createDependencies().screeningEncounters)
    ).toThrow(ApplicationIpcRegistrationError)

    const ownedEncounterChannels = new Set<string>([
      ipcChannels.screeningEncounters.start,
      ipcChannels.screeningEncounters.complete,
      ipcChannels.screeningEncounters.getVitalsDraft,
      ipcChannels.screeningEncounters.saveVitalsDraft,
      ipcChannels.screeningEncounters.completeVitalsStep,
      ipcChannels.screeningEncounters.management.search,
      ipcChannels.screeningEncounters.management.getDetail,
      ipcChannels.screeningEncounters.management.addAddendum,
      ipcChannels.screeningEncounters.management.openFlag,
      ipcChannels.screeningEncounters.management.resolveFlag
    ])

    for (const [channel, handler] of firstHandlers) {
      if (!ownedEncounterChannels.has(channel)) {
        expect(ipcMain.handlers.get(channel)).toBe(handler)
      }
    }

    secondDispose()

    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'health-screening:app:get-info',
      'health-screening:patient:search'
    ])
  })

  it('rejects duplicate screening-session registration without replacing original handlers', () => {
    const ipcMain = createMockIpcMain()
    const dispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )
    const originalHandlers = new Map(ipcMain.handlers)

    expect(() =>
      registerScreeningSessionIpcHandlers(ipcMain, createDependencies().screeningSessions)
    ).toThrow(ApplicationIpcRegistrationError)
    expect(ipcMain.handle).toHaveBeenCalledTimes(7)

    for (const [channel, handler] of originalHandlers) {
      expect(ipcMain.handlers.get(channel)).toBe(handler)
    }

    dispose()
  })

  it('cleans up only screening-session handlers installed by a failed partial registration', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.screeningSessions.reopen
    })
    const unrelatedHandler = vi.fn()
    const preexistingReopenHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)
    ipcMain.handlers.set(ipcChannels.screeningSessions.reopen, preexistingReopenHandler)

    let error: unknown

    try {
      registerScreeningSessionIpcHandlers(ipcMain, createDependencies().screeningSessions)
    } catch (caught) {
      error = caught
    }

    expect(error).toBeInstanceOf(ApplicationIpcRegistrationError)
    expect(String(error)).toBe(
      'ApplicationIpcRegistrationError: Application IPC handler registration failed.'
    )
    expect(String(error)).not.toContain('secret')
    expect(ipcMain.handlers.get('unrelated:channel')).toBe(unrelatedHandler)
    expect(ipcMain.handlers.get(ipcChannels.screeningSessions.reopen)).toBe(
      preexistingReopenHandler
    )
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.getWorkspaceContext)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.ensureCurrent)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.create)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.close)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.getById)).toBe(false)
    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.list)).toBe(false)

    ipcMain.setThrowOnHandleChannel(undefined)

    const dispose = registerScreeningSessionIpcHandlers(
      ipcMain,
      createDependencies().screeningSessions
    )

    expect(ipcMain.handlers.has(ipcChannels.screeningSessions.getWorkspaceContext)).toBe(true)

    dispose()
  })

  it('cleans up only screening-encounter handlers installed by a failed registration', () => {
    const ipcMain = createMockIpcMain({
      throwOnHandleChannel: ipcChannels.screeningEncounters.start
    })
    const unrelatedHandler = vi.fn()
    ipcMain.handlers.set('unrelated:channel', unrelatedHandler)

    expect(() =>
      registerScreeningEncounterIpcHandlers(ipcMain, createDependencies().screeningEncounters)
    ).toThrow(ApplicationIpcRegistrationError)
    expect(ipcMain.handlers.get('unrelated:channel')).toBe(unrelatedHandler)
    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(false)

    ipcMain.setThrowOnHandleChannel(undefined)

    const dispose = registerScreeningEncounterIpcHandlers(
      ipcMain,
      createDependencies().screeningEncounters
    )

    expect(ipcMain.handlers.has(ipcChannels.screeningEncounters.start)).toBe(true)

    dispose()
  })
})

interface HandlerTestOverrides {
  getInfo?: () => unknown
  getHealth?: () => unknown
  logger?: TestLogger
}

interface TestLogger extends IpcOperationalLogger {
  warn: IpcOperationalLogger['warn'] & {
    mock: {
      calls: unknown[][]
    }
  }
  error: IpcOperationalLogger['error'] & {
    mock: {
      calls: unknown[][]
    }
  }
}

function createHandlers(overrides: HandlerTestOverrides = {}): AppIpcHandlers {
  return createAppIpcHandlers({
    ...createDependencies(),
    ...overrides
  })
}

function createDependencies(): ApplicationIpcHandlerDependencies {
  return {
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    applicationInfoProvider: createApplicationInfoProvider(),
    databaseHealthProvider: { getStatus: () => 'ready' },
    firstRun: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      firstRunBootstrapService: createFirstRunBootstrapService(),
      logger: createLogger()
    },
    auth: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      sessionPublisher: {
        publish: vi.fn(() => true),
        dispose: vi.fn()
      },
      logger: createLogger()
    },
    patient: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      patientRegistryService: createPatientRegistryService(),
      patientDemographicAmendmentService: createPatientDemographicAmendmentService(),
      patientAcknowledgmentService: createPatientAcknowledgmentService(),
      logger: createLogger()
    },
    screeningSessions: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      currentScreeningSessionService: createCurrentScreeningSessionService(),
      screeningSessionService: createScreeningSessionService(),
      screeningSessionWorkspaceContextService: createScreeningSessionWorkspaceContextService(),
      logger: createLogger()
    },
    screeningEncounters: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      screeningEncounterStartService: createScreeningEncounterStartService(),
      screeningVitalsDraftService: createScreeningVitalsDraftService(),
      screeningCompletionService: {
        complete: vi.fn(() => ({ status: 'UNAVAILABLE' as const }))
      },
      logger: createLogger()
    },
    screeningLifestyle: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      screeningLifestyleService: createScreeningLifestyleService(),
      logger: createLogger()
    },
    screeningFood: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      screeningFoodService: createScreeningFoodService(),
      logger: createLogger()
    },
    screeningOtc: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      screeningOtcService: createScreeningOtcService(),
      logger: createLogger()
    },
    installationSettings: {
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
      authenticationSessionService: createAuthenticationSessionService(),
      installationLocationService: createInstallationLocationService(),
      locationRepository: createLocationRepository(),
      logger: createLogger()
    },
    logger: createLogger()
  }
}

function createFirstRunBootstrapService(): FirstRunBootstrapService {
  return {
    getState: vi.fn(() => ({ status: 'REQUIRED' })),
    initialize: vi.fn()
  } as unknown as FirstRunBootstrapService
}

function createCurrentScreeningSessionService(): CurrentScreeningSessionService {
  return {
    ensureCurrentScreeningSession: vi.fn(() => ({ status: 'UNAVAILABLE' }))
  } as unknown as CurrentScreeningSessionService
}

function createAuthenticationSessionService(): LocalAuthenticationSessionService {
  return {
    getSnapshot: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 0 })),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 0 })),
    logout: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 1 })),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(),
    requireAnyRole: vi.fn()
  } as unknown as LocalAuthenticationSessionService
}

function createPatientRegistryService(): PatientRegistryService {
  return {
    search: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    listRecent: vi.fn(),
    findDuplicates: vi.fn(),
    markNotDuplicate: vi.fn()
  } as unknown as PatientRegistryService
}

function createPatientDemographicAmendmentService(): PatientDemographicAmendmentService {
  return {
    amend: vi.fn(),
    listHistory: vi.fn()
  } as unknown as PatientDemographicAmendmentService
}

function createPatientAcknowledgmentService(): PatientAcknowledgmentService {
  return {
    record: vi.fn(),
    listHistory: vi.fn()
  } as unknown as PatientAcknowledgmentService
}

function createScreeningSessionService(): ScreeningSessionService {
  return {
    create: vi.fn(),
    close: vi.fn(),
    reopen: vi.fn(),
    getById: vi.fn(),
    list: vi.fn()
  } as unknown as ScreeningSessionService
}

function createScreeningSessionWorkspaceContextService(): ScreeningSessionWorkspaceContextService {
  return {
    getContext: vi.fn()
  } as unknown as ScreeningSessionWorkspaceContextService
}

function createScreeningEncounterStartService(): ScreeningEncounterStartService {
  return {
    start: vi.fn()
  } as unknown as ScreeningEncounterStartService
}

function createScreeningVitalsDraftService(): ScreeningVitalsDraftService {
  return {
    getVitalsDraft: vi.fn(() => ({ status: 'UNAVAILABLE' })),
    saveVitalsDraft: vi.fn(() => ({ status: 'UNAVAILABLE' })),
    completeVitalsStep: vi.fn(() => ({ status: 'UNAVAILABLE' }))
  } as unknown as ScreeningVitalsDraftService
}

function createScreeningLifestyleService(): ScreeningLifestyleService {
  return {
    getLifestyleWorkspace: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    saveAlcoholBaseline: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    saveTobaccoBaseline: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    saveWorkBaseline: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    saveLifestyleDraft: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    completeLifestyle: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    reopenLifestyle: vi.fn(() => ({ status: 'UNAVAILABLE' as const }))
  }
}

function createScreeningFoodService(): ScreeningFoodService {
  return {
    getWorkspace: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    saveDraft: vi.fn(() => ({ status: 'UNAVAILABLE' as const }))
  }
}

function createScreeningOtcService(): ScreeningOtcService {
  return {
    getWorkspace: vi.fn(() => ({ status: 'UNAVAILABLE' as const })),
    saveDraft: vi.fn(() => ({ status: 'UNAVAILABLE' as const }))
  }
}

function createInstallationLocationService(): InstallationLocationService {
  return {
    resolveConfiguredInstallationLocation: vi.fn(() => ({ status: 'LOCATION_NOT_CONFIGURED' })),
    assignInitialInstallationLocation: vi.fn(() => ({ status: 'UNAVAILABLE' })),
    reconfigureInstallationLocation: vi.fn(() => ({ status: 'UNAVAILABLE' }))
  } as unknown as InstallationLocationService
}

function createLocationRepository(): LocationRepository {
  return {
    listActive: vi.fn(() => [])
  } as unknown as LocationRepository
}

function createApplicationInfoProvider(): ApplicationInfoProvider {
  return {
    getVersion: () => validInfo.applicationVersion,
    getPlatform: () => validInfo.platform,
    getArchitecture: () => validInfo.architecture,
    isPackaged: () => validInfo.packaged
  }
}

function createAllowedEvent(): IpcSenderValidationEvent {
  return createEvent('http://localhost:5173/')
}

function createForbiddenEvent(): IpcSenderValidationEvent {
  return createEvent('https://example.invalid/')
}

function createEvent(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}

function createLogger(): TestLogger {
  return {
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  } as TestLogger
}

function expectNoApplicationOwnedHandlers({
  handlers
}: {
  readonly handlers: ReadonlyMap<string, unknown>
}): void {
  for (const channel of applicationOwnedHandlerChannels) {
    expect(handlers.has(channel)).toBe(false)
  }
}

function expectOnlyUnrelatedHandler(
  { handlers }: { readonly handlers: ReadonlyMap<string, unknown> },
  unrelatedHandler: unknown
): void {
  expect([...handlers.keys()]).toEqual(['unrelated:channel'])
  expect(handlers.get('unrelated:channel')).toBe(unrelatedHandler)
}

function expectHandlerMapsEqual(
  actual: ReadonlyMap<string, unknown>,
  expected: ReadonlyMap<string, unknown>
): void {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort())

  for (const [channel, handler] of expected) {
    expect(actual.get(channel)).toBe(handler)
  }
}

function createMockIpcMain({
  throwOnHandleChannel
}: {
  readonly throwOnHandleChannel?: string
} = {}): ApplicationIpcMain & {
  handlers: Map<string, unknown>
  handle: ReturnType<typeof vi.fn>
  removeHandler: ReturnType<typeof vi.fn>
  setThrowOnHandleChannel(channel: string | undefined): void
} {
  const handlers = new Map<string, unknown>()
  let failingChannel = throwOnHandleChannel

  return {
    handlers,
    handle: vi.fn((channel: string, listener: unknown) => {
      if (channel === failingChannel) {
        throw new Error('secret duplicate handler failure')
      }

      handlers.set(channel, listener)
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel)
    }),
    setThrowOnHandleChannel(channel: string | undefined): void {
      failingChannel = channel
    }
  }
}
