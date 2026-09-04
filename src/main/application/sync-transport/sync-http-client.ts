import type { EntityId } from '@main/foundation/entity-id'

import type { SyncTransportCredential } from './sync-transport-types'

const maximumResponseBytes = 1024 * 1024
const defaultTimeoutMs = 30_000

export type SyncHttpResult =
  | Readonly<{
      status: 'RESPONSE'
      httpStatus: number
      bodyText: string
      retryAfterMs: number | null
    }>
  | Readonly<{ status: 'TRANSPORT_ERROR'; errorCode: 'NETWORK_ERROR' | 'REQUEST_TIMEOUT' }>

export interface SyncHttpClient {
  submitBatch(credential: SyncTransportCredential, requestJson: string): Promise<SyncHttpResult>
  recoverBatch(credential: SyncTransportCredential, batchId: EntityId): Promise<SyncHttpResult>
  pullIdentityResolutions(
    credential: SyncTransportCredential,
    limit: number
  ): Promise<SyncHttpResult>
  acknowledgeIdentityResolution(
    credential: SyncTransportCredential,
    requestJson: string
  ): Promise<SyncHttpResult>
}

export interface SyncHttpClientOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

export function createSyncHttpClient(options: SyncHttpClientOptions = {}): SyncHttpClient {
  const fetcher = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  if (typeof fetcher !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000) {
    throw new Error('Invalid synchronization HTTP client configuration.')
  }

  return Object.freeze({
    submitBatch: (credential: SyncTransportCredential, requestJson: string) =>
      request(fetcher, timeoutMs, credential, '/api/v1/sync/batches', 'POST', requestJson),
    recoverBatch: (credential: SyncTransportCredential, batchId: EntityId) =>
      request(
        fetcher,
        timeoutMs,
        credential,
        `/api/v1/sync/batches/${encodeURIComponent(batchId)}`,
        'GET'
      ),
    pullIdentityResolutions: (credential: SyncTransportCredential, limit: number) =>
      request(
        fetcher,
        timeoutMs,
        credential,
        '/api/v1/sync/identity-resolutions/pull',
        'POST',
        identityPullRequest(limit)
      ),
    acknowledgeIdentityResolution: (credential: SyncTransportCredential, requestJson: string) =>
      request(
        fetcher,
        timeoutMs,
        credential,
        '/api/v1/sync/identity-resolutions/acknowledge',
        'POST',
        requestJson
      )
  })
}

function identityPullRequest(limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Invalid identity-resolution pull limit.')
  }
  return JSON.stringify({ contractVersion: '1.0', limit })
}

async function request(
  fetcher: typeof globalThis.fetch,
  timeoutMs: number,
  credential: SyncTransportCredential,
  path: string,
  method: 'GET' | 'POST',
  body?: string
): Promise<SyncHttpResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetcher(`${credential.apiBaseUrl}${path}`, {
      method,
      headers: {
        accept: 'application/json, application/problem+json',
        authorization: `Bearer ${credential.installationToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' })
      },
      ...(body === undefined ? {} : { body }),
      redirect: 'error',
      signal: controller.signal
    })
    return Object.freeze({
      status: 'RESPONSE' as const,
      httpStatus: response.status,
      bodyText: await readBoundedBody(response),
      retryAfterMs: parseRetryAfter(response.headers.get('retry-after'))
    })
  } catch (error) {
    return Object.freeze({
      status: 'TRANSPORT_ERROR' as const,
      errorCode:
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
          ? ('REQUEST_TIMEOUT' as const)
          : ('NETWORK_ERROR' as const)
    })
  } finally {
    clearTimeout(timer)
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && Number(declaredLength) > maximumResponseBytes) {
    throw new Error('SYNC_RESPONSE_TOO_LARGE')
  }
  if (response.body === null) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > maximumResponseBytes) {
      await reader.cancel()
      throw new Error('SYNC_RESPONSE_TOO_LARGE')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null
  if (/^[0-9]{1,6}$/.test(value)) return Math.min(Number(value) * 1000, 15 * 60_000)
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) return null
  return Math.min(Math.max(instant - Date.now(), 0), 15 * 60_000)
}
