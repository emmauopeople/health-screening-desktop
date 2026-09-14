import type Database from 'better-sqlite3'
import {
  SnapshotMaterializationError,
  SnapshotValueError,
  snapshotField
} from './sync-snapshot-diagnostics'
import type { SyncSnapshotDiagnostic } from '@shared/sync-snapshot-diagnostics'

import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { parseIanaTimeZone } from '@main/database/repositories/installation'
import {
  createLifestyleRepository,
  type LifestyleDraftRecord
} from '@main/database/repositories/lifestyle'
import { parseLocalUserRole, parseUserDisplayName } from '@main/database/repositories/local-user'
import { parsePatientAcknowledgmentHistoryStatus } from '@main/database/repositories/patient/patient-acknowledgment-validation'
import { RepositoryDataIntegrityError } from '@main/database/repositories/repository-errors'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import type {
  MaterializedSyncActor,
  MaterializedSyncBatchSource,
  MaterializedSyncJsonValue,
  MaterializedSyncRecord,
  MaterializedSyncResourceType,
  SyncSnapshotRepository
} from './sync-snapshot-types'

const maximumSignals = 500
const maximumRecords = 100
const maximumActors = 50
// Reserve room below the 1 MiB wire limit for actors and the transport envelope.
const maximumRecordBytes = 900 * 1024

const resourceOrder: Readonly<Record<MaterializedSyncResourceType, number>> = Object.freeze({
  PATIENT: 0,
  SCREENING_SESSION: 1,
  SCREENING_ENCOUNTER: 2,
  VITALS: 3,
  LIFESTYLE: 4,
  FOOD: 5,
  OTC: 6
})

const operationResource = new Map<string, MaterializedSyncResourceType>([
  ['SCREENING_FOOD_FINALIZED', 'FOOD'],
  ['SCREENING_OTC_FINALIZED', 'OTC'],
  ['PATIENT_CREATED', 'PATIENT'],
  ['PATIENT_DEMOGRAPHICS_AMENDED', 'PATIENT'],
  ['PATIENT_ACKNOWLEDGMENT_RECORDED', 'PATIENT'],
  ['SCREENING_SESSION_CREATED', 'SCREENING_SESSION'],
  ['SCREENING_SESSION_CLOSED', 'SCREENING_SESSION'],
  ['SCREENING_SESSION_REOPENED', 'SCREENING_SESSION'],
  ['SCREENING_ENCOUNTER_STARTED', 'SCREENING_ENCOUNTER'],
  ['SCREENING_ENCOUNTER_COMPLETED', 'SCREENING_ENCOUNTER'],
  ['SCREENING_ENCOUNTER_VOIDED', 'SCREENING_ENCOUNTER'],
  ['SCREENING_VITALS_DRAFT_SAVED', 'VITALS'],
  ['SCREENING_VITALS_STEP_COMPLETED', 'VITALS'],
  ['SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED', 'LIFESTYLE'],
  ['SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED', 'LIFESTYLE'],
  ['SCREENING_LIFESTYLE_WORK_BASELINE_CREATED', 'LIFESTYLE'],
  ['SCREENING_LIFESTYLE_DRAFT_SAVED', 'LIFESTYLE'],
  ['SCREENING_LIFESTYLE_STEP_COMPLETED', 'LIFESTYLE'],
  ['SCREENING_LIFESTYLE_REOPENED', 'LIFESTYLE']
])

interface OutboxSignal {
  readonly id: EntityId
  readonly aggregateId: EntityId
  readonly operation: string
  readonly createdAt: UtcTimestamp
  readonly resourceType: MaterializedSyncResourceType
}

interface SignalGroup {
  readonly resourceType: MaterializedSyncResourceType
  readonly aggregateId: EntityId
  readonly signals: readonly OutboxSignal[]
}

interface MaterializedCandidate {
  readonly record: MaterializedSyncRecord
  readonly actorIds: ReadonlySet<EntityId>
  readonly outboxIds: readonly EntityId[]
}

interface InstallationContext {
  readonly installationId: EntityId
  readonly locationId: EntityId
  readonly timezone: string
}

