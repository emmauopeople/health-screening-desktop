import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  classifyScreeningEncounterIdentityConstraintError,
  createProductionDatabaseMigrationRunner,
  MigrationCompatibilityError,
  MigrationExecutionError
} from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import { validateSchemaVersion5 } from '@main/database/migrations/schema-v5-contract'

type MockLogMethod = ReturnType<typeof vi.fn<(message: string) => void>>

interface TestLogger {
  info: MockLogMethod
  error: MockLogMethod
}

interface EncounterFixtureInput {
  readonly id: string
  readonly patientId?: string
  readonly sessionId?: string
  readonly locationId?: string
  readonly status?: 'DRAFT' | 'COMPLETED' | 'AMENDED' | 'VOID'
  readonly amendmentOfEncounterId?: string | null
  readonly amendmentReason?: string | null
  readonly voidReason?: string | null
  readonly startedAt?: string
  readonly recordVersion?: number
}

interface EncounterDiagnosticRow {
  readonly id: string
  readonly screening_session_id: string
  readonly patient_id: string
  readonly status: string
  readonly amendment_of_encounter_id: string | null
  readonly started_at: string
  readonly created_at: string
  readonly record_version: number
}

const fixedTimestamp = '2026-08-06T12:00:00.000Z'
const userId = testEntityId(1)
const locationOneId = testEntityId(2)
const locationTwoId = testEntityId(3)
const protocolId = testEntityId(4)
const patientOneId = testEntityId(5)
const patientTwoId = testEntityId(6)
const sessionOneId = testEntityId(7)
const sessionTwoId = testEntityId(8)
const rootEncounterId = testEntityId(9)
const amendmentEncounterId = testEntityId(10)
const secondAmendmentEncounterId = testEntityId(11)
const duplicateEncounterId = testEntityId(12)
const otherPatientEncounterId = testEntityId(13)
const otherSessionEncounterId = testEntityId(14)
const voidEncounterId = testEntityId(15)
const voidDuplicateEncounterId = testEntityId(16)
const competingConnectionEncounterId = testEntityId(17)
const idCollisionEncounterId = testEntityId(18)
const unrelatedUserId = testEntityId(19)

