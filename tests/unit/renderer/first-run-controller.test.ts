import { describe, expect, it, vi } from 'vitest'

import {
  createAuthenticationFailure,
  createFirstRunFailure,
  createIpcFailure,
  createIpcSuccess,
  createPatientFailure,
  createScreeningSessionFailure,
  type AppGetHealthResult,
  type AppGetInfoResult,
  type AppHealth,
  type AppInfo,
  type FirstRunGetStateResult,
  type FirstRunInitializeResult,
  type FirstRunPublicInconsistencyCode,
  type FirstRunPublicState,
  type HealthScreeningApi
} from '@shared/ipc'
import {
  createFirstRunSubmissionController,
  createRendererStartupStateGate,
  loadRendererStartupState,
  mapInitializeFailure,
  mapInconsistencyMessage,
  startupUnavailableMessages
} from '../../../src/renderer/src/app/first-run/first-run-controller'
import type {
  RendererStartupState,
  SetupSubmissionState
} from '../../../src/renderer/src/app/first-run/first-run-types'
import type { FirstRunSetupFormValues } from '../../../src/renderer/src/app/first-run/first-run-form'

const appInfo: AppInfo = {
  applicationName: 'Health Screening Offline Desktop',
  applicationVersion: '1.0.0',
  platform: 'win32',
  architecture: 'x64',
  packaged: false
}

const readyHealth: AppHealth = {
  status: 'ready',
  ipc: 'available',
  database: 'ready',
  clinicalFeatures: 'not-implemented'
}

const validFormValues: FirstRunSetupFormValues = {
  deploymentName: 'Community Screening',
  timeZone: 'Africa/Douala',
  username: 'admin.user',
  displayName: 'Admin User',
  temporaryPassword: 'temporary-passphrase',
  confirmTemporaryPassword: 'temporary-passphrase',
  locationName: 'Initial Site',
  locationType: 'CHURCH',
  village: '',
  subdivision: '',
  region: '',
  directions: ''
}

const inconsistencyCodes: FirstRunPublicInconsistencyCode[] = [
  'INSTALLATION_MISSING_WITH_LOCAL_DATA',
  'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR',
  'INSTALLATION_PRESENT_WITHOUT_LOCATION',
  'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR_AND_LOCATION'
]

