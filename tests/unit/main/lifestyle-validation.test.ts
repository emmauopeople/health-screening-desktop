import { describe, expect, it } from 'vitest'

import {
  calculateLifestyleWeeklyMinutes,
  parseCompleteLifestyleAlcoholWeeklyInput,
  parseCompleteLifestyleOtherActivityInput,
  parseCompleteLifestylePhysicalActivityWeeklyInput,
  parseCompleteLifestyleTobaccoWeeklyInput,
  parseLifestyleAlcoholBaselineInput,
  parseLifestyleDraftOwnershipInput,
  parseLifestyleDraftUpdateInput
} from '@main/database'
import type {
  LifestyleActivityInput,
  LifestyleDate,
  LifestyleDraftUpdateInput,
  LifestyleTobaccoProductInput
} from '@main/database'
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
      otherActivityResponse: null,
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
        alcohol: {
          ...alcohol,
          drinkingDays: 4,
          totalStandardizedDrinks: 3,
          largestOneDayAmount: 3,
          daysAtLargestAmount: 2
        }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: 2,
          totalStandardizedDrinks: 5,
          largestOneDayAmount: 2,
          daysAtLargestAmount: 2
        }
      })
    ).toThrow()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: 2,
          totalStandardizedDrinks: 4,
          largestOneDayAmount: 2,
          daysAtLargestAmount: 2
        }
      }).alcohol?.totalStandardizedDrinks
    ).toBe(4)
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: 3,
          totalStandardizedDrinks: 4,
          largestOneDayAmount: 2,
          daysAtLargestAmount: 2
        }
      })
    ).toThrow()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...alcohol,
          drinkingDays: 3,
          totalStandardizedDrinks: 5,
          largestOneDayAmount: 2,
          daysAtLargestAmount: 2
        }
      }).alcohol?.totalStandardizedDrinks
    ).toBe(5)
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

  it('compares Alcohol decimal subtotals safely without changing submitted values', () => {
    const base = draftUpdateBase()
    const valid = {
      id,
      weeklyResponse: 'YES' as const,
      drinkingDays: 3,
      totalStandardizedDrinks: 0.3,
      largestOneDayAmount: 0.1,
      daysAtLargestAmount: 3,
      commonBeverageTypes: ['BEER'] as const,
      otherBeverageDescription: null
    }
    expect(parseLifestyleDraftUpdateInput({ ...base, alcohol: valid }).alcohol).toMatchObject(valid)
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: { ...valid, totalStandardizedDrinks: 0.29 }
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...valid,
          drinkingDays: 4,
          totalStandardizedDrinks: 0.3
        }
      })
    ).toThrow()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        alcohol: {
          ...valid,
          drinkingDays: 4,
          totalStandardizedDrinks: 0.31
        }
      }).alcohol?.totalStandardizedDrinks
    ).toBe(0.31)
  })

  it('enforces Tobacco weekly draft and completion branch consistency', () => {
    const base = draftUpdateBase()
    const product = tobaccoProduct()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        tobacco: { id, weeklyResponse: 'YES', products: [] }
      }).tobacco?.products
    ).toEqual([])
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        tobacco: { id, weeklyResponse: 'YES', products: [product] }
      }).tobacco?.products
    ).toHaveLength(1)
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        tobacco: {
          id,
          weeklyResponse: 'YES',
          products: [
            product,
            { ...product, id: alternateId, sequenceNumber: 2, productType: 'CIGARETTE' }
          ]
        }
      }).tobacco?.products
    ).toHaveLength(2)
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        tobacco: {
          id,
          weeklyResponse: 'YES',
          products: [product, { ...product, id: alternateId, sequenceNumber: 2 }]
        }
      })
    ).toThrow()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        tobacco: { id, weeklyResponse: 'NO', products: [] }
      }).tobacco?.products
    ).toEqual([])
    for (const weeklyResponse of [
      'NO',
      'UNKNOWN',
      'DECLINED',
      'NOT_APPLICABLE',
      'PREFER_NOT_TO_ANSWER',
      null
    ] as const)
      expect(() =>
        parseLifestyleDraftUpdateInput({
          ...base,
          tobacco: { id, weeklyResponse, products: [product] }
        })
      ).toThrow()

    expect(() =>
      parseCompleteLifestyleTobaccoWeeklyInput({ id, weeklyResponse: null, products: [] })
    ).toThrow()
    expect(() =>
      parseCompleteLifestyleTobaccoWeeklyInput({ id, weeklyResponse: 'YES', products: [] })
    ).toThrow()
    expect(
      parseCompleteLifestyleTobaccoWeeklyInput({ id, weeklyResponse: 'YES', products: [product] })
        .weeklyResponse
    ).toBe('YES')
    expect(
      parseCompleteLifestyleTobaccoWeeklyInput({ id, weeklyResponse: 'NO', products: [] })
        .weeklyResponse
    ).toBe('NO')
    expect(() =>
      parseCompleteLifestyleTobaccoWeeklyInput({
        id,
        weeklyResponse: 'DECLINED',
        products: [product]
      })
    ).toThrow()
  })

  it('enforces Physical Activity weekly draft and completion branch consistency', () => {
    const base = draftUpdateBase()
    const activity = physicalActivity()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        physicalActivity: {
          id,
          weeklyResponse: 'YES',
          sedentaryTimeResponse: null,
          sedentaryMinutesPerDay: null,
          activities: []
        }
      }).physicalActivity?.activities
    ).toEqual([])
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        physicalActivity: {
          id,
          weeklyResponse: 'YES',
          sedentaryTimeResponse: null,
          sedentaryMinutesPerDay: null,
          activities: [activity]
        }
      }).physicalActivity?.activities
    ).toHaveLength(1)
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        physicalActivity: {
          id,
          weeklyResponse: 'YES',
          sedentaryTimeResponse: null,
          sedentaryMinutesPerDay: null,
          activities: [activity, { ...activity, id: alternateId, sequenceNumber: 2 }]
        }
      }).physicalActivity?.activities
    ).toHaveLength(2)
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        physicalActivity: {
          id,
          weeklyResponse: 'NO',
          sedentaryTimeResponse: 'RECORDED',
          sedentaryMinutesPerDay: 120,
          activities: []
        }
      }).physicalActivity?.sedentaryMinutesPerDay
    ).toBe(120)
    for (const weeklyResponse of [
      'NO',
      'UNKNOWN',
      'DECLINED',
      'NOT_APPLICABLE',
      'UNABLE_TO_ANSWER',
      'PREFER_NOT_TO_ANSWER',
      null
    ] as const)
      expect(() =>
        parseLifestyleDraftUpdateInput({
          ...base,
          physicalActivity: {
            id,
            weeklyResponse,
            sedentaryTimeResponse: null,
            sedentaryMinutesPerDay: null,
            activities: [activity]
          }
        })
      ).toThrow()

    expect(() =>
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: null,
        sedentaryTimeResponse: null,
        sedentaryMinutesPerDay: null,
        activities: []
      })
    ).toThrow()
    expect(() =>
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: 'YES',
        sedentaryTimeResponse: null,
        sedentaryMinutesPerDay: null,
        activities: []
      })
    ).toThrow()
    expect(
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: 'YES',
        sedentaryTimeResponse: 'RECORDED',
        sedentaryMinutesPerDay: 60,
        activities: [activity]
      }).weeklyResponse
    ).toBe('YES')
    expect(
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: 'NO',
        sedentaryTimeResponse: 'UNKNOWN',
        sedentaryMinutesPerDay: null,
        activities: []
      }).weeklyResponse
    ).toBe('NO')
    expect(() =>
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: 'DECLINED',
        sedentaryTimeResponse: null,
        sedentaryMinutesPerDay: null,
        activities: [activity]
      })
    ).toThrow()
  })

  it('preserves explicit sedentary-time response semantics', () => {
    const base = draftUpdateBase()
    for (const response of [
      'UNKNOWN',
      'UNABLE_TO_ANSWER',
      'DECLINED',
      'PREFER_NOT_TO_ANSWER'
    ] as const) {
      expect(
        parseLifestyleDraftUpdateInput({
          ...base,
          physicalActivity: {
            id,
            weeklyResponse: 'NO',
            sedentaryTimeResponse: response,
            sedentaryMinutesPerDay: null,
            activities: []
          }
        }).physicalActivity?.sedentaryTimeResponse
      ).toBe(response)
    }
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        physicalActivity: {
          id,
          weeklyResponse: 'NO',
          sedentaryTimeResponse: 'RECORDED',
          sedentaryMinutesPerDay: 0,
          activities: []
        }
      }).physicalActivity?.sedentaryMinutesPerDay
    ).toBe(0)
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        physicalActivity: {
          id,
          weeklyResponse: 'NO',
          sedentaryTimeResponse: 'UNKNOWN',
          sedentaryMinutesPerDay: 1,
          activities: []
        }
      })
    ).toThrow()
    expect(() =>
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: 'NO',
        sedentaryTimeResponse: 'UNKNOWN',
        sedentaryMinutesPerDay: null,
        activities: []
      })
    ).not.toThrow()
    expect(() =>
      parseCompleteLifestylePhysicalActivityWeeklyInput({
        id,
        weeklyResponse: 'NO',
        sedentaryTimeResponse: 'RECORDED',
        sedentaryMinutesPerDay: null,
        activities: []
      })
    ).toThrow()
  })

  it('preserves explicit Other Activity response semantics', () => {
    const base = draftUpdateBase()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        otherActivityResponse: null,
        otherActivities: []
      }).otherActivityResponse
    ).toBeNull()
    expect(
      parseLifestyleDraftUpdateInput({
        ...base,
        otherActivityResponse: 'YES',
        otherActivities: []
      }).otherActivityResponse
    ).toBe('YES')
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        otherActivityResponse: null,
        otherActivities: [
          {
            id,
            sequenceNumber: 1,
            category: 'SPORT',
            description: 'Sport',
            daysInPastSevenDays: 1,
            averageMinutesPerDay: 30,
            intensity: 'LIGHT'
          }
        ]
      })
    ).toThrow()
    expect(() =>
      parseLifestyleDraftUpdateInput({
        ...base,
        otherActivityResponse: 'YES',
        otherActivities: [
          {
            id,
            sequenceNumber: 1,
            category: 'SPORT',
            description: 'x'.repeat(501),
            daysInPastSevenDays: 1,
            averageMinutesPerDay: 30,
            intensity: 'LIGHT'
          }
        ]
      })
    ).toThrow()
    expect(() => parseCompleteLifestyleOtherActivityInput('YES', [])).toThrow()
    expect(() => parseCompleteLifestyleOtherActivityInput('NO', [])).not.toThrow()
  })
})

const alternateId = parseEntityId('22222222-2222-4222-8222-222222222222')

function draftUpdateBase(): LifestyleDraftUpdateInput {
  return {
    id,
    expectedRowVersion: 1,
    status: 'DRAFT',
    alcoholBaselineVersionId: null,
    tobaccoBaselineVersionId: null,
    workBaselineVersionId: null,
    otherActivityResponse: null,
    actorId: id,
    occurredAt: timestamp,
    alcohol: null,
    tobacco: null,
    physicalActivity: null,
    work: null,
    otherActivities: []
  } as const
}

function tobaccoProduct(): LifestyleTobaccoProductInput {
  return {
    id,
    sequenceNumber: 1,
    productType: 'VAPE',
    daysUsed: 2,
    averageQuantityPerUseDay: 1,
    unit: 'SESSIONS',
    secondhandSmokeExposure: null,
    otherProductDescription: null,
    otherUnitDescription: null
  } as const
}

function physicalActivity(): LifestyleActivityInput {
  return {
    id,
    sequenceNumber: 1,
    activityDomain: 'EXERCISE',
    description: null,
    intensity: 'MODERATE',
    daysInPastSevenDays: 3,
    averageMinutesPerActiveDay: 20
  } as const
}
