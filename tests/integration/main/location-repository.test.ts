import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createLocalUserRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  LocationAlreadyExistsError,
  parseCreateMustChangePassword,
  parseLocalUserRole,
  parseLocationAdministrativeArea,
  parseLocationDirections,
  parseLocationNameIdentity,
  parseLocationType,
  parseUserDisplayName,
  parseUsernameIdentity,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type CreateLocalUserInput,
  type CreateLocationInput,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type LocationRecord,
  type LocationRepository
} from '@main/database'
import { parseEntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'
import type { StoredPasswordCredential } from '@main/security'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T12:34:57.789Z'
const earlier = '2026-07-29T12:34:55.789Z'
const userId = '11111111-1111-4111-8111-111111111111'
const secondUserId = '22222222-2222-4222-8222-222222222222'
const locationId = '33333333-3333-4333-8333-333333333333'
const secondLocationId = '44444444-4444-4444-8444-444444444444'
const thirdLocationId = '55555555-5555-4555-8555-555555555555'
const missingUserId = '66666666-6666-4666-8666-666666666666'
const canonicalCredential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))

describe('location repository', () => {
  it('reports a fresh migrated database without writing location rows', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      const { hasAny, listAll, listActive } = repository

      expect(repository.hasAny()).toBe(false)
      expect(hasAny()).toBe(false)
      expect(listAll()).toEqual([])
      expect(listActive()).toEqual([])
      expect(Object.isFrozen(listAll())).toBe(true)
      expect(Object.isFrozen(listActive())).toBe(true)
      expect(readTableCount(connection, 'locations')).toBe(0)
      expect(readUserVersion(connection)).toBe(6)
      expect(readLedgerCount(connection)).toBe(6)
    })
  })

  it('creates a user and one active location through one authentic transaction', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      const userRepository = createLocalUserRepository(connection)
      const input = createValidLocationInput()

      const inserted = executor.run((context) => {
        userRepository.insert(context.connection, createValidUserInput())
        return repository.insert(context.connection, input)
      })

      expect(inserted).toEqual({
        id: locationId,
        name: 'Central Church',
        locationType: 'CHURCH',
        village: 'Messa',
        subdivision: 'Yaounde I',
        region: 'Centre',
        directions: 'Opposite market gate.',
        isActive: true,
        createdBy: userId,
        createdAt: now,
        updatedBy: userId,
        updatedAt: now
      })
      expect(Object.isFrozen(inserted)).toBe(true)
      expect(inserted).not.toHaveProperty('nameNormalized')
      expect(inserted).not.toHaveProperty('name_normalized')
      expect(connection.inTransaction).toBe(false)
      expect(repository.hasAny()).toBe(true)
      expect(readTableCount(connection, 'locations')).toBe(1)
      expect(readRawLocation(connection)).toEqual({
        id: locationId,
        name: 'Central Church',
        name_normalized: 'central church',
        location_type: 'CHURCH',
        village: 'Messa',
        subdivision: 'Yaounde I',
        region: 'Centre',
        directions: 'Opposite market gate.',
        is_active: 1,
        created_by: userId,
        created_at: now,
        updated_by: userId,
        updated_at: now
      })
    })
  })

  it('refuses unauthentic or expired transaction capabilities before validation or SQL', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawUser(connection)
      connection.exec('BEGIN IMMEDIATE')
      try {
        const rawConnectionError = captureError(() =>
          repository.insert(
            connection as unknown as DatabaseTransactionConnection,
            createValidLocationInput()
          )
        )

        expect(rawConnectionError).toBeInstanceOf(DatabaseTransactionStateError)
        expectSafeControlledError(rawConnectionError)
        expect(connection.inTransaction).toBe(true)
        expect(readTableCount(connection, 'locations')).toBe(0)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }

      const fabricatedConnection = createFabricatedScopedConnection(connection)
      const fabricatedError = captureError(() =>
        repository.insert(fabricatedConnection, createValidLocationInput())
      )

      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(fabricatedError)
      expect(readTableCount(connection, 'locations')).toBe(0)

      let capturedConnection: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        capturedConnection = context.connection
        return 'captured'
      })

      const expiredError = captureError(() =>
        repository.insert(
          capturedConnection!,
          createUncheckedLocationInput({
            ...createValidLocationRawInput({
              id: 'not-a-uuid',
              name: 'Secret\u0000Location',
              createdBy: missingUserId,
              createdAt: 'not-a-timestamp'
            })
          })
        )
      )

      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expect(expiredError).not.toBeInstanceOf(RepositoryValidationError)
      expectSafeControlledError(expiredError)
      expect(readTableCount(connection, 'locations')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('keeps read methods bound to SQLite state when detached or rebound', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      insertRawUser(connection)
      insertRawLocation(connection)

      const { getById, listAll, listActive } = repository
      const fakeThis = {
        getById: () => null,
        listAll: () => [],
        listActive: () => []
      }

      expect(getById.call(fakeThis, parseEntityId(locationId))).toEqual(createExpectedLocation())
      expect(listAll.apply(fakeThis)).toEqual([createExpectedLocation()])
      expect(listActive.call(fakeThis)).toEqual([createExpectedLocation()])

      updateRawLocation(connection, { is_active: 0 })

      expect(listAll.apply(fakeThis)).toEqual([{ ...createExpectedLocation(), isActive: false }])
      expect(listActive.call(fakeThis)).toEqual([])
    })
  })

  it('reads locations through a guarded transaction connection', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawLocation(connection)

      const active = executor.run((context) =>
        repository.getByIdForWrite(context.connection, parseEntityId(locationId))
      )

      expect(active).toEqual(createExpectedLocation())
      expect(Object.isFrozen(active)).toBe(true)

      updateRawLocation(connection, { is_active: 0 })

      const inactive = executor.run((context) =>
        repository.getByIdForWrite(context.connection, parseEntityId(locationId))
      )
      const missing = executor.run((context) =>
        repository.getByIdForWrite(context.connection, parseEntityId(missingUserId))
      )

      expect(inactive).toEqual({ ...createExpectedLocation(), isActive: false })
      expect(missing).toBeNull()

      connection.exec('BEGIN IMMEDIATE')
      try {
        const rawConnectionError = captureError(() =>
          repository.getByIdForWrite(
            connection as unknown as DatabaseTransactionConnection,
            'not-a-uuid' as never
          )
        )

        expect(rawConnectionError).toBeInstanceOf(DatabaseTransactionStateError)
        expect(rawConnectionError).not.toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(rawConnectionError)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }
    })
  })

  it('orders all and active locations by normalized name then ID and permits duplicate names', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawUser(connection)

      const first = executor.run((context) =>
        repository.insert(context.connection, createValidLocationInput())
      )
      const duplicateName = executor.run((context) =>
        repository.insert(
          context.connection,
          createValidLocationInput({
            id: secondLocationId,
            name: parseLocationNameIdentity('CENTRAL CHURCH').name
          })
        )
      )
      insertRawLocation(connection, {
        id: thirdLocationId,
        name: 'Alpha Site',
        name_normalized: 'alpha site',
        location_type: 'COMMUNITY_SITE',
        is_active: 0
      })

      expect(duplicateName.name).toBe('CENTRAL CHURCH')
      expect(readTableCount(connection, 'locations')).toBe(3)

      const allLocations = repository.listAll()
      const activeLocations = repository.listActive()

      expect(allLocations.map((location) => location.id)).toEqual([
        thirdLocationId,
        locationId,
        secondLocationId
      ])
      expect(activeLocations.map((location) => location.id)).toEqual([locationId, secondLocationId])
      expect(allLocations[1]).toEqual(first)
      expect(Object.isFrozen(allLocations)).toBe(true)
      expect(Object.isFrozen(activeLocations)).toBe(true)
    })
  })

  it('refuses duplicate location IDs without mutating the original row', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawUser(connection)
      executor.run((context) => repository.insert(context.connection, createValidLocationInput()))
      const originalRow = readRawLocation(connection)

      const error = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidLocationInput({
              id: locationId,
              name: parseLocationNameIdentity('Second Site').name,
              locationType: parseLocationType('OTHER')
            })
          )
        )
      )

      expect(error).toBeInstanceOf(LocationAlreadyExistsError)
      expectSafeControlledError(error)
      expect(readRawLocation(connection)).toEqual(originalRow)
      expect(readTableCount(connection, 'locations')).toBe(1)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rolls back location and sibling writes when outer transaction work fails', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawUser(connection)

      const error = captureError(() =>
        executor.run((context) => {
          repository.insert(context.connection, createValidLocationInput())
          insertSetting(context.connection, 'location.rollback', '{"enabled":true}')
          throw new Error('C:\\secret\\locations.sqlite3 SELECT locations')
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'locations')).toBe(0)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rejects invalid create input and foreign-key write failures without partial rows', async () => {
    await withMigratedDatabase(({ connection, repository, executor }) => {
      insertRawUser(connection)
      const invalidInputs = [
        { id: 'not-a-uuid' },
        { name: 'Secret\u0000Location' },
        { locationType: 'church' },
        { village: '   ' },
        { subdivision: '---' },
        { region: 'Region\nName' },
        { directions: 'Road\u0000Name' },
        { createdBy: 'not-a-uuid' },
        { createdAt: 'not-a-timestamp' }
      ] as const

      for (const override of invalidInputs) {
        const error = captureError(() =>
          executor.run((context) =>
            repository.insert(
              context.connection,
              createUncheckedLocationInput({ ...createValidLocationRawInput(), ...override })
            )
          )
        )

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
        expect(readTableCount(connection, 'locations')).toBe(0)
        expect(connection.inTransaction).toBe(false)
      }

      for (const malformedInput of createMalformedCreateInputs()) {
        const error = captureError(() =>
          executor.run((context) => repository.insert(context.connection, malformedInput))
        )

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
        expect(readTableCount(connection, 'locations')).toBe(0)
        expect(connection.inTransaction).toBe(false)
      }

      const foreignKeyError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidLocationInput({ createdBy: parseEntityId(missingUserId) })
          )
        )
      )

      expect(foreignKeyError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(foreignKeyError)
      expect(readTableCount(connection, 'locations')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('fails closed on corrupt persisted location rows', async () => {
    await withMigratedDatabase(({ connection, repository }) => {
      insertRawUser(connection)
      const corruptRows = [
        { id: 'not-a-uuid' },
        { name: ' Central Church', name_normalized: 'central church' },
        { name: 'Central Church ', name_normalized: 'central church' },
        { name: '\uFF23entral Church', name_normalized: 'central church' },
        { name: 'Central Church', name_normalized: 'wrong' },
        { location_type: 'church' },
        { village: ' Messa' },
        { subdivision: 'Yaounde\nI' },
        { region: '---' },
        { directions: ' Opposite market gate.' },
        { is_active: 2 },
        { created_by: 'not-a-uuid' },
        { created_at: 'not-a-timestamp' },
        { updated_by: 'not-a-uuid' },
        { updated_at: earlier }
      ] as const

      for (const override of corruptRows) {
        deleteLocations(connection)
        insertRawLocationIgnoringChecksAndForeignKeys(connection, override)

        const listAllError = captureError(() => repository.listAll())

        expect(listAllError).toBeInstanceOf(RepositoryDataIntegrityError)
        expectSafeControlledError(listAllError)

        if (!Object.prototype.hasOwnProperty.call(override, 'id')) {
          const getError = captureError(() => repository.getById(parseEntityId(locationId)))

          expect(getError).toBeInstanceOf(RepositoryDataIntegrityError)
          expectSafeControlledError(getError)
        }

        if (!Object.prototype.hasOwnProperty.call(override, 'is_active')) {
          const listActiveError = captureError(() => repository.listActive())

          expect(listActiveError).toBeInstanceOf(RepositoryDataIntegrityError)
          expectSafeControlledError(listActiveError)
        }
      }
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
        createLocationRepository({} as Database.Database).insert(
          context.connection,
          createValidLocationInput()
        )
    )

    expect(acceptedMissingRecord.id).toBe(locationId)
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
        createLocationRepository({} as Database.Database).insert(
          context.connection,
          createValidLocationInput()
        )
      )
    )

    expect(duplicateError).toBeInstanceOf(LocationAlreadyExistsError)
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
          createLocationRepository({} as Database.Database).insert(
            context.connection,
            createValidLocationInput()
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expect(insertCount).toBe(0)
      expect(connection.inTransaction).toBe(false)
      expectSafeControlledError(error)
    }
  })

  it('maps only primary-key and unique constraint insert failures to duplicate-location errors', () => {
    for (const code of ['SQLITE_CONSTRAINT_PRIMARYKEY', 'SQLITE_CONSTRAINT_UNIQUE']) {
      const connection = createFakeExecutorConnection({
        runInsert: () => {
          throw createSqliteError(code)
        }
      })

      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createLocationRepository({} as Database.Database).insert(
            context.connection,
            createValidLocationInput()
          )
        )
      )

      expect(error).toBeInstanceOf(LocationAlreadyExistsError)
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
          createLocationRepository({} as Database.Database).insert(
            context.connection,
            createValidLocationInput()
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expect(connection.inTransaction).toBe(false)
      expectSafeControlledError(error)
    }
  })

  it('strictly decodes hasAny and list rows from unknown read results', () => {
    for (const hasAnyResult of createMalformedHasAnyResults()) {
      const error = captureError(() =>
        createLocationRepository(
          createFakeReadConnection({ hasAnyResult }) as Database.Database
        ).hasAny()
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    }

    for (const allRows of createMalformedListResults()) {
      const error = captureError(() =>
        createLocationRepository(
          createFakeReadConnection({ allRows }) as Database.Database
        ).listAll()
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    }
  })

  it('returns null from getById only when the driver returns undefined', () => {
    const repository = createLocationRepository(
      createFakeReadConnection({ getByIdResult: undefined }) as Database.Database
    )

    expect(repository.getById(parseEntityId(locationId))).toBeNull()
  })

  it('rejects malformed getById row results without exposing row metadata', () => {
    let accessorInvoked = false
    const accessorRow = createRawLocationRow()
    Object.defineProperty(accessorRow, 'name', {
      enumerable: true,
      get() {
        accessorInvoked = true
        throw new Error('C:\\secret\\single-row-getter.txt')
      }
    })

    const symbolRow = {
      ...createRawLocationRow(),
      [Symbol('row_metadata')]: true
    }

    for (const getByIdResult of [
      null,
      1,
      'row',
      true,
      [],
      {},
      { ...createRawLocationRow(), row_metadata: 'secret' },
      symbolRow,
      accessorRow,
      new Proxy(createRawLocationRow(), {
        ownKeys() {
          throw new Error('C:\\secret\\single-row-ownKeys.txt')
        }
      }),
      new Proxy(createRawLocationRow(), {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\single-row-descriptor.txt')
        }
      })
    ]) {
      const error = captureError(() =>
        createLocationRepository(
          createFakeReadConnection({ getByIdResult }) as Database.Database
        ).getById(parseEntityId(locationId))
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    }

    expect(accessorInvoked).toBe(false)
  })

  it('maps undefined and malformed post-insert verification rows to write errors', () => {
    for (const getAfterInsert of [
      () => undefined,
      () => null,
      () => 1,
      () => [],
      () => ({}),
      () => ({ ...createRawLocationRow(), row_metadata: 'secret' }),
      () =>
        new Proxy(createRawLocationRow(), {
          ownKeys() {
            throw new Error('C:\\secret\\verify-ownKeys.txt')
          }
        })
    ]) {
      const connection = createFakeExecutorConnection({ getAfterInsert })
      const error = captureError(() =>
        createExecutorForConnection(connection).run((context) =>
          createLocationRepository({} as Database.Database).insert(
            context.connection,
            createValidLocationInput()
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expect(connection.inTransaction).toBe(false)
      expectSafeControlledError(error)
    }
  })

  it('accepts only exact dense list result arrays and rejects array metadata safely', () => {
    const emptyList = createLocationRepository(
      createFakeReadConnection({ allRows: [] }) as Database.Database
    ).listAll()
    const denseList = createLocationRepository(
      createFakeReadConnection({ allRows: [createRawLocationRow()] }) as Database.Database
    ).listActive()

    expect(emptyList).toEqual([])
    expect(Object.isFrozen(emptyList)).toBe(true)
    expect(denseList).toEqual([createExpectedLocation()])
    expect(Object.isFrozen(denseList)).toBe(true)
    expect(Object.isFrozen(denseList[0])).toBe(true)

    let getterInvoked = false
    const accessorRows: unknown[] = []
    Object.defineProperty(accessorRows, '0', {
      enumerable: true,
      configurable: true,
      get() {
        getterInvoked = true
        throw new Error('C:\\secret\\array-index-getter.txt')
      }
    })

    let setterInvoked = false
    const setterRows: unknown[] = []
    Object.defineProperty(setterRows, '0', {
      enumerable: true,
      configurable: true,
      set() {
        setterInvoked = true
        throw new Error('C:\\secret\\array-index-setter.txt')
      }
    })

    for (const allRows of [
      createSparseRows(),
      accessorRows,
      setterRows,
      createRowsWithExtraStringProperty(),
      createRowsWithSymbolProperty(),
      new Proxy([createRawLocationRow()], {
        ownKeys() {
          throw new Error('C:\\secret\\array-ownKeys.txt')
        }
      }),
      new Proxy([createRawLocationRow()], {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\array-descriptor.txt')
        }
      }),
      [createMalformedLocationRow()]
    ]) {
      const error = captureError(() =>
        createLocationRepository(
          createFakeReadConnection({ allRows }) as Database.Database
        ).listAll()
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    }

    expect(getterInvoked).toBe(false)
    expect(setterInvoked).toBe(false)
  })

  it('maps closed connections and injected read failures to safe read errors', async () => {
    await withMigratedDatabase(({ connection }) => {
      const repository = createLocationRepository(connection)
      connection.close()

      const error = captureError(() => repository.hasAny())

      expect(error).toBeInstanceOf(RepositoryReadError)
      expectSafeControlledError(error)
    })

    const rawError = new Error('C:\\secret\\health-screening.sqlite3 SELECT locations')
    rawError.name = 'C:\\secret\\DriverError'
    const fakeConnection = {
      prepare: () => {
        throw rawError
      }
    } as unknown as Database.Database

    const error = captureError(() => createLocationRepository(fakeConnection).hasAny())

    expect(error).toBeInstanceOf(RepositoryReadError)
    expect((error as RepositoryReadError).errorType).toBe('UnknownError')
    expectSafeControlledError(error)
  })

  it('maps scoped write and verification-read failures to safe write errors', () => {
    const writeFailure = new Error(
      'raw driver refused C:\\secret\\health-screening.sqlite3 INSERT locations'
    )
    writeFailure.name = 'C:\\secret\\SqliteError'
    const writeFailureConnection = createFakeExecutorConnection({
      runInsert: () => {
        throw writeFailure
      }
    })

    const writeError = captureError(() =>
      createExecutorForConnection(writeFailureConnection).run((context) =>
        createLocationRepository({} as Database.Database).insert(
          context.connection,
          createValidLocationInput()
        )
      )
    )

    expect(writeError).toBeInstanceOf(RepositoryWriteError)
    expect((writeError as RepositoryWriteError).errorType).toBe('UnknownError')
    expectSafeControlledError(writeError)
    expect(writeFailureConnection.inTransaction).toBe(false)

    const verificationFailure = new Error(
      'raw driver refused C:\\secret\\verify.sqlite3 SELECT locations'
    )
    verificationFailure.name = 'C:\\secret\\VerifyError'
    const verificationFailureConnection = createFakeExecutorConnection({
      getAfterInsert: () => {
        throw verificationFailure
      }
    })

    const verificationError = captureError(() =>
      createExecutorForConnection(verificationFailureConnection).run((context) =>
        createLocationRepository({} as Database.Database).insert(
          context.connection,
          createValidLocationInput()
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
      createLocationRepository({} as Database.Database).insert(
        context.connection,
        createValidLocationInput()
      )
    )

    expect(record.id).toBe(locationId)
    expect(preparedSql.length).toBeGreaterThanOrEqual(3)
    expect(preparedSql.join('\n')).toContain('name_normalized')
    expect(preparedSql.join('\n')).toContain('INSERT INTO locations')
    expect(preparedSql.join('\n')).not.toMatch(/\bSELECT\s+\*/i)
    expect(preparedSql.join('\n')).not.toMatch(
      /\b(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE|UPDATE|DELETE|REPLACE|UPSERT)\b/i
    )
    expect(connection.inTransaction).toBe(false)
  })
})

interface MigratedDatabaseContext {
  connection: Database.Database
  repository: LocationRepository
  executor: DatabaseTransactionExecutor
}

interface InsertSettingConnection {
  prepare(source: string): {
    run(key: string, valueJson: string, updatedAt: string, sensitivity: string): Database.RunResult
  }
}

interface RawLocationRow {
  id: unknown
  name: unknown
  name_normalized: unknown
  location_type: unknown
  village: unknown
  subdivision: unknown
  region: unknown
  directions: unknown
  is_active: unknown
  created_by: unknown
  created_at: unknown
  updated_by: unknown
  updated_at: unknown
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
  hasAnyResult?: unknown
  allRows?: unknown
}

async function withMigratedDatabase(
  test: (context: MigratedDatabaseContext) => void | Promise<void>
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd012-location-repository-'))
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
      repository: createLocationRepository(connection),
      executor: createExecutorForConnection(connection)
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createValidLocationInput(
  override: Partial<Record<keyof CreateLocationInput, unknown>> = {}
): CreateLocationInput {
  const input = createValidLocationRawInput(override)

  return {
    id: parseEntityId(input.id),
    name: parseLocationNameIdentity(input.name).name,
    locationType: parseLocationType(input.locationType),
    village: parseLocationAdministrativeArea(input.village),
    subdivision: parseLocationAdministrativeArea(input.subdivision),
    region: parseLocationAdministrativeArea(input.region),
    directions: parseLocationDirections(input.directions),
    createdBy: parseEntityId(input.createdBy),
    createdAt: parseUtcTimestamp(input.createdAt)
  }
}

function createValidLocationRawInput(
  override: Partial<Record<keyof CreateLocationInput, unknown>> = {}
): Record<keyof CreateLocationInput, unknown> {
  return {
    id: locationId,
    name: 'Central Church',
    locationType: 'CHURCH',
    village: 'Messa',
    subdivision: 'Yaounde I',
    region: 'Centre',
    directions: 'Opposite market gate.',
    createdBy: userId,
    createdAt: now,
    ...override
  }
}

function createUncheckedLocationInput(
  input: Record<keyof CreateLocationInput, unknown>
): CreateLocationInput {
  return input as CreateLocationInput
}

function createValidUserInput(): CreateLocalUserInput {
  return {
    id: parseEntityId(userId),
    username: parseUsernameIdentity('Location.Admin').username,
    displayName: parseUserDisplayName('Location Admin'),
    credential: canonicalCredential as StoredPasswordCredential,
    role: parseLocalUserRole('LOCAL_ADMIN'),
    mustChangePassword: parseCreateMustChangePassword(true),
    createdAt: parseUtcTimestamp(now),
    updatedAt: parseUtcTimestamp(now)
  }
}

function createExpectedLocation(
  override: Partial<Record<keyof LocationRecord, unknown>> = {}
): LocationRecord {
  return {
    id: parseEntityId(locationId),
    name: parseLocationNameIdentity('Central Church').name,
    locationType: parseLocationType('CHURCH'),
    village: parseLocationAdministrativeArea('Messa'),
    subdivision: parseLocationAdministrativeArea('Yaounde I'),
    region: parseLocationAdministrativeArea('Centre'),
    directions: parseLocationDirections('Opposite market gate.'),
    isActive: true,
    createdBy: parseEntityId(userId),
    createdAt: parseUtcTimestamp(now),
    updatedBy: parseEntityId(userId),
    updatedAt: parseUtcTimestamp(now),
    ...override
  } as LocationRecord
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
      throw new Error('raw driver refused C:\\secret\\health-screening.sqlite3 ROLLBACK locations')
    }
  } as unknown as DatabaseTransactionConnection
}

function createFakeExecutorConnection(
  options: FakeExecutorConnectionOptions = {}
): Database.Database {
  let row: RawLocationRow | null = null
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
          precheckResult: undefined,
          ...(Object.prototype.hasOwnProperty.call(options, 'allRows')
            ? { allRows: options.allRows }
            : {})
        },
        options.hasAnyResult,
        Object.prototype.hasOwnProperty.call(options, 'hasAnyResult')
      )
    }
  } as unknown as Database.Database
}

