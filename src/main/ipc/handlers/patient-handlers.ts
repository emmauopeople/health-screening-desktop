import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import {
  toPublicAcknowledgmentHistoryRecord,
  toPublicDemographicAmendmentRecord,
  toPublicPatientDetail,
  type AmendPatientDemographicsRequest as InternalAmendPatientDemographicsRequest,
  type AmendPatientDemographicsResult as InternalAmendPatientDemographicsResult,
  type ListPatientAcknowledgmentHistoryRequest as InternalListPatientAcknowledgmentHistoryRequest,
  type ListPatientAcknowledgmentHistoryResult as InternalListPatientAcknowledgmentHistoryResult,
  type ListPatientDemographicAmendmentHistoryRequest as InternalListPatientDemographicAmendmentHistoryRequest,
  type ListPatientDemographicAmendmentHistoryResult as InternalListPatientDemographicAmendmentHistoryResult,
  type LocalAuthenticationSessionService,
  type PatientAcknowledgmentService,
  type PatientDemographicAmendmentService,
  type PatientRegistryService,
  type RecordPatientAcknowledgmentRequest as InternalRecordPatientAcknowledgmentRequest,
  type RecordPatientAcknowledgmentResult as InternalRecordPatientAcknowledgmentResult
} from '@main/application'
import type { LocalUserRole } from '@main/database'
import type { EntityId } from '@main/foundation/entity-id'
import { getErrorType } from '@main/foundation/error-type'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication/authenticated-handler-authorization'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createPatientFailure,
  ipcChannels,
  patientAmendDemographicsRequestSchema,
  patientAmendDemographicsResultSchema,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientFindDuplicatesResultSchema,
  patientGetRequestSchema,
  patientGetResultSchema,
  patientListAcknowledgmentHistoryRequestSchema,
  patientListAcknowledgmentHistoryResultSchema,
  patientListDemographicAmendmentHistoryRequestSchema,
  patientListDemographicAmendmentHistoryResultSchema,
  patientListRecentRequestSchema,
  patientListRecentResultSchema,
  patientMarkNotDuplicateRequestSchema,
  patientMarkNotDuplicateResultSchema,
  patientRecordAcknowledgmentRequestSchema,
  patientRecordAcknowledgmentResultSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  type AuthenticationFailure,
  type PatientAmendDemographicsResult,
  type PatientCreateResult,
  type PatientErrorCode,
  type PatientFindDuplicatesResult,
  type PatientGetResult,
  type PatientIpcChannel,
  type PatientListAcknowledgmentHistoryResult,
  type PatientListDemographicAmendmentHistoryResult,
  type PatientListRecentResult,
  type PatientMarkNotDuplicateResult,
  type PatientRecordAcknowledgmentResult,
  type PatientSearchResult
} from '@shared/ipc'

export interface PatientIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface PatientIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly patientRegistryService: PatientRegistryService
  readonly patientDemographicAmendmentService: PatientDemographicAmendmentService
  readonly patientAcknowledgmentService: PatientAcknowledgmentService
  readonly logger?: PatientIpcOperationalLogger
}

