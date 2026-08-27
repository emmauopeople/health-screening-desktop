import type { NavigationPolicy } from '@main/app/navigation-policy'
import type { ReferralService } from '@main/application'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createIpcFailure,
  createIpcSuccess,
  ipcChannels,
  referralGetDetailRequestSchema,
  referralGetDetailResultSchema,
  referralRecordFollowupRequestSchema,
  referralRecordFollowupResultSchema,
  referralSearchRequestSchema,
  referralSearchResultSchema,
  referralUpdateStatusRequestSchema,
  referralUpdateStatusResultSchema,
  type ReferralGetDetailResult,
  type ReferralRecordFollowupResult,
  type ReferralSearchResult,
  type ReferralUpdateStatusResult
} from '@shared/ipc'

export interface ReferralIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly referralService: ReferralService
  readonly logger?: Pick<Console, 'warn' | 'error'>
}

export interface ReferralIpcHandlers {
  search(event: IpcSenderValidationEvent, request: unknown): Promise<ReferralSearchResult>
  getDetail(event: IpcSenderValidationEvent, request: unknown): Promise<ReferralGetDetailResult>
  updateStatus(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ReferralUpdateStatusResult>
  recordFollowup(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<ReferralRecordFollowupResult>
}

export function createReferralIpcHandlers({
  navigationPolicy,
  referralService,
  logger = console
}: ReferralIpcHandlerDependencies): ReferralIpcHandlers {
  const handle = async <TRequest, TResult>(
    event: IpcSenderValidationEvent,
    request: unknown,
    channel: string,
    requestSchema: Schema<TRequest>,
    resultSchema: Schema<TResult>,
    invoke: (request: TRequest) => unknown
  ): Promise<TResult> => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      logger.warn(`IPC handler result event=referral; channel=${channel}; code=IPC_FORBIDDEN`)
      return createIpcFailure('IPC_FORBIDDEN') as TResult
    }
    const parsed = safeParse(requestSchema, request)
    if (!parsed.success) return createIpcSuccess({ status: 'VALIDATION_FAILED' }) as TResult
    try {
      const result = createIpcSuccess(invoke(parsed.data))
      const validated = safeParse(resultSchema, result)
      if (validated.success) return validated.data
    } catch {
      // The renderer receives only the controlled result below.
    }
    logger.error(`IPC handler result event=referral; channel=${channel}; code=INTERNAL_ERROR`)
    return createIpcSuccess({ status: 'UNAVAILABLE' }) as TResult
  }

  return Object.freeze({
    search: (event: IpcSenderValidationEvent, request: unknown): Promise<ReferralSearchResult> =>
      handle(
        event,
        request,
        ipcChannels.referrals.search,
        referralSearchRequestSchema,
        referralSearchResultSchema,
        (data) => referralService.search(data)
      ),
    getDetail: (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ReferralGetDetailResult> =>
      handle(
        event,
        request,
        ipcChannels.referrals.getDetail,
        referralGetDetailRequestSchema,
        referralGetDetailResultSchema,
        (data) => referralService.getDetail(data)
      ),
    updateStatus: (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ReferralUpdateStatusResult> =>
      handle(
        event,
        request,
        ipcChannels.referrals.updateStatus,
        referralUpdateStatusRequestSchema,
        referralUpdateStatusResultSchema,
        (data) => referralService.updateStatus(data)
      ),
    recordFollowup: (
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<ReferralRecordFollowupResult> =>
      handle(
        event,
        request,
        ipcChannels.referrals.recordFollowup,
        referralRecordFollowupRequestSchema,
        referralRecordFollowupResultSchema,
        (data) => referralService.recordFollowup(data)
      )
  })
}

interface Schema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
}

function safeParse<T>(
  schema: Schema<T>,
  value: unknown
): { success: true; data: T } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}
