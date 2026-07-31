import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createFirstRunBootstrapService,
  FirstRunAlreadyInitializedError,
  FirstRunInitializationError,
  FirstRunInitializationInProgressError,
  FirstRunStateIntegrityError,
  FirstRunValidationError
} from '@main/application'
import {
  AuditEventAlreadyExistsError,
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocalUserRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  InstallationAlreadyExistsError,
  parseUsernameIdentity,
  RepositoryWriteError,
  type AuditEventRepository,
  type DatabaseTransactionExecutor,
  type InstallationRepository,
  type LocalUserRepository,
  type LocationRepository
} from '@main/database'
import { parseEntityId, type EntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import {
  createPasswordCredentialService,
  PasswordHashingError,
  PasswordValidationError,
  type PasswordCredentialService,
  type PasswordCryptoProvider,
  type StoredPasswordCredential
} from '@main/security'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const temporarySecret = 'ValidPassw0rd!'
const bootstrapTimestamp = '2026-07-29T12:34:56.789Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const administratorId = '22222222-2222-4222-8222-222222222222'
const locationId = '33333333-3333-4333-8333-333333333333'
const installationAuditId = '44444444-4444-4444-8444-444444444444'
const userAuditId = '55555555-5555-4555-8555-555555555555'
const locationAuditId = '66666666-6666-4666-8666-666666666666'
const deterministicIds = Object.freeze([
  installationId,
  administratorId,
  locationId,
  installationAuditId,
  userAuditId,
  locationAuditId
])

describe('first-run bootstrap service', () => {
  it('reports REQUIRED on a fresh migrated database without startup writes or runtime wiring', async () => {
    await withMigratedDatabase(async ({ connection, service }) => {
      expect(service.getState()).toEqual({ status: 'REQUIRED' })
      expect(readBootstrapCounts(connection)).toEqual({
        installation: 0,
        users: 0,
        locations: 0,
        audit_log: 0,
        app_settings: 0,
        protocol_versions: 0,
        patients: 0,
        sync_outbox: 0
      })
      expect(readUserVersion(connection)).toBe(1)
      expect(readTableCount(connection, 'schema_migrations')).toBe(1)
      expect(readSource('src/main/app/lifecycle.ts')).not.toContain('first-run')
      expect(readSource('src/main/app/lifecycle.ts')).not.toContain(
        'createFirstRunBootstrapService'
      )
      expect(readSource('src/main/index.ts')).not.toContain('first-run')
    })
  })

  it('atomically creates installation, administrator, location, and three audit events', async () => {
    await withMigratedDatabase(
      async ({ connection, service, passwordService, idGenerator, clock }) => {
        const result = await service.initialize(createValidCommand())

        expect(result.status).toBe('INITIALIZED')
        expect(result.installation).toEqual({
          id: installationId,
          deploymentName: 'Cameroon Pilot',
          timeZone: 'Africa/Douala',
          createdAt: bootstrapTimestamp,
          updatedAt: bootstrapTimestamp
        })
        expect(result.administrator).toEqual({
          id: administratorId,
          username: 'Admin.User',
          displayName: 'Admin User',
          role: 'LOCAL_ADMIN',
          isActive: true,
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: null,
          createdAt: bootstrapTimestamp,
          updatedAt: bootstrapTimestamp
        })
        expect(result.initialLocation).toEqual({
          id: locationId,
          name: 'Central Church',
          locationType: 'CHURCH',
          village: 'Messa',
          subdivision: 'Yaounde I',
          region: 'Centre',
          directions: 'Opposite market gate.',
          isActive: true,
          createdBy: administratorId,
          createdAt: bootstrapTimestamp,
          updatedBy: administratorId,
          updatedAt: bootstrapTimestamp
        })
        expect(result.auditEvents.map((event) => event.id)).toEqual([
          installationAuditId,
          userAuditId,
          locationAuditId
        ])
        expect(Object.isFrozen(result)).toBe(true)
        expect(Object.isFrozen(result.auditEvents)).toBe(true)
        expect(Object.isFrozen(result.auditEvents[0]?.metadata)).toBe(true)
        expect(JSON.stringify(result)).not.toContain(temporarySecret)
        expect(JSON.stringify(result)).not.toContain('passwordHash')
        expect(JSON.stringify(result)).not.toContain('passwordSalt')
        expect(JSON.stringify(result)).not.toContain('metadataJson')

        expect(readBootstrapCounts(connection)).toMatchObject({
          installation: 1,
          users: 1,
          locations: 1,
          audit_log: 3,
          app_settings: 0,
          protocol_versions: 0,
          patients: 0,
          sync_outbox: 0
        })
        expect(readRawInstallation(connection)).toEqual({
          singleton_id: 1,
          id: installationId,
          deployment_name: 'Cameroon Pilot',
          timezone: 'Africa/Douala',
          created_at: bootstrapTimestamp,
          updated_at: bootstrapTimestamp
        })
        expect(readRawUser(connection)).toMatchObject({
          id: administratorId,
          username: 'Admin.User',
          username_normalized: 'admin.user',
          display_name: 'Admin User',
          role: 'LOCAL_ADMIN',
          is_active: 1,
          must_change_password: 1,
          failed_login_count: 0,
          locked_until: null,
          last_login_at: null,
          created_at: bootstrapTimestamp,
          updated_at: bootstrapTimestamp
        })
        expect(JSON.stringify(readRawUser(connection))).not.toContain(temporarySecret)
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
          created_by: administratorId,
          created_at: bootstrapTimestamp,
          updated_by: administratorId,
          updated_at: bootstrapTimestamp
        })
        expect(readRawAuditRows(connection)).toEqual([
          {
            id: installationAuditId,
            installation_id: installationId,
            user_id: null,
            action: 'INSTALLATION_INITIALIZED',
            entity_type: 'INSTALLATION',
            entity_id: installationId,
            occurred_at: bootstrapTimestamp,
            metadata_json: '{"bootstrap":true}'
          },
          {
            id: userAuditId,
            installation_id: installationId,
            user_id: null,
            action: 'LOCAL_USER_CREATED',
            entity_type: 'LOCAL_USER',
            entity_id: administratorId,
            occurred_at: bootstrapTimestamp,
            metadata_json: '{"bootstrap":true,"must_change_password":true,"role":"LOCAL_ADMIN"}'
          },
          {
            id: locationAuditId,
            installation_id: installationId,
            user_id: null,
            action: 'LOCATION_CREATED',
            entity_type: 'LOCATION',
            entity_id: locationId,
            occurred_at: bootstrapTimestamp,
            metadata_json: '{"bootstrap":true,"initial_location":true,"location_type":"CHURCH"}'
          }
        ])
        expect(result.auditEvents.map((event) => event.metadata)).toEqual([
          { bootstrap: true },
          { bootstrap: true, must_change_password: true, role: 'LOCAL_ADMIN' },
          { bootstrap: true, initial_location: true, location_type: 'CHURCH' }
        ])
        expect(idGenerator.calls).toBe(6)
        expect(clock.calls).toBe(1)
        expect(passwordService.hash).toHaveBeenCalledTimes(1)

        const authenticationRecord = createLocalUserRepository(
          connection
        ).getAuthenticationByUsername(parseUsernameIdentity('admin.user').username)
        expect(authenticationRecord).not.toBeNull()
        await expect(
          passwordService.verify(temporarySecret, authenticationRecord?.credential)
        ).resolves.toBe(true)
        await expect(
          passwordService.verify('DifferentPassw0rd!', authenticationRecord?.credential)
        ).resolves.toBe(false)
        expect(service.getState()).toEqual({
          status: 'INITIALIZED',
          installation: result.installation
        })
        expect(connection.inTransaction).toBe(false)
      }
    )
  })

  it('rejects repeat initialization before hashing or opening another transaction', async () => {
    await withMigratedDatabase(
      async ({ connection, service, passwordService, transactionExecutor }) => {
        await service.initialize(createValidCommand())
        const hashCallsAfterSuccess = vi.mocked(passwordService.hash).mock.calls.length
        const transactionCallsAfterSuccess = transactionExecutor.calls

        const error = await captureAsyncError(() => service.initialize(createValidCommand()))

        expect(error).toBeInstanceOf(FirstRunAlreadyInitializedError)
        expectSafeFirstRunError(error)
        expect(passwordService.hash).toHaveBeenCalledTimes(hashCallsAfterSuccess)
        expect(transactionExecutor.calls).toBe(transactionCallsAfterSuccess)
        expect(readBootstrapCounts(connection)).toMatchObject({
          installation: 1,
          users: 1,
          locations: 1,
          audit_log: 3
        })
        expect(connection.inTransaction).toBe(false)
      }
    )
  })

  it('reports all reviewed inconsistent state codes and does not hash or generate IDs', async () => {
    const cases = [
      {
        name: 'local data without installation',
        arrange: (connection: Database.Database) => insertRawUser(connection),
        expected: 'INSTALLATION_MISSING_WITH_LOCAL_DATA'
      },
      {
        name: 'installation without administrator or location',
        arrange: (connection: Database.Database) => insertRawInstallation(connection),
        expected: 'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR_AND_LOCATION'
      },
      {
        name: 'installation without administrator',
        arrange: (connection: Database.Database) => {
          insertRawInstallation(connection)
          insertRawLocationWithoutUser(connection)
        },
        expected: 'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR'
      },
      {
        name: 'installation without location',
        arrange: (connection: Database.Database) => {
          insertRawInstallation(connection)
          insertRawUser(connection)
        },
        expected: 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
      }
    ] as const

    for (const testCase of cases) {
      await withMigratedDatabase(
        async ({ connection, service, passwordService, idGenerator, clock }) => {
          testCase.arrange(connection)

          expect(service.getState()).toEqual({
            status: 'INCONSISTENT',
            code: testCase.expected
          })
          const error = await captureAsyncError(() => service.initialize(createValidCommand()))

          expect(error, testCase.name).toBeInstanceOf(FirstRunStateIntegrityError)
          expectSafeFirstRunError(error)
          expect(passwordService.hash).not.toHaveBeenCalled()
          expect(idGenerator.calls).toBe(0)
          expect(clock.calls).toBe(0)
          expect(connection.inTransaction).toBe(false)
        }
      )
    }
  })

  it('rejects overlapping initialization before a second hash or transaction and clears the guard', async () => {
    await withMigratedDatabase(
      async ({ connection, dependencies, passwordService, transactionExecutor }) => {
        const pendingHash = createDeferred<StoredPasswordCredential>()
        vi.mocked(passwordService.hash).mockReturnValueOnce(pendingHash.promise)
        const service = createFirstRunBootstrapService(dependencies)

        const first = service.initialize(createValidCommand())
        await Promise.resolve()

        const secondError = await captureAsyncError(() => service.initialize(createValidCommand()))

        expect(secondError).toBeInstanceOf(FirstRunInitializationInProgressError)
        expectSafeFirstRunError(secondError)
        expect(passwordService.hash).toHaveBeenCalledTimes(1)
        expect(transactionExecutor.calls).toBe(0)
        expect(readBootstrapCounts(connection)).toMatchObject({
          installation: 0,
          users: 0,
          locations: 0,
          audit_log: 0
        })

        pendingHash.resolve(createDeterministicCredential())
        await expect(first).resolves.toMatchObject({ status: 'INITIALIZED' })
        expect(transactionExecutor.calls).toBe(1)
        expect(connection.inTransaction).toBe(false)

        const repeatError = await captureAsyncError(() => service.initialize(createValidCommand()))

        expect(repeatError).toBeInstanceOf(FirstRunAlreadyInitializedError)
        expect(repeatError).not.toBeInstanceOf(FirstRunInitializationInProgressError)
      }
    )
  })

  it('clears the concurrency guard after hash rejection and maps password failures safely', async () => {
    await withMigratedDatabase(async ({ service, passwordService, transactionExecutor }) => {
      vi.mocked(passwordService.hash).mockRejectedValueOnce(
        new PasswordHashingError('C:\\secret\\scrypt.txt')
      )

      const firstError = await captureAsyncError(() => service.initialize(createValidCommand()))

      expect(firstError).toBeInstanceOf(FirstRunInitializationError)
      expectSafeFirstRunError(firstError)
      expect(transactionExecutor.calls).toBe(0)

      vi.mocked(passwordService.hash).mockRejectedValueOnce(new PasswordValidationError())

      const secondError = await captureAsyncError(() => service.initialize(createValidCommand()))

      expect(secondError).toBeInstanceOf(FirstRunValidationError)
      expect(secondError).not.toBeInstanceOf(FirstRunInitializationInProgressError)
      expect(transactionExecutor.calls).toBe(0)
    })
  })

  it('rolls back every induced write-stage failure and leaves no partial bootstrap rows', async () => {
    const cases = [
      'installation duplicate',
      'installation insert',
      'administrator insert',
      'location insert',
      'installation audit insert',
      'user audit insert',
      'location audit insert',
      'verification read'
    ] as const

    for (const failureStage of cases) {
      await withMigratedDatabase(async ({ connection, dependencies, passwordService }) => {
        const service = createFirstRunBootstrapService(withWriteFailure(dependencies, failureStage))

        const error = await captureAsyncError(() => service.initialize(createValidCommand()))

        if (failureStage === 'installation duplicate') {
          expect(error).toBeInstanceOf(FirstRunAlreadyInitializedError)
        } else {
          expect(error).toBeInstanceOf(FirstRunInitializationError)
        }
        expectSafeFirstRunError(error)
        expect(passwordService.hash).toHaveBeenCalledTimes(1)
        expect(readBootstrapCounts(connection)).toMatchObject({
          installation: 0,
          users: 0,
          locations: 0,
          audit_log: 0
        })
        expect(connection.inTransaction).toBe(false)
      })
    }
  })

  it('rolls back clock, ID, callback, and commit failures without partial rows', async () => {
    const cases = [
      {
        name: 'clock',
        options: {
          clock: createFixedClock({ fail: true })
        }
      },
      {
        name: 'id',
        options: {
          idGenerator: createQueuedIdGenerator(['not-a-uuid' as EntityId])
        }
      },
      {
        name: 'callback work',
        options: {
          wrapDependencies: (dependencies: BootstrapDependencies) =>
            withWriteFailure(dependencies, 'location audit insert')
        }
      },
      {
        name: 'commit',
        options: {
          failCommit: true
        }
      }
    ] as const

    for (const testCase of cases) {
      await withMigratedDatabase(async ({ connection, service, passwordService }) => {
        const error = await captureAsyncError(() => service.initialize(createValidCommand()))

        expect(error, testCase.name).toBeInstanceOf(FirstRunInitializationError)
        expectSafeFirstRunError(error)
        expect(passwordService.hash).toHaveBeenCalledTimes(1)
        expect(readBootstrapCounts(connection)).toMatchObject({
          installation: 0,
          users: 0,
          locations: 0,
          audit_log: 0
        })
        expect(connection.inTransaction).toBe(false)
      }, testCase.options)
    }
  })

  it('performs password hashing before the transaction and does not repeat it after repository failure', async () => {
    await withMigratedDatabase(async ({ dependencies, passwordService, transactionExecutor }) => {
      const pendingHash = createDeferred<StoredPasswordCredential>()
      vi.mocked(passwordService.hash).mockReturnValueOnce(pendingHash.promise)
      const service = createFirstRunBootstrapService(
        withWriteFailure(dependencies, 'administrator insert')
      )
      const initialization = service.initialize(createValidCommand())

      await Promise.resolve()
      expect(passwordService.hash).toHaveBeenCalledTimes(1)
      expect(transactionExecutor.calls).toBe(0)

      pendingHash.resolve(createDeterministicCredential())
      const error = await captureAsyncError(() => initialization)

      expect(error).toBeInstanceOf(FirstRunInitializationError)
      expect(passwordService.hash).toHaveBeenCalledTimes(1)
      expect(transactionExecutor.calls).toBe(1)
    })
  })

  it('keeps production first-run code inside the application-service boundary', () => {
    const source = [
      readSource('src/main/application/first-run/first-run-bootstrap-service.ts'),
      readSource('src/main/application/first-run/first-run-validation.ts')
    ].join('\n')

    expect(source).not.toMatch(
      /\b(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/u
    )
    expect(source).not.toContain('transaction(')
    expect(source).not.toContain('crypto.randomUUID')
    expect(source).not.toContain('Date.now')
    expect(source).not.toContain('new Date')
    expect(source).not.toContain('console.')
    expect(source).not.toContain('better-sqlite3')
    expect(source).not.toContain('@renderer')
    expect(source).not.toContain('@preload')
    expect(source).not.toContain('@shared')
  })
})

