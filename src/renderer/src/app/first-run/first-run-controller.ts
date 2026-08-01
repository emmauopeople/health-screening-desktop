import type {
  AppGetHealthResult,
  AppGetInfoResult,
  AppHealth,
  AppInfo,
  FirstRunGetStateResult,
  FirstRunGetStateErrorCode,
  FirstRunInitializeErrorCode,
  FirstRunPublicInconsistencyCode,
  FirstRunPublicState,
  HealthScreeningApi
} from '@shared/ipc'

import {
  createFirstRunInitializeRequest,
  passwordMismatchMessage,
  passwordsMatch,
  reviewFormMessage,
  type FirstRunSetupFormValues
} from './first-run-form'
import type { RendererStartupState, SetupSubmissionState } from './first-run-types'

export const firstRunScreenCopy = {
  loadingStatus: 'Loading local application status.',
  setupCompleteHeading: 'Local setup is complete.',
  setupCompleteStatement: 'Authentication is ready for local users.',
  inconsistentHeading: 'Local setup cannot continue.',
  inconsistentStatement:
    'Required local records are incomplete, and reinitialization is blocked to protect local data.',
  unavailableHeading: 'The local desktop service is unavailable.',
  retryLabel: 'Retry',
  exitLabel: 'Exit application'
} as const

export const startupUnavailableMessages = {
  desktopService:
    'The desktop service could not provide local application status. Retry after the application is ready.',
  firstRunState: 'First-run setup state could not be loaded. Retry after the application is ready.',
  forbidden: 'This operation is unavailable from the current window.',
  database: 'The local database is unavailable. Setup cannot continue until the database is ready.'
} as const

export type InitializeFailureMapping =
  | { action: 'FORM_ERROR'; message: string }
  | { action: 'SERVICE_ERROR'; message: string }
  | { action: 'RELOAD_STATE'; fallbackMessage: string }
  | { action: 'UNAVAILABLE'; message: string; canRetry: false }

export async function loadRendererStartupState(
  api: HealthScreeningApi
): Promise<RendererStartupState> {
  const [infoResult, healthResult, firstRunResult] = await Promise.all([
    api.app.getInfo(),
    api.app.getHealth(),
    api.firstRun.getState()
  ])

  return mapStartupResults(infoResult, healthResult, firstRunResult)
}

export function mapStartupResults(
  infoResult: AppGetInfoResult,
  healthResult: AppGetHealthResult,
  firstRunResult: FirstRunGetStateResult
): RendererStartupState {
  if (hasForbiddenStartupFailure(infoResult, healthResult, firstRunResult)) {
    return {
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.forbidden,
      canRetry: false
    }
  }

  if (!infoResult.ok || !healthResult.ok) {
    return {
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.desktopService,
      canRetry: true
    }
  }

  if (healthResult.data.database !== 'ready') {
    return {
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.database,
      canRetry: true
    }
  }

  if (!firstRunResult.ok) {
    return mapFirstRunStateFailure(firstRunResult.error.code)
  }

  return mapFirstRunPublicState(infoResult.data, healthResult.data, firstRunResult.data)
}

function hasForbiddenStartupFailure(
  infoResult: AppGetInfoResult,
  healthResult: AppGetHealthResult,
  firstRunResult: FirstRunGetStateResult
): boolean {
  return (
    (!infoResult.ok && infoResult.error.code === 'IPC_FORBIDDEN') ||
    (!healthResult.ok && healthResult.error.code === 'IPC_FORBIDDEN') ||
    (!firstRunResult.ok && firstRunResult.error.code === 'IPC_FORBIDDEN')
  )
}

export function mapFirstRunPublicState(
  info: AppInfo,
  health: AppHealth,
  firstRunState: FirstRunPublicState
): RendererStartupState {
  switch (firstRunState.status) {
    case 'REQUIRED':
      return { status: 'SETUP_REQUIRED', info, health }
    case 'INITIALIZED':
      return {
        status: 'SETUP_COMPLETE',
        info,
        health,
        deploymentName: firstRunState.deploymentName,
        timeZone: firstRunState.timeZone
      }
    case 'INCONSISTENT':
      return { status: 'INCONSISTENT', info, health, code: firstRunState.code }
  }
}

