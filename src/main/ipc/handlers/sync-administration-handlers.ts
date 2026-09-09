import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import type {
  LocalAuthenticationSessionService,
  SyncAdministrationService
} from '@main/application'
import { getErrorType } from '@main/foundation/error-type'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication/authenticated-handler-authorization'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createSyncAdministrationFailure,
  ipcChannels,
  syncAdministrationConfigureRequestSchema,
  syncAdministrationConfigureResultSchema,
  syncAdministrationGetStateRequestSchema,
  syncAdministrationGetStateResultSchema,
  type AuthenticationFailure,
  type SyncAdministrationConfigureResult,
  type SyncAdministrationErrorCode,
  type SyncAdministrationGetStateResult,
  type SyncAdministrationIpcChannel
} from '@shared/ipc'

export interface SyncAdministrationIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface SyncAdministrationIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly syncAdministrationService: SyncAdministrationService
  readonly logger?: SyncAdministrationIpcOperationalLogger
}

export interface SyncAdministrationIpcHandlers {
  getState(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<SyncAdministrationGetStateResult>
  configure(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<SyncAdministrationConfigureResult>
}

const adminRoles = Object.freeze(['LOCAL_ADMIN'] as const)
type SyncAdministrationFailure = Extract<SyncAdministrationGetStateResult, { ok: false }>

export function createSyncAdministrationIpcHandlers({
  navigationPolicy,
  authenticationSessionService,
  syncAdministrationService,
  logger = console
}: SyncAdministrationIpcHandlerDependencies): SyncAdministrationIpcHandlers {
  const authorization = createAuthenticatedHandlerAuthorization({
    navigationPolicy,
    authenticationSessionService,
    logger
  })

  return Object.freeze({
    async getState(event: IpcSenderValidationEvent, request: unknown) {
      return handle({
        channel: ipcChannels.syncAdministration.getState,
        event,
        request,
        requestSchema: syncAdministrationGetStateRequestSchema,
        resultSchema: syncAdministrationGetStateResultSchema,
        authorization,
        logger,
        invoke: () => {
          const result = syncAdministrationService.getState()
          return result.status === 'READY'
            ? createIpcSuccess(result)
            : mapServiceFailure(result.status)
        }
      })
    },
    async configure(event: IpcSenderValidationEvent, request: unknown) {
      return handle({
        channel: ipcChannels.syncAdministration.configure,
        event,
        request,
        requestSchema: syncAdministrationConfigureRequestSchema,
        resultSchema: syncAdministrationConfigureResultSchema,
        authorization,
        logger,
        invoke: (data) => {
          const result = syncAdministrationService.configure(data)
          return result.status === 'CONFIGURED'
            ? createIpcSuccess(result)
            : mapServiceFailure(result.status)
        }
      })
    }
  })
}

async function handle<TRequest, TResult>({
  channel,
  event,
  request,
  requestSchema,
  resultSchema,
  authorization,
  logger,
  invoke
}: {
  readonly channel: SyncAdministrationIpcChannel
  readonly event: IpcSenderValidationEvent
  readonly request: unknown
  readonly requestSchema: z.ZodType<TRequest>
  readonly resultSchema: z.ZodType<TResult>
  readonly authorization: ReturnType<typeof createAuthenticatedHandlerAuthorization>
  readonly logger: SyncAdministrationIpcOperationalLogger
  invoke(request: TRequest): TResult
}): Promise<TResult> {
  const authorized = authorization.requireAnyRole(event, adminRoles)
  if (!authorized.ok) {
    const failure = mapAuthorizationFailure(authorized.failure)
    logFailure(logger, channel, failure.error.code)
    return failure as TResult
  }
  const parsedRequest = safeParse(requestSchema, request)
  if (!parsedRequest.success) {
    const failure = createSyncAdministrationFailure('VALIDATION_FAILED')
    logFailure(logger, channel, failure.error.code)
    return failure as TResult
  }
  try {
    const result = invoke(parsedRequest.data)
    const parsedResult = safeParse(resultSchema, result)
    if (!parsedResult.success) {
      const failure = createSyncAdministrationFailure('INTERNAL_ERROR')
      logFailure(logger, channel, failure.error.code)
      return failure as TResult
    }
    return parsedResult.data
  } catch (error) {
    const failure = createSyncAdministrationFailure('INTERNAL_ERROR')
    logFailure(logger, channel, failure.error.code, error)
    return failure as TResult
  }
}

function mapServiceFailure(
  status:
    | 'AUTHENTICATION_REQUIRED'
    | 'FORBIDDEN'
    | 'VALIDATION_FAILED'
    | 'PROTECTION_UNAVAILABLE'
    | 'UNAVAILABLE'
): SyncAdministrationFailure {
  switch (status) {
    case 'AUTHENTICATION_REQUIRED':
      return createSyncAdministrationFailure('AUTH_UNAUTHENTICATED') as SyncAdministrationFailure
    case 'FORBIDDEN':
      return createSyncAdministrationFailure('AUTHORIZATION_FAILED') as SyncAdministrationFailure
    case 'VALIDATION_FAILED':
      return createSyncAdministrationFailure('VALIDATION_FAILED') as SyncAdministrationFailure
    case 'PROTECTION_UNAVAILABLE':
      return createSyncAdministrationFailure('PROTECTION_UNAVAILABLE') as SyncAdministrationFailure
    case 'UNAVAILABLE':
      return createSyncAdministrationFailure('INTERNAL_ERROR') as SyncAdministrationFailure
  }
}

function mapAuthorizationFailure(failure: AuthenticationFailure): SyncAdministrationFailure {
  switch (failure.error.code) {
    case 'IPC_FORBIDDEN':
      return createSyncAdministrationFailure('IPC_FORBIDDEN') as SyncAdministrationFailure
    case 'AUTH_UNAUTHENTICATED':
      return createSyncAdministrationFailure('AUTH_UNAUTHENTICATED') as SyncAdministrationFailure
    case 'AUTH_LOCKED':
      return createSyncAdministrationFailure('AUTH_LOCKED') as SyncAdministrationFailure
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return createSyncAdministrationFailure(
        'AUTH_PASSWORD_CHANGE_REQUIRED'
      ) as SyncAdministrationFailure
    case 'AUTHORIZATION_FAILED':
      return createSyncAdministrationFailure('AUTHORIZATION_FAILED') as SyncAdministrationFailure
    case 'VALIDATION_FAILED':
      return createSyncAdministrationFailure('VALIDATION_FAILED') as SyncAdministrationFailure
    default:
      return createSyncAdministrationFailure('INTERNAL_ERROR') as SyncAdministrationFailure
  }
}

function logFailure(
  logger: SyncAdministrationIpcOperationalLogger,
  channel: SyncAdministrationIpcChannel,
  code: SyncAdministrationErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=sync-administration; channel=${channel}; code=${code}${errorType}`
    if (code === 'INTERNAL_ERROR') logger.error(message)
    else logger.warn(message)
  } catch {
    // Logging must not alter IPC results.
  }
}

function safeParse<TResult>(
  schema: z.ZodType<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