interface BootstrapDependencies {
  readonly installationRepository: InstallationRepository
  readonly localUserRepository: LocalUserRepository
  readonly locationRepository: LocationRepository
  readonly auditEventRepository: AuditEventRepository
  readonly passwordCredentialService: PasswordCredentialService
  readonly transactionExecutor: CountingTransactionExecutor
}

interface WithMigratedDatabaseOptions {
  readonly idGenerator?: CountingEntityIdGenerator
  readonly clock?: CountingUtcClock
  readonly wrapDependencies?: (dependencies: BootstrapDependencies) => BootstrapDependencies
  readonly failCommit?: boolean
}

interface WithMigratedDatabaseContext {
  readonly connection: Database.Database
  readonly databasePath: string
  readonly service: ReturnType<typeof createFirstRunBootstrapService>
  readonly dependencies: BootstrapDependencies
  readonly passwordService: PasswordCredentialService & {
    readonly hash: ReturnType<typeof vi.fn<PasswordCredentialService['hash']>>
    readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
    readonly validateCredential: ReturnType<
      typeof vi.fn<PasswordCredentialService['validateCredential']>
    >
  }
  readonly transactionExecutor: CountingTransactionExecutor
  readonly idGenerator: CountingEntityIdGenerator
  readonly clock: CountingUtcClock
}

