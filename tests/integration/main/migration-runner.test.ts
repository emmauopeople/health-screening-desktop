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
import { validateSchemaVersion1 } from '@main/database/migrations/schema-v1-contract'

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

  it('allows application version changes without rewriting historical ledger rows', async () => {
    await withDatabase((connection) => {
      const logger = createLogger()
      const firstRunner = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger,
        clock: fixedClock
      })
      const secondRunner = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.1',
        logger,
        clock: { now: () => '2026-07-30T00:00:00.000Z' }
      })

      firstRunner(connection)
      const originalLedger = readLedgerRows(connection)
      const appliedLogCount = countAppliedMigrationLogs(logger)
      const secondSummary = secondRunner(connection)

      expect(secondSummary).toEqual({
        previousVersion: 1,
        currentVersion: 1,
        appliedVersions: []
      })
      expect(readLedgerRows(connection)).toEqual(originalLedger)
      expect(readLedgerRows(connection)[0]?.application_version).toBe('1.0.0')
      expect(countAppliedMigrationLogs(logger)).toBe(appliedLogCount)
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

  it('refuses to run when a transaction is already open', async () => {
    await withDatabase((connection) => {
      const migrate = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })

      connection.exec('BEGIN')

      try {
        expect(() => migrate(connection)).toThrow(MigrationExecutionError)
        expect(readUserVersion(connection)).toBe(0)
        expect(hasTable(connection, 'schema_migrations')).toBe(false)
        expect(hasTable(connection, 'app_settings')).toBe(false)
      } finally {
        connection.exec('ROLLBACK')
      }
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

  it('validates schema version 1 before commit and rolls back invalid completed SQL', async () => {
    await withDatabase((connection) => {
      const logger = createLogger()

      expect(() =>
        runDatabaseMigrations({
          connection,
          migrations: [
            {
              version: 1,
              name: 'partial-schema',
              sql: `CREATE TABLE app_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                sensitivity_classification TEXT NOT NULL
              ) STRICT;`
            }
          ],
          applicationVersion: '1.0.0',
          logger,
          clock: fixedClock,
          schemaValidators: new Map([[1, validateSchemaVersion1]])
        })
      ).toThrow(MigrationExecutionError)

      expect(readUserVersion(connection)).toBe(0)
      expect(hasTable(connection, 'schema_migrations')).toBe(false)
      expect(hasTable(connection, 'app_settings')).toBe(false)
      expect(logger.error.mock.calls.join('\n')).toContain(
        'Database migration failed; version=1; name=partial-schema; phase=schema; errorType=MigrationExecutionError'
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

  it('throws controlled migration errors without raw causes or serializable stack details', async () => {
    await withDatabase((connection) => {
      const error = captureError(() =>
        runDatabaseMigrations({
          connection,
          migrations: [
            {
              version: 1,
              name: 'broken',
              sql: 'SELECT * FROM patient_secret_value_at_C:\\secret\\database.sqlite3;'
            }
          ],
          applicationVersion: '1.0.0',
          logger: createLogger(),
          clock: fixedClock
        })
      )

      expect(error).toBeInstanceOf(MigrationExecutionError)
      expect(error).not.toHaveProperty('cause')
      expect((error as Error).stack).toBeUndefined()
      expect(JSON.stringify(error)).not.toContain('patient_secret_value')
      expect(JSON.stringify(error)).not.toContain('C:\\secret')
      expect(JSON.stringify(error)).not.toContain('stack')
    })
  })

  it('refuses historical checksum and name mismatches before executing pending migrations', async () => {
    await withDatabase((connection) => {
      const version1: DatabaseMigration = {
        version: 1,
        name: 'first',
        sql: 'CREATE TABLE first_test_table (id TEXT PRIMARY KEY) STRICT;'
      }
      const version2: DatabaseMigration = {
        version: 2,
        name: 'second',
        sql: 'CREATE TABLE second_test_table (id TEXT PRIMARY KEY) STRICT;'
      }

      runDatabaseMigrations({
        connection,
        migrations: [version1],
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })

      const originalLedger = readLedgerRows(connection)
      const originalChecksum = originalLedger[0]?.checksum ?? ''
      const alteredSqlLogger = createLogger()
      const renamedLogger = createLogger()

      const alteredSqlError = captureError(() =>
        runDatabaseMigrations({
          connection,
          migrations: [{ ...version1, sql: `${version1.sql}\n-- changed` }, version2],
          applicationVersion: '1.0.1',
          logger: alteredSqlLogger,
          clock: fixedClock
        })
      )
      expect(alteredSqlError).toBeInstanceOf(MigrationCompatibilityError)
      expect(alteredSqlError).not.toHaveProperty('cause')
      expect((alteredSqlError as Error).stack).toBeUndefined()
      expect(JSON.stringify(alteredSqlError)).not.toContain(originalChecksum)
      expect(readUserVersion(connection)).toBe(1)
      expect(hasTable(connection, 'second_test_table')).toBe(false)
      expect(readLedgerRows(connection)).toEqual(originalLedger)
      expectLogsAreHistoryMismatchSafe(alteredSqlLogger, originalChecksum)

      const renamedError = captureError(() =>
        runDatabaseMigrations({
          connection,
          migrations: [{ ...version1, name: 'renamed-first' }, version2],
          applicationVersion: '1.0.1',
          logger: renamedLogger,
          clock: fixedClock
        })
      )
      expect(renamedError).toBeInstanceOf(MigrationCompatibilityError)
      expect(renamedError).not.toHaveProperty('cause')
      expect((renamedError as Error).stack).toBeUndefined()
      expect(JSON.stringify(renamedError)).not.toContain(originalChecksum)

      expect(readUserVersion(connection)).toBe(1)
      expect(hasTable(connection, 'second_test_table')).toBe(false)
      expect(readLedgerRows(connection)).toEqual(originalLedger)
      expectLogsAreHistoryMismatchSafe(renamedLogger, originalChecksum)
    })
  })

  it('refuses current schema with a missing required table without changing history', async () => {
    await withDatabase((connection) => {
      const migrate = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })
      migrate(connection)
      const originalLedger = readLedgerRows(connection)

      connection.exec('DROP TABLE app_settings')

      expect(() => migrate(connection)).toThrow(MigrationCompatibilityError)
      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerRows(connection)).toEqual(originalLedger)
    })
  })

  it('refuses current schema with a missing required named index without changing history', async () => {
    await withDatabase((connection) => {
      const migrate = createProductionDatabaseMigrationRunner({
        applicationVersion: '1.0.0',
        logger: createLogger(),
        clock: fixedClock
      })
      migrate(connection)
      const originalLedger = readLedgerRows(connection)

      connection.exec('DROP INDEX ix_locations_name_normalized')

      expect(() => migrate(connection)).toThrow(MigrationCompatibilityError)
      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerRows(connection)).toEqual(originalLedger)
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

function countAppliedMigrationLogs(logger: TestLogger): number {
  return logger.info.mock.calls
    .flat()
    .filter((message) => message === 'Database migration applied; version=1; name=initial-schema')
    .length
}

function expectLogsAreHistoryMismatchSafe(logger: TestLogger, checksum: string): void {
  const logs = [...logger.info.mock.calls.flat(), ...logger.error.mock.calls.flat()].join('\n')

  expect(logs).not.toContain('CREATE TABLE')
  expect(logs).not.toContain('second_test_table')
  expect(logs).not.toContain(checksum)
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
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
