import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  AuditEventAlreadyExistsError,
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  parseAuditActionCode,
  parseAuditEntityType,
  parseAuditMetadata,
  parseAuditQueryLimit,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type AuditEventRecord,
  type AuditEventRepository,
  type CreateAuditEventInput,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T12:34:57.789Z'
const earlier = '2026-07-29T12:34:55.789Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const missingInstallationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'
const missingUserId = '44444444-4444-4444-8444-444444444444'
const eventId = '55555555-5555-4555-8555-555555555555'
const secondEventId = '66666666-6666-4666-8666-666666666666'
const thirdEventId = '77777777-7777-4777-8777-777777777777'
const entityId = '88888888-8888-4888-8888-888888888888'
const secondEntityId = '99999999-9999-4999-8999-999999999999'
const canonicalCredential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))

describe('audit event repository', () => {
  it('reports a fresh migrated database without writing audit rows', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const { getById, listRecent } = repository

      expect(getById(parseEntityId(eventId))).toBeNull()
      expect(listRecent(parseAuditQueryLimit(10))).toEqual([])
      expect(Object.isFrozen(listRecent(parseAuditQueryLimit(1)))).toBe(true)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readUserVersion(connection)).toBe(10)
      expect(readLedgerCount(connection)).toBe(10)
    })
  })

  it('inserts bootstrap and authenticated audit events with canonical metadata', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawInstallation(connection)
      insertRawUser(connection)

      const bootstrapEvent = executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            metadata: { zeta: 1, alpha: [true, { beta: 'kept exact' }] },
            userId: null,
            entityId: null,
            action: 'INSTALLATION_INITIALIZED',
            entityType: 'INSTALLATION'
          })
        )
      )
      const authenticatedEvent = executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: secondEventId,
            userId,
            action: 'LOCATION_CREATED',
            entityType: 'LOCATION',
            entityId,
            occurredAt: later,
            metadata: { after: 'active', before: null, count: 1 }
          })
        )
      )

      expect(bootstrapEvent).toEqual({
        id: eventId,
        installationId,
        userId: null,
        action: 'INSTALLATION_INITIALIZED',
        entityType: 'INSTALLATION',
        entityId: null,
        occurredAt: now,
        metadata: {
          alpha: [true, { beta: 'kept exact' }],
          zeta: 1
        }
      })
      expect(authenticatedEvent).toEqual({
        id: secondEventId,
        installationId,
        userId,
        action: 'LOCATION_CREATED',
        entityType: 'LOCATION',
        entityId,
        occurredAt: later,
        metadata: {
          after: 'active',
          before: null,
          count: 1
        }
      })
      expect(Object.isFrozen(bootstrapEvent)).toBe(true)
      expect(Object.isFrozen(bootstrapEvent.metadata)).toBe(true)
      expect(Object.isFrozen(bootstrapEvent.metadata.alpha)).toBe(true)
      expect(Object.isFrozen((bootstrapEvent.metadata.alpha as readonly unknown[])[1])).toBe(true)
      expect(bootstrapEvent).not.toHaveProperty('metadataJson')
      expect(bootstrapEvent).not.toHaveProperty('metadata_json')
      expect(readRawAuditEvent(connection, eventId)).toEqual({
        id: eventId,
        installation_id: installationId,
        user_id: null,
        action: 'INSTALLATION_INITIALIZED',
        entity_type: 'INSTALLATION',
        entity_id: null,
        occurred_at: now,
        metadata_json: '{"alpha":[true,{"beta":"kept exact"}],"zeta":1}'
      })
      expect(readRawAuditEvent(connection, secondEventId)?.metadata_json).toBe(
        '{"after":"active","before":null,"count":1}'
      )
      expect(repository.getById(parseEntityId(secondEventId))).toEqual(authenticatedEvent)
      expect(repository.listRecent(parseAuditQueryLimit(10)).map((event) => event.id)).toEqual([
        secondEventId,
        eventId
      ])
      expect(
        repository
          .listForEntity(
            parseAuditEntityType('LOCATION'),
            parseEntityId(entityId),
            parseAuditQueryLimit(10)
          )
          .map((event) => event.id)
      ).toEqual([secondEventId])
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('orders recent and entity-scoped reads by occurred_at then id with bound limits', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawInstallation(connection)

      for (const input of [
        createValidInput({ id: eventId, occurredAt: now, entityId }),
        createValidInput({ id: secondEventId, occurredAt: later, entityId }),
        createValidInput({ id: thirdEventId, occurredAt: later, entityId: secondEntityId })
      ]) {
        executor.run((context) => repository.insert(context.connection, input))
      }

      expect(repository.listRecent(parseAuditQueryLimit(2)).map((event) => event.id)).toEqual([
        thirdEventId,
        secondEventId
      ])
      expect(
        repository
          .listForEntity(
            parseAuditEntityType('LOCATION'),
            parseEntityId(entityId),
            parseAuditQueryLimit(10)
          )
          .map((event) => event.id)
      ).toEqual([secondEventId, eventId])
      expect(readTableCount(connection, 'audit_log')).toBe(3)
    })
  })

  it('refuses duplicate audit IDs without mutating the original row', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawInstallation(connection)
      executor.run((context) => repository.insert(context.connection, createValidInput()))
      const originalRow = readRawAuditEvent(connection, eventId)

      const error = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              id: eventId,
              action: 'LOCATION_CREATED',
              entityType: 'LOCATION',
              entityId
            })
          )
        )
      )

      expect(error).toBeInstanceOf(AuditEventAlreadyExistsError)
      expectSafeControlledError(error)
      expect(readRawAuditEvent(connection, eventId)).toEqual(originalRow)
      expect(readTableCount(connection, 'audit_log')).toBe(1)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('keeps foreign keys SQLite-enforced and rolls back failed inserts', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawInstallation(connection)

      for (const input of [
        createValidInput({ installationId: missingInstallationId }),
        createValidInput({ userId: missingUserId })
      ]) {
        const error = captureError(() =>
          executor.run((context) => repository.insert(context.connection, input))
        )

        expect(error).toBeInstanceOf(RepositoryWriteError)
        expectSafeControlledError(error)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(connection.inTransaction).toBe(false)
      }
    })
  })

  it('rolls back audit and sibling writes when outer transaction work fails', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawInstallation(connection)

      const error = captureError(() =>
        executor.run((context) => {
          repository.insert(context.connection, createValidInput())
          insertSetting(context.connection, 'audit.rollback', '{"enabled":true}')
          throw new Error('C:\\secret\\audit.sqlite3 SELECT audit_log')
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('refuses unauthentic or expired transaction capabilities before metadata validation or SQL', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawInstallation(connection)
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
        expect(readTableCount(connection, 'audit_log')).toBe(0)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }

      const fabricatedError = captureError(() =>
        repository.insert(createFabricatedScopedConnection(connection), createValidInput())
      )

      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(fabricatedError)

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
              id: 'not-a-uuid',
              metadata: {
                secret_key: '\u0000'
              }
            })
          })
        )
      )

      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expect(expiredError).not.toBeInstanceOf(RepositoryValidationError)
      expectSafeControlledError(expiredError)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('fails closed on corrupt persisted audit rows and noncanonical metadata JSON', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      insertRawInstallation(connection)
      const corruptRows = [
        { id: 'not-a-uuid' },
        { installation_id: 'not-a-uuid' },
        { user_id: 'not-a-uuid' },
        { action: 'local_user_created' },
        { entity_type: 'LOCATION ' },
        { entity_id: 'not-a-uuid' },
        { occurred_at: 'not-a-timestamp' },
        { metadata_json: 12 },
        { metadata_json: '{"b":1,"a":2}' },
        { metadata_json: '{ "a": 1 }' },
        { metadata_json: '[]' },
        { metadata_json: '{"bad_key":"line\\u2028break"}' },
        { metadata_json: '{"deep":{"a":{"b":{"c":{"too_deep":true}}}}}' }
      ] as const

      for (const override of corruptRows) {
        deleteAuditEvents(connection)
        insertRawAuditEventIgnoringForeignKeys(connection, override)

        const listError = captureError(() => repository.listRecent(parseAuditQueryLimit(10)))

        expect(listError).toBeInstanceOf(RepositoryDataIntegrityError)
        expectSafeControlledError(listError)

        if (!Object.prototype.hasOwnProperty.call(override, 'id')) {
          const getError = captureError(() => repository.getById(parseEntityId(eventId)))

          expect(getError).toBeInstanceOf(RepositoryDataIntegrityError)
          expectSafeControlledError(getError)
        }
      }
    })
  })

  it('returns null from getById only for undefined and rejects malformed row shapes', () => {
    expect(
      createAuditEventRepository(
        createFakeReadConnection({ getByIdResult: undefined }) as Database.Database
      ).getById(parseEntityId(eventId))
    ).toBeNull()

    let accessorInvoked = false
    const accessorRow = createRawAuditRow()
    Object.defineProperty(accessorRow, 'action', {
      enumerable: true,
      get() {
        accessorInvoked = true
        throw new Error('C:\\secret\\audit-row-getter.txt')
      }
    })

    const symbolRow = {
      ...createRawAuditRow(),
      [Symbol('row_metadata')]: true
    }

    for (const getByIdResult of [
      null,
      1,
      'row',
      true,
      [],
      {},
      { ...createRawAuditRow(), row_metadata: 'secret' },
      symbolRow,
      accessorRow,
      new Proxy(createRawAuditRow(), {
        ownKeys() {
          throw new Error('C:\\secret\\audit-row-ownKeys.txt')
        }
      }),
      new Proxy(createRawAuditRow(), {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\audit-row-descriptor.txt')
        }
      })
    ]) {
      const error = captureError(() =>
        createAuditEventRepository(
          createFakeReadConnection({ getByIdResult }) as Database.Database
        ).getById(parseEntityId(eventId))
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    }

    expect(accessorInvoked).toBe(false)
  })

  it('strictly decodes dense list arrays without invoking hostile array properties', () => {
    const emptyList = createAuditEventRepository(
      createFakeReadConnection({ allRows: [] }) as Database.Database
    ).listRecent(parseAuditQueryLimit(10))
    const denseList = createAuditEventRepository(
      createFakeReadConnection({ allRows: [createRawAuditRow()] }) as Database.Database
    ).listForEntity(
      parseAuditEntityType('LOCATION'),
      parseEntityId(entityId),
      parseAuditQueryLimit(10)
    )

    expect(emptyList).toEqual([])
    expect(Object.isFrozen(emptyList)).toBe(true)
    expect(denseList).toEqual([createExpectedRecord()])
    expect(Object.isFrozen(denseList)).toBe(true)
    expect(Object.isFrozen(denseList[0])).toBe(true)

    let getterInvoked = false
    const accessorRows: unknown[] = []
    Object.defineProperty(accessorRows, '0', {
      enumerable: true,
      get() {
        getterInvoked = true
        throw new Error('C:\\secret\\audit-array-getter.txt')
      }
    })

    let setterInvoked = false
    const setterRows: unknown[] = []
    Object.defineProperty(setterRows, '0', {
      enumerable: true,
      set() {
        setterInvoked = true
        throw new Error('C:\\secret\\audit-array-setter.txt')
      }
    })

    for (const allRows of [
      createSparseRows(),
      accessorRows,
      setterRows,
      createRowsWithExtraStringProperty(),
      createRowsWithSymbolProperty(),
      [createMalformedAuditRow()],
      new Proxy([createRawAuditRow()], {
        ownKeys() {
          throw new Error('C:\\secret\\audit-array-ownKeys.txt')
        }
      }),
      new Proxy([createRawAuditRow()], {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\audit-array-descriptor.txt')
        }
      })
    ]) {
      const error = captureError(() =>
        createAuditEventRepository(
          createFakeReadConnection({ allRows }) as Database.Database
        ).listRecent(parseAuditQueryLimit(10))
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    }

    expect(getterInvoked).toBe(false)
    expect(setterInvoked).toBe(false)
  })

  it('maps malformed post-write verification rows to write errors', () => {
    for (const getAfterInsert of [
      () => undefined,
      () => null,
      () => 1,
      () => [],
      () => ({}),
      () => ({ ...createRawAuditRow(), row_metadata: 'secret' }),
      () =>
        new Proxy(createRawAuditRow(), {
          ownKeys() {
            throw new Error('C:\\secret\\audit-verify-ownKeys.txt')
          }
        })
    ]) {
      const connection = createFakeExecutorConnection({ getAfterInsert })
      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createAuditEventRepository({} as Database.Database).insert(
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

  it('strictly decodes duplicate precheck rows before inserting', () => {
    let acceptedInsertCount = 0
    const acceptedConnection = createFakeExecutorConnection({
      precheckResult: undefined,
      runInsert: () => {
        acceptedInsertCount += 1
      }
    })
    const acceptedRecord = createExecutorForConnection(acceptedConnection).run((context) =>
      createAuditEventRepository({} as Database.Database).insert(
        context.connection,
        createValidInput()
      )
    )

    expect(acceptedRecord.id).toBe(eventId)
    expect(acceptedInsertCount).toBe(1)

    let blockedInsertCount = 0
    const existingConnection = createFakeExecutorConnection({
      precheckResult: { has_existing: 1 },
      runInsert: () => {
        blockedInsertCount += 1
      }
    })
    const duplicateError = captureError(() =>
      createExecutorForConnection(existingConnection).run((context) =>
        createAuditEventRepository({} as Database.Database).insert(
          context.connection,
          createValidInput()
        )
      )
    )

    expect(duplicateError).toBeInstanceOf(AuditEventAlreadyExistsError)
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
          createAuditEventRepository({} as Database.Database).insert(
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

  it('maps only primary-key and unique constraint failures to duplicate-audit errors', () => {
    for (const code of ['SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE']) {
      const connection = createFakeExecutorConnection({
        runInsert: () => {
          throw createSqliteError(code)
        }
      })
      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createAuditEventRepository({} as Database.Database).insert(
            context.connection,
            createValidInput()
          )
        )
      )

      expect(error).toBeInstanceOf(AuditEventAlreadyExistsError)
      expectSafeControlledError(error)
      expect(connection.inTransaction).toBe(false)
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
          createAuditEventRepository({} as Database.Database).insert(
            context.connection,
            createValidInput()
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(error)
      expect(connection.inTransaction).toBe(false)
    }
  })

  it('maps closed connections and injected read failures to safe read errors', async () => {
    await withMigratedDatabase(({ connection }) => {
      const repository = createAuditEventRepository(connection)
      connection.close()

      const error = captureError(() => repository.listRecent(parseAuditQueryLimit(1)))

      expect(error).toBeInstanceOf(RepositoryReadError)
      expectSafeControlledError(error)
    })

    const rawError = new Error('C:\\secret\\health-screening.sqlite3 SELECT audit_log')
    rawError.name = 'C:\\secret\\DriverError'
    const fakeConnection = {
      prepare: () => {
        throw rawError
      }
    } as unknown as Database.Database

    const error = captureError(() =>
      createAuditEventRepository(fakeConnection).getById(parseEntityId(eventId))
    )

    expect(error).toBeInstanceOf(RepositoryReadError)
    expect((error as RepositoryReadError).errorType).toBe('UnknownError')
    expectSafeControlledError(error)
  })

  it('uses explicit SQL without mutation or transaction-control statements', () => {
    const preparedSql: string[] = []
    const connection = createFakeExecutorConnection({
      recordSql: (sql) => preparedSql.push(sql)
    })

    const record = createExecutorForConnection(connection).run((context) =>
      createAuditEventRepository({} as Database.Database).insert(
        context.connection,
        createValidInput()
      )
    )

    expect(record.id).toBe(eventId)
    expect(preparedSql.length).toBeGreaterThanOrEqual(3)
    expect(preparedSql.join('\n')).toContain('metadata_json')
    expect(preparedSql.join('\n')).toContain('INSERT INTO audit_log')
    expect(preparedSql.join('\n')).not.toMatch(/\bSELECT\s+\*/i)
    expect(preparedSql.join('\n')).not.toMatch(
      /\b(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|UPDATE|DELETE|REPLACE|UPSERT)\b/i
    )
    expect(connection.inTransaction).toBe(false)
  })
})

interface MigratedDatabaseContext {
  connection: Database.Database
  repository: AuditEventRepository
  executor: DatabaseTransactionExecutor
}

interface InsertSettingConnection {
  prepare(source: string): {
    run(key: string, valueJson: string, updatedAt: string, sensitivity: string): Database.RunResult
  }
}

interface RawAuditRow {
  id: unknown
  installation_id: unknown
  user_id: unknown
  action: unknown
  entity_type: unknown
  entity_id: unknown
  occurred_at: unknown
  metadata_json: unknown
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
  getByIdResult?: unknown
  precheckResult?: unknown
  runInsert?: () => void
  getAfterInsert?: () => unknown
  allRows?: unknown
}

interface FakeReadConnectionOptions {
  getByIdResult?: unknown
  allRows?: unknown
}

async function withMigratedDatabase(
  test: (context: MigratedDatabaseContext) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd013-audit-event-repository-'))
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
      repository: createAuditEventRepository(connection),
      executor: createExecutorForConnection(connection)
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createValidInput(
  override: Partial<Record<keyof CreateAuditEventInput, unknown>> = {}
): CreateAuditEventInput {
  const input = createValidRawInput(override)

  return {
    id: parseEntityId(input.id),
    installationId: parseEntityId(input.installationId),
    userId: input.userId === null ? null : parseEntityId(input.userId),
    action: parseAuditActionCode(input.action),
    entityType: parseAuditEntityType(input.entityType),
    entityId: input.entityId === null ? null : parseEntityId(input.entityId),
    occurredAt: parseUtcTimestamp(input.occurredAt),
    metadata: parseAuditMetadata(input.metadata).metadata
  }
}

function createValidRawInput(
  override: Partial<Record<keyof CreateAuditEventInput, unknown>> = {}
): Record<keyof CreateAuditEventInput, unknown> {
  return {
    id: eventId,
    installationId,
    userId: null,
    action: 'LOCATION_CREATED',
    entityType: 'LOCATION',
    entityId,
    occurredAt: now,
    metadata: { count: 1, status: 'created' },
    ...override
  }
}

function createUncheckedInput(
  input: Record<keyof CreateAuditEventInput, unknown>
): CreateAuditEventInput {
  return input as CreateAuditEventInput
}

function createExpectedRecord(
  override: Partial<Record<keyof AuditEventRecord, unknown>> = {}
): AuditEventRecord {
  return {
    id: parseEntityId(eventId),
    installationId: parseEntityId(installationId),
    userId: null,
    action: parseAuditActionCode('LOCATION_CREATED'),
    entityType: parseAuditEntityType('LOCATION'),
    entityId: parseEntityId(entityId),
    occurredAt: parseUtcTimestamp(now),
    metadata: parseAuditMetadata({ count: 1, status: 'created' }).metadata,
    ...override
  } as AuditEventRecord
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
      throw new Error('raw driver refused C:\\secret\\health-screening.sqlite3 ROLLBACK audit_log')
    }
  } as unknown as DatabaseTransactionConnection
}

function createFakeExecutorConnection(
  options: FakeExecutorConnectionOptions = {}
): Database.Database {
  let row: RawAuditRow | null = null
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

function createFakeReadConnection(options: FakeReadConnectionOptions): Database.Database {
  return {
    open: true,
    inTransaction: false,
    prepare(source: string) {
      return createFakeStatement(
        source,
        () => null,
        () => undefined,
        {
          ...(Object.prototype.hasOwnProperty.call(options, 'getByIdResult')
            ? { getByIdResult: options.getByIdResult }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(options, 'allRows')
            ? { allRows: options.allRows }
            : {})
        }
      )
    }
  } as unknown as Database.Database
}

function createFakeStatement(
  source: string,
  getRow: () => RawAuditRow | null,
  setRow: (row: RawAuditRow) => void,
  options: FakeExecutorConnectionOptions
): Database.Statement {
  return {
    run(...params: unknown[]): Database.RunResult {
      if (/INSERT INTO audit_log/i.test(source)) {
        options.runInsert?.()
        setRow({
          id: params[0],
          installation_id: params[1],
          user_id: params[2],
          action: params[3],
          entity_type: params[4],
          entity_id: params[5],
          occurred_at: params[6],
          metadata_json: params[7]
        })
      }

      return { changes: 1, lastInsertRowid: 1 }
    },
    get(...params: unknown[]): unknown {
      const row = getRow()

      if (/1 AS has_existing[\s\S]*WHERE id = \?/i.test(source)) {
        if (Object.prototype.hasOwnProperty.call(options, 'precheckResult')) {
          return options.precheckResult
        }

        return row !== null && row.id === params[0] ? { has_existing: 1 } : undefined
      }

      if (/WHERE id = \?/i.test(source)) {
        if (Object.prototype.hasOwnProperty.call(options, 'getByIdResult')) {
          return options.getByIdResult
        }

        if (row === null || row.id !== params[0]) {
          return undefined
        }

        if (Object.prototype.hasOwnProperty.call(options, 'getAfterInsert')) {
          const getAfterInsert = options.getAfterInsert

          return getAfterInsert === undefined ? undefined : getAfterInsert()
        }

        return row
      }

      return undefined
    },
    all(): unknown[] {
      if (Object.prototype.hasOwnProperty.call(options, 'allRows')) {
        return options.allRows as unknown[]
      }

      const row = getRow()
      return row === null ? [] : [row]
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

function createFixedIdGenerator(): EntityIdGenerator {
  return {
    generate: () => parseEntityId(eventId)
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

function insertRawInstallation(connection: Database.Database): void {
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
    .run(1, installationId, 'Audit Test', 'UTC', now, now)
}

function insertRawUser(connection: Database.Database, override: Partial<RawUserRow> = {}): void {
  const row = {
    id: userId,
    username: 'Audit.Admin',
    username_normalized: 'audit.admin',
    display_name: 'Audit Admin',
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

function insertRawAuditEvent(
  connection: Database.Database,
  override: Partial<RawAuditRow> = {}
): void {
  const row = createRawAuditRow(override)

  connection
    .prepare(
      `INSERT INTO audit_log (
        id,
        installation_id,
        user_id,
        action,
        entity_type,
        entity_id,
        occurred_at,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.installation_id,
      row.user_id,
      row.action,
      row.entity_type,
      row.entity_id,
      row.occurred_at,
      row.metadata_json
    )
}

function insertRawAuditEventIgnoringForeignKeys(
  connection: Database.Database,
  override: Partial<RawAuditRow> = {}
): void {
  connection.pragma('foreign_keys = OFF')
  try {
    insertRawAuditEvent(connection, override)
  } finally {
    connection.pragma('foreign_keys = ON')
  }
}

function createRawAuditRow(override: Partial<RawAuditRow> = {}): RawAuditRow {
  return {
    id: eventId,
    installation_id: installationId,
    user_id: null,
    action: 'LOCATION_CREATED',
    entity_type: 'LOCATION',
    entity_id: entityId,
    occurred_at: now,
    metadata_json: '{"count":1,"status":"created"}',
    ...override
  }
}

function readRawAuditEvent(connection: Database.Database, id: string): RawAuditRow | undefined {
  return connection
    .prepare(
      `SELECT
        id,
        installation_id,
        user_id,
        action,
        entity_type,
        entity_id,
        occurred_at,
        metadata_json
      FROM audit_log
      WHERE id = ?`
    )
    .get(id) as RawAuditRow | undefined
}

function deleteAuditEvents(connection: Database.Database): void {
  connection.prepare('DELETE FROM audit_log').run()
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

function createSparseRows(): unknown[] {
  const rows = [createRawAuditRow()]
  delete rows[0]

  return rows
}

function createRowsWithExtraStringProperty(): unknown[] {
  const rows = [createRawAuditRow()] as unknown[] & { row_metadata?: string }
  Object.defineProperty(rows, 'row_metadata', {
    enumerable: true,
    value: 'secret'
  })

  return rows
}

function createRowsWithSymbolProperty(): unknown[] {
  const rows = [createRawAuditRow()]
  Object.defineProperty(rows, Symbol('row_metadata'), {
    enumerable: true,
    value: true
  })

  return rows
}

function createMalformedAuditRow(): RawAuditRow {
  return {
    ...createRawAuditRow(),
    metadata_json: '{"b":1,"a":2}'
  }
}

function createMalformedPrecheckResults(): readonly unknown[] {
  const accessorRow = Object.create(null) as { has_existing: unknown }
  Object.defineProperty(accessorRow, 'has_existing', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\precheck-getter.txt')
    }
  })

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
    { has_existing: 1, [Symbol('row_metadata')]: true },
    accessorRow,
    new Proxy(
      { has_existing: 1 },
      {
        ownKeys() {
          throw new Error('C:\\secret\\precheck-ownKeys.txt')
        }
      }
    ),
    new Proxy(
      { has_existing: 1 },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\precheck-descriptor.txt')
        }
      }
    )
  ])
}

function createSqliteError(code: string): Error {
  const error = new Error(`raw driver refused ${code} C:\\secret\\audit.sqlite3`)
  error.name = 'SqliteError'
  Object.defineProperty(error, 'code', {
    enumerable: true,
    value: code
  })

  return error
}

function createSqliteErrorWithCodeAccessor(): Error {
  const error = new Error('raw driver refused C:\\secret\\audit-constraint.sqlite3')
  error.name = 'SqliteError'
  Object.defineProperty(error, 'code', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\audit-code-getter.txt')
    }
  })

  return error
}

function createSqliteErrorProxy(): Error {
  return new Proxy(createSqliteError('SQLITE_CONSTRAINT_UNIQUE'), {
    getOwnPropertyDescriptor() {
      throw new Error('C:\\secret\\audit-code-descriptor.txt')
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
    'audit.sqlite3',
    'raw driver refused',
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'audit_log',
    'metadata_json',
    'has_existing',
    'row_metadata',
    'SQLITE_CONSTRAINT',
    'PRIMARYKEY',
    'UNIQUE',
    'CHECK',
    'NOTNULL',
    'FOREIGNKEY',
    'TRIGGER',
    installationId,
    missingInstallationId,
    userId,
    missingUserId,
    eventId,
    secondEventId,
    thirdEventId,
    entityId,
    secondEntityId,
    now,
    later,
    earlier,
    'INSTALLATION_INITIALIZED',
    'LOCATION_CREATED',
    'INSTALLATION',
    'LOCATION',
    'alpha',
    'zeta',
    'status',
    'created',
    'active',
    'kept exact',
    'Audit.Admin',
    'Audit Admin',
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
