import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createLocalLoginAuthenticationService,
  LocalLoginConcurrencyError,
  LocalLoginPersistenceError
} from '@main/application'
import {
  AuditEventAlreadyExistsError,
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocalUserRepository,
  createProductionDatabaseMigrationRunner,
  parseDeploymentName,
  parseIanaTimeZone,
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  RepositoryWriteError,
  type AuditEventRepository,
  type CreateLocalUserInput,
  type LocalUserRepository
} from '@main/database'
import { parseEntityId, type EntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import {
  createPasswordCredentialService,
  type PasswordCredentialService,
  type PasswordCryptoProvider
} from '@main/security'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const correctPassword = 'ValidPassw0rd!'
const wrongPassword = 'WrongPassw0rd!'
const createdAt = parseUtcTimestamp('2026-07-30T09:00:00.000Z')
const observationTime = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const secondObservationTime = parseUtcTimestamp('2026-07-30T12:00:00.500Z')
const transactionTime = parseUtcTimestamp('2026-07-30T12:01:00.000Z')
const secondTransactionTime = parseUtcTimestamp('2026-07-30T12:01:01.000Z')
const previousLoginAt = parseUtcTimestamp('2026-07-29T08:30:00.000Z')
const activeLockedUntil = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const expiredLockedUntil = parseUtcTimestamp('2026-07-30T11:00:00.000Z')
const fifthAttemptRetryAt = parseUtcTimestamp('2026-07-30T12:16:00.000Z')
const installationId = parseEntityId('11111111-1111-4111-8111-111111111111')
const userId = parseEntityId('22222222-2222-4222-8222-222222222222')
const auditId = parseEntityId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const secondAuditId = parseEntityId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
const userCredential = createStoredPasswordCredential(fixedBytes(64, 23), fixedBytes(32, 11))
const dummyCredential = createStoredPasswordCredential(fixedBytes(64, 51), fixedBytes(32, 17))

describe('local login authentication service integration', () => {
  it('commits successful login state and audit durably without returning credentials', async () => {
    await withLoginDatabase(async ({ connection, databasePath, service }) => {
      const credentialBefore = readCredentialColumns(connection)

      const result = await service.authenticate(createCommand(correctPassword))

      expect(result).toEqual({
        status: 'AUTHENTICATED',
        user: {
          id: userId,
          username: 'Admin.User',
          displayName: 'Admin User',
          role: 'LOCAL_ADMIN',
          isActive: true,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: transactionTime,
          createdAt,
          updatedAt: transactionTime
        }
      })
      expect(JSON.stringify(result)).not.toContain('passwordHash')
      expect(JSON.stringify(result)).not.toContain('passwordSalt')
      expect(readRawUser(connection)).toMatchObject({
        failed_login_count: 0,
        locked_until: null,
        last_login_at: transactionTime,
        updated_at: transactionTime
      })
      expect(readCredentialColumns(connection)).toEqual(credentialBefore)
      expect(readRawAuditRows(connection)).toEqual([
        {
          id: auditId,
          installation_id: installationId,
          user_id: userId,
          action: 'LOCAL_LOGIN_SUCCEEDED',
          entity_type: 'LOCAL_USER',
          entity_id: userId,
          occurred_at: transactionTime,
          metadata_json:
            '{"must_change_password":false,"outcome":"authenticated","role":"LOCAL_ADMIN"}'
        }
      ])
      expectAuditMetadataIsSafe(connection)

      const reopened = new Database(databasePath)
      try {
        configureHsd006Pragmas(reopened)
        expect(readRawUser(reopened)).toMatchObject({
          failed_login_count: 0,
          locked_until: null,
          last_login_at: transactionTime,
          updated_at: transactionTime
        })
        expect(readRawAuditRows(reopened)).toHaveLength(1)
      } finally {
        reopened.close()
      }
    })
  })

  it('commits wrong-password counter increments and invalid-credential audit events', async () => {
    await withLoginDatabase(async ({ connection, service }) => {
      const credentialBefore = readCredentialColumns(connection)

      await expect(service.authenticate(createCommand(wrongPassword))).resolves.toEqual({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      })

      expect(readRawUser(connection)).toMatchObject({
        failed_login_count: 1,
        locked_until: null,
        last_login_at: null,
        updated_at: transactionTime
      })
      expect(readCredentialColumns(connection)).toEqual(credentialBefore)
      expect(readRawAuditRows(connection)[0]).toMatchObject({
        user_id: null,
        action: 'LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS',
        entity_type: 'LOCAL_USER',
        entity_id: userId,
        metadata_json:
          '{"failed_login_count":1,"outcome":"invalid_credentials","user_resolved":true}'
      })
      expectAuditMetadataIsSafe(connection)
    })
  })

  it('applies the exact fifth-attempt lock and locked audit event', async () => {
    await withLoginDatabase(
      async ({ connection, service }) => {
        const credentialBefore = readCredentialColumns(connection)

        await expect(service.authenticate(createCommand(wrongPassword))).resolves.toEqual({
          status: 'REJECTED',
          reason: 'ACCOUNT_LOCKED',
          retryAt: fifthAttemptRetryAt
        })

        expect(readRawUser(connection)).toMatchObject({
          failed_login_count: 5,
          locked_until: fifthAttemptRetryAt,
          last_login_at: previousLoginAt,
          updated_at: transactionTime
        })
        expect(readCredentialColumns(connection)).toEqual(credentialBefore)
        expect(readRawAuditRows(connection)[0]).toMatchObject({
          action: 'LOCAL_LOGIN_REJECTED_ACCOUNT_LOCKED',
          metadata_json:
            '{"failed_login_count":5,"lock_applied":true,"outcome":"account_locked","retry_at":"2026-07-30T12:16:00.000Z"}'
        })
        expectAuditMetadataIsSafe(connection)
      },
      {
        initialState: {
          failedLoginCount: 4,
          lockedUntil: null,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        }
      }
    )
  })

  it('preserves active locks, advances updatedAt, and skips verification', async () => {
    await withLoginDatabase(
      async ({ connection, service, passwordCredentialService }) => {
        await expect(service.authenticate(createCommand(correctPassword))).resolves.toEqual({
          status: 'REJECTED',
          reason: 'ACCOUNT_LOCKED',
          retryAt: activeLockedUntil
        })

        expect(passwordCredentialService.verify).not.toHaveBeenCalled()
        expect(readRawUser(connection)).toMatchObject({
          failed_login_count: 5,
          locked_until: activeLockedUntil,
          last_login_at: previousLoginAt,
          updated_at: transactionTime
        })
        expect(readRawAuditRows(connection)[0]).toMatchObject({
          action: 'LOCAL_LOGIN_REJECTED_ACCOUNT_LOCKED',
          metadata_json:
            '{"failed_login_count":5,"lock_applied":false,"outcome":"account_locked","retry_at":"2026-07-30T12:10:00.000Z"}'
        })
      },
      {
        initialState: {
          failedLoginCount: 5,
          lockedUntil: activeLockedUntil,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        }
      }
    )
  })

  it('restarts expired locks on wrong passwords and clears them on correct passwords', async () => {
    await withLoginDatabase(
      async ({ connection, service }) => {
        await expect(service.authenticate(createCommand(wrongPassword))).resolves.toMatchObject({
          status: 'REJECTED',
          reason: 'INVALID_CREDENTIALS'
        })
        expect(readRawUser(connection)).toMatchObject({
          failed_login_count: 1,
          locked_until: null,
          last_login_at: previousLoginAt,
          updated_at: transactionTime
        })
      },
      {
        initialState: {
          failedLoginCount: 5,
          lockedUntil: expiredLockedUntil,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        }
      }
    )

    await withLoginDatabase(
      async ({ connection, service }) => {
        await expect(service.authenticate(createCommand(correctPassword))).resolves.toMatchObject({
          status: 'AUTHENTICATED',
          user: expect.objectContaining({
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: transactionTime
          })
        })
        expect(readRawUser(connection)).toMatchObject({
          failed_login_count: 0,
          locked_until: null,
          last_login_at: transactionTime,
          updated_at: transactionTime
        })
      },
      {
        initialState: {
          failedLoginCount: 5,
          lockedUntil: expiredLockedUntil,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        }
      }
    )
  })

  it('audits inactive and unknown-user rejections without authentication-state mutation', async () => {
    await withLoginDatabase(
      async ({ connection, service }) => {
        const before = readRawUser(connection)

        await expect(service.authenticate(createCommand(correctPassword))).resolves.toEqual({
          status: 'REJECTED',
          reason: 'ACCOUNT_INACTIVE',
          retryAt: null
        })

        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)[0]).toMatchObject({
          action: 'LOCAL_LOGIN_REJECTED_ACCOUNT_INACTIVE',
          user_id: null,
          entity_type: 'LOCAL_USER',
          entity_id: userId,
          metadata_json: '{"outcome":"account_inactive"}'
        })
      },
      { isActive: false }
    )

    await withLoginDatabase(async ({ connection, service }) => {
      const before = readRawUser(connection)

      await expect(
        service.authenticate({ username: 'Missing.User', password: wrongPassword })
      ).resolves.toEqual({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      })

      expect(readRawUser(connection)).toEqual(before)
      expect(readRawAuditRows(connection)[0]).toMatchObject({
        action: 'LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS',
        user_id: null,
        entity_type: 'AUTHENTICATION',
        entity_id: null,
        metadata_json: '{"outcome":"invalid_credentials","user_resolved":false}'
      })
    })
  })

  it('rolls back state when audit, state update, or commit fails', async () => {
    await withLoginDatabase(
      async ({ connection, service }) => {
        const before = readRawUser(connection)

        await expect(service.authenticate(createCommand(wrongPassword))).rejects.toBeInstanceOf(
          LocalLoginPersistenceError
        )
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([])
      },
      {
        initialState: {
          failedLoginCount: 4,
          lockedUntil: null,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        },
        wrapAuditEventRepository: (repository) => ({
          ...repository,
          insert() {
            throw new AuditEventAlreadyExistsError('SqliteError')
          }
        })
      }
    )

    await withLoginDatabase(
      async ({ connection, service }) => {
        const before = readRawUser(connection)

        await expect(service.authenticate(createCommand(wrongPassword))).rejects.toBeInstanceOf(
          LocalLoginPersistenceError
        )
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([])
      },
      {
        wrapLocalUserRepository: (repository) => ({
          ...repository,
          updateAuthenticationState() {
            throw new RepositoryWriteError('SqliteError')
          }
        })
      }
    )

    await withLoginDatabase(
      async ({ connection, service }) => {
        const before = readRawUser(connection)

        await expect(service.authenticate(createCommand(correctPassword))).rejects.toBeInstanceOf(
          LocalLoginPersistenceError
        )
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([])
      },
      { failCommit: true }
    )
  })

  it('prevents two stale attempts based on the same expected state from both committing', async () => {
    const deferredPasswordService = createDeferredPasswordService()

    await withLoginDatabase(
      async ({ connection, service }) => {
        const first = service.authenticate(createCommand(wrongPassword))
        const second = service.authenticate(createCommand(wrongPassword))
        await Promise.resolve()

        expect(deferredPasswordService.deferredVerifications).toHaveLength(2)
        deferredPasswordService.deferredVerifications[0]?.resolve(false)
        await expect(first).resolves.toMatchObject({
          status: 'REJECTED',
          reason: 'INVALID_CREDENTIALS'
        })
        deferredPasswordService.deferredVerifications[1]?.resolve(false)
        await expect(second).rejects.toBeInstanceOf(LocalLoginConcurrencyError)

        expect(readRawUser(connection)).toMatchObject({
          failed_login_count: 1,
          locked_until: null,
          updated_at: transactionTime
        })
        expect(readRawAuditRows(connection)).toHaveLength(1)
      },
      {
        passwordCredentialService: deferredPasswordService.service,
        clock: createQueuedClock([
          observationTime,
          secondObservationTime,
          transactionTime,
          secondTransactionTime
        ]),
        idGenerator: createQueuedIdGenerator([auditId, secondAuditId])
      }
    )
  })
})

