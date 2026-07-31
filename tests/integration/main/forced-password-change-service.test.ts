import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createLocalForcedPasswordChangeService,
  LocalForcedPasswordChangeConcurrencyError,
  LocalForcedPasswordChangePersistenceError
} from '@main/application'
import {
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
  type PasswordCryptoProvider,
  type StoredPasswordCredential
} from '@main/security'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const currentPassword = 'CurrentPassw0rd!'
const replacementPassword = 'ReplacementPassw0rd!'
const wrongPassword = 'WrongPassw0rd!'
const createdAt = parseUtcTimestamp('2026-07-30T09:00:00.000Z')
const observationTime = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const transactionTime = parseUtcTimestamp('2026-07-30T12:01:00.000Z')
const activeLockedUntil = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const expiredLockedUntil = parseUtcTimestamp('2026-07-30T11:00:00.000Z')
const fifthAttemptRetryAt = parseUtcTimestamp('2026-07-30T12:16:00.000Z')
const previousLoginAt = parseUtcTimestamp('2026-07-29T08:30:00.000Z')
const installationId = parseEntityId('11111111-1111-4111-8111-111111111111')
const userId = parseEntityId('22222222-2222-4222-8222-222222222222')
const auditId = parseEntityId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const secondAuditId = parseEntityId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
const userCredential = createStoredPasswordCredential(fixedBytes(64, 21), fixedBytes(32, 11))
const externallyRotatedCredential = createStoredPasswordCredential(
  fixedBytes(64, 61),
  fixedBytes(32, 71)
)

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

