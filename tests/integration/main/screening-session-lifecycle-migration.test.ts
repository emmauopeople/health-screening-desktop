import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createProductionDatabaseMigrationRunner,
  MigrationCompatibilityError,
  MigrationExecutionError
} from '@main/database'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import type { DatabaseMigration } from '@main/database/migrations/migration-types'
import { validateSchemaVersion4 } from '@main/database/migrations'
import { parseEntityId } from '@main/foundation/entity-id'

const now = '2026-07-29T08:00:00.000Z'
const closedAt = '2026-07-29T16:30:00.000Z'
const userOpenId = testEntityId(1)
const userCloseId = testEntityId(2)
const locationOneId = testEntityId(3)
const locationTwoId = testEntityId(4)
const protocolId = testEntityId(5)
const openSessionId = testEntityId(6)
const closedSessionId = testEntityId(7)
const patientId = testEntityId(8)
const missingSessionId = testEntityId(9)
const orphanEncounterId = testEntityId(10)

type MockLogMethod = ReturnType<typeof vi.fn<(message: string) => void>>

interface TestLogger {
  info: MockLogMethod
  error: MockLogMethod
}

describe('screening session lifecycle migration', () => {
  it('upgrades valid version 3 OPEN and CLOSED sessions with deterministic history', async () => {
    await withVersion3Database((connection) => {
      insertLegacyGraph(connection)
      insertLegacySession(connection, {
        id: openSessionId,
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: userOpenId,
        openedAt: now,
        updatedAt: now
      })
      insertLegacySession(connection, {
        id: closedSessionId,
        locationId: locationOneId,
        date: '2026-07-30',
        status: 'CLOSED',
        createdBy: userOpenId,
        openedAt: now,
        closedBy: userCloseId,
        closedAt,
        updatedAt: closedAt
      })

      migrateToVersion4(connection)

      expect(readUserVersion(connection)).toBe(4)
      expect(readScreeningSession(connection, openSessionId)).toEqual({
        id: openSessionId,
        location_id: locationOneId,
        protocol_version_id: protocolId,
        session_date: '2026-07-29',
        status: 'OPEN',
        notes: null,
        opened_by: userOpenId,
        opened_at: now,
        closed_by: null,
        closed_at: null,
        created_by: userOpenId,
        created_at: now,
        updated_by: userOpenId,
        updated_at: now,
        row_version: 1
      })
      expect(readScreeningSession(connection, closedSessionId)).toEqual({
        id: closedSessionId,
        location_id: locationOneId,
        protocol_version_id: protocolId,
        session_date: '2026-07-30',
        status: 'CLOSED',
        notes: null,
        opened_by: userOpenId,
        opened_at: now,
        closed_by: userCloseId,
        closed_at: closedAt,
        created_by: userOpenId,
        created_at: now,
        updated_by: userCloseId,
        updated_at: closedAt,
        row_version: 2
      })
      const openHistory = readLifecycleHistory(connection, openSessionId)
      const closedHistory = readLifecycleHistory(connection, closedSessionId)

      expect(openHistory).toHaveLength(1)
      expect(closedHistory).toHaveLength(2)
      expectMigratedHistoryId(openHistory[0]?.id)
      expectMigratedHistoryId(closedHistory[0]?.id)
      expectMigratedHistoryId(closedHistory[1]?.id)
      expect(closedHistory[0]?.id).not.toBe(closedHistory[1]?.id)
      expect(stripHistoryId(openHistory[0])).toEqual({
        screening_session_id: openSessionId,
        transition_type: 'CREATED',
        from_status: null,
        to_status: 'OPEN',
        reason: null,
        changed_by: userOpenId,
        changed_at: now,
        prior_row_version: null,
        resulting_row_version: 1
      })
      expect(closedHistory.map(stripHistoryId)).toEqual([
        {
          screening_session_id: closedSessionId,
          transition_type: 'CREATED',
          from_status: null,
          to_status: 'OPEN',
          reason: null,
          changed_by: userOpenId,
          changed_at: now,
          prior_row_version: null,
          resulting_row_version: 1
        },
        {
          screening_session_id: closedSessionId,
          transition_type: 'CLOSED',
          from_status: 'OPEN',
          to_status: 'CLOSED',
          reason: null,
          changed_by: userCloseId,
          changed_at: closedAt,
          prior_row_version: 1,
          resulting_row_version: 2
        }
      ])
      expect(connection.pragma('foreign_key_check')).toEqual([])
      expect(readForeignKeyEnforcement(connection)).toBe(1)
      expect(readForeignKeyTarget(connection, 'screening_encounters', 'screening_session_id')).toBe(
        'screening_sessions'
      )
    })
  })

  it('fails malformed legacy rows atomically and leaves version 3 unchanged', async () => {
    const cases: ReadonlyArray<{
      label: string
      seed: (connection: Database.Database) => void
    }> = [
      {
        label: 'invalid status',
        seed: (connection) => {
          connection.pragma('ignore_check_constraints = ON')
          insertLegacySession(connection, {
            id: testEntityId(20),
            locationId: locationOneId,
            date: '2026-07-29',
            status: 'PAUSED',
            createdBy: userOpenId,
            openedAt: now,
            updatedAt: now
          })
          connection.pragma('ignore_check_constraints = OFF')
        }
      },
      {
        label: 'closed without metadata',
        seed: (connection) =>
          insertLegacySession(connection, {
            id: testEntityId(21),
            locationId: locationOneId,
            date: '2026-07-29',
            status: 'CLOSED',
            createdBy: userOpenId,
            openedAt: now,
            updatedAt: now
          })
      },
      {
        label: 'invalid foreign key',
        seed: (connection) => {
          connection.pragma('foreign_keys = OFF')
          insertLegacySession(connection, {
            id: testEntityId(22),
            locationId: testEntityId(23),
            date: '2026-07-29',
            status: 'OPEN',
            createdBy: userOpenId,
            openedAt: now,
            updatedAt: now
          })
          connection.pragma('foreign_keys = ON')
        }
      }
    ]

    for (const migrationCase of cases) {
      await withVersion3Database((connection) => {
        insertLegacyGraph(connection)
        migrationCase.seed(connection)

        expect(() => migrateToVersion4(connection), migrationCase.label).toThrow(
          MigrationExecutionError
        )
        expect(readUserVersion(connection)).toBe(3)
        expect(hasTable(connection, 'screening_sessions')).toBe(true)
        expect(hasTable(connection, 'screening_sessions_v3')).toBe(false)
        expect(hasTable(connection, 'screening_session_lifecycle_history')).toBe(false)
        expect(readScreeningSessionColumns(connection)).not.toContain('row_version')
        expect(readForeignKeyEnforcement(connection)).toBe(1)
      })
    }
  })

  it('checks inbound foreign-key integrity before committing migration 4', async () => {
    await withVersion3Database((connection) => {
      insertLegacyGraph(connection)
      insertPatient(connection)
      insertLegacySession(connection, {
        id: openSessionId,
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: userOpenId,
        openedAt: now,
        updatedAt: now
      })
      connection.pragma('foreign_keys = OFF')
      insertScreeningEncounter(connection, {
        id: orphanEncounterId,
        sessionId: missingSessionId
      })
      connection.pragma('foreign_keys = ON')

      expect(() => migrateToVersion4(connection)).toThrow(MigrationExecutionError)
      expect(readUserVersion(connection)).toBe(3)
      expect(readSchemaMigrationVersions(connection)).not.toContain(4)
      expect(hasTable(connection, 'screening_sessions')).toBe(true)
      expect(readScreeningSessionColumns(connection)).not.toContain('row_version')
      expect(hasTable(connection, 'screening_session_lifecycle_history')).toBe(false)
      expect(readForeignKeyEnforcement(connection)).toBe(1)
    })
  })

  it('preserves foreign_keys and legacy_alter_table pragmas after success and failure', async () => {
    await withVersion3Database((connection) => {
      insertLegacyGraph(connection)
      insertLegacySession(connection, {
        id: openSessionId,
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: userOpenId,
        openedAt: now,
        updatedAt: now
      })
      connection.pragma('legacy_alter_table = ON')

      migrateToVersion4(connection)

      expect(readForeignKeyEnforcement(connection)).toBe(1)
      expect(readLegacyAlterTable(connection)).toBe(1)
    })

    await withVersion3Database((connection) => {
      insertLegacyGraph(connection)
      connection.pragma('ignore_check_constraints = ON')
      insertLegacySession(connection, {
        id: testEntityId(24),
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'PAUSED',
        createdBy: userOpenId,
        openedAt: now,
        updatedAt: now
      })
      connection.pragma('ignore_check_constraints = OFF')
      connection.pragma('legacy_alter_table = ON')

      expect(() => migrateToVersion4(connection)).toThrow(MigrationExecutionError)

      expect(readForeignKeyEnforcement(connection)).toBe(1)
      expect(readLegacyAlterTable(connection)).toBe(1)
      expect(readUserVersion(connection)).toBe(3)
    })
  })

  it('enforces lifecycle-ready screening session and history constraints', async () => {
    await withMigratedDatabase((connection) => {
      insertVersion4Graph(connection)
      insertScreeningSessionV4(connection, {
        id: testEntityId(30),
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'OPEN',
        rowVersion: 1
      })
      insertScreeningSessionV4(connection, {
        id: testEntityId(31),
        locationId: locationTwoId,
        date: '2026-07-29',
        status: 'OPEN',
        rowVersion: 1
      })

      expect(() =>
        insertScreeningSessionV4(connection, {
          id: testEntityId(32),
          locationId: locationOneId,
          date: '2026-07-29',
          status: 'OPEN',
          rowVersion: 1
        })
      ).toThrow()
      expect(() =>
        insertScreeningSessionV4(connection, {
          id: testEntityId(33),
          locationId: locationOneId,
          date: '2026-07-30',
          status: 'OPEN',
          closedBy: userOpenId,
          closedAt,
          rowVersion: 1
        })
      ).toThrow()
      expect(() =>
        insertScreeningSessionV4(connection, {
          id: testEntityId(34),
          locationId: locationOneId,
          date: '2026-07-31',
          status: 'CLOSED',
          rowVersion: 2
        })
      ).toThrow()
      expect(() =>
        insertScreeningSessionV4(connection, {
          id: testEntityId(35),
          locationId: locationOneId,
          date: '2026-08-01',
          status: 'OPEN',
          rowVersion: 0
        })
      ).toThrow()

      expect(() =>
        insertLifecycleHistory(connection, {
          id: testEntityId(40),
          sessionId: testEntityId(30),
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: userOpenId,
          priorRowVersion: null,
          resultingRowVersion: 1
        })
      ).not.toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: testEntityId(41),
          sessionId: testEntityId(30),
          transitionType: 'REOPENED',
          fromStatus: 'CLOSED',
          toStatus: 'OPEN',
          reason: null,
          changedBy: userOpenId,
          priorRowVersion: 2,
          resultingRowVersion: 3
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: testEntityId(42),
          sessionId: testEntityId(30),
          transitionType: 'REOPENED',
          fromStatus: 'CLOSED',
          toStatus: 'OPEN',
          reason: '   ',
          changedBy: userOpenId,
          priorRowVersion: 2,
          resultingRowVersion: 3
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: testEntityId(43),
          sessionId: testEntityId(30),
          transitionType: 'CLOSED',
          fromStatus: 'OPEN',
          toStatus: 'CLOSED',
          reason: null,
          changedBy: userOpenId,
          priorRowVersion: 2,
          resultingRowVersion: 4
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: testEntityId(44),
          sessionId: missingSessionId,
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: userOpenId,
          priorRowVersion: null,
          resultingRowVersion: 1
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: testEntityId(45),
          sessionId: testEntityId(30),
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: testEntityId(46),
          priorRowVersion: null,
          resultingRowVersion: 1
        })
      ).toThrow()
    })
  })

  it('creates exact indexes and no global one-open unique index', async () => {
    await withMigratedDatabase((connection) => {
      expect(readIndexDefinition(connection, 'ux_screening_sessions_location_date')).toEqual({
        tableName: 'screening_sessions',
        unique: true,
        columns: [
          { name: 'location_id', descending: false },
          { name: 'session_date', descending: false }
        ]
      })
      expect(readIndexDefinition(connection, 'ix_screening_sessions_date_status')).toEqual({
        tableName: 'screening_sessions',
        unique: false,
        columns: [
          { name: 'session_date', descending: true },
          { name: 'status', descending: false },
          { name: 'id', descending: true }
        ]
      })
      expect(readIndexDefinition(connection, 'ix_screening_sessions_location_date_status')).toEqual(
        {
          tableName: 'screening_sessions',
          unique: false,
          columns: [
            { name: 'location_id', descending: false },
            { name: 'session_date', descending: true },
            { name: 'status', descending: false },
            { name: 'id', descending: true }
          ]
        }
      )
      expect(
        readIndexDefinition(connection, 'ix_screening_session_lifecycle_history_session_time')
      ).toEqual({
        tableName: 'screening_session_lifecycle_history',
        unique: false,
        columns: [
          { name: 'screening_session_id', descending: false },
          { name: 'changed_at', descending: false },
          { name: 'id', descending: false }
        ]
      })
      expect(
        readIndexDefinition(connection, 'ix_screening_session_lifecycle_history_changed_at')
      ).toEqual({
        tableName: 'screening_session_lifecycle_history',
        unique: false,
        columns: [
          { name: 'changed_at', descending: true },
          { name: 'id', descending: true }
        ]
      })
      expect(readScreeningSessionIndexSql(connection).join('\n')).not.toContain(
        "WHERE status = 'OPEN'"
      )
    })
  })

  it('rejects version 4 schema drift in the compatibility contract', async () => {
    await expectVersion4Drift(
      (connection) => connection.exec('DROP TABLE screening_session_lifecycle_history'),
      'missing lifecycle table'
    )
    await expectVersion4Drift(
      (connection) => connection.exec('DROP INDEX ix_screening_sessions_date_status'),
      'missing session index'
    )
    await expectVersion4Drift(
      (connection) =>
        connection.exec(
          `DROP INDEX ix_screening_sessions_date_status;
           CREATE INDEX ix_screening_sessions_date_status
             ON screening_sessions (session_date, status, id DESC);`
        ),
      'wrong index direction'
    )
    await expectVersion4Drift(
      (connection) =>
        connection.exec(
          `CREATE UNIQUE INDEX ux_screening_sessions_one_open
             ON screening_sessions ((1))
             WHERE status = 'OPEN';`
        ),
      'global one-open index'
    )
    await expectVersion4MigrationDrift(
      '  row_version INTEGER NOT NULL CHECK (row_version >= 1),\n',
      '',
      'missing row version'
    )
    await expectVersion4MigrationDrift(
      "status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED'))",
      'status TEXT NOT NULL',
      'missing status check'
    )
    await expectVersion4MigrationDrift(
      '  CONSTRAINT fk_screening_sessions_opened_by FOREIGN KEY (opened_by)\n    REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT,\n',
      '',
      'missing opened-by foreign key'
    )
  })

  it('preserves version 3 patient amendment invariants in the version 4 contract', async () => {
    await expectVersion4Drift(
      (connection) =>
        connection.exec(
          `DROP TRIGGER tr_patient_demographic_amendments_no_update;
           CREATE TRIGGER tr_patient_demographic_amendments_no_update
           BEFORE UPDATE ON patient_demographic_amendments
           BEGIN
             SELECT 1;
           END;`
        ),
      'changed version 3 trigger body'
    )
    await expectVersion3InvariantMigrationDrift(
      '  CONSTRAINT ux_patient_demographic_amendments_patient_resulting_row_version\n    UNIQUE (patient_id, resulting_row_version),\n',
      '',
      'missing amendment patient/resulting-version uniqueness'
    )
    await expectVersion3InvariantMigrationDrift(
      '  CONSTRAINT fk_patient_demographic_amendments_patient FOREIGN KEY (patient_id)\n    REFERENCES patients (id) ON UPDATE RESTRICT ON DELETE RESTRICT,\n',
      '',
      'missing amendment patient foreign key'
    )
    await expectVersion3InvariantMigrationDrift(
      "  CONSTRAINT ck_patient_demographic_amendments_other_note\n    CHECK (\n      reason_code <> 'OTHER'\n      OR (reason_note IS NOT NULL AND length(trim(reason_note)) > 0)\n    ),\n",
      '',
      'missing amendment table check'
    )
    await expectVersion4Drift(
      (connection) =>
        connection.exec(
          `DROP INDEX ix_patient_demographic_amendments_patient_time;
           CREATE INDEX ix_patient_demographic_amendments_patient_time
             ON patient_demographic_amendments (patient_id, amended_at, id DESC);`
        ),
      'changed version 3 index direction'
    )
  })

  it('persists migrated lifecycle rows after reopening the database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hsd027-reopen-'))
    const databasePath = join(directory, 'health-screening.sqlite3')
    const connection = new Database(databasePath)

    try {
      configurePragmas(connection)
      runToVersion3(connection)
      insertLegacyGraph(connection)
      insertLegacySession(connection, {
        id: openSessionId,
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: userOpenId,
        openedAt: now,
        updatedAt: now
      })
      migrateToVersion4(connection)
    } finally {
      connection.close()
    }

    const reopened = new Database(databasePath)

    try {
      configurePragmas(reopened)
      expect(readUserVersion(reopened)).toBe(4)
      expect(readScreeningSession(reopened, openSessionId)?.row_version).toBe(1)
      expect(readLifecycleHistory(reopened, openSessionId)).toHaveLength(1)
    } finally {
      reopened.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rolls back a forced version 4 rebuild failure without leaving partial tables', async () => {
    await withVersion3Database((connection) => {
      insertLegacyGraph(connection)
      insertLegacySession(connection, {
        id: openSessionId,
        locationId: locationOneId,
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: userOpenId,
        openedAt: now,
        updatedAt: now
      })

      const version4 = databaseMigrations[3]

      if (version4 === undefined) {
        throw new Error('Missing version 4 migration')
      }

      const brokenVersion4: DatabaseMigration = {
        ...version4,
        sql: version4.sql.replace(
          'CREATE UNIQUE INDEX ux_screening_sessions_location_date',
          'SELECT * FROM missing_hsd027_forced_failure;\n\nCREATE UNIQUE INDEX ux_screening_sessions_location_date'
        )
      }

      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: [...databaseMigrations.slice(0, 3), brokenVersion4],
          applicationVersion: '1.0.0',
          logger: createLogger(),
          clock: fixedClock,
          expectedHighestVersion: 4,
          schemaValidators: new Map([[4, validateSchemaVersion4]])
        })
      ).toThrow(MigrationExecutionError)

      expect(readUserVersion(connection)).toBe(3)
      expect(hasTable(connection, 'screening_sessions')).toBe(true)
      expect(hasTable(connection, 'screening_sessions_v3')).toBe(false)
      expect(hasTable(connection, 'screening_session_lifecycle_history')).toBe(false)
      expect(readScreeningSessionColumns(connection)).not.toContain('row_version')
    })
  })
})

