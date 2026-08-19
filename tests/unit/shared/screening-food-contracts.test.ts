import { describe, expect, it } from 'vitest'

import {
  createIpcSuccess,
  createScreeningFoodIpcFailure,
  ipcChannels,
  screeningFoodFailureSchema,
  screeningFoodFrequencyCodeSchema,
  screeningFoodGetWorkspaceRequestSchema,
  screeningFoodGetWorkspaceResultSchema,
  screeningFoodNameSchema,
  screeningFoodPreparationNoteSchema,
  screeningFoodResponseSchema,
  screeningFoodSaveDraftRequestSchema,
  screeningFoodSaveDraftResultSchema
} from '@shared/ipc'

import {
  foodDraftRowId,
  foodEncounterId,
  validFoodSaveDraftRequest,
  validFoodWorkspace
} from './screening-food-test-fixtures'

const validFoodDraft = validFoodWorkspace.draft!
const validFoodDraftRow = validFoodDraft.rows[0]!

describe('screening Food IPC contracts', () => {
  it('defines only the two namespaced Food channels', () => {
    expect(Object.values(ipcChannels.screeningEncounters.food)).toEqual([
      'health-screening:screening-encounters:food:get-workspace',
      'health-screening:screening-encounters:food:save-draft'
    ])
    expect(
      Object.values(ipcChannels.screeningEncounters.food).every((channel) =>
        channel.startsWith('health-screening:screening-encounters:food:')
      )
    ).toBe(true)
  })

  it('accepts strict get and save draft requests without authority fields', () => {
    expect(screeningFoodGetWorkspaceRequestSchema.parse({ encounterId: foodEncounterId })).toEqual({
      encounterId: foodEncounterId
    })
    expect(screeningFoodSaveDraftRequestSchema.parse(validFoodSaveDraftRequest)).toEqual(
      validFoodSaveDraftRequest
    )
    expect(
      screeningFoodSaveDraftRequestSchema.parse({
        ...validFoodSaveDraftRequest,
        expectedVersion: null,
        foodResponse: null,
        rows: [
          {
            id: null,
            sequenceNumber: 1,
            catalogCode: null,
            foodName: '  Custom   food  ',
            frequencyCode: null,
            preparationNote: '   '
          }
        ]
      })
    ).toMatchObject({
      expectedVersion: null,
      foodResponse: null,
      rows: [{ catalogCode: null, frequencyCode: null, preparationNote: '   ' }]
    })
  })

  it('rejects unknown keys and renderer-provided authority or attribution', () => {
    const invalidRequests = [
      { ...validFoodSaveDraftRequest, patientId: foodEncounterId },
      { ...validFoodSaveDraftRequest, screeningSessionId: foodEncounterId },
      { ...validFoodSaveDraftRequest, locationId: foodEncounterId },
      { ...validFoodSaveDraftRequest, installationId: foodEncounterId },
      { ...validFoodSaveDraftRequest, periodStart: '2026-08-12' },
      { ...validFoodSaveDraftRequest, periodEnd: '2026-08-18' },
      { ...validFoodSaveDraftRequest, actorId: foodEncounterId },
      { ...validFoodSaveDraftRequest, createdAt: '2026-08-18T12:00:00.000Z' },
      { ...validFoodSaveDraftRequest, updatedAt: '2026-08-18T12:00:00.000Z' },
      {
        ...validFoodSaveDraftRequest,
        rows: [{ ...validFoodSaveDraftRequest.rows[0], source: 'PATIENT_REPORTED' }]
      }
    ]

    for (const request of invalidRequests) {
      expect(screeningFoodSaveDraftRequestSchema.safeParse(request).success).toBe(false)
    }
  })

  it('accepts only the approved nullable response and frequency vocabularies', () => {
    for (const response of ['REPORTED', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER'] as const) {
      expect(screeningFoodResponseSchema.parse(response)).toBe(response)
      expect(
        screeningFoodSaveDraftRequestSchema.safeParse({
          ...validFoodSaveDraftRequest,
          foodResponse: response
        }).success
      ).toBe(true)
    }
    for (const frequencyCode of ['1_DAY', '2_TO_3_DAYS', '4_TO_6_DAYS', 'EVERY_DAY'] as const) {
      expect(screeningFoodFrequencyCodeSchema.parse(frequencyCode)).toBe(frequencyCode)
      expect(
        screeningFoodSaveDraftRequestSchema.safeParse({
          ...validFoodSaveDraftRequest,
          rows: [{ ...validFoodSaveDraftRequest.rows[0], frequencyCode }]
        }).success
      ).toBe(true)
    }
    for (const invalid of ['YES', 'NO', 'NO_FOOD_REPORTED', 'OTHER', 'EVERY_WEEK']) {
      expect(screeningFoodResponseSchema.safeParse(invalid).success).toBe(false)
      expect(screeningFoodFrequencyCodeSchema.safeParse(invalid).success).toBe(false)
    }
  })

  it('validates row identity, sequence, catalog, text, and nullable draft fields', () => {
    const invalidRows = [
      { ...validFoodSaveDraftRequest.rows[0], id: 'bad-id' },
      { ...validFoodSaveDraftRequest.rows[0], sequenceNumber: 0 },
      { ...validFoodSaveDraftRequest.rows[0], catalogCode: 'rice' },
      { ...validFoodSaveDraftRequest.rows[0], foodName: '' },
      { ...validFoodSaveDraftRequest.rows[0], foodName: '   ' },
      { ...validFoodSaveDraftRequest.rows[0], foodName: 'x'.repeat(101) },
      { ...validFoodSaveDraftRequest.rows[0], foodName: 'Rice\u0001' },
      { ...validFoodSaveDraftRequest.rows[0], preparationNote: 'x'.repeat(201) },
      { ...validFoodSaveDraftRequest.rows[0], preparationNote: 'Boiled\u0001' },
      { ...validFoodSaveDraftRequest.rows[0], frequencyCode: '7_DAYS' }
    ]

    for (const row of invalidRows) {
      expect(
        screeningFoodSaveDraftRequestSchema.safeParse({
          ...validFoodSaveDraftRequest,
          rows: [row]
        }).success
      ).toBe(false)
    }
    expect(screeningFoodNameSchema.safeParse(' Rice ').success).toBe(true)
    expect(screeningFoodPreparationNoteSchema.safeParse('   ').success).toBe(true)
  })

  it('rejects accessors, symbols, cycles, and unsafe prototypes before parsing', () => {
    let getterInvoked = false
    const accessor = { ...validFoodSaveDraftRequest }
    Object.defineProperty(accessor, 'encounterId', {
      enumerable: true,
      get() {
        getterInvoked = true
        return foodEncounterId
      }
    })
    const symbolBearing = Object.defineProperty({ ...validFoodSaveDraftRequest }, Symbol('role'), {
      enumerable: true,
      value: 'LOCAL_ADMIN'
    })
    const cyclic: Record<string, unknown> = { ...validFoodSaveDraftRequest }
    cyclic['self'] = cyclic
    const customPrototype = Object.assign(
      Object.create({ trusted: true }),
      validFoodSaveDraftRequest
    )
    const descriptorTrap = new Proxy(
      { ...validFoodSaveDraftRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\food')
        }
      }
    )

    for (const value of [accessor, symbolBearing, cyclic, customPrototype, descriptorTrap]) {
      expect(screeningFoodSaveDraftRequestSchema.safeParse(value).success).toBe(false)
    }
    expect(getterInvoked).toBe(false)
  })

  it('accepts every public success result and every controlled status', () => {
    expect(
      screeningFoodGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({ status: 'LOADED' as const, workspace: validFoodWorkspace })
      ).success
    ).toBe(true)
    expect(
      screeningFoodSaveDraftResultSchema.safeParse(
        createIpcSuccess({ status: 'SAVED' as const, workspace: validFoodWorkspace })
      ).success
    ).toBe(true)

    for (const status of [
      'AUTHENTICATION_REQUIRED',
      'FORBIDDEN',
      'VALIDATION_FAILED',
      'LOCATION_NOT_CONFIGURED',
      'LOCATION_NOT_FOUND',
      'LOCATION_INACTIVE',
      'ENCOUNTER_NOT_FOUND',
      'ENCOUNTER_NOT_EDITABLE',
      'SESSION_NOT_FOUND',
      'SESSION_CLOSED',
      'SESSION_NOT_CURRENT',
      'VERSION_CONFLICT',
      'UNAVAILABLE'
    ] as const) {
      expect(
        screeningFoodGetWorkspaceResultSchema.safeParse(createIpcSuccess({ status })).success
      ).toBe(true)
      expect(
        screeningFoodSaveDraftResultSchema.safeParse(createIpcSuccess({ status })).success
      ).toBe(true)
    }
  })

  it('rejects authority fields and malformed nested public DTOs', () => {
    const loaded = (workspace: unknown): boolean =>
      screeningFoodGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({ status: 'LOADED' as const, workspace })
      ).success

    expect(loaded({ ...validFoodWorkspace, patientId: foodEncounterId })).toBe(false)
    expect(
      loaded({
        ...validFoodWorkspace,
        draft: { ...validFoodWorkspace.draft, patientId: foodEncounterId }
      })
    ).toBe(false)
    expect(
      loaded({
        ...validFoodWorkspace,
        draft: {
          ...validFoodDraft,
          rows: [{ ...validFoodDraftRow, draftId: foodEncounterId }]
        }
      })
    ).toBe(false)
    expect(
      loaded({
        ...validFoodWorkspace,
        catalogItems: [{ ...validFoodWorkspace.catalogItems[0], isActive: true }]
      })
    ).toBe(false)
    expect(
      loaded({
        ...validFoodWorkspace,
        recentFoods: [{ ...validFoodWorkspace.recentFoods[0], frequencyCode: 'EVERY_DAY' }]
      })
    ).toBe(false)
    expect(
      loaded({
        ...validFoodWorkspace,
        draft: {
          ...validFoodDraft,
          rows: [{ ...validFoodDraftRow, preparationNote: '' }]
        }
      })
    ).toBe(false)
  })

  it('accepts only approved sanitized IPC failures', () => {
    for (const code of ['IPC_FORBIDDEN', 'IPC_UNAVAILABLE', 'INTERNAL_ERROR'] as const) {
      const failure = createScreeningFoodIpcFailure(code)
      expect(screeningFoodFailureSchema.safeParse(failure).success).toBe(true)
      expect(JSON.stringify(failure)).not.toMatch(/secret|SELECT|C:\\|Rice|Boiled/u)
    }
    expect(
      screeningFoodFailureSchema.safeParse({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'stack C:\\secret\\db.sqlite' }
      }).success
    ).toBe(false)
  })

  it('keeps row IDs renderer-controlled only as row identity, not authority', () => {
    expect(
      screeningFoodSaveDraftRequestSchema.safeParse({
        ...validFoodSaveDraftRequest,
        rows: [{ ...validFoodSaveDraftRequest.rows[0], id: foodDraftRowId }]
      }).success
    ).toBe(true)
  })
})
