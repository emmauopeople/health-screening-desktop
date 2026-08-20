import type {
  OtcDraftRowSummary,
  OtcDraftSummary,
  OtcRecentMedicationSuggestionSummary,
  OtcWorkspaceSummary,
  ScreeningOtcService
} from '@main/application'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { getErrorType } from '@main/foundation/error-type'
import type { EntityId } from '@main/foundation/entity-id'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningOtcIpcFailure,
  ipcChannels,
  screeningOtcGetWorkspaceRequestSchema,
  screeningOtcGetWorkspaceResultSchema,
  screeningOtcSaveDraftRequestSchema,
  screeningOtcSaveDraftResultSchema,
  type ScreeningOtcGetWorkspaceRequest,
  type ScreeningOtcGetWorkspaceResult,
  type ScreeningOtcIpcErrorCode,
  type ScreeningOtcSaveDraftRequest,
  type ScreeningOtcSaveDraftResult,
  type ScreeningOtcWorkspace
} from '@shared/ipc'

type PublicOtcDraft = NonNullable<ScreeningOtcWorkspace['draft']>

export interface ScreeningOtcIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface ScreeningOtcIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly screeningOtcService: ScreeningOtcService
  readonly logger?: ScreeningOtcIpcOperationalLogger
}

export interface ScreeningOtcIpcHandlers {
  getWorkspace(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningOtcGetWorkspaceResult>
  saveDraft(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningOtcSaveDraftResult>
}

export function createScreeningOtcIpcHandlers({
  navigationPolicy,
  screeningOtcService,
  logger = console
}: ScreeningOtcIpcHandlerDependencies): ScreeningOtcIpcHandlers {
  return Object.freeze({
    getWorkspace: createHandler<ScreeningOtcGetWorkspaceRequest, ScreeningOtcGetWorkspaceResult>({
      channel: ipcChannels.screeningEncounters.otc.getWorkspace,
      requestSchema: screeningOtcGetWorkspaceRequestSchema,
      resultSchema: screeningOtcGetWorkspaceResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapWorkspaceResult(
          screeningOtcService.getWorkspace({ encounterId: request.encounterId as EntityId })
        ),
      navigationPolicy,
      logger
    }),
    saveDraft: createHandler<ScreeningOtcSaveDraftRequest, ScreeningOtcSaveDraftResult>({
      channel: ipcChannels.screeningEncounters.otc.saveDraft,
      requestSchema: screeningOtcSaveDraftRequestSchema,
      resultSchema: screeningOtcSaveDraftResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapSavedResult(
          screeningOtcService.saveDraft(
            request as unknown as Parameters<ScreeningOtcService['saveDraft']>[0]
          )
        ),
      navigationPolicy,
      logger
    })
  })
}

function createHandler<TRequest, TResult>({
  channel,
  requestSchema,
  resultSchema,
  invalidResult,
  serviceCall,
  navigationPolicy,
  logger
}: {
  readonly channel: string
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly invalidResult: () => TResult
  readonly serviceCall: (request: TRequest) => TResult
  readonly navigationPolicy: NavigationPolicy
  readonly logger: ScreeningOtcIpcOperationalLogger
}): (event: IpcSenderValidationEvent, request: unknown) => Promise<TResult> {
  return async (event, request) => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      const failure = createScreeningOtcIpcFailure('IPC_FORBIDDEN')
      logFailure(logger, channel, 'IPC_FORBIDDEN')
      return freezeResult(failure) as TResult
    }

    const requestResult = safeParse(requestSchema, request)
    if (!requestResult.success) return freezeResult(invalidResult())

    try {
      const mapped = serviceCall(requestResult.data)
      const result = safeParse(resultSchema, mapped)
      if (!result.success) {
        logFailure(logger, channel, 'INTERNAL_ERROR')
        return freezeResult(createIpcSuccess({ status: 'UNAVAILABLE' as const })) as TResult
      }
      return freezeResult(result.data)
    } catch (error) {
      logFailure(logger, channel, 'INTERNAL_ERROR', error)
      return freezeResult(createIpcSuccess({ status: 'UNAVAILABLE' as const })) as TResult
    }
  }
}

function mapWorkspaceResult(
  result: ReturnType<ScreeningOtcService['getWorkspace']>
): ScreeningOtcGetWorkspaceResult {
  if (result.status === 'LOADED') {
    return createIpcSuccess({
      status: 'LOADED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningOtcGetWorkspaceResult
  }
  return createIpcSuccess({ status: result.status }) as ScreeningOtcGetWorkspaceResult
}

function mapSavedResult(
  result: ReturnType<ScreeningOtcService['saveDraft']>
): ScreeningOtcSaveDraftResult {
  if (result.status === 'SAVED') {
    return createIpcSuccess({
      status: 'SAVED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningOtcSaveDraftResult
  }
  return createIpcSuccess({ status: result.status }) as ScreeningOtcSaveDraftResult
}

function toPublicWorkspace(workspace: OtcWorkspaceSummary): ScreeningOtcWorkspace {
  return {
    encounterId: workspace.encounterId,
    draft: workspace.draft === null ? null : toPublicDraft(workspace.draft),
    recentMedications: workspace.recentMedications.map(toPublicRecentMedication)
  }
}

function toPublicDraft(draft: OtcDraftSummary): PublicOtcDraft {
  return {
    id: draft.id,
    encounterId: draft.encounterId,
    otcResponse: draft.otcResponse,
    rowVersion: draft.rowVersion,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    rows: draft.rows.map(toPublicRow),
    updatedAt: draft.updatedAt
  }
}

function toPublicRow(row: OtcDraftRowSummary): PublicOtcDraft['rows'][number] {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    productNameSnapshot: row.productNameSnapshot,
    productNameNormalized: row.productNameNormalized,
    reasonForUse: row.reasonForUse,
    doseText: row.doseText,
    frequencyText: row.frequencyText,
    durationText: row.durationText,
    sourceOfMedication: row.sourceOfMedication,
    currentlyTakingResponse: row.currentlyTakingResponse,
    updatedAt: row.updatedAt
  }
}

function toPublicRecentMedication(
  item: OtcRecentMedicationSuggestionSummary
): ScreeningOtcWorkspace['recentMedications'][number] {
  return { productNameSnapshot: item.productNameSnapshot }
}

function freezeResult<TResult>(result: TResult): TResult {
  deepFreeze(result, new WeakSet<object>())
  return result
}

function deepFreeze(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== 'object' || value === null || seen.has(value)) return
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  Object.freeze(value)
}

function logFailure(
  logger: ScreeningOtcIpcOperationalLogger,
  channel: string,
  code: ScreeningOtcIpcErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=screening-otc; channel=${channel}; code=${code}${errorType}`
    code === 'INTERNAL_ERROR' ? logger.error(message) : logger.warn(message)
  } catch {
    // IPC results must not depend on logging.
  }
}

interface IpcSchema<TValue> {
  safeParse(value: unknown): { success: true; data: TValue } | { success: false }
}

function safeParse<TValue>(
  schema: IpcSchema<TValue>,
  value: unknown
): { success: true; data: TValue } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
