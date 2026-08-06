import type { z } from 'zod'

import type {
  CreateScreeningSessionRequest as InternalCreateScreeningSessionRequest,
  CloseScreeningSessionRequest as InternalCloseScreeningSessionRequest,
  GetScreeningSessionRequest as InternalGetScreeningSessionRequest,
  ListScreeningSessionsRequest as InternalListScreeningSessionsRequest,
  LocalAuthenticationSessionService,
  ReopenScreeningSessionRequest as InternalReopenScreeningSessionRequest,
  ScreeningSessionService,
  ScreeningSessionWorkspaceContextService
} from '@main/application'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import type { LocalUserRole, ScreeningSessionRecord } from '@main/database'
import type { EntityId } from '@main/foundation/entity-id'
import { getErrorType } from '@main/foundation/error-type'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication/authenticated-handler-authorization'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningSessionFailure,
  ipcChannels,
  screeningSessionCloseRequestSchema,
  screeningSessionCloseResultSchema,
  screeningSessionCreateRequestSchema,
  screeningSessionCreateResultSchema,
  screeningSessionGetByIdRequestSchema,
  screeningSessionGetByIdResultSchema,
  screeningSessionGetWorkspaceContextRequestSchema,
  screeningSessionGetWorkspaceContextResultSchema,
  screeningSessionListRequestSchema,
  screeningSessionListResultSchema,
  screeningSessionReopenRequestSchema,
  screeningSessionReopenResultSchema,
  type AuthenticationFailure,
  type PublicScreeningSession,
  type ScreeningSessionCloseRequest,
  type ScreeningSessionCloseResult,
  type ScreeningSessionCreateRequest,
  type ScreeningSessionCreateResult,
  type ScreeningSessionErrorCode,
  type ScreeningSessionGetByIdRequest,
  type ScreeningSessionGetByIdResult,
  type ScreeningSessionGetWorkspaceContextResult,
  type ScreeningSessionIpcChannel,
  type ScreeningSessionListRequest,
  type ScreeningSessionListResult,
  type ScreeningSessionReopenRequest,
  type ScreeningSessionReopenResult
} from '@shared/ipc'

export interface ScreeningSessionIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface ScreeningSessionIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly screeningSessionService: ScreeningSessionService
  readonly screeningSessionWorkspaceContextService: ScreeningSessionWorkspaceContextService
  readonly logger?: ScreeningSessionIpcOperationalLogger
}