describe('screening encounter identity migration', () => {
  it('applies schema version 5 on a fresh database with the exact root identity index', async () => {
    await withDatabase((connection) => {
      migrateToVersion5(connection)

      expect(readUserVersion(connection)).toBe(5)
      expect(
        readIndexDefinition(connection, 'ux_screening_encounters_root_session_patient')
      ).toEqual({
        tableName: 'screening_encounters',
        unique: true,
        partial: true,
        columns: ['screening_session_id', 'patient_id'],
        sql: normalizeSql(
          `CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
              ON screening_encounters (screening_session_id, patient_id)
              WHERE amendment_of_encounter_id IS NULL`
        )
      })
      expect(readIndexNames(connection)).toEqual(
        expect.arrayContaining([
          'ix_screening_encounters_patient_time',
          'ix_screening_encounters_session',
          'ux_screening_encounters_root_session_patient'
        ])
      )
      expect(() => validateSchemaVersion5(connection, 'compatibility')).not.toThrow()
    })
  })

  it('lets SQLite reject duplicate root encounters while preserving allowed patient/session cardinality', async () => {
    await withVersion5Graph((connection) => {
      insertEncounter(connection, { id: rootEncounterId })

      const duplicateError = captureError(() =>
        insertEncounter(connection, { id: duplicateEncounterId })
      )

      expect(classifyScreeningEncounterIdentityConstraintError(duplicateError)).toBe(
        'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
      )
      expect(readEncounterDiagnostics(connection)).toEqual([
        {
          id: rootEncounterId,
          screening_session_id: sessionOneId,
          patient_id: patientOneId,
          status: 'DRAFT',
          amendment_of_encounter_id: null,
          started_at: fixedTimestamp,
          created_at: fixedTimestamp,
          record_version: 1
        }
      ])

      insertEncounter(connection, {
        id: otherPatientEncounterId,
        patientId: patientTwoId,
        sessionId: sessionOneId
      })
      insertEncounter(connection, {
        id: otherSessionEncounterId,
        patientId: patientOneId,
        sessionId: sessionTwoId,
        locationId: locationTwoId
      })

      expect(readEncounterDiagnostics(connection).map((row) => row.id)).toEqual([
        rootEncounterId,
        otherPatientEncounterId,
        otherSessionEncounterId
      ])
    })
  })

  it('uses two connections to prove competing root inserts cannot both commit', async () => {
    await withDatabaseFile(({ connection: firstConnection, databasePath }) => {
      migrateToCurrent(firstConnection)
      insertReferenceGraph(firstConnection)
      insertScreeningSession(firstConnection, { id: sessionOneId, locationId: locationOneId })
      const secondConnection = new Database(databasePath)

      try {
        configurePragmas(secondConnection)
        expect(readMainDatabasePath(firstConnection)).toBe(databasePath)
        expect(readMainDatabasePath(secondConnection)).toBe(databasePath)
        expect(readReferenceCounts(firstConnection)).toEqual({
          patients: 2,
          sessions: 1,
          encounters: 0
        })

        runExplicitTransaction(firstConnection, () => {
          insertEncounter(firstConnection, { id: rootEncounterId })
        })

        const competingError = captureError(() =>
          runExplicitTransaction(secondConnection, () => {
            insertEncounter(secondConnection, { id: competingConnectionEncounterId })
          })
        )

        expect(classifyScreeningEncounterIdentityConstraintError(competingError)).toBe(
          'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
        )
        expect(readReferenceCounts(firstConnection)).toEqual({
          patients: 2,
          sessions: 1,
          encounters: 1
        })
        expect(readReferenceCounts(secondConnection)).toEqual({
          patients: 2,
          sessions: 1,
          encounters: 1
        })
        expect(readEncounterDiagnostics(firstConnection)).toEqual([
          {
            id: rootEncounterId,
            screening_session_id: sessionOneId,
            patient_id: patientOneId,
            status: 'DRAFT',
            amendment_of_encounter_id: null,
            started_at: fixedTimestamp,
            created_at: fixedTimestamp,
            record_version: 1
          }
        ])
      } finally {
        rollbackIfNeeded(secondConnection)
        secondConnection.close()
      }
    })
  })

  it('preserves compatible root, amendment, and VOID encounter data during upgrade', async () => {
    await withVersion4Database((connection) => {
      insertReferenceGraph(connection)
      insertScreeningSession(connection, { id: sessionOneId, locationId: locationOneId })
      insertEncounter(connection, { id: rootEncounterId, status: 'COMPLETED', recordVersion: 2 })
      insertEncounter(connection, {
        id: amendmentEncounterId,
        status: 'AMENDED',
        amendmentOfEncounterId: rootEncounterId,
        amendmentReason: 'Corrected values',
        recordVersion: 3
      })
      insertEncounter(connection, {
        id: voidEncounterId,
        patientId: patientTwoId,
        status: 'VOID',
        voidReason: 'Entered in error',
        recordVersion: 1
      })
      const before = readEncounterDiagnostics(connection)

      migrateToVersion5(connection)

      expect(readUserVersion(connection)).toBe(5)
      expect(readEncounterDiagnostics(connection)).toEqual(before)
      expect(readDuplicateRootEncounterDiagnostics(connection)).toEqual([])

      insertEncounter(connection, {
        id: secondAmendmentEncounterId,
        status: 'AMENDED',
        amendmentOfEncounterId: rootEncounterId,
        amendmentReason: 'Second amendment'
      })

      const voidDuplicateError = captureError(() =>
        insertEncounter(connection, {
          id: voidDuplicateEncounterId,
          patientId: patientTwoId,
          status: 'DRAFT'
        })
      )

      expect(classifyScreeningEncounterIdentityConstraintError(voidDuplicateError)).toBe(
        'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
      )
    })
  })

  it('classifies identity, ID, unrelated unique, non-unique, and malformed failures safely', async () => {
    await withVersion5Graph((connection) => {
      insertEncounter(connection, { id: rootEncounterId })

      const identityError = captureError(() =>
        insertEncounter(connection, { id: duplicateEncounterId })
      )
      const idCollisionError = captureError(() =>
        insertEncounter(connection, {
          id: rootEncounterId,
          patientId: patientTwoId,
          sessionId: sessionOneId
        })
      )
      const unrelatedUniqueError = captureError(() =>
        insertUserWithDuplicateUsername(connection, unrelatedUserId)
      )
      const nonUniqueConstraintError = captureError(() =>
        insertEncounter(connection, { id: idCollisionEncounterId, status: 'STARTED' as never })
      )

      expect(classifyScreeningEncounterIdentityConstraintError(identityError)).toBe(
        'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
      )
      expect(classifyScreeningEncounterIdentityConstraintError(idCollisionError)).toBe(
        'SCREENING_ENCOUNTER_ID_CONFLICT'
      )
      expect(classifyScreeningEncounterIdentityConstraintError(unrelatedUniqueError)).toBe(
        'OTHER_UNIQUE_CONSTRAINT'
      )
      expect(classifyScreeningEncounterIdentityConstraintError(nonUniqueConstraintError)).toBe(
        'NOT_A_UNIQUE_CONSTRAINT'
      )
      expect(
        classifyScreeningEncounterIdentityConstraintError(new Error('C:\\secret\\database.sqlite3'))
      ).toBe('NOT_A_UNIQUE_CONSTRAINT')
      expect(classifyScreeningEncounterIdentityConstraintError('SQLITE_CONSTRAINT_UNIQUE')).toBe(
        'NOT_A_UNIQUE_CONSTRAINT'
      )
      expect(classifyScreeningEncounterIdentityConstraintError(createAccessorBackedError())).toBe(
        'NOT_A_UNIQUE_CONSTRAINT'
      )
      expect(classifyScreeningEncounterIdentityConstraintError(createProxyBackedError())).toBe(
        'NOT_A_UNIQUE_CONSTRAINT'
      )
      expect(
        JSON.stringify(classifyScreeningEncounterIdentityConstraintError(identityError))
      ).not.toContain('screening_encounters')
      expect(readEncounterDiagnostics(connection)).toEqual([
        {
          id: rootEncounterId,
          screening_session_id: sessionOneId,
          patient_id: patientOneId,
          status: 'DRAFT',
          amendment_of_encounter_id: null,
          started_at: fixedTimestamp,
          created_at: fixedTimestamp,
          record_version: 1
        }
      ])
    })
  })

  it('fails safely and atomically when version 4 contains duplicate root encounter pairs', async () => {
    await withVersion4Database((connection) => {
      insertReferenceGraph(connection)
      insertScreeningSession(connection, { id: sessionOneId, locationId: locationOneId })
      insertEncounter(connection, { id: rootEncounterId })
      insertEncounter(connection, {
        id: duplicateEncounterId,
        status: 'VOID',
        voidReason: 'voided'
      })
      const before = readEncounterDiagnostics(connection)
      const duplicatesBefore = readDuplicateRootEncounterDiagnostics(connection)

      expect(duplicatesBefore).toHaveLength(2)

      expect(() => migrateToCurrent(connection)).toThrow(MigrationExecutionError)

      expect(readUserVersion(connection)).toBe(4)
      expect(readLedgerVersions(connection)).toEqual([1, 2, 3, 4])
      expect(
        readIndexDefinition(connection, 'ux_screening_encounters_root_session_patient')
      ).toBeNull()
      expect(readEncounterDiagnostics(connection)).toEqual(before)
      expect(readDuplicateRootEncounterDiagnostics(connection)).toEqual(duplicatesBefore)
      expect(isForeignKeyEnforcementEnabled(connection)).toBe(true)
    })
  })

  it('rejects root identity index drift through the schema version 5 contract', async () => {
    await withVersion5Graph((connection) => {
      expect(() => validateSchemaVersion5(connection, 'compatibility')).not.toThrow()

      connection.exec('DROP INDEX ux_screening_encounters_root_session_patient')
      expect(() => validateSchemaVersion5(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )

      connection.exec(
        `CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
           ON screening_encounters (patient_id, screening_session_id)
           WHERE amendment_of_encounter_id IS NULL`
      )
      expect(() => validateSchemaVersion5(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )

      connection.exec('DROP INDEX ux_screening_encounters_root_session_patient')
      connection.exec(
        `CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
           ON screening_encounters (screening_session_id, patient_id)
           WHERE status <> 'VOID'`
      )
      expect(() => validateSchemaVersion5(connection, 'compatibility')).toThrow(
        MigrationCompatibilityError
      )
    })
  })

  it('keeps existing foreign keys and encounter status checks intact', async () => {
    await withVersion5Graph((connection) => {
      expect(() =>
        insertEncounter(connection, { id: rootEncounterId, sessionId: testEntityId(99) })
      ).toThrow()
      expect(() =>
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
              source_type,
              recorded_by,
              record_version,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            rootEncounterId,
            patientOneId,
            sessionOneId,
            locationOneId,
            protocolId,
            'STARTED',
            fixedTimestamp,
            'LOCAL',
            userId,
            1,
            fixedTimestamp,
            fixedTimestamp
          )
      ).toThrow()
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  await withDatabaseFile(({ connection }) => {
    test(connection)
  })
}

async function withDatabaseFile(
  test: (context: { readonly connection: Database.Database; readonly databasePath: string }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029-encounter-identity-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    test({ connection, databasePath })
  } finally {
    rollbackIfNeeded(connection)
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function withVersion4Database(test: (connection: Database.Database) => void): Promise<void> {
  await withDatabase((connection) => {
    migrateToVersion4(connection)
    test(connection)
  })
}

async function withVersion5Graph(test: (connection: Database.Database) => void): Promise<void> {
  await withDatabase((connection) => {
    migrateToVersion5(connection)
    insertReferenceGraph(connection)
    insertScreeningSession(connection, { id: sessionOneId, locationId: locationOneId })
    insertScreeningSession(connection, {
      id: sessionTwoId,
      locationId: locationTwoId,
      sessionDate: '2026-08-07'
    })
    test(connection)
  })
}

function migrateToVersion4(connection: Database.Database): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, 4),
    applicationVersion: '1.0.0',
    logger: createLogger(),
    clock: fixedClock,
    expectedHighestVersion: 4
  })
}

function migrateToVersion5(connection: Database.Database): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, 5),
    applicationVersion: '1.0.0',
    logger: createLogger(),
    clock: fixedClock,
    expectedHighestVersion: 5
  })
}

