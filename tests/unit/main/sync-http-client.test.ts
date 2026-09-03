import { describe, expect, it, vi } from 'vitest'

import { createSyncHttpClient } from '@main/application/sync-transport'
import { parseEntityId } from '@main/foundation/entity-id'

const token = `chs_inst_v1_${'A'.repeat(43)}`
const credential = {
  apiBaseUrl: 'https://sync.example.org',
  installationToken: token
}

describe('synchronization HTTP client', () => {
  it('submits exact stored bytes with installation authentication and bounded routes', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      calls.push({ url: String(input), init })
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const client = createSyncHttpClient({ fetch: fetcher, timeoutMs: 5_000 })
    const exactBytes = '{"contractVersion":"1.0","batchId":"exact"}'

    await expect(client.submitBatch(credential, exactBytes)).resolves.toEqual({
      status: 'RESPONSE',
      httpStatus: 200,
      bodyText: '{"ok":true}',
      retryAfterMs: null
    })
    await client.recoverBatch(credential, parseEntityId('10000000-0000-4000-8000-000000000001'))

    expect(calls[0]).toMatchObject({
      url: 'https://sync.example.org/api/v1/sync/batches',
      init: {
        method: 'POST',
        body: exactBytes,
        redirect: 'error',
        headers: {
          accept: 'application/json, application/problem+json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        }
      }
    })
    expect(calls[1]).toMatchObject({
      url: 'https://sync.example.org/api/v1/sync/batches/10000000-0000-4000-8000-000000000001',
      init: { method: 'GET' }
    })
    expect(calls[1]?.init?.body).toBeUndefined()
  })

  it('rejects oversized response bodies without returning their contents', async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response('x', {
          status: 200,
          headers: { 'content-length': String(1024 * 1024 + 1) }
        })
    )
    const client = createSyncHttpClient({ fetch: fetcher, timeoutMs: 5_000 })

    await expect(client.submitBatch(credential, '{}')).resolves.toEqual({
      status: 'TRANSPORT_ERROR',
      errorCode: 'NETWORK_ERROR'
    })
  })
})
