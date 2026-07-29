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
import { computeMigrationChecksum } from '@main/database/migrations/migration-checksum'
import { databaseMigrations } from '@main/database/migrations/migration-manifest'
import { runDatabaseMigrations } from '@main/database/migrations/migration-runner'
import type { DatabaseMigration } from '@main/database/migrations/migration-types'

type MockLogMethod = ReturnType<typeof vi.fn<(message: string) => void>>

interface TestLogger {
  info: MockLogMethod
  error: MockLogMethod
}

const fixedClock = {
  now: () => '2026-07-29T00:00:00.000Z'
}

describe('migration runner integration', () => {
  it('upgrades a fresh HSD-006 database to schema version 1 and is idempotent', async () => {
    await withDatabase((connection) => {
      const logger = createLogger()
      const productionMigration = databaseMigrations[0]!
      const migrate = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger,
        clock: fixedClock
      })

      expect(readUserVersion(connection)).toBe(0)

      const firstSummary = migrate(connection)

      expect(firstSummary).toEqual({
        previousVersion: 0,
        currentVersion: 1,
        appliedVersions: [1]
      })
      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerRows(connection)).toEqual([
        {
          version: 1,
          name: 'initial-schema',
          checksum: computeMigrationChecksum(productionMigration.sql),
          applied_at: fixedClock.now(),
          application_version: '1.0.0'
        }
      ])

      const secondSummary = migrate(connection)

      expect(secondSummary).toEqual({
        previousVersion: 1,
        currentVersion: 1,
        appliedVersions: []
      })
      expect(readLedgerRows(connection)).toHaveLength(1)
      expect(logger.info.mock.calls.flat()).toContain(
        'Database migrations current; schemaVersion=1'
      )
    })
  })

  it('runs multiple injected migrations in order without adding a second production migration', async () => {
    await withDatabase((connection) => {
      const logger = createLogger()
      const migrations: readonly DatabaseMigration[] = [
        {
          version: 1,
          name: 'first',
          sql: 'CREATE TABLE first_test_table (id TEXT PRIMARY KEY) STRICT;'
        },
        {
          version: 2,
          name: 'second',
          sql: 'CREATE TABLE second_test_table (id TEXT PRIMARY KEY) STRICT;'
        }
      ]

      const summary = runDatabaseMigrations({
        connection,
        migrations,
        applicationVersion: '1.0.0',
        logger,
        clock: fixedClock
      })

      expect(summary).toEqual({
        previousVersion: 0,
        currentVersion: 2,
        appliedVersions: [1, 2]
      })
      expect(readUserVersion(connection)).toBe(2)
      expect(hasTable(connection, 'first_test_table')).toBe(true)
      expect(hasTable(connection, 'second_test_table')).toBe(true)
      expect(readLedgerRows(connection).map((row) => row.name)).toEqual(['first', 'second'])
    })
  })

  it('rolls back a failed migration without leaving schema or ledger artifacts', async () => {
    await withDatabase((connection) => {
      const logger = createLogger()

      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: [
            {
              version: 1,
              name: 'broken',
              sql: 'CREATE TABLE transient_table (id TEXT PRIMARY KEY) STRICT; SELECT * FROM missing_table;'
            }
          ],
          applicationVersion: '1.0.0',
          logger,
          clock: fixedClock
        })
      ).toThrow(MigrationExecutionError)

      expect(readUserVersion(connection)).toBe(0)
      expect(hasTable(connection, 'schema_migrations')).toBe(false)
      expect(hasTable(connection, 'transient_table')).toBe(false)
      expect(logger.error.mock.calls.join('\n')).toContain(
        'Database migration failed; version=1; name=broken; phase=execute; errorType=SqliteError'
      )
    })
  })

  it('keeps prior committed versions when a later injected migration fails', async () => {
    await withDatabase((connection) => {
      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: [
            {
              version: 1,
              name: 'first',
              sql: 'CREATE TABLE committed_table (id TEXT PRIMARY KEY) STRICT;'
            },
            {
              version: 2,
              name: 'broken-second',
              sql: 'CREATE TABLE rolled_back_table (id TEXT PRIMARY KEY) STRICT; SELECT * FROM missing_table;'
            }
          ],
          applicationVersion: '1.0.0',
          logger: createLogger(),
          clock: fixedClock
        })
      ).toThrow(MigrationExecutionError)

      expect(readUserVersion(connection)).toBe(1)
      expect(hasTable(connection, 'committed_table')).toBe(true)
      expect(hasTable(connection, 'rolled_back_table')).toBe(false)
      expect(readLedgerRows(connection).map((row) => row.name)).toEqual(['first'])
    })
  })

  it('logs rollback failure safely without replacing the controlled execution error', () => {
    const logger = createLogger()
    const connection = createRollbackFailureConnection()

    expect(() =>
      runDatabaseMigrations({
        connection,
        migrations: [
          {
            version: 1,
            name: 'broken',
            sql: 'SELECT * FROM patient_secret_value;'
          }
        ],
        applicationVersion: '1.0.0',
        logger,
        clock: fixedClock
      })
    ).toThrow(MigrationExecutionError)

    const errorLog = logger.error.mock.calls.join('\n')

    expect(errorLog).toContain(
      'Database migration rollback failed; version=1; name=broken; phase=rollback; errorType=Error'
    )
    expect(errorLog).toContain(
      'Database migration failed; version=1; name=broken; phase=execute; errorType=Error'
    )
    expect(errorLog).not.toContain('patient_secret_value')
    expect(errorLog).not.toContain('C:\\secret')
  })

  it('refuses checksum and name mismatches before applying pending migrations', async () => {
    await withDatabase((connection) => {
      const productionMigration = databaseMigrations[0]!
      const migrate = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })
      migrate(connection)

      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: [{ ...productionMigration, sql: `${productionMigration.sql}\n` }],
          applicationVersion: '1.0.1',
          logger: createLogger(),
          clock: fixedClock
        })
      ).toThrow(MigrationCompatibilityError)

      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: [{ ...productionMigration, name: 'renamed-initial-schema' }],
          applicationVersion: '1.0.1',
          logger: createLogger(),
          clock: fixedClock
        })
      ).toThrow(MigrationCompatibilityError)

      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerRows(connection)).toHaveLength(1)
    })
  })

  it('refuses newer and inconsistent migration metadata without repair', async () => {
    await withDatabase((connection) => {
      connection.exec('PRAGMA user_version = 2')

      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: databaseMigrations,
          applicationVersion: '1.0.0',
          logger: createLogger(),
          clock: fixedClock,
          expectedHighestVersion: 1
        })
      ).toThrow(MigrationCompatibilityError)

      expect(readUserVersion(connection)).toBe(2)
      expect(hasTable(connection, 'schema_migrations')).toBe(false)
    })

    await withDatabase((connection) => {
      connection.exec('PRAGMA user_version = 1')

      expectProductionMigrationCompatibilityFailure(connection)
    })

    await withDatabase((connection) => {
      connection.exec(createTestLedgerSql)

      expectProductionMigrationCompatibilityFailure(connection)
    })

    await withDatabase((connection) => {
      createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })(connection)
      connection.prepare('DELETE FROM schema_migrations WHERE version = 1').run()

      expectProductionMigrationCompatibilityFailure(connection)
    })

    await withDatabase((connection) => {
      createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })(connection)
      connection
        .prepare(
          `INSERT INTO schema_migrations (
            version,
            name,
            checksum,
            applied_at,
            application_version
          ) VALUES (?, ?, ?, ?, ?)`
        )
        .run(2, 'extra', 'a'.repeat(64), fixedClock.now(), '1.0.0')

      expectProductionMigrationCompatibilityFailure(connection)
    })
  })
})

