import { describe, expect, it, vi } from 'vitest'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import { createProtocolHandler } from '@main/ipc/handlers/protocol-handlers'
import { createProtocolApi } from '@preload/protocol-api'
import { ipcChannels } from '@shared/ipc/channels'
import type { ProtocolData } from '@shared/ipc/protocol-contracts'
const frame = { url: 'http://localhost:5173/' }
const event = { sender: { mainFrame: frame }, senderFrame: frame }
const policy = createDevelopmentNavigationPolicy(frame.url)

describe('protocol read boundary', () => {
  it('permits only an empty request from the trusted main frame', () => {
    const get = vi.fn((): ProtocolData => ({ status: 'NO_ACTIVE_PROTOCOL' }))
    const handler = createProtocolHandler({ navigationPolicy: policy, service: { get } })
    for (const senderFrame of [null, { ...frame }, { url: 'https://example.invalid' }]) {
      expect(handler({ ...event, senderFrame }, {})).toMatchObject({
        ok: false,
        error: { code: 'IPC_FORBIDDEN' }
      })
    }
    expect(handler(event, { activate: true })).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' }
    })
    expect(handler(event, undefined)).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED' }
    })
    expect(get).not.toHaveBeenCalled()
    expect(handler(event, {})).toEqual({ ok: true, data: { status: 'NO_ACTIVE_PROTOCOL' } })
  })
  it('sanitizes thrown errors and unexpected response fields', () => {
    const get = vi.fn((): ProtocolData => {
      throw new Error('private database path')
    })
    const handler = createProtocolHandler({ navigationPolicy: policy, service: { get } })
    expect(handler(event, {})).toEqual({ ok: true, data: { status: 'UNAVAILABLE' } })
    get.mockReturnValue({ status: 'NO_ACTIVE_PROTOCOL', password: 'secret' } as ProtocolData)
    expect(handler(event, {})).toEqual({ ok: true, data: { status: 'UNAVAILABLE' } })
  })
  it('exposes a frozen get-only preload API and validates all replies', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { status: 'NO_ACTIVE_PROTOCOL' } })
      .mockResolvedValueOnce({
        ok: true,
        data: { status: 'LOADED', active: { rulesMatch: 'yes' } }
      })
      .mockRejectedValueOnce(new Error('private database path'))
    const api = createProtocolApi(invoke)
    expect(Object.keys(api)).toEqual(['get'])
    expect(Object.isFrozen(api)).toBe(true)
    expect(await api.get()).toEqual({ ok: true, data: { status: 'NO_ACTIVE_PROTOCOL' } })
    expect(invoke).toHaveBeenCalledWith(ipcChannels.protocols.get, {})
    expect(await api.get()).toMatchObject({ ok: false, error: { code: 'IPC_UNAVAILABLE' } })
    expect(await api.get()).toMatchObject({ ok: false, error: { code: 'IPC_UNAVAILABLE' } })
  })
})