export function createSyncSnapshotRepository(
  connection: Database.Database
): SyncSnapshotRepository {
  const lifestyleRepository = createLifestyleRepository(connection)

  return Object.freeze({
    materializeNext(
      scopedConnection: DatabaseTransactionConnection,
      now: UtcTimestamp
    ): MaterializedSyncBatchSource | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)
      let stage: SyncSnapshotDiagnostic['stage'] = 'INSTALLATION'
      try {
        const installation = readInstallationContext(scopedConnection)
        stage = 'SIGNALS'
        const signals = readEligibleSignals(scopedConnection, parseUtcTimestamp(now))
        if (signals.length === 0) return null

        const candidates = groupSignals(signals)
          .map((group) => {
            stage = group.resourceType
            return materializeCandidate(scopedConnection, lifestyleRepository, installation, group)
          })
          .filter((candidate): candidate is MaterializedCandidate => candidate !== null)
          .sort(compareCandidates)

        stage = 'SELECTION'
        const selected: MaterializedCandidate[] = []
        const actorIds = new Set<EntityId>()
        let signalCount = 0
        let recordBytes = 0

        for (const candidate of candidates) {
          const nextActorIds = new Set([...actorIds, ...candidate.actorIds])
          const candidateBytes = Buffer.byteLength(JSON.stringify(candidate.record), 'utf8') + 1
          if (
            selected.length >= maximumRecords ||
            signalCount + candidate.outboxIds.length > maximumSignals ||
            nextActorIds.size > maximumActors ||
            recordBytes + candidateBytes > maximumRecordBytes
          ) {
            break
          }
          selected.push(candidate)
          signalCount += candidate.outboxIds.length
          recordBytes += candidateBytes
          candidate.actorIds.forEach((actorId) => actorIds.add(actorId))
        }

        if (selected.length === 0) {
          if (candidates[0] !== undefined) {
            throw new SnapshotValueError('BATCH_CAPACITY')
          }
          return null
        }

        stage = 'ACTORS'
        const actors = readActors(scopedConnection, actorIds)
        return Object.freeze({
          installationId: installation.installationId,
          locationId: installation.locationId,
          installationTimezone: installation.timezone,
          actors: Object.freeze(actors),
          records: Object.freeze(selected.map((candidate) => candidate.record)),
          outboxIds: Object.freeze(selected.flatMap((candidate) => candidate.outboxIds))
        })
      } catch (error) {
        throw new SnapshotMaterializationError({
          stage,
          rule:
            error instanceof SnapshotValueError
              ? error.rule
              : error instanceof RepositoryDataIntegrityError
                ? 'DATA_INTEGRITY'
                : 'DATABASE_READ',
          ...(error instanceof SnapshotValueError && error.field !== undefined
            ? { field: error.field }
            : {})
        })
      }
    }
  })
}

function readInstallationContext(connection: DatabaseTransactionConnection): InstallationContext {
  const row = connection
    .prepare<[], Record<string, unknown>>(
      `SELECT installation.id AS installation_id, installation.timezone,
              configuration.location_id
       FROM installation
       JOIN installation_location_configuration configuration
         ON configuration.installation_id = installation.id
       WHERE installation.singleton_id = 1 AND configuration.singleton_id = 1`
    )
    .get()
  if (row === undefined) throw new SnapshotValueError('MISSING_ROW')
  return Object.freeze({
    installationId: snapshotField('installation_id', () => parseEntityId(row.installation_id)),
    locationId: snapshotField('location_id', () => parseEntityId(row.location_id)),
    timezone: snapshotField('timezone', () => parseIanaTimeZone(row.timezone))
  })
}

function readEligibleSignals(
  connection: DatabaseTransactionConnection,
  now: UtcTimestamp
): readonly OutboxSignal[] {
  const operations = [...operationResource.keys()]
  const placeholders = operations.map(() => '?').join(', ')
  const parameters = [now, ...operations] as [string, ...string[]]
  const rows = connection
    .prepare<[string, ...string[]], Record<string, unknown>>(
      `SELECT id, aggregate_id, operation, created_at
       FROM sync_outbox
       WHERE status IN ('PENDING', 'FAILED')
         AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         AND operation IN (${placeholders})
       ORDER BY created_at, id
       LIMIT ${maximumSignals}`
    )
    .all(...parameters)

  return Object.freeze(
    rows.map((row) => {
      if (typeof row.operation !== 'string') throw new RepositoryDataIntegrityError()
      const resourceType = operationResource.get(row.operation)
      if (resourceType === undefined) throw new RepositoryDataIntegrityError()
      return Object.freeze({
        id: snapshotField('id', () => parseEntityId(row.id)),
        aggregateId: snapshotField('aggregate_id', () => parseEntityId(row.aggregate_id)),
        operation: row.operation,
        createdAt: snapshotField('created_at', () => parseUtcTimestamp(row.created_at)),
        resourceType
      })
    })
  )
}

