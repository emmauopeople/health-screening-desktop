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
  type ReferralApi,
  type ReferralGetDetailRequest,
  type ReferralRecordFollowupRequest,
  type ReferralSearchRequest,
  type ReferralUpdateStatusRequest
} from '@shared/ipc'
import type { IpcInvoke } from './authentication-api'

export function createReferralApi(invoke: IpcInvoke): ReferralApi {
  const call = async <TRequest, TResult>(
    channel: string,
    request: TRequest,
    requestSchema: Schema<TRequest>,
    resultSchema: Schema<TResult>
  ): Promise<TResult> => {
    const parsed = safeParse(requestSchema, request)
    if (!parsed.success) return createIpcSuccess({ status: 'VALIDATION_FAILED' }) as TResult
    try {
      const result = safeParse(resultSchema, await invoke(channel, parsed.data))
      return result.success ? result.data : (createIpcSuccess({ status: 'UNAVAILABLE' }) as TResult)
    } catch {
      return createIpcFailure('IPC_UNAVAILABLE') as TResult
    }
  }
  return Object.freeze({
    search: (request: ReferralSearchRequest) =>
      call(
        ipcChannels.referrals.search,
        request,
        referralSearchRequestSchema,
        referralSearchResultSchema
      ),
    getDetail: (request: ReferralGetDetailRequest) =>
      call(
        ipcChannels.referrals.getDetail,
        request,
        referralGetDetailRequestSchema,
        referralGetDetailResultSchema
      ),
    updateStatus: (request: ReferralUpdateStatusRequest) =>
      call(
        ipcChannels.referrals.updateStatus,
        request,
        referralUpdateStatusRequestSchema,
        referralUpdateStatusResultSchema
      ),
    recordFollowup: (request: ReferralRecordFollowupRequest) =>
      call(
        ipcChannels.referrals.recordFollowup,
        request,
        referralRecordFollowupRequestSchema,
        referralRecordFollowupResultSchema
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
