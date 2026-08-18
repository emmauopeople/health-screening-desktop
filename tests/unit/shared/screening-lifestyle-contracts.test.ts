import { describe, expect, it } from 'vitest'

import {
  ipcChannels,
  createIpcSuccess,
  createScreeningLifestyleIpcFailure,
  screeningLifestyleAlcoholBaselineRequestSchema,
  screeningLifestyleCompleteRequestSchema,
  screeningLifestyleCompleteResultSchema,
  screeningLifestyleFailureSchema,
  screeningLifestyleGetWorkspaceRequestSchema,
  screeningLifestyleReopenRequestSchema,
  screeningLifestyleReopenResultSchema,
  screeningLifestyleSaveDraftRequestSchema,
  screeningLifestyleGetWorkspaceResultSchema,
  screeningLifestyleSaveAlcoholBaselineResultSchema,
  screeningLifestyleSaveDraftResultSchema,
  screeningLifestyleSaveTobaccoBaselineResultSchema,
  screeningLifestyleSaveWorkBaselineResultSchema,
  screeningLifestyleSaveTobaccoBaselineRequestSchema,
  screeningLifestyleSaveWorkBaselineRequestSchema
} from '@shared/ipc'

import { lifestyleEncounterId, validLifestyleWorkspace } from './screening-lifestyle-test-fixtures'

const encounterId = lifestyleEncounterId

const draftRequest = {
  encounterId,
  expectedVersion: null,
  alcohol: null,
  tobacco: null,
  physicalActivity: null,
  work: null,
  otherActivityResponse: null,
  otherActivities: []
}