describe('forced password change service integration', () => {
  it('changes a temporary password durably and invalidates the old credential', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, databasePath, service, passwordCredentialService }) => {
        updateRawAuthenticationState(connection, {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        })
        const before = readCredentialColumns(connection)

        await expect(passwordCredentialService.verify(currentPassword, before)).resolves.toBe(true)

        const result = await service.changePassword(createCommand())

        expect(result).toEqual({
          status: 'PASSWORD_CHANGED',
          user: {
            id: userId,
            username: 'Admin.User',
            displayName: 'Admin User',
            role: 'LOCAL_ADMIN',
            isActive: true,
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: previousLoginAt,
            createdAt,
            updatedAt: transactionTime
          }
        })
        expect(Object.isFrozen(result)).toBe(true)
        expect(result.status === 'PASSWORD_CHANGED' && Object.isFrozen(result.user)).toBe(true)
        expect(JSON.stringify(result)).not.toContain('passwordHash')
        expect(JSON.stringify(result)).not.toContain('passwordSalt')
        expect(readRawUser(connection)).toMatchObject({
          must_change_password: 0,
          failed_login_count: 0,
          locked_until: null,
          last_login_at: previousLoginAt,
          updated_at: transactionTime
        })

        const after = readCredentialColumns(connection)
        expect(after).not.toEqual(before)
        await expect(passwordCredentialService.verify(currentPassword, after)).resolves.toBe(false)
        await expect(passwordCredentialService.verify(replacementPassword, after)).resolves.toBe(
          true
        )
        expect(readRawAuditRows(connection)).toEqual([
          expect.objectContaining({
            user_id: userId,
            action: 'LOCAL_PASSWORD_CHANGE_SUCCEEDED',
            entity_type: 'LOCAL_USER',
            entity_id: userId,
            occurred_at: transactionTime,
            metadata_json: JSON.stringify({
              forced_change_completed: true,
              outcome: 'password_changed',
              role: 'LOCAL_ADMIN'
            })
          })
        ])
        expectAuditArtifactsAreSafe(connection)

        const reopened = new Database(databasePath)
        try {
          configureHsd006Pragmas(reopened)
          await expect(
            passwordCredentialService.verify(replacementPassword, readCredentialColumns(reopened))
          ).resolves.toBe(true)
        } finally {
          reopened.close()
        }
      }
    )
  })

  it('clears an expired lock and rotates the credential in one transaction', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        updateRawAuthenticationState(connection, {
          failedLoginCount: 5,
          lockedUntil: expiredLockedUntil,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        })

        const result = await service.changePassword(createCommand())

        expect(result).toMatchObject({
          status: 'PASSWORD_CHANGED',
          user: {
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
            lastLoginAt: previousLoginAt,
            updatedAt: transactionTime
          }
        })
        expect(readRawUser(connection)).toMatchObject({
          must_change_password: 0,
          failed_login_count: 0,
          locked_until: null,
          last_login_at: previousLoginAt,
          updated_at: transactionTime
        })
        expect(readRawAuditRows(connection)).toHaveLength(1)
      },
      {
        clock: createQueuedClock([observationTime, transactionTime])
      }
    )
  })

  it('rejects active locks without verification or hashing and does not extend retryAt', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, service, passwordCredentialService }) => {
        updateRawAuthenticationState(connection, {
          failedLoginCount: 5,
          lockedUntil: activeLockedUntil,
          lastLoginAt: previousLoginAt,
          updatedAt: createdAt
        })
        const before = readCredentialColumns(connection)

        const result = await service.changePassword(createCommand())

        expect(result).toEqual({
          status: 'REJECTED',
          reason: 'ACCOUNT_LOCKED',
          retryAt: activeLockedUntil
        })
        expect(passwordCredentialService.verify).not.toHaveBeenCalled()
        expect(passwordCredentialService.hash).not.toHaveBeenCalled()
        expect(readCredentialColumns(connection)).toEqual(before)
        expect(readRawUser(connection)).toMatchObject({
          must_change_password: 1,
          failed_login_count: 5,
          locked_until: activeLockedUntil,
          last_login_at: previousLoginAt,
          updated_at: transactionTime
        })
        expect(readRawAuditRows(connection)).toEqual([
          expect.objectContaining({
            user_id: null,
            action: 'LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_LOCKED',
            metadata_json: JSON.stringify({
              failed_login_count: 5,
              lock_applied: false,
              outcome: 'account_locked',
              retry_at: activeLockedUntil
            })
          })
        ])
      },
      {
        clock: createQueuedClock([observationTime, transactionTime])
      }
    )
  })

  it('locks the account on the fifth invalid current password proof', async () => {
    await withForcedPasswordChangeDatabase(async ({ connection, service }) => {
      updateRawAuthenticationState(connection, {
        failedLoginCount: 4,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt: createdAt
      })
      const before = readCredentialColumns(connection)

      const result = await service.changePassword(createCommand({ currentPassword: wrongPassword }))

      expect(result).toEqual({
        status: 'REJECTED',
        reason: 'ACCOUNT_LOCKED',
        retryAt: fifthAttemptRetryAt
      })
      expect(readCredentialColumns(connection)).toEqual(before)
      expect(readRawUser(connection)).toMatchObject({
        must_change_password: 1,
        failed_login_count: 5,
        locked_until: fifthAttemptRetryAt,
        last_login_at: previousLoginAt,
        updated_at: transactionTime
      })
      expect(readRawAuditRows(connection)).toEqual([
        expect.objectContaining({
          user_id: null,
          action: 'LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_LOCKED',
          metadata_json: JSON.stringify({
            failed_login_count: 5,
            lock_applied: true,
            outcome: 'account_locked',
            retry_at: fifthAttemptRetryAt
          })
        })
      ])
    })
  })

  it('audits ineligible correct-password outcomes without changing state or credentials', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        connection.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId)
        const before = readRawUser(connection)

        const result = await service.changePassword(createCommand())

        expect(result).toEqual({
          status: 'REJECTED',
          reason: 'ACCOUNT_INACTIVE',
          retryAt: null
        })
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([
          expect.objectContaining({
            user_id: null,
            action: 'LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_INACTIVE',
            metadata_json: JSON.stringify({ outcome: 'account_inactive' })
          })
        ])
      },
      {
        clock: createQueuedClock([observationTime, transactionTime])
      }
    )

    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        connection.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(userId)
        const before = readRawUser(connection)

        const result = await service.changePassword(createCommand())

        expect(result).toEqual({
          status: 'REJECTED',
          reason: 'PASSWORD_CHANGE_NOT_REQUIRED',
          retryAt: null
        })
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([
          expect.objectContaining({
            user_id: userId,
            action: 'LOCAL_PASSWORD_CHANGE_REJECTED_NOT_REQUIRED',
            metadata_json: JSON.stringify({ outcome: 'not_required' })
          })
        ])
      },
      {
        clock: createQueuedClock([observationTime, transactionTime])
      }
    )

    await withForcedPasswordChangeDatabase(
      async ({ connection, service, passwordCredentialService }) => {
        const before = readRawUser(connection)

        const result = await service.changePassword(
          createCommand({
            newPassword: currentPassword,
            confirmNewPassword: currentPassword
          })
        )

        expect(result).toEqual({
          status: 'REJECTED',
          reason: 'NEW_PASSWORD_REUSES_CURRENT_PASSWORD',
          retryAt: null
        })
        expect(passwordCredentialService.hash).not.toHaveBeenCalled()
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([
          expect.objectContaining({
            user_id: userId,
            action: 'LOCAL_PASSWORD_CHANGE_REJECTED_REUSED_PASSWORD',
            metadata_json: JSON.stringify({ outcome: 'reused_password' })
          })
        ])
      }
    )
  })

  it('audits wrong current password on an inactive account without state mutation', async () => {
    await withForcedPasswordChangeDatabase(async ({ connection, service }) => {
      connection.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId)
      const before = readRawUser(connection)

      const result = await service.changePassword(createCommand({ currentPassword: wrongPassword }))

      expect(result).toEqual({
        status: 'REJECTED',
        reason: 'CURRENT_PASSWORD_INVALID',
        retryAt: null
      })
      expect(readRawUser(connection)).toEqual(before)
      expect(readRawAuditRows(connection)).toEqual([
        expect.objectContaining({
          user_id: null,
          action: 'LOCAL_PASSWORD_CHANGE_REJECTED_INVALID_CURRENT_PASSWORD',
          metadata_json: JSON.stringify({
            failed_login_count: 0,
            outcome: 'invalid_current_password'
          })
        })
      ])
    })
  })

  it('rolls back authentication reset and credential rotation when audit insertion fails', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        const before = readRawUser(connection)

        const error = await captureAsyncError(() => service.changePassword(createCommand()))

        expect(error).toBeInstanceOf(LocalForcedPasswordChangePersistenceError)
        expect(readRawUser(connection)).toEqual(before)
        expect(readRawAuditRows(connection)).toEqual([])
      },
      {
        wrapAuditEventRepository(repository) {
          return {
            ...repository,
            insert() {
              throw new RepositoryWriteError('RepositoryWriteError')
            }
          }
        }
      }
    )
  })

  it('does not rotate credentials or audit when authentication-state update fails', async () => {
    let credentialUpdateAttempts = 0

    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        const beforeUser = readRawUser(connection)
        const beforeCredential = readCredentialColumns(connection)

        const error = await captureAsyncError(() => service.changePassword(createCommand()))

        expect(error).toBeInstanceOf(LocalForcedPasswordChangePersistenceError)
        expect(credentialUpdateAttempts).toBe(0)
        expect(readRawUser(connection)).toEqual(beforeUser)
        expect(readCredentialColumns(connection)).toEqual(beforeCredential)
        expect(readRawAuditRows(connection)).toEqual([])
      },
      {
        wrapLocalUserRepository(repository) {
          return {
            ...repository,
            updateAuthenticationState() {
              throw new RepositoryWriteError('RepositoryWriteError')
            },
            updateCredentialState(connection, input) {
              credentialUpdateAttempts += 1

              return repository.updateCredentialState(connection, input)
            }
          }
        }
      }
    )
  })

  it('rolls back the authentication reset when credential rotation fails', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        const beforeUser = readRawUser(connection)
        const beforeCredential = readCredentialColumns(connection)

        const error = await captureAsyncError(() => service.changePassword(createCommand()))

        expect(error).toBeInstanceOf(LocalForcedPasswordChangePersistenceError)
        expect(readRawUser(connection)).toEqual(beforeUser)
        expect(readCredentialColumns(connection)).toEqual(beforeCredential)
        expect(readRawAuditRows(connection)).toEqual([])
      },
      {
        wrapLocalUserRepository(repository) {
          return {
            ...repository,
            updateCredentialState() {
              throw new RepositoryWriteError('RepositoryWriteError')
            }
          }
        }
      }
    )
  })

  it('preserves the old credential and mustChangePassword flag when commit fails', async () => {
    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        const beforeUser = readRawUser(connection)
        const beforeCredential = readCredentialColumns(connection)

        const error = await captureAsyncError(() => service.changePassword(createCommand()))

        expect(error).toBeInstanceOf(LocalForcedPasswordChangePersistenceError)
        expect(readRawUser(connection)).toEqual(beforeUser)
        expect(readCredentialColumns(connection)).toEqual(beforeCredential)
        expect(readRawUser(connection)).toMatchObject({ must_change_password: 1 })
        expect(readRawAuditRows(connection)).toEqual([])
      },
      {
        wrapTransactionConnection(connection) {
          return createTransactionConnectionProxy(connection, { failCommit: true })
        }
      }
    )
  })

  it('prevents two attempts based on the same observed credential from both committing', async () => {
    const firstCurrentPasswordVerification = createDeferred<void>()
    const secondCurrentPasswordVerification = createDeferred<void>()
    const bothAttemptsObservedCredential = createDeferred<void>()
    let currentPasswordVerificationCount = 0

    await withForcedPasswordChangeDatabase(
      async ({ connection, service }) => {
        const firstAttempt = service.changePassword(createCommand())
        const secondAttempt = service.changePassword(createCommand())

        await bothAttemptsObservedCredential.promise
        firstCurrentPasswordVerification.resolve()

        const firstResult = await firstAttempt

        expect(firstResult).toMatchObject({
          status: 'PASSWORD_CHANGED',
          user: {
            mustChangePassword: false,
            updatedAt: transactionTime
          }
        })

        secondCurrentPasswordVerification.resolve()

        const secondError = await captureAsyncError(() => secondAttempt)

        expect(secondError).toBeInstanceOf(LocalForcedPasswordChangeConcurrencyError)
        expect(readRawAuditRows(connection)).toHaveLength(1)
        expect(readRawUser(connection)).toMatchObject({
          must_change_password: 0,
          updated_at: transactionTime
        })
      },
      {
        clock: createQueuedClock([
          observationTime,
          observationTime,
          transactionTime,
          transactionTime
        ]),
        wrapPasswordCredentialService(service) {
          return {
            validateCredential: vi.fn((credential) => service.validateCredential(credential)),
            hash: vi.fn((password) => service.hash(password)),
            verify: vi.fn(async (password, credential) => {
              if (password === currentPassword && credentialsEqual(credential, userCredential)) {
                currentPasswordVerificationCount += 1

                if (currentPasswordVerificationCount === 2) {
                  bothAttemptsObservedCredential.resolve()
                }

                await (currentPasswordVerificationCount === 1
                  ? firstCurrentPasswordVerification.promise
                  : secondCurrentPasswordVerification.promise)
              }

              return service.verify(password, credential)
            })
          }
        }
      }
    )
  })

  it.each([
    {
      field: 'credential',
      mutate: (connection: Database.Database) =>
        updateRawCredential(connection, externallyRotatedCredential)
    },
    {
      field: 'username',
      mutate: (connection: Database.Database) => {
        const changedIdentity = parseUsernameIdentity('Changed.User')
        connection
          .prepare('UPDATE users SET username = ?, username_normalized = ? WHERE id = ?')
          .run(changedIdentity.username, changedIdentity.usernameNormalized, userId)
      }
    },
    {
      field: 'role',
      mutate: (connection: Database.Database) =>
        connection
          .prepare('UPDATE users SET role = ? WHERE id = ?')
          .run(parseLocalUserRole('NURSE'), userId)
    },
    {
      field: 'isActive',
      mutate: (connection: Database.Database) =>
        connection.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId)
    },
    {
      field: 'mustChangePassword',
      mutate: (connection: Database.Database) =>
        connection.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(userId)
    },
    {
      field: 'failedLoginCount',
      mutate: (connection: Database.Database) =>
        connection.prepare('UPDATE users SET failed_login_count = 1 WHERE id = ?').run(userId)
    },
    {
      field: 'lockedUntil',
      mutate: (connection: Database.Database) =>
        connection
          .prepare('UPDATE users SET locked_until = ? WHERE id = ?')
          .run(activeLockedUntil, userId)
    },
    {
      field: 'lastLoginAt',
      mutate: (connection: Database.Database) =>
        connection
          .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
          .run(previousLoginAt, userId)
    },
    {
      field: 'updatedAt',
      mutate: (connection: Database.Database) =>
        connection
          .prepare('UPDATE users SET updated_at = ? WHERE id = ?')
          .run(transactionTime, userId)
    }
  ])(
    'raises a concurrency error when $field changes before the transaction',
    async ({ mutate }) => {
      let mutationApplied = false

      await withForcedPasswordChangeDatabase(
        async ({ connection, service }) => {
          const error = await captureAsyncError(() => service.changePassword(createCommand()))

          expect(mutationApplied).toBe(true)
          expect(error).toBeInstanceOf(LocalForcedPasswordChangeConcurrencyError)
          expect(readRawAuditRows(connection)).toEqual([])
        },
        {
          wrapPasswordCredentialService(service, connection) {
            return {
              validateCredential: vi.fn((credential) => service.validateCredential(credential)),
              hash: vi.fn(async (password) => {
                const replacement = await service.hash(password)

                if (!mutationApplied) {
                  mutate(connection)
                  mutationApplied = true
                }

                return replacement
              }),
              verify: vi.fn((password, credential) => service.verify(password, credential))
            }
          }
        }
      )
    }
  )

  it('does not expose a successful result before commit completes', async () => {
    let commitObserved = false
    let resultExposed = false

    await withForcedPasswordChangeDatabase(
      async ({ service }) => {
        const changePassword = service.changePassword(createCommand()).then((result) => {
          resultExposed = true

          return result
        })

        const result = await changePassword

        expect(result).toMatchObject({ status: 'PASSWORD_CHANGED' })
        expect(commitObserved).toBe(true)
      },
      {
        wrapTransactionConnection(connection) {
          return createTransactionConnectionProxy(connection, {
            onCommit() {
              commitObserved = true
              expect(resultExposed).toBe(false)
            }
          })
        }
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

interface WithForcedPasswordChangeDatabaseOptions {
  readonly clock?: UtcClock
  readonly idGenerator?: EntityIdGenerator
  readonly wrapPasswordCredentialService?: (
    service: TestPasswordCredentialService,
    connection: Database.Database
  ) => TestPasswordCredentialService
  readonly wrapTransactionConnection?: (connection: Database.Database) => Database.Database
  readonly wrapLocalUserRepository?: (repository: LocalUserRepository) => LocalUserRepository
  readonly wrapAuditEventRepository?: (repository: AuditEventRepository) => AuditEventRepository
}

type TestPasswordCredentialService = PasswordCredentialService & {
  readonly hash: ReturnType<typeof vi.fn<PasswordCredentialService['hash']>>
  readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
  readonly validateCredential: ReturnType<
    typeof vi.fn<PasswordCredentialService['validateCredential']>
  >
}

interface WithForcedPasswordChangeDatabaseContext {
  readonly connection: Database.Database
  readonly databasePath: string
  readonly service: ReturnType<typeof createLocalForcedPasswordChangeService>
  readonly passwordCredentialService: TestPasswordCredentialService
}

async function withForcedPasswordChangeDatabase(
  test: (context: WithForcedPasswordChangeDatabaseContext) => Promise<void> | void,
  options: WithForcedPasswordChangeDatabaseOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-020-forced-password-change-'))
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

    const basePasswordCredentialService = createCountingPasswordService()
    const passwordCredentialService = options.wrapPasswordCredentialService
      ? options.wrapPasswordCredentialService(basePasswordCredentialService, connection)
      : basePasswordCredentialService
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
      connection: options.wrapTransactionConnection
        ? options.wrapTransactionConnection(connection)
        : connection,
      idGenerator,
      clock,
      logger: { error: vi.fn() }
    })
    const service = createLocalForcedPasswordChangeService({
      installationRepository: createInstallationRepository(connection),
      localUserRepository,
      auditEventRepository,
      passwordCredentialService,
      transactionExecutor,
      clock
    })

    await test({
      connection,
      databasePath,
      service,
      passwordCredentialService
    })
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
    mustChangePassword: true,
    createdAt,
    updatedAt: createdAt
  })
}

