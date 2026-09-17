import { describe, expect, it, vi } from 'vitest'
import {
  createHistoryHttpClient,
  historyPageByteLimit
} from '@main/application/central-history/history-http-client'
import { historyFixture, historyUuid } from '../../fixtures/central-history/history-fixture'

const credential = {
  apiBaseUrl: 'https://central.example.org',
  installationToken: `chs_inst_v1_${'A'.repeat(43)}`
}
const request = {
  contractVersion: '1.0' as const,
  personId: historyFixture().personId,
  localPatientId: historyUuid(1),
  requesterLocalActorId: historyUuid(2),
  reasonCode: 'CARE_DELIVERY' as const,
  fromDate: '2026-09-01',
  toDate: '2026-09-17'
}

describe('central history HTTP boundary', () => {
  it('posts identity only in the body, with protected credentials, no caching or redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(historyFixture()))
    expect(await createHistoryHttpClient(fetcher)(credential, request)).toEqual({
      status: 'RECEIVED',
      page: historyFixture()
    })
    expect(fetcher).toHaveBeenCalledWith(
      'https://central.example.org/api/v1/sync/patients/history',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(request),
        redirect: 'error',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${credential.installationToken}`
        }
      })
    )
  })

  it.each([401, 403, 404])(
    'treats HTTP %i as denied cache access without exposing server messages',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('secret patient information', { status }))
      expect(await createHistoryHttpClient(fetcher)(credential, request)).toEqual({
        status: 'ACCESS_DENIED'
      })
    }
  )

  it.each([
    ['HISTORY_CURSOR_STALE', 'CURSOR_STALE'],
    ['HISTORY_IDENTITY_REVIEW_REQUIRED', 'ACCESS_DENIED'],
    ['untrusted error', 'UNAVAILABLE']
  ])('maps %s to a safe local outcome', async (code, expected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ code, detail: 'private data' }, { status: 409 }))
    expect(await createHistoryHttpClient(fetcher)(credential, request)).toEqual({
      status: expected
    })
  })

  it('bounds streamed responses even without content-length and cancels oversized bodies', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(historyPageByteLimit))
        controller.enqueue(new Uint8Array(1))
      },
      cancel
    })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
    expect(await createHistoryHttpClient(fetcher)(credential, request)).toEqual({
      status: 'INVALID_RESPONSE'
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('rejects unrecognized fields, missing authors and invalid JSON without leaking payloads', async () => {
    for (const body of [
      JSON.stringify({ ...historyFixture(), secret: 'do not disclose' }),
      JSON.stringify({
        ...historyFixture(),
        items: [{ ...historyFixture().items[0], author: null }]
      }),
      'private server error',
      new Uint8Array([0xff, 0xfe])
    ]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(body))
      expect(await createHistoryHttpClient(fetcher)(credential, request)).toEqual({
        status: 'INVALID_RESPONSE'
      })
    }
  })

  it('contains network errors and never sends credentials to an invalid origin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(credential.installationToken))
    expect(await createHistoryHttpClient(fetcher)(credential, request)).toEqual({
      status: 'OFFLINE'
    })
    fetcher.mockClear()
    expect(
      await createHistoryHttpClient(fetcher)(
        { ...credential, apiBaseUrl: 'http://public.example.org' },
        request
      )
    ).toEqual({ status: 'OFFLINE' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('aborts a stalled request at the fixed timeout', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })
      )
      const result = createHistoryHttpClient(fetcher)(credential, request)
      await vi.advanceTimersByTimeAsync(30000)
      expect(await result).toEqual({ status: 'OFFLINE' })
    } finally {
      vi.useRealTimers()
    }
  })
})