describe('screening Lifestyle IPC contracts', () => {
  it('defines only the seven namespaced Lifestyle channels', () => {
    expect(Object.values(ipcChannels.screeningEncounters.lifestyle)).toHaveLength(7)
    expect(
      Object.values(ipcChannels.screeningEncounters.lifestyle).every((channel) =>
        channel.startsWith('health-screening:screening-encounters:lifestyle:')
      )
    ).toBe(true)
  })

  it('accepts strict public use-case requests', () => {
    expect(screeningLifestyleGetWorkspaceRequestSchema.safeParse({ encounterId }).success).toBe(
      true
    )
    expect(
      screeningLifestyleReopenRequestSchema.safeParse({ encounterId, expectedVersion: 4 }).success
    ).toBe(true)
    expect(screeningLifestyleSaveDraftRequestSchema.safeParse(draftRequest).success).toBe(true)
    expect(
      screeningLifestyleCompleteRequestSchema.safeParse({
        ...draftRequest,
        alcoholBaselineReviewConfirmedVersionId: null,
        tobaccoBaselineReviewConfirmedVersionId: null
      }).success
    ).toBe(true)
    expect(
      screeningLifestyleSaveDraftRequestSchema.safeParse({
        ...draftRequest,
        otherActivityResponse: 'YES',
        otherActivities: [
          {
            id: null,
            sequenceNumber: 1,
            category: 'SPORT',
            description: null,
            daysInPastSevenDays: 2,
            averageMinutesPerDay: 30,
            intensity: 'MODERATE'
          }
        ]
      }).success
    ).toBe(true)
    expect(
      screeningLifestyleAlcoholBaselineRequestSchema.safeParse({
        encounterId,
        expectedBaselineVersion: null,
        expectedDraftVersion: null,
        status: 'CURRENT',
        everConsumed: 'YES',
        consumedPast12Months: 'YES',
        commonBeverageTypes: [],
        otherBeverageDescription: null
      }).success
    ).toBe(true)
    expect(
      screeningLifestyleSaveTobaccoBaselineRequestSchema.safeParse({
        encounterId,
        expectedBaselineVersion: null,
        expectedDraftVersion: null,
        status: 'NEVER',
        everRegularlyUsed: 'NO',
        formerUseApproximateStopDate: null,
        currentUseFrequency: 'NOT_AT_ALL',
        productTypes: [],
        otherProductDescription: null
      }).success
    ).toBe(true)
    expect(
      screeningLifestyleSaveWorkBaselineRequestSchema.safeParse({
        encounterId,
        expectedBaselineVersion: null,
        expectedDraftVersion: null,
        status: 'EMPLOYED',
        occupationJobTitle: null,
        usualPhysicalDemand: null,
        typicalWorkdaysPerWeek: null,
        typicalHoursPerWorkday: null,
        shiftPattern: null,
        description: null
      }).success
    ).toBe(true)
  })

  it('rejects authority fields, extra keys, accessors, and unsafe prototypes', () => {
    for (const value of [
      { ...draftRequest, actorId: encounterId },
      { ...draftRequest, patientId: encounterId },
      { ...draftRequest, installationId: encounterId },
      { ...draftRequest, status: 'COMPLETE' },
      { ...draftRequest, updatedAt: '2026-08-06T12:00:00.000Z' }
    ]) {
      expect(screeningLifestyleSaveDraftRequestSchema.safeParse(value).success).toBe(false)
    }

    const accessor = { ...draftRequest }
    Object.defineProperty(accessor, 'encounterId', {
      enumerable: true,
      get: () => encounterId
    })
    const hostile = Object.assign(Object.create({ trusted: true }), draftRequest)
    expect(screeningLifestyleSaveDraftRequestSchema.safeParse(accessor).success).toBe(false)
    expect(screeningLifestyleSaveDraftRequestSchema.safeParse(hostile).success).toBe(false)
    expect(
      screeningLifestyleReopenRequestSchema.safeParse({
        encounterId,
        expectedVersion: 4,
        patientId: encounterId
      }).success
    ).toBe(false)
    expect(
      screeningLifestyleReopenRequestSchema.safeParse({ encounterId, expectedVersion: null })
        .success
    ).toBe(false)
  })

  it('accepts every public success result and every controlled status', () => {
    const loaded = createIpcSuccess({
      status: 'LOADED' as const,
      workspace: validLifestyleWorkspace
    })
    const saved = createIpcSuccess({ status: 'SAVED' as const, workspace: validLifestyleWorkspace })
    const completed = createIpcSuccess({
      status: 'COMPLETED' as const,
      workspace: validLifestyleWorkspace
    })
    const reopened = createIpcSuccess({
      status: 'REOPENED' as const,
      workspace: validLifestyleWorkspace
    })

    expect(screeningLifestyleGetWorkspaceResultSchema.safeParse(loaded).success).toBe(true)
    expect(screeningLifestyleSaveAlcoholBaselineResultSchema.safeParse(saved).success).toBe(true)
    expect(screeningLifestyleSaveTobaccoBaselineResultSchema.safeParse(saved).success).toBe(true)
    expect(screeningLifestyleSaveWorkBaselineResultSchema.safeParse(saved).success).toBe(true)
    expect(screeningLifestyleSaveDraftResultSchema.safeParse(saved).success).toBe(true)
    expect(screeningLifestyleCompleteResultSchema.safeParse(completed).success).toBe(true)
    expect(screeningLifestyleReopenResultSchema.safeParse(reopened).success).toBe(true)

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
        screeningLifestyleGetWorkspaceResultSchema.safeParse(createIpcSuccess({ status })).success
      ).toBe(true)
    }
  })

  it('accepts only approved sanitized IPC failures', () => {
    for (const code of ['IPC_FORBIDDEN', 'IPC_UNAVAILABLE', 'INTERNAL_ERROR'] as const) {
      const failure = createScreeningLifestyleIpcFailure(code)
      expect(screeningLifestyleFailureSchema.safeParse(failure).success).toBe(true)
      expect(JSON.stringify(failure)).not.toMatch(/secret|SELECT|C:\\|clinical/u)
    }
    expect(
      screeningLifestyleFailureSchema.safeParse({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'stack C:\\secret\\db.sqlite' }
      }).success
    ).toBe(false)
  })

  it('rejects persistence attribution at every public DTO level', () => {
    const workspaceResult = (workspace: unknown): boolean =>
      screeningLifestyleGetWorkspaceResultSchema.safeParse(
        createIpcSuccess({ status: 'LOADED' as const, workspace })
      ).success
    const invalidValues = [
      { ...validLifestyleWorkspace, patientId: encounterId },
      {
        ...validLifestyleWorkspace,
        draft: { ...validLifestyleWorkspace.draft, patientId: encounterId }
      },
      {
        ...validLifestyleWorkspace,
        activeAlcoholBaseline: {
          ...validLifestyleWorkspace.activeAlcoholBaseline,
          installationId: encounterId
        }
      },
      {
        ...validLifestyleWorkspace,
        draft: {
          ...validLifestyleWorkspace.draft,
          alcohol: { ...validLifestyleWorkspace.draft?.alcohol, patientId: encounterId }
        }
      },
      {
        ...validLifestyleWorkspace,
        draft: {
          ...validLifestyleWorkspace.draft,
          tobacco: {
            ...validLifestyleWorkspace.draft?.tobacco,
            products: [
              { ...validLifestyleWorkspace.draft?.tobacco?.products[0], parentId: encounterId }
            ]
          }
        }
      },
      {
        ...validLifestyleWorkspace,
        draft: {
          ...validLifestyleWorkspace.draft,
          physicalActivity: {
            ...validLifestyleWorkspace.draft?.physicalActivity,
            activities: [
              {
                ...validLifestyleWorkspace.draft?.physicalActivity?.activities[0],
                screeningSessionId: encounterId
              }
            ]
          }
        }
      },
      {
        ...validLifestyleWorkspace,
        draft: {
          ...validLifestyleWorkspace.draft,
          work: { ...validLifestyleWorkspace.draft?.work, locationId: encounterId }
        }
      },
      {
        ...validLifestyleWorkspace,
        draft: {
          ...validLifestyleWorkspace.draft,
          otherActivities: [
            { ...validLifestyleWorkspace.draft?.otherActivities[0], updatedBy: encounterId }
          ]
        }
      }
    ]

    for (const invalid of invalidValues) expect(workspaceResult(invalid)).toBe(false)
  })

  it('rejects malformed nested values and unsafe response objects', () => {
    const result = createIpcSuccess({
      status: 'LOADED' as const,
      workspace: validLifestyleWorkspace
    })
    const malformedValues = [
      { ...validLifestyleWorkspace, encounterId: 'not-an-id' },
      {
        ...validLifestyleWorkspace,
        draft: { ...validLifestyleWorkspace.draft, periodStart: '2026/02/30' }
      },
      {
        ...validLifestyleWorkspace,
        draft: { ...validLifestyleWorkspace.draft, status: 'COMPLETE_NOW' }
      },
      {
        ...validLifestyleWorkspace,
        activeAlcoholBaseline: {
          ...validLifestyleWorkspace.activeAlcoholBaseline,
          updatedAt: 'not-a-timestamp'
        }
      }
    ]
    for (const workspace of malformedValues) {
      expect(
        screeningLifestyleGetWorkspaceResultSchema.safeParse(
          createIpcSuccess({ status: 'LOADED' as const, workspace })
        ).success
      ).toBe(false)
    }

    const accessor = { ...result }
    Object.defineProperty(accessor, 'data', { enumerable: true, get: () => result.data })
    const customPrototype = Object.setPrototypeOf({ ...result }, { unsafe: true })
    const cyclic: Record<string, unknown> = { ...result }
    cyclic.cycle = cyclic
    const symbolBearing = Object.defineProperty({ ...result }, Symbol('secret'), {
      enumerable: true,
      value: true
    })
    for (const unsafe of [accessor, customPrototype, cyclic, symbolBearing]) {
      expect(screeningLifestyleGetWorkspaceResultSchema.safeParse(unsafe).success).toBe(false)
    }
  })
})
