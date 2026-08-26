import {
  parseAuditActionCode,
  parseAuditEntityType,
  parseCompleteLifestyleAlcoholWeeklyInput,
  parseCompleteLifestyleOtherActivityInput,
  parseCompleteLifestylePhysicalActivityWeeklyInput,
  parseCompleteLifestyleTobaccoWeeklyInput,
  readDataProperties,
  RepositoryValidationError,
  type AuditMetadata,
  type DatabaseTransactionConnection,
  type FoodDraftRecord,
  type InstallationRecord,
  type LifestyleDraftRecord,
  type LifestyleDraftUpdateInput,
  type OtcDraftRecord,
  type ScreeningCompletionLifestyleLogInput,
  type ScreeningEncounterRecord,
  type ScreeningSessionRecord,
  type ScreeningVitalsDraftRecord
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'
import { evaluateScreeningBloodPressure } from '@shared/screening-bp-protocol'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  isLocalSessionError
} from '../authentication/session'
import type {
  CompleteScreeningRequest,
  CompleteScreeningResult,
  CompletedScreeningSummary,
  ScreeningCompletionControlledStatus,
  ScreeningCompletionSection,
  ScreeningCompletionService,
  ScreeningCompletionServiceDependencies
} from './screening-completion-service-types'

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const completeRequestKeys = Object.freeze([
  'encounterId',
  'expectedEncounterVersion',
  'expectedVitalsVersion',
  'expectedLifestyleVersion',
  'expectedFoodVersion',
  'expectedOtcVersion',
  'reviewConfirmed',
  'alcoholBaselineReviewConfirmedVersionId',
  'tobaccoBaselineReviewConfirmedVersionId'
] as const)
const encounterCompletedAction = parseAuditActionCode('SCREENING_ENCOUNTER_COMPLETED')
const screeningEncounterEntityType = parseAuditEntityType('SCREENING_ENCOUNTER')

interface ParsedCompleteCommand {
  readonly encounterId: EntityId
  readonly expectedEncounterVersion: number
  readonly expectedVitalsVersion: number
  readonly expectedLifestyleVersion: number
  readonly expectedFoodVersion: number
  readonly expectedOtcVersion: number
  readonly alcoholBaselineReviewConfirmedVersionId: EntityId | null
  readonly tobaccoBaselineReviewConfirmedVersionId: EntityId | null
}

interface ValidatedContext {
  readonly installation: InstallationRecord
  readonly encounter: ScreeningEncounterRecord
  readonly session: ScreeningSessionRecord
}

