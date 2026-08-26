import { describe, expect, it, vi } from 'vitest'

import {
  createScreeningCompletionService,
  type CompleteScreeningRequest,
  type ScreeningCompletionService,
  type ScreeningCompletionServiceDependencies
} from '@main/application'
import type { DatabaseTransactionConnection } from '@main/database'
import { parseEntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

const ids = Object.freeze({
  installation: parseEntityId('10000000-0000-4000-8000-000000000001'),
  user: parseEntityId('10000000-0000-4000-8000-000000000002'),
  location: parseEntityId('10000000-0000-4000-8000-000000000003'),
  patient: parseEntityId('10000000-0000-4000-8000-000000000004'),
  session: parseEntityId('10000000-0000-4000-8000-000000000005'),
  encounter: parseEntityId('10000000-0000-4000-8000-000000000006'),
  protocol: parseEntityId('10000000-0000-4000-8000-000000000007'),
  vitalsDraft: parseEntityId('10000000-0000-4000-8000-000000000008'),
  vitalsReading: parseEntityId('10000000-0000-4000-8000-000000000009'),
  lifestyleDraft: parseEntityId('10000000-0000-4000-8000-000000000010'),
  alcoholBaseline: parseEntityId('10000000-0000-4000-8000-000000000011'),
  tobaccoBaseline: parseEntityId('10000000-0000-4000-8000-000000000012'),
  workBaseline: parseEntityId('10000000-0000-4000-8000-000000000013'),
  foodDraft: parseEntityId('10000000-0000-4000-8000-000000000014'),
  otcDraft: parseEntityId('10000000-0000-4000-8000-000000000015')
})
const now = '2026-08-20T12:00:00.000Z' as UtcTimestamp

describe('screening completion service', () => {
  it('atomically materializes verified drafts, locks the encounter, and emits privacy-safe records', () => {
    const harness = createHarness()

    const result = harness.service.complete(completeRequest())

    expect(result).toMatchObject({
      status: 'COMPLETED',
      encounter: { id: ids.encounter, status: 'COMPLETED', recordVersion: 2 }
    })
    expect(harness.completionRepository.complete).toHaveBeenCalledOnce()
    expect(harness.completionRepository.complete).toHaveBeenCalledWith(
      harness.connection,
      expect.objectContaining({
        encounterId: ids.encounter,
        expectedRecordVersion: 1,
        actorId: ids.user,
        vitalsReadings: [
          expect.objectContaining({
            systolic: 120,
            diastolic: 80,
            pulse: 70,
            measuredAt: '2026-08-20T09:30:00.000Z'
          })
        ],
        lifestyleLogs: expect.arrayContaining([
          expect.objectContaining({ questionCode: 'WEEKLY_ALCOHOL', responseCode: 'NO' }),
          expect.objectContaining({ questionCode: 'WEEKLY_WORK', responseCode: 'NO_WORK' })
        ]),
        foodLogs: [],
        otcLogs: []
      })
    )
    expect(harness.lifestyleRepository.updateDraft).toHaveBeenCalledWith(
      harness.connection,
      expect.objectContaining({ status: 'COMPLETE', expectedRowVersion: 3 })
    )
    expect(harness.auditEventRepository.insert).toHaveBeenCalledOnce()
    expect(harness.outboxRepository.insert).toHaveBeenCalledOnce()
    expect(harness.referralRepository.createAutomaticReferral).not.toHaveBeenCalled()

    const auditInput = harness.auditEventRepository.insert.mock.calls[0]?.[1]
    const outboxInput = harness.outboxRepository.insert.mock.calls[0]?.[1]
    expect(auditInput).toMatchObject({
      action: 'SCREENING_ENCOUNTER_COMPLETED',
      entityType: 'SCREENING_ENCOUNTER',
      entityId: ids.encounter,
      metadata: {
        encounter_id: ids.encounter,
        record_version: 2,
        vitals_reading_count: 1,
        lifestyle_section_count: 5,
        food_row_count: 0,
        otc_row_count: 0
      }
    })
    expect(outboxInput).toMatchObject({
      operation: 'SCREENING_ENCOUNTER_COMPLETED',
      payloadSchemaVersion: 'screening-encounter.completed.v1'
    })
    const operationalRecords = JSON.stringify({ auditInput, outboxInput })
    expect(operationalRecords).not.toContain('120')
    expect(operationalRecords).not.toContain('patient note')
    expect(operationalRecords).not.toContain('medication')
  })

  it('blocks incomplete sections before final writes', () => {
    const harness = createHarness({ foodResponse: null })

    expect(harness.service.complete(completeRequest())).toEqual({
      status: 'INCOMPLETE',
      section: 'FOOD'
    })
    expect(harness.completionRepository.complete).not.toHaveBeenCalled()
    expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
    expect(harness.outboxRepository.insert).not.toHaveBeenCalled()
  })

  it('completes reported food when optional frequency is not recorded', () => {
    const harness = createHarness({
      foodResponse: 'REPORTED',
      foodRows: [
        {
          id: parseEntityId('10000000-0000-4000-8000-000000000016'),
          sequenceNumber: 1,
          catalogCode: null,
          foodNameSnapshot: 'Corn fufu',
          foodNameNormalized: 'corn fufu',
          frequencyCode: null,
          preparationNote: null,
          sourceType: 'PATIENT_REPORTED'
        }
      ]
    })

    expect(harness.service.complete(completeRequest())).toMatchObject({ status: 'COMPLETED' })
    expect(harness.completionRepository.complete).toHaveBeenCalledWith(
      harness.connection,
      expect.objectContaining({
        foodLogs: [expect.objectContaining({ foodName: 'Corn fufu', frequencyCode: null })]
      })
    )
  })

  it('blocks final completion when an elevated first blood-pressure reading has no recheck', () => {
    const harness = createHarness({
      vitalsReadings: [
        {
          id: ids.vitalsReading,
          sequenceNumber: 1,
          systolic: 200,
          diastolic: 105,
          pulse: 80,
          measurementSite: 'RIGHT_ARM',
          patientPosition: 'SITTING',
          measurementTime: '10:30'
        }
      ]
    })

    expect(harness.service.complete(completeRequest())).toEqual({
      status: 'INCOMPLETE',
      section: 'VITALS'
    })
    expect(harness.completionRepository.complete).not.toHaveBeenCalled()
    expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
    expect(harness.outboxRepository.insert).not.toHaveBeenCalled()
  })

  it('creates one standard referral from a completed referral-threshold screening', () => {
    const harness = createHarness({
      vitalsReadings: [completeVitalsReading(1, 150, 94), completeVitalsReading(2, 148, 92)]
    })

    expect(harness.service.complete(completeRequest())).toMatchObject({ status: 'COMPLETED' })
    expect(harness.referralRepository.createAutomaticReferral).toHaveBeenCalledOnce()
    expect(harness.referralRepository.createAutomaticReferral).toHaveBeenCalledWith(
      harness.connection,
      expect.objectContaining({
        patientId: ids.patient,
        encounterId: ids.encounter,
        protocolVersionId: ids.protocol,
        reasonCode: 'BP_SCREENING_REFERRAL',
        urgency: 'STANDARD',
        dueDate: '2026-09-03'
      })
    )
    expect(harness.auditEventRepository.insert).toHaveBeenCalledTimes(2)
  })

  it('creates a same-day urgent referral from an urgent completed screening', () => {
    const harness = createHarness({
      vitalsReadings: [completeVitalsReading(1, 190, 124), completeVitalsReading(2, 188, 122)]
    })

    expect(harness.service.complete(completeRequest())).toMatchObject({ status: 'COMPLETED' })
    expect(harness.referralRepository.createAutomaticReferral).toHaveBeenCalledWith(
      harness.connection,
      expect.objectContaining({
        reasonCode: 'BP_SCREENING_URGENT_REFERRAL',
        urgency: 'URGENT',
        dueDate: '2026-08-20'
      })
    )
  })

  it('returns an already-completed encounter without duplicating final records or events', () => {
    const harness = createHarness({ alreadyCompleted: true })

    expect(harness.service.complete(completeRequest())).toMatchObject({
      status: 'ALREADY_COMPLETED',
      encounter: { status: 'COMPLETED', recordVersion: 2 }
    })
    expect(harness.completionRepository.complete).not.toHaveBeenCalled()
    expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
    expect(harness.outboxRepository.insert).not.toHaveBeenCalled()
  })
})

function completeRequest(): CompleteScreeningRequest {
  return {
    encounterId: ids.encounter,
    expectedEncounterVersion: 1,
    expectedVitalsVersion: 2,
    expectedLifestyleVersion: 3,
    expectedFoodVersion: 4,
    expectedOtcVersion: 5,
    reviewConfirmed: true as const,
    alcoholBaselineReviewConfirmedVersionId: null,
    tobaccoBaselineReviewConfirmedVersionId: null
  }
}

interface ScreeningCompletionHarness {
  readonly connection: DatabaseTransactionConnection
  readonly service: ScreeningCompletionService
  readonly completionRepository: { readonly complete: ReturnType<typeof vi.fn> }
  readonly lifestyleRepository: { readonly updateDraft: ReturnType<typeof vi.fn> }
  readonly referralRepository: { readonly createAutomaticReferral: ReturnType<typeof vi.fn> }
  readonly auditEventRepository: { readonly insert: ReturnType<typeof vi.fn> }
  readonly outboxRepository: { readonly insert: ReturnType<typeof vi.fn> }
}

function createHarness({
  foodResponse = 'UNKNOWN',
  foodRows = [],
  alreadyCompleted = false,
  vitalsReadings
}: {
  readonly foodResponse?: 'REPORTED' | 'UNKNOWN' | null
  readonly foodRows?: readonly Record<string, unknown>[]
  readonly alreadyCompleted?: boolean
  readonly vitalsReadings?: readonly Record<string, unknown>[]
} = {}): ScreeningCompletionHarness {
  const connection = {} as DatabaseTransactionConnection
  const draftEncounter = {
    id: ids.encounter,
    patientId: ids.patient,
    screeningSessionId: ids.session,
    locationId: ids.location,
    protocolVersionId: ids.protocol,
    status: alreadyCompleted ? ('COMPLETED' as const) : ('DRAFT' as const),
    startedAt: now,
    completedAt: alreadyCompleted ? now : null,
    sourceType: 'LOCAL',
    recordedBy: ids.user,
    amendmentOfEncounterId: null,
    amendmentReason: null,
    voidReason: null,
    recordVersion: alreadyCompleted ? 2 : 1,
    createdAt: now,
    updatedAt: now
  }
  const completedEncounter = {
    ...draftEncounter,
    status: 'COMPLETED' as const,
    completedAt: now,
    recordVersion: 2
  }
  const encounterLookup = vi.fn()
  if (alreadyCompleted) encounterLookup.mockReturnValue(completedEncounter)
  else encounterLookup.mockReturnValueOnce(draftEncounter).mockReturnValue(completedEncounter)

  const lifestyleRepository = {
    findDraftByEncounterForWrite: vi.fn(() => lifestyleDraft()),
    findAlcoholBaselineByIdForWrite: vi.fn(() => ({
      id: ids.alcoholBaseline,
      status: 'CURRENT'
    })),
    findTobaccoBaselineByIdForWrite: vi.fn(() => ({
      id: ids.tobaccoBaseline,
      status: 'CURRENT_DAILY'
    })),
    findWorkBaselineByIdForWrite: vi.fn(() => ({ id: ids.workBaseline })),
    updateDraft: vi.fn(() => ({ status: 'UPDATED' as const }))
  }
  const completionRepository = {
    complete: vi.fn(() => ({ status: 'COMPLETED' as const, recordVersion: 2 }))
  }
  const auditEventRepository = { insert: vi.fn() }
  const outboxRepository = { insert: vi.fn() }
  const referralRepository = {
    createAutomaticReferral: vi.fn((_connection, input) => ({
      status: 'CREATED' as const,
      referral: {
        id: input.id,
        patientId: input.patientId,
        encounterId: input.encounterId,
        protocolVersionId: input.protocolVersionId,
        reasonCodes: [input.reasonCode],
        urgency: input.urgency,
        dueDate: input.dueDate,
        status: 'OPEN' as const,
        createdBy: input.actorId,
        createdAt: input.createdAt,
        recordVersion: 1 as const
      }
    }))
  }
  let nextId = 100
  const dependencies = {
    authenticationSessionService: {
      requireAnyRole: vi.fn(() => ({ user: { id: ids.user } }))
    },
    currentScreeningSessionService: {
      findCurrentScreeningSessionInTransaction: vi.fn(() => ({
        status: 'FOUND' as const,
        session: screeningSession()
      }))
    },
    installationLocationService: {
      resolveConfiguredInstallationLocation: vi.fn(() => ({
        status: 'RESOLVED' as const,
        location: { id: ids.location }
      }))
    },
    installationRepository: {
      get: vi.fn(() => ({ id: ids.installation, timeZone: 'Africa/Douala' }))
    },
    locationRepository: {
      getByIdForWrite: vi.fn(() => ({ id: ids.location, isActive: true }))
    },
    screeningSessionRepository: {
      getByIdForWrite: vi.fn(() => screeningSession())
    },
    screeningEncounterRepository: {
      getByIdForWrite: encounterLookup
    },
    screeningVitalsDraftRepository: {
      getByEncounterIdForWrite: vi.fn(() => vitalsDraft(vitalsReadings))
    },
    lifestyleRepository,
    foodRepository: {
      findDraftByEncounterForWrite: vi.fn(() => ({
        id: ids.foodDraft,
        patientId: ids.patient,
        screeningSessionId: ids.session,
        locationId: ids.location,
        installationId: ids.installation,
        foodResponse,
        rows: foodRows,
        rowVersion: 4
      }))
    },
    otcRepository: {
      findDraftByEncounterForWrite: vi.fn(() => ({
        id: ids.otcDraft,
        patientId: ids.patient,
        screeningSessionId: ids.session,
        locationId: ids.location,
        installationId: ids.installation,
        otcResponse: 'NONE_REPORTED',
        rows: [],
        rowVersion: 5
      }))
    },
    referralRepository,
    completionRepository,
    screeningEncounterOutboxRepository: outboxRepository,
    auditEventRepository,
    transactionExecutor: {
      run: vi.fn((operation: (context: unknown) => unknown) =>
        operation({
          connection,
          nowUtc: () => now,
          newEntityId: () =>
            parseEntityId(`20000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`)
        })
      )
    }
  } as unknown as ScreeningCompletionServiceDependencies

  return {
    connection,
    service: createScreeningCompletionService(dependencies),
    completionRepository,
    lifestyleRepository,
    referralRepository,
    auditEventRepository,
    outboxRepository
  }
}

function screeningSession(): Record<string, unknown> {
  return {
    id: ids.session,
    locationId: ids.location,
    protocolVersionId: ids.protocol,
    sessionDate: '2026-08-20',
    status: 'OPEN',
    rowVersion: 1
  }
}

function completeVitalsReading(
  sequenceNumber: number,
  systolic: number,
  diastolic: number
): Record<string, unknown> {
  return {
    id: parseEntityId(`10000000-0000-4000-8000-${String(20 + sequenceNumber).padStart(12, '0')}`),
    sequenceNumber,
    systolic,
    diastolic,
    pulse: 80,
    measurementSite: 'RIGHT_ARM',
    patientPosition: 'SITTING',
    measurementTime: sequenceNumber === 1 ? '10:30' : '10:35'
  }
}

function vitalsDraft(readings?: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    id: ids.vitalsDraft,
    encounterId: ids.encounter,
    status: 'VITALS_COMPLETE',
    rowVersion: 2,
    readings: readings ?? [
      {
        id: ids.vitalsReading,
        sequenceNumber: 1,
        systolic: 120,
        diastolic: 80,
        pulse: 70,
        measurementSite: 'RIGHT_ARM',
        patientPosition: 'SITTING',
        measurementTime: '10:30'
      }
    ]
  }
}

