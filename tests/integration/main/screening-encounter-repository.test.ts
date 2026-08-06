import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterRepository,
  DatabaseTransactionStateError,
  RepositoryDataIntegrityError,
  RepositoryWriteError,
  type DatabaseTransactionExecutor,
  type InsertCanonicalRootScreeningEncounterInput,
  type ScreeningEncounterRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'

const now = '2026-08-06T12:00:00.000Z'
const userId = '10000000-0000-4000-8000-000000000001'
const locationId = '10000000-0000-4000-8000-000000000002'
const protocolId = '10000000-0000-4000-8000-000000000003'
const patientId = '10000000-0000-4000-8000-000000000004'
const secondPatientId = '10000000-0000-4000-8000-000000000005'
const sessionId = '10000000-0000-4000-8000-000000000006'
const secondSessionId = '10000000-0000-4000-8000-000000000007'
const encounterId = '10000000-0000-4000-8000-000000000008'
const duplicateEncounterId = '10000000-0000-4000-8000-000000000009'
const amendmentEncounterId = '10000000-0000-4000-8000-000000000010'
const voidEncounterId = '10000000-0000-4000-8000-000000000011'
const generatedId = '10000000-0000-4000-8000-000000000012'

describe('screening encounter repository', () => {
  it('creates and retrieves canonical root DRAFT encounters without clinical side effects', async () => {
    await withScreeningEncounterRepository(({ connection, repository, executor }) => {
      insertReferenceGraph(connection)

      const created = executor.run((context) =>
        repository.insertCanonicalRoot(context.connection, createInsertInput())
      )

      expect(created).toMatchObject({
        status: 'CREATED',
        encounter: {
          id: encounterId,
          patientId,
          screeningSessionId: sessionId,
          locationId,
          protocolVersionId: protocolId,
          status: 'DRAFT',
          startedAt: now,
          completedAt: null,
          sourceType: 'LOCAL',
          recordedBy: userId,
          amendmentOfEncounterId: null,
          recordVersion: 1,
          createdAt: now,
          updatedAt: now
        }
      })
      expect(Object.isFrozen(created)).toBe(true)
      expect(Object.isFrozen(created.status === 'CREATED' ? created.encounter : null)).toBe(true)
      expect(repository.getById(parseEntityId(encounterId))).toEqual(
        created.status === 'CREATED' ? created.encounter : null
      )
      expect(
        repository.findCanonicalRootByPatientAndSession(
          parseEntityId(patientId),
          parseEntityId(sessionId)
        )
      ).toEqual(created.status === 'CREATED' ? created.encounter : null)
      expect(repository.getById(parseEntityId(generatedId))).toBeNull()
      expect(readTableCount(connection, 'blood_pressure_readings')).toBe(0)
      expect(readTableCount(connection, 'lifestyle_logs')).toBe(0)
      expect(readTableCount(connection, 'referrals')).toBe(0)
    })
  })

  it('returns an identity conflict for a duplicate canonical root and keeps ID collisions distinct', async () => {
    await withScreeningEncounterRepository(({ connection, repository, executor }) => {
      insertReferenceGraph(connection)
      executor.run((context) =>
        repository.insertCanonicalRoot(context.connection, createInsertInput())
      )

      const duplicate = executor.run((context) =>
        repository.insertCanonicalRoot(
          context.connection,
          createInsertInput({ id: duplicateEncounterId })
        )
      )
      const idCollision = captureError(() =>
        executor.run((context) =>
          repository.insertCanonicalRoot(
            context.connection,
            createInsertInput({
              patientId: secondPatientId,
              screeningSessionId: sessionId,
              id: encounterId
            })
          )
        )
      )

      expect(duplicate).toEqual({ status: 'IDENTITY_CONFLICT' })
      expect(idCollision).toBeInstanceOf(RepositoryWriteError)
      expect(readRootEncounterCount(connection, patientId, sessionId)).toBe(1)
      expect(readTableCount(connection, 'screening_encounters')).toBe(1)
      expectSafeControlledError(idCollision)
    })
  })

  it('excludes amendment rows from canonical lookup while preserving root VOID identity', async () => {
    await withScreeningEncounterRepository(({ connection, repository }) => {
      insertReferenceGraph(connection)
      insertRawEncounter(connection, { id: encounterId, status: 'COMPLETED' })
      insertRawEncounter(connection, {
        id: amendmentEncounterId,
        status: 'AMENDED',
        amendmentOfEncounterId: encounterId,
        recordVersion: 2
      })
      insertRawEncounter(connection, {
        id: voidEncounterId,
        patientId: secondPatientId,
        status: 'VOID',
        voidReason: 'Entered in error'
      })

      expect(
        repository.findCanonicalRootByPatientAndSession(
          parseEntityId(patientId),
          parseEntityId(sessionId)
        )
      ).toMatchObject({ id: encounterId, status: 'COMPLETED', amendmentOfEncounterId: null })
      expect(repository.getById(parseEntityId(amendmentEncounterId))).toMatchObject({
        id: amendmentEncounterId,
        status: 'AMENDED',
        amendmentOfEncounterId: encounterId
      })
      expect(
        repository.findCanonicalRootByPatientAndSession(
          parseEntityId(secondPatientId),
          parseEntityId(sessionId)
        )
      ).toMatchObject({ id: voidEncounterId, status: 'VOID' })
    })
  })

  it('fails closed for malformed persisted encounter rows', async () => {
    await withScreeningEncounterRepository(({ connection, repository }) => {
      insertReferenceGraph(connection)
      insertRawEncounter(connection, { id: encounterId })
      connection
        .prepare("UPDATE screening_encounters SET source_type = 'REMOTE' WHERE id = ?")
        .run(encounterId)

      const error = captureError(() => repository.getById(parseEntityId(encounterId)))

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })
  })

  it('requires an active transaction connection for write reads and inserts', async () => {
    await withScreeningEncounterRepository(({ connection, repository }) => {
      insertReferenceGraph(connection)
      const fabricated = connection as never

      expect(() => repository.getByIdForWrite(fabricated, parseEntityId(encounterId))).toThrow(
        DatabaseTransactionStateError
      )
      expect(() => repository.insertCanonicalRoot(fabricated, createInsertInput())).toThrow(
        DatabaseTransactionStateError
      )
    })
  })
})

