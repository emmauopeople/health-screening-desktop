import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

import {
  lifestyleEncounterId,
  validLifestyleWorkspace
} from '../shared/screening-lifestyle-test-fixtures'

const draftRequest = {
  encounterId: lifestyleEncounterId,
  expectedVersion: null,
  alcohol: null,
  tobacco: null,
  physicalActivity: null,
  work: null,
  otherActivityResponse: null,
  otherActivities: []
}
const requests = {
  getWorkspace: { encounterId: lifestyleEncounterId },
  saveAlcoholBaseline: {
    encounterId: lifestyleEncounterId,
    expectedBaselineVersion: null,
    expectedDraftVersion: null,
    status: 'CURRENT',
    everConsumed: 'YES',
    consumedPast12Months: 'YES',
    commonBeverageTypes: [],
    otherBeverageDescription: null
  },
  saveTobaccoBaseline: {
    encounterId: lifestyleEncounterId,
    expectedBaselineVersion: null,
    expectedDraftVersion: null,
    status: 'NEVER',
    everRegularlyUsed: 'NO',
    formerUseApproximateStopDate: null,
    currentUseFrequency: 'NOT_AT_ALL',
    productTypes: [],
    otherProductDescription: null
  },
  saveWorkBaseline: {
    encounterId: lifestyleEncounterId,
    expectedBaselineVersion: null,
    expectedDraftVersion: null,
    status: 'EMPLOYED',
    occupationJobTitle: null,
    usualPhysicalDemand: null,
    typicalWorkdaysPerWeek: null,
    typicalHoursPerWorkday: null,
    shiftPattern: null,
    description: null
  },
  saveDraft: draftRequest,
  complete: {
    ...draftRequest,
    alcoholBaselineReviewConfirmedVersionId: null,
    tobaccoBaselineReviewConfirmedVersionId: null
  }
} as const

const operationTable = [
  ['getWorkspace', ipcChannels.screeningEncounters.lifestyle.getWorkspace, 'LOADED'],
  ['saveAlcoholBaseline', ipcChannels.screeningEncounters.lifestyle.saveAlcoholBaseline, 'SAVED'],
  ['saveTobaccoBaseline', ipcChannels.screeningEncounters.lifestyle.saveTobaccoBaseline, 'SAVED'],
  ['saveWorkBaseline', ipcChannels.screeningEncounters.lifestyle.saveWorkBaseline, 'SAVED'],
  ['saveDraft', ipcChannels.screeningEncounters.lifestyle.saveDraft, 'SAVED'],
  ['complete', ipcChannels.screeningEncounters.lifestyle.complete, 'COMPLETED']
] as const

describe('preload Lifestyle API', () => {
  it('exposes exactly six fixed methods and no transport escape hatch', () => {
    const api = createHealthScreeningApi(vi.fn())
    const lifestyle = api.screeningEncounters.lifestyle

    expect(Object.keys(lifestyle)).toEqual([
      'getWorkspace',
      'saveAlcoholBaseline',
      'saveTobaccoBaseline',
      'saveWorkBaseline',
      'saveDraft',
      'complete'
    ])
    expect(Object.isFrozen(lifestyle)).toBe(true)
    expect('ipcRenderer' in lifestyle).toBe(false)
    expect('invoke' in lifestyle).toBe(false)
    expect('execute' in lifestyle).toBe(false)
  })

  it.each(operationTable)(
    'uses the fixed channel and forwards the exact %s request',
    async (method, channel, status) => {
      const response = createIpcSuccess({ status, workspace: validLifestyleWorkspace })
      const invoke = vi.fn().mockResolvedValue(response)
      const lifestyle = createHealthScreeningApi(invoke).screeningEncounters.lifestyle
      const request = requests[method]

      const result = await (lifestyle[method] as (value: unknown) => Promise<unknown>)(request)

      expect(result).toEqual(response)
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith(channel, request)
    }
  )

  it('rejects malformed and authority-bearing requests before invoking IPC', async () => {
    const invoke = vi.fn()
    const lifestyle = createHealthScreeningApi(invoke).screeningEncounters.lifestyle
    const invalidDraftRequests = [
      { ...draftRequest, actorId: lifestyleEncounterId },
      { ...draftRequest, installationId: lifestyleEncounterId },
      { ...draftRequest, locationId: lifestyleEncounterId },
      { ...draftRequest, screeningSessionId: lifestyleEncounterId },
      { ...draftRequest, updatedAt: '2026-08-06T12:00:00.000Z' },
      { ...draftRequest, status: 'COMPLETE' },
      { ...draftRequest, extra: true }
    ]
    const invalidBaselineRequest = {
      ...requests.saveAlcoholBaseline,
      actorId: lifestyleEncounterId,
      patientId: lifestyleEncounterId
    }

    for (const invalid of invalidDraftRequests) {
      await expect(lifestyle.saveDraft(invalid)).resolves.toEqual(
        createIpcSuccess({ status: 'VALIDATION_FAILED' })
      )
      await expect(
        lifestyle.complete({
          ...invalid,
          alcoholBaselineReviewConfirmedVersionId: null,
          tobaccoBaselineReviewConfirmedVersionId: null
        })
      ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))
    }
    await expect(lifestyle.saveAlcoholBaseline(invalidBaselineRequest as never)).resolves.toEqual(
      createIpcSuccess({ status: 'VALIDATION_FAILED' })
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns unavailable for a malformed nested response and never exposes its fields', async () => {
    const invoke = vi.fn().mockResolvedValue(
      createIpcSuccess({
        status: 'LOADED',
        workspace: {
          ...validLifestyleWorkspace,
          draft: { ...validLifestyleWorkspace.draft, patientId: lifestyleEncounterId }
        }
      })
    )
    const result = await createHealthScreeningApi(
      invoke
    ).screeningEncounters.lifestyle.getWorkspace(requests.getWorkspace)

    expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    expect(JSON.stringify(result)).not.toContain(lifestyleEncounterId)
  })

  it('accepts, clones, and recursively freezes a representative workspace response', async () => {
    const source = createIpcSuccess({
      status: 'LOADED' as const,
      workspace: validLifestyleWorkspace
    })
    const invoke = vi.fn().mockResolvedValue(source)
    const result = await createHealthScreeningApi(
      invoke
    ).screeningEncounters.lifestyle.getWorkspace(requests.getWorkspace)

    expect(result).toEqual(source)
    expect(result).not.toBe(source)
    if (result.ok && result.data.status === 'LOADED') {
      expect(result.data).not.toBe(source.data)
      expect(result.data.workspace).not.toBe(source.data.workspace)
      expect(result.data.workspace.draft?.tobacco?.products).not.toBe(
        source.data.workspace.draft?.tobacco?.products
      )
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.data)).toBe(true)
      expect(Object.isFrozen(result.data.workspace)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft?.tobacco)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft?.tobacco?.products)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft?.tobacco?.products[0])).toBe(true)
      expect(Object.isFrozen(result.data.workspace.activeWorkBaseline)).toBe(true)
    }
    expect(structuredClone(result)).toEqual(result)
    expect(JSON.stringify(result)).not.toMatch(
      /patientId|installationId|screeningSessionId|locationId|createdBy|updatedBy|parentId|draftId/u
    )
  })
})