function groupSignals(signals: readonly OutboxSignal[]): readonly SignalGroup[] {
  const groups = new Map<string, OutboxSignal[]>()
  for (const signal of signals) {
    const key = `${signal.resourceType}:${signal.aggregateId}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [signal])
    else group.push(signal)
  }
  return Object.freeze(
    [...groups.values()].map((group) =>
      Object.freeze({
        resourceType: group[0]!.resourceType,
        aggregateId: group[0]!.aggregateId,
        signals: Object.freeze(group)
      })
    )
  )
}

function materializeCandidate(
  connection: DatabaseTransactionConnection,
  lifestyleRepository: ReturnType<typeof createLifestyleRepository>,
  installation: InstallationContext,
  group: SignalGroup
): MaterializedCandidate | null {
  const latestSignal = group.signals[group.signals.length - 1]!
  const materialized =
    group.resourceType === 'PATIENT'
      ? materializePatient(connection, group.aggregateId, latestSignal)
      : group.resourceType === 'SCREENING_SESSION'
        ? materializeSession(connection, installation, group.aggregateId, latestSignal)
        : group.resourceType === 'SCREENING_ENCOUNTER'
          ? materializeEncounter(connection, installation, group.aggregateId, latestSignal)
          : group.resourceType === 'VITALS'
            ? materializeVitals(connection, installation, group.aggregateId, latestSignal)
            : group.resourceType === 'FOOD' || group.resourceType === 'OTC'
              ? materializeReportedIntake(
                  connection,
                  installation,
                  group.aggregateId,
                  latestSignal,
                  group.resourceType
                )
              : materializeLifestyle(
                  connection,
                  lifestyleRepository,
                  installation,
                  group.aggregateId,
                  latestSignal
                )

  if (materialized === null) return null
  return Object.freeze({
    record: materialized.record,
    actorIds: materialized.actorIds,
    outboxIds: Object.freeze(group.signals.map((signal) => signal.id))
  })
}

function materializePatient(
  connection: DatabaseTransactionConnection,
  patientId: EntityId,
  signal: OutboxSignal
): Pick<MaterializedCandidate, 'record' | 'actorIds'> {
  const row = requiredRow(
    connection,
    `SELECT p.*, (
       SELECT consent.status FROM consent_records consent
       WHERE consent.patient_id = p.id
         AND consent.consent_type = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
       ORDER BY consent.recorded_at DESC, consent.id DESC LIMIT 1
     ) AS acknowledgment_status
     FROM patients p WHERE p.id = ?`,
    patientId
  )
  const identifiers = connection
    .prepare<[string], { identifier_value: unknown }>(
      `SELECT identifier_value FROM patient_identifiers
       WHERE patient_id = ? AND identifier_type = 'CHS_MEDICAL_ID' AND status = 'ACTIVE'
       ORDER BY is_primary DESC, created_at DESC, id DESC LIMIT 2`
    )
    .all(patientId)
  if (identifiers.length > 1) throw new RepositoryDataIntegrityError()
  const knownChsMedicalId =
    identifiers[0] === undefined ? null : requiredString(identifiers[0].identifier_value)
  const actorId = snapshotField('updated_by', () => parseEntityId(row.updated_by))
  const sex =
    row.sex === null
      ? 'UNKNOWN'
      : snapshotField('sex', () => requiredEnum(row.sex, ['FEMALE', 'MALE', 'OTHER', 'UNKNOWN']))
  const acknowledgmentStatus =
    row.acknowledgment_status === null
      ? 'NOT_REQUESTED'
      : snapshotField('acknowledgment_status', () =>
          parsePatientAcknowledgmentHistoryStatus(row.acknowledgment_status)
        )

  return candidateRecord(
    {
      recordId: signal.id,
      resourceType: 'PATIENT',
      localResourceId: patientId,
      sourceRevision: snapshotField('row_version', () => positiveInteger(row.row_version)),
      schemaVersion: 'patient.v1',
      operation: 'UPSERT',
      capturedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at)),
      sourceActorLocalId: actorId,
      payload: jsonObject({
        localPatientCode: snapshotField('patient_code', () => requiredString(row.patient_code)),
        knownChsMedicalId,
        displayName: snapshotField('display_name', () => requiredString(row.display_name)),
        givenName: snapshotField('given_name', () => nullableString(row.given_name)),
        familyName: snapshotField('family_name', () => nullableString(row.family_name)),
        otherNames: snapshotField('other_names', () => nullableString(row.other_names)),
        dateOfBirth: snapshotField('date_of_birth', () => nullableString(row.date_of_birth)),
        approximateAgeYears: snapshotField('approximate_age_years', () =>
          nullableNumber(row.approximate_age_years)
        ),
        ageAsOfDate: snapshotField('age_as_of_date', () => nullableString(row.age_as_of_date)),
        sex,
        phone: snapshotField('phone', () => nullableString(row.phone)),
        alternateContactName: snapshotField('alternate_contact_name', () =>
          nullableString(row.alternate_contact_name)
        ),
        alternateContactPhone: snapshotField('alternate_contact_phone', () =>
          nullableString(row.alternate_contact_phone)
        ),
        village: snapshotField('village', () => nullableString(row.village)),
        quarter: snapshotField('quarter', () => nullableString(row.quarter)),
        residenceNotes: snapshotField('residence_notes', () => nullableString(row.residence_notes)),
        status: snapshotField('status', () => requiredEnum(row.status, ['ACTIVE', 'INACTIVE'])),
        acknowledgmentStatus,
        createdAt: snapshotField('created_at', () => parseUtcTimestamp(row.created_at)),
        updatedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at))
      })
    },
    [actorId]
  )
}

function materializeSession(
  connection: DatabaseTransactionConnection,
  installation: InstallationContext,
  sessionId: EntityId,
  signal: OutboxSignal
): Pick<MaterializedCandidate, 'record' | 'actorIds'> {
  const row = requiredRow(
    connection,
    `SELECT session.*, protocol.protocol_key, protocol.version_label, protocol.checksum
     FROM screening_sessions session
     JOIN protocol_versions protocol ON protocol.id = session.protocol_version_id
     WHERE session.id = ?`,
    sessionId
  )
  requireLocation(row.location_id, installation.locationId)
  const sourceActorId = snapshotField('updated_by', () => parseEntityId(row.updated_by))
  const openedBy = snapshotField('opened_by', () => parseEntityId(row.opened_by))
  const closedBy =
    row.closed_by === null ? null : snapshotField('closed_by', () => parseEntityId(row.closed_by))
  return candidateRecord(
    {
      recordId: signal.id,
      resourceType: 'SCREENING_SESSION',
      localResourceId: sessionId,
      sourceRevision: snapshotField('row_version', () => positiveInteger(row.row_version)),
      schemaVersion: 'screening-session.v1',
      operation: 'UPSERT',
      capturedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at)),
      sourceActorLocalId: sourceActorId,
      payload: jsonObject({
        localLocationId: installation.locationId,
        localProtocolVersionId: snapshotField('protocol_version_id', () =>
          parseEntityId(row.protocol_version_id)
        ),
        protocolKey: snapshotField('protocol_key', () => requiredString(row.protocol_key)),
        protocolVersionLabel: snapshotField('version_label', () =>
          requiredString(row.version_label)
        ),
        protocolChecksum: snapshotField('checksum', () => requiredString(row.checksum)),
        sessionDate: snapshotField('session_date', () => requiredString(row.session_date)),
        status: snapshotField('status', () => requiredEnum(row.status, ['OPEN', 'CLOSED'])),
        notes: snapshotField('notes', () => nullableString(row.notes)),
        openedByLocalActorId: openedBy,
        closedByLocalActorId: closedBy,
        openedAt: snapshotField('opened_at', () => parseUtcTimestamp(row.opened_at)),
        closedAt:
          row.closed_at === null
            ? null
            : snapshotField('closed_at', () => parseUtcTimestamp(row.closed_at)),
        createdAt: snapshotField('created_at', () => parseUtcTimestamp(row.created_at)),
        updatedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at))
      })
    },
    closedBy === null ? [sourceActorId, openedBy] : [sourceActorId, openedBy, closedBy]
  )
}

function materializeEncounter(
  connection: DatabaseTransactionConnection,
  installation: InstallationContext,
  encounterId: EntityId,
  signal: OutboxSignal
): Pick<MaterializedCandidate, 'record' | 'actorIds'> {
  const row = requiredRow(
    connection,
    'SELECT * FROM screening_encounters WHERE id = ?',
    encounterId
  )
  requireLocation(row.location_id, installation.locationId)
  const actorId = snapshotField('recorded_by', () => parseEntityId(row.recorded_by))
  return candidateRecord(
    {
      recordId: signal.id,
      resourceType: 'SCREENING_ENCOUNTER',
      localResourceId: encounterId,
      sourceRevision: snapshotField('record_version', () => positiveInteger(row.record_version)),
      schemaVersion: 'screening-encounter.v1',
      operation: 'UPSERT',
      capturedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at)),
      sourceActorLocalId: actorId,
      payload: jsonObject({
        localPatientId: snapshotField('patient_id', () => parseEntityId(row.patient_id)),
        localScreeningSessionId: snapshotField('screening_session_id', () =>
          parseEntityId(row.screening_session_id)
        ),
        localLocationId: installation.locationId,
        localProtocolVersionId: snapshotField('protocol_version_id', () =>
          parseEntityId(row.protocol_version_id)
        ),
        recordedByLocalActorId: actorId,
        status: snapshotField('status', () =>
          requiredEnum(row.status, ['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'])
        ),
        startedAt: snapshotField('started_at', () => parseUtcTimestamp(row.started_at)),
        completedAt:
          row.completed_at === null
            ? null
            : snapshotField('completed_at', () => parseUtcTimestamp(row.completed_at)),
        sourceType: snapshotField('source_type', () => requiredEnum(row.source_type, ['LOCAL'])),
        amendmentOfLocalEncounterId:
          row.amendment_of_encounter_id === null
            ? null
            : snapshotField('amendment_of_encounter_id', () =>
                parseEntityId(row.amendment_of_encounter_id)
              ),
        amendmentReason: snapshotField('amendment_reason', () =>
          nullableString(row.amendment_reason)
        ),
        voidReason: snapshotField('void_reason', () => nullableString(row.void_reason)),
        createdAt: snapshotField('created_at', () => parseUtcTimestamp(row.created_at)),
        updatedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at))
      })
    },
    [actorId]
  )
}

function materializeVitals(
  connection: DatabaseTransactionConnection,
  installation: InstallationContext,
  encounterId: EntityId,
  signal: OutboxSignal
): Pick<MaterializedCandidate, 'record' | 'actorIds'> | null {
  const row = connection
    .prepare<[string], Record<string, unknown>>(
      `SELECT vitals.*, encounter.recorded_by, encounter.location_id, session.session_date
       FROM screening_vitals_drafts vitals
       JOIN screening_encounters encounter ON encounter.id = vitals.encounter_id
       JOIN screening_sessions session ON session.id = encounter.screening_session_id
       WHERE vitals.encounter_id = ?`
    )
    .get(encounterId)
  if (row === undefined) return null
  requireLocation(row.location_id, installation.locationId)
  const readings = connection
    .prepare<[string], Record<string, unknown>>(
      `SELECT * FROM screening_vitals_draft_readings
       WHERE vitals_draft_id = ? ORDER BY sequence_number`
    )
    .all(snapshotField('id', () => parseEntityId(row.id)))
  if (readings.length === 0) return null
  const sourceActorId = snapshotField('updated_by', () => parseEntityId(row.updated_by))
  const performedBy = snapshotField('recorded_by', () => parseEntityId(row.recorded_by))
  const status = snapshotField('status', () =>
    requiredEnum(row.status, ['DRAFT', 'VITALS_COMPLETE'])
  )
  const payloadReadings = readings.map((reading, index) => {
    if (
      snapshotField('sequence_number', () => positiveInteger(reading.sequence_number)) !==
      index + 1
    ) {
      throw new SnapshotValueError('READING_ORDER', 'sequence_number')
    }
    if (
      status === 'VITALS_COMPLETE' &&
      [
        reading.systolic,
        reading.diastolic,
        reading.pulse,
        reading.measurement_site,
        reading.patient_position,
        reading.measurement_time
      ].some((value) => value === null)
    ) {
      throw new SnapshotValueError('INCOMPLETE_VITALS', 'readings')
    }
    return jsonObject({
      localReadingId: snapshotField('id', () => parseEntityId(reading.id)),
      sequenceNumber: snapshotField('sequence_number', () =>
        positiveInteger(reading.sequence_number)
      ),
      systolic: snapshotField('systolic', () => nullableNumber(reading.systolic)),
      diastolic: snapshotField('diastolic', () => nullableNumber(reading.diastolic)),
      pulse: snapshotField('pulse', () => nullableNumber(reading.pulse)),
      measurementSite: snapshotField('measurement_site', () =>
        nullableString(reading.measurement_site)
      ),
      patientPosition: snapshotField('patient_position', () =>
        nullableString(reading.patient_position)
      ),
      measurementLocalDate: snapshotField('session_date', () => requiredString(row.session_date)),
      measurementLocalTime: snapshotField('measurement_time', () =>
        nullableString(reading.measurement_time)
      ),
      measurementTimezone: installation.timezone,
      createdAt: snapshotField('created_at', () => parseUtcTimestamp(reading.created_at)),
      updatedAt: snapshotField('updated_at', () => parseUtcTimestamp(reading.updated_at))
    })
  })

  return candidateRecord(
    {
      recordId: signal.id,
      resourceType: 'VITALS',
      localResourceId: snapshotField('id', () => parseEntityId(row.id)),
      sourceRevision: snapshotField('row_version', () => positiveInteger(row.row_version)),
      schemaVersion: 'vitals.v1',
      operation: 'UPSERT',
      capturedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at)),
      sourceActorLocalId: sourceActorId,
      payload: jsonObject({
        localEncounterId: encounterId,
        performedByLocalActorId: performedBy,
        status,
        weightKg: snapshotField('weight_kg', () => nullableNumber(row.weight_kg)),
        waistCm: snapshotField('waist_cm', () => nullableNumber(row.waist_cm)),
        notes: snapshotField('notes', () => nullableString(row.notes)),
        createdAt: snapshotField('created_at', () => parseUtcTimestamp(row.created_at)),
        updatedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at)),
        readings: payloadReadings
      })
    },
    [sourceActorId, performedBy]
  )
}

function materializeLifestyle(
  connection: DatabaseTransactionConnection,
  lifestyleRepository: ReturnType<typeof createLifestyleRepository>,
  installation: InstallationContext,
  encounterId: EntityId,
  signal: OutboxSignal
): Pick<MaterializedCandidate, 'record' | 'actorIds'> | null {
  const draft = lifestyleRepository.findDraftByEncounterForWrite(connection, encounterId)
  if (draft === null || draft.status !== 'COMPLETE') return null
  if (
    draft.locationId !== installation.locationId ||
    draft.installationId !== installation.installationId
  ) {
    throw new RepositoryDataIntegrityError()
  }
  if (
    draft.alcoholBaselineVersionId === null ||
    draft.tobaccoBaselineVersionId === null ||
    draft.workBaselineVersionId === null ||
    draft.alcohol === null ||
    draft.tobacco === null ||
    draft.physicalActivity === null ||
    draft.work === null ||
    draft.otherActivityResponse === null
  ) {
    throw new SnapshotValueError('INCOMPLETE_LIFESTYLE')
  }
  const alcoholBaseline = lifestyleRepository.findAlcoholBaselineByIdForWrite(
    connection,
    draft.alcoholBaselineVersionId,
    draft.patientId,
    draft.installationId
  )
  const tobaccoBaseline = lifestyleRepository.findTobaccoBaselineByIdForWrite(
    connection,
    draft.tobaccoBaselineVersionId,
    draft.patientId,
    draft.installationId
  )
  const workBaseline = lifestyleRepository.findWorkBaselineByIdForWrite(
    connection,
    draft.workBaselineVersionId,
    draft.patientId,
    draft.installationId
  )
  if (alcoholBaseline === null || tobaccoBaseline === null || workBaseline === null) {
    throw new SnapshotValueError('MISSING_BASELINE')
  }

  const actorIds = collectLifestyleActorIds(draft, [alcoholBaseline, tobaccoBaseline, workBaseline])
  return candidateRecord(
    {
      recordId: signal.id,
      resourceType: 'LIFESTYLE',
      localResourceId: draft.id,
      sourceRevision: draft.rowVersion,
      schemaVersion: 'lifestyle.v1',
      operation: 'UPSERT',
      capturedAt: draft.updatedAt,
      sourceActorLocalId: draft.updatedBy,
      payload: jsonObject({
        localPatientId: draft.patientId,
        localEncounterId: draft.encounterId,
        localScreeningSessionId: draft.screeningSessionId,
        localLocationId: draft.locationId,
        status: 'COMPLETE',
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        createdByLocalActorId: draft.createdBy,
        createdAt: draft.createdAt,
        updatedByLocalActorId: draft.updatedBy,
        updatedAt: draft.updatedAt,
        baselines: {
          alcohol: {
            localBaselineVersionId: alcoholBaseline.id,
            version: alcoholBaseline.version,
            status: alcoholBaseline.status,
            everConsumed: alcoholBaseline.everConsumed,
            consumedPast12Months: alcoholBaseline.consumedPast12Months,
            commonBeverageTypes: alcoholBaseline.commonBeverageTypes,
            otherBeverageDescription: alcoholBaseline.otherBeverageDescription,
            createdByLocalActorId: alcoholBaseline.createdBy,
            createdAt: alcoholBaseline.createdAt,
            updatedByLocalActorId: alcoholBaseline.updatedBy,
            updatedAt: alcoholBaseline.updatedAt
          },
          tobacco: {
            localBaselineVersionId: tobaccoBaseline.id,
            version: tobaccoBaseline.version,
            status: tobaccoBaseline.status,
            everRegularlyUsed: tobaccoBaseline.everRegularlyUsed,
            formerUseApproximateStopDate: tobaccoBaseline.formerUseApproximateStopDate,
            currentUseFrequency: tobaccoBaseline.currentUseFrequency,
            productTypes: tobaccoBaseline.productTypes,
            otherProductDescription: tobaccoBaseline.otherProductDescription,
            createdByLocalActorId: tobaccoBaseline.createdBy,
            createdAt: tobaccoBaseline.createdAt,
            updatedByLocalActorId: tobaccoBaseline.updatedBy,
            updatedAt: tobaccoBaseline.updatedAt
          },
          work: {
            localBaselineVersionId: workBaseline.id,
            version: workBaseline.version,
            status: workBaseline.status,
            occupationJobTitle: workBaseline.occupationJobTitle,
            usualPhysicalDemand: workBaseline.usualPhysicalDemand,
            typicalWorkdaysPerWeek: workBaseline.typicalWorkdaysPerWeek,
            typicalHoursPerWorkday: workBaseline.typicalHoursPerWorkday,
            shiftPattern: workBaseline.shiftPattern,
            description: workBaseline.description,
            createdByLocalActorId: workBaseline.createdBy,
            createdAt: workBaseline.createdAt,
            updatedByLocalActorId: workBaseline.updatedBy,
            updatedAt: workBaseline.updatedAt
          }
        },
        alcohol: {
          localWeeklyRecordId: draft.alcohol.id,
          weeklyResponse: requiredString(draft.alcohol.weeklyResponse),
          drinkingDays: draft.alcohol.drinkingDays,
          totalStandardizedDrinks: draft.alcohol.totalStandardizedDrinks,
          largestOneDayAmount: draft.alcohol.largestOneDayAmount,
          daysAtLargestAmount: draft.alcohol.daysAtLargestAmount,
          commonBeverageTypes: draft.alcohol.commonBeverageTypes,
          otherBeverageDescription: draft.alcohol.otherBeverageDescription,
          createdByLocalActorId: draft.alcohol.createdBy,
          createdAt: draft.alcohol.createdAt,
          updatedByLocalActorId: draft.alcohol.updatedBy,
          updatedAt: draft.alcohol.updatedAt
        },
        tobacco: {
          localWeeklyRecordId: draft.tobacco.id,
          weeklyResponse: requiredString(draft.tobacco.weeklyResponse),
          products: draft.tobacco.products.map((product) => ({
            localProductRowId: product.id,
            sequenceNumber: product.sequenceNumber,
            productType: product.productType,
            daysUsed: product.daysUsed,
            averageQuantityPerUseDay: product.averageQuantityPerUseDay,
            unit: product.unit,
            secondhandSmokeExposure: product.secondhandSmokeExposure,
            otherProductDescription: product.otherProductDescription,
            otherUnitDescription: product.otherUnitDescription,
            createdByLocalActorId: product.createdBy,
            createdAt: product.createdAt,
            updatedByLocalActorId: product.updatedBy,
            updatedAt: product.updatedAt
          })),
          createdByLocalActorId: draft.tobacco.createdBy,
          createdAt: draft.tobacco.createdAt,
          updatedByLocalActorId: draft.tobacco.updatedBy,
          updatedAt: draft.tobacco.updatedAt
        },
        physicalActivity: {
          localWeeklyRecordId: draft.physicalActivity.id,
          weeklyResponse: requiredString(draft.physicalActivity.weeklyResponse),
          sedentaryTimeResponse: requiredString(draft.physicalActivity.sedentaryTimeResponse),
          sedentaryMinutesPerDay: draft.physicalActivity.sedentaryMinutesPerDay,
          activities: draft.physicalActivity.activities.map((activity) => ({
            localActivityRowId: activity.id,
            sequenceNumber: activity.sequenceNumber,
            activityDomain: activity.activityDomain,
            description: activity.description,
            intensity: activity.intensity,
            daysInPastSevenDays: activity.daysInPastSevenDays,
            averageMinutesPerActiveDay: activity.averageMinutesPerActiveDay,
            createdByLocalActorId: activity.createdBy,
            createdAt: activity.createdAt,
            updatedByLocalActorId: activity.updatedBy,
            updatedAt: activity.updatedAt
          })),
          createdByLocalActorId: draft.physicalActivity.createdBy,
          createdAt: draft.physicalActivity.createdAt,
          updatedByLocalActorId: draft.physicalActivity.updatedBy,
          updatedAt: draft.physicalActivity.updatedAt
        },
        work: {
          localWeeklyRecordId: draft.work.id,
          weeklyResponse: requiredString(draft.work.weeklyResponse),
          createdByLocalActorId: draft.work.createdBy,
          createdAt: draft.work.createdAt,
          updatedByLocalActorId: draft.work.updatedBy,
          updatedAt: draft.work.updatedAt
        },
        otherActivity: {
          weeklyResponse: draft.otherActivityResponse,
          activities: draft.otherActivities.map((activity) => ({
            localActivityRowId: activity.id,
            sequenceNumber: activity.sequenceNumber,
            category: activity.category,
            description: activity.description,
            daysInPastSevenDays: activity.daysInPastSevenDays,
            averageMinutesPerDay: activity.averageMinutesPerDay,
            intensity: activity.intensity,
            createdByLocalActorId: activity.createdBy,
            createdAt: activity.createdAt,
            updatedByLocalActorId: activity.updatedBy,
            updatedAt: activity.updatedAt
          }))
        }
      })
    },
    actorIds
  )
}

function materializeReportedIntake(
  connection: DatabaseTransactionConnection,
  installation: InstallationContext,
  encounterId: EntityId,
  signal: OutboxSignal,
  resourceType: 'FOOD' | 'OTC'
): Pick<MaterializedCandidate, 'record' | 'actorIds'> | null {
  const encounter = requiredRow(
    connection,
    'SELECT * FROM screening_encounters WHERE id = ?',
    encounterId
  )
  requireLocation(encounter.location_id, installation.locationId)
  if (encounter.source_type !== 'LOCAL') return null
  if (encounter.status === 'DRAFT' || encounter.completed_at === null) return null
  const completedAt = parseUtcTimestamp(encounter.completed_at)
  const table = resourceType === 'FOOD' ? 'food_logs' : 'otc_medication_logs'
  const rows = connection
    .prepare<[string], Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE encounter_id = ? ORDER BY id LIMIT 101`
    )
    .all(encounterId)
  if (rows.length > 100) throw new RepositoryDataIntegrityError()
  const audit = connection
    .prepare<[string, string], { user_id: unknown }>(
      `SELECT user_id FROM audit_log WHERE entity_id = ? AND action = 'SCREENING_ENCOUNTER_COMPLETED'
     AND occurred_at = ? ORDER BY id LIMIT 1`
    )
    .get(encounterId, completedAt)
  const actorId = parseEntityId(audit?.user_id ?? rows[0]?.recorded_by ?? encounter.recorded_by)
  const draftTable = resourceType === 'FOOD' ? 'food_drafts' : 'otc_drafts'
  const draft = connection
    .prepare<[string], Record<string, unknown>>(
      `SELECT * FROM ${draftTable} WHERE encounter_id = ?`
    )
    .get(encounterId)
  if (
    draft &&
    (draft.patient_id !== encounter.patient_id ||
      draft.location_id !== installation.locationId ||
      draft.installation_id !== installation.installationId ||
      draft.screening_session_id !== encounter.screening_session_id)
  ) {
    throw new RepositoryDataIntegrityError()
  }
  const payloadRows = rows.map((row) => {
    const common = {
      localRowId: snapshotField('id', () => parseEntityId(row.id)),
      recordedByLocalActorId: snapshotField('recorded_by', () => parseEntityId(row.recorded_by)),
      recordedAt: snapshotField('recorded_at', () => parseUtcTimestamp(row.recorded_at)),
      sourceType: snapshotField('source_type', () =>
        requiredEnum(row.source_type, ['PATIENT_REPORTED'])
      )
    }
    if (common.recordedAt !== completedAt) throw new RepositoryDataIntegrityError()
    return resourceType === 'FOOD'
      ? {
          ...common,
          foodCode: snapshotField('food_code', () => nullableString(row.food_code)),
          foodName: snapshotField('food_name', () => requiredString(row.food_name)),
          frequencyCode:
            row.frequency_code === null
              ? null
              : snapshotField('frequency_code', () =>
                  requiredEnum(row.frequency_code, [
                    '1_DAY',
                    '2_TO_3_DAYS',
                    '4_TO_6_DAYS',
                    'EVERY_DAY'
                  ])
                ),
          preparationNote: snapshotField('notes', () => nullableString(row.notes))
        }
      : {
          ...common,
          productName: snapshotField('product_name', () => requiredString(row.product_name)),
          reasonForUse: snapshotField('reason_for_use', () => requiredString(row.reason_for_use)),
          doseText: snapshotField('dose_text', () => nullableString(row.dose_text)),
          frequencyText: snapshotField('frequency_text', () => nullableString(row.frequency_text)),
          durationText: snapshotField('duration_text', () => nullableString(row.duration_text)),
          sourceOfMedication: snapshotField('source_of_medication', () =>
            nullableString(row.source_of_medication)
          ),
          currentlyTaking:
            row.currently_taking === null
              ? null
              : snapshotField('currently_taking', () => sqliteBoolean(row.currently_taking))
        }
  })
  return candidateRecord(
    {
      recordId: signal.id,
      resourceType,
      localResourceId: encounterId,
      sourceRevision: 1,
      schemaVersion: resourceType === 'FOOD' ? 'food.v1' : 'otc.v1',
      operation: 'UPSERT',
      capturedAt: completedAt,
      sourceActorLocalId: actorId,
      payload: jsonObject({
        localEncounterId: encounterId,
        completedAt,
        recordedByLocalActorId: actorId,
        periodStart: draft
          ? snapshotField('period_start', () => requiredString(draft.period_start))
          : null,
        periodEnd: draft
          ? snapshotField('period_end', () => requiredString(draft.period_end))
          : null,
        response: draft
          ? nullableString(draft[resourceType === 'FOOD' ? 'food_response' : 'otc_response'])
          : null,
        rows: payloadRows
      })
    },
    [actorId, ...payloadRows.map((row) => row.recordedByLocalActorId)]
  )
}