function migrateToCurrent(connection: Database.Database): void {
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: createLogger(),
    clock: fixedClock
  })(connection)
  deactivateBaselineProtocol(connection)
}

function deactivateBaselineProtocol(connection: Database.Database): void {
  connection
    .prepare(
      "UPDATE protocol_versions SET status = 'INACTIVE' WHERE protocol_key = 'health-screening-baseline'"
    )
    .run()
}

function insertReferenceGraph(connection: Database.Database): void {
  insertUser(connection)
  insertLocation(connection, locationOneId)
  insertLocation(connection, locationTwoId)
  insertProtocolVersion(connection)
  insertPatient(connection, patientOneId, 'P-029-000001', 'Patient One')
  insertPatient(connection, patientTwoId, 'P-029-000002', 'Patient Two')
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      'screening.admin',
      'screening.admin',
      'Screening Admin',
      'hash',
      'salt',
      'LOCAL_ADMIN',
      1,
      0,
      0,
      fixedTimestamp,
      fixedTimestamp
    )
}

function insertUserWithDuplicateUsername(connection: Database.Database, id: string): void {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      'screening.admin.duplicate',
      'screening.admin',
      'Duplicate Username',
      'hash',
      'salt',
      'LOCAL_ADMIN',
      1,
      0,
      0,
      fixedTimestamp,
      fixedTimestamp
    )
}

