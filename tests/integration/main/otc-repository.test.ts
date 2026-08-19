import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createOtcRepository,
  createProductionDatabaseMigrationRunner,
  RepositoryValidationError,
  type DatabaseTransactionExecutor,
  type OtcDate,
  type OtcDraftRecord,
  type OtcDraftRowInput,
  type OtcRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const ids = Object.freeze({
  installation: 'd1000000-0000-4000-8000-000000000001',
  user: 'd1000000-0000-4000-8000-000000000002',
  location: 'd1000000-0000-4000-8000-000000000003',
  patient: 'd1000000-0000-4000-8000-000000000004',
  otherPatient: 'd1000000-0000-4000-8000-000000000005',
  session: 'd1000000-0000-4000-8000-000000000006',
  priorSession: 'd1000000-0000-4000-8000-000000000015',
  encounter: 'd1000000-0000-4000-8000-000000000007',
  otherEncounter: 'd1000000-0000-4000-8000-000000000008',
  priorEncounter: 'd1000000-0000-4000-8000-000000000014',
  draft: 'd1000000-0000-4000-8000-000000000009',
  otherDraft: 'd1000000-0000-4000-8000-000000000010',
  row1: 'd1000000-0000-4000-8000-000000000011',
  row2: 'd1000000-0000-4000-8000-000000000012',
  row3: 'd1000000-0000-4000-8000-000000000013'
})

const firstTime = '2026-08-10T12:00:00.000Z' as UtcTimestamp
const secondTime = '2026-08-10T13:00:00.000Z' as UtcTimestamp
const thirdTime = '2026-08-10T14:00:00.000Z' as UtcTimestamp
const periodStart = '2026-08-04' as OtcDate
const periodEnd = '2026-08-10' as OtcDate