async function withDatabase(test: (connection: Database.Database) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd007-migration-runner-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    test(connection)
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function expectProductionMigrationCompatibilityFailure(connection: Database.Database): void {
  expect(() =>
    runDatabaseMigrations({
      connection,
      migrations: databaseMigrations,
      applicationVersion: '1.0.0',
      logger: createLogger(),
      clock: fixedClock,
      expectedHighestVersion: 1
    })
  ).toThrow(MigrationCompatibilityError)
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function readLedgerRows(connection: Database.Database): Array<{
  version: number
  name: string
  checksum: string
  applied_at: string
  application_version: string
}> {
  return connection
    .prepare(
      `SELECT version, name, checksum, applied_at, application_version
       FROM schema_migrations
       ORDER BY version`
    )
    .all() as Array<{
    version: number
    name: string
    checksum: string
    applied_at: string
    application_version: string
  }>
}

function hasTable(connection: Database.Database, tableName: string): boolean {
  const row = connection
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { found?: number } | undefined

  return row?.found === 1
}

const createTestLedgerSql = `
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK (version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL CHECK (length(checksum) = 64),
  applied_at TEXT NOT NULL,
  application_version TEXT NOT NULL
) STRICT;
`

function createLogger(): TestLogger {
  return {
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  }
}

function createRollbackFailureConnection(): Database.Database {
  const prepare = vi.fn(() => ({
    get: vi.fn(() => undefined),
    all: vi.fn(() => [])
  }))
  const exec = vi.fn((sql: string) => {
    if (sql === 'BEGIN IMMEDIATE' || sql.includes('schema_migrations')) {
      return
    }

    if (sql === 'ROLLBACK') {
      throw new Error('C:\\secret\\rollback.sqlite3')
    }

    throw new Error('SELECT * FROM patient_secret_value')
  })

  return {
    inTransaction: false,
    pragma: vi.fn(() => 0),
    prepare,
    exec
  } as unknown as Database.Database
}