export function createScreeningCompletionService(
  dependencies: ScreeningCompletionServiceDependencies
): ScreeningCompletionService {
  return Object.freeze({
    complete(request: CompleteScreeningRequest): CompleteScreeningResult {
      const actorResult = resolveTrustedActor(dependencies.authenticationSessionService)
      if (actorResult.status !== 'VALID') return statusResult(actorResult.statusCode)

      const command = parseCompleteCommand(request)
      if (command === null) return statusResult('VALIDATION_FAILED')

      const locationResult =
        dependencies.installationLocationService.resolveConfiguredInstallationLocation()
      if (locationResult.status !== 'RESOLVED') return statusResult(locationResult.status)

      try {
        return dependencies.transactionExecutor.run<CompleteScreeningResult>((context) => {
          const completedAt = context.nowUtc()
          const encounterContext = validateEncounterContext(
            context.connection,
            command.encounterId,
            locationResult.location.id,
            dependencies
          )
          if (encounterContext.status !== 'VALID') return statusResult(encounterContext.statusCode)

          const { encounter, installation, session } = encounterContext.context

          if (encounter.status === 'COMPLETED') {
            return encounter.completedAt === null
              ? statusResult('UNAVAILABLE')
              : Object.freeze({
                  status: 'ALREADY_COMPLETED' as const,
                  encounter: toCompletedSummary(encounter)
                })
          }
          if (encounter.status !== 'DRAFT') return statusResult('ENCOUNTER_NOT_EDITABLE')
          if (encounter.recordVersion !== command.expectedEncounterVersion)
            return statusResult('VERSION_CONFLICT')

          const currentSessionStatus = requireCurrentSession(
            dependencies.currentScreeningSessionService,
            context.connection,
            completedAt,
            encounter.screeningSessionId
          )
          if (currentSessionStatus !== null) return statusResult(currentSessionStatus)

          const vitals = dependencies.screeningVitalsDraftRepository.getByEncounterIdForWrite(
            context.connection,
            encounter.id
          )
          if (
            vitals === null ||
            vitals.rowVersion !== command.expectedVitalsVersion ||
            vitals.status !== 'VITALS_COMPLETE'
          ) {
            return incompleteOrConflict(vitals?.rowVersion, command.expectedVitalsVersion, 'VITALS')
          }
          if (!isCompleteVitals(vitals)) return incompleteResult('VITALS')
          const bloodPressureDecision = evaluateScreeningBloodPressure(
            vitals.readings.map((reading) => ({
              sequenceNumber: reading.sequenceNumber,
              systolic: reading.systolic!,
              diastolic: reading.diastolic!,
              pulse: reading.pulse!
            }))
          )
          if (
            bloodPressureDecision === null ||
            bloodPressureDecision.nextAction === 'REPEAT_REQUIRED'
          )
            return incompleteResult('VITALS')

          const lifestyle = dependencies.lifestyleRepository.findDraftByEncounterForWrite(
            context.connection,
            encounter.id
          )
          if (lifestyle === null || lifestyle.rowVersion !== command.expectedLifestyleVersion) {
            return incompleteOrConflict(
              lifestyle?.rowVersion,
              command.expectedLifestyleVersion,
              'LIFESTYLE'
            )
          }
          if (
            !isOwnedDraft(lifestyle, encounter, installation) ||
            !isCompleteLifestyle(
              lifestyle,
              command.alcoholBaselineReviewConfirmedVersionId,
              command.tobaccoBaselineReviewConfirmedVersionId,
              dependencies,
              context.connection
            )
          ) {
            return incompleteResult('LIFESTYLE')
          }

          const food = dependencies.foodRepository.findDraftByEncounterForWrite(
            context.connection,
            encounter.id
          )
          if (food === null || food.rowVersion !== command.expectedFoodVersion) {
            return incompleteOrConflict(food?.rowVersion, command.expectedFoodVersion, 'FOOD')
          }
          if (!isOwnedDraft(food, encounter, installation) || !isCompleteFood(food))
            return incompleteResult('FOOD')

          const otc = dependencies.otcRepository.findDraftByEncounterForWrite(
            context.connection,
            encounter.id
          )
          if (otc === null || otc.rowVersion !== command.expectedOtcVersion) {
            return incompleteOrConflict(otc?.rowVersion, command.expectedOtcVersion, 'OTC')
          }
          if (!isOwnedDraft(otc, encounter, installation) || !isCompleteOtc(otc))
            return incompleteResult('OTC')

          if (lifestyle.status !== 'COMPLETE') {
            const lifestyleUpdate = dependencies.lifestyleRepository.updateDraft(
              context.connection,
              toCompleteLifestyleInput(lifestyle, actorResult.actorId, completedAt)
            )
            if (lifestyleUpdate.status !== 'UPDATED') return statusResult('VERSION_CONFLICT')
          }

          const persistenceResult = dependencies.completionRepository.complete(context.connection, {
            encounterId: encounter.id,
            expectedRecordVersion: command.expectedEncounterVersion,
            actorId: actorResult.actorId,
            completedAt,
            summarySystolic: bloodPressureDecision.summarySystolic,
            summaryDiastolic: bloodPressureDecision.summaryDiastolic,
            summaryPulse: bloodPressureDecision.summaryPulse,
            nextActionCategory: bloodPressureDecision.nextAction,
            decisionJson: createBloodPressureDecisionJson(
              encounter.protocolVersionId,
              bloodPressureDecision
            ),
            vitalsReadings: vitals.readings.map((reading) => ({
              id: reading.id,
              sequenceNumber: reading.sequenceNumber,
              systolic: reading.systolic!,
              diastolic: reading.diastolic!,
              pulse: reading.pulse!,
              arm: reading.measurementSite!,
              bodyPosition: reading.patientPosition!,
              measuredAt: localMeasurementToUtc(
                session.sessionDate,
                reading.measurementTime!,
                installation.timeZone
              )
            })),
            lifestyleLogs: createLifestyleLogs(lifestyle, context.newEntityId),
            foodLogs:
              food.foodResponse === 'REPORTED'
                ? food.rows.map((row) => ({
                    id: row.id,
                    foodCode: row.catalogCode,
                    foodName: row.foodNameSnapshot,
                    foodNameNormalized: row.foodNameNormalized,
                    frequencyCode: row.frequencyCode,
                    notes: row.preparationNote
                  }))
                : [],
            otcLogs:
              otc.otcResponse === 'REPORTED'
                ? otc.rows.map((row) => ({
                    id: row.id,
                    productName: row.productNameSnapshot!,
                    productNameNormalized: row.productNameNormalized!,
                    reasonForUse: row.reasonForUse!,
                    doseText: row.doseText,
                    frequencyText: row.frequencyText,
                    durationText: row.durationText,
                    sourceOfMedication: row.sourceOfMedication,
                    currentlyTaking:
                      row.currentlyTakingResponse === 'YES'
                        ? true
                        : row.currentlyTakingResponse === 'NO'
                          ? false
                          : null
                  }))
                : []
          })
          if (persistenceResult.status !== 'COMPLETED') return statusResult('VERSION_CONFLICT')

          const completedEncounter = dependencies.screeningEncounterRepository.getByIdForWrite(
            context.connection,
            encounter.id
          )
          if (completedEncounter === null || completedEncounter.status !== 'COMPLETED')
            return statusResult('UNAVAILABLE')

          const metadata = createCompletionMetadata(
            completedEncounter,
            vitals.readings.length,
            food.foodResponse === 'REPORTED' ? food.rows.length : 0,
            otc.otcResponse === 'REPORTED' ? otc.rows.length : 0
          )
          dependencies.auditEventRepository.insert(context.connection, {
            id: context.newEntityId(),
            installationId: installation.id,
            userId: actorResult.actorId,
            action: encounterCompletedAction,
            entityType: screeningEncounterEntityType,
            entityId: encounter.id,
            occurredAt: completedAt,
            metadata
          })
          dependencies.screeningEncounterOutboxRepository.insert(context.connection, {
            id: context.newEntityId(),
            aggregateId: encounter.id,
            operation: 'SCREENING_ENCOUNTER_COMPLETED',
            payloadSchemaVersion: 'screening-encounter.completed.v1',
            createdAt: completedAt,
            payload: metadata
          })

          return Object.freeze({
            status: 'COMPLETED' as const,
            encounter: toCompletedSummary(completedEncounter)
          })
        })
      } catch (error) {
        if (error instanceof RepositoryValidationError) return statusResult('VALIDATION_FAILED')
        return statusResult('UNAVAILABLE')
      }
    }
  })
}