interface AuthenticationStateOverride {
  readonly failedLoginCount: number
  readonly lockedUntil: UtcTimestamp | null
  readonly lastLoginAt: UtcTimestamp | null
  readonly updatedAt: UtcTimestamp
}

interface WithLoginDatabaseOptions {
  readonly initialState?: AuthenticationStateOverride
  readonly isActive?: boolean
  readonly passwordCredentialService?: PasswordCredentialService
  readonly clock?: UtcClock
  readonly idGenerator?: EntityIdGenerator
  readonly wrapLocalUserRepository?: (repository: LocalUserRepository) => LocalUserRepository
  readonly wrapAuditEventRepository?: (repository: AuditEventRepository) => AuditEventRepository
  readonly failCommit?: boolean
}

interface WithLoginDatabaseContext {
  readonly connection: Database.Database
  readonly databasePath: string
  readonly service: ReturnType<typeof createLocalLoginAuthenticationService>
  readonly passwordCredentialService: PasswordCredentialService & {
    readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
  }
}

async function withLoginDatabase(
  test: (context: WithLoginDatabaseContext) => Promise<void> | void,
  options: WithLoginDatabaseOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-018-login-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: { now: () => createdAt }
    })(connection)
    seedInstallationAndUser(connection)

    if (options.initialState !== undefined) {
      updateRawAuthenticationState(connection, options.initialState)
    }

    if (options.isActive === false) {
      connection.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId)
    }

    const passwordCredentialService =
      options.passwordCredentialService ?? createCountingPasswordService()
    const clock = options.clock ?? createQueuedClock([observationTime, transactionTime])
    const idGenerator = options.idGenerator ?? createQueuedIdGenerator([auditId, secondAuditId])
    const baseLocalUserRepository = createLocalUserRepository(connection)
    const baseAuditEventRepository = createAuditEventRepository(connection)
    const localUserRepository = options.wrapLocalUserRepository
      ? options.wrapLocalUserRepository(baseLocalUserRepository)
      : baseLocalUserRepository
    const auditEventRepository = options.wrapAuditEventRepository
      ? options.wrapAuditEventRepository(baseAuditEventRepository)
      : baseAuditEventRepository
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator,
      clock,
      logger: { error: vi.fn() }
    })
    const service = createLocalLoginAuthenticationService({
      installationRepository: createInstallationRepository(connection),
      localUserRepository,
      auditEventRepository,
      passwordCredentialService,
      transactionExecutor,
      clock,
      dummyCredential
    })
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
        passwordCredentialService:
          passwordCredentialService as WithLoginDatabaseContext['passwordCredentialService']
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

