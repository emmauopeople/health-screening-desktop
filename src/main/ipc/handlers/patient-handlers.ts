import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import type { LocalAuthenticationSessionService, PatientRegistryService } from '@main/application'
import type { EntityId } from '@main/foundation/entity-id'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication/authenticated-handler-authorization'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createPatientFailure,
  ipcChannels,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientFindDuplicatesResultSchema,
  patientGetRequestSchema,
  patientGetResultSchema,
  patientListRecentRequestSchema,
  patientListRecentResultSchema,
  patientMarkNotDuplicateRequestSchema,
  patientMarkNotDuplicateResultSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  patientUpdateRequestSchema,
  patientUpdateResultSchema,
  type AuthenticationFailure,
  type PatientCreateResult,
  type PatientErrorCode,
  type PatientFindDuplicatesResult,
  type PatientGetResult,
  type PatientIpcChannel,
  type PatientListRecentResult,
  type PatientMarkNotDuplicateResult,
  type PatientSearchResult,
  type PatientUpdateResult
} from '@shared/ipc'

export interface PatientIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface PatientIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly patientRegistryService: PatientRegistryService
  readonly logger?: PatientIpcOperationalLogger
}

export interface PatientIpcHandlers {
  search(event: IpcSenderValidationEvent, request: unknown): Promise<PatientSearchResult>
  get(event: IpcSenderValidationEvent, request: unknown): Promise<PatientGetResult>
  create(event: IpcSenderValidationEvent, request: unknown): Promise<PatientCreateResult>
  update(event: IpcSenderValidationEvent, request: unknown): Promise<PatientUpdateResult>
  listRecent(event: IpcSenderValidationEvent, request: unknown): Promise<PatientListRecentResult>
  findDuplicates(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientFindDuplicatesResult>
  markNotDuplicate(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientMarkNotDuplicateResult>
}

const allLocalRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)

export function createPatientIpcHandlers({
  navigationPolicy,
  authenticationSessionService,
  patientRegistryService,
  logger = console
}: PatientIpcHandlerDependencies): PatientIpcHandlers {
  const authorization = createAuthenticatedHandlerAuthorization({
    navigationPolicy,
    authenticationSessionService,
    logger
  })

  return Object.freeze({
    async search(event: IpcSenderValidationEvent, request: unknown): Promise<PatientSearchResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.search,
        request,
        requestSchema: patientSearchRequestSchema,
        resultSchema: patientSearchResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.search(data, actor)
      })
    },
    async get(event: IpcSenderValidationEvent, request: unknown): Promise<PatientGetResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.get,
        request,
        requestSchema: patientGetRequestSchema,
        resultSchema: patientGetResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.get(data, actor)
      })
    },
    async create(event: IpcSenderValidationEvent, request: unknown): Promise<PatientCreateResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.create,
        request,
        requestSchema: patientCreateRequestSchema,
        resultSchema: patientCreateResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.create(data, actor)
      })
    },
    async update(event: IpcSenderValidationEvent, request: unknown): Promise<PatientUpdateResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.update,
        request,
        requestSchema: patientUpdateRequestSchema,
        resultSchema: patientUpdateResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.update(data, actor)
      })
    },
    async listRecent(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientListRecentResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.listRecent,
        request,
        requestSchema: patientListRecentRequestSchema,
        resultSchema: patientListRecentResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.listRecent(data, actor)
      })
    },
    async findDuplicates(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientFindDuplicatesResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.findDuplicates,
        request,
        requestSchema: patientFindDuplicatesRequestSchema,
        resultSchema: patientFindDuplicatesResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.findDuplicates(data, actor)
      })
    },
    async markNotDuplicate(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientMarkNotDuplicateResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.markNotDuplicate,
        request,
        requestSchema: patientMarkNotDuplicateRequestSchema,
        resultSchema: patientMarkNotDuplicateResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) => patientRegistryService.markNotDuplicate(data, actor)
      })
    }
  })
}

interface HandlePatientRequestOptions<TRequest, TResult> {
  readonly channel: PatientIpcChannel
  readonly request: unknown
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly logger: PatientIpcOperationalLogger
  authorize(): ReturnType<
    ReturnType<typeof createAuthenticatedHandlerAuthorization>['requireAnyRole']
  >
  invoke(request: TRequest, actor: { readonly userId: EntityId }): TResult
}

function handlePatientRequest<TRequest, TResult>({
  channel,
  request,
  requestSchema,
  resultSchema,
  logger,
  authorize,
  invoke
}: HandlePatientRequestOptions<TRequest, TResult>): TResult {
  const authorization = authorize()

  if (!authorization.ok) {
    const failure = toPatientAuthorizationFailure(authorization.failure)
    logPatientIpcFailure(logger, channel, failure.error.code)
    return failure as TResult
  }

  const requestResult = safeParseIpcValue(requestSchema, request)

  if (!requestResult.success) {
    logPatientIpcFailure(logger, channel, 'VALIDATION_FAILED')
    return createPatientFailure('VALIDATION_FAILED') as TResult
  }

  try {
    const result = invoke(requestResult.data, {
      userId: authorization.context.user.id
    })
    const resultEnvelope = safeParseIpcValue(resultSchema, result)

    if (!resultEnvelope.success) {
      logPatientIpcFailure(logger, channel, 'INTERNAL_ERROR')
      return createPatientFailure('INTERNAL_ERROR') as TResult
    }

    return resultEnvelope.data
  } catch (error) {
    logPatientIpcFailure(logger, channel, 'INTERNAL_ERROR', error)
    return createPatientFailure('INTERNAL_ERROR') as TResult
  }
}

function toPatientAuthorizationFailure(failure: AuthenticationFailure): {
  ok: false
  error: { code: PatientErrorCode; message: string }
} {
  switch (failure.error.code) {
    case 'IPC_FORBIDDEN':
      return createPatientFailure('IPC_FORBIDDEN')
    case 'AUTH_UNAUTHENTICATED':
      return createPatientFailure('AUTH_UNAUTHENTICATED')
    case 'AUTH_LOCKED':
      return createPatientFailure('AUTH_LOCKED')
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return createPatientFailure('AUTH_PASSWORD_CHANGE_REQUIRED')
    case 'AUTHORIZATION_FAILED':
      return createPatientFailure('AUTHORIZATION_FAILED')
    case 'VALIDATION_FAILED':
      return createPatientFailure('VALIDATION_FAILED')
    default:
      return createPatientFailure('INTERNAL_ERROR')
  }
}

function logPatientIpcFailure(
  logger: PatientIpcOperationalLogger,
  channel: PatientIpcChannel,
  code: PatientErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error instanceof Error ? `; errorType=${error.name}` : ''
    const message = `IPC handler result event=patient; channel=${channel}; code=${code}${errorType}`

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