export interface ScreeningSessionIpcHandlers {
  getWorkspaceContext(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningSessionGetWorkspaceContextResult>
  create(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningSessionCreateResult>
  close(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningSessionCloseResult>
  reopen(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningSessionReopenResult>
  getById(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningSessionGetByIdResult>
  list(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningSessionListResult>
}

const allLocalRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const reopenRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE'] as const)

export function createScreeningSessionIpcHandlers({
  navigationPolicy,
  authenticationSessionService,
  screeningSessionService,
  screeningSessionWorkspaceContextService,
  logger = console
}: ScreeningSessionIpcHandlerDependencies): ScreeningSessionIpcHandlers {
  const authorization = createAuthenticatedHandlerAuthorization({
    navigationPolicy,
    authenticationSessionService,
    logger
  })

  return Object.freeze({
    async getWorkspaceContext(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningSessionGetWorkspaceContextResult> {
      return handleScreeningSessionRequest({
        channel: ipcChannels.screeningSessions.getWorkspaceContext,
        request,
        requestSchema: screeningSessionGetWorkspaceContextRequestSchema,
        resultSchema: screeningSessionGetWorkspaceContextResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: () => {
          const context = screeningSessionWorkspaceContextService.getContext()

          return freezeSuccess({
            deploymentLocalDate: context.deploymentLocalDate,
            activeLocations: context.activeLocations.map((location) => ({
              id: location.id,
              name: location.name
            }))
          })
        }
      })
    },

    async create(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningSessionCreateResult> {
      return handleScreeningSessionRequest({
        channel: ipcChannels.screeningSessions.create,
        request,
        requestSchema: screeningSessionCreateRequestSchema,
        resultSchema: screeningSessionCreateResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapCreateResult(screeningSessionService.create(toInternalCreateRequest(data), actor))
      })
    },

    async close(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningSessionCloseResult> {
      return handleScreeningSessionRequest({
        channel: ipcChannels.screeningSessions.close,
        request,
        requestSchema: screeningSessionCloseRequestSchema,
        resultSchema: screeningSessionCloseResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapCloseResult(screeningSessionService.close(toInternalCloseRequest(data), actor))
      })
    },

    async reopen(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningSessionReopenResult> {
      return handleScreeningSessionRequest({
        channel: ipcChannels.screeningSessions.reopen,
        request,
        requestSchema: screeningSessionReopenRequestSchema,
        resultSchema: screeningSessionReopenResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, reopenRoles),
        invoke: (data, actor) =>
          mapReopenResult(screeningSessionService.reopen(toInternalReopenRequest(data), actor))
      })
    },

    async getById(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningSessionGetByIdResult> {
      return handleScreeningSessionRequest({
        channel: ipcChannels.screeningSessions.getById,
        request,
        requestSchema: screeningSessionGetByIdRequestSchema,
        resultSchema: screeningSessionGetByIdResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapGetByIdResult(screeningSessionService.getById(toInternalGetByIdRequest(data), actor))
      })
    },

    async list(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningSessionListResult> {
      return handleScreeningSessionRequest({
        channel: ipcChannels.screeningSessions.list,
        request,
        requestSchema: screeningSessionListRequestSchema,
        resultSchema: screeningSessionListResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapListResult(screeningSessionService.list(toInternalListRequest(data), actor))
      })
    }
  })
}

interface TrustedScreeningSessionIpcActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

interface HandleScreeningSessionRequestOptions<TRequest, TResult> {
  readonly channel: ScreeningSessionIpcChannel
  readonly request: unknown
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly logger: ScreeningSessionIpcOperationalLogger
  authorize(): ReturnType<
    ReturnType<typeof createAuthenticatedHandlerAuthorization>['requireAnyRole']
  >
  invoke(request: TRequest, actor: TrustedScreeningSessionIpcActor): TResult
}

function handleScreeningSessionRequest<TRequest, TResult>({
  channel,
  request,
  requestSchema,
  resultSchema,
  logger,
  authorize,
  invoke
}: HandleScreeningSessionRequestOptions<TRequest, TResult>): TResult {
  const authorization = authorize()

  if (!authorization.ok) {
    const failure = toScreeningSessionAuthorizationFailure(authorization.failure)
    logScreeningSessionIpcFailure(logger, channel, failure.error.code)
    return freezeIpcResult(failure) as TResult
  }

  const requestResult = safeParseIpcValue(requestSchema, request)

  if (!requestResult.success) {
    logScreeningSessionIpcFailure(logger, channel, 'VALIDATION_FAILED')
    return freezeIpcResult(createScreeningSessionFailure('VALIDATION_FAILED')) as TResult
  }

  try {
    const actor: TrustedScreeningSessionIpcActor = {
      userId: authorization.context.user.id,
      role: authorization.context.user.role
    }
    const result = invoke(requestResult.data, actor)
    const resultEnvelope = safeParseIpcValue(resultSchema, result)

    if (!resultEnvelope.success) {
      logScreeningSessionIpcFailure(logger, channel, 'INTERNAL_ERROR')
      return freezeIpcResult(createScreeningSessionFailure('INTERNAL_ERROR')) as TResult
    }

    return freezeIpcResult(resultEnvelope.data)
  } catch (error) {
    logScreeningSessionIpcFailure(logger, channel, 'INTERNAL_ERROR', error)
    return freezeIpcResult(createScreeningSessionFailure('INTERNAL_ERROR')) as TResult
  }
}

function toInternalCreateRequest(
  request: ScreeningSessionCreateRequest
): InternalCreateScreeningSessionRequest {
  return Object.freeze({
    locationId: request.locationId as EntityId,
    sessionDate: request.sessionDate as InternalCreateScreeningSessionRequest['sessionDate'],
    notes: request.notes ?? null
  })
}

function toInternalCloseRequest(
  request: ScreeningSessionCloseRequest
): InternalCloseScreeningSessionRequest {
  return Object.freeze({
    id: request.id as EntityId,
    expectedRowVersion: request.expectedRowVersion,
    reason: request.reason ?? null
  })
}

function toInternalReopenRequest(
  request: ScreeningSessionReopenRequest
): InternalReopenScreeningSessionRequest {
  return Object.freeze({
    id: request.id as EntityId,
    expectedRowVersion: request.expectedRowVersion,
    reason: request.reason
  })
}

function toInternalGetByIdRequest(
  request: ScreeningSessionGetByIdRequest
): InternalGetScreeningSessionRequest {
  return Object.freeze({ id: request.id as EntityId })
}

function toInternalListRequest(
  request: ScreeningSessionListRequest
): InternalListScreeningSessionsRequest {
  return Object.freeze({
    locationId: request.locationId as InternalListScreeningSessionsRequest['locationId'],
    status: request.status,
    dateFrom: request.dateFrom as InternalListScreeningSessionsRequest['dateFrom'],
    dateTo: request.dateTo as InternalListScreeningSessionsRequest['dateTo'],
    page: request.page,
    pageSize: request.pageSize
  })
}

function mapCreateResult(
  result: ReturnType<ScreeningSessionService['create']>
): ScreeningSessionCreateResult {
  switch (result.status) {
    case 'CREATED':
      return freezeSuccess({
        status: 'CREATED',
        session: toPublicScreeningSession(result.session)
      }) as ScreeningSessionCreateResult
    case 'ALREADY_EXISTS':
    case 'SESSION_DATE_NOT_CURRENT':
    case 'LOCATION_NOT_FOUND':
    case 'LOCATION_INACTIVE':
    case 'NO_ACTIVE_PROTOCOL':
      return freezeSuccess({ status: result.status }) as ScreeningSessionCreateResult
    default:
      throw new Error('Unexpected screening-session create result.')
  }
}

function mapCloseResult(
  result: ReturnType<ScreeningSessionService['close']>
): ScreeningSessionCloseResult {
  switch (result.status) {
    case 'CLOSED':
    case 'SESSION_VERSION_CONFLICT':
    case 'ALREADY_CLOSED':
      return freezeSuccess({
        status: result.status,
        session: toPublicScreeningSession(result.session)
      }) as ScreeningSessionCloseResult
    case 'NOT_FOUND':
      return freezeSuccess({ status: 'NOT_FOUND' }) as ScreeningSessionCloseResult
    default:
      throw new Error('Unexpected screening-session close result.')
  }
}

function mapReopenResult(
  result: ReturnType<ScreeningSessionService['reopen']>
): ScreeningSessionReopenResult {
  switch (result.status) {
    case 'REOPENED':
    case 'SESSION_VERSION_CONFLICT':
    case 'ALREADY_OPEN':
      return freezeSuccess({
        status: result.status,
        session: toPublicScreeningSession(result.session)
      }) as ScreeningSessionReopenResult
    case 'NOT_FOUND':
    case 'FORBIDDEN':
      return freezeSuccess({ status: result.status }) as ScreeningSessionReopenResult
    default:
      throw new Error('Unexpected screening-session reopen result.')
  }
}

function mapGetByIdResult(
  result: ReturnType<ScreeningSessionService['getById']>
): ScreeningSessionGetByIdResult {
  switch (result.status) {
    case 'FOUND':
      return freezeSuccess({
        status: 'FOUND',
        session: toPublicScreeningSession(result.session)
      }) as ScreeningSessionGetByIdResult
    case 'NOT_FOUND':
      return freezeSuccess({ status: 'NOT_FOUND' }) as ScreeningSessionGetByIdResult
    default:
      throw new Error('Unexpected screening-session get result.')
  }
}

function mapListResult(
  result: ReturnType<ScreeningSessionService['list']>
): ScreeningSessionListResult {
  return freezeSuccess({
    status: 'LISTED',
    items: Object.freeze(result.items.map(toPublicScreeningSession)),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total
  }) as ScreeningSessionListResult
}

function toPublicScreeningSession(session: ScreeningSessionRecord): PublicScreeningSession {
  return Object.freeze({
    id: session.id,
    locationId: session.locationId,
    protocolVersionId: session.protocolVersionId,
    sessionDate: session.sessionDate,
    status: session.status,
    notes: session.notes,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    createdAt: session.createdAt,
    rowVersion: session.rowVersion
  })
}

function freezeSuccess<TData>(data: TData): { readonly ok: true; readonly data: TData } {
  const result = createIpcSuccess(data)

  return Object.freeze({
    ok: result.ok,
    data
  })
}

function freezeIpcResult<TResult>(result: TResult): TResult {
  deepFreeze(result, new WeakSet<object>())

  return result
}

function deepFreeze(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) {
    return
  }

  seen.add(value)

  for (const propertyValue of Object.values(value)) {
    deepFreeze(propertyValue, seen)
  }

  Object.freeze(value)
}

function toScreeningSessionAuthorizationFailure(failure: AuthenticationFailure): {
  ok: false
  error: { code: ScreeningSessionErrorCode; message: string }
} {
  switch (failure.error.code) {
    case 'IPC_FORBIDDEN':
      return createScreeningSessionFailure('IPC_FORBIDDEN')
    case 'AUTH_UNAUTHENTICATED':
      return createScreeningSessionFailure('AUTH_UNAUTHENTICATED')
    case 'AUTH_LOCKED':
      return createScreeningSessionFailure('AUTH_LOCKED')
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return createScreeningSessionFailure('AUTH_PASSWORD_CHANGE_REQUIRED')
    case 'AUTHORIZATION_FAILED':
      return createScreeningSessionFailure('AUTHORIZATION_FAILED')
    case 'VALIDATION_FAILED':
      return createScreeningSessionFailure('VALIDATION_FAILED')
    default:
      return createScreeningSessionFailure('INTERNAL_ERROR')
  }
}

function logScreeningSessionIpcFailure(
  logger: ScreeningSessionIpcOperationalLogger,
  channel: ScreeningSessionIpcChannel,
  code: ScreeningSessionErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=screening-session; channel=${channel}; code=${code}${errorType}`

    if (code === 'INTERNAL_ERROR') {
      logger.error(message)
      return
    }

    logger.warn(message)
  } catch {
    // Logging must not alter IPC results.
  }
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false; error?: unknown }
}

function safeParseIpcValue<TResult>(
  schema: z.ZodType<TResult> | IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false; error?: unknown } {
  try {
    return schema.safeParse(value)
  } catch (error) {
    return { success: false, error }
  }
}