type FailureStage =
  | 'installation duplicate'
  | 'installation insert'
  | 'administrator insert'
  | 'location insert'
  | 'installation audit insert'
  | 'user audit insert'
  | 'location audit insert'
  | 'verification read'

async function withMigratedDatabase(
  test: (context: WithMigratedDatabaseContext) => Promise<void> | void,
  options: WithMigratedDatabaseOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-014-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: { now: () => '2026-07-29T00:00:00.000Z' }
    })(connection)

    const idGenerator = options.idGenerator ?? createQueuedIdGenerator(deterministicIds)
    const clock = options.clock ?? createFixedClock()
    const transactionExecutor = createCountingTransactionExecutor(
      createDatabaseTransactionExecutor({
        connection,
        idGenerator,
        clock,
        logger: { error: vi.fn() }
      })
    )
    const passwordService = createCountingPasswordService()
    const baseDependencies: BootstrapDependencies = {
      installationRepository: createInstallationRepository(connection),
      localUserRepository: createLocalUserRepository(connection),
      locationRepository: createLocationRepository(connection),
      auditEventRepository: createAuditEventRepository(connection),
      passwordCredentialService: passwordService,
      transactionExecutor
    }
    const dependencies = options.wrapDependencies
      ? options.wrapDependencies(baseDependencies)
      : baseDependencies
    const service = createFirstRunBootstrapService(dependencies)
    const originalExec = connection.exec.bind(connection)
    const execSpy =
      options.failCommit === true
        ? vi.spyOn(connection, 'exec').mockImplementation((source: string) => {
            if (/^\s*COMMIT\s*;?\s*$/iu.test(source)) {
              throw new Error('C:\\secret\\commit.sqlite3')
            }

            return originalExec(source)
          })
        : undefined

    try {
      await test({
        connection,
        databasePath,
        service,
        dependencies,
        passwordService,
        transactionExecutor,
        idGenerator,
        clock
      })
    } finally {
      execSpy?.mockRestore()
    }
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function withWriteFailure(
  dependencies: BootstrapDependencies,
  failureStage: FailureStage
): BootstrapDependencies {
  let auditInsertCount = 0

  return {
    ...dependencies,
    installationRepository: {
      ...dependencies.installationRepository,
      insert(connection, input) {
        if (failureStage === 'installation duplicate') {
          throw new InstallationAlreadyExistsError('SqliteError')
        }

        if (failureStage === 'installation insert') {
          throw new RepositoryWriteError('C:\\secret\\installation.sqlite3')
        }

        const inserted = dependencies.installationRepository.insert(connection, input)

        if (failureStage === 'verification read') {
          throw new RepositoryWriteError('C:\\secret\\installation-verify.sqlite3')
        }

        return inserted
      }
    },
    localUserRepository: {
      ...dependencies.localUserRepository,
      insert(connection, input) {
        if (failureStage === 'administrator insert') {
          throw new RepositoryWriteError('C:\\secret\\administrator.sqlite3')
        }

        return dependencies.localUserRepository.insert(connection, input)
      }
    },
    locationRepository: {
      ...dependencies.locationRepository,
      insert(connection, input) {
        if (failureStage === 'location insert') {
          throw new RepositoryWriteError('C:\\secret\\location.sqlite3')
        }

        return dependencies.locationRepository.insert(connection, input)
      }
    },
    auditEventRepository: {
      ...dependencies.auditEventRepository,
      insert(connection, input) {
        auditInsertCount += 1

        if (
          (failureStage === 'installation audit insert' && auditInsertCount === 1) ||
          (failureStage === 'user audit insert' && auditInsertCount === 2) ||
          (failureStage === 'location audit insert' && auditInsertCount === 3)
        ) {
          throw new AuditEventAlreadyExistsError('C:\\secret\\audit.sqlite3')
        }

        return dependencies.auditEventRepository.insert(connection, input)
      }
    }
  }
}

