import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import type {
  ScreeningEncounterStartService,
  ScreeningEncounterStartSummary,
  StartScreeningEncounterResult as InternalStartScreeningEncounterResult
} from '@main/application'
import { getErrorType } from '@main/foundation/error-type'
import type { EntityId } from '@main/foundation/entity-id'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningEncounterIpcFailure,
  createScreeningEncounterStartStatusResult,
  ipcChannels,
  screeningEncounterStartRequestSchema,
  screeningEncounterStartResultSchema,
  type PublicScreeningEncounterStartSummary,
  type ScreeningEncounterIpcChannel,
  type ScreeningEncounterIpcErrorCode,
  type ScreeningEncounterStartRequest,
  type ScreeningEncounterStartResult
} from '@shared/ipc'

export interface ScreeningEncounterIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface ScreeningEncounterIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly screeningEncounterStartService: ScreeningEncounterStartService
  readonly logger?: ScreeningEncounterIpcOperationalLogger
}

export interface ScreeningEncounterIpcHandlers {
  start(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningEncounterStartResult>
}

export function createScreeningEncounterIpcHandlers({
  navigationPolicy,
  screeningEncounterStartService,
  logger = console
}: ScreeningEncounterIpcHandlerDependencies): ScreeningEncounterIpcHandlers {
  return Object.freeze({
    async start(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningEncounterStartResult> {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        const failure = createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.start,
          'IPC_FORBIDDEN'
        )
        return freezeIpcResult(failure) as ScreeningEncounterStartResult
      }

      const requestResult = safeParseIpcValue(screeningEncounterStartRequestSchema, request)

      if (!requestResult.success) {
        return freezeIpcResult(createScreeningEncounterStartStatusResult('VALIDATION_FAILED'))
      }

      try {
        const result = mapStartResult(
          screeningEncounterStartService.start(toInternalStartRequest(requestResult.data))
        )
        const resultEnvelope = safeParseIpcValue(screeningEncounterStartResultSchema, result)

        if (!resultEnvelope.success) {
          logScreeningEncounterIpcFailure(
            logger,
            ipcChannels.screeningEncounters.start,
            'INTERNAL_ERROR'
          )
          return freezeIpcResult(createScreeningEncounterStartStatusResult('UNAVAILABLE'))
        }

        return freezeIpcResult(resultEnvelope.data)
      } catch (error) {
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.start,
          'INTERNAL_ERROR',
          error
        )
        return freezeIpcResult(createScreeningEncounterStartStatusResult('UNAVAILABLE'))
      }
    }
  })
}

function toInternalStartRequest(
  request: ScreeningEncounterStartRequest
): Parameters<ScreeningEncounterStartService['start']>[0] {
  return Object.freeze({
    patientId: request.patientId as EntityId,
    screeningSessionId: request.screeningSessionId as EntityId
  })
}

function mapStartResult(
  result: InternalStartScreeningEncounterResult
): ScreeningEncounterStartResult {
  switch (result.status) {
    case 'STARTED':
    case 'ALREADY_EXISTS':
      return createIpcSuccess({
        status: result.status,
        encounter: toPublicStartSummary(result.encounter)
      }) as ScreeningEncounterStartResult
    case 'PATIENT_NOT_FOUND':
    case 'PATIENT_INELIGIBLE':
    case 'SESSION_NOT_FOUND':
    case 'SESSION_CLOSED':
    case 'SESSION_NOT_CURRENT':
    case 'LOCATION_NOT_FOUND':
    case 'LOCATION_INACTIVE':
    case 'FORBIDDEN':
    case 'VALIDATION_FAILED':
    case 'AUTHENTICATION_REQUIRED':
    case 'UNAVAILABLE':
      return createScreeningEncounterStartStatusResult(
        result.status
      ) as ScreeningEncounterStartResult
    default:
      throw new Error('Unexpected screening-encounter start result.')
  }
}

function toPublicStartSummary(
  encounter: ScreeningEncounterStartSummary
): PublicScreeningEncounterStartSummary {
  return Object.freeze({
    id: encounter.id,
    patientId: encounter.patientId,
    screeningSessionId: encounter.screeningSessionId,
    status: encounter.status,
    startedAt: encounter.startedAt,
    recordVersion: encounter.recordVersion
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

function logScreeningEncounterIpcFailure(
  logger: ScreeningEncounterIpcOperationalLogger,
  channel: ScreeningEncounterIpcChannel,
  code: ScreeningEncounterIpcErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=screening-encounter; channel=${channel}; code=${code}${errorType}`

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
