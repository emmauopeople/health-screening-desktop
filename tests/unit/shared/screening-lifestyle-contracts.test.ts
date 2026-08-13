import { describe, expect, it } from 'vitest'

import {
  ipcChannels,
  screeningLifestyleAlcoholBaselineRequestSchema,
  screeningLifestyleCompleteRequestSchema,
  screeningLifestyleGetWorkspaceRequestSchema,
  screeningLifestyleSaveDraftRequestSchema,
  screeningLifestyleSaveTobaccoBaselineRequestSchema,
  screeningLifestyleSaveWorkBaselineRequestSchema
} from '@shared/ipc'

const encounterId = '33333333-3333-4333-8333-333333333333'

const draftRequest = {
  encounterId,
  expectedVersion: null,
  alcohol: null,
  tobacco: null,
  physicalActivity: null,
  work: null,
  otherActivities: []
}

describe('screening Lifestyle IPC contracts', () => {
  it('defines only the six namespaced Lifestyle channels', () => {
    expect(Object.values(ipcChannels.screeningEncounters.lifestyle)).toHaveLength(6)
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
    expect(screeningLifestyleSaveDraftRequestSchema.safeParse(draftRequest).success).toBe(true)
    expect(
      screeningLifestyleCompleteRequestSchema.safeParse({
        ...draftRequest,
        alcoholBaselineReviewConfirmedVersionId: null,
        tobaccoBaselineReviewConfirmedVersionId: null
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
  })
})
