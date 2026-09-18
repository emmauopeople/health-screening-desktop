import {
  isHistoryPage,
  type HistoryPage,
  type InstallationHistoryRequest
} from '@shared/central-history/contract.mjs'
import type { CentralHistoryStatus } from '@shared/ipc/central-history-contracts'
import type { SyncTransportCredential } from '../sync-transport/sync-transport-types'
import { parseSyncConfiguration } from '../sync-transport/sync-transport-validation'

export type HistoryFetchResult =
  { status: 'RECEIVED'; page: HistoryPage } | { status: CentralHistoryStatus }
export type HistoryHttpClient = (
  credential: SyncTransportCredential,
  request: InstallationHistoryRequest
) => Promise<HistoryFetchResult>
export const historyPageByteLimit = 512 * 1024

export function createHistoryHttpClient(fetchImpl: typeof fetch = fetch): HistoryHttpClient {
  return async (credential, request) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const validated = parseSyncConfiguration(credential)
      const response = await fetchImpl(`${validated.apiBaseUrl}/api/v1/sync/patients/history`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${validated.installationToken}`
        },
        body: JSON.stringify(request),
        signal: controller.signal,
        redirect: 'error',
        cache: 'no-store'
      })
      if ([401, 403, 404].includes(response.status)) {
        await response.body?.cancel()
        return { status: 'ACCESS_DENIED' }
      }
      const reader = response.body?.getReader()
      if (!reader) return { status: 'INVALID_RESPONSE' }
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > historyPageByteLimit) {
            await reader.cancel()
            return { status: 'INVALID_RESPONSE' }
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      let body: unknown
      try {
        body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      } catch {
        return { status: response.ok ? 'INVALID_RESPONSE' : 'UNAVAILABLE' }
      }
      if (!response.ok) {
        const code =
          typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined
        if (code === 'HISTORY_CURSOR_STALE') return { status: 'CURSOR_STALE' }
        if (code === 'HISTORY_IDENTITY_REVIEW_REQUIRED') return { status: 'ACCESS_DENIED' }
        return { status: 'UNAVAILABLE' }
      }
      if (!isHistoryPage(body)) return { status: 'INVALID_RESPONSE' }
      return { status: 'RECEIVED', page: body }
    } catch {
      return { status: 'OFFLINE' }
    } finally {
      clearTimeout(timer)
    }
  }
}