function lifestyleDraft(): Record<string, unknown> {
  const common = { createdBy: ids.user, createdAt: now, updatedBy: ids.user, updatedAt: now }
  return {
    id: ids.lifestyleDraft,
    encounterId: ids.encounter,
    status: 'DRAFT',
    patientId: ids.patient,
    screeningSessionId: ids.session,
    locationId: ids.location,
    installationId: ids.installation,
    periodStart: '2026-08-14',
    periodEnd: '2026-08-20',
    alcoholBaselineVersionId: ids.alcoholBaseline,
    tobaccoBaselineVersionId: ids.tobaccoBaseline,
    workBaselineVersionId: ids.workBaseline,
    otherActivityResponse: 'NO',
    rowVersion: 3,
    ...common,
    alcohol: {
      id: parseEntityId('30000000-0000-4000-8000-000000000001'),
      lifestyleDraftId: ids.lifestyleDraft,
      weeklyResponse: 'NO',
      drinkingDays: null,
      totalStandardizedDrinks: null,
      largestOneDayAmount: null,
      daysAtLargestAmount: null,
      commonBeverageTypes: [],
      otherBeverageDescription: null,
      ...common
    },
    tobacco: {
      id: parseEntityId('30000000-0000-4000-8000-000000000002'),
      lifestyleDraftId: ids.lifestyleDraft,
      weeklyResponse: 'NO',
      products: [],
      ...common
    },
    physicalActivity: {
      id: parseEntityId('30000000-0000-4000-8000-000000000003'),
      lifestyleDraftId: ids.lifestyleDraft,
      weeklyResponse: 'NO',
      sedentaryTimeResponse: 'UNKNOWN',
      sedentaryMinutesPerDay: null,
      activities: [],
      ...common
    },
    work: {
      id: parseEntityId('30000000-0000-4000-8000-000000000004'),
      lifestyleDraftId: ids.lifestyleDraft,
      weeklyResponse: 'NO_WORK',
      ...common
    },
    otherActivities: []
  }
}
