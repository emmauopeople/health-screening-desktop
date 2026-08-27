import { describe, expect, it } from 'vitest'

import { referralRecordFollowupRequestSchema } from '@shared/ipc'

const validRequest = {
  referralId: '11111111-1111-4111-8111-111111111111',
  expectedVersion: 1,
  contactDate: '2026-08-27',
  contactMethod: 'PHONE',
  informationSource: 'PATIENT',
  providerSeen: true,
  facilityName: null,
  dateSeen: null,
  reportedOutcome: 'Provider started treatment.',
  reportedMedicationsOrAdvice: null,
  nextAction: null,
  nextFollowupDate: null,
  sourceType: 'DIRECT_FOLLOWUP',
  treatmentActions: ['NEW_MEDICATION'],
  medicationChanges: [
    {
      changeType: 'NEW_MEDICATION',
      medicationName: 'Amlodipine',
      dosage: '5 mg',
      frequency: 'Once daily'
    }
  ],
  newStatus: 'SEEN',
  statusReason: null
} as const

describe('referral follow-up treatment action contract', () => {
  it('accepts structured medication data only when the provider was seen', () => {
    expect(referralRecordFollowupRequestSchema.safeParse(validRequest).success).toBe(true)
    expect(
      referralRecordFollowupRequestSchema.safeParse({ ...validRequest, providerSeen: false })
        .success
    ).toBe(false)
  })

  it('requires medication rows and their selected action to match', () => {
    expect(
      referralRecordFollowupRequestSchema.safeParse({ ...validRequest, medicationChanges: [] })
        .success
    ).toBe(false)
    expect(
      referralRecordFollowupRequestSchema.safeParse({ ...validRequest, treatmentActions: [] })
        .success
    ).toBe(false)
  })

  it('rejects duplicate actions, blank medication names, and unapproved fields', () => {
    expect(
      referralRecordFollowupRequestSchema.safeParse({
        ...validRequest,
        treatmentActions: ['NEW_MEDICATION', 'NEW_MEDICATION']
      }).success
    ).toBe(false)
    expect(
      referralRecordFollowupRequestSchema.safeParse({
        ...validRequest,
        medicationChanges: [{ ...validRequest.medicationChanges[0], medicationName: ' ' }]
      }).success
    ).toBe(false)
    expect(
      referralRecordFollowupRequestSchema.safeParse({ ...validRequest, route: 'ORAL' }).success
    ).toBe(false)
  })
})