export interface PatientIpcHandlers {
  search(event: IpcSenderValidationEvent, request: unknown): Promise<PatientSearchResult>
  get(event: IpcSenderValidationEvent, request: unknown): Promise<PatientGetResult>
  create(event: IpcSenderValidationEvent, request: unknown): Promise<PatientCreateResult>
  amendDemographics(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientAmendDemographicsResult>
  listDemographicAmendmentHistory(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientListDemographicAmendmentHistoryResult>
  recordAcknowledgment(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientRecordAcknowledgmentResult>
  listAcknowledgmentHistory(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientListAcknowledgmentHistoryResult>
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
  patientDemographicAmendmentService,
  patientAcknowledgmentService,
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
    async amendDemographics(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientAmendDemographicsResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.amendDemographics,
        request,
        requestSchema: patientAmendDemographicsRequestSchema,
        resultSchema: patientAmendDemographicsResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapAmendDemographicsResult(
            patientDemographicAmendmentService.amend(
              data as InternalAmendPatientDemographicsRequest,
              actor
            )
          )
      })
    },
    async listDemographicAmendmentHistory(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientListDemographicAmendmentHistoryResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.listDemographicAmendmentHistory,
        request,
        requestSchema: patientListDemographicAmendmentHistoryRequestSchema,
        resultSchema: patientListDemographicAmendmentHistoryResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapDemographicAmendmentHistoryResult(
            patientDemographicAmendmentService.listHistory(
              data as InternalListPatientDemographicAmendmentHistoryRequest,
              actor
            )
          )
      })
    },
    async recordAcknowledgment(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientRecordAcknowledgmentResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.recordAcknowledgment,
        request,
        requestSchema: patientRecordAcknowledgmentRequestSchema,
        resultSchema: patientRecordAcknowledgmentResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapRecordAcknowledgmentResult(
            patientAcknowledgmentService.record(
              data as InternalRecordPatientAcknowledgmentRequest,
              actor
            )
          )
      })
    },
    async listAcknowledgmentHistory(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<PatientListAcknowledgmentHistoryResult> {
      return handlePatientRequest({
        channel: ipcChannels.patient.listAcknowledgmentHistory,
        request,
        requestSchema: patientListAcknowledgmentHistoryRequestSchema,
        resultSchema: patientListAcknowledgmentHistoryResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, allLocalRoles),
        invoke: (data, actor) =>
          mapAcknowledgmentHistoryResult(
            patientAcknowledgmentService.listHistory(
              data as InternalListPatientAcknowledgmentHistoryRequest,
              actor
            )
          )
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

interface TrustedPatientIpcActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
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
  invoke(request: TRequest, actor: TrustedPatientIpcActor): TResult
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
    const actor: TrustedPatientIpcActor = {
      userId: authorization.context.user.id,
      role: authorization.context.user.role
    }
    const result = invoke(requestResult.data, actor)
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

function mapAmendDemographicsResult(
  result: InternalAmendPatientDemographicsResult
): PatientAmendDemographicsResult {
  switch (result.status) {
    case 'AMENDED':
      return createIpcSuccess({
        status: 'AMENDED',
        amendmentId: result.amendmentId,
        patient: toPublicPatientDetail(result.patient)
      }) as PatientAmendDemographicsResult
    case 'PATIENT_VERSION_CONFLICT':
      return createIpcSuccess({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: toPublicPatientDetail(result.patient)
      }) as PatientAmendDemographicsResult
    case 'NOT_FOUND':
      return createPatientFailure('VALIDATION_FAILED') as PatientAmendDemographicsResult
    case 'FORBIDDEN':
      return createPatientFailure('AUTHORIZATION_FAILED') as PatientAmendDemographicsResult
    default:
      throw new Error('Unexpected patient demographic amendment result.')
  }
}

function mapDemographicAmendmentHistoryResult(
  result: InternalListPatientDemographicAmendmentHistoryResult
): PatientListDemographicAmendmentHistoryResult {
  return createIpcSuccess({
    items: result.items.map(toPublicDemographicAmendmentRecord),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total
  }) as PatientListDemographicAmendmentHistoryResult
}

function mapRecordAcknowledgmentResult(
  result: InternalRecordPatientAcknowledgmentResult
): PatientRecordAcknowledgmentResult {
  switch (result.status) {
    case 'RECORDED':
      return createIpcSuccess({
        status: 'RECORDED',
        acknowledgmentId: result.acknowledgmentId,
        patient: toPublicPatientDetail(result.patient)
      }) as PatientRecordAcknowledgmentResult
    case 'PATIENT_VERSION_CONFLICT':
      return createIpcSuccess({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: toPublicPatientDetail(result.patient)
      }) as PatientRecordAcknowledgmentResult
    case 'DUPLICATE_DECISION':
      return createIpcSuccess({
        status: 'DUPLICATE_DECISION',
        patient: toPublicPatientDetail(result.patient),
        acknowledgment: toPublicAcknowledgmentHistoryRecord(result.acknowledgment)
      }) as PatientRecordAcknowledgmentResult
    case 'NOT_FOUND':
      return createPatientFailure('VALIDATION_FAILED') as PatientRecordAcknowledgmentResult
    default:
      throw new Error('Unexpected patient acknowledgment result.')
  }
}

function mapAcknowledgmentHistoryResult(
  result: InternalListPatientAcknowledgmentHistoryResult
): PatientListAcknowledgmentHistoryResult {
  return createIpcSuccess({
    items: result.items.map(toPublicAcknowledgmentHistoryRecord),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total
  }) as PatientListAcknowledgmentHistoryResult
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
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
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