const fixedClock = {
  now: () => now
}

function testEntityId(sequence: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, '0')}`
}

function expectMigratedHistoryId(value: unknown): void {
  expect(typeof value).toBe('string')

  const id = String(value)

  expect(() => parseEntityId(id)).not.toThrow()
  expect(id).not.toContain('migration-v4')
}

function stripHistoryId(row: Record<string, unknown> | undefined): Record<string, unknown> {
  if (row === undefined) {
    throw new Error('Expected migrated lifecycle-history row')
  }

  const copy = { ...row }
  delete copy.id

  return copy
}

async function withMigratedDatabase(test: (connection: Database.Database) => void): Promise<void> {
  await withDatabase((connection) => {
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: createLogger(),
      clock: fixedClock
    })(connection)
    test(connection)
  })
}

async function withVersion3Database(test: (connection: Database.Database) => void): Promise<void> {
  await withDatabase((connection) => {
    runToVersion3(connection)
    test(connection)
  })
}

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd027-screening-session-migration-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    test(connection)
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function runToVersion3(connection: Database.Database): void {
  runDatabaseMigrations({
    connection,
    migrations: databaseMigrations.slice(0, 3),
    applicationVersion: '1.0.0',
    logger: createLogger(),
    clock: fixedClock,
    expectedHighestVersion: 3
  })
}

function migrateToVersion4(connection: Database.Database): void {
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: createLogger(),
    clock: fixedClock
  })(connection)
}

function createLogger(): TestLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  }
}

function insertLegacyGraph(connection: Database.Database): void {
  insertUser(connection, userOpenId)
  insertUser(connection, userCloseId)
  insertLocation(connection, locationOneId)
  insertLocation(connection, locationTwoId)
  insertProtocol(connection)
}

function insertVersion4Graph(connection: Database.Database): void {
  insertLegacyGraph(connection)
}

function insertUser(connection: Database.Database, id: string): void {
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
    .run(id, id, id, id, 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, now, now)
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
    .run(id, id, id, 'COMMUNITY', 1, userOpenId, now, userOpenId, now)
}

function insertProtocol(connection: Database.Database): void {
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
      'bp-screening',
      'v1',
      'ACTIVE',
      '{}',
      'checksum',
      userOpenId,
      now,
      userOpenId,
      now,
      now
    )
}

function insertPatient(connection: Database.Database): void {
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
      patientId,
      'P-TEST-000001',
      'Test Screening Patient',
      'Test',
      'Patient',
      'test patient',
      'UNKNOWN',
      '1990-01-01',
      'ACTIVE',
      userOpenId,
      now,
      userOpenId,
      now
    )
}

function insertScreeningEncounter(
  connection: Database.Database,
  input: {
    id: string
    sessionId: string
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
        record_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      patientId,
      input.sessionId,
      locationOneId,
      protocolId,
      'DRAFT',
      now,
      null,
      'LOCAL',
      userOpenId,
      1,
      now,
      now
    )
}

function insertLegacySession(
  connection: Database.Database,
  input: {
    id: string
    locationId: string
    date: string
    status: string
    createdBy: string
    openedAt: string
    closedBy?: string
    closedAt?: string
    updatedAt: string
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
        created_by,
        created_at,
        opened_at,
        closed_by,
        closed_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.locationId,
      protocolId,
      input.date,
      input.status,
      input.createdBy,
      now,
      input.openedAt,
      input.closedBy ?? null,
      input.closedAt ?? null,
      input.updatedAt
    )
}

function insertScreeningSessionV4(
  connection: Database.Database,
  input: {
    id: string
    locationId: string
    date: string
    status: 'OPEN' | 'CLOSED'
    closedBy?: string
    closedAt?: string
    rowVersion: number
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
        opened_by,
        opened_at,
        closed_by,
        closed_at,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.locationId,
      protocolId,
      input.date,
      input.status,
      userOpenId,
      now,
      input.closedBy ?? null,
      input.closedAt ?? null,
      userOpenId,
      now,
      input.closedBy ?? userOpenId,
      input.closedAt ?? now,
      input.rowVersion
    )
}

function insertLifecycleHistory(
  connection: Database.Database,
  input: {
    id: string
    sessionId: string
    transitionType: 'CREATED' | 'CLOSED' | 'REOPENED'
    fromStatus: 'OPEN' | 'CLOSED' | null
    toStatus: 'OPEN' | 'CLOSED'
    reason: string | null
    changedBy: string
    priorRowVersion: number | null
    resultingRowVersion: number
  }
): void {
  connection
    .prepare(
      `INSERT INTO screening_session_lifecycle_history (
        id,
        screening_session_id,
        transition_type,
        from_status,
        to_status,
        reason,
        changed_by,
        changed_at,
        prior_row_version,
        resulting_row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.sessionId,
      input.transitionType,
      input.fromStatus,
      input.toStatus,
      input.reason,
      input.changedBy,
      now,
      input.priorRowVersion,
      input.resultingRowVersion
    )
}

