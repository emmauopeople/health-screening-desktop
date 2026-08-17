import { describe, expect, it } from 'vitest'

import { parseInsertScreeningVitalsDraftInput } from '@main/database/repositories/screening-vitals-draft/screening-vitals-draft-validation'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

const draftId = '11111111-1111-4111-8111-111111111111'
const encounterId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const readingId = '44444444-4444-4444-8444-444444444444'
const now = '2026-08-17T12:00:00.000Z'

describe('screening Vitals draft repository validation', () => {
  it('accepts the positive boundary values and rejects values outside each field range', () => {
    expect(
      parseInsertScreeningVitalsDraftInput(createInput({ systolic: 1, diastolic: 1, pulse: 1 }))
        .readings[0]
    ).toMatchObject({ systolic: 1, diastolic: 1, pulse: 1 })
    expect(
      parseInsertScreeningVitalsDraftInput(
        createInput({ systolic: 300, diastolic: 120, pulse: 300 })
      ).readings[0]
    ).toMatchObject({ systolic: 300, diastolic: 120, pulse: 300 })

    for (const values of [
      { systolic: 301 },
      { diastolic: 121 },
      { pulse: 301 },
      { systolic: 0 },
      { diastolic: 0 },
      { pulse: 0 },
      { systolic: -1 },
      { diastolic: -1 },
      { pulse: -1 },
      { systolic: 1.5 },
      { diastolic: 80.5 },
      { pulse: 70.5 }
    ]) {
      expect(() => parseInsertScreeningVitalsDraftInput(createInput(values))).toThrow()
    }
  })

  it('keeps all three reading fields nullable for incomplete drafts', () => {
    expect(
      parseInsertScreeningVitalsDraftInput(
        createInput({ systolic: null, diastolic: null, pulse: null })
      ).readings[0]
    ).toMatchObject({ systolic: null, diastolic: null, pulse: null })
  })
})

function createInput(values: {
  readonly systolic?: number | null
  readonly diastolic?: number | null
  readonly pulse?: number | null
}): Parameters<typeof parseInsertScreeningVitalsDraftInput>[0] {
  return {
    id: parseEntityId(draftId),
    encounterId: parseEntityId(encounterId),
    status: 'DRAFT',
    weightKg: null,
    waistCm: null,
    notes: null,
    createdBy: parseEntityId(userId),
    createdAt: parseUtcTimestamp(now),
    readings: [
      {
        id: parseEntityId(readingId),
        sequenceNumber: 1,
        systolic: values.systolic ?? null,
        diastolic: values.diastolic ?? null,
        pulse: values.pulse ?? null,
        measurementSite: null,
        patientPosition: null,
        measurementTime: null
      }
    ]
  }
}