function seedInstallationAndUser(connection: Database.Database): void {
  const installationRepository = createInstallationRepository(connection)
  const localUserRepository = createLocalUserRepository(connection)
  const executor = createDatabaseTransactionExecutor({
    connection,
    idGenerator: createQueuedIdGenerator([]),
    clock: createQueuedClock([createdAt]),
    logger: { error: vi.fn() }
  })

  executor.run((context) => {
    installationRepository.insert(context.connection, {
      id: installationId,
      deploymentName: parseDeploymentName('Cameroon Pilot'),
      timeZone: parseIanaTimeZone('UTC'),
      createdAt,
      updatedAt: createdAt
    })
    localUserRepository.insert(context.connection, createLocalUserInput())
  })
}

function createLocalUserInput(): CreateLocalUserInput {
  return Object.freeze({
    id: userId,
    username: parseUsernameIdentity('Admin.User').username,
    displayName: parseUserDisplayName('Admin User'),
    credential: userCredential,
    role: parseLocalUserRole('LOCAL_ADMIN'),
    mustChangePassword: false,
    createdAt,
    updatedAt: createdAt
  })
}

function createCommand(password: string): Record<string, unknown> {
  return {
    username: 'Admin.User',
    password
  }
}

function createCountingPasswordService(): PasswordCredentialService & {
  readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
} {
  const service = createPasswordCredentialService(createDeterministicCryptoProvider())

  return {
    hash: vi.fn((password) => service.hash(password)),
    verify: vi.fn((password, credential) => service.verify(password, credential))
  }
}