function createCommand(
  override: Partial<{
    currentPassword: string
    newPassword: string
    confirmNewPassword: string
  }> = {}
): Record<string, unknown> {
  return {
    userId,
    currentPassword,
    newPassword: replacementPassword,
    confirmNewPassword: replacementPassword,
    ...override
  }
}

function createCountingPasswordService(): TestPasswordCredentialService {
  const service = createPasswordCredentialService(createDeterministicCryptoProvider())

  return {
    validateCredential: vi.fn((credential) => service.validateCredential(credential)),
    hash: vi.fn((password) => service.hash(password)),
    verify: vi.fn((password, credential) => service.verify(password, credential))
  }
}

function createTransactionConnectionProxy(
  connection: Database.Database,
  options: {
    readonly failCommit?: boolean
    readonly onCommit?: () => void
  }
): Database.Database {
  const wrappedConnection = {
    get open(): boolean {
      return connection.open
    },
    get inTransaction(): boolean {
      return connection.inTransaction
    },
    prepare: connection.prepare.bind(connection),
    exec(source: string) {
      if (source === 'COMMIT') {
        options.onCommit?.()

        if (options.failCommit === true) {
          throw new Error('C:\\secret\\commit.sqlite3')
        }
      }

      connection.exec(source)

      return wrappedConnection
    }
  }

  return wrappedConnection as unknown as Database.Database
}

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve
  })

  return {
    promise,
    resolve: resolveDeferred
  }
}

