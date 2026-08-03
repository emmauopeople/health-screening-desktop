import type { z } from 'zod'

import type { PatientRegistryService } from '@main/application'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import type { AuthenticatedHandlerAuthorization } from '@main/ipc/authentication'
import {
  getPatientRegistryErrorType,
  PatientRegistryNotFoundError,
  PatientRegistryValidationError
} from '@main/application'
import {
  createIpcSuccess,
  createPatientFailure,
  ipcChannels,
  patientCreateRequestSchema,
  patientCreateResultSchema,
  patientFindDuplicatesRequestSchema,
  patientFindDuplicatesResultSchema,
  patientGetSummaryRequestSchema,
  patientGetSummaryResultSchema,
  patientSearchRequestSchema,
  patientSearchResultSchema,
  type AuthenticationErrorCode,
  type LocalUserRole,
  type PatientCreateResult,
  type PatientFindDuplicatesResult,
  type PatientGetSummaryResult,
  type PatientIpcChannel,
  type PatientSearchResult
} from '@shared/ipc'

export interface PatientIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface PatientIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authorization: AuthenticatedHandlerAuthorization
  readonly patientRegistryService: PatientRegistryService
  readonly logger?: PatientIpcOperationalLogger
}

export interface PatientIpcHandlers {
  search(event: IpcSenderValidationEvent, request: unknown): Promise<PatientSearchResult>
  getSummary(event: IpcSenderValidationEvent, request: unknown): Promise<PatientGetSummaryResult>
  findDuplicates(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<PatientFindDuplicatesResult>
  create(event: IpcSenderValidationEvent, request: unknown): Promise<PatientCreateResult>
}

const allowedPatientRoles: readonly LocalUserRole[] = Object.freeze([
  'LOCAL_ADMIN',
  'NURSE',
  'TRAINED_SCREENER'
])

export function createPatientIpcHandlers({
  authorization,
  patientRegistryService,
  logger = console
}: PatientIpcHandlerDependencies): PatientIpcHandlers {
  return Object.freeze({
    search: createValidatedPatientHandler({
      channel: ipcChannels.patient.search,
      authorization,
      requestSchema: patientSearchRequestSchema,
      resultSchema: patientSearchResultSchema,
      logger,
      execute: (actor, request) => patientRegistryService.search(actor, request)
    }),
    getSummary: createValidatedPatientHandler({
      channel: ipcChannels.patient.getSummary,
      authorization,
      requestSchema: patientGetSummaryRequestSchema,
      resultSchema: patientGetSummaryResultSchema,
      logger,
      execute: (actor, request) => patientRegistryService.getSummary(actor, request)
    }),
    findDuplicates: createValidatedPatientHandler({
      channel: ipcChannels.patient.findDuplicates,
      authorization,
      requestSchema: patientFindDuplicatesRequestSchema,
      resultSchema: patientFindDuplicatesResultSchema,
      logger,
      execute: (actor, request) => patientRegistryService.findDuplicates(actor, request)
    }),
    create: createValidatedPatientHandler({
      channel: ipcChannels.patient.create,
      authorization,
      requestSchema: patientCreateRequestSchema,
      resultSchema: patientCreateResultSchema,
      logger,
      execute: (actor, request) => patientRegistryService.create(actor, request)
    })
  })
}

function createValidatedPatientHandler<TRequest, TResult>({
  channel,
  authorization,
  requestSchema,
  resultSchema,
  execute,
  logger
}: {
  readonly channel: PatientIpcChannel
  readonly authorization: AuthenticatedHandlerAuthorization
  readonly requestSchema: z.ZodType<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly execute: (
    actor: { readonly user: Parameters<PatientRegistryService['search']>[0]['user'] },
    request: TRequest
  ) => unknown
  readonly logger: PatientIpcOperationalLogger
}) {
  return async (event: IpcSenderValidationEvent, request: unknown): Promise<TResult> => {
    const authorizationResult = authorization.requireAnyRole(event, allowedPatientRoles)

    if (!authorizationResult.ok) {
      logPatientIpcFailure(logger, channel, authorizationResult.failure.error.code)
      return authorizationResult.failure as TResult
    }

    const requestResult = safeParseIpcValue(requestSchema, request)

    if (!requestResult.success) {
      logPatientIpcFailure(logger, channel, 'VALIDATION_FAILED')
      return createPatientFailure('VALIDATION_FAILED') as TResult
    }

    try {
      const data = execute({ user: authorizationResult.context.user }, requestResult.data)
      const envelope = createIpcSuccess(data)
      const responseResult = safeParseIpcValue(resultSchema, envelope)

      if (!responseResult.success) {
        logPatientIpcFailure(logger, channel, 'INTERNAL_ERROR')
        return createPatientFailure('INTERNAL_ERROR') as TResult
      }

      return responseResult.data
    } catch (error) {
      const code = getPatientIpcFailureCode(error)
      logPatientIpcFailure(logger, channel, code, error)
      return createPatientFailure(code) as TResult
    }
  }
}

function getPatientIpcFailureCode(error: unknown): AuthenticationErrorCode {
  if (
    error instanceof PatientRegistryValidationError ||
    error instanceof PatientRegistryNotFoundError
  ) {
    return 'VALIDATION_FAILED'
  }

  return 'INTERNAL_ERROR'
}

function logPatientIpcFailure(
  logger: PatientIpcOperationalLogger,
  channel: PatientIpcChannel,
  code: AuthenticationErrorCode,
  error?: unknown
): void {
  const errorType = error === undefined ? '' : `; errorType=${getPatientRegistryErrorType(error)}`
  const message = `Patient IPC result channel=${channel}; code=${code}${errorType}`

  if (code === 'INTERNAL_ERROR') {
    logger.error(message)
    return
  }

  logger.warn(message)
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