describe('OTC repository foundation', () => {
  it('creates an empty draft and loads it by encounter', async () => {
    await withOtcDatabase(({ repository, executor }) => {
      const draft = insertDraft(executor, repository)

      expect(draft).toMatchObject({
        encounterId: ids.encounter,
        otcResponse: null,
        rowVersion: 1,
        rows: []
      })
      expect(repository.findDraftByEncounter(parseEntityId(ids.encounter))).toMatchObject({
        id: ids.draft,
        periodStart,
        periodEnd
      })
    })
  })

  it('persists meaningful partial rows under REPORTED and unfinished NULL drafts', async () => {
    await withOtcDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const reported = saveRows(executor, repository, draft, 'REPORTED', [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          productNameSnapshot: null,
          reasonForUse: '  headache  '
        }),
        rowInput({
          id: ids.row2,
          sequenceNumber: 2,
          productNameSnapshot: null,
          reasonForUse: null,
          doseText: '  1 tablet  '
        })
      ])

      expect(reported.rows).toEqual([
        expect.objectContaining({
          productNameSnapshot: null,
          productNameNormalized: null,
          reasonForUse: 'headache'
        }),
        expect.objectContaining({
          productNameSnapshot: null,
          doseText: '1 tablet'
        })
      ])

      const unfinished = saveRows(executor, repository, reported, null, [
        rowInput({
          id: ids.row1,
          sequenceNumber: 1,
          productNameSnapshot: null,
          reasonForUse: 'headache'
        })
      ])
      expect(unfinished).toMatchObject({
        otcResponse: null,
        rows: [expect.objectContaining({ reasonForUse: 'headache' })]
      })
    })
  })

  it('adds, updates, removes, and reorders rows without rewriting unchanged children', async () => {
    await withOtcDatabase(({ connection, executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const first = saveRows(executor, repository, draft, 'REPORTED', [
        rowInput({ id: ids.row1, sequenceNumber: 1, productNameSnapshot: 'Pain reliever' }),
        rowInput({ id: ids.row2, sequenceNumber: 2, productNameSnapshot: 'Cough syrup' })
      ])
      const row1CreatedAt = first.rows[0]?.createdAt

      const second = saveRows(executor, repository, first, 'REPORTED', [
        rowInput({
          id: ids.row2,
          sequenceNumber: 1,
          productNameSnapshot: 'Cough syrup',
          frequencyText: 'twice daily'
        }),
        rowInput({
          id: ids.row1,
          sequenceNumber: 2,
          productNameSnapshot: 'Pain reliever',
          currentlyTakingResponse: 'YES'
        }),
        rowInput({ id: ids.row3, sequenceNumber: 3, productNameSnapshot: 'Antacid' })
      ])

      expect(second.rows.map((row) => row.id)).toEqual([ids.row2, ids.row1, ids.row3])
      expect(second.rows.find((row) => row.id === ids.row1)?.createdAt).toBe(row1CreatedAt)
      expect(readCount(connection, 'otc_draft_rows')).toBe(3)

      const third = saveRows(executor, repository, second, 'REPORTED', [
        rowInput({ id: ids.row1, sequenceNumber: 1, productNameSnapshot: 'Pain reliever' })
      ])
      expect(third.rows.map((row) => row.id)).toEqual([ids.row1])
      expect(readCount(connection, 'otc_draft_rows')).toBe(1)
    })
  })

  it('clears rows for explicit non-reported responses and allows REPORTED with zero rows', async () => {
    await withOtcDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const reported = saveRows(executor, repository, draft, 'REPORTED', [
        rowInput({ id: ids.row1, sequenceNumber: 1 })
      ])

      const none = saveRows(executor, repository, reported, 'NONE_REPORTED', [])
      expect(none).toMatchObject({ otcResponse: 'NONE_REPORTED', rows: [] })

      const reportedEmpty = saveRows(executor, repository, none, 'REPORTED', [])
      expect(reportedEmpty).toMatchObject({ otcResponse: 'REPORTED', rows: [] })
    })
  })

  it('returns idempotent equivalent retry and rejects stale non-equivalent saves', async () => {
    await withOtcDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const saved = saveRows(executor, repository, draft, 'REPORTED', [
        rowInput({ id: ids.row1, sequenceNumber: 1 })
      ])
      const rowUpdatedAt = saved.rows[0]?.updatedAt

      const equivalentStale = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: 1,
          otcResponse: 'REPORTED',
          rows: [rowInput({ id: ids.row1, sequenceNumber: 1 })],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(equivalentStale.status).toBe('UNCHANGED')
      if (equivalentStale.status === 'UNCHANGED') {
        expect(equivalentStale.draft.rowVersion).toBe(saved.rowVersion)
        expect(equivalentStale.draft.rows[0]?.updatedAt).toBe(rowUpdatedAt)
      }

      const conflict = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: 1,
          otcResponse: 'REPORTED',
          rows: [rowInput({ id: ids.row1, sequenceNumber: 1, doseText: 'changed' })],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(conflict.status).toBe('VERSION_CONFLICT')
    })
  })

  it('canonicalizes equivalent rows by sequence instead of request-array order', async () => {
    await withOtcDatabase(({ connection, executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const saved = saveRows(executor, repository, draft, 'REPORTED', [
        rowInput({ id: ids.row1, sequenceNumber: 1, productNameSnapshot: 'Pain reliever' }),
        rowInput({ id: ids.row2, sequenceNumber: 2, productNameSnapshot: 'Cough syrup' })
      ])
      const before = repository.findDraftByEncounter(parseEntityId(ids.encounter))
      if (!before) throw new Error('missing draft')
      const beforeChildTimestamps = before.rows.map((row) => row.updatedAt)
      const reverseArray = [
        rowInput({ id: ids.row2, sequenceNumber: 2, productNameSnapshot: 'Cough syrup' }),
        rowInput({ id: ids.row1, sequenceNumber: 1, productNameSnapshot: 'Pain reliever' })
      ]

      const currentEquivalent = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: saved.rowVersion,
          otcResponse: 'REPORTED',
          rows: reverseArray,
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(currentEquivalent.status).toBe('UNCHANGED')

      const staleEquivalent = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: 1,
          otcResponse: 'REPORTED',
          rows: reverseArray,
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(staleEquivalent.status).toBe('UNCHANGED')

      const afterEquivalent = repository.findDraftByEncounter(parseEntityId(ids.encounter))
      if (!afterEquivalent) throw new Error('missing equivalent draft')
      expect(afterEquivalent.rowVersion).toBe(before.rowVersion)
      expect(afterEquivalent.updatedAt).toBe(before.updatedAt)
      expect(afterEquivalent.rows.map((row) => row.updatedAt)).toEqual(beforeChildTimestamps)
      expect(afterEquivalent.rows.map((row) => row.id)).toEqual([ids.row1, ids.row2])

      const reordered = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: afterEquivalent.rowVersion,
          otcResponse: 'REPORTED',
          rows: [
            rowInput({ id: ids.row1, sequenceNumber: 2, productNameSnapshot: 'Pain reliever' }),
            rowInput({ id: ids.row2, sequenceNumber: 1, productNameSnapshot: 'Cough syrup' })
          ],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(reordered.status).toBe('UPDATED')
      if (reordered.status !== 'UPDATED') return

      const changed = executor.run((context) =>
        repository.updateDraft(context.connection, {
          id: saved.id,
          expectedRowVersion: reordered.draft.rowVersion,
          otcResponse: 'REPORTED',
          rows: [
            rowInput({
              id: ids.row1,
              sequenceNumber: 2,
              productNameSnapshot: 'Pain reliever',
              doseText: 'changed'
            }),
            rowInput({ id: ids.row2, sequenceNumber: 1, productNameSnapshot: 'Cough syrup' })
          ],
          actorId: parseEntityId(ids.user),
          occurredAt: thirdTime
        })
      )
      expect(changed.status).toBe('UPDATED')
      expect(readCount(connection, 'otc_draft_rows')).toBe(2)
    })
  })

  it('rejects malformed values and wrong-draft child-row ownership violations', async () => {
    await withOtcDatabase(({ executor, repository }) => {
      const draft = insertDraft(executor, repository)
      const otherDraft = insertDraft(executor, repository, {
        id: ids.otherDraft,
        encounterId: ids.otherEncounter,
        patientId: ids.otherPatient
      })
      const savedOther = saveRows(executor, repository, otherDraft, 'REPORTED', [
        rowInput({ id: ids.row1, sequenceNumber: 1 })
      ])

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            otcResponse: 'REPORTED',
            rows: [rowInput({ id: savedOther.rows[0]!.id, sequenceNumber: 1 })],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            otcResponse: 'REPORTED',
            rows: [rowInput({ id: ids.row2, sequenceNumber: 1, productNameSnapshot: '   ' })],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            otcResponse: 'REPORTED',
            rows: [
              rowInput({ id: ids.row1, sequenceNumber: 1 }),
              rowInput({ id: ids.row2, sequenceNumber: 1 })
            ],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)

      expect(() =>
        executor.run((context) =>
          repository.updateDraft(context.connection, {
            id: draft.id,
            expectedRowVersion: draft.rowVersion,
            otcResponse: 'REPORTED',
            rows: [
              rowInput({ id: ids.row1, sequenceNumber: 1 }),
              rowInput({ id: ids.row1, sequenceNumber: 2 })
            ],
            actorId: parseEntityId(ids.user),
            occurredAt: thirdTime
          })
        )
      ).toThrow(RepositoryValidationError)
    })
  })

  it('loads up to ten distinct recent patient medications from completed prior encounters only', async () => {
    await withOtcDatabase(({ connection, repository }) => {
      seedRecentOtcLogs(connection)

      const recent = repository.listRecentPatientMedications(
        parseEntityId(ids.patient),
        parseEntityId(ids.encounter)
      )

      expect(recent).toHaveLength(10)
      expect(recent[0]).toMatchObject({
        productNameSnapshot: 'Pain reliever latest',
        productNameNormalized: 'pain reliever'
      })
      expect(recent.map((item) => item.productNameNormalized)).not.toContain('current')
      expect(recent.map((item) => item.productNameNormalized)).not.toContain('draft only')
      expect(recent.map((item) => item.productNameNormalized)).not.toContain('other patient')
    })
  })
})