function insertLocation(connection: Database.Database, id: string): void {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, id, id, 'COMMUNITY', 1, userId, fixedTimestamp, userId, fixedTimestamp)
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      protocolId,
      'screening',
      'v1',
      'ACTIVE',
      '{}',
      'checksum',
      userId,
      fixedTimestamp,
      userId,
      fixedTimestamp,
      fixedTimestamp
    )
}

function insertPatient(
  connection: Database.Database,
  id: string,
  patientCode: string,
  displayName: string
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      patientCode,
      displayName,
      displayName,
      'Test',
      displayName.toLowerCase(),
      'UNKNOWN',
      '1990-01-01',
      'ACTIVE',
      userId,
      fixedTimestamp,
      userId,
      fixedTimestamp
    )
}

function insertScreeningSession(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly locationId: string
    readonly sessionDate?: string
  }
): void {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.locationId,
      protocolId,
      input.sessionDate ?? '2026-08-06',
      'OPEN',
      null,
      userId,
      fixedTimestamp,
      null,
      null,
      userId,
      fixedTimestamp,
      userId,
      fixedTimestamp,
      1
    )
}

function insertEncounter(connection: Database.Database, input: EncounterFixtureInput): void {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.patientId ?? patientOneId,
      input.sessionId ?? sessionOneId,
      input.locationId ?? locationOneId,
      protocolId,
      input.status ?? 'DRAFT',
      input.startedAt ?? fixedTimestamp,
      input.status === 'COMPLETED' ? fixedTimestamp : null,
      'LOCAL',
      userId,
      input.amendmentOfEncounterId ?? null,
      input.amendmentReason ?? null,
      input.voidReason ?? null,
      input.recordVersion ?? 1,
      fixedTimestamp,
      fixedTimestamp
    )
}