function validateEncounterContext(
  connection: DatabaseTransactionConnection,
  encounterId: EntityId,
  configuredLocationId: EntityId,
  dependencies: Pick<
    ScreeningCompletionServiceDependencies,
    | 'installationRepository'
    | 'locationRepository'
    | 'screeningSessionRepository'
    | 'screeningEncounterRepository'
  >
):
  | { readonly status: 'VALID'; readonly context: ValidatedContext }
  | { readonly status: 'INVALID'; readonly statusCode: ScreeningCompletionControlledStatus } {
  const installation = dependencies.installationRepository.get()
  if (installation === null) return invalidContext('UNAVAILABLE')
  const encounter = dependencies.screeningEncounterRepository.getByIdForWrite(
    connection,
    encounterId
  )
  if (encounter === null || encounter.amendmentOfEncounterId !== null)
    return invalidContext('ENCOUNTER_NOT_FOUND')
  const session = dependencies.screeningSessionRepository.getByIdForWrite(
    connection,
    encounter.screeningSessionId
  )
  if (session === null) return invalidContext('SESSION_NOT_FOUND')
  const location = dependencies.locationRepository.getByIdForWrite(connection, configuredLocationId)
  if (location === null) return invalidContext('LOCATION_NOT_FOUND')
  if (!location.isActive) return invalidContext('LOCATION_INACTIVE')
  if (session.status !== 'OPEN' && encounter.status !== 'COMPLETED')
    return invalidContext('SESSION_CLOSED')
  if (
    encounter.locationId !== configuredLocationId ||
    session.locationId !== configuredLocationId ||
    encounter.screeningSessionId !== session.id ||
    encounter.protocolVersionId !== session.protocolVersionId
  ) {
    return invalidContext('SESSION_NOT_CURRENT')
  }
  return { status: 'VALID', context: { installation, encounter, session } }
}

