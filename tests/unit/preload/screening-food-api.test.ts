import { describe, expect, it, vi } from 'vitest'

import { createHealthScreeningApi } from '@preload/api'
import { createIpcSuccess, ipcChannels } from '@shared/ipc'

import {
  foodEncounterId,
  validFoodSaveDraftRequest,
  validFoodWorkspace
} from '../shared/screening-food-test-fixtures'

const requests = {
  getWorkspace: { encounterId: foodEncounterId },
  saveDraft: validFoodSaveDraftRequest
} as const
const validFoodDraft = validFoodWorkspace.draft!

const operationTable = [
  ['getWorkspace', ipcChannels.screeningEncounters.food.getWorkspace, 'LOADED'],
  ['saveDraft', ipcChannels.screeningEncounters.food.saveDraft, 'SAVED']
] as const

describe('preload Food API', () => {
  it('exposes exactly two fixed methods and no transport escape hatch', () => {
    const api = createHealthScreeningApi(vi.fn())
    const food = api.screeningEncounters.food

    expect(Object.keys(food)).toEqual(['getWorkspace', 'saveDraft'])
    expect(Object.isFrozen(food)).toBe(true)
    expect('ipcRenderer' in food).toBe(false)
    expect('invoke' in food).toBe(false)
    expect('execute' in food).toBe(false)
    expect('database' in food).toBe(false)
  })

  it.each(operationTable)(
    'uses the fixed channel and forwards the exact %s request',
    async (method, channel, status) => {
      const response = createIpcSuccess({ status, workspace: validFoodWorkspace })
      const invoke = vi.fn().mockResolvedValue(response)
      const food = createHealthScreeningApi(invoke).screeningEncounters.food
      const request = requests[method]

      const result = await (food[method] as (value: unknown) => Promise<unknown>)(request)

      expect(result).toEqual(response)
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith(channel, request)
    }
  )

  it('rejects malformed and authority-bearing requests before invoking IPC', async () => {
    const invoke = vi.fn()
    const food = createHealthScreeningApi(invoke).screeningEncounters.food
    const invalidDraftRequests = [
      { ...validFoodSaveDraftRequest, patientId: foodEncounterId },
      { ...validFoodSaveDraftRequest, screeningSessionId: foodEncounterId },
      { ...validFoodSaveDraftRequest, locationId: foodEncounterId },
      { ...validFoodSaveDraftRequest, installationId: foodEncounterId },
      { ...validFoodSaveDraftRequest, actorId: foodEncounterId },
      { ...validFoodSaveDraftRequest, periodStart: '2026-08-12' },
      { ...validFoodSaveDraftRequest, updatedAt: '2026-08-18T12:00:00.000Z' },
      { ...validFoodSaveDraftRequest, foodResponse: 'NO' },
      { ...validFoodSaveDraftRequest, extra: true }
    ]

    await expect(
      food.getWorkspace({ encounterId: foodEncounterId, patientId: foodEncounterId } as never)
    ).resolves.toEqual(createIpcSuccess({ status: 'VALIDATION_FAILED' }))

    for (const invalid of invalidDraftRequests) {
      await expect(food.saveDraft(invalid as never)).resolves.toEqual(
        createIpcSuccess({ status: 'VALIDATION_FAILED' })
      )
    }
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns unavailable for a malformed nested response and never exposes its fields', async () => {
    const invoke = vi.fn().mockResolvedValue(
      createIpcSuccess({
        status: 'LOADED',
        workspace: {
          ...validFoodWorkspace,
          draft: { ...validFoodDraft, patientId: foodEncounterId }
        }
      })
    )
    const result = await createHealthScreeningApi(invoke).screeningEncounters.food.getWorkspace(
      requests.getWorkspace
    )

    expect(result).toEqual(createIpcSuccess({ status: 'UNAVAILABLE' }))
    expect(JSON.stringify(result)).not.toContain(foodEncounterId)
  })

  it('accepts, clones, and recursively freezes a representative workspace response', async () => {
    const source = createIpcSuccess({
      status: 'LOADED' as const,
      workspace: validFoodWorkspace
    })
    const invoke = vi.fn().mockResolvedValue(source)
    const result = await createHealthScreeningApi(invoke).screeningEncounters.food.getWorkspace(
      requests.getWorkspace
    )

    expect(result).toEqual(source)
    expect(result).not.toBe(source)
    if (result.ok && result.data.status === 'LOADED') {
      expect(result.data).not.toBe(source.data)
      expect(result.data.workspace).not.toBe(source.data.workspace)
      expect(result.data.workspace.draft?.rows).not.toBe(source.data.workspace.draft?.rows)
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.data)).toBe(true)
      expect(Object.isFrozen(result.data.workspace)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft?.rows)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.draft?.rows[0])).toBe(true)
      expect(Object.isFrozen(result.data.workspace.catalogItems)).toBe(true)
      expect(Object.isFrozen(result.data.workspace.recentFoods)).toBe(true)
    }
    expect(structuredClone(result)).toEqual(result)
    expect(JSON.stringify(result)).not.toMatch(
      /patientId|installationId|screeningSessionId|locationId|createdBy|updatedBy|source/u
    )
  })
})