function readScreeningSession(
  connection: Database.Database,
  id: string
): Record<string, unknown> | undefined {
  return connection.prepare('SELECT * FROM screening_sessions WHERE id = ?').get(id) as
    Record<string, unknown> | undefined
}

function readLifecycleHistory(
  connection: Database.Database,
  sessionId: string
): readonly Record<string, unknown>[] {
  return connection
    .prepare(
      `SELECT *
       FROM screening_session_lifecycle_history
       WHERE screening_session_id = ?
       ORDER BY changed_at ASC, id ASC`
    )
    .all(sessionId) as Record<string, unknown>[]
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function readForeignKeyEnforcement(connection: Database.Database): number {
  return connection.pragma('foreign_keys', { simple: true }) as number
}

function readLegacyAlterTable(connection: Database.Database): number {
  return connection.pragma('legacy_alter_table', { simple: true }) as number
}

function readSchemaMigrationVersions(connection: Database.Database): readonly number[] {
  return (
    connection
      .prepare(
        `SELECT version
         FROM schema_migrations
         ORDER BY version`
      )
      .all() as Array<{ version: number }>
  ).map((row) => row.version)
}

function readForeignKeyTarget(
  connection: Database.Database,
  tableName: string,
  fromColumn: string
): string | null {
  const row = (
    connection.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`).all() as Array<{
      from: string
      table: string
    }>
  ).find((candidate) => candidate.from === fromColumn)

  return row?.table ?? null
}

function hasTable(connection: Database.Database, tableName: string): boolean {
  const row = connection
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { found?: number } | undefined

  return row?.found === 1
}

function readScreeningSessionColumns(connection: Database.Database): readonly string[] {
  return (
    connection.prepare('PRAGMA table_xinfo(screening_sessions)').all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function readIndexDefinition(
  connection: Database.Database,
  indexName: string
): {
  tableName: string
  unique: boolean
  columns: readonly { name: string; descending: boolean }[]
} {
  const row = connection
    .prepare("SELECT tbl_name AS tableName FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(indexName) as { tableName: string }
  const indexListRow = (
    connection.prepare(`PRAGMA index_list(${quoteIdentifier(row.tableName)})`).all() as Array<{
      name: string
      unique: number
    }>
  ).find((candidate) => candidate.name === indexName)

  return {
    tableName: row.tableName,
    unique: indexListRow?.unique === 1,
    columns: (
      connection.prepare(`PRAGMA index_xinfo(${quoteIdentifier(indexName)})`).all() as Array<{
        seqno: number
        name: string
        desc: number
        key: number
      }>
    )
      .filter((column) => column.key === 1)
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => ({
        name: column.name,
        descending: column.desc === 1
      }))
  }
}

function readScreeningSessionIndexSql(connection: Database.Database): readonly string[] {
  return (
    connection
      .prepare(
        `SELECT sql
         FROM sqlite_master
         WHERE type = 'index'
           AND tbl_name = 'screening_sessions'
           AND sql IS NOT NULL`
      )
      .all() as Array<{ sql: string }>
  ).map((row) => row.sql)
}

async function expectVersion4Drift(
  mutate: (connection: Database.Database) => void,
  label: string
): Promise<void> {
  await withMigratedDatabase((connection) => {
    mutate(connection)

    expect(() => validateSchemaVersion4(connection, 'compatibility'), label).toThrow(
      MigrationCompatibilityError
    )
  })
}

async function expectVersion4MigrationDrift(
  search: string,
  replacement: string,
  label: string
): Promise<void> {
  const version4 = databaseMigrations[3]

  if (version4 === undefined) {
    throw new Error('Missing version 4 migration')
  }

  if (!version4.sql.includes(search)) {
    throw new Error(`Missing drift search target for ${label}`)
  }

  await withDatabase((connection) => {
    expect(() =>
      runDatabaseMigrations({
        connection,
        migrations: [
          ...databaseMigrations.slice(0, 3),
          {
            ...version4,
            sql: version4.sql.replace(search, replacement)
          }
        ],
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock,
        expectedHighestVersion: 4,
        schemaValidators: new Map([[4, validateSchemaVersion4]])
      })
    ).toThrow(MigrationExecutionError)
  })
}

async function expectVersion3InvariantMigrationDrift(
  search: string,
  replacement: string,
  label: string
): Promise<void> {
  const version3 = databaseMigrations[2]
  const version4 = databaseMigrations[3]

  if (version3 === undefined || version4 === undefined) {
    throw new Error('Missing version 3 or version 4 migration')
  }

  const normalizedVersion3Sql = version3.sql.replaceAll('\r\n', '\n')

  if (!normalizedVersion3Sql.includes(search)) {
    throw new Error(`Missing version 3 drift search target for ${label}`)
  }

  await withDatabase((connection) => {
    expect(() =>
      runDatabaseMigrations({
        connection,
        migrations: [
          ...databaseMigrations.slice(0, 2),
          {
            ...version3,
            sql: normalizedVersion3Sql.replace(search, replacement)
          },
          version4
        ],
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock,
        expectedHighestVersion: 4,
        schemaValidators: new Map([[4, validateSchemaVersion4]])
      })
    ).toThrow(MigrationExecutionError)
  })
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