function createDeferredPasswordService(): {
  readonly service: PasswordCredentialService
  readonly deferredVerifications: readonly Deferred<boolean>[]
} {
  const deferredVerifications: Deferred<boolean>[] = []

  return {
    service: {
      hash: vi.fn(),
      verify: vi.fn(() => {
        const deferred = createDeferred<boolean>()
        deferredVerifications.push(deferred)

        return deferred.promise
      })
    },
    deferredVerifications
  }
}

function createDeterministicCryptoProvider(): PasswordCryptoProvider {
  return {
    async randomBytes(length) {
      return fixedBytes(length, 11)
    },
    async scrypt(password, _salt, keyLength) {
      const text = Buffer.from(password).toString('utf8')

      return fixedBytes(keyLength, text === correctPassword ? 23 : 41)
    },
    timingSafeEqual(left, right) {
      return Buffer.compare(Buffer.from(left), Buffer.from(right)) === 0
    }
  }
}

function createQueuedClock(values: readonly UtcTimestamp[]): UtcClock {
  let index = 0

  return {
    now(): UtcTimestamp {
      const value = values[index]
      index += 1

      if (value === undefined) {
        throw new Error('C:\\secret\\clock.txt')
      }

      return value
    }
  }
}

function createQueuedIdGenerator(ids: readonly EntityId[]): EntityIdGenerator {
  let index = 0

  return {
    generate(): EntityId {
      const value = ids[index]
      index += 1

      if (value === undefined) {
        throw new Error('C:\\secret\\id.txt')
      }

      return value
    }
  }
}

