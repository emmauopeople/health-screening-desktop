import fixture from './page.json'
import type { HistoryItem, HistoryPage } from '@shared/central-history/contract.mjs'

export const historyUuid = (n: number): string =>
  `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export function historyFixture(): HistoryPage {
  const page = structuredClone(fixture) as HistoryPage
  return {
    ...page,
    items: [...page.items].sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) ||
        b.resourceType.localeCompare(a.resourceType) ||
        b.resourceId.localeCompare(a.resourceId)
    )
  }
}
export function allDomainHistory(): HistoryPage {
  const page = historyFixture()
  const template = page.items[0]!
  const actor = template.author
  const instant = template.occurredAt
  const extra: [HistoryItem['resourceType'], Record<string, unknown>][] = [
    [
      'SCREENING_ENCOUNTER',
      {
        startedAt: instant,
        completedAt: instant,
        amendmentOfEncounterId: null,
        amendmentReason: null,
        voidReason: null,
        clinicalTime: { localDate: '2026-09-17', localTime: '11:00', timezone: 'Africa/Douala' },
        session: { sessionId: historyUuid(101), sessionDate: '2026-09-17', status: 'CLOSED' },
        protocol: { protocolId: historyUuid(102), key: 'BP_SCREENING', version: '1' }
      }
    ],
    [
      'VITALS',
      {
        status: 'VITALS_COMPLETE',
        weightKg: 72,
        waistCm: null,
        notes: null,
        readings: [
          {
            id: historyUuid(103),
            sequenceNumber: 1,
            systolicMmhg: 141,
            diastolicMmhg: 91,
            pulseBpm: 75,
            measurementSite: 'LEFT_ARM',
            patientPosition: 'SITTING',
            measurementLocalTime: '11:00',
            measuredAt: instant,
            measurementLocalDate: '2026-09-17',
            measurementTimezone: 'Africa/Douala'
          }
        ]
      }
    ],
    [
      'LIFESTYLE',
      {
        status: 'COMPLETE',
        periodStart: '2026-09-11',
        periodEnd: '2026-09-17',
        baselines: {
          alcohol: {
            id: historyUuid(104),
            version: 1,
            status: 'COMPLETE',
            everConsumed: 'YES',
            consumedPast12Months: 'NO',
            otherBeverageDescription: null,
            beverageTypes: []
          },
          tobacco: {
            id: historyUuid(105),
            version: 1,
            status: 'COMPLETE',
            everRegularlyUsed: 'NO',
            currentUseFrequency: 'NEVER',
            formerUseApproximateStopDate: null,
            otherProductDescription: null,
            productTypes: []
          },
          work: {
            id: historyUuid(106),
            version: 1,
            status: 'COMPLETE',
            occupationJobTitle: 'Teacher',
            usualPhysicalDemand: 'LIGHT',
            shiftPattern: 'DAY',
            description: null,
            typicalWorkdaysPerWeek: 5,
            typicalHoursPerWorkday: 8
          }
        },
        alcohol: {
          weeklyResponse: 'NO',
          drinkingDays: 0,
          totalStandardizedDrinks: 0,
          largestOneDayAmount: 0,
          daysAtLargestAmount: 0,
          otherBeverageDescription: null,
          beverageTypes: []
        },
        tobacco: { weeklyResponse: 'NO', products: [] },
        physicalActivity: {
          weeklyResponse: 'NO',
          sedentaryTimeResponse: 'KNOWN',
          sedentaryMinutesPerDay: 120,
          activities: []
        },
        work: { weeklyResponse: 'YES' },
        otherActivity: { weeklyResponse: 'NO', activities: [] }
      }
    ],
    [
      'REFERRAL',
      {
        reasonCodes: ['ELEVATED_BP'],
        reasonText: 'Repeat BP',
        destinationName: 'Central Clinic',
        dueDate: '2026-09-30',
        closureReason: 'Provider confirmed',
        closedAt: instant,
        urgency: 'STANDARD',
        status: 'CLOSED',
        createdAt: instant,
        updatedAt: instant,
        createdBy: actor,
        updatedBy: actor,
        closedBy: actor
      }
    ],
    [
      'REFERRAL_STATUS',
      {
        sequenceNumber: 2,
        fromStatus: 'SEEN',
        toStatus: 'CLOSED',
        changeReason: 'Provider confirmed'
      }
    ],
    [
      'REFERRAL_FOLLOWUP',
      {
        contactDate: '2026-09-17',
        contactMethod: 'PHONE',
        informationSource: 'PATIENT',
        sourceType: 'DIRECT_FOLLOWUP',
        providerSeen: true,
        facilityName: 'Up-hill clinic',
        dateSeen: '2026-09-13',
        reportedOutcome: null,
        reportedMedicationsOrAdvice: 'Increase physical activity',
        nextAction: 'Follow up screening',
        nextFollowupDate: '2026-09-23',
        treatmentActions: [{ sequenceNumber: 1, actionCode: 'NEW_MEDICATION' }],
        medicationChanges: [
          {
            sequenceNumber: 1,
            changeType: 'NEW_MEDICATION',
            medicationName: 'Amlodipine',
            dosage: '5 mg',
            frequency: 'Once daily'
          }
        ]
      }
    ]
  ]
  const items = [
    ...page.items,
    ...extra.map(([resourceType, data], index) => ({
      ...template,
      resourceType,
      resourceId: historyUuid(200 + index),
      data
    }))
  ]
  return {
    ...page,
    items: items.sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) ||
        b.resourceType.localeCompare(a.resourceType) ||
        b.resourceId.localeCompare(a.resourceId)
    )
  }
}