export function mapInconsistencyMessage(code: FirstRunPublicInconsistencyCode): string {
  void code

  return firstRunScreenCopy.inconsistentStatement
}

export function mapInitializeFailure(code: FirstRunInitializeErrorCode): InitializeFailureMapping {
  switch (code) {
    case 'VALIDATION_FAILED':
      return {
        action: 'FORM_ERROR',
        message: reviewFormMessage
      }
    case 'FIRST_RUN_ALREADY_INITIALIZED':
      return {
        action: 'RELOAD_STATE',
        fallbackMessage: 'Application setup is already complete. Reload local status and try again.'
      }
    case 'FIRST_RUN_STATE_INTEGRITY':
      return {
        action: 'RELOAD_STATE',
        fallbackMessage:
          'Local setup cannot continue because required local records are incomplete.'
      }
    case 'FIRST_RUN_INITIALIZATION_IN_PROGRESS':
      return {
        action: 'SERVICE_ERROR',
        message: 'Setup is already in progress. Wait a moment and try again.'
      }
    case 'FIRST_RUN_INITIALIZATION_FAILED':
      return {
        action: 'SERVICE_ERROR',
        message:
          'Local setup could not be completed. No partial setup was saved. Review the information and try again.'
      }
    case 'IPC_UNAVAILABLE':
      return {
        action: 'SERVICE_ERROR',
        message: 'The desktop service is unavailable. Try again after the application is ready.'
      }
    case 'INTERNAL_ERROR':
      return {
        action: 'SERVICE_ERROR',
        message: 'The application could not complete setup. Try again or exit.'
      }
    case 'IPC_FORBIDDEN':
      return {
        action: 'UNAVAILABLE',
        message: 'This setup operation is unavailable from the current window.',
        canRetry: false
      }
  }
}

export interface RendererStartupStateGate {
  load(): Promise<void>
  dispose(): void
}

export interface RendererStartupStateGateOptions {
  api: HealthScreeningApi
  onState(state: RendererStartupState): void
  loadState?: (api: HealthScreeningApi) => Promise<RendererStartupState>
}

export function createRendererStartupStateGate({
  api,
  onState,
  loadState = loadRendererStartupState
}: RendererStartupStateGateOptions): RendererStartupStateGate {
  let generation = 0
  let disposed = false

  async function load(): Promise<void> {
    const activeGeneration = generation + 1
    generation = activeGeneration
    onState({ status: 'LOADING' })

    try {
      const state = await loadState(api)

      if (!disposed && activeGeneration === generation) {
        onState(state)
      }
    } catch {
      if (!disposed && activeGeneration === generation) {
        onState(createUnhandledStartupUnavailableState())
      }
    }
  }

  return {
    load,
    dispose() {
      disposed = true
      generation += 1
    }
  }
}

export interface FirstRunSubmissionController {
  submit(values: FirstRunSetupFormValues): Promise<void>
  dispose(): void
}

export interface FirstRunSubmissionControllerOptions {
  api: HealthScreeningApi
  info: AppInfo
  health: AppHealth
  onSubmissionState(state: SetupSubmissionState): void
  onStartupState(state: RendererStartupState): void
  onClearSensitiveForm?: () => void
}