describe('first-run renderer startup controller', () => {
  it('calls the fixed preload reads exactly once and never initializes during load', async () => {
    const api = createApi({ firstRunState: { status: 'REQUIRED' } })

    await expect(loadRendererStartupState(api)).resolves.toEqual({
      status: 'SETUP_REQUIRED',
      info: appInfo,
      health: readyHealth
    })

    expect(api.app.getInfo).toHaveBeenCalledTimes(1)
    expect(api.app.getHealth).toHaveBeenCalledTimes(1)
    expect(api.firstRun.getState).toHaveBeenCalledTimes(1)
    expect(api.firstRun.initialize).not.toHaveBeenCalled()
  })

  it('maps REQUIRED and INITIALIZED first-run states to the reviewed renderer states', async () => {
    await expect(
      loadRendererStartupState(createApi({ firstRunState: { status: 'REQUIRED' } }))
    ).resolves.toMatchObject({ status: 'SETUP_REQUIRED' })

    await expect(
      loadRendererStartupState(
        createApi({
          firstRunState: {
            status: 'INITIALIZED',
            deploymentName: 'Canonical Deployment',
            timeZone: 'Africa/Douala'
          }
        })
      )
    ).resolves.toMatchObject({
      status: 'SETUP_COMPLETE',
      deploymentName: 'Canonical Deployment',
      timeZone: 'Africa/Douala'
    })
  })

  it('maps every reviewed inconsistent state code to a blocking renderer state', async () => {
    for (const code of inconsistencyCodes) {
      await expect(
        loadRendererStartupState(createApi({ firstRunState: { status: 'INCONSISTENT', code } }))
      ).resolves.toEqual({
        status: 'INCONSISTENT',
        info: appInfo,
        health: readyHealth,
        code
      })
      expect(mapInconsistencyMessage(code)).toBe(
        'Required local records are incomplete, and reinitialization is blocked to protect local data.'
      )
    }
  })

  it('maps app, health, and get-state failures to fixed unavailable states', async () => {
    await expect(
      loadRendererStartupState(
        createApi({ infoResult: createIpcFailure('IPC_UNAVAILABLE') as AppGetInfoResult })
      )
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.desktopService,
      canRetry: true
    })

    await expect(
      loadRendererStartupState(
        createApi({ healthResult: createIpcFailure('INTERNAL_ERROR') as AppGetHealthResult })
      )
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.desktopService,
      canRetry: true
    })

    await expect(
      loadRendererStartupState(
        createApi({
          getStateResult: createFirstRunFailure('VALIDATION_FAILED') as FirstRunGetStateResult
        })
      )
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.firstRunState,
      canRetry: true
    })

    await expect(
      loadRendererStartupState(
        createApi({
          getStateResult: createFirstRunFailure('IPC_FORBIDDEN') as FirstRunGetStateResult
        })
      )
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.forbidden,
      canRetry: false
    })
  })

  it('treats forbidden app info startup failure as blocking and non-retryable', async () => {
    await expect(
      loadRendererStartupState(
        createApi({ infoResult: createIpcFailure('IPC_FORBIDDEN') as AppGetInfoResult })
      )
    ).resolves.toEqual(createForbiddenStartupState())
  })

  it('treats forbidden app health startup failure as blocking and non-retryable', async () => {
    await expect(
      loadRendererStartupState(
        createApi({ healthResult: createIpcFailure('IPC_FORBIDDEN') as AppGetHealthResult })
      )
    ).resolves.toEqual(createForbiddenStartupState())
  })

  it('prioritizes forbidden first-run state over retryable app info failure', async () => {
    await expect(
      loadRendererStartupState(
        createApi({
          infoResult: createIpcFailure('IPC_UNAVAILABLE') as AppGetInfoResult,
          getStateResult: createFirstRunFailure('IPC_FORBIDDEN') as FirstRunGetStateResult
        })
      )
    ).resolves.toEqual(createForbiddenStartupState())
  })

  it('prioritizes forbidden first-run state over unavailable database health', async () => {
    await expect(
      loadRendererStartupState(
        createApi({
          healthResult: createIpcSuccess({
            ...readyHealth,
            database: 'unavailable'
          }) as AppGetHealthResult,
          getStateResult: createFirstRunFailure('IPC_FORBIDDEN') as FirstRunGetStateResult
        })
      )
    ).resolves.toEqual(createForbiddenStartupState())
  })

  it('does not show setup when health reports an unavailable database', async () => {
    await expect(
      loadRendererStartupState(
        createApi({
          healthResult: createIpcSuccess({
            ...readyHealth,
            database: 'unavailable'
          }) as AppGetHealthResult,
          firstRunState: { status: 'REQUIRED' }
        })
      )
    ).resolves.toEqual({
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.database,
      canRetry: true
    })
  })

  it('ignores late results from obsolete load attempts and disposed gates', async () => {
    const first = deferred<RendererStartupState>()
    const second = deferred<RendererStartupState>()
    const states: RendererStartupState[] = []
    const loadState = vi.fn<() => Promise<RendererStartupState>>()
    loadState.mockReturnValueOnce(first.promise)
    loadState.mockReturnValueOnce(second.promise)

    const gate = createRendererStartupStateGate({
      api: createApi({ firstRunState: { status: 'REQUIRED' } }),
      loadState,
      onState: (state) => states.push(state)
    })

    const firstLoad = gate.load()
    const secondLoad = gate.load()

    second.resolve({
      status: 'SETUP_COMPLETE',
      info: appInfo,
      health: readyHealth,
      deploymentName: 'Canonical Deployment',
      timeZone: 'Africa/Douala'
    })
    await secondLoad

    first.resolve({ status: 'SETUP_REQUIRED', info: appInfo, health: readyHealth })
    await firstLoad

    expect(states[states.length - 1]).toMatchObject({ status: 'SETUP_COMPLETE' })

    const disposedState = deferred<RendererStartupState>()
    const disposedStates: RendererStartupState[] = []
    const disposedGate = createRendererStartupStateGate({
      api: createApi({ firstRunState: { status: 'REQUIRED' } }),
      loadState: () => disposedState.promise,
      onState: (state) => disposedStates.push(state)
    })

    const disposedLoad = disposedGate.load()
    disposedGate.dispose()
    disposedState.resolve({ status: 'SETUP_REQUIRED', info: appInfo, health: readyHealth })
    await disposedLoad

    expect(disposedStates).toEqual([{ status: 'LOADING' }])
  })
})

