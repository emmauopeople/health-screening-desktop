import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/health-screening-api'
import { ipcChannels } from '@shared/ipc'

import {
  otcEncounterId,
  validOtcGetWorkspaceRequest,
  validOtcSaveDraftRequest,
  validOtcWorkspace
} from '../shared/screening-otc-test-fixtures'

describe('preload OTC API', () => {
  it('exposes exactly the frozen OTC methods without raw IPC access', () => {
    const api = createHealthScreeningApi(vi.fn()).screeningEncounters.otc

    expect(Object.keys(api)).toEqual(['getWorkspace', 'saveDraft'])
    expect(Object.isFrozen(api)).toBe(true)
    expect('ipcRenderer' in api).toBe(false)
    expect('invoke' in api).toBe(false)
    expect('database' in api).toBe(false)
  })

  it('invokes the exact OTC channels and preserves validated results', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { status: 'LOADED', workspace: validOtcWorkspace } })
      .mockResolvedValueOnce({ ok: true, data: { status: 'SAVED', workspace: validOtcWorkspace } })
    const api = createHealthScreeningApi(invoke).screeningEncounters.otc

    await expect(api.getWorkspace(validOtcGetWorkspaceRequest)).resolves.toEqual({
      ok: true,
      data: { status: 'LOADED', workspace: validOtcWorkspace }
    })
    await expect(api.saveDraft(validOtcSaveDraftRequest)).resolves.toEqual({
      ok: true,
      data: { status: 'SAVED', workspace: validOtcWorkspace }
    })
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      ipcChannels.screeningEncounters.otc.getWorkspace,
      validOtcGetWorkspaceRequest
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      ipcChannels.screeningEncounters.otc.saveDraft,
      validOtcSaveDraftRequest
    )
  })

  it('rejects invalid requests before invoking IPC', async () => {
    const invoke = vi.fn()
    const api = createHealthScreeningApi(invoke).screeningEncounters.otc

    await expect(
      api.getWorkspace({ encounterId: otcEncounterId, patientId: otcEncounterId } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'VALIDATION_FAILED' } })
    await expect(
      api.saveDraft({ ...validOtcSaveDraftRequest, otcResponse: 'NO' } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'VALIDATION_FAILED' } })
    const sparseRows = new Array(1)
    await expect(
      api.saveDraft({ ...validOtcSaveDraftRequest, rows: sparseRows } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'VALIDATION_FAILED' } })
    await expect(
      api.getWorkspace(withOwnProto({ encounterId: otcEncounterId }) as never)
    ).resolves.toEqual({ ok: true, data: { status: 'VALIDATION_FAILED' } })
    const validRequestWithPrototype = { ...validOtcSaveDraftRequest }
    Object.defineProperty(validRequestWithPrototype, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { extra: true },
      writable: true
    })
    await expect(api.saveDraft(validRequestWithPrototype as never)).resolves.toEqual({
      ok: true,
      data: { status: 'VALIDATION_FAILED' }
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('sanitizes malformed or unavailable IPC responses', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, data: { status: 'SAVED', workspace: validOtcWorkspace } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          status: 'LOADED',
          workspace: {
            ...validOtcWorkspace,
            draft: { ...validOtcWorkspace.draft!, rows: new Array(1) }
          }
        }
      })
      .mockResolvedValueOnce({
        ok: true,
        data: withOwnProto({ status: 'LOADED', workspace: validOtcWorkspace })
      })
      .mockRejectedValueOnce(new Error('clinical payload'))
    const api = createHealthScreeningApi(invoke).screeningEncounters.otc

    await expect(api.getWorkspace(validOtcGetWorkspaceRequest)).resolves.toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
    await expect(api.saveDraft(validOtcSaveDraftRequest)).resolves.toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
    await expect(api.getWorkspace(validOtcGetWorkspaceRequest)).resolves.toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
    await expect(api.saveDraft(validOtcSaveDraftRequest)).resolves.toEqual({
      ok: true,
      data: { status: 'UNAVAILABLE' }
    })
  })
})

function withOwnProto(value: unknown): Record<string, unknown> {
  const target: Record<string, unknown> = {}
  Object.defineProperty(target, '__proto__', {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  })
  return target
}