async function withOtcDatabase(
  test: (context: {
    readonly connection: Database.Database
    readonly executor: DatabaseTransactionExecutor
    readonly repository: OtcRepository
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd048-otc-repository-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => firstTime)
    })(connection)
    seedCoreGraph(connection)
    const executor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => ids.row3),
      clock: createUtcClock(() => firstTime)
    })
    test({ connection, executor, repository: createOtcRepository(connection) })
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function insertDraft(
  executor: DatabaseTransactionExecutor,
  repository: OtcRepository,
  overrides: {
    readonly id?: string
    readonly encounterId?: string
    readonly patientId?: string
  } = {}
): OtcDraftRecord {
  return executor.run((context) =>
    repository.insertDraft(context.connection, {
      id: parseEntityId(overrides.id ?? ids.draft),
      encounterId: parseEntityId(overrides.encounterId ?? ids.encounter),
      patientId: parseEntityId(overrides.patientId ?? ids.patient),
      screeningSessionId: parseEntityId(ids.session),
      locationId: parseEntityId(ids.location),
      installationId: parseEntityId(ids.installation),
      periodStart,
      periodEnd,
      actorId: parseEntityId(ids.user),
      occurredAt: firstTime
    })
  )
}

function saveRows(
  executor: DatabaseTransactionExecutor,
  repository: OtcRepository,
  draft: OtcDraftRecord,
  otcResponse: OtcDraftRecord['otcResponse'],
  rows: readonly OtcDraftRowInput[]
): OtcDraftRecord {
  const result = executor.run((context) =>
    repository.updateDraft(context.connection, {
      id: draft.id,
      expectedRowVersion: draft.rowVersion,
      otcResponse,
      rows,
      actorId: parseEntityId(ids.user),
      occurredAt: secondTime
    })
  )
  if (result.status !== 'UPDATED') throw new Error(`Unexpected ${result.status}`)
  return result.draft
}