interface CountingEntityIdGenerator extends EntityIdGenerator {
  readonly calls: number
}

interface CountingUtcClock extends UtcClock {
  readonly calls: number
}

interface CountingTransactionExecutor extends DatabaseTransactionExecutor {
  readonly calls: number
}

function createQueuedIdGenerator(ids: readonly string[]): CountingEntityIdGenerator {
  let calls = 0

  return {
    get calls(): number {
      return calls
    },
    generate(): EntityId {
      const value = ids[calls]
      calls += 1

      if (value === undefined) {
        throw new Error('C:\\secret\\id-provider.txt')
      }

      return parseEntityId(value)
    }
  }
}

function createFixedClock(options: { fail?: boolean } = {}): CountingUtcClock {
  let calls = 0

  return {
    get calls(): number {
      return calls
    },
    now(): UtcTimestamp {
      calls += 1

      if (options.fail === true) {
        throw new Error('C:\\secret\\clock-provider.txt')
      }

      return parseUtcTimestamp(bootstrapTimestamp)
    }
  }
}

function createCountingTransactionExecutor(
  executor: DatabaseTransactionExecutor
): CountingTransactionExecutor {
  let calls = 0

  return {
    get calls(): number {
      return calls
    },
    run(work) {
      calls += 1
      return executor.run(work)
    }
  }
}

