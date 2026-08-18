import type {
  ScreeningLifestyleService,
  LifestyleWorkspaceSummary,
  LifestyleAlcoholBaselineSummary,
  LifestyleTobaccoBaselineSummary,
  LifestyleWorkBaselineSummary,
  LifestyleDraftSummary
} from '@main/application'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { getErrorType } from '@main/foundation/error-type'
import type { EntityId } from '@main/foundation/entity-id'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningLifestyleIpcFailure,
  ipcChannels,
  screeningLifestyleAlcoholBaselineRequestSchema,
  screeningLifestyleCompleteRequestSchema,
  screeningLifestyleCompleteResultSchema,
  screeningLifestyleGetWorkspaceRequestSchema,
  screeningLifestyleGetWorkspaceResultSchema,
  screeningLifestyleReopenRequestSchema,
  screeningLifestyleReopenResultSchema,
  screeningLifestyleSaveAlcoholBaselineResultSchema,
  screeningLifestyleSaveDraftRequestSchema,
  screeningLifestyleSaveDraftResultSchema,
  screeningLifestyleSaveTobaccoBaselineRequestSchema,
  screeningLifestyleSaveTobaccoBaselineResultSchema,
  screeningLifestyleSaveWorkBaselineRequestSchema,
  screeningLifestyleSaveWorkBaselineResultSchema,
  type ScreeningLifestyleCompleteResult,
  type ScreeningLifestyleCompleteRequest,
  type ScreeningLifestyleGetWorkspaceRequest,
  type ScreeningLifestyleGetWorkspaceResult,
  type ScreeningLifestyleIpcErrorCode,
  type ScreeningLifestyleReopenRequest,
  type ScreeningLifestyleReopenResult,
  type ScreeningLifestyleSaveAlcoholBaselineResult,
  type ScreeningLifestyleSaveAlcoholBaselineRequest,
  type ScreeningLifestyleSaveDraftRequest,
  type ScreeningLifestyleSaveDraftResult,
  type ScreeningLifestyleSaveTobaccoBaselineRequest,
  type ScreeningLifestyleSaveTobaccoBaselineResult,
  type ScreeningLifestyleSaveWorkBaselineRequest,
  type ScreeningLifestyleSaveWorkBaselineResult
} from '@shared/ipc'

export interface ScreeningLifestyleIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface ScreeningLifestyleIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly screeningLifestyleService: ScreeningLifestyleService
  readonly logger?: ScreeningLifestyleIpcOperationalLogger
}