type RowOverrides = Omit<Partial<OtcDraftRowInput>, 'id'> & {
  readonly id?: string | OtcDraftRowInput['id']
}

function rowInput(overrides: RowOverrides = {}): OtcDraftRowInput {
  return {
    id: parseEntityId(overrides.id ?? ids.row1),
    sequenceNumber: overrides.sequenceNumber ?? 1,
    productNameSnapshot: hasOverride(overrides, 'productNameSnapshot')
      ? overrides.productNameSnapshot!
      : 'Pain reliever',
    reasonForUse: hasOverride(overrides, 'reasonForUse') ? overrides.reasonForUse! : null,
    doseText: hasOverride(overrides, 'doseText') ? overrides.doseText! : null,
    frequencyText: hasOverride(overrides, 'frequencyText') ? overrides.frequencyText! : null,
    durationText: hasOverride(overrides, 'durationText') ? overrides.durationText! : null,
    sourceOfMedication: hasOverride(overrides, 'sourceOfMedication')
      ? overrides.sourceOfMedication!
      : null,
    currentlyTakingResponse: hasOverride(overrides, 'currentlyTakingResponse')
      ? overrides.currentlyTakingResponse!
      : null,
    sourceType: overrides.sourceType ?? 'PATIENT_REPORTED'
  }
}

function hasOverride<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function seedCoreGraph(connection: Database.Database): void {
  seedInstallationUserLocation(connection)
  seedPatientSessionEncounter(connection, ids.patient, ids.encounter, 'DRAFT')
  seedPatientSessionEncounter(connection, ids.otherPatient, ids.otherEncounter, 'DRAFT', 'TEST-2')
}

function seedInstallationUserLocation(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', firstTime, firstTime)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(
      ids.user,
      'tester',
      'tester',
      'Test User',
      'hash',
      'salt',
      'TRAINED_SCREENER',
      firstTime,
      firstTime
    )
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(
      ids.location,
      'Test Location',
      'test location',
      'COMMUNITY_SITE',
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  seedScreeningSession(connection, ids.session)
}

function seedScreeningSession(
  connection: Database.Database,
  sessionId: string,
  sessionDate = '2026-08-10'
): void {
  const protocolId = readActiveProtocolId(connection)
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      sessionId,
      ids.location,
      protocolId,
      sessionDate,
      'OPEN',
      ids.user,
      firstTime,
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
}

