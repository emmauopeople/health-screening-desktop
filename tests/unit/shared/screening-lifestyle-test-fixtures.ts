import type { ScreeningLifestyleWorkspace } from '@shared/ipc'

export const lifestyleEncounterId = '33333333-3333-4333-8333-333333333333'
export const lifestyleSecondId = '44444444-4444-4444-8444-444444444444'
export const lifestyleTimestamp = '2026-08-06T12:00:00.000Z'

export const validLifestyleWorkspace: ScreeningLifestyleWorkspace = {
  encounterId: lifestyleEncounterId,
  draft: {
    id: lifestyleSecondId,
    encounterId: lifestyleEncounterId,
    status: 'IN_PROGRESS',
    rowVersion: 2,
    periodStart: '2026-08-01',
    periodEnd: '2026-08-07',
    alcoholBaselineVersionId: lifestyleSecondId,
    tobaccoBaselineVersionId: lifestyleEncounterId,
    workBaselineVersionId: lifestyleSecondId,
    alcohol: {
      id: lifestyleEncounterId,
      weeklyResponse: 'YES',
      drinkingDays: 2,
      totalStandardizedDrinks: 4,
      largestOneDayAmount: 3,
      daysAtLargestAmount: 1,
      commonBeverageTypes: ['BEER', 'WINE'],
      otherBeverageDescription: null,
      updatedAt: lifestyleTimestamp
    },
    tobacco: {
      id: lifestyleSecondId,
      weeklyResponse: 'YES',
      products: [
        {
          id: lifestyleEncounterId,
          sequenceNumber: 1,
          productType: 'CIGARETTE',
          daysUsed: 3,
          averageQuantityPerUseDay: 2,
          unit: 'STICKS_CIGARETTES',
          secondhandSmokeExposure: false,
          otherProductDescription: null,
          otherUnitDescription: null,
          updatedAt: lifestyleTimestamp
        }
      ],
      updatedAt: lifestyleTimestamp
    },
    physicalActivity: {
      id: lifestyleEncounterId,
      weeklyResponse: 'YES',
      sedentaryMinutesPerDay: 120,
      activities: [
        {
          id: lifestyleSecondId,
          sequenceNumber: 1,
          activityDomain: 'EXERCISE',
          description: 'Walking',
          intensity: 'MODERATE',
          daysInPastSevenDays: 3,
          averageMinutesPerActiveDay: 30,
          weeklyMinutes: 90,
          updatedAt: lifestyleTimestamp
        }
      ],
      updatedAt: lifestyleTimestamp
    },
    work: {
      id: lifestyleSecondId,
      weeklyResponse: 'USUAL',
      updatedAt: lifestyleTimestamp
    },
    otherActivities: [
      {
        id: lifestyleEncounterId,
        sequenceNumber: 1,
        category: 'COMMUNITY',
        description: 'Community meeting',
        daysInPastSevenDays: 1,
        averageMinutesPerDay: 45,
        intensity: 'LIGHT',
        updatedAt: lifestyleTimestamp
      }
    ],
    updatedAt: lifestyleTimestamp
  },
  activeAlcoholBaseline: {
    id: lifestyleSecondId,
    version: 2,
    status: 'CURRENT',
    everConsumed: 'YES',
    consumedPast12Months: 'YES',
    commonBeverageTypes: ['BEER'],
    otherBeverageDescription: null,
    updatedAt: lifestyleTimestamp
  },
  activeTobaccoBaseline: {
    id: lifestyleEncounterId,
    version: 1,
    status: 'CURRENT_DAILY',
    everRegularlyUsed: 'YES',
    formerUseApproximateStopDate: null,
    currentUseFrequency: 'EVERY_DAY',
    productTypes: ['CIGARETTE'],
    otherProductDescription: null,
    updatedAt: lifestyleTimestamp
  },
  activeWorkBaseline: {
    id: lifestyleSecondId,
    version: 2,
    status: 'EMPLOYED',
    occupationJobTitle: 'Farm worker',
    usualPhysicalDemand: 'MODERATE_LABOR',
    typicalWorkdaysPerWeek: 5,
    typicalHoursPerWorkday: 8,
    shiftPattern: 'DAY',
    description: null,
    updatedAt: lifestyleTimestamp
  },
  referencedAlcoholBaseline: {
    id: lifestyleSecondId,
    version: 2,
    status: 'CURRENT',
    everConsumed: 'YES',
    consumedPast12Months: 'YES',
    commonBeverageTypes: ['BEER'],
    otherBeverageDescription: null,
    updatedAt: lifestyleTimestamp
  },
  referencedTobaccoBaseline: {
    id: lifestyleEncounterId,
    version: 1,
    status: 'CURRENT_DAILY',
    everRegularlyUsed: 'YES',
    formerUseApproximateStopDate: null,
    currentUseFrequency: 'EVERY_DAY',
    productTypes: ['CIGARETTE'],
    otherProductDescription: null,
    updatedAt: lifestyleTimestamp
  },
  referencedWorkBaseline: {
    id: lifestyleSecondId,
    version: 2,
    status: 'EMPLOYED',
    occupationJobTitle: 'Farm worker',
    usualPhysicalDemand: 'MODERATE_LABOR',
    typicalWorkdaysPerWeek: 5,
    typicalHoursPerWorkday: 8,
    shiftPattern: 'DAY',
    description: null,
    updatedAt: lifestyleTimestamp
  }
}