function createDeterministicCryptoProvider(): PasswordCryptoProvider {
  return {
    async randomBytes(length) {
      return fixedBytes(length, 17)
    },
    async scrypt(password, _salt, keyLength) {
      const text = Buffer.from(password).toString('utf8')

      if (text === currentPassword) {
        return fixedBytes(keyLength, 21)
      }

      if (text === replacementPassword) {
        return fixedBytes(keyLength, 37)
      }

      return fixedBytes(keyLength, 53)
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

function updateRawCredential(
  connection: Database.Database,
  credential: StoredPasswordCredential
): void {
  connection
    .prepare(
      `UPDATE users
       SET password_hash = ?,
           password_salt = ?
       WHERE id = ?`
    )
    .run(credential.passwordHash, credential.passwordSalt, userId)
}

function credentialsEqual(value: unknown, credential: StoredPasswordCredential): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<StoredPasswordCredential>

  return (
    candidate.passwordHash === credential.passwordHash &&
    candidate.passwordSalt === credential.passwordSalt
  )
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
  readonly passwordHash: unknown
  readonly passwordSalt: unknown
} {
  const row = connection
    .prepare(
      `SELECT password_hash, password_salt
       FROM users
       WHERE id = ?`
    )
    .get(userId) as { readonly password_hash: unknown; readonly password_salt: unknown }

  return {
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt
  }
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

function expectAuditArtifactsAreSafe(connection: Database.Database): void {
  const serialized = JSON.stringify(readRawAuditRows(connection))

  for (const unsafeFragment of [
    currentPassword,
    replacementPassword,
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

async function captureAsyncError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
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
