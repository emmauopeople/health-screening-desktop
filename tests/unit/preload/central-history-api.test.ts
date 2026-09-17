import { describe, expect, it, vi } from 'vitest'
import { createCentralHistoryApi } from '@preload/central-history-api'
import { createCentralHistoryHandlers } from '@main/ipc/handlers/central-history-handlers'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { allDomainHistory, historyUuid } from '../../fixtures/central-history/history-fixture'

const request = { patientId: historyUuid(1), reasonCode: 'CARE_COORDINATION' as const }
const event = (url: string): IpcSenderValidationEvent => {
  const mainFrame = { url }
  return { sender: { mainFrame }, senderFrame: mainFrame }
}

describe('central history IPC and preload', () => {
  it('rejects renderer-supplied actor, canonical identity and scope', async () => {
    const invoke = vi.fn()
    const api = createCentralHistoryApi(invoke)
    for (const extra of [
      { personId: historyUuid(2) },
      { requesterLocalActorId: historyUuid(3) },
      { organizationId: historyUuid(4) }
    ]) {
      expect(await api.read({ ...request, ...extra })).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED' }
      })
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('validates all domain responses and contains compromised or unavailable transports', async () => {
    const data = {
      status: 'READY',
      snapshotId: historyUuid(8),
      savedAt: '2026-09-17T12:00:00.000Z',
      page: allDomainHistory(),
      offset: 0,
      nextOffset: null,
      total: 11
    }
    const invoke = vi.fn().mockResolvedValue({ ok: true, data })
    expect(await createCentralHistoryApi(invoke).read(request)).toEqual({ ok: true, data })
    invoke.mockResolvedValueOnce({
      ok: true,
      data: { ...data, installationToken: 'private secret' }
    })
    expect(await createCentralHistoryApi(invoke).read(request)).toMatchObject({
      ok: false,
      error: { code: 'IPC_UNAVAILABLE' }
    })
    invoke.mockRejectedValueOnce(new Error('private payload'))
    expect(JSON.stringify(await createCentralHistoryApi(invoke).read(request))).not.toContain(
      'private'
    )
  })

  it('checks the sender before inspecting input and contains unexpected service output', async () => {
    const service = { read: vi.fn().mockReturnValue({ status: 'NO_CACHE' }), refresh: vi.fn() }
    const handlers = createCentralHistoryHandlers({
      service,
      navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/')
    })
    const inspected = vi.fn(() => {
      throw new Error('private input')
    })
    const input = new Proxy({}, { get: inspected })
    expect(await handlers.read(event('https://untrusted.example.org'), input)).toMatchObject({
      ok: false,
      error: { code: 'IPC_FORBIDDEN' }
    })
    expect(inspected).not.toHaveBeenCalled()
    expect(service.read).not.toHaveBeenCalled()
    expect(await handlers.read(event('http://localhost:5173/'), request)).toEqual({
      ok: true,
      data: { status: 'NO_CACHE' }
    })
    service.read.mockReturnValueOnce({ status: 'READY', secret: 'private payload' })
    expect(await handlers.read(event('http://localhost:5173/'), request)).toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
  })
})