function collectLifestyleActorIds(
  draft: LifestyleDraftRecord,
  baselines: readonly {
    readonly createdBy: EntityId
    readonly updatedBy: EntityId
  }[]
): readonly EntityId[] {
  const actorIds: EntityId[] = [draft.createdBy, draft.updatedBy]
  for (const baseline of baselines) actorIds.push(baseline.createdBy, baseline.updatedBy)
  for (const weekly of [draft.alcohol, draft.tobacco, draft.physicalActivity, draft.work]) {
    if (weekly !== null) actorIds.push(weekly.createdBy, weekly.updatedBy)
  }
  for (const product of draft.tobacco?.products ?? []) {
    actorIds.push(product.createdBy, product.updatedBy)
  }
  for (const activity of draft.physicalActivity?.activities ?? []) {
    actorIds.push(activity.createdBy, activity.updatedBy)
  }
  for (const activity of draft.otherActivities) {
    actorIds.push(activity.createdBy, activity.updatedBy)
  }
  return actorIds
}

function readActors(
  connection: DatabaseTransactionConnection,
  actorIds: ReadonlySet<EntityId>
): readonly MaterializedSyncActor[] {
  const orderedIds = [...actorIds].sort()
  if (orderedIds.length === 0) throw new RepositoryDataIntegrityError()
  const placeholders = orderedIds.map(() => '?').join(', ')
  const parameters: [string, ...string[]] = [orderedIds[0]!, ...orderedIds.slice(1)]
  const rows = connection
    .prepare<[string, ...string[]], Record<string, unknown>>(
      `SELECT id, display_name, role, is_active, updated_at FROM users
       WHERE id IN (${placeholders}) ORDER BY id`
    )
    .all(...parameters)
  if (rows.length !== orderedIds.length) throw new SnapshotValueError('MISSING_ACTOR')
  return rows.map((row) =>
    Object.freeze({
      localActorId: snapshotField('id', () => parseEntityId(row.id)),
      displayName: snapshotField('display_name', () => parseUserDisplayName(row.display_name)),
      role: snapshotField('role', () => parseLocalUserRole(row.role)),
      active: snapshotField('is_active', () => sqliteBoolean(row.is_active)),
      updatedAt: snapshotField('updated_at', () => parseUtcTimestamp(row.updated_at))
    })
  )
}

