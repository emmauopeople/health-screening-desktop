import { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import {
  FirstRunAlreadyInitializedError,
  FirstRunInitializationError,
  FirstRunInitializationInProgressError,
  FirstRunStateIntegrityError,
  FirstRunValidationError,
  type FirstRunBootstrapService,
  type FirstRunBootstrapState
} from '@main/application'
import { sanitizeErrorType } from '@main/foundation/error-type'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createFirstRunFailure,
  createIpcSuccess,
  firstRunGetStateRequestSchema,
  firstRunGetStateResultSchema,
  firstRunInitializeRequestSchema,
  firstRunInitializeResultSchema,
  firstRunInitializedStateSchema,
  firstRunPublicStateSchema,
  ipcChannels,
  type FirstRunGetStateResult,
  type FirstRunInitializeErrorCode,
  type FirstRunInitializeResult,
  type FirstRunInitializedState,
  type FirstRunIpcChannel,
  type FirstRunPublicState
} from '@shared/ipc'

export interface FirstRunIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface FirstRunIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly firstRunBootstrapService: FirstRunBootstrapService
  readonly logger?: FirstRunIpcOperationalLogger
}

export interface FirstRunIpcHandlers {
  getState(event: IpcSenderValidationEvent, request: unknown): Promise<FirstRunGetStateResult>
  initialize(event: IpcSenderValidationEvent, request: unknown): Promise<FirstRunInitializeResult>
}

export function createFirstRunIpcHandlers({
  navigationPolicy,
  firstRunBootstrapService,
  logger = console
}: FirstRunIpcHandlerDependencies): FirstRunIpcHandlers {
  const getState = async (
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<FirstRunGetStateResult> => {
    const channel = ipcChannels.firstRun.getState

    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      logFirstRunIpcFailure(logger, channel, 'IPC_FORBIDDEN')
      return createFirstRunFailure('IPC_FORBIDDEN') as FirstRunGetStateResult
    }

    const requestResult = safeParseIpcValue(firstRunGetStateRequestSchema, request)

    if (!requestResult.success) {
      logFirstRunIpcFailure(logger, channel, 'VALIDATION_FAILED')
      return createFirstRunFailure('VALIDATION_FAILED') as FirstRunGetStateResult
    }

    try {
      const publicState = toPublicFirstRunState(firstRunBootstrapService.getState())
      const responseResult = safeParseIpcValue(firstRunPublicStateSchema, publicState)

      if (!responseResult.success) {
        logFirstRunIpcFailure(logger, channel, 'INTERNAL_ERROR', responseResult.error)
        return createFirstRunFailure('INTERNAL_ERROR') as FirstRunGetStateResult
      }

      const envelope = createIpcSuccess(responseResult.data)
      const envelopeResult = safeParseIpcValue(firstRunGetStateResultSchema, envelope)

      if (!envelopeResult.success) {
        logFirstRunIpcFailure(logger, channel, 'INTERNAL_ERROR', envelopeResult.error)
        return createFirstRunFailure('INTERNAL_ERROR') as FirstRunGetStateResult
      }

      return envelopeResult.data
    } catch (error) {
      logFirstRunIpcFailure(logger, channel, 'INTERNAL_ERROR', error)
      return createFirstRunFailure('INTERNAL_ERROR') as FirstRunGetStateResult
    }
  }

  const initialize = async (
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<FirstRunInitializeResult> => {
    const channel = ipcChannels.firstRun.initialize

    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      logFirstRunIpcFailure(logger, channel, 'IPC_FORBIDDEN')
      return createFirstRunFailure('IPC_FORBIDDEN') as FirstRunInitializeResult
    }

    const requestResult = safeParseIpcValue(firstRunInitializeRequestSchema, request)

    if (!requestResult.success) {
      logFirstRunIpcFailure(logger, channel, 'VALIDATION_FAILED')
      return createFirstRunFailure('VALIDATION_FAILED') as FirstRunInitializeResult
    }

    try {
      const result = await firstRunBootstrapService.initialize(requestResult.data)
      const publicState: FirstRunInitializedState = {
        status: 'INITIALIZED',
        deploymentName: result.installation.deploymentName,
        timeZone: result.installation.timeZone
      }
      const responseResult = safeParseIpcValue(firstRunInitializedStateSchema, publicState)

      if (!responseResult.success) {
        logFirstRunIpcFailure(logger, channel, 'INTERNAL_ERROR', responseResult.error)
        return createFirstRunFailure('INTERNAL_ERROR') as FirstRunInitializeResult
      }

      const envelope = createIpcSuccess(responseResult.data)
      const envelopeResult = safeParseIpcValue(firstRunInitializeResultSchema, envelope)

      if (!envelopeResult.success) {
        logFirstRunIpcFailure(logger, channel, 'INTERNAL_ERROR', envelopeResult.error)
        return createFirstRunFailure('INTERNAL_ERROR') as FirstRunInitializeResult
      }

      return envelopeResult.data
    } catch (error) {
      const code = getInitializeFailureCode(error)
      logFirstRunIpcFailure(logger, channel, code, error)
      return createFirstRunFailure(code) as FirstRunInitializeResult
    }
  }

  return Object.freeze({
    getState,
    initialize
  })
}

export function toPublicFirstRunState(state: FirstRunBootstrapState): FirstRunPublicState {
  if (state.status === 'REQUIRED') {
    return { status: 'REQUIRED' }
  }

  if (state.status === 'INITIALIZED') {
    return {
      status: 'INITIALIZED',
      deploymentName: state.installation.deploymentName,
      timeZone: state.installation.timeZone
    }
  }

  return {
    status: 'INCONSISTENT',
    code: state.code
  }
}

function getInitializeFailureCode(error: unknown): FirstRunInitializeErrorCode {
  if (error instanceof FirstRunValidationError) {
    return 'VALIDATION_FAILED'
  }

  if (error instanceof FirstRunAlreadyInitializedError) {
    return 'FIRST_RUN_ALREADY_INITIALIZED'
  }

  if (error instanceof FirstRunStateIntegrityError) {
    return 'FIRST_RUN_STATE_INTEGRITY'
  }

  if (error instanceof FirstRunInitializationInProgressError) {
    return 'FIRST_RUN_INITIALIZATION_IN_PROGRESS'
  }

  if (error instanceof FirstRunInitializationError) {
    return 'FIRST_RUN_INITIALIZATION_FAILED'
  }

  return 'INTERNAL_ERROR'
}

function logFirstRunIpcFailure(
  logger: FirstRunIpcOperationalLogger,
  channel: FirstRunIpcChannel,
  code: FirstRunInitializeErrorCode,
  error?: unknown
): void {
  const errorType = error === undefined ? '' : `; errorType=${getSafeErrorType(error)}`
  const message = `IPC handler result channel=${channel}; code=${code}${errorType}`

  if (code === 'INTERNAL_ERROR' || code === 'FIRST_RUN_INITIALIZATION_FAILED') {
    logger.error(message)
    return
  }

  logger.warn(message)
}

function getSafeErrorType(error: unknown): string {
  if (error instanceof z.ZodError) {
    return 'UnknownError'
  }

  if (error instanceof Error) {
    return sanitizeErrorType(error.name) ?? 'UnknownError'
  }

  return sanitizeErrorType(typeof error) ?? 'UnknownError'
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false; error?: unknown }
}

function safeParseIpcValue<TResult>(
  schema: IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false; error?: unknown } {
  try {
    return schema.safeParse(value)
  } catch (error) {
    return { success: false, error }
  }
}
