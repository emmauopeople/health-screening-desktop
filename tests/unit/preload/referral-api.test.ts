import { describe, expect, it, vi } from 'vitest'
import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

const id = '62000000-0000-4000-8000-000000000007'

describe('preload referral API', () => {
  it('exposes four fixed methods without a transport escape hatch', () => {
    const referrals = createHealthScreeningApi(vi.fn()).referrals!
    expect(Object.keys(referrals)).toEqual([
      'search',
      'getDetail',
      'updateStatus',
      'recordFollowup'
    ])
    expect(Object.isFrozen(referrals)).toBe(true)
    expect('invoke' in referrals).toBe(false)
  })

  it('uses fixed channels and exact validated requests', async () => {
    const response = createIpcSuccess({ status: 'REFERRAL_NOT_FOUND' as const })
    const invoke = vi.fn().mockResolvedValue(response)
    const referrals = createHealthScreeningApi(invoke).referrals!
    await expect(referrals.getDetail({ referralId: id })).resolves.toEqual(response)
    expect(invoke).toHaveBeenCalledWith(ipcChannels.referrals.getDetail, { referralId: id })
  })

  it('blocks over-posted authority fields before IPC and contains malformed responses', async () => {
    const invoke = vi.fn()
    const referrals = createHealthScreeningApi(invoke).referrals!
    await expect(
      referrals.updateStatus({
        referralId: id,
        expectedVersion: 1,
        status: 'CONTACTED',
        reason: null,
        actorId: id
      } as never)
    ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    expect(invoke).not.toHaveBeenCalled()
    invoke.mockResolvedValue({ ok: true, data: { status: 'LOADED', secret: 'clinical' } })
    await expect(referrals.getDetail({ referralId: id })).resolves.toEqual(
      createIpcSuccess({ status: 'UNAVAILABLE' })
    )
  })
})