function isCompleteVitals(draft: ScreeningVitalsDraftRecord): boolean {
  return (
    draft.readings.length > 0 &&
    draft.readings.some((reading) => reading.sequenceNumber === 1) &&
    draft.readings.every(
      (reading) =>
        reading.systolic !== null &&
        reading.diastolic !== null &&
        reading.pulse !== null &&
        reading.measurementSite !== null &&
        reading.patientPosition !== null &&
        reading.measurementTime !== null
    )
  )
}

function isCompleteLifestyle(
  draft: LifestyleDraftRecord,
  alcoholConfirmation: EntityId | null,
  tobaccoConfirmation: EntityId | null,
  dependencies: Pick<ScreeningCompletionServiceDependencies, 'lifestyleRepository'>,
  connection: DatabaseTransactionConnection
): boolean {
  if (
    draft.alcohol === null ||
    draft.tobacco === null ||
    draft.physicalActivity === null ||
    draft.work === null ||
    draft.work.weeklyResponse === null ||
    draft.otherActivityResponse === null ||
    draft.alcoholBaselineVersionId === null ||
    draft.tobaccoBaselineVersionId === null ||
    draft.workBaselineVersionId === null
  ) {
    return false
  }

  try {
    parseCompleteLifestyleAlcoholWeeklyInput(toAlcoholInput(draft.alcohol))
    parseCompleteLifestyleTobaccoWeeklyInput(toTobaccoInput(draft.tobacco))
    parseCompleteLifestylePhysicalActivityWeeklyInput(toPhysicalInput(draft.physicalActivity))
    parseCompleteLifestyleOtherActivityInput(
      draft.otherActivityResponse,
      draft.otherActivities.map(toOtherActivityInput)
    )
  } catch {
    return false
  }

  const alcoholBaseline = dependencies.lifestyleRepository.findAlcoholBaselineByIdForWrite(
    connection,
    draft.alcoholBaselineVersionId,
    draft.patientId,
    draft.installationId
  )
  const tobaccoBaseline = dependencies.lifestyleRepository.findTobaccoBaselineByIdForWrite(
    connection,
    draft.tobaccoBaselineVersionId,
    draft.patientId,
    draft.installationId
  )
  const workBaseline = dependencies.lifestyleRepository.findWorkBaselineByIdForWrite(
    connection,
    draft.workBaselineVersionId,
    draft.patientId,
    draft.installationId
  )
  if (alcoholBaseline === null || tobaccoBaseline === null || workBaseline === null) return false

  const alcoholConflict =
    (alcoholBaseline.status === 'FORMER' || alcoholBaseline.status === 'NEVER') &&
    draft.alcohol.weeklyResponse === 'YES'
  const tobaccoConflict =
    (tobaccoBaseline.status === 'FORMER' || tobaccoBaseline.status === 'NEVER') &&
    draft.tobacco.weeklyResponse === 'YES'

  return (
    (alcoholConflict ? alcoholConfirmation === alcoholBaseline.id : alcoholConfirmation === null) &&
    (tobaccoConflict ? tobaccoConfirmation === tobaccoBaseline.id : tobaccoConfirmation === null)
  )
}

function isCompleteFood(draft: FoodDraftRecord): boolean {
  if (draft.foodResponse === null) return false
  if (draft.foodResponse !== 'REPORTED') return draft.rows.length === 0
  return draft.rows.length > 0
}

function isCompleteOtc(draft: OtcDraftRecord): boolean {
  if (draft.otcResponse === null) return false
  if (draft.otcResponse !== 'REPORTED') return draft.rows.length === 0
  if (draft.rows.length === 0) return false
  const names = new Set<string>()
  for (const row of draft.rows) {
    if (
      row.productNameSnapshot === null ||
      row.productNameNormalized === null ||
      row.reasonForUse === null ||
      row.currentlyTakingResponse === null ||
      names.has(row.productNameNormalized)
    ) {
      return false
    }
    names.add(row.productNameNormalized)
  }
  return true
}

