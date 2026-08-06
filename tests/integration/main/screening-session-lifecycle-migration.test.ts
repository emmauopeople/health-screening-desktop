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

const now = '2026-07-29T08:00:00.000Z'
const closedAt = '2026-07-29T16:30:00.000Z'

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
        id: 'session-open',
        locationId: 'location-1',
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: 'user-open',
        openedAt: now,
        updatedAt: now
      })
      insertLegacySession(connection, {
        id: 'session-closed',
        locationId: 'location-1',
        date: '2026-07-30',
        status: 'CLOSED',
        createdBy: 'user-open',
        openedAt: now,
        closedBy: 'user-close',
        closedAt,
        updatedAt: closedAt
      })

      migrateToVersion4(connection)

      expect(readUserVersion(connection)).toBe(4)
      expect(readScreeningSession(connection, 'session-open')).toEqual({
        id: 'session-open',
        location_id: 'location-1',
        protocol_version_id: 'protocol-1',
        session_date: '2026-07-29',
        status: 'OPEN',
        notes: null,
        opened_by: 'user-open',
        opened_at: now,
        closed_by: null,
        closed_at: null,
        created_by: 'user-open',
        created_at: now,
        updated_by: 'user-open',
        updated_at: now,
        row_version: 1
      })
      expect(readScreeningSession(connection, 'session-closed')).toEqual({
        id: 'session-closed',
        location_id: 'location-1',
        protocol_version_id: 'protocol-1',
        session_date: '2026-07-30',
        status: 'CLOSED',
        notes: null,
        opened_by: 'user-open',
        opened_at: now,
        closed_by: 'user-close',
        closed_at: closedAt,
        created_by: 'user-open',
        created_at: now,
        updated_by: 'user-close',
        updated_at: closedAt,
        row_version: 2
      })
      expect(readLifecycleHistory(connection, 'session-open')).toEqual([
        {
          id: 'migration-v4-created-session-open',
          screening_session_id: 'session-open',
          transition_type: 'CREATED',
          from_status: null,
          to_status: 'OPEN',
          reason: null,
          changed_by: 'user-open',
          changed_at: now,
          prior_row_version: null,
          resulting_row_version: 1
        }
      ])
      expect(readLifecycleHistory(connection, 'session-closed')).toEqual([
        {
          id: 'migration-v4-created-session-closed',
          screening_session_id: 'session-closed',
          transition_type: 'CREATED',
          from_status: null,
          to_status: 'OPEN',
          reason: null,
          changed_by: 'user-open',
          changed_at: now,
          prior_row_version: null,
          resulting_row_version: 1
        },
        {
          id: 'migration-v4-closed-session-closed',
          screening_session_id: 'session-closed',
          transition_type: 'CLOSED',
          from_status: 'OPEN',
          to_status: 'CLOSED',
          reason: null,
          changed_by: 'user-close',
          changed_at: closedAt,
          prior_row_version: 1,
          resulting_row_version: 2
        }
      ])
      expect(connection.pragma('foreign_key_check')).toEqual([])
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
            id: 'session-bad-status',
            locationId: 'location-1',
            date: '2026-07-29',
            status: 'PAUSED',
            createdBy: 'user-open',
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
            id: 'session-closed-bad',
            locationId: 'location-1',
            date: '2026-07-29',
            status: 'CLOSED',
            createdBy: 'user-open',
            openedAt: now,
            updatedAt: now
          })
      },
      {
        label: 'invalid foreign key',
        seed: (connection) => {
          connection.pragma('foreign_keys = OFF')
          insertLegacySession(connection, {
            id: 'session-missing-location',
            locationId: 'missing-location',
            date: '2026-07-29',
            status: 'OPEN',
            createdBy: 'user-open',
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
      })
    }
  })

  it('enforces lifecycle-ready screening session and history constraints', async () => {
    await withMigratedDatabase((connection) => {
      insertVersion4Graph(connection)
      insertScreeningSessionV4(connection, {
        id: 'session-1',
        locationId: 'location-1',
        date: '2026-07-29',
        status: 'OPEN',
        rowVersion: 1
      })
      insertScreeningSessionV4(connection, {
        id: 'session-2',
        locationId: 'location-2',
        date: '2026-07-29',
        status: 'OPEN',
        rowVersion: 1
      })

      expect(() =>
        insertScreeningSessionV4(connection, {
          id: 'session-duplicate',
          locationId: 'location-1',
          date: '2026-07-29',
          status: 'OPEN',
          rowVersion: 1
        })
      ).toThrow()
      expect(() =>
        insertScreeningSessionV4(connection, {
          id: 'session-open-with-close',
          locationId: 'location-1',
          date: '2026-07-30',
          status: 'OPEN',
          closedBy: 'user-open',
          closedAt,
          rowVersion: 1
        })
      ).toThrow()
      expect(() =>
        insertScreeningSessionV4(connection, {
          id: 'session-closed-without-close',
          locationId: 'location-1',
          date: '2026-07-31',
          status: 'CLOSED',
          rowVersion: 2
        })
      ).toThrow()
      expect(() =>
        insertScreeningSessionV4(connection, {
          id: 'session-bad-version',
          locationId: 'location-1',
          date: '2026-08-01',
          status: 'OPEN',
          rowVersion: 0
        })
      ).toThrow()

      expect(() =>
        insertLifecycleHistory(connection, {
          id: 'history-created',
          sessionId: 'session-1',
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: 'user-open',
          priorRowVersion: null,
          resultingRowVersion: 1
        })
      ).not.toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: 'history-reopened-no-reason',
          sessionId: 'session-1',
          transitionType: 'REOPENED',
          fromStatus: 'CLOSED',
          toStatus: 'OPEN',
          reason: null,
          changedBy: 'user-open',
          priorRowVersion: 2,
          resultingRowVersion: 3
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: 'history-reopened-blank-reason',
          sessionId: 'session-1',
          transitionType: 'REOPENED',
          fromStatus: 'CLOSED',
          toStatus: 'OPEN',
          reason: '   ',
          changedBy: 'user-open',
          priorRowVersion: 2,
          resultingRowVersion: 3
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: 'history-nonconsecutive',
          sessionId: 'session-1',
          transitionType: 'CLOSED',
          fromStatus: 'OPEN',
          toStatus: 'CLOSED',
          reason: null,
          changedBy: 'user-open',
          priorRowVersion: 2,
          resultingRowVersion: 4
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: 'history-missing-session',
          sessionId: 'missing-session',
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: 'user-open',
          priorRowVersion: null,
          resultingRowVersion: 1
        })
      ).toThrow()
      expect(() =>
        insertLifecycleHistory(connection, {
          id: 'history-missing-user',
          sessionId: 'session-1',
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: 'missing-user',
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

  it('persists migrated lifecycle rows after reopening the database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hsd027-reopen-'))
    const databasePath = join(directory, 'health-screening.sqlite3')
    const connection = new Database(databasePath)

    try {
      configurePragmas(connection)
      runToVersion3(connection)
      insertLegacyGraph(connection)
      insertLegacySession(connection, {
        id: 'session-open',
        locationId: 'location-1',
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: 'user-open',
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
      expect(readScreeningSession(reopened, 'session-open')?.row_version).toBe(1)
      expect(readLifecycleHistory(reopened, 'session-open')).toHaveLength(1)
    } finally {
      reopened.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rolls back a forced version 4 rebuild failure without leaving partial tables', async () => {
    await withVersion3Database((connection) => {
      insertLegacyGraph(connection)
      insertLegacySession(connection, {
        id: 'session-open',
        locationId: 'location-1',
        date: '2026-07-29',
        status: 'OPEN',
        createdBy: 'user-open',
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
  insertUser(connection, 'user-open')
  insertUser(connection, 'user-close')
  insertLocation(connection, 'location-1')
  insertLocation(connection, 'location-2')
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
    .run(id, id, id, 'COMMUNITY', 1, 'user-open', now, 'user-open', now)
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
      'protocol-1',
      'bp-screening',
      'v1',
      'ACTIVE',
      '{}',
      'checksum',
      'user-open',
      now,
      'user-open',
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
      'protocol-1',
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
      'protocol-1',
      input.date,
      input.status,
      'user-open',
      now,
      input.closedBy ?? null,
      input.closedAt ?? null,
      'user-open',
      now,
      input.closedBy ?? 'user-open',
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

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
