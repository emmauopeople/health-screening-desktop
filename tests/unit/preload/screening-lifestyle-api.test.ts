import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

const encounterId = '33333333-3333-4333-8333-333333333333'
const request = {
  encounterId,
  expectedVersion: null,
  alcohol: null,
  tobacco: null,
  physicalActivity: null,
  work: null,
  otherActivities: []
}
const workspace = {
  encounterId,
  draft: null,
  activeAlcoholBaseline: null,
  activeTobaccoBaseline: null,
  activeWorkBaseline: null,
  referencedAlcoholBaseline: null,
  referencedTobaccoBaseline: null,
  referencedWorkBaseline: null
}

describe('preload Lifestyle API', () => {
  it('exposes only the fixed Lifestyle methods and no transport escape hatch', () => {
    const api = createHealthScreeningApi(vi.fn())
    expect(Object.keys(api.screeningEncounters.lifestyle)).toEqual([
      'getWorkspace',
      'saveAlcoholBaseline',
      'saveTobaccoBaseline',
      'saveWorkBaseline',
      'saveDraft',
      'complete'
    ])
    expect(Object.isFrozen(api.screeningEncounters.lifestyle)).toBe(true)
    expect('ipcRenderer' in api.screeningEncounters.lifestyle).toBe(false)
    expect('invoke' in api.screeningEncounters.lifestyle).toBe(false)
  })

  it('invokes the fixed draft channel and validates responses', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(createIpcSuccess({ status: 'SAVED' as const, workspace: null }))
    const api = createHealthScreeningApi(invoke)
    const result = await api.screeningEncounters.lifestyle.saveDraft(request)

    expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' as const }))
    expect(invoke).toHaveBeenCalledWith(
      ipcChannels.screeningEncounters.lifestyle.saveDraft,
      request
    )
  })

  it('accepts a structured-clone-safe workspace response', async () => {
    const response = createIpcSuccess({ status: 'LOADED' as const, workspace })
    const invoke = vi.fn().mockResolvedValue(response)
    const result = await createHealthScreeningApi(
      invoke
    ).screeningEncounters.lifestyle.getWorkspace({
      encounterId
    })

    expect(result).toEqual(response)
    expect(Object.isFrozen(result)).toBe(true)
    expect(structuredClone(result)).toEqual(response)
  })

  it('rejects malformed or authority-bearing requests before IPC', async () => {
    const invoke = vi.fn()
    const lifestyle = createHealthScreeningApi(invoke).screeningEncounters.lifestyle
    for (const invalid of [
      { ...request, actorId: encounterId },
      { ...request, patientId: encounterId },
      { ...request, status: 'COMPLETE' },
      { ...request, extra: true }
    ]) {
      await expect(lifestyle.saveDraft(invalid)).resolves.toEqual(
        createIpcSuccess({ status: 'VALIDATION_FAILED' as const })
      )
    }
    expect(invoke).not.toHaveBeenCalled()
  })
})