function toCompleteLifestyleInput(
  draft: LifestyleDraftRecord,
  actorId: EntityId,
  occurredAt: UtcTimestamp
): LifestyleDraftUpdateInput {
  return Object.freeze({
    id: draft.id,
    expectedRowVersion: draft.rowVersion,
    status: 'COMPLETE' as const,
    alcoholBaselineVersionId: draft.alcoholBaselineVersionId,
    tobaccoBaselineVersionId: draft.tobaccoBaselineVersionId,
    workBaselineVersionId: draft.workBaselineVersionId,
    otherActivityResponse: draft.otherActivityResponse,
    actorId,
    occurredAt,
    alcohol: draft.alcohol === null ? null : toAlcoholInput(draft.alcohol),
    tobacco: draft.tobacco === null ? null : toTobaccoInput(draft.tobacco),
    physicalActivity:
      draft.physicalActivity === null ? null : toPhysicalInput(draft.physicalActivity),
    work:
      draft.work === null
        ? null
        : Object.freeze({ id: draft.work.id, weeklyResponse: draft.work.weeklyResponse }),
    otherActivities: Object.freeze(draft.otherActivities.map(toOtherActivityInput))
  })
}

function toAlcoholInput(
  record: NonNullable<LifestyleDraftRecord['alcohol']>
): NonNullable<LifestyleDraftUpdateInput['alcohol']> {
  return Object.freeze({
    id: record.id,
    weeklyResponse: record.weeklyResponse,
    drinkingDays: record.drinkingDays,
    totalStandardizedDrinks: record.totalStandardizedDrinks,
    largestOneDayAmount: record.largestOneDayAmount,
    daysAtLargestAmount: record.daysAtLargestAmount,
    commonBeverageTypes: record.commonBeverageTypes,
    otherBeverageDescription: record.otherBeverageDescription
  })
}

function toTobaccoInput(
  record: NonNullable<LifestyleDraftRecord['tobacco']>
): NonNullable<LifestyleDraftUpdateInput['tobacco']> {
  return Object.freeze({
    id: record.id,
    weeklyResponse: record.weeklyResponse,
    products: Object.freeze(
      record.products.map((product) =>
        Object.freeze({
          id: product.id,
          sequenceNumber: product.sequenceNumber,
          productType: product.productType,
          daysUsed: product.daysUsed,
          averageQuantityPerUseDay: product.averageQuantityPerUseDay,
          unit: product.unit,
          secondhandSmokeExposure: product.secondhandSmokeExposure,
          otherProductDescription: product.otherProductDescription,
          otherUnitDescription: product.otherUnitDescription
        })
      )
    )
  })
}

function toPhysicalInput(
  record: NonNullable<LifestyleDraftRecord['physicalActivity']>
): NonNullable<LifestyleDraftUpdateInput['physicalActivity']> {
  return Object.freeze({
    id: record.id,
    weeklyResponse: record.weeklyResponse,
    sedentaryTimeResponse: record.sedentaryTimeResponse,
    sedentaryMinutesPerDay: record.sedentaryMinutesPerDay,
    activities: Object.freeze(
      record.activities.map((activity) =>
        Object.freeze({
          id: activity.id,
          sequenceNumber: activity.sequenceNumber,
          activityDomain: activity.activityDomain,
          description: activity.description,
          intensity: activity.intensity,
          daysInPastSevenDays: activity.daysInPastSevenDays,
          averageMinutesPerActiveDay: activity.averageMinutesPerActiveDay
        })
      )
    )
  })
}

function toOtherActivityInput(
  activity: LifestyleDraftRecord['otherActivities'][number]
): LifestyleDraftUpdateInput['otherActivities'][number] {
  return Object.freeze({
    id: activity.id,
    sequenceNumber: activity.sequenceNumber,
    category: activity.category,
    description: activity.description,
    daysInPastSevenDays: activity.daysInPastSevenDays,
    averageMinutesPerDay: activity.averageMinutesPerDay,
    intensity: activity.intensity
  })
}