interface RepositoryHarness {
  readonly connection: Database.Database
  readonly repository: ScreeningEncounterRepository
  readonly executor: DatabaseTransactionExecutor
}

async function withScreeningEncounterRepository(
  test: (context: RepositoryHarness) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029-encounter-repository-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createFixedClock()
    })(connection)
    await test({
      connection,
      repository: createScreeningEncounterRepository(connection),
      executor: createExecutor(connection)
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createInsertInput(
  override: Partial<Record<keyof InsertCanonicalRootScreeningEncounterInput, unknown>> = {}
): InsertCanonicalRootScreeningEncounterInput {
  const raw = {
    id: encounterId,
    patientId,
    screeningSessionId: sessionId,
    locationId,
    protocolVersionId: protocolId,
    startedAt: now,
    recordedBy: userId,
    ...override
  }

  return {
    id: parseEntityId(raw.id),
    patientId: parseEntityId(raw.patientId),
    screeningSessionId: parseEntityId(raw.screeningSessionId),
    locationId: parseEntityId(raw.locationId),
    protocolVersionId: parseEntityId(raw.protocolVersionId),
    startedAt: parseUtcTimestamp(raw.startedAt),
    recordedBy: parseEntityId(raw.recordedBy)
  }
}

function insertReferenceGraph(connection: Database.Database): void {
  insertUser(connection)
  insertLocation(connection)
  insertProtocolVersion(connection)
  insertPatient(connection, patientId, 'P-029-000001', 'Patient One', 'ACTIVE')
  insertPatient(connection, secondPatientId, 'P-029-000002', 'Patient Two', 'ACTIVE')
  insertSession(connection, sessionId, 'OPEN', '2026-08-06')
  insertSession(connection, secondSessionId, 'OPEN', '2026-08-07')
}

function insertUser(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO users (
        id,
        username,
        username_normalized,
        display_name,
        password_hash,
        password_salt,
        role,
        is_active,
        must_change_password,
        failed_login_count,
        created_at,
        updated_at
      ) VALUES (?, 'encounter.admin', 'encounter.admin', 'Encounter Admin', 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(userId, now, now)
}

function insertLocation(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, 'Central Site', 'central site', 'COMMUNITY_SITE', 1, ?, ?, ?, ?)`
    )
    .run(locationId, userId, now, userId, now)
}

function insertProtocolVersion(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO protocol_versions (
        id,
        protocol_key,
        version_label,
        status,
        configuration_json,
        checksum,
        imported_by,
        imported_at,
        activated_by,
        activated_at,
        created_at
      ) VALUES (?, 'screening', 'v1', 'ACTIVE', '{}', 'checksum', ?, ?, ?, ?, ?)`
    )
    .run(protocolId, userId, now, userId, now, now)
}

function insertPatient(
  connection: Database.Database,
  id: string,
  patientCode: string,
  displayName: string,
  status: 'ACTIVE' | 'INACTIVE'
): void {
  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        given_name,
        family_name,
        name_normalized,
        sex,
        date_of_birth,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, 'Test', ?, 'UNKNOWN', '1990-01-01', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      patientCode,
      displayName,
      displayName,
      displayName.toLowerCase(),
      status,
      userId,
      now,
      userId,
      now
    )
}