function createFakeStatement(
  source: string,
  getRow: () => RawLocationRow | null,
  setRow: (row: RawLocationRow) => void,
  options: FakeExecutorConnectionOptions,
  hasAnyResult?: unknown,
  hasAnyResultProvided = false
): Database.Statement {
  return {
    run(...params: unknown[]): Database.RunResult {
      if (/INSERT INTO locations/i.test(source)) {
        options.runInsert?.()
        setRow({
          id: params[0],
          name: params[1],
          name_normalized: params[2],
          location_type: params[3],
          village: params[4],
          subdivision: params[5],
          region: params[6],
          directions: params[7],
          is_active: 1,
          created_by: params[8],
          created_at: params[9],
          updated_by: params[10],
          updated_at: params[11]
        })
      }

      return { changes: 1, lastInsertRowid: 1 }
    },
    get(...params: unknown[]): unknown {
      const row = getRow()

      if (/SELECT EXISTS/i.test(source)) {
        if (hasAnyResultProvided) {
          return hasAnyResult
        }

        return { has_any: row === null ? 0 : 1 }
      }

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
    generate: () => parseEntityId(locationId)
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

function insertRawUser(connection: Database.Database, override: Partial<RawUserRow> = {}): void {
  const row = {
    id: userId,
    username: 'Location.Admin',
    username_normalized: 'location.admin',
    display_name: 'Location Admin',
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

function insertRawLocation(
  connection: Database.Database,
  override: Partial<RawLocationRow> = {}
): void {
  const row = createRawLocationRow(override)

  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        village,
        subdivision,
        region,
        directions,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.name,
      row.name_normalized,
      row.location_type,
      row.village,
      row.subdivision,
      row.region,
      row.directions,
      row.is_active,
      row.created_by,
      row.created_at,
      row.updated_by,
      row.updated_at
    )
}

function insertRawLocationIgnoringChecksAndForeignKeys(
  connection: Database.Database,
  override: Partial<RawLocationRow> = {}
): void {
  connection.pragma('ignore_check_constraints = ON')
  connection.pragma('foreign_keys = OFF')
  try {
    insertRawLocation(connection, override)
  } finally {
    connection.pragma('foreign_keys = ON')
    connection.pragma('ignore_check_constraints = OFF')
  }
}

function createRawLocationRow(override: Partial<RawLocationRow> = {}): RawLocationRow {
  return {
    id: locationId,
    name: 'Central Church',
    name_normalized: 'central church',
    location_type: 'CHURCH',
    village: 'Messa',
    subdivision: 'Yaounde I',
    region: 'Centre',
    directions: 'Opposite market gate.',
    is_active: 1,
    created_by: userId,
    created_at: now,
    updated_by: userId,
    updated_at: now,
    ...override
  }
}

function updateRawLocation(
  connection: Database.Database,
  override: Partial<RawLocationRow> = {}
): void {
  const row = { ...createRawLocationRow(), ...override }

  connection
    .prepare(
      `UPDATE locations
      SET name = ?,
        name_normalized = ?,
        location_type = ?,
        village = ?,
        subdivision = ?,
        region = ?,
        directions = ?,
        is_active = ?,
        created_by = ?,
        created_at = ?,
        updated_by = ?,
        updated_at = ?
      WHERE id = ?`
    )
    .run(
      row.name,
      row.name_normalized,
      row.location_type,
      row.village,
      row.subdivision,
      row.region,
      row.directions,
      row.is_active,
      row.created_by,
      row.created_at,
      row.updated_by,
      row.updated_at,
      row.id
    )
}

function readRawLocation(
  connection: Database.Database,
  id = locationId
): RawLocationRow | undefined {
  return connection
    .prepare(
      `SELECT
        id,
        name,
        name_normalized,
        location_type,
        village,
        subdivision,
        region,
        directions,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      FROM locations
      WHERE id = ?`
    )
    .get(id) as RawLocationRow | undefined
}

function deleteLocations(connection: Database.Database): void {
  connection.prepare('DELETE FROM locations').run()
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

function createMalformedCreateInputs(): readonly CreateLocationInput[] {
  const extraProperty = {
    ...createValidLocationRawInput(),
    row_metadata: 'secret'
  }
  const symbolProperty = {
    ...createValidLocationRawInput(),
    [Symbol('row_metadata')]: true
  }
  const accessorName = { ...createValidLocationRawInput() }
  Object.defineProperty(accessorName, 'name', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\location-name-getter.txt')
    }
  })

  return Object.freeze([
    createUncheckedLocationInput(extraProperty as Record<keyof CreateLocationInput, unknown>),
    createUncheckedLocationInput(symbolProperty as Record<keyof CreateLocationInput, unknown>),
    createUncheckedLocationInput(accessorName),
    new Proxy(createValidLocationRawInput(), {
      ownKeys() {
        throw new Error('C:\\secret\\location-ownKeys.txt')
      }
    }) as CreateLocationInput,
    new Proxy(createValidLocationRawInput(), {
      getOwnPropertyDescriptor() {
        throw new Error('C:\\secret\\location-descriptor.txt')
      }
    }) as CreateLocationInput
  ])
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

function createMalformedHasAnyResults(): readonly unknown[] {
  const accessorRow = Object.create(null) as { has_any: unknown }
  Object.defineProperty(accessorRow, 'has_any', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\hasAny-getter.txt')
    }
  })

  return Object.freeze([
    undefined,
    null,
    [],
    1,
    'has_any',
    {},
    { has_any: 2 },
    { has_any: true },
    { has_any: 1, row_metadata: 'secret' },
    accessorRow,
    new Proxy(
      { has_any: 1 },
      {
        ownKeys() {
          throw new Error('C:\\secret\\hasAny-ownKeys.txt')
        }
      }
    )
  ])
}

function createMalformedListResults(): readonly unknown[] {
  const accessorRow = Object.create(null) as RawLocationRow
  Object.defineProperty(accessorRow, 'id', {
    enumerable: true,
    get() {
      throw new Error('C:\\secret\\row-id-getter.txt')
    }
  })

  return Object.freeze([
    null,
    1,
    'rows',
    {},
    createSparseRows(),
    [accessorRow],
    [
      new Proxy(createRawLocationRow(), {
        ownKeys() {
          throw new Error('C:\\secret\\row-ownKeys.txt')
        }
      })
    ],
    [
      new Proxy(createRawLocationRow(), {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\row-descriptor.txt')
        }
      })
    ]
  ])
}

function createSparseRows(): unknown[] {
  const rows = [createRawLocationRow()]
  delete rows[0]

  return rows
}

function createRowsWithExtraStringProperty(): unknown[] {
  const rows = [createRawLocationRow()] as unknown[] & { row_metadata?: string }
  Object.defineProperty(rows, 'row_metadata', {
    enumerable: true,
    value: 'secret'
  })

  return rows
}

function createRowsWithSymbolProperty(): unknown[] {
  const rows = [createRawLocationRow()]
  Object.defineProperty(rows, Symbol('row_metadata'), {
    enumerable: true,
    value: true
  })

  return rows
}

function createMalformedLocationRow(): RawLocationRow {
  return {
    ...createRawLocationRow(),
    name: ' Central Church'
  }
}

function createSqliteError(code: string): Error {
  const error = new Error(`raw driver refused ${code} C:\\secret\\locations.sqlite3`)
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
    'locations.sqlite3',
    'raw driver refused',
    'SELECT',
    'INSERT',
    'UPDATE',
    'name_normalized',
    'has_existing',
    'has_any',
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
    locationId,
    secondLocationId,
    thirdLocationId,
    missingUserId,
    now,
    later,
    earlier,
    'Central Church',
    'CENTRAL CHURCH',
    'Second Site',
    'Alpha Site',
    'Messa',
    'Yaounde',
    'Centre',
    'Opposite market gate',
    'Location.Admin',
    'Location Admin',
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