describe('first-run renderer submission controller', () => {
  it('maps every initialize failure code to the fixed renderer behavior', () => {
    expect(mapInitializeFailure('VALIDATION_FAILED')).toEqual({
      action: 'FORM_ERROR',
      message: 'Review the form and correct missing or invalid values.'
    })
    expect(mapInitializeFailure('FIRST_RUN_INITIALIZATION_IN_PROGRESS')).toEqual({
      action: 'SERVICE_ERROR',
      message: 'Setup is already in progress. Wait a moment and try again.'
    })
    expect(mapInitializeFailure('FIRST_RUN_INITIALIZATION_FAILED')).toEqual({
      action: 'SERVICE_ERROR',
      message:
        'Local setup could not be completed. No partial setup was saved. Review the information and try again.'
    })
    expect(mapInitializeFailure('IPC_UNAVAILABLE')).toEqual({
      action: 'SERVICE_ERROR',
      message: 'The desktop service is unavailable. Try again after the application is ready.'
    })
    expect(mapInitializeFailure('INTERNAL_ERROR')).toEqual({
      action: 'SERVICE_ERROR',
      message: 'The application could not complete setup. Try again or exit.'
    })
    expect(mapInitializeFailure('IPC_FORBIDDEN')).toEqual({
      action: 'UNAVAILABLE',
      message: 'This setup operation is unavailable from the current window.',
      canRetry: false
    })
    expect(mapInitializeFailure('FIRST_RUN_ALREADY_INITIALIZED')).toMatchObject({
      action: 'RELOAD_STATE'
    })
    expect(mapInitializeFailure('FIRST_RUN_STATE_INTEGRITY')).toMatchObject({
      action: 'RELOAD_STATE'
    })
  })

  it('prevents initialize when password confirmation does not match', async () => {
    const api = createApi({ firstRunState: { status: 'REQUIRED' } })
    const submissionStates: SetupSubmissionState[] = []
    const controller = createFirstRunSubmissionController({
      api,
      info: appInfo,
      health: readyHealth,
      onSubmissionState: (state) => submissionStates.push(state),
      onStartupState: vi.fn()
    })

    await controller.submit({
      ...validFormValues,
      confirmTemporaryPassword: 'different-passphrase'
    })

    expect(api.firstRun.initialize).not.toHaveBeenCalled()
    expect(submissionStates).toEqual([{ status: 'FORM_ERROR', message: 'Passwords do not match' }])
  })

  it('guards rapid repeated submits while an initialization is pending', async () => {
    const pendingInitialize = deferred<FirstRunInitializeResult>()
    const api = createApi({
      initializeResult: () => pendingInitialize.promise
    })
    const controller = createFirstRunSubmissionController({
      api,
      info: appInfo,
      health: readyHealth,
      onSubmissionState: vi.fn(),
      onStartupState: vi.fn()
    })

    const firstSubmit = controller.submit(validFormValues)
    const secondSubmit = controller.submit(validFormValues)

    expect(api.firstRun.initialize).toHaveBeenCalledTimes(1)

    pendingInitialize.resolve(
      createIpcSuccess({
        status: 'INITIALIZED',
        deploymentName: 'Canonical Deployment',
        timeZone: 'Africa/Douala'
      }) as FirstRunInitializeResult
    )

    await Promise.all([firstSubmit, secondSubmit])
    expect(api.firstRun.initialize).toHaveBeenCalledTimes(1)
  })

  it('success state uses only canonical public setup data from main', async () => {
    const startupStates: RendererStartupState[] = []
    const clearSensitiveForm = vi.fn()
    const controller = createFirstRunSubmissionController({
      api: createApi({
        initializeResult: createIpcSuccess({
          status: 'INITIALIZED',
          deploymentName: 'Canonical Deployment',
          timeZone: 'Africa/Douala'
        }) as FirstRunInitializeResult
      }),
      info: appInfo,
      health: readyHealth,
      onSubmissionState: vi.fn(),
      onStartupState: (state) => startupStates.push(state),
      onClearSensitiveForm: clearSensitiveForm
    })

    await controller.submit({
      ...validFormValues,
      username: 'should-not-render',
      displayName: 'Should Not Render',
      temporaryPassword: 'never-serialize-this',
      confirmTemporaryPassword: 'never-serialize-this',
      locationName: 'Hidden Location'
    })

    expect(clearSensitiveForm).toHaveBeenCalledTimes(1)
    expect(startupStates).toEqual([
      {
        status: 'SETUP_COMPLETE',
        info: appInfo,
        health: readyHealth,
        deploymentName: 'Canonical Deployment',
        timeZone: 'Africa/Douala'
      }
    ])

    const serializedState = JSON.stringify(startupStates[0])
    expect(serializedState).not.toContain('should-not-render')
    expect(serializedState).not.toContain('Should Not Render')
    expect(serializedState).not.toContain('never-serialize-this')
    expect(serializedState).not.toContain('Hidden Location')
    expect(serializedState).not.toContain('audit')
    expect(serializedState).not.toContain('createdAt')
    expect(serializedState).not.toContain('id')
  })

  it('reloads state at most once for already-initialized failures without resubmitting', async () => {
    const api = createApi({
      initializeResult: createFirstRunFailure(
        'FIRST_RUN_ALREADY_INITIALIZED'
      ) as FirstRunInitializeResult,
      firstRunState: {
        status: 'INITIALIZED',
        deploymentName: 'Canonical Deployment',
        timeZone: 'Africa/Douala'
      }
    })
    const startupStates: RendererStartupState[] = []
    const controller = createFirstRunSubmissionController({
      api,
      info: appInfo,
      health: readyHealth,
      onSubmissionState: vi.fn(),
      onStartupState: (state) => startupStates.push(state)
    })

    await controller.submit(validFormValues)

    expect(api.firstRun.initialize).toHaveBeenCalledTimes(1)
    expect(api.firstRun.getState).toHaveBeenCalledTimes(1)
    expect(startupStates).toHaveLength(1)
    expect(startupStates[0]).toMatchObject({ status: 'SETUP_COMPLETE' })
  })

  it('reloads state at most once for integrity failures and routes to blocking inconsistent state', async () => {
    const api = createApi({
      initializeResult: createFirstRunFailure(
        'FIRST_RUN_STATE_INTEGRITY'
      ) as FirstRunInitializeResult,
      firstRunState: {
        status: 'INCONSISTENT',
        code: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
      }
    })
    const startupStates: RendererStartupState[] = []
    const controller = createFirstRunSubmissionController({
      api,
      info: appInfo,
      health: readyHealth,
      onSubmissionState: vi.fn(),
      onStartupState: (state) => startupStates.push(state)
    })

    await controller.submit(validFormValues)

    expect(api.firstRun.initialize).toHaveBeenCalledTimes(1)
    expect(api.firstRun.getState).toHaveBeenCalledTimes(1)
    expect(startupStates).toEqual([
      {
        status: 'INCONSISTENT',
        info: appInfo,
        health: readyHealth,
        code: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
      }
    ])
  })
})

