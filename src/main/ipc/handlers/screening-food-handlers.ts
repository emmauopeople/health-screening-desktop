import type {
  FoodCatalogItemSummary,
  FoodDraftRowSummary,
  FoodDraftSummary,
  FoodRecentSuggestionSummary,
  FoodWorkspaceSummary,
  ScreeningFoodService
} from '@main/application'
import type { NavigationPolicy } from '@main/app/navigation-policy'
import { getErrorType } from '@main/foundation/error-type'
import type { EntityId } from '@main/foundation/entity-id'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcSuccess,
  createScreeningFoodIpcFailure,
  ipcChannels,
  screeningFoodGetWorkspaceRequestSchema,
  screeningFoodGetWorkspaceResultSchema,
  screeningFoodSaveDraftRequestSchema,
  screeningFoodSaveDraftResultSchema,
  type ScreeningFoodGetWorkspaceRequest,
  type ScreeningFoodGetWorkspaceResult,
  type ScreeningFoodIpcErrorCode,
  type ScreeningFoodSaveDraftRequest,
  type ScreeningFoodSaveDraftResult,
  type ScreeningFoodWorkspace
} from '@shared/ipc'

type PublicFoodDraft = NonNullable<ScreeningFoodWorkspace['draft']>

export interface ScreeningFoodIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface ScreeningFoodIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly screeningFoodService: ScreeningFoodService
  readonly logger?: ScreeningFoodIpcOperationalLogger
}

export interface ScreeningFoodIpcHandlers {
  getWorkspace(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningFoodGetWorkspaceResult>
  saveDraft(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ScreeningFoodSaveDraftResult>
}

export function createScreeningFoodIpcHandlers({
  navigationPolicy,
  screeningFoodService,
  logger = console
}: ScreeningFoodIpcHandlerDependencies): ScreeningFoodIpcHandlers {
  return Object.freeze({
    getWorkspace: createHandler<ScreeningFoodGetWorkspaceRequest, ScreeningFoodGetWorkspaceResult>({
      channel: ipcChannels.screeningEncounters.food.getWorkspace,
      requestSchema: screeningFoodGetWorkspaceRequestSchema,
      resultSchema: screeningFoodGetWorkspaceResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapWorkspaceResult(
          screeningFoodService.getWorkspace({
            encounterId: request.encounterId as EntityId
          })
        ),
      navigationPolicy,
      logger
    }),
    saveDraft: createHandler<ScreeningFoodSaveDraftRequest, ScreeningFoodSaveDraftResult>({
      channel: ipcChannels.screeningEncounters.food.saveDraft,
      requestSchema: screeningFoodSaveDraftRequestSchema,
      resultSchema: screeningFoodSaveDraftResultSchema,
      invalidResult: () => createIpcSuccess({ status: 'VALIDATION_FAILED' as const }),
      serviceCall: (request) =>
        mapSavedResult(
          screeningFoodService.saveDraft(
            request as unknown as Parameters<ScreeningFoodService['saveDraft']>[0]
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
  readonly logger: ScreeningFoodIpcOperationalLogger
}): (event: IpcSenderValidationEvent, request: unknown) => Promise<TResult> {
  return async (event, request) => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      const failure = createScreeningFoodIpcFailure('IPC_FORBIDDEN')
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
  result: ReturnType<ScreeningFoodService['getWorkspace']>
): ScreeningFoodGetWorkspaceResult {
  if (result.status === 'LOADED') {
    return createIpcSuccess({
      status: 'LOADED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningFoodGetWorkspaceResult
  }
  return createIpcSuccess({ status: result.status }) as ScreeningFoodGetWorkspaceResult
}

function mapSavedResult(
  result: ReturnType<ScreeningFoodService['saveDraft']>
): ScreeningFoodSaveDraftResult {
  if (result.status === 'SAVED') {
    return createIpcSuccess({
      status: 'SAVED',
      workspace: toPublicWorkspace(result.workspace)
    }) as ScreeningFoodSaveDraftResult
  }
  return createIpcSuccess({ status: result.status }) as ScreeningFoodSaveDraftResult
}

function toPublicWorkspace(workspace: FoodWorkspaceSummary): ScreeningFoodWorkspace {
  return {
    encounterId: workspace.encounterId,
    draft: workspace.draft === null ? null : toPublicDraft(workspace.draft),
    catalogItems: workspace.catalogItems.map(toPublicCatalogItem),
    recentFoods: workspace.recentFoods.map(toPublicRecentSuggestion)
  }
}

function toPublicDraft(draft: FoodDraftSummary): PublicFoodDraft {
  return {
    id: draft.id,
    encounterId: draft.encounterId,
    foodResponse: draft.foodResponse,
    rowVersion: draft.rowVersion,
    periodStart: draft.periodStart,
    periodEnd: draft.periodEnd,
    rows: draft.rows.map(toPublicRow),
    updatedAt: draft.updatedAt
  }
}

function toPublicRow(row: FoodDraftRowSummary): PublicFoodDraft['rows'][number] {
  return {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    catalogCode: row.catalogCode,
    foodNameSnapshot: row.foodNameSnapshot,
    foodNameNormalized: row.foodNameNormalized,
    frequencyCode: row.frequencyCode,
    preparationNote: row.preparationNote,
    updatedAt: row.updatedAt
  }
}

function toPublicCatalogItem(
  item: FoodCatalogItemSummary
): ScreeningFoodWorkspace['catalogItems'][number] {
  return {
    code: item.code,
    displayName: item.displayName,
    normalizedSearchName: item.normalizedSearchName,
    sortOrder: item.sortOrder
  }
}

function toPublicRecentSuggestion(
  item: FoodRecentSuggestionSummary
): ScreeningFoodWorkspace['recentFoods'][number] {
  return {
    catalogCode: item.catalogCode,
    foodNameSnapshot: item.foodNameSnapshot,
    foodNameNormalized: item.foodNameNormalized,
    lastRecordedAt: item.lastRecordedAt
  }
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
  logger: ScreeningFoodIpcOperationalLogger,
  channel: string,
  code: ScreeningFoodIpcErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=screening-food; channel=${channel}; code=${code}${errorType}`
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