function createLifestyleLogs(
  draft: LifestyleDraftRecord,
  newEntityId: () => EntityId
): readonly ScreeningCompletionLifestyleLogInput[] {
  return Object.freeze([
    Object.freeze({
      id: newEntityId(),
      questionCode: 'WEEKLY_ALCOHOL',
      responseCode: draft.alcohol!.weeklyResponse!
    }),
    Object.freeze({
      id: newEntityId(),
      questionCode: 'WEEKLY_TOBACCO',
      responseCode: draft.tobacco!.weeklyResponse!
    }),
    Object.freeze({
      id: newEntityId(),
      questionCode: 'WEEKLY_PHYSICAL_ACTIVITY',
      responseCode: draft.physicalActivity!.weeklyResponse!
    }),
    Object.freeze({
      id: newEntityId(),
      questionCode: 'WEEKLY_WORK',
      responseCode: draft.work!.weeklyResponse!
    }),
    Object.freeze({
      id: newEntityId(),
      questionCode: 'WEEKLY_OTHER_ACTIVITY',
      responseCode: draft.otherActivityResponse!
    })
  ])
}

function localMeasurementToUtc(
  sessionDate: string,
  measurementTime: string,
  timeZone: string
): UtcTimestamp {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sessionDate)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(measurementTime)
  if (match === null || timeMatch === null) throw new RepositoryValidationError()
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2])
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })
  let candidate = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute)
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = readZonedParts(formatter, new Date(candidate))
    const displayedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
    const targetAsUtc = Date.UTC(
      target.year,
      target.month - 1,
      target.day,
      target.hour,
      target.minute
    )
    candidate += targetAsUtc - displayedAsUtc
  }
  const finalParts = readZonedParts(formatter, new Date(candidate))
  if (
    finalParts.year !== target.year ||
    finalParts.month !== target.month ||
    finalParts.day !== target.day ||
    finalParts.hour !== target.hour ||
    finalParts.minute !== target.minute
  ) {
    throw new RepositoryValidationError()
  }
  return parseUtcTimestamp(new Date(candidate).toISOString())
}

function readZonedParts(
  formatter: Intl.DateTimeFormat,
  value: Date
): {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
} {
  const parts = new Map<string, string>(
    formatter.formatToParts(value).map((part) => [part.type, part.value])
  )
  const read = (key: string): number => {
    const number = Number(parts.get(key))
    if (!Number.isSafeInteger(number)) throw new RepositoryValidationError()
    return number
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  }
}

function parseCompleteCommand(request: unknown): ParsedCompleteCommand | null {
  try {
    const data = readDataProperties(request, completeRequestKeys)
    if (data.reviewConfirmed !== true) throw new RepositoryValidationError()
    return Object.freeze({
      encounterId: parseEntityId(data.encounterId),
      expectedEncounterVersion: parsePositiveVersion(data.expectedEncounterVersion),
      expectedVitalsVersion: parsePositiveVersion(data.expectedVitalsVersion),
      expectedLifestyleVersion: parsePositiveVersion(data.expectedLifestyleVersion),
      expectedFoodVersion: parsePositiveVersion(data.expectedFoodVersion),
      expectedOtcVersion: parsePositiveVersion(data.expectedOtcVersion),
      alcoholBaselineReviewConfirmedVersionId:
        data.alcoholBaselineReviewConfirmedVersionId === null
          ? null
          : parseEntityId(data.alcoholBaselineReviewConfirmedVersionId),
      tobaccoBaselineReviewConfirmedVersionId:
        data.tobaccoBaselineReviewConfirmedVersionId === null
          ? null
          : parseEntityId(data.tobaccoBaselineReviewConfirmedVersionId)
    })
  } catch {
    return null
  }
}

function parsePositiveVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new RepositoryValidationError()
  return value
}

function toCompletedSummary(encounter: ScreeningEncounterRecord): CompletedScreeningSummary {
  if (encounter.status !== 'COMPLETED' || encounter.completedAt === null)
    throw new RepositoryValidationError()
  return Object.freeze({
    id: encounter.id,
    patientId: encounter.patientId,
    screeningSessionId: encounter.screeningSessionId,
    status: 'COMPLETED',
    startedAt: encounter.startedAt,
    completedAt: encounter.completedAt,
    recordVersion: encounter.recordVersion
  })
}

function createCompletionMetadata(
  encounter: ScreeningEncounterRecord,
  vitalsReadingCount: number,
  foodRowCount: number,
  otcRowCount: number
): AuditMetadata {
  return Object.freeze({
    encounter_id: encounter.id,
    record_version: encounter.recordVersion,
    vitals_reading_count: vitalsReadingCount,
    lifestyle_section_count: 5,
    food_row_count: foodRowCount,
    otc_row_count: otcRowCount
  })
}

