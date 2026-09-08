import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

const request = {
  query: '',
  occurredFromInclusive: null,
  occurredToExclusive: null,
  actor: { kind: 'ALL' as const },
  action: null,
  entityType: null,
  entityId: null,
  page: 1,
  pageSize: 25 as const
}

describe('preload audit report API', () => {
  it('exposes two frozen methods without a transport escape hatch', () => {
    const api = createHealthScreeningApi(vi.fn()).auditReports!
    expect(Object.keys(api)).toEqual(['getContext', 'search'])
    expect(Object.isFrozen(api)).toBe(true)
    expect('invoke' in api).toBe(false)
  })

  it('uses fixed channels and exact validated requests', async () => {
    const response = createIpcSuccess({
      status: 'LOADED' as const,
      items: [],
      page: 1,
      pageSize: 25 as const,
      total: 0
    })
    const invoke = vi.fn().mockResolvedValue(response)
    await expect(createHealthScreeningApi(invoke).auditReports!.search(request)).resolves.toEqual(
      response
    )
    expect(invoke).toHaveBeenCalledWith(ipcChannels.auditReports.search, request)
  })

  it('blocks malformed requests before IPC and contains malformed responses', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke).auditReports!
    await expect(api.search({ ...request, entityId: 'not-a-uuid' })).resolves.toEqual(
      createIpcSuccess({ status: 'VALIDATION_FAILED' })
    )
    expect(invoke).not.toHaveBeenCalled()

    invoke.mockResolvedValue({ ok: true, data: { status: 'LOADED', secret: 'audit row' } })
    await expect(api.getContext()).resolves.toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
  })
})
