import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createLocalUserRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  LocalUserAlreadyExistsError,
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type CreateLocalUserInput,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type LocalUserRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'
import type { StoredPasswordCredential } from '@main/security'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T12:34:57.789Z'
const earlier = '2026-07-29T12:34:55.789Z'
const userId = '11111111-1111-4111-8111-111111111111'
const secondUserId = '22222222-2222-4222-8222-222222222222'
const canonicalCredential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))

describe('local user repository', () => {
  it('reports a fresh migrated database without writing user rows', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const { hasAny } = repository

      expect(repository.hasAny()).toBe(false)
      expect(hasAny()).toBe(false)
      expect(readTableCount(connection, 'users')).toBe(0)
      expect(readUserVersion(connection)).toBe(1)
      expect(readLedgerCount(connection)).toBe(1)
    })
  })

  it('creates one durable active user through an authentic scoped transaction', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      const input = createValidInput()

      const inserted = executor.run((context) => repository.insert(context.connection, input))

      expect(inserted).toEqual({
        id: userId,
        username: 'Admin.User',
        displayName: 'Admin User',
        role: 'LOCAL_ADMIN',
        isActive: true,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now
      })
      expect(Object.isFrozen(inserted)).toBe(true)
      expect(inserted).not.toHaveProperty('credential')
      expect(inserted).not.toHaveProperty('passwordHash')
      expect(inserted).not.toHaveProperty('passwordSalt')
      expect(inserted).not.toHaveProperty('password_hash')
      expect(inserted).not.toHaveProperty('password_salt')
      expect(connection.inTransaction).toBe(false)
      expect(repository.hasAny()).toBe(true)
      expect(readTableCount(connection, 'users')).toBe(1)
      expect(readRawUser(connection)).toEqual({
        id: userId,
        username: 'Admin.User',
        username_normalized: 'admin.user',
        display_name: 'Admin User',
        password_hash: canonicalCredential.passwordHash,
        password_salt: canonicalCredential.passwordSalt,
        role: 'LOCAL_ADMIN',
        is_active: 1,
        must_change_password: 1,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        created_at: now,
        updated_at: now
      })
    })
  })

  it('refuses unauthentic or expired transaction capabilities before validation or SQL', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      connection.exec('BEGIN IMMEDIATE')
      try {
        const rawConnectionError = captureError(() =>
          repository.insert(
            connection as unknown as DatabaseTransactionConnection,
            createValidInput()
          )
        )

        expect(rawConnectionError).toBeInstanceOf(DatabaseTransactionStateError)
        expectSafeControlledError(rawConnectionError)
        expect(connection.inTransaction).toBe(true)
        expect(readTableCount(connection, 'users')).toBe(0)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }

      const fabricatedConnection = createFabricatedScopedConnection(connection)
      const fabricatedError = captureError(() =>
        repository.insert(fabricatedConnection, createValidInput())
      )

      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(fabricatedError)
      expect(readTableCount(connection, 'users')).toBe(0)

      let capturedConnection: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        capturedConnection = context.connection
        return 'captured'
      })

      const expiredError = captureError(() =>
        repository.insert(
          capturedConnection!,
          createUncheckedInput({
            ...createValidRawInput({
              username: 'admin user',
              displayName: 'Secret\u0000Name',
              credential: {
                passwordHash: canonicalCredential.passwordHash,
                passwordSalt: `${canonicalCredential.passwordSalt}=`
              }
            }),
            updatedAt: later
          })
        )
      )

      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expect(expiredError).not.toBeInstanceOf(RepositoryValidationError)
      expectSafeControlledError(expiredError)
      expect(readTableCount(connection, 'users')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('returns credential-free ordinary records and a separate authentication projection', async () => {
    await withMigratedDatabase(({ repository, executor }) => {
      const inserted = executor.run((context) =>
        repository.insert(context.connection, createValidInput())
      )
      const { getById, getByUsername, getAuthenticationByUsername } = repository
      const fakeThis = {
        getById: () => null,
        getByUsername: () => null,
        getAuthenticationByUsername: () => null
      }

      expect(getById.call(fakeThis, parseEntityId(userId))).toEqual(inserted)
      expect(getByUsername.call(fakeThis, parseUsernameIdentity('ADMIN.USER').username)).toEqual(
        inserted
      )
      expect(
        getByUsername.apply(fakeThis, [parseUsernameIdentity('Ａdmin.User').username])
      ).toEqual(inserted)

      const authenticationRecord = getAuthenticationByUsername.call(
        fakeThis,
        parseUsernameIdentity('admin.user').username
      )

      expect(authenticationRecord).toEqual({
        user: inserted,
        credential: canonicalCredential
      })
      expect(Object.isFrozen(authenticationRecord)).toBe(true)
      expect(Object.isFrozen(authenticationRecord?.user)).toBe(true)
      expect(Object.isFrozen(authenticationRecord?.credential)).toBe(true)
      expect(authenticationRecord?.user).not.toHaveProperty('passwordHash')
      expect(authenticationRecord?.user).not.toHaveProperty('passwordSalt')
    })
  })

  it('refuses duplicate IDs and normalized usernames without mutating the original row', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      executor.run((context) => repository.insert(context.connection, createValidInput()))
      const originalRow = readRawUser(connection)

      for (const input of [
        createValidInput({ username: 'other-admin', id: userId }),
        createValidInput({ username: 'ADMIN.USER', id: secondUserId }),
        createValidInput({ username: 'Ａdmin.User', id: secondUserId })
      ]) {
        const error = captureError(() =>
          executor.run((context) => repository.insert(context.connection, input))
        )

        expect(error).toBeInstanceOf(LocalUserAlreadyExistsError)
        expectSafeControlledError(error)
        expect(readRawUser(connection)).toEqual(originalRow)
        expect(readTableCount(connection, 'users')).toBe(1)
        expect(connection.inTransaction).toBe(false)
      }
    })
  })

  it('rolls back the user and sibling writes when outer transaction work fails', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      const error = captureError(() =>
        executor.run((context) => {
          repository.insert(context.connection, createValidInput())
          insertSetting(context.connection, 'user.rollback', '{"enabled":true}')
          throw new Error('C:\\secret\\local-user.sqlite3 SELECT users')
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'users')).toBe(0)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rejects invalid create input and malformed credentials without inserting rows', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      const invalidInputs = [
        { id: 'not-a-uuid' },
        { username: 'admin user' },
        { displayName: 'Secret\u0000Name' },
        {
          credential: {
            passwordHash: canonicalCredential.passwordHash,
            passwordSalt: `${canonicalCredential.passwordSalt}=`
          }
        },
        { role: 'local_admin' },
        { mustChangePassword: 'true' },
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
        expectSafeControlledError(error)
        expect(readTableCount(connection, 'users')).toBe(0)
        expect(connection.inTransaction).toBe(false)
      }
    })
  })

  it('uses credential-minimizing SELECT lists for ordinary reads', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      executor.run((context) => repository.insert(context.connection, createValidInput()))

      const preparedSql: string[] = []
      const instrumentedRepository = createLocalUserRepository(
        createInstrumentedReadConnection(connection, preparedSql)
      )

      expect(instrumentedRepository.getById(parseEntityId(userId))).not.toBeNull()
      expect(
        instrumentedRepository.getByUsername(parseUsernameIdentity('Admin.User').username)
      ).not.toBeNull()

      const ordinarySql = preparedSql.join('\n')
      expect(ordinarySql).not.toMatch(/\bSELECT\s+\*/i)
      expect(ordinarySql).not.toContain('password_hash')
      expect(ordinarySql).not.toContain('password_salt')

      preparedSql.length = 0
      expect(
        instrumentedRepository.getAuthenticationByUsername(
          parseUsernameIdentity('Admin.User').username
        )
      ).not.toBeNull()

      const authenticationSql = preparedSql.join('\n')
      expect(authenticationSql).not.toMatch(/\bSELECT\s+\*/i)
      expect(authenticationSql).toContain('password_hash')
      expect(authenticationSql).toContain('password_salt')
      expect(repository.getById(parseEntityId(userId))).not.toHaveProperty('passwordHash')
    })
  })

  it('fails closed on corrupt persisted rows while ordinary reads ignore credential columns', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const corruptOrdinaryRows = [
        { id: 'not-a-uuid' },
        { username: ' Admin.User', username_normalized: 'admin.user' },
        { username: 'Admin.User ', username_normalized: 'admin.user' },
        { username: '\uFF21dmin.User', username_normalized: 'admin.user' },
        { username_normalized: 'wrong' },
        { display_name: '  Admin User  ' },
        { role: 'CLINICIAN' },
        { is_active: 2 },
        { must_change_password: 2 },
        { failed_login_count: -1 },
        { locked_until: 'not-a-timestamp' },
        { last_login_at: 'not-a-timestamp' },
        { updated_at: earlier }
      ] as const

      for (const override of corruptOrdinaryRows) {
        deleteUsers(connection)
        insertRawUserIgnoringChecks(connection, override)

        const readError = captureError(() =>
          Object.prototype.hasOwnProperty.call(override, 'id')
            ? repository.getByUsername(parseUsernameIdentity('Admin.User').username)
            : repository.getById(parseEntityId(userId))
        )
        const authenticationLookupUsername =
          (override as { readonly username_normalized?: unknown }).username_normalized === 'wrong'
            ? parseUsernameIdentity('wrong').username
            : parseUsernameIdentity('Admin.User').username
        const authenticationError = captureError(() =>
          repository.getAuthenticationByUsername(authenticationLookupUsername)
        )

        expect(readError).toBeInstanceOf(RepositoryDataIntegrityError)
        expect(authenticationError).toBeInstanceOf(RepositoryDataIntegrityError)
        expectSafeControlledError(readError)
        expectSafeControlledError(authenticationError)
      }

      deleteUsers(connection)
      insertRawUser(connection, { password_salt: `${canonicalCredential.passwordSalt}=` })

      expect(repository.getById(parseEntityId(userId))).toEqual({
        id: userId,
        username: 'Admin.User',
        displayName: 'Admin User',
        role: 'LOCAL_ADMIN',
        isActive: true,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: null,
        createdAt: now,
        updatedAt: now
      })

      const authenticationError = captureError(() =>
        repository.getAuthenticationByUsername(parseUsernameIdentity('Admin.User').username)
      )

      expect(authenticationError).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(authenticationError)
    })
  })

  it('strictly decodes duplicate precheck rows before inserting', () => {
    let acceptedMissingInsertCount = 0
    const acceptedMissingConnection = createFakeExecutorConnection({
      precheckResult: undefined,
      runInsert: () => {
        acceptedMissingInsertCount += 1
      }
    })
    const acceptedMissingRecord = createExecutorForConnection(acceptedMissingConnection).run(
      (context) =>
        createLocalUserRepository({} as Database.Database).insert(
          context.connection,
          createValidInput()
        )
    )

    expect(acceptedMissingRecord.id).toBe(userId)
    expect(acceptedMissingInsertCount).toBe(1)
    expect(acceptedMissingConnection.inTransaction).toBe(false)

    let blockedInsertCount = 0
    const acceptedExistingConnection = createFakeExecutorConnection({
      precheckResult: { has_existing: 1 },
      runInsert: () => {
        blockedInsertCount += 1
      }
    })
    const duplicateError = captureError(() =>
      createExecutorForConnection(acceptedExistingConnection).run((context) =>
        createLocalUserRepository({} as Database.Database).insert(
          context.connection,
          createValidInput()
        )
      )
    )

    expect(duplicateError).toBeInstanceOf(LocalUserAlreadyExistsError)
    expect(blockedInsertCount).toBe(0)
    expectSafeControlledError(duplicateError)

    for (const precheckResult of createMalformedPrecheckResults()) {
      let insertCount = 0
      const connection = createFakeExecutorConnection({
        precheckResult,
        runInsert: () => {
          insertCount += 1
        }
      })

      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createLocalUserRepository({} as Database.Database).insert(
            context.connection,
            createValidInput()
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expect(insertCount).toBe(0)
      expect(connection.inTransaction).toBe(false)
      expectSafeControlledError(error)
    }
  })

  it('maps only primary-key and unique constraint insert failures to duplicate-user errors', () => {
    for (const code of ['SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE']) {
      const connection = createFakeExecutorConnection({
        runInsert: () => {
          throw createSqliteError(code)
        }
      })

      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createLocalUserRepository({} as Database.Database).insert(
            context.connection,
            createValidInput()
          )
        )
      )

      expect(error).toBeInstanceOf(LocalUserAlreadyExistsError)
      expect(connection.inTransaction).toBe(false)
      expectSafeControlledError(error)
    }

    for (const failure of [
      createSqliteError('SQLITE_CONSTRAINT_CHECK'),
      createSqliteError('SQLITE_CONSTRAINT_NOTNULL'),
      createSqliteError('SQLITE_CONSTRAINT_FOREIGNKEY'),
      createSqliteError('SQLITE_CONSTRAINT_TRIGGER'),
      createSqliteError('SQLITE_CONSTRAINT'),
      createSqliteError('SQLITE_CONSTRAINT_UNKNOWN'),
      createSqliteErrorWithCodeAccessor(),
      createSqliteErrorProxy()
    ]) {
      const connection = createFakeExecutorConnection({
        runInsert: () => {
          throw failure
        }
      })

      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createLocalUserRepository({} as Database.Database).insert(
            context.connection,
            createValidInput()
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expect(connection.inTransaction).toBe(false)
      expectSafeControlledError(error)
    }
  })

  it('maps closed connections and injected read failures to safe read errors', async () => {
    await withMigratedDatabase(({ connection }) => {
      const repository = createLocalUserRepository(connection)
      connection.close()

      const error = captureError(() => repository.hasAny())

      expect(error).toBeInstanceOf(RepositoryReadError)
      expectSafeControlledError(error)
    })

    const rawError = new Error('C:\\secret\\health-screening.sqlite3 SELECT users')
    rawError.name = 'C:\\secret\\DriverError'
    const fakeConnection = {
      prepare: () => {
        throw rawError
      }
    } as unknown as Database.Database

    const error = captureError(() => createLocalUserRepository(fakeConnection).hasAny())

    expect(error).toBeInstanceOf(RepositoryReadError)
    expect((error as RepositoryReadError).errorType).toBe('UnknownError')
    expectSafeControlledError(error)
  })

  it('maps scoped write and verification-read failures to safe write errors', () => {
    const writeFailure = new Error(
      'raw driver refused C:\\secret\\health-screening.sqlite3 INSERT users'
    )
    writeFailure.name = 'C:\\secret\\SqliteError'
    const writeFailureConnection = createFakeExecutorConnection({
      runInsert: () => {
        throw writeFailure
      }
    })

    const writeError = captureError(() =>
      createExecutorForConnection(writeFailureConnection).run((context) =>
        createLocalUserRepository({} as Database.Database).insert(
          context.connection,
          createValidInput()
        )
      )
    )

    expect(writeError).toBeInstanceOf(RepositoryWriteError)
    expect((writeError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeControlledError(writeError)
    expect(writeFailureConnection.inTransaction).toBe(false)

    const verificationFailure = new Error(
      'raw driver refused C:\\secret\\verify.sqlite3 SELECT users'
    )
    verificationFailure.name = 'C:\\secret\\VerifyError'
    const verificationFailureConnection = createFakeExecutorConnection({
      getAfterInsert: () => {
        throw verificationFailure
      }
    })

    const verificationError = captureError(() =>
      createExecutorForConnection(verificationFailureConnection).run((context) =>
        createLocalUserRepository({} as Database.Database).insert(
          context.connection,
          createValidInput()
        )
      )
    )

    expect(verificationError).toBeInstanceOf(RepositoryWriteError)
    expect((verificationError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeControlledError(verificationError)
    expect(verificationFailureConnection.inTransaction).toBe(false)
  })

  it('uses explicit SQL without transaction control or mutation shortcuts', () => {
    const preparedSql: string[] = []
    const connection = createFakeExecutorConnection({
      recordSql: (sql) => preparedSql.push(sql)
    })

    const record = createExecutorForConnection(connection).run((context) =>
      createLocalUserRepository({} as Database.Database).insert(
        context.connection,
        createValidInput()
      )
    )

    expect(record.id).toBe(userId)
    expect(preparedSql.length).toBeGreaterThanOrEqual(3)
    expect(preparedSql.join('\n')).toContain('username_normalized')
    expect(preparedSql.join('\n')).toContain('INSERT INTO users')
    expect(preparedSql.join('\n')).not.toMatch(/\bSELECT\s+\*/i)
    expect(preparedSql.join('\n')).not.toMatch(
      /\b(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|UPDATE|DELETE|REPLACE|UPSERT)\b/i
    )
    expect(connection.inTransaction).toBe(false)
  })
})

interface MigratedDatabaseContext {
  connection: Database.Database
  repository: LocalUserRepository
  executor: DatabaseTransactionExecutor
}

interface InsertSettingConnection {
  prepare(source: string): {
    run(key: string, valueJson: string, updatedAt: string, sensitivity: string): Database.RunResult
  }
}

interface RawUserRow {
  id: unknown
  username: unknown
  username_normalized: unknown
  display_name: unknown
  password_hash: unknown
  password_salt: unknown
  role: unknown
  is_active: unknown
  must_change_password: unknown
  failed_login_count: unknown
  locked_until: unknown
  last_login_at: unknown
  created_at: unknown
  updated_at: unknown
}

interface FakeExecutorConnectionOptions {
  recordSql?: (sql: string) => void
  precheckResult?: unknown
  runInsert?: () => void
  getAfterInsert?: () => unknown
}

async function withMigratedDatabase(
  test: (context: MigratedDatabaseContext) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd011-local-user-repository-'))
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
      repository: createLocalUserRepository(connection),
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
  override: Partial<Record<keyof CreateLocalUserInput, unknown>> = {}
): CreateLocalUserInput {
  const input = createValidRawInput(override)

  return {
    id: parseEntityId(input.id),
    username: parseUsernameIdentity(input.username).username,
    displayName: parseUserDisplayName(input.displayName),
    credential: input.credential as StoredPasswordCredential,
    role: parseLocalUserRole(input.role),
    mustChangePassword: input.mustChangePassword as boolean,
    createdAt: parseUtcTimestamp(input.createdAt),
    updatedAt: parseUtcTimestamp(input.updatedAt)
  }
}

function createValidRawInput(
  override: Partial<Record<keyof CreateLocalUserInput, unknown>> = {}
): Record<keyof CreateLocalUserInput, unknown> {
  return {
    id: userId,
    username: 'Admin.User',
    displayName: 'Admin User',
    credential: canonicalCredential,
    role: 'LOCAL_ADMIN',
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
    ...override
  }
}

function createUncheckedInput(
  input: Record<keyof CreateLocalUserInput, unknown>
): CreateLocalUserInput {
  return input as CreateLocalUserInput
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
      throw new Error('raw driver refused C:\\secret\\health-screening.sqlite3 ROLLBACK users')
    }
  } as unknown as DatabaseTransactionConnection
}

