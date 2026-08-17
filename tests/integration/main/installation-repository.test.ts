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
      const { getState } = repository
      const state = repository.getState()

      expect(repository.get()).toBeNull()
      expect(state).toEqual({ status: 'UNINITIALIZED' })
      expect(getState()).toEqual({ status: 'UNINITIALIZED' })
      expect(Object.isFrozen(state)).toBe(true)
      expect(readTableCount(connection, 'installation')).toBe(0)
      expect(readUserVersion(connection)).toBe(11)
      expect(readLedgerCount(connection)).toBe(11)

      insertRawInstallation(connection)
      expect(getState()).toEqual({
        status: 'INITIALIZED',
        installation: createValidInput()
      })
    })
  })

  it('keeps getState bound to SQLite state and trusted row decoding when rebound', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const fakeThis = {
        get: () => ({
          status: 'INITIALIZED',
          installation: createValidInput({
            id: secondInstallationId,
            deploymentName: 'Redirected Deployment',
            timeZone: 'UTC'
          })
        })
      }

      expect(repository.getState.call(fakeThis)).toEqual({ status: 'UNINITIALIZED' })

      insertRawInstallation(connection, { timezone: '+05:30' })

      const error = captureError(() => repository.getState.apply(fakeThis))

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeRepositoryError(error)
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

  it('refuses raw SQLite connections for installation writes without inserting a row', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      connection.exec('BEGIN IMMEDIATE')
      try {
        const error = captureError(() =>
          repository.insert(
            connection as unknown as DatabaseTransactionConnection,
            createValidInput()
          )
        )

        expect(error).toBeInstanceOf(DatabaseTransactionStateError)
        expectSafeRepositoryError(error)
        expect(readTableCount(connection, 'installation')).toBe(0)
        expect(connection.inTransaction).toBe(true)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }

      expect(connection.inTransaction).toBe(false)
      expect(readTableCount(connection, 'installation')).toBe(0)
    })
  })

  it('refuses fabricated structural transaction connections before SQL execution', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const fabricatedConnection = createFabricatedScopedConnection(connection)

      const error = captureError(() => repository.insert(fabricatedConnection, createValidInput()))

      expect(error).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeRepositoryError(error)
      expect(readTableCount(connection, 'installation')).toBe(0)
      expect(connection.inTransaction).toBe(false)
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
        { timezone: '+05:30' },
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

  it('maps authentic scoped write and verification failures to safe write errors', () => {
    const input = createValidInput()
    const insertFailure = new Error(
      'raw driver refused C:\\secret\\health-screening.sqlite3 INSERT installation'
    )
    insertFailure.name = 'C:\\secret\\SqliteError'
    const writeFailureConnection = createFakeExecutorConnection({
      runInsert: () => {
        throw insertFailure
      }
    })

    const writeError = captureError(() =>
      createExecutorForConnection(writeFailureConnection).run((context) =>
        createInstallationRepository({} as Database.Database).insert(context.connection, input)
      )
    )

    expect(writeError).toBeInstanceOf(RepositoryWriteError)
    expect((writeError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeRepositoryError(writeError)
    expect(writeFailureConnection.inTransaction).toBe(false)

    const verificationFailure = new Error(
      'raw driver refused C:\\secret\\verify.sqlite3 SELECT installation'
    )
    verificationFailure.name = 'C:\\secret\\VerifyError'
    const verificationFailureConnection = createFakeExecutorConnection({
      getAfterInsert: () => {
        throw verificationFailure
      }
    })

    const verificationError = captureError(() =>
      createExecutorForConnection(verificationFailureConnection).run((context) =>
        createInstallationRepository({} as Database.Database).insert(context.connection, input)
      )
    )

    expect(verificationError).toBeInstanceOf(RepositoryWriteError)
    expect((verificationError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeRepositoryError(verificationError)
    expect(verificationFailureConnection.inTransaction).toBe(false)
  })

  it('lets expired HSD-008 scoped connection protection block invalid late writes first', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      let capturedConnection: DatabaseTransactionConnection | undefined

      executor.run((context) => {
        capturedConnection = context.connection
        return 'captured'
      })

      const error = captureError(() =>
        repository.insert(
          capturedConnection!,
          createUncheckedInput({
            ...createValidRawInput({
              id: 'not-a-uuid',
              deploymentName: 'Secret Deployment',
              timeZone: '+05:30',
              createdAt: '2026-07-29T12:34:56.789Z'
            }),
            updatedAt: later
          })
        )
      )

      expect(error).toBeInstanceOf(DatabaseTransactionStateError)
      expect(error).not.toBeInstanceOf(RepositoryValidationError)
      expectSafeRepositoryError(error)
      expect(readTableCount(connection, 'installation')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('uses explicit SQL without transaction control statements', () => {
    const preparedSql: string[] = []
    const connection = createFakeExecutorConnection({
      recordSql: (sql) => preparedSql.push(sql)
    })

    const record = createExecutorForConnection(connection).run((context) =>
      createInstallationRepository({} as Database.Database).insert(
        context.connection,
        createValidInput()
      )
    )

    expect(record.id).toBe(installationId)
    expect(connection.inTransaction).toBe(false)
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

interface FakeExecutorConnectionOptions {
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

function createExecutorForConnection(connection: Database.Database): DatabaseTransactionExecutor {
  return createDatabaseTransactionExecutor({
    connection,
    idGenerator: createFixedIdGenerator(),
    clock: createFixedClock(),
    logger: { error: vi.fn<(message: string) => void>() }
  })
}

function createFabricatedScopedConnection(
  connection: Database.Database
): DatabaseTransactionConnection {
  return {
    open: true,
    inTransaction: true,
    prepare(source: string) {
      return connection.prepare(source) as unknown as ReturnType<
        DatabaseTransactionConnection['prepare']
      >
    },
    exec(): DatabaseTransactionConnection {
      throw new Error(
        'raw driver refused C:\\secret\\health-screening.sqlite3 ROLLBACK installation'
      )
    }
  } as unknown as DatabaseTransactionConnection
}

function createFakeExecutorConnection(
  options: FakeExecutorConnectionOptions = {}
): Database.Database {
  let row: RawInstallationRow | null = null
  let selectCount = 0
  let inTransaction = false

  return {
    open: true,
    get inTransaction(): boolean {
      return inTransaction
    },
    exec(source: string): void {
      if (source === 'BEGIN IMMEDIATE') {
        inTransaction = true
        return
      }

      if (source === 'COMMIT' || source === 'ROLLBACK') {
        inTransaction = false
        return
      }

      throw new Error('raw driver refused C:\\secret\\health-screening.sqlite3 transaction control')
    },
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
    }
  } as unknown as Database.Database
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
  const serialized = JSON.stringify(error)

  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()
  expect(serialized).not.toContain('stack')

  for (const unsafeFragment of [
    'secret',
    'C:\\',
    'health-screening.sqlite3',
    'raw driver refused',
    'SELECT',
    'INSERT',
    'installation',
    installationId,
    secondInstallationId,
    now,
    later,
    earlier,
    'Cameroon Pilot',
    'Secret Deployment',
    'Redirected Deployment',
    'Africa/Douala',
    '+01:00',
    '-05:00',
    '+05:30'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
