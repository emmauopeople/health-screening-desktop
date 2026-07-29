import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionAsyncWorkError,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  type DatabaseTransactionExecutor
} from '@main/database'
import {
  createEntityIdGenerator,
  createUtcClock,
  EntityIdGenerationError,
  UtcClockError,
  type EntityId,
  type EntityIdGenerator,
  type UtcClock,
  type UtcTimestamp
} from '@main/foundation'

type MockLogMethod = ReturnType<typeof vi.fn<(message: string) => void>>

interface TestLogger {
  error: MockLogMethod
}

const now = '2026-07-29T12:34:56.789Z'
const generatedIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333'
]

describe('database transaction executor', () => {
  it('commits synchronous work durably after HSD-007 migrations', async () => {
    await withMigratedDatabase((connection, databasePath) => {
      const logger = createLogger()
      const executor = createExecutor(connection, { logger })

      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerCount(connection)).toBe(1)

      const result = executor.run((context) => {
        expect(context.connection).toBe(connection)
        expect(Object.isFrozen(context)).toBe(true)

        const entityId = context.newEntityId()
        const timestamp = context.nowUtc()

        insertSetting(connection, 'transaction.feature', '{"enabled":true}', timestamp)
        connection
          .prepare(
            `INSERT INTO sync_attempts (
              id,
              batch_id,
              started_at,
              status,
              item_counts_json
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(entityId, 'batch-1', timestamp, 'COMPLETED', '{"processed":1}')

        return { entityId, timestamp }
      })

      expect(result).toEqual({
        entityId: generatedIds[0],
        timestamp: now
      })
      expect(connection.inTransaction).toBe(false)
      expect(readTableCount(connection, 'app_settings')).toBe(1)
      expect(readTableCount(connection, 'sync_attempts')).toBe(1)
      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerCount(connection)).toBe(1)
      expect(readLogs(logger)).toBe('')

      connection.close()
      const reopened = new Database(databasePath)
      try {
        expect(readTableCount(reopened, 'app_settings')).toBe(1)
        expect(readTableCount(reopened, 'sync_attempts')).toBe(1)
      } finally {
        reopened.close()
      }
    })
  })

  it('rolls back raw work failures and logs only controlled metadata', async () => {
    await withMigratedDatabase((connection) => {
      const logger = createLogger()
      const executor = createExecutor(connection, { logger })
      const unsafeError = new Error('C:\\secret\\patient.sqlite3 SELECT * FROM patients')
      unsafeError.name = 'C:\\secret\\DriverError'

      const error = captureError(() =>
        executor.run((context) => {
          insertSetting(context.connection, 'rolled-back.raw', '{"enabled":true}')
          throw unsafeError
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expect((error as DatabaseTransactionExecutionError).errorType).toBe('UnknownError')
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
      expect(readLogs(logger)).toContain(
        'Database transaction failed; phase=work; errorType=UnknownError'
      )
      expectLogsAreSafe(logger)
    })
  })

  it('rolls back SQLite constraint failures atomically', async () => {
    await withMigratedDatabase((connection) => {
      const logger = createLogger()
      const executor = createExecutor(connection, { logger })

      const error = captureError(() =>
        executor.run((context) => {
          insertSetting(context.connection, 'rolled-back.constraint', '{"enabled":true}')
          insertSetting(context.connection, 'invalid-json', '{invalid')
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expect((error as DatabaseTransactionExecutionError).errorType).toBe('SqliteError')
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
      expect(readLogs(logger)).toContain(
        'Database transaction failed; phase=work; errorType=SqliteError'
      )
    })
  })

  it('rejects pre-existing transactions before invoking work', async () => {
    await withMigratedDatabase((connection) => {
      const logger = createLogger()
      const executor = createExecutor(connection, { logger })
      const work = vi.fn()

      connection.exec('BEGIN')
      try {
        const error = captureError(() => executor.run(work))

        expect(error).toBeInstanceOf(DatabaseTransactionStateError)
        expectSafeControlledError(error)
        expect(work).not.toHaveBeenCalled()
        expect(readUserVersion(connection)).toBe(1)
        expect(readLedgerCount(connection)).toBe(1)
        expect(readTableCount(connection, 'app_settings')).toBe(0)
        expect(readLogs(logger)).toBe(
          'Database transaction failed; phase=state; errorType=DatabaseTransactionStateError'
        )
      } finally {
        connection.exec('ROLLBACK')
      }
    })
  })

  it('rejects re-entrant nested transactions before invoking nested work', async () => {
    await withMigratedDatabase((connection) => {
      const logger = createLogger()
      const executor = createExecutor(connection, { logger })
      const nestedWork = vi.fn()

      const result = executor.run((context) => {
        const nestedError = captureError(() => executor.run(nestedWork))

        expect(nestedError).toBeInstanceOf(DatabaseTransactionStateError)
        insertSetting(context.connection, 'outer-work', '{"enabled":true}')

        return 'outer-result'
      })

      expect(result).toBe('outer-result')
      expect(nestedWork).not.toHaveBeenCalled()
      expect(readTableCount(connection, 'app_settings')).toBe(1)
      expect(connection.inTransaction).toBe(false)
      expect(readLogs(logger)).toContain(
        'Database transaction failed; phase=state; errorType=DatabaseTransactionStateError'
      )
    })
  })

  it('rejects Promise and thenable work and rolls back', async () => {
    await withMigratedDatabase((connection) => {
      const logger = createLogger()
      const executor = createExecutor(connection, { logger })
      const thenable = { then: vi.fn() }

      const promiseError = captureError(() =>
        executor.run((context) => {
          insertSetting(context.connection, 'promise-work', '{"enabled":true}')
          return Promise.resolve('async-result')
        })
      )

      const thenableError = captureError(() =>
        executor.run((context) => {
          insertSetting(context.connection, 'thenable-work', '{"enabled":true}')
          return thenable
        })
      )

      expect(promiseError).toBeInstanceOf(DatabaseTransactionAsyncWorkError)
      expect(thenableError).toBeInstanceOf(DatabaseTransactionAsyncWorkError)
      expectSafeControlledError(promiseError)
      expectSafeControlledError(thenableError)
      expect(thenable.then).not.toHaveBeenCalled()
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rolls back when injected foundation providers return invalid values', async () => {
    await withMigratedDatabase((connection) => {
      const logger = createLogger()
      const unsafeEntityIdGenerator: EntityIdGenerator = {
        generate: () => 'C:\\secret\\patient.sqlite3' as EntityId
      }
      const unsafeClock: UtcClock = {
        now: () => 'C:\\secret\\clock.sqlite3' as UtcTimestamp
      }

      const entityIdError = captureError(() =>
        createExecutor(connection, {
          logger,
          idGenerator: unsafeEntityIdGenerator
        }).run((context) => {
          insertSetting(context.connection, 'invalid-id', '{"enabled":true}')
          context.newEntityId()
        })
      )
      const clockError = captureError(() =>
        createExecutor(connection, {
          logger,
          clock: unsafeClock
        }).run((context) => {
          insertSetting(context.connection, 'invalid-clock', '{"enabled":true}')
          context.nowUtc()
        })
      )

      expect(entityIdError).toBeInstanceOf(EntityIdGenerationError)
      expect(clockError).toBeInstanceOf(UtcClockError)
      expectSafeControlledError(entityIdError)
      expectSafeControlledError(clockError)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
      expect(readLogs(logger)).toContain(
        'Database transaction failed; phase=work; errorType=EntityIdGenerationError'
      )
      expect(readLogs(logger)).toContain(
        'Database transaction failed; phase=work; errorType=UtcClockError'
      )
      expectLogsAreSafe(logger)
    })
  })

  it('does not invoke work or rollback when BEGIN IMMEDIATE fails', () => {
    const logger = createLogger()
    const exec = vi.fn((sql: string): void => {
      if (sql === 'BEGIN IMMEDIATE') {
        throw new Error('C:\\secret\\begin.sqlite3')
      }
    })
    const connection = {
      open: true,
      inTransaction: false,
      exec
    } as unknown as Database.Database
    const work = vi.fn()
    const executor = createExecutor(connection, { logger })

    const error = captureError(() => executor.run(work))

    expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
    expectSafeControlledError(error)
    expect(work).not.toHaveBeenCalled()
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE'])
    expect(readLogs(logger)).toBe('Database transaction failed; phase=begin; errorType=Error')
    expectLogsAreSafe(logger)
  })

  it('rolls back and withholds results when COMMIT fails', () => {
    const logger = createLogger()
    let inTransaction = false
    const exec = vi.fn((sql: string): void => {
      if (sql === 'BEGIN IMMEDIATE') {
        inTransaction = true
        return
      }

      if (sql === 'COMMIT') {
        throw new Error('C:\\secret\\commit.sqlite3')
      }

      if (sql === 'ROLLBACK') {
        inTransaction = false
      }
    })
    const connection = {
      open: true,
      get inTransaction(): boolean {
        return inTransaction
      },
      exec
    } as unknown as Database.Database
    const work = vi.fn(() => 'committed-result')
    const executor = createExecutor(connection, { logger })

    const error = captureError(() => executor.run(work))

    expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
    expectSafeControlledError(error)
    expect(work).toHaveBeenCalledOnce()
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'COMMIT', 'ROLLBACK'])
    expect(inTransaction).toBe(false)
    expect(readLogs(logger)).toBe('Database transaction failed; phase=commit; errorType=Error')
    expectLogsAreSafe(logger)
  })

  it('logs rollback failure safely while preserving the original controlled error', () => {
    const logger = createLogger()
    let inTransaction = false
    const exec = vi.fn((sql: string): void => {
      if (sql === 'BEGIN IMMEDIATE') {
        inTransaction = true
        return
      }

      if (sql === 'ROLLBACK') {
        const rollbackError = new Error('C:\\secret\\rollback.sqlite3')
        rollbackError.name = 'C:\\secret\\RollbackError'
        throw rollbackError
      }
    })
    const connection = {
      open: true,
      get inTransaction(): boolean {
        return inTransaction
      },
      exec
    } as unknown as Database.Database
    const executor = createExecutor(connection, { logger })
    const workError = new Error('C:\\secret\\patient.sqlite3 SELECT * FROM audit_log')
    workError.name = 'C:\\secret\\DriverError'

    const error = captureError(() =>
      executor.run(() => {
        throw workError
      })
    )

    expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
    expect((error as DatabaseTransactionExecutionError).errorType).toBe('UnknownError')
    expectSafeControlledError(error)
    expect(exec.mock.calls.map(([sql]) => sql)).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK'])
    expect(readLogs(logger)).toContain(
      'Database transaction rollback failed; phase=rollback; errorType=UnknownError'
    )
    expect(readLogs(logger)).toContain(
      'Database transaction failed; phase=work; errorType=UnknownError'
    )
    expectLogsAreSafe(logger)
  })
})

async function withMigratedDatabase(
  test: (connection: Database.Database, databasePath: string) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd008-transaction-executor-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: {
        info: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>()
      },
      clock: { now: () => '2026-07-29T00:00:00.000Z' }
    })(connection)
    test(connection, databasePath)
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createExecutor(
  connection: Database.Database,
  options: {
    logger?: TestLogger
    idGenerator?: EntityIdGenerator
    clock?: UtcClock
  } = {}
): DatabaseTransactionExecutor {
  return createDatabaseTransactionExecutor({
    connection,
    idGenerator: options.idGenerator ?? createFixedIdGenerator(),
    clock: options.clock ?? createFixedClock(),
    logger: options.logger ?? createLogger()
  })
}

function createFixedIdGenerator(ids: readonly string[] = generatedIds): EntityIdGenerator {
  if (ids.length === 0) {
    throw new Error('Test entity IDs are required.')
  }

  let index = 0

  return createEntityIdGenerator(() => {
    const id = ids[index] ?? ids[ids.length - 1]!
    index += 1

    return id
  })
}

function createFixedClock(timestamp = now): UtcClock {
  return createUtcClock(() => timestamp)
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function insertSetting(
  connection: Database.Database,
  key: string,
  valueJson: string,
  updatedAt = now
): void {
  connection
    .prepare(
      `INSERT INTO app_settings (
        key,
        value_json,
        updated_at,
        sensitivity_classification
      ) VALUES (?, ?, ?, ?)`
    )
    .run(key, valueJson, updatedAt, 'STANDARD')
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function readLedgerCount(connection: Database.Database): number {
  return readTableCount(connection, 'schema_migrations')
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(tableName)}`)
    .get() as { count: number }

  return row.count
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}

function createLogger(): TestLogger {
  return {
    error: vi.fn<(message: string) => void>()
  }
}

function readLogs(logger: TestLogger): string {
  return logger.error.mock.calls.flat().join('\n')
}

function expectSafeControlledError(error: unknown): void {
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(JSON.stringify(error)).not.toContain('stack')
  expect(JSON.stringify(error)).not.toContain('secret')
  expect(JSON.stringify(error)).not.toContain('SELECT')
  expect(JSON.stringify(error)).not.toContain('patients')
  expect(JSON.stringify(error)).not.toContain('audit_log')
}

function expectLogsAreSafe(logger: TestLogger): void {
  const logs = readLogs(logger)

  expect(logs).not.toContain('secret')
  expect(logs).not.toContain('SELECT')
  expect(logs).not.toContain('patients')
  expect(logs).not.toContain('audit_log')
  expect(logs).not.toContain('sqlite3')
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