function seedPatientSessionEncounter(
  connection: Database.Database,
  patientId: string,
  encounterId: string,
  encounterStatus: 'DRAFT' | 'COMPLETED',
  patientCode = 'TEST-1'
): void {
  const protocolId = readActiveProtocolId(connection)
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      patientId,
      patientCode,
      `Patient ${patientCode}`,
      `patient ${patientCode.toLowerCase()}`,
      'ACTIVE',
      ids.user,
      firstTime,
      ids.user,
      firstTime
    )
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      encounterId,
      patientId,
      ids.session,
      ids.location,
      protocolId,
      encounterStatus,
      firstTime,
      encounterStatus === 'COMPLETED' ? firstTime : null,
      'LOCAL',
      ids.user,
      firstTime,
      firstTime
    )
}

function seedRecentOtcLogs(connection: Database.Database): void {
  seedScreeningSession(connection, ids.priorSession, '2026-08-09')
  seedEncounterOnly(connection, ids.patient, ids.priorEncounter, 'COMPLETED')
  insertOtcLog(connection, 'd1000000-0000-4000-8000-000000000101', ids.priorEncounter, {
    productName: 'Pain reliever old',
    normalizedName: 'pain reliever',
    recordedAt: '2026-08-01T12:00:00.000Z'
  })
  insertOtcLog(connection, 'd1000000-0000-4000-8000-000000000102', ids.priorEncounter, {
    productName: 'Pain reliever latest',
    normalizedName: 'pain reliever',
    recordedAt: '2026-08-09T12:00:00.000Z'
  })
  for (let index = 0; index < 11; index += 1) {
    insertOtcLog(
      connection,
      `d1000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
      ids.priorEncounter,
      {
        productName: `Medication ${index}`,
        normalizedName: `medication ${index}`,
        recordedAt: `2026-08-${String(8 - Math.min(index, 7)).padStart(2, '0')}T12:00:00.000Z`
      }
    )
  }
  insertOtcLog(connection, 'd1000000-0000-4000-8000-000000000301', ids.encounter, {
    productName: 'Current',
    normalizedName: 'current',
    recordedAt: thirdTime
  })
  connection
    .prepare("UPDATE screening_encounters SET status = 'DRAFT', completed_at = NULL WHERE id = ?")
    .run(ids.encounter)
  insertOtcLog(connection, 'd1000000-0000-4000-8000-000000000302', ids.encounter, {
    productName: 'Draft only',
    normalizedName: 'draft only',
    recordedAt: thirdTime
  })
  connection
    .prepare("UPDATE screening_encounters SET status = 'COMPLETED', completed_at = ? WHERE id = ?")
    .run(firstTime, ids.otherEncounter)
  insertOtcLog(connection, 'd1000000-0000-4000-8000-000000000303', ids.otherEncounter, {
    productName: 'Other patient',
    normalizedName: 'other patient',
    recordedAt: thirdTime
  })
}

function insertOtcLog(
  connection: Database.Database,
  id: string,
  encounterId: string,
  {
    productName,
    normalizedName,
    recordedAt
  }: {
    readonly productName: string
    readonly normalizedName: string
    readonly recordedAt: string
  }
): void {
  connection
    .prepare(
      'INSERT INTO otc_medication_logs (id, encounter_id, product_name, product_name_normalized, reason_for_use, dose_text, frequency_text, duration_text, source_of_medication, currently_taking, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 1, ?, ?, ?)'
    )
    .run(
      id,
      encounterId,
      productName,
      normalizedName,
      'reason',
      'PATIENT_REPORTED',
      ids.user,
      recordedAt
    )
}

function seedEncounterOnly(
  connection: Database.Database,
  patientId: string,
  encounterId: string,
  encounterStatus: 'DRAFT' | 'COMPLETED'
): void {
  const protocolId = readActiveProtocolId(connection)
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
    )
    .run(
      encounterId,
      patientId,
      encounterId === ids.priorEncounter ? ids.priorSession : ids.session,
      ids.location,
      protocolId,
      encounterStatus,
      firstTime,
      encounterStatus === 'COMPLETED' ? firstTime : null,
      'LOCAL',
      ids.user,
      firstTime,
      firstTime
    )
}

function readActiveProtocolId(connection: Database.Database): string {
  return (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as { id: string }
  ).id
}

function readCount(connection: Database.Database, tableName: string): number {
  return (
    connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as { count: number }
  ).count
}