function createCountingPasswordService(): PasswordCredentialService & {
  readonly hash: ReturnType<typeof vi.fn<PasswordCredentialService['hash']>>
  readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
  readonly validateCredential: ReturnType<
    typeof vi.fn<PasswordCredentialService['validateCredential']>
  >
} {
  const service = createPasswordCredentialService(createDeterministicCryptoProvider())

  return {
    validateCredential: vi.fn((credential) => service.validateCredential(credential)),
    hash: vi.fn((password) => service.hash(password)),
    verify: vi.fn((password, credential) => service.verify(password, credential))
  }
}

function createDeterministicCryptoProvider(): PasswordCryptoProvider {
  return {
    async randomBytes(length) {
      return fixedBytes(length, 11)
    },
    async scrypt(password, _salt, keyLength) {
      const text = Buffer.from(password).toString('utf8')

      return fixedBytes(keyLength, text === temporarySecret ? 23 : 41)
    },
    timingSafeEqual(left, right) {
      return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0
    }
  }
}

function createDeterministicCredential(): StoredPasswordCredential {
  return createStoredPasswordCredential(fixedBytes(64, 23), fixedBytes(32, 11))
}

function createValidCommand(): Record<string, unknown> {
  return {
    deploymentName: 'Cameroon Pilot',
    timeZone: 'Africa/Douala',
    administrator: {
      username: 'Admin.User',
      displayName: 'Admin User',
      temporaryPassword: temporarySecret
    },
    initialLocation: {
      name: 'Central Church',
      locationType: 'CHURCH',
      village: 'Messa',
      subdivision: 'Yaounde I',
      region: 'Centre',
      directions: 'Opposite market gate.'
    }
  }
}

