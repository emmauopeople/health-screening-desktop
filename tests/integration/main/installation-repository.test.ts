import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  InstallationAlreadyExistsError,
  parseDeploymentName,
  parseIanaTimeZone,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type CreateInstallationInput,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type InstallationRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T12:34:57.789Z'
const earlier = '2026-07-29T12:34:55.789Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const secondInstallationId = '22222222-2222-4222-8222-222222222222'

describe('installation repository', () => {
  it('reports fresh first-run state without writing installation data', async () => {
    await withMigratedDatabase(({ connection }) => {
      const repository = createInstallationRepository(connection)
      const state = repository.getState()

      expect(repository.get()).toBeNull()
      expect(state).toEqual({ status: 'UNINITIALIZED' })
      expect(Object.isFrozen(state)).toBe(true)
      expect(readTableCount(connection, 'installation')).toBe(0)
      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerCount(connection)).toBe(1)

      insertRawInstallation(connection)
      expect(repository.getState()).toEqual({
        status: 'INITIALIZED',
        installation: createValidInput()
      })
    })
  })

  it('creates one durable frozen installation through a scoped transaction connection', async () => {
    await withMigratedDatabase(({ connection, databasePath, repository, executor }) => {
      const input = createValidInput()

      const inserted = executor.run((context) => repository.insert(context.connection, input))

      expect(inserted).toEqual({
        id: installationId,
        deploymentName: 'Cameroon Pilot',
        timeZone: 'Africa/Douala',
        createdAt: now,
        updatedAt: now
      })
      expect(Object.isFrozen(inserted)).toBe(true)
      expect(inserted).not.toHaveProperty('singleton_id')
      expect(inserted).not.toHaveProperty('singletonId')
      expect(connection.inTransaction).toBe(false)
      expect(readTableCount(connection, 'installation')).toBe(1)
      expect(readRawInstallation(connection)).toEqual({
        singleton_id: 1,
        id: installationId,
        deployment_name: 'Cameroon Pilot',
        timezone: 'Africa/Douala',
        created_at: now,
        updated_at: now
      })

      connection.close()
      const reopened = new Database(databasePath)
      try {
        configureHsd006Pragmas(reopened)
        const reopenedState = createInstallationRepository(reopened).getState()

        expect(reopenedState).toEqual({
          status: 'INITIALIZED',
          installation: inserted
        })
        expect(Object.isFrozen(reopenedState)).toBe(true)
      } finally {
        reopened.close()
      }
    })
  })

  it('refuses duplicate initialization without mutating the original row', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      executor.run((context) => repository.insert(context.connection, createValidInput()))
      const originalRow = readRawInstallation(connection)

      const error = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              id: secondInstallationId,
              deploymentName: 'Second Deployment',
              timeZone: 'UTC'
            })
          )
        )
      )

      expect(error).toBeInstanceOf(InstallationAlreadyExistsError)
      expectSafeRepositoryError(error)
      expect(readRawInstallation(connection)).toEqual(originalRow)
      expect(readTableCount(connection, 'installation')).toBe(1)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rolls back installation and sibling writes when outer work fails', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      const error = captureError(() =>
        executor.run((context) => {
          repository.insert(context.connection, createValidInput())
          insertSetting(context.connection, 'first-run.rollback', '{"enabled":true}')
          throw new Error('C:\\secret\\first-run.sqlite3 SELECT * FROM installation')
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expect(readTableCount(connection, 'installation')).toBe(0)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(repository.getState()).toEqual({ status: 'UNINITIALIZED' })
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rejects invalid create input before any row persists', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      const invalidInputs = [
        { id: 'not-a-uuid' },
        { deploymentName: 'Secret\u0000Deployment' },
        { timeZone: 'Invalid/Zone' },
        { createdAt: 'not-a-timestamp' },
        { updatedAt: later }
      ] as const

      for (const override of invalidInputs) {
        const error = captureError(() =>
          executor.run((context) =>
            repository.insert(
              context.connection,
              createUncheckedInput({ ...createValidRawInput(), ...override })
            )
          )
        )

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeRepositoryError(error)
        expect(readTableCount(connection, 'installation')).toBe(0)
        expect(connection.inTransaction).toBe(false)
      }
    })
  })

  it('fails closed on corrupt persisted installation rows', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const corruptRows = [
        { id: 'not-a-uuid' },
        { created_at: 'not-a-timestamp' },
        { timezone: 'Invalid/Zone' },
        { created_at: later, updated_at: earlier }
      ] as const

      for (const override of corruptRows) {
        deleteInstallationRows(connection)
        insertRawInstallation(connection, override)

        const getError = captureError(() => repository.get())
        const stateError = captureError(() => repository.getState())

        expect(getError).toBeInstanceOf(RepositoryDataIntegrityError)
        expect(stateError).toBeInstanceOf(RepositoryDataIntegrityError)
        expectSafeRepositoryError(getError)
        expectSafeRepositoryError(stateError)
      }
    })
  })

  it('maps closed connection and read failures to safe read errors', async () => {
    await withMigratedDatabase(({ connection }) => {
      const repository = createInstallationRepository(connection)
      connection.close()

      const error = captureError(() => repository.get())

      expect(error).toBeInstanceOf(RepositoryReadError)
      expectSafeRepositoryError(error)
    })

    const rawError = new Error('C:\\secret\\health-screening.sqlite3 SELECT * FROM installation')
    rawError.name = 'C:\\secret\\DriverError'
    const fakeConnection = {
      prepare: () => {
        throw rawError
      }
    } as unknown as Database.Database

    const error = captureError(() => createInstallationRepository(fakeConnection).get())

    expect(error).toBeInstanceOf(RepositoryReadError)
    expect((error as RepositoryReadError).errorType).toBe('UnknownError')
    expectSafeRepositoryError(error)
  })

  it('maps write and verification failures to safe write errors', () => {
    const input = createValidInput()
    const insertFailure = new Error('C:\\secret\\health-screening.sqlite3 INSERT installation')
    insertFailure.name = 'C:\\secret\\SqliteError'
    const writeFailureConnection = createFakeScopedConnection({
      runInsert: () => {
        throw insertFailure
      }
    })

    const writeError = captureError(() =>
      createInstallationRepository({} as Database.Database).insert(writeFailureConnection, input)
    )

    expect(writeError).toBeInstanceOf(RepositoryWriteError)
    expect((writeError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeRepositoryError(writeError)

    const verificationFailure = new Error('C:\\secret\\verify.sqlite3 SELECT installation')
    verificationFailure.name = 'C:\\secret\\VerifyError'
    const verificationFailureConnection = createFakeScopedConnection({
      getAfterInsert: () => {
        throw verificationFailure
      }
    })

    const verificationError = captureError(() =>
      createInstallationRepository({} as Database.Database).insert(
        verificationFailureConnection,
        input
      )
    )

    expect(verificationError).toBeInstanceOf(RepositoryWriteError)
    expect((verificationError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeRepositoryError(verificationError)
  })

  it('lets expired HSD-008 scoped connection protection block late writes', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      let capturedConnection: DatabaseTransactionConnection | undefined

      executor.run((context) => {
        capturedConnection = context.connection
        return 'captured'
      })

      const error = captureError(() =>
        repository.insert(capturedConnection!, createValidInput({ id: secondInstallationId }))
      )

      expect(error).toBeInstanceOf(DatabaseTransactionStateError)
      expect(readTableCount(connection, 'installation')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('uses explicit SQL without transaction control statements', () => {
    const preparedSql: string[] = []
    const scopedConnection = createFakeScopedConnection({
      recordSql: (sql) => preparedSql.push(sql)
    })

    const record = createInstallationRepository({} as Database.Database).insert(
      scopedConnection,
      createValidInput()
    )

    expect(record.id).toBe(installationId)
    expect(preparedSql.length).toBeGreaterThanOrEqual(3)
    expect(preparedSql.join('\n')).toContain('singleton_id')
    expect(preparedSql.join('\n')).toContain('WHERE singleton_id = 1')
    expect(preparedSql.join('\n')).not.toMatch(/\bSELECT\s+\*/i)
    expect(preparedSql.join('\n')).not.toMatch(/\b(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i)
  })
})

interface MigratedDatabaseContext {
  connection: Database.Database
  databasePath: string
  repository: InstallationRepository
  executor: DatabaseTransactionExecutor
}

interface InsertSettingConnection {
  prepare(source: string): {
    run(key: string, valueJson: string, updatedAt: string, sensitivity: string): Database.RunResult
  }
}

interface RawInstallationRow {
  singleton_id: number
  id: string
  deployment_name: string
  timezone: string
  created_at: string
  updated_at: string
}

interface FakeScopedConnectionOptions {
  recordSql?: (sql: string) => void
  runInsert?: () => void
  getAfterInsert?: () => unknown
}

async function withMigratedDatabase(
  test: (context: MigratedDatabaseContext) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd009-installation-repository-'))
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
      clock: createFixedClock()
    })(connection)
    await test({
      connection,
      databasePath,
      repository: createInstallationRepository(connection),
      executor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: createFixedIdGenerator(),
        clock: createFixedClock(),
        logger: { error: vi.fn<(message: string) => void>() }
      })
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createValidInput(
  override: Partial<Record<keyof CreateInstallationInput, unknown>> = {}
): CreateInstallationInput {
  const input = createValidRawInput(override)

  return {
    id: parseEntityId(input.id),
    deploymentName: parseDeploymentName(input.deploymentName),
    timeZone: parseIanaTimeZone(input.timeZone),
    createdAt: parseUtcTimestamp(input.createdAt),
    updatedAt: parseUtcTimestamp(input.updatedAt)
  }
}

function createValidRawInput(
  override: Partial<Record<keyof CreateInstallationInput, unknown>> = {}
): Record<keyof CreateInstallationInput, string> {
  return {
    id: installationId,
    deploymentName: 'Cameroon Pilot',
    timeZone: 'Africa/Douala',
    createdAt: now,
    updatedAt: now,
    ...override
  } as Record<keyof CreateInstallationInput, string>
}

function createUncheckedInput(
  input: Record<keyof CreateInstallationInput, unknown>
): CreateInstallationInput {
  return input as CreateInstallationInput
}

function createFakeScopedConnection(
  options: FakeScopedConnectionOptions = {}
): DatabaseTransactionConnection {
  let row: RawInstallationRow | null = null
  let selectCount = 0

  return {
    open: true,
    inTransaction: true,
    prepare(source: string) {
      options.recordSql?.(source)

      return {
        run(...params: string[]): Database.RunResult {
          options.runInsert?.()
          row = {
            singleton_id: 1,
            id: params[0]!,
            deployment_name: params[1]!,
            timezone: params[2]!,
            created_at: params[3]!,
            updated_at: params[4]!
          }

          return { changes: 1, lastInsertRowid: 1 }
        },
        get(): unknown {
          selectCount += 1

          if (selectCount > 1 && options.getAfterInsert !== undefined) {
            return options.getAfterInsert()
          }

          return row ?? undefined
        },
        all(): unknown[] {
          return []
        },
        iterate(): IterableIterator<unknown> {
          return [][Symbol.iterator]()
        },
        pluck() {
          return this
        },
        expand() {
          return this
        },
        raw() {
          return this
        },
        bind() {
          return this
        },
        columns(): Database.ColumnDefinition[] {
          return []
        },
        safeIntegers() {
          return this
        }
      }
    },
    exec() {
      throw new Error('Repository must not execute transaction control SQL.')
    }
  } as DatabaseTransactionConnection
}

function createFixedIdGenerator(): EntityIdGenerator {
  return {
    generate: () => parseEntityId(installationId)
  }
}

function createFixedClock(): UtcClock {
  return createUtcClock(() => now)
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function insertSetting(
  connection: InsertSettingConnection,
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

function insertRawInstallation(
  connection: Database.Database,
  override: Partial<RawInstallationRow> = {}
): void {
  const row = {
    singleton_id: 1,
    id: installationId,
    deployment_name: 'Cameroon Pilot',
    timezone: 'Africa/Douala',
    created_at: now,
    updated_at: now,
    ...override
  }

  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.singleton_id,
      row.id,
      row.deployment_name,
      row.timezone,
      row.created_at,
      row.updated_at
    )
}

function deleteInstallationRows(connection: Database.Database): void {
  connection.prepare('DELETE FROM installation').run()
}

function readRawInstallation(connection: Database.Database): RawInstallationRow | undefined {
  return connection
    .prepare(
      `SELECT
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      FROM installation
      WHERE singleton_id = 1`
    )
    .get() as RawInstallationRow | undefined
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

function expectSafeRepositoryError(error: unknown): void {
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(JSON.stringify(error)).not.toContain('stack')
  expect(JSON.stringify(error)).not.toContain('secret')
  expect(JSON.stringify(error)).not.toContain('SELECT')
  expect(JSON.stringify(error)).not.toContain('installation')
  expect(JSON.stringify(error)).not.toContain(installationId)
  expect(JSON.stringify(error)).not.toContain(now)
  expect(JSON.stringify(error)).not.toContain('Cameroon Pilot')
  expect(JSON.stringify(error)).not.toContain('Africa/Douala')
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