function insertSession(
  connection: Database.Database,
  id: string,
  status: 'OPEN' | 'CLOSED',
  sessionDate: string
): void {
  const closedBy = status === 'CLOSED' ? userId : null
  const closedAt = status === 'CLOSED' ? now : null
  const rowVersion = status === 'CLOSED' ? 2 : 1

  connection
    .prepare(
      `INSERT INTO screening_sessions (
        id,
        location_id,
        protocol_version_id,
        session_date,
        status,
        notes,
        opened_by,
        opened_at,
        closed_by,
        closed_at,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      locationId,
      protocolId,
      sessionDate,
      status,
      userId,
      now,
      closedBy,
      closedAt,
      userId,
      now,
      userId,
      now,
      rowVersion
    )
}

function insertRawEncounter(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly patientId?: string
    readonly status?: 'DRAFT' | 'COMPLETED' | 'AMENDED' | 'VOID'
    readonly amendmentOfEncounterId?: string | null
    readonly voidReason?: string | null
    readonly recordVersion?: number
  }
): void {
  connection
    .prepare(
      `INSERT INTO screening_encounters (
        id,
        patient_id,
        screening_session_id,
        location_id,
        protocol_version_id,
        status,
        started_at,
        completed_at,
        source_type,
        recorded_by,
        amendment_of_encounter_id,
        amendment_reason,
        void_reason,
        record_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.patientId ?? patientId,
      sessionId,
      locationId,
      protocolId,
      input.status ?? 'DRAFT',
      now,
      input.status === 'COMPLETED' ? now : null,
      userId,
      input.amendmentOfEncounterId ?? null,
      input.amendmentOfEncounterId === undefined ? null : 'Correction',
      input.voidReason ?? null,
      input.recordVersion ?? 1,
      now,
      now
    )
}

function readRootEncounterCount(
  connection: Database.Database,
  patient: string,
  session: string
): number {
  const row = connection
    .prepare(
      `SELECT COUNT(*) AS total
       FROM screening_encounters
       WHERE patient_id = ?
         AND screening_session_id = ?
         AND amendment_of_encounter_id IS NULL`
    )
    .get(patient, session) as { total: number }

  return row.total
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS total FROM "${tableName.replaceAll('"', '""')}"`)
    .get() as { total: number }

  return row.total
}

function createExecutor(connection: Database.Database): DatabaseTransactionExecutor {
  return createDatabaseTransactionExecutor({
    connection,
    idGenerator: createFixedIdGenerator(),
    clock: createFixedClock(),
    logger: { error: vi.fn() }
  })
}

function createFixedIdGenerator(): EntityIdGenerator {
  return {
    generate: () => parseEntityId(generatedId)
  }
}

function createFixedClock(): UtcClock {
  return createUtcClock(() => now)
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw.')
}

function expectSafeControlledError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect((error as { readonly stack?: unknown }).stack).toBeUndefined()
  expect(serialized).not.toContain('screening_encounters')
  expect(serialized).not.toContain('INSERT')
  expect(serialized).not.toContain('SELECT')
  expect(serialized).not.toContain('sqlite')
  expect(serialized).not.toContain('C:\\')
  expect(serialized).not.toContain(patientId)
  expect(serialized).not.toContain(sessionId)
  expect(serialized).not.toContain(encounterId)
}