function insertRawInstallation(connection: Database.Database): void {
  connection
    .prepare(
      `
INSERT INTO installation (
  singleton_id,
  id,
  deployment_name,
  timezone,
  created_at,
  updated_at
) VALUES (1, ?, 'Existing Deployment', 'UTC', ?, ?);
`
    )
    .run(installationId, bootstrapTimestamp, bootstrapTimestamp)
}

function insertRawUser(connection: Database.Database): void {
  connection
    .prepare(
      `
INSERT INTO users (
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
) VALUES (?, 'Existing.User', 'existing.user', 'Existing User', 'hash', 'salt',
  'LOCAL_ADMIN', 1, 1, 0, NULL, NULL, ?, ?);
`
    )
    .run(administratorId, bootstrapTimestamp, bootstrapTimestamp)
}

function insertRawLocationWithoutUser(connection: Database.Database): void {
  connection.pragma('foreign_keys = OFF')
  try {
    connection
      .prepare(
        `
INSERT INTO locations (
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
) VALUES (?, 'Existing Location', 'existing location', 'CHURCH', NULL, NULL, NULL, NULL,
  1, ?, ?, ?, ?);
`
      )
      .run(locationId, administratorId, bootstrapTimestamp, administratorId, bootstrapTimestamp)
  } finally {
    connection.pragma('foreign_keys = ON')
  }
}