function readEncounterDiagnostics(connection: Database.Database): EncounterDiagnosticRow[] {
  return connection
    .prepare(
      `SELECT
        id,
        screening_session_id,
        patient_id,
        status,
        amendment_of_encounter_id,
        started_at,
        created_at,
        record_version
       FROM screening_encounters
       ORDER BY id`
    )
    .all() as EncounterDiagnosticRow[]
}

function readReferenceCounts(connection: Database.Database): {
  readonly patients: number
  readonly sessions: number
  readonly encounters: number
} {
  return {
    patients: readTableCount(connection, 'patients'),
    sessions: readTableCount(connection, 'screening_sessions'),
    encounters: readTableCount(connection, 'screening_encounters')
  }
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS total FROM ${quoteIdentifier(tableName)}`)
    .get() as { total: number }

  return row.total
}

function readDuplicateRootEncounterDiagnostics(
  connection: Database.Database
): EncounterDiagnosticRow[] {
  return connection
    .prepare(
      `SELECT
        encounter.id,
        encounter.screening_session_id,
        encounter.patient_id,
        encounter.status,
        encounter.amendment_of_encounter_id,
        encounter.started_at,
        encounter.created_at,
        encounter.record_version
       FROM screening_encounters AS encounter
       WHERE encounter.amendment_of_encounter_id IS NULL
         AND EXISTS (
           SELECT 1
           FROM screening_encounters AS duplicate
           WHERE duplicate.amendment_of_encounter_id IS NULL
             AND duplicate.screening_session_id = encounter.screening_session_id
             AND duplicate.patient_id = encounter.patient_id
           GROUP BY duplicate.screening_session_id, duplicate.patient_id
           HAVING COUNT(*) > 1
         )
       ORDER BY encounter.screening_session_id, encounter.patient_id, encounter.id`
    )
    .all() as EncounterDiagnosticRow[]
}

function readIndexDefinition(
  connection: Database.Database,
  indexName: string
): {
  readonly tableName: string
  readonly unique: boolean
  readonly partial: boolean
  readonly columns: readonly string[]
  readonly sql: string
} | null {
  const row = connection
    .prepare(
      "SELECT tbl_name AS tableName, sql FROM sqlite_master WHERE type = 'index' AND name = ?"
    )
    .get(indexName) as { tableName: string; sql: string | null } | undefined

  if (row === undefined || row.sql === null) {
    return null
  }

  const indexListRow = (
    connection.prepare(`PRAGMA index_list(${quoteIdentifier(row.tableName)})`).all() as Array<{
      name: string
      unique: number
      partial: number
    }>
  ).find((candidate) => candidate.name === indexName)

  if (indexListRow === undefined) {
    return null
  }

  const columns = (
    connection.prepare(`PRAGMA index_xinfo(${quoteIdentifier(indexName)})`).all() as Array<{
      seqno: number
      name: string
      key: number
    }>
  )
    .filter((column) => column.key === 1)
    .sort((left, right) => left.seqno - right.seqno)
    .map((column) => column.name)

  return {
    tableName: row.tableName,
    unique: indexListRow.unique === 1,
    partial: indexListRow.partial === 1,
    columns,
    sql: normalizeSql(row.sql)
  }
}

function readIndexNames(connection: Database.Database): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'index'
           AND name NOT LIKE 'sqlite_autoindex_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function readLedgerVersions(connection: Database.Database): readonly number[] {
  return (
    connection.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{
      version: number
    }>
  ).map((row) => row.version)
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error: unknown) {
    return error
  }

  return undefined
}

function runExplicitTransaction(connection: Database.Database, action: () => void): void {
  connection.exec('BEGIN IMMEDIATE')

  try {
    action()
    connection.exec('COMMIT')
  } catch (error) {
    rollbackIfNeeded(connection)
    throw error
  }
}

function rollbackIfNeeded(connection: Database.Database): void {
  if (!connection.inTransaction) {
    return
  }

  connection.exec('ROLLBACK')
}

function readMainDatabasePath(connection: Database.Database): string {
  const row = connection
    .prepare("SELECT file FROM pragma_database_list WHERE name = 'main'")
    .get() as { file: string } | undefined

  return row?.file ?? ''
}

function createAccessorBackedError(): unknown {
  const error: Record<string, unknown> = {}

  Object.defineProperty(error, 'code', {
    get() {
      throw new Error('C:\\secret\\code.sqlite3')
    }
  })

  Object.defineProperty(error, 'message', {
    value:
      'UNIQUE constraint failed: screening_encounters.screening_session_id, screening_encounters.patient_id'
  })

  return error
}

function createProxyBackedError(): unknown {
  return new Proxy(
    {
      code: 'SQLITE_CONSTRAINT_UNIQUE',
      message:
        'UNIQUE constraint failed: screening_encounters.screening_session_id, screening_encounters.patient_id'
    },
    {
      getOwnPropertyDescriptor() {
        throw new Error('C:\\secret\\proxy.sqlite3')
      }
    }
  )
}

function isForeignKeyEnforcementEnabled(connection: Database.Database): boolean {
  return connection.pragma('foreign_keys', { simple: true }) === 1
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function createLogger(): TestLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  }
}

function testEntityId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim()
}

const fixedClock = {
  now: () => fixedTimestamp
}