function createBloodPressureDecisionJson(
  encounterProtocolVersionId: EntityId,
  decision: NonNullable<ReturnType<typeof evaluateScreeningBloodPressure>>
): string {
  return JSON.stringify({
    encounter_protocol_version_id: encounterProtocolVersionId,
    ruleset_key: decision.evidence.protocolKey,
    ruleset_version: decision.evidence.protocolVersion,
    next_action_category: decision.nextAction,
    summary: {
      systolic: decision.summarySystolic,
      diastolic: decision.summaryDiastolic,
      pulse: decision.summaryPulse
    },
    evidence: {
      calculation_method: decision.evidence.calculationMethod,
      reading_sequence_numbers: decision.evidence.readingSequenceNumbers,
      repeat_systolic_threshold: decision.evidence.repeatSystolicThreshold,
      repeat_diastolic_threshold: decision.evidence.repeatDiastolicThreshold,
      urgent_systolic_threshold: decision.evidence.urgentSystolicThreshold,
      urgent_diastolic_threshold: decision.evidence.urgentDiastolicThreshold
    }
  })
}

function isOwnedDraft(
  draft: Pick<
    LifestyleDraftRecord | FoodDraftRecord | OtcDraftRecord,
    'patientId' | 'screeningSessionId' | 'locationId' | 'installationId'
  >,
  encounter: ScreeningEncounterRecord,
  installation: InstallationRecord
): boolean {
  return (
    draft.patientId === encounter.patientId &&
    draft.screeningSessionId === encounter.screeningSessionId &&
    draft.locationId === encounter.locationId &&
    draft.installationId === installation.id
  )
}

function requireCurrentSession(
  service: ScreeningCompletionServiceDependencies['currentScreeningSessionService'],
  connection: DatabaseTransactionConnection,
  occurredAt: UtcTimestamp,
  encounterSessionId: EntityId
): ScreeningCompletionControlledStatus | null {
  const result = service.findCurrentScreeningSessionInTransaction({ connection, occurredAt })
  if (result.status === 'FOUND')
    return result.session.id === encounterSessionId ? null : 'SESSION_NOT_CURRENT'
  if (result.status === 'SESSION_CLOSED') return 'SESSION_CLOSED'
  if (result.status === 'SESSION_NOT_FOUND') return 'SESSION_NOT_CURRENT'
  return result.status
}

function resolveTrustedActor(
  service: ScreeningCompletionServiceDependencies['authenticationSessionService']
):
  | { readonly status: 'VALID'; readonly actorId: EntityId }
  | { readonly status: 'INVALID'; readonly statusCode: ScreeningCompletionControlledStatus } {
  try {
    return { status: 'VALID', actorId: service.requireAnyRole(allowedRoles).user.id }
  } catch (error) {
    if (error instanceof LocalSessionAuthorizationError)
      return { status: 'INVALID', statusCode: 'FORBIDDEN' }
    if (
      error instanceof LocalSessionUnauthenticatedError ||
      error instanceof LocalSessionLockedError ||
      error instanceof LocalSessionPasswordChangeRequiredError ||
      isLocalSessionError(error)
    ) {
      return { status: 'INVALID', statusCode: 'AUTHENTICATION_REQUIRED' }
    }
    return { status: 'INVALID', statusCode: 'UNAVAILABLE' }
  }
}

function incompleteOrConflict(
  actualVersion: number | undefined,
  expectedVersion: number,
  section: ScreeningCompletionSection
): CompleteScreeningResult {
  return actualVersion === undefined
    ? incompleteResult(section)
    : actualVersion === expectedVersion
      ? incompleteResult(section)
      : statusResult('VERSION_CONFLICT')
}

function incompleteResult(section: ScreeningCompletionSection): CompleteScreeningResult {
  return Object.freeze({ status: 'INCOMPLETE' as const, section })
}

function invalidContext(statusCode: ScreeningCompletionControlledStatus): {
  readonly status: 'INVALID'
  readonly statusCode: ScreeningCompletionControlledStatus
} {
  return Object.freeze({ status: 'INVALID' as const, statusCode })
}

function statusResult(status: ScreeningCompletionControlledStatus): CompleteScreeningResult {
  return Object.freeze({ status })
}