function createInstrumentedReadConnection(
  connection: Database.Database,
  preparedSql: string[]
): Database.Database {
  return {
    ...connection,
    prepare(source: string) {
      preparedSql.push(source)
      return connection.prepare(source)
    }
  } as unknown as Database.Database
}

function createFakeExecutorConnection(
  options: FakeExecutorConnectionOptions = {}
): Database.Database {
  let row: RawUserRow | null = null
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

      return createFakeStatement(
        source,
        () => row,
        (nextRow) => {
          row = nextRow
        },
        options
      )
    }
  } as unknown as Database.Database
}

function createFakeStatement(
  source: string,
  getRow: () => RawUserRow | null,
  setRow: (row: RawUserRow) => void,
  options: FakeExecutorConnectionOptions
): Database.Statement {
  return {
    run(...params: unknown[]): Database.RunResult {
      if (/INSERT INTO users/i.test(source)) {
        options.runInsert?.()
        setRow({
          id: params[0],
          username: params[1],
          username_normalized: params[2],
          display_name: params[3],
          password_hash: params[4],
          password_salt: params[5],
          role: params[6],
          is_active: 1,
          must_change_password: params[7],
          failed_login_count: 0,
          locked_until: null,
          last_login_at: null,
          created_at: params[8],
          updated_at: params[9]
        })
      }

      return { changes: 1, lastInsertRowid: 1 }
    },
    get(...params: unknown[]): unknown {
      const row = getRow()

      if (/SELECT EXISTS/i.test(source)) {
        return { has_any: row === null ? 0 : 1 }
      }

      if (/WHERE id = \? OR username_normalized = \?/i.test(source)) {
        if (Object.prototype.hasOwnProperty.call(options, 'precheckResult')) {
          return options.precheckResult
        }

        return row !== null && (row.id === params[0] || row.username_normalized === params[1])
          ? { has_existing: 1 }
          : undefined
      }

      if (/WHERE id = \?/i.test(source)) {
        if (row === null || row.id !== params[0]) {
          return undefined
        }

        if (options.getAfterInsert !== undefined) {
          return options.getAfterInsert()
        }

        return credentialFreeRow(row)
      }

      if (/WHERE username_normalized = \?/i.test(source)) {
        if (row === null || row.username_normalized !== params[0]) {
          return undefined
        }

        return /password_hash/i.test(source) ? row : credentialFreeRow(row)
      }

      return undefined
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
  } as unknown as Database.Statement
}

function credentialFreeRow(row: RawUserRow): Omit<RawUserRow, 'password_hash' | 'password_salt'> {
  return {
    id: row.id,
    username: row.username,
    username_normalized: row.username_normalized,
    display_name: row.display_name,
    role: row.role,
    is_active: row.is_active,
    must_change_password: row.must_change_password,
    failed_login_count: row.failed_login_count,
    locked_until: row.locked_until,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
}

function createFixedIdGenerator(): EntityIdGenerator {
  return {
    generate: () => parseEntityId(userId)
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

function insertRawUserIgnoringChecks(
  connection: Database.Database,
  override: Partial<RawUserRow> = {}
): void {
  connection.pragma('ignore_check_constraints = ON')
  try {
    insertRawUser(connection, override)
  } finally {
    connection.pragma('ignore_check_constraints = OFF')
  }
}

function insertRawUser(connection: Database.Database, override: Partial<RawUserRow> = {}): void {
  const row = {
    id: userId,
    username: 'Admin.User',
    username_normalized: 'admin.user',
    display_name: 'Admin User',
    password_hash: canonicalCredential.passwordHash,
    password_salt: canonicalCredential.passwordSalt,
    role: 'LOCAL_ADMIN',
    is_active: 1,
    must_change_password: 1,
    failed_login_count: 0,
    locked_until: null,
    last_login_at: null,
    created_at: now,
    updated_at: now,
    ...override
  }

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
        locked_until,
        last_login_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.username,
      row.username_normalized,
      row.display_name,
      row.password_hash,
      row.password_salt,
      row.role,
      row.is_active,
      row.must_change_password,
      row.failed_login_count,
      row.locked_until,
      row.last_login_at,
      row.created_at,
      row.updated_at
    )
}

function deleteUsers(connection: Database.Database): void {
  connection.prepare('DELETE FROM users').run()
}

function readRawUser(connection: Database.Database): RawUserRow | undefined {
  return connection
    .prepare(
      `SELECT
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
        locked_until,
        last_login_at,
        created_at,
        updated_at
      FROM users
      WHERE id = ?`
    )
    .get(userId) as RawUserRow | undefined
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

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}

function createMalformedPrecheckResults(): readonly unknown[] {
  const accessorRow = Object.create(null) as { has_existing: unknown }
  Object.defineProperty(accessorRow, 'has_existing', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\precheck-getter.txt')
    }
  })

  const symbolRow = {
    has_existing: 1,
    [Symbol('row_metadata')]: true
  }

  return Object.freeze([
    null,
    [],
    1,
    'has_existing',
    false,
    {},
    { has_existing: 0 },
    { has_existing: 2 },
    { has_existing: true },
    { has_existing: 1, row_metadata: 'secret' },
    symbolRow,
    accessorRow,
    new Proxy(
      { has_existing: 1 },
      {
        ownKeys() {
          throw new Error('C:\\secret\\ownKeys.txt')
        }
      }
    ),
    new Proxy(
      { has_existing: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )
  ])
}

function createSqliteError(code: string): Error {
  const error = new Error(`raw driver refused ${code} C:\\secret\\users.sqlite3`)
  error.name = 'SqliteError'
  Object.defineProperty(error, 'code', {
    enumerable: true,
    value: code
  })

  return error
}

function createSqliteErrorWithCodeAccessor(): Error {
  const error = new Error('raw driver refused C:\\secret\\constraint.sqlite3')
  error.name = 'SqliteError'
  Object.defineProperty(error, 'code', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\code-getter.txt')
    }
  })

  return error
}

function createSqliteErrorProxy(): Error {
  return new Proxy(createSqliteError('SQLITE_CONSTRAINT_UNIQUE'), {
    getOwnPropertyDescriptor() {
      throw new Error('C:\\secret\\code-descriptor.txt')
    }
  })
}

function expectSafeControlledError(error: unknown): void {
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
    'users',
    'username_normalized',
    'has_existing',
    'row_metadata',
    'SQLITE_CONSTRAINT',
    'PRIMARYKEY',
    'UNIQUE',
    'CHECK',
    'NOTNULL',
    'FOREIGNKEY',
    'TRIGGER',
    userId,
    secondUserId,
    now,
    later,
    earlier,
    'Admin.User',
    'ADMIN.USER',
    '\uFF21dmin.User',
    'Admin User',
    canonicalCredential.passwordHash,
    canonicalCredential.passwordSalt
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
