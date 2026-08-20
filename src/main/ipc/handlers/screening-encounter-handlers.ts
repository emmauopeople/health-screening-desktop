import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import type {
  ScreeningEncounterStartService,
  ScreeningEncounterStartSummary,
  ScreeningCompletionService,
  CompleteScreeningResult as InternalCompleteScreeningResult,
  ScreeningVitalsDraftService,
  StartScreeningEncounterResult as InternalStartScreeningEncounterResult,
  VitalsDraftSummary
} from '@main/application'
import { getErrorType } from '@main/foundation/error-type'
import type { EntityId } from '@main/foundation/entity-id'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningEncounterIpcFailure,
  createScreeningEncounterStartStatusResult,
  createScreeningVitalsGetDraftLoadedResult,
  ipcChannels,
  publicScreeningVitalsDraftSchema,
  screeningEncounterCompleteRequestSchema,
  screeningEncounterCompleteResultSchema,
  screeningEncounterStartRequestSchema,
  screeningEncounterStartResultSchema,
  screeningVitalsCompleteStepResultSchema,
  screeningVitalsGetDraftRequestSchema,
  screeningVitalsGetDraftResultSchema,
  screeningVitalsSaveDraftRequestSchema,
  screeningVitalsSaveDraftResultSchema,
  type PublicScreeningEncounterStartSummary,
  type PublicCompletedScreeningEncounterSummary,
  type PublicScreeningVitalsDraft,
  type ScreeningEncounterIpcChannel,
  type ScreeningEncounterIpcErrorCode,
  type ScreeningEncounterStartRequest,
  type ScreeningEncounterStartResult,
  type ScreeningEncounterCompleteRequest,
  type ScreeningEncounterCompleteResult,
  type ScreeningVitalsCompleteStepResult,
  type ScreeningVitalsGetDraftRequest,
  type ScreeningVitalsGetDraftResult,
  type ScreeningVitalsSaveDraftRequest,
  type ScreeningVitalsSaveDraftResult
} from '@shared/ipc'

export interface ScreeningEncounterIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface ScreeningEncounterIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly screeningEncounterStartService: ScreeningEncounterStartService
  readonly screeningCompletionService: ScreeningCompletionService
  readonly screeningVitalsDraftService: ScreeningVitalsDraftService
  readonly logger?: ScreeningEncounterIpcOperationalLogger
}