function updateRawAuthenticationState(
  connection: Database.Database,
  state: AuthenticationStateOverride
): void {
  connection
    .prepare(
      `UPDATE users
       SET failed_login_count = ?,
           locked_until = ?,
           last_login_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
    .run(state.failedLoginCount, state.lockedUntil, state.lastLoginAt, state.updatedAt, userId)
}

function readRawUser(connection: Database.Database): Record<string, unknown> | undefined {
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
    .get(userId) as Record<string, unknown> | undefined
}

function readCredentialColumns(connection: Database.Database): {
  readonly password_hash: unknown
  readonly password_salt: unknown
} {
  return connection
    .prepare(
      `SELECT password_hash, password_salt
       FROM users
       WHERE id = ?`
    )
    .get(userId) as { readonly password_hash: unknown; readonly password_salt: unknown }
}

function readRawAuditRows(connection: Database.Database): readonly Record<string, unknown>[] {
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
      ORDER BY rowid ASC`
    )
    .all() as readonly Record<string, unknown>[]
}

function expectAuditMetadataIsSafe(connection: Database.Database): void {
  const serialized = JSON.stringify(readRawAuditRows(connection).map((row) => row.metadata_json))

  for (const unsafeFragment of [
    correctPassword,
    wrongPassword,
    'Admin.User',
    'Admin User',
    'password_hash',
    'password_salt',
    userCredential.passwordHash,
    userCredential.passwordSalt,
    'SELECT',
    'UPDATE',
    'C:\\',
    'secret',
    'sqlite3'
  ]) {
    expect(serialized).not.toContain(unsafeFragment)
  }
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}