export interface ScreeningLifestyleIpcHandlers {
  getWorkspace(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningLifestyleGetWorkspaceResult>
  saveAlcoholBaseline(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningLifestyleSaveAlcoholBaselineResult>
  saveTobaccoBaseline(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningLifestyleSaveTobaccoBaselineResult>
  saveWorkBaseline(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningLifestyleSaveWorkBaselineResult>
  saveDraft(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningLifestyleSaveDraftResult>
  complete(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningLifestyleCompleteResult>
  reopen(event: IpcSenderValidationEvent, request: unknown): Promise<ScreeningLifestyleReopenResult>
}

export function createScreeningLifestyleIpcHandlers({
  navigationPolicy,
  screeningLifestyleService,
  logger = console
}: ScreeningLifestyleIpcHandlerDependencies): ScreeningLifestyleIpcHandlers {
  return Object.freeze({
    getWorkspace: createHandler<
      ScreeningLifestyleGetWorkspaceRequest,
      ScreeningLifestyleGetWorkspaceResult
    >({
      channel: ipcChannels.screeningEncounters.lifestyle.getWorkspace,
      requestSchema: screeningLifestyleGetWorkspaceRequestSchema,
      resultSchema: screeningLifestyleGetWorkspaceResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapWorkspaceResult(
          screeningLifestyleService.getLifestyleWorkspace({
            encounterId: request.encounterId as EntityId
          })
        ),
      navigationPolicy,
      logger
    }),
    saveAlcoholBaseline: createHandler<
      ScreeningLifestyleSaveAlcoholBaselineRequest,
      ScreeningLifestyleSaveAlcoholBaselineResult
    >({
      channel: ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline,
      requestSchema: screeningLifestyleAlcoholBaselineRequestSchema,
      resultSchema: screeningLifestyleSaveAlcoholBaselineResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapSavedResult(
          screeningLifestyleService.saveAlcoholBaseline(
            request as unknown as Parameters<ScreeningLifestyleService['saveAlcoholBaseline']>[0]
          )
        ),
      navigationPolicy,
      logger
    }),
    saveTobaccoBaseline: createHandler<
      ScreeningLifestyleSaveTobaccoBaselineRequest,
      ScreeningLifestyleSaveTobaccoBaselineResult
    >({
      channel: ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline,
      requestSchema: screeningLifestyleSaveTobaccoBaselineRequestSchema,
      resultSchema: screeningLifestyleSaveTobaccoBaselineResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapSavedResult(
          screeningLifestyleService.saveTobaccoBaseline(
            request as unknown as Parameters<ScreeningLifestyleService['saveTobaccoBaseline']>[0]
          )
        ),
      navigationPolicy,
      logger
    }),
    saveWorkBaseline: createHandler<
      ScreeningLifestyleSaveWorkBaselineRequest,
      ScreeningLifestyleSaveWorkBaselineResult
    >({
      channel: ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline,
      requestSchema: screeningLifestyleSaveWorkBaselineRequestSchema,
      resultSchema: screeningLifestyleSaveWorkBaselineResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapSavedResult(
          screeningLifestyleService.saveWorkBaseline(
            request as Parameters<ScreeningLifestyleService['saveWorkBaseline']>[0]
          )
        ),
      navigationPolicy,
      logger
    }),
    saveDraft: createHandler<ScreeningLifestyleSaveDraftRequest, ScreeningLifestyleSaveDraftResult>(
      {
        channel: ipcChannels.screeningEncounters.lifestyle.saveDraft,
        requestSchema: screeningLifestyleSaveDraftRequestSchema,
        resultSchema: screeningLifestyleSaveDraftResultSchema,
        invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
        serviceCall: (request) =>
          mapSavedResult(
            screeningLifestyleService.saveLifestyleDraft(
              request as unknown as Parameters<ScreeningLifestyleService['saveLifestyleDraft']>[0]
            )
          ),
        navigationPolicy,
        logger
      }
    ),
    complete: createHandler<ScreeningLifestyleCompleteRequest, ScreeningLifestyleCompleteResult>({
      channel: ipcChannels.screeningEncounters.lifestyle.complete,
      requestSchema: screeningLifestyleCompleteRequestSchema,
      resultSchema: screeningLifestyleCompleteResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapCompletedResult(
          screeningLifestyleService.completeLifestyle(
            request as unknown as Parameters<ScreeningLifestyleService['completeLifestyle']>[0]
          )
        ),
      navigationPolicy,
      logger
    }),
    reopen: createHandler<ScreeningLifestyleReopenRequest, ScreeningLifestyleReopenResult>({
      channel: ipcChannels.screeningEncounters.lifestyle.reopen,
      requestSchema: screeningLifestyleReopenRequestSchema,
      resultSchema: screeningLifestyleReopenResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapReopenedResult(
          screeningLifestyleService.reopenLifestyle(
            request as unknown as Parameters<ScreeningLifestyleService['reopenLifestyle']>[0]
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
  readonly logger: ScreeningLifestyleIpcOperationalLogger
}): (event: IpcSenderValidationEvent, request: unknown) => Promise<TResult> {
  return async (event, request) => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      const failure = createScreeningLifestyleIpcFailure('IPC_FORBIDDEN')
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
  result: ReturnType<ScreeningLifestyleService['getLifestyleWorkspace']>
): ScreeningLifestyleGetWorkspaceResult {
  if (result.status === 'LOADED')
    return createIpcSuccess({
      status: 'LOADED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningLifestyleGetWorkspaceResult
  return createIpcSuccess({ status: result.status }) as ScreeningLifestyleGetWorkspaceResult
}

function mapSavedResult(
  result: ReturnType<ScreeningLifestyleService['saveLifestyleDraft']>
): ScreeningLifestyleSaveDraftResult {
  if (result.status === 'SAVED')
    return createIpcSuccess({
      status: 'SAVED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningLifestyleSaveDraftResult
  return createIpcSuccess({ status: result.status }) as ScreeningLifestyleSaveDraftResult
}

function mapCompletedResult(
  result: ReturnType<ScreeningLifestyleService['completeLifestyle']>
): ScreeningLifestyleCompleteResult {
  if (result.status === 'COMPLETED')
    return createIpcSuccess({
      status: 'COMPLETED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningLifestyleCompleteResult
  return createIpcSuccess({ status: result.status }) as ScreeningLifestyleCompleteResult
}

function mapReopenedResult(
  result: ReturnType<ScreeningLifestyleService['reopenLifestyle']>
): ScreeningLifestyleReopenResult {
  if (result.status === 'REOPENED')
    return createIpcSuccess({
      status: 'REOPENED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningLifestyleReopenResult
  return createIpcSuccess({ status: result.status }) as ScreeningLifestyleReopenResult
}

function toPublicWorkspace(workspace: LifestyleWorkspaceSummary): LifestyleWorkspaceSummary {
  return {
    encounterId: workspace.encounterId,
    draft: workspace.draft === null ? null : toPublicDraft(workspace.draft),
    activeAlcoholBaseline: toPublicAlcoholBaseline(workspace.activeAlcoholBaseline),
    activeTobaccoBaseline: toPublicTobaccoBaseline(workspace.activeTobaccoBaseline),
    activeWorkBaseline: toPublicWorkBaseline(workspace.activeWorkBaseline),
    referencedAlcoholBaseline: toPublicAlcoholBaseline(workspace.referencedAlcoholBaseline),
    referencedTobaccoBaseline: toPublicTobaccoBaseline(workspace.referencedTobaccoBaseline),
    referencedWorkBaseline: toPublicWorkBaseline(workspace.referencedWorkBaseline)
  }
}

function toPublicDraft(draft: LifestyleDraftSummary): LifestyleDraftSummary {
  return {
    id: draft.id,
    encounterId: draft.encounterId,
    status: draft.status,
    rowVersion: draft.rowVersion,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    alcoholBaselineVersionId: draft.alcoholBaselineVersionId,
    tobaccoBaselineVersionId: draft.tobaccoBaselineVersionId,
    workBaselineVersionId: draft.workBaselineVersionId,
    otherActivityResponse: draft.otherActivityResponse,
    alcohol:
      draft.alcohol === null
        ? null
        : { ...draft.alcohol, commonBeverageTypes: [...draft.alcohol.commonBeverageTypes] },
    tobacco:
      draft.tobacco === null
        ? null
        : { ...draft.tobacco, products: draft.tobacco.products.map((product) => ({ ...product })) },
    physicalActivity:
      draft.physicalActivity === null
        ? null
        : {
            ...draft.physicalActivity,
            activities: draft.physicalActivity.activities.map((activity) => ({ ...activity }))
          },
    work: draft.work === null ? null : { ...draft.work },
    otherActivities: draft.otherActivities.map((activity) => ({ ...activity })),
    updatedAt: draft.updatedAt
  }
}

function toPublicAlcoholBaseline(
  baseline: LifestyleAlcoholBaselineSummary | null
): LifestyleAlcoholBaselineSummary | null {
  return baseline === null
    ? null
    : { ...baseline, commonBeverageTypes: [...baseline.commonBeverageTypes] }
}
function toPublicTobaccoBaseline(
  baseline: LifestyleTobaccoBaselineSummary | null
): LifestyleTobaccoBaselineSummary | null {
  return baseline === null ? null : { ...baseline, productTypes: [...baseline.productTypes] }
}
function toPublicWorkBaseline(
  baseline: LifestyleWorkBaselineSummary | null
): LifestyleWorkBaselineSummary | null {
  return baseline === null ? null : { ...baseline }
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
  logger: ScreeningLifestyleIpcOperationalLogger,
  channel: string,
  code: ScreeningLifestyleIpcErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=screening-lifestyle; channel=${channel}; code=${code}${errorType}`
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