function candidateRecord(
  record: MaterializedSyncRecord,
  actorIds: readonly EntityId[]
): Pick<MaterializedCandidate, 'record' | 'actorIds'> {
  return Object.freeze({ record: Object.freeze(record), actorIds: new Set(actorIds) })
}

function compareCandidates(left: MaterializedCandidate, right: MaterializedCandidate): number {
  return (
    resourceOrder[left.record.resourceType] - resourceOrder[right.record.resourceType] ||
    left.record.localResourceId.localeCompare(right.record.localResourceId)
  )
}

function requiredRow(
  connection: DatabaseTransactionConnection,
  sql: string,
  id: EntityId
): Record<string, unknown> {
  const row = connection.prepare<[string], Record<string, unknown>>(sql).get(id)
  if (row === undefined) throw new SnapshotValueError('MISSING_ROW')
  return row
}

function requireLocation(value: unknown, expected: EntityId): void {
  if (parseEntityId(value) !== expected)
    throw new SnapshotValueError('LOCATION_MISMATCH', 'location_id')
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new RepositoryDataIntegrityError()
  return value
}

function nullableString(value: unknown): string | null {
  if (value === null) return null
  return requiredString(value)
}

function nullableNumber(value: unknown): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RepositoryDataIntegrityError()
  return value
}

function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryDataIntegrityError()
  }
  return value
}

function requiredEnum<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new RepositoryDataIntegrityError()
  }
  return value as T
}

function sqliteBoolean(value: unknown): boolean {
  if (value !== 0 && value !== 1) throw new RepositoryDataIntegrityError()
  return value === 1
}

function jsonObject(value: Record<string, unknown>): Readonly<{
  [key: string]: MaterializedSyncJsonValue
}> {
  return value as Readonly<{ [key: string]: MaterializedSyncJsonValue }>
}