function createApi({
  infoResult = createIpcSuccess(appInfo) as AppGetInfoResult,
  healthResult = createIpcSuccess(readyHealth) as AppGetHealthResult,
  firstRunState,
  getStateResult,
  initializeResult = createIpcSuccess({
    status: 'INITIALIZED',
    deploymentName: 'Canonical Deployment',
    timeZone: 'Africa/Douala'
  }) as FirstRunInitializeResult
}: {
  infoResult?: AppGetInfoResult
  healthResult?: AppGetHealthResult
  firstRunState?: FirstRunPublicState
  getStateResult?: FirstRunGetStateResult
  initializeResult?:
    | FirstRunInitializeResult
    | ((
        request: Parameters<HealthScreeningApi['firstRun']['initialize']>[0]
      ) => Promise<FirstRunInitializeResult>)
}): HealthScreeningApi {
  const stateResult =
    getStateResult ??
    (createIpcSuccess(firstRunState ?? { status: 'REQUIRED' }) as FirstRunGetStateResult)

  return {
    app: {
      getInfo: vi.fn(async () => infoResult),
      getHealth: vi.fn(async () => healthResult)
    },
    firstRun: {
      getState: vi.fn(async () => stateResult),
      initialize: vi.fn((request) => {
        if (typeof initializeResult === 'function') {
          return initializeResult(request)
        }

        return Promise.resolve(initializeResult)
      })
    },
    auth: {
      getSession: vi.fn(
        async () =>
          createIpcSuccess({ status: 'SIGNED_OUT', revision: 0 }) as Awaited<
            ReturnType<HealthScreeningApi['auth']['getSession']>
          >
      ),
      login: vi.fn(
        async () =>
          createAuthenticationFailure('IPC_UNAVAILABLE') as Awaited<
            ReturnType<HealthScreeningApi['auth']['login']>
          >
      ),
      changeRequiredPassword: vi.fn(
        async () =>
          createAuthenticationFailure('IPC_UNAVAILABLE') as Awaited<
            ReturnType<HealthScreeningApi['auth']['changeRequiredPassword']>
          >
      ),
      unlock: vi.fn(
        async () =>
          createAuthenticationFailure('IPC_UNAVAILABLE') as Awaited<
            ReturnType<HealthScreeningApi['auth']['unlock']>
          >
      ),
      lock: vi.fn(
        async () =>
          createAuthenticationFailure('IPC_UNAVAILABLE') as Awaited<
            ReturnType<HealthScreeningApi['auth']['lock']>
          >
      ),
      logout: vi.fn(
        async () =>
          createAuthenticationFailure('IPC_UNAVAILABLE') as Awaited<
            ReturnType<HealthScreeningApi['auth']['logout']>
          >
      ),
      recordActivity: vi.fn(
        async () =>
          createAuthenticationFailure('IPC_UNAVAILABLE') as Awaited<
            ReturnType<HealthScreeningApi['auth']['recordActivity']>
          >
      ),
      onSessionChanged: vi.fn(() => () => undefined)
    },
    patient: {
      search: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      get: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      create: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      amendDemographics: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      listDemographicAmendmentHistory: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      recordAcknowledgment: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      listAcknowledgmentHistory: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      listRecent: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      findDuplicates: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE')),
      markNotDuplicate: vi.fn(async () => createPatientFailure('IPC_UNAVAILABLE'))
    },
    screeningSessions: {
      getWorkspaceContext: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE')),
      ensureCurrent: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE')),
      create: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE')),
      close: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE')),
      reopen: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE')),
      getById: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE')),
      list: vi.fn(async () => createScreeningSessionFailure('IPC_UNAVAILABLE'))
    },
    screeningEncounters: {
      start: vi.fn(async () => createIpcSuccess({ status: 'UNAVAILABLE' as const }))
    }
  }
}

function createForbiddenStartupState(): RendererStartupState {
  return {
    status: 'UNAVAILABLE',
    message: startupUnavailableMessages.forbidden,
    canRetry: false
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolveValue: ((value: T) => void) | undefined
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })

  return {
    promise,
    resolve(value: T) {
      if (resolveValue === undefined) {
        throw new Error('Deferred promise resolver is unavailable.')
      }

      resolveValue(value)
    }
  }
}