export function createFirstRunSubmissionController({
  api,
  info,
  health,
  onSubmissionState,
  onStartupState,
  onClearSensitiveForm
}: FirstRunSubmissionControllerOptions): FirstRunSubmissionController {
  let inFlight = false
  let disposed = false

  async function submit(values: FirstRunSetupFormValues): Promise<void> {
    if (inFlight || disposed) {
      return
    }

    if (!passwordsMatch(values)) {
      onSubmissionState({ status: 'FORM_ERROR', message: passwordMismatchMessage })
      return
    }

    let command: ReturnType<typeof createFirstRunInitializeRequest>

    try {
      command = createFirstRunInitializeRequest(values)
    } catch {
      onSubmissionState({ status: 'FORM_ERROR', message: reviewFormMessage })
      return
    }

    inFlight = true
    onSubmissionState({ status: 'SUBMITTING' })

    try {
      let result: Awaited<ReturnType<HealthScreeningApi['firstRun']['initialize']>>

      try {
        result = await api.firstRun.initialize(command)
      } catch {
        if (!disposed) {
          onSubmissionState({
            status: 'SERVICE_ERROR',
            message: 'The desktop service is unavailable. Try again after the application is ready.'
          })
        }

        return
      }

      if (disposed) {
        return
      }

      if (result.ok) {
        onClearSensitiveForm?.()
        onStartupState({
          status: 'SETUP_COMPLETE',
          info,
          health,
          deploymentName: result.data.deploymentName,
          timeZone: result.data.timeZone
        })
        return
      }

      await applyInitializeFailure(result.error.code)
    } finally {
      if (!disposed) {
        inFlight = false
      }
    }
  }

  async function applyInitializeFailure(code: FirstRunInitializeErrorCode): Promise<void> {
    const mapping = mapInitializeFailure(code)

    switch (mapping.action) {
      case 'FORM_ERROR':
      case 'SERVICE_ERROR':
        onSubmissionState({ status: mapping.action, message: mapping.message })
        return
      case 'UNAVAILABLE':
        onClearSensitiveForm?.()
        onStartupState({
          status: 'UNAVAILABLE',
          message: mapping.message,
          canRetry: mapping.canRetry
        })
        return
      case 'RELOAD_STATE': {
        const reloadedState = await loadFirstRunStateAfterInitialize(api, info, health)

        if (disposed) {
          return
        }

        if (reloadedState.status === 'SETUP_REQUIRED') {
          onSubmissionState({ status: 'SERVICE_ERROR', message: mapping.fallbackMessage })
          return
        }

        onClearSensitiveForm?.()
        onStartupState(reloadedState)
      }
    }
  }

  return {
    submit,
    dispose() {
      disposed = true
    }
  }
}

export async function loadFirstRunStateAfterInitialize(
  api: HealthScreeningApi,
  info: AppInfo,
  health: AppHealth
): Promise<RendererStartupState> {
  let result: FirstRunGetStateResult

  try {
    result = await api.firstRun.getState()
  } catch {
    return {
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.firstRunState,
      canRetry: true
    }
  }

  if (!result.ok) {
    return mapFirstRunStateFailure(result.error.code)
  }

  return mapFirstRunPublicState(info, health, result.data)
}

export function createSetupCompleteViewModel(
  state: Extract<RendererStartupState, { status: 'SETUP_COMPLETE' }>
): {
  heading: typeof firstRunScreenCopy.setupCompleteHeading
  statement: typeof firstRunScreenCopy.setupCompleteStatement
  deploymentName: string
  timeZone: string
} {
  return {
    heading: firstRunScreenCopy.setupCompleteHeading,
    statement: firstRunScreenCopy.setupCompleteStatement,
    deploymentName: state.deploymentName,
    timeZone: state.timeZone
  }
}

function mapFirstRunStateFailure(code: FirstRunGetStateErrorCode): RendererStartupState {
  if (code === 'IPC_FORBIDDEN') {
    return {
      status: 'UNAVAILABLE',
      message: startupUnavailableMessages.forbidden,
      canRetry: false
    }
  }

  return {
    status: 'UNAVAILABLE',
    message: startupUnavailableMessages.firstRunState,
    canRetry: true
  }
}

function createUnhandledStartupUnavailableState(): RendererStartupState {
  return {
    status: 'UNAVAILABLE',
    message: startupUnavailableMessages.desktopService,
    canRetry: true
  }
}
