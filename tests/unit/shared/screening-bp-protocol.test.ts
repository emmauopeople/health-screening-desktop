import { describe, expect, it } from 'vitest'

import {
  SCREENING_BP_PROTOCOL_V1,
  evaluateScreeningBloodPressure,
  getScreeningBpInstruction
} from '@shared/screening-bp-protocol'

describe('screening blood-pressure protocol', () => {
  it('allows a routine single reading below the repeat threshold', () => {
    expect(evaluateScreeningBloodPressure([reading(1, 120, 80, 70)])).toMatchObject({
      nextAction: 'ROUTINE',
      summarySystolic: 120,
      summaryDiastolic: 80,
      summaryPulse: 70
    })
  })

  it.each([
    [140, 80],
    [120, 90],
    [200, 105]
  ])('requires a second reading for an initial %i/%i', (systolic, diastolic) => {
    const decision = evaluateScreeningBloodPressure([reading(1, systolic, diastolic, 70)])
    expect(decision?.nextAction).toBe('REPEAT_REQUIRED')
    expect(decision === null ? '' : getScreeningBpInstruction(decision)).toContain(
      `Wait at least ${SCREENING_BP_PROTOCOL_V1.configuration.repeatIntervalMinutes} minute`
    )
  })

  it('uses the mean of the last two readings for a non-urgent referral', () => {
    expect(
      evaluateScreeningBloodPressure([reading(1, 160, 100, 80), reading(2, 150, 90, 70)])
    ).toEqual(
      expect.objectContaining({
        nextAction: 'REFER',
        summarySystolic: 155,
        summaryDiastolic: 95,
        summaryPulse: 75,
        evidence: expect.objectContaining({
          calculationMethod: 'MEAN_OF_LAST_TWO',
          readingSequenceNumbers: [1, 2]
        })
      })
    )
  })

  it('classifies a repeated 200/105 reading as an urgent referral', () => {
    const decision = evaluateScreeningBloodPressure([
      reading(1, 200, 105, 80),
      reading(2, 200, 105, 78)
    ])
    expect(decision?.nextAction).toBe('URGENT_REFERRAL')
    expect(decision === null ? '' : getScreeningBpInstruction(decision)).toContain(
      'prompt medical evaluation'
    )
  })

  it('uses only the last two readings when more rechecks are recorded', () => {
    expect(
      evaluateScreeningBloodPressure([
        reading(1, 200, 105, 90),
        reading(2, 150, 90, 80),
        reading(3, 130, 80, 70)
      ])
    ).toMatchObject({
      nextAction: 'REFER',
      summarySystolic: 140,
      summaryDiastolic: 85,
      summaryPulse: 75
    })
  })
})

function reading(
  sequenceNumber: number,
  systolic: number,
  diastolic: number,
  pulse: number
): { sequenceNumber: number; systolic: number; diastolic: number; pulse: number } {
  return { sequenceNumber, systolic, diastolic, pulse }
}