function readBootstrapCounts(connection: Database.Database): Record<string, number> {
  return {
    installation: readTableCount(connection, 'installation'),
    users: readTableCount(connection, 'users'),
    locations: readTableCount(connection, 'locations'),
    audit_log: readTableCount(connection, 'audit_log'),
    app_settings: readTableCount(connection, 'app_settings'),
    protocol_versions: readTableCount(connection, 'protocol_versions'),
    patients: readTableCount(connection, 'patients'),
    sync_outbox: readTableCount(connection, 'sync_outbox')
  }
}

function readRawInstallation(connection: Database.Database): unknown {
  return connection.prepare('SELECT * FROM installation').get()
}

function readRawUser(connection: Database.Database): unknown {
  return connection.prepare('SELECT * FROM users').get()
}

function readRawLocation(connection: Database.Database): unknown {
  return connection.prepare('SELECT * FROM locations').get()
}

function readRawAuditRows(connection: Database.Database): readonly unknown[] {
  return connection.prepare('SELECT * FROM audit_log ORDER BY rowid ASC').all()
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const result = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return result.count
}

function readUserVersion(connection: Database.Database): number {
  return connection.pragma('user_version', { simple: true }) as number
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}

function expectSafeFirstRunError(error: unknown): void {
  expect(error).not.toHaveProperty('cause')
  expect((error as Error).stack).toBeUndefined()

  const serialized = JSON.stringify(error)

  for (const unsafeFragment of [
    temporarySecret,
    installationId,
    administratorId,
    locationId,
    installationAuditId,
    userAuditId,
    locationAuditId,
    'Cameroon',
    'Africa/Douala',
    'Admin',
    'Central',
    'Messa',
    'Yaounde',
    'Centre',
    'Opposite',
    'bootstrap',
    'LOCAL_ADMIN',
    'INSTALLATION_INITIALIZED',
    'SELECT',
    'INSERT',
    'C:\\',
    'secret',
    'sqlite3'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

async function captureAsyncError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to reject')
}