export interface ScreeningEncounterIpcHandlers {
  start(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningEncounterStartResult>
  complete(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningEncounterCompleteResult>
  getVitalsDraft(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningVitalsGetDraftResult>
  saveVitalsDraft(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningVitalsSaveDraftResult>
  completeVitalsStep(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningVitalsCompleteStepResult>
}

export function createScreeningEncounterIpcHandlers({
  navigationPolicy,
  screeningEncounterStartService,
  screeningCompletionService,
  screeningVitalsDraftService,
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
    },

    async complete(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningEncounterCompleteResult> {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        const failure = createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.complete,
          'IPC_FORBIDDEN'
        )
        return freezeIpcResult(failure) as ScreeningEncounterCompleteResult
      }

      const requestResult = safeParseIpcValue(screeningEncounterCompleteRequestSchema, request)
      if (!requestResult.success) {
        return freezeIpcResult(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      }

      try {
        const result = mapCompleteScreeningResult(
          screeningCompletionService.complete(toInternalCompleteRequest(requestResult.data))
        )
        const resultEnvelope = safeParseIpcValue(screeningEncounterCompleteResultSchema, result)
        if (!resultEnvelope.success) {
          logScreeningEncounterIpcFailure(
            logger,
            ipcChannels.screeningEncounters.complete,
            'INTERNAL_ERROR'
          )
          return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
        }
        return freezeIpcResult(resultEnvelope.data)
      } catch (error) {
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.complete,
          'INTERNAL_ERROR',
          error
        )
        return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
      }
    },

    async getVitalsDraft(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningVitalsGetDraftResult> {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        const failure = createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.getVitalsDraft,
          'IPC_FORBIDDEN'
        )
        return freezeIpcResult(failure) as ScreeningVitalsGetDraftResult
      }

      const requestResult = safeParseIpcValue(screeningVitalsGetDraftRequestSchema, request)

      if (!requestResult.success) {
        return freezeIpcResult(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      }

      try {
        const result = mapGetVitalsDraftResult(
          screeningVitalsDraftService.getVitalsDraft(toInternalGetVitalsRequest(requestResult.data))
        )
        const resultEnvelope = safeParseIpcValue(screeningVitalsGetDraftResultSchema, result)

        if (!resultEnvelope.success) {
          logScreeningEncounterIpcFailure(
            logger,
            ipcChannels.screeningEncounters.getVitalsDraft,
            'INTERNAL_ERROR'
          )
          return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
        }

        return freezeIpcResult(resultEnvelope.data)
      } catch (error) {
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.getVitalsDraft,
          'INTERNAL_ERROR',
          error
        )
        return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
      }
    },

    async saveVitalsDraft(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningVitalsSaveDraftResult> {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        const failure = createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.saveVitalsDraft,
          'IPC_FORBIDDEN'
        )
        return freezeIpcResult(failure) as ScreeningVitalsSaveDraftResult
      }

      const requestResult = safeParseIpcValue(screeningVitalsSaveDraftRequestSchema, request)

      if (!requestResult.success) {
        return freezeIpcResult(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      }

      try {
        const result = mapSaveVitalsDraftResult(
          screeningVitalsDraftService.saveVitalsDraft(
            toInternalSaveVitalsRequest(requestResult.data)
          )
        )
        const resultEnvelope = safeParseIpcValue(screeningVitalsSaveDraftResultSchema, result)

        if (!resultEnvelope.success) {
          logScreeningEncounterIpcFailure(
            logger,
            ipcChannels.screeningEncounters.saveVitalsDraft,
            'INTERNAL_ERROR'
          )
          return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
        }

        return freezeIpcResult(resultEnvelope.data)
      } catch (error) {
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.saveVitalsDraft,
          'INTERNAL_ERROR',
          error
        )
        return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
      }
    },

    async completeVitalsStep(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ScreeningVitalsCompleteStepResult> {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        const failure = createScreeningEncounterIpcFailure('IPC_FORBIDDEN')
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.completeVitalsStep,
          'IPC_FORBIDDEN'
        )
        return freezeIpcResult(failure) as ScreeningVitalsCompleteStepResult
      }

      const requestResult = safeParseIpcValue(screeningVitalsSaveDraftRequestSchema, request)

      if (!requestResult.success) {
        return freezeIpcResult(createIpcSuccess({ status: 'VALIDATION_FAILED' as const }))
      }

      try {
        const result = mapCompleteVitalsStepResult(
          screeningVitalsDraftService.completeVitalsStep(
            toInternalSaveVitalsRequest(requestResult.data)
          )
        )
        const resultEnvelope = safeParseIpcValue(screeningVitalsCompleteStepResultSchema, result)

        if (!resultEnvelope.success) {
          logScreeningEncounterIpcFailure(
            logger,
            ipcChannels.screeningEncounters.completeVitalsStep,
            'INTERNAL_ERROR'
          )
          return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
        }

        return freezeIpcResult(resultEnvelope.data)
      } catch (error) {
        logScreeningEncounterIpcFailure(
          logger,
          ipcChannels.screeningEncounters.completeVitalsStep,
          'INTERNAL_ERROR',
          error
        )
        return freezeIpcResult(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
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

function toInternalCompleteRequest(
  request: ScreeningEncounterCompleteRequest
): Parameters<ScreeningCompletionService['complete']>[0] {
  return Object.freeze({
    encounterId: request.encounterId as EntityId,
    expectedEncounterVersion: request.expectedEncounterVersion,
    expectedVitalsVersion: request.expectedVitalsVersion,
    expectedLifestyleVersion: request.expectedLifestyleVersion,
    expectedFoodVersion: request.expectedFoodVersion,
    expectedOtcVersion: request.expectedOtcVersion,
    reviewConfirmed: true,
    alcoholBaselineReviewConfirmedVersionId:
      request.alcoholBaselineReviewConfirmedVersionId as EntityId | null,
    tobaccoBaselineReviewConfirmedVersionId:
      request.tobaccoBaselineReviewConfirmedVersionId as EntityId | null
  })
}

function toInternalGetVitalsRequest(
  request: ScreeningVitalsGetDraftRequest
): Parameters<ScreeningVitalsDraftService['getVitalsDraft']>[0] {
  return Object.freeze({
    encounterId: request.encounterId as EntityId
  })
}

function toInternalSaveVitalsRequest(
  request: ScreeningVitalsSaveDraftRequest
): Parameters<ScreeningVitalsDraftService['saveVitalsDraft']>[0] {
  return Object.freeze({
    encounterId: request.encounterId as EntityId,
    expectedVersion: request.expectedVersion,
    readings: Object.freeze(
      request.readings.map((reading) =>
        Object.freeze({
          id: reading.id === null ? null : (reading.id as EntityId),
          sequenceNumber: reading.sequenceNumber,
          systolic: reading.systolic,
          diastolic: reading.diastolic,
          pulse: reading.pulse,
          measurementSite: reading.measurementSite,
          patientPosition: reading.patientPosition,
          measurementTime: reading.measurementTime
        })
      )
    ),
    weightKg: request.weightKg,
    waistCm: request.waistCm,
    notes: request.notes
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

function mapCompleteScreeningResult(
  result: InternalCompleteScreeningResult
): ScreeningEncounterCompleteResult {
  if (result.status === 'COMPLETED' || result.status === 'ALREADY_COMPLETED') {
    return createIpcSuccess({
      status: result.status,
      encounter: toPublicCompletedSummary(result.encounter)
    }) as ScreeningEncounterCompleteResult
  }
  if (result.status === 'INCOMPLETE') {
    return createIpcSuccess({ status: 'INCOMPLETE', section: result.section })
  }
  return createIpcSuccess({ status: result.status }) as ScreeningEncounterCompleteResult
}

function toPublicCompletedSummary(
  encounter: Extract<InternalCompleteScreeningResult, { status: 'COMPLETED' }>['encounter']
): PublicCompletedScreeningEncounterSummary {
  return Object.freeze({
    id: encounter.id,
    patientId: encounter.patientId,
    screeningSessionId: encounter.screeningSessionId,
    status: 'COMPLETED',
    startedAt: encounter.startedAt,
    completedAt: encounter.completedAt,
    recordVersion: encounter.recordVersion
  })
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

function mapGetVitalsDraftResult(
  result: ReturnType<ScreeningVitalsDraftService['getVitalsDraft']>
): ScreeningVitalsGetDraftResult {
  if (result.status === 'LOADED') {
    return createScreeningVitalsGetDraftLoadedResult(
      result.draft === null ? null : toPublicVitalsDraft(result.draft)
    ) as ScreeningVitalsGetDraftResult
  }

  return createIpcSuccess({ status: result.status }) as ScreeningVitalsGetDraftResult
}

function mapSaveVitalsDraftResult(
  result: ReturnType<ScreeningVitalsDraftService['saveVitalsDraft']>
): ScreeningVitalsSaveDraftResult {
  if (result.status === 'SAVED') {
    return createIpcSuccess({
      status: 'SAVED',
      draft: toPublicVitalsDraft(result.draft)
    }) as ScreeningVitalsSaveDraftResult
  }

  return createIpcSuccess({ status: result.status }) as ScreeningVitalsSaveDraftResult
}

function mapCompleteVitalsStepResult(
  result: ReturnType<ScreeningVitalsDraftService['completeVitalsStep']>
): ScreeningVitalsCompleteStepResult {
  if (result.status === 'COMPLETED') {
    return createIpcSuccess({
      status: 'COMPLETED',
      draft: toPublicVitalsDraft(result.draft)
    }) as ScreeningVitalsCompleteStepResult
  }

  return createIpcSuccess({ status: result.status }) as ScreeningVitalsCompleteStepResult
}

function toPublicVitalsDraft(draft: VitalsDraftSummary): PublicScreeningVitalsDraft {
  const publicDraft = {
    id: draft.id,
    encounterId: draft.encounterId,
    status: draft.status,
    readings: draft.readings.map((reading) => ({
      id: reading.id,
      sequenceNumber: reading.sequenceNumber,
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      pulse: reading.pulse,
      measurementSite: reading.measurementSite,
      patientPosition: reading.patientPosition,
      measurementTime: reading.measurementTime
    })),
    weightKg: draft.weightKg,
    waistCm: draft.waistCm,
    notes: draft.notes,
    rowVersion: draft.rowVersion,
    updatedAt: draft.updatedAt
  }
  const parsed = safeParseIpcValue(publicScreeningVitalsDraftSchema, publicDraft)

  if (!parsed.success) {
    throw new Error('Invalid public Vitals draft.')
  }

  return parsed.data
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
