import { describe, expect, it } from 'vitest'

import {
  calculateLifestyleWeeklyMinutes,
  parseCompleteLifestyleAlcoholWeeklyInput,
  parseLifestyleAlcoholBaselineInput,
  parseLifestyleDraftOwnershipInput,
  parseLifestyleDraftUpdateInput
} from '@main/database'
import type { LifestyleDate } from '@main/database'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

const id = parseEntityId('11111111-1111-4111-8111-111111111111')
const timestamp = parseUtcTimestamp('2026-07-29T12:00:00.000Z')

describe('Lifestyle persistence validation', () => {
  it('keeps explicit weekly states distinct and calculates minutes from raw inputs', () => {
    expect(calculateLifestyleWeeklyMinutes(3, 20)).toBe(60)
    expect(() => calculateLifestyleWeeklyMinutes(0, 20)).toThrow()
  })

  it('rejects invalid controlled codes and renderer-owned timestamps', () => {
    expect(() =>
      parseLifestyleAlcoholBaselineInput({
        id,
        patientId: id,
        installationId: id,
        expectedCurrentVersion: null,
        status: 'INVALID' as never,
        everConsumed: 'YES',
        consumedPast12Months: 'YES',
        commonBeverageTypes: [],
        otherBeverageDescription: null,
        actorId: id,
        occurredAt: timestamp
      })
    ).toThrow()

    expect(() =>
      parseLifestyleDraftUpdateInput({
        id,
        expectedRowVersion: 1,
        status: 'DRAFT',
        alcoholBaselineVersionId: null,
        tobaccoBaselineVersionId: null,
        workBaselineVersionId: null,
        actorId: id,
        occurredAt: timestamp,
        createdAt: timestamp,
        alcohol: null,
        tobacco: null,
        physicalActivity: null,
        work: null,
        otherActivities: []
      } as never)
    ).toThrow()
  })

  it('strictly validates calendar dates without normalization', () => {
    const valid = {
      id,
      encounterId: id,
      patientId: id,
      screeningSessionId: id,
      locationId: id,
      installationId: id,
      periodStart: '2028-02-29' as LifestyleDate,
      periodEnd: '2028-03-01' as LifestyleDate,
      actorId: id,
      occurredAt: timestamp
    }
    expect(parseLifestyleDraftOwnershipInput(valid).periodStart).toBe('2028-02-29')
    for (const periodStart of [
      '2026-02-30',
      '2025-02-29',
      '2026-00-10',
      '2026-13-10',
      '2026-01-00'
    ])
      expect(() =>
        parseLifestyleDraftOwnershipInput({ ...valid, periodStart: periodStart as LifestyleDate })
      ).toThrow()
    expect(() =>
      parseLifestyleDraftOwnershipInput({
        ...valid,
        periodStart: '2028-03-02' as LifestyleDate,
        periodEnd: '2028-03-01' as LifestyleDate
      })
    ).toThrow()
  })

  it('rejects contradictory alcohol weekly branches', () => {
    const base = {
      id,
      expectedRowVersion: 1,
      status: 'DRAFT',
      alcoholBaselineVersionId: null,
      tobaccoBaselineVersionId: null,
      workBaselineVersionId: null,
      actorId: id,
      occurredAt: timestamp,
      tobacco: null,
      physicalActivity: null,
      work: null,
      otherActivities: []
    } as const
    const alcohol = {
      id,
      weeklyResponse: 'YES',
      drinkingDays: 2,
      totalStandardizedDrinks: 3,
      largestOneDayAmount: 2,
      daysAtLargestAmount: 1,
      commonBeverageTypes: ['BEER'],
      otherBeverageDescription: null
    } as const
    expect(parseLifestyleDraftUpdateInput({ ...base, alcohol }).alcohol?.weeklyResponse).toBe('YES')
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: null,
          totalStandardizedDrinks: null,
          largestOneDayAmount: null,
          daysAtLargestAmount: null
        }
      }).alcohol
    ).toMatchObject({
      weeklyResponse: 'YES',
      drinkingDays: null,
      totalStandardizedDrinks: null,
      largestOneDayAmount: null,
      daysAtLargestAmount: null
    })
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: 2,
          totalStandardizedDrinks: null,
          largestOneDayAmount: null,
          daysAtLargestAmount: null
        }
      }).alcohol?.drinkingDays
    ).toBe(2)
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: 2,
          totalStandardizedDrinks: 3,
          largestOneDayAmount: null,
          daysAtLargestAmount: null
        }
      }).alcohol?.totalStandardizedDrinks
    ).toBe(3)
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          commonBeverageTypes: ['OTHER'],
          otherBeverageDescription: null
        }
      }).alcohol?.commonBeverageTypes
    ).toEqual(['OTHER'])
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, weeklyResponse: 'NO', drinkingDays: 1 }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, weeklyResponse: 'YES', drinkingDays: 0 }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, weeklyResponse: 'YES', totalStandardizedDrinks: 0 }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, weeklyResponse: 'YES', largestOneDayAmount: 0 }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, largestOneDayAmount: 4 }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, commonBeverageTypes: ['BEER'], otherBeverageDescription: 'hidden' }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...alcohol, weeklyResponse: 'UNKNOWN', drinkingDays: 0 }
      })
    ).toThrow()
    for (const response of ['NO', 'UNKNOWN', 'DECLINED', null] as const) {
      const parsed = parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          weeklyResponse: response,
          drinkingDays: null,
          totalStandardizedDrinks: null,
          largestOneDayAmount: null,
          daysAtLargestAmount: null,
          commonBeverageTypes: [],
          otherBeverageDescription: null
        }
      }).alcohol
      expect(parsed?.weeklyResponse).toBe(response)
      expect(parsed?.drinkingDays).toBeNull()
    }
  })

  it('separates draft Alcohol YES persistence from completion validation', () => {
    const incompleteYes = {
      id,
      weeklyResponse: 'YES',
      drinkingDays: 2,
      totalStandardizedDrinks: null,
      largestOneDayAmount: null,
      daysAtLargestAmount: null,
      commonBeverageTypes: ['OTHER'],
      otherBeverageDescription: null
    } as const

    expect(parseCompleteLifestyleAlcoholWeeklyInput).toBeDefined()
    expect(() => parseCompleteLifestyleAlcoholWeeklyInput(incompleteYes)).toThrow()
    expect(() =>
      parseCompleteLifestyleAlcoholWeeklyInput({
        ...incompleteYes,
        totalStandardizedDrinks: 3,
        largestOneDayAmount: 2,
        daysAtLargestAmount: 1
      })
    ).toThrow()
    expect(
      parseCompleteLifestyleAlcoholWeeklyInput({
        ...incompleteYes,
        totalStandardizedDrinks: 3,
        largestOneDayAmount: 2,
        daysAtLargestAmount: 1,
        otherBeverageDescription: 'Local beverage'
      }).weeklyResponse
    ).toBe('YES')
  })
})
