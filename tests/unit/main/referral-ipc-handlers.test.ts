import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { ReferralService } from '@main/application'
import { createReferralIpcHandlers } from '@main/ipc/handlers/referral-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createIpcSuccess } from '@shared/ipc'

const id = '62000000-0000-4000-8000-000000000007'
const frame = { url: 'http://localhost:5173/' }
const event: IpcSenderValidationEvent = { sender: { mainFrame: frame }, senderFrame: frame }

describe('referral IPC handlers', () => {
  it('passes only validated search input to the service', async () => {
    const service = createService()
    const handlers = createHandlers(service)
    const request = {
      query: '',
      statuses: ['OPEN'] as const,
      urgency: null,
      dueFrom: null,
      dueTo: null,
      page: 1,
      pageSize: 25 as const
    }
    await expect(handlers.search(event, request)).resolves.toEqual(
      createIpcSuccess({ status: 'LOADED', items: [], total: 0, page: 1, pageSize: 25 })
    )
    expect(service.search).toHaveBeenCalledWith(request)
  })

  it('rejects authority-bearing and malformed requests before service execution', async () => {
    const service = createService()
    const result = await createHandlers(service).updateStatus(event, {
      referralId: id,
      expectedVersion: 1,
      status: 'CONTACTED',
      reason: null,
      actorId: id
    })
    expect(result).toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    expect(service.updateStatus).not.toHaveBeenCalled()
  })

  it('rejects an untrusted sender and sanitizes service exceptions', async () => {
    const service = createService()
    vi.mocked(service.getDetail).mockImplementation(() => {
      throw new Error('secret')
    })
    const handlers = createHandlers(service)
    const forbidden = {
      sender: { mainFrame: { url: 'https://evil.invalid' } },
      senderFrame: { url: 'https://evil.invalid' }
    }
    await expect(handlers.getDetail(forbidden, { referralId: id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'IPC_FORBIDDEN' }
    })
    await expect(handlers.getDetail(event, { referralId: id })).resolves.toEqual(
      createIpcSuccess({ status: 'UNAVAILABLE' })
    )
  })
})

function createHandlers(service: ReferralService): ReturnType<typeof createReferralIpcHandlers> {
  return createReferralIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    referralService: service,
    logger: { warn: vi.fn(), error: vi.fn() }
  })
}

function createService(): ReferralService {
  return {
    search: vi.fn(() => ({
      status: 'LOADED' as const,
      items: [],
      total: 0,
      page: 1,
      pageSize: 25 as const
    })),
    getDetail: vi.fn(() => ({ status: 'REFERRAL_NOT_FOUND' as const })),
    updateStatus: vi.fn(() => ({ status: 'REFERRAL_NOT_FOUND' as const })),
    recordFollowup: vi.fn(() => ({ status: 'REFERRAL_NOT_FOUND' as const }))
  }
}
