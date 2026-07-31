import { Buffer } from 'node:buffer'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createLocalAuthenticationSessionService,
  createLocalForcedPasswordChangeService,
  createLocalLoginAuthenticationService,
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionUnauthenticatedError
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
  type CreateLocalUserInput
} from '@main/database'
import { parseEntityId, type EntityId, type EntityIdGenerator } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import {
  createPasswordCredentialService,
  type PasswordCredentialService,
  type PasswordCryptoProvider
} from '@main/security'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const currentPassword = 'CurrentPassw0rd!'
const replacementPassword = 'ReplacementPassw0rd!'
const wrongPassword = 'WrongPassw0rd!'
const dummyPassword = 'LocalDummyPassw0rd!'
const createdAt = parseUtcTimestamp('2026-07-30T09:00:00.000Z')
const t0 = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const t5 = parseUtcTimestamp('2026-07-30T12:05:00.000Z')
const t15 = parseUtcTimestamp('2026-07-30T12:15:00.000Z')
const t12h = parseUtcTimestamp('2026-07-31T00:00:00.000Z')
const lockRetryAt = parseUtcTimestamp('2026-07-30T12:15:00.000Z')
const installationId = parseEntityId('11111111-1111-4111-8111-111111111111')
const userId = parseEntityId('22222222-2222-4222-8222-222222222222')
const userCredential = createStoredPasswordCredential(fixedBytes(64, 21), fixedBytes(32, 11))

describe('local authentication session service integration', () => {
  it('uses restricted forced-change context to promote first-run admin sessions', async () => {
    await withSessionDatabase(async ({ connection, service, passwordCredentialService }) => {
      const login = await service.login(createLoginCommand(currentPassword))

      expect(login).toMatchObject({
        status: 'PASSWORD_CHANGE_REQUIRED',
        session: {
          status: 'PASSWORD_CHANGE_REQUIRED',
          user: expect.objectContaining({
            id: userId,
            mustChangePassword: true
          }),
          expiresAt: t15
        }
      })

      const changed = await service.changeRequiredPassword({
        currentPassword,
        newPassword: replacementPassword,
        confirmNewPassword: replacementPassword
      })

      expect(changed).toMatchObject({
        status: 'ACTIVE',
        session: {
          status: 'ACTIVE',
          user: expect.objectContaining({
            id: userId,
            mustChangePassword: false
          })
        }
      })
      expect(readRawUser(connection)).toMatchObject({ must_change_password: 0 })
      expect(JSON.stringify(service.getSnapshot())).not.toContain('password_hash')
      expect(JSON.stringify(service.getSnapshot())).not.toContain('password_salt')

      service.logout()
      await expect(service.login(createLoginCommand(currentPassword))).resolves.toEqual({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      })
      await expect(service.login(createLoginCommand(replacementPassword))).resolves.toMatchObject({
        status: 'ACTIVE',
        session: {
          user: expect.objectContaining({ mustChangePassword: false })
        }
      })
      await expect(
        passwordCredentialService.verify(replacementPassword, readCredentialColumns(connection))
      ).resolves.toBe(true)
      expect(readRawAuditRows(connection).map((row) => row.action)).toContain(
        'LOCAL_PASSWORD_CHANGE_SUCCEEDED'
      )
    })
  })

  it('logs normal users directly into active state and preserves lockout behavior', async () => {
    await withSessionDatabase(
      async ({ connection, service }) => {
        await expect(service.login(createLoginCommand(wrongPassword))).resolves.toEqual({
          status: 'REJECTED',
          reason: 'INVALID_CREDENTIALS',
          retryAt: null
        })
        expect(service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 0 })

        for (let attempt = 0; attempt < 4; attempt += 1) {
          await service.login(createLoginCommand(wrongPassword))
        }

        expect(readRawUser(connection)).toMatchObject({
          failed_login_count: 5,
          locked_until: lockRetryAt
        })
        await expect(service.login(createLoginCommand(currentPassword))).resolves.toEqual({
          status: 'REJECTED',
          reason: 'ACCOUNT_LOCKED',
          retryAt: lockRetryAt
        })
        expect(service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 0 })
      },
      {
        mustChangePassword: false,
        role: 'NURSE'
      }
    )

    await withSessionDatabase(
      async ({ service }) => {
        await expect(service.login(createLoginCommand(currentPassword))).resolves.toMatchObject({
          status: 'ACTIVE',
          session: {
            status: 'ACTIVE',
            user: expect.objectContaining({
              role: 'NURSE',
              mustChangePassword: false
            })
          }
        })
      },
      {
        mustChangePassword: false,
        role: 'NURSE'
      }
    )
  })

  it('locks, rejects wrong unlock password, unlocks the same user, and authorizes by role', async () => {
    await withSessionDatabase(
      async ({ clock, service }) => {
        await service.login(createLoginCommand(currentPassword))
        expect(service.requireAnyRole(['TRAINED_SCREENER']).user.id).toBe(userId)
        expect(() => service.requireAnyRole(['LOCAL_ADMIN'])).toThrow(
          LocalSessionAuthorizationError
        )

        clock.set(t5)
        expect(service.lock()).toMatchObject({
          status: 'LOCKED',
          reason: 'MANUAL',
          lockedAt: t5
        })
        expect(() => service.requireActiveSession()).toThrow(LocalSessionLockedError)

        await expect(service.unlock({ password: wrongPassword })).resolves.toEqual({
          status: 'REJECTED',
          reason: 'INVALID_CREDENTIALS',
          retryAt: null
        })
        expect(service.getSnapshot()).toMatchObject({ status: 'LOCKED' })

        await expect(service.unlock({ password: currentPassword })).resolves.toMatchObject({
          status: 'ACTIVE',
          session: {
            status: 'ACTIVE',
            user: expect.objectContaining({ id: userId }),
            authenticatedAt: t5
          }
        })
      },
      {
        mustChangePassword: false,
        role: 'TRAINED_SCREENER'
      }
    )
  })

  it('lazily enforces idle, absolute, and provisional expiration without persisted sessions', async () => {
    await withSessionDatabase(
      async ({ clock, connection, databasePath, service }) => {
        await service.login(createLoginCommand(currentPassword))

        clock.set(t15)
        expect(service.getSnapshot()).toMatchObject({
          status: 'LOCKED',
          reason: 'IDLE_TIMEOUT',
          lockedAt: t15
        })

        clock.set(t12h)
        expect(service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 3 })
        expect(listSessionTables(connection)).toEqual([])

        const reopened = new Database(databasePath)
        try {
          configureHsd006Pragmas(reopened)
          expect(listSessionTables(reopened)).toEqual([])
        } finally {
          reopened.close()
        }
      },
      {
        mustChangePassword: false
      }
    )

    await withSessionDatabase(async ({ clock, service }) => {
      await service.login(createLoginCommand(currentPassword))

      clock.set(t15)
      expect(service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 2 })
      await expect(
        service.changeRequiredPassword({
          currentPassword,
          newPassword: replacementPassword,
          confirmNewPassword: replacementPassword
        })
      ).rejects.toBeInstanceOf(LocalSessionUnauthenticatedError)
    })
  })

  it('new service composition starts signed out even after a prior active service', async () => {
    await withSessionDatabase(
      async ({ clock, loginService, forcedPasswordChangeService, service }) => {
        await service.login(createLoginCommand(currentPassword))
        expect(service.getSnapshot()).toMatchObject({ status: 'ACTIVE' })

        const recreated = createLocalAuthenticationSessionService({
          loginService,
          forcedPasswordChangeService,
          clock
        })

        expect(recreated.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 0 })
      },
      {
        mustChangePassword: false
      }
    )
  })
})

interface MutableClock extends UtcClock {
  set(value: UtcTimestamp): void
}

interface WithSessionDatabaseOptions {
  readonly mustChangePassword?: boolean
  readonly role?: CreateLocalUserInput['role']
}

interface WithSessionDatabaseContext {
  readonly connection: Database.Database
  readonly databasePath: string
  readonly service: ReturnType<typeof createLocalAuthenticationSessionService>
  readonly loginService: ReturnType<typeof createLocalLoginAuthenticationService>
  readonly forcedPasswordChangeService: ReturnType<typeof createLocalForcedPasswordChangeService>
  readonly passwordCredentialService: PasswordCredentialService
  readonly clock: MutableClock
}

async function withSessionDatabase(
  test: (context: WithSessionDatabaseContext) => Promise<void> | void,
  options: WithSessionDatabaseOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd-021-local-session-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: { now: () => createdAt }
    })(connection)
    seedInstallationAndUser(connection, options)

    const clock = createMutableClock(t0)
    const passwordCredentialService = createPasswordCredentialService(
      createDeterministicCryptoProvider()
    )
    const dummyCredential = await passwordCredentialService.hash(dummyPassword)
    const installationRepository = createInstallationRepository(connection)
    const localUserRepository = createLocalUserRepository(connection)
    const auditEventRepository = createAuditEventRepository(connection)
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createSequentialEntityIdGenerator(),
      clock,
      logger: { error: vi.fn() }
    })
    const loginService = createLocalLoginAuthenticationService({
      installationRepository,
      localUserRepository,
      auditEventRepository,
      passwordCredentialService,
      transactionExecutor,
      clock,
      dummyCredential
    })
    const forcedPasswordChangeService = createLocalForcedPasswordChangeService({
      installationRepository,
      localUserRepository,
      auditEventRepository,
      passwordCredentialService,
      transactionExecutor,
      clock
    })
    const service = createLocalAuthenticationSessionService({
      loginService,
      forcedPasswordChangeService,
      clock
    })

    await test({
      connection,
      databasePath,
      service,
      loginService,
      forcedPasswordChangeService,
      passwordCredentialService,
      clock
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function seedInstallationAndUser(
  connection: Database.Database,
  options: WithSessionDatabaseOptions
): void {
  const installationRepository = createInstallationRepository(connection)
  const localUserRepository = createLocalUserRepository(connection)
  const executor = createDatabaseTransactionExecutor({
    connection,
    idGenerator: createSequentialEntityIdGenerator(),
    clock: createMutableClock(createdAt),
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
    localUserRepository.insert(context.connection, createLocalUserInput(options))
  })
}

function createLocalUserInput(options: WithSessionDatabaseOptions): CreateLocalUserInput {
  return Object.freeze({
    id: userId,
    username: parseUsernameIdentity('Admin.User').username,
    displayName: parseUserDisplayName('Admin User'),
    credential: userCredential,
    role: parseLocalUserRole(options.role ?? 'LOCAL_ADMIN'),
    mustChangePassword: options.mustChangePassword ?? true,
    createdAt,
    updatedAt: createdAt
  })
}

function createLoginCommand(password: string): Record<string, unknown> {
  return {
    username: 'Admin.User',
    password
  }
}

function createMutableClock(initialValue: UtcTimestamp): MutableClock {
  let current = initialValue

  return {
    now: () => current,
    set(value: UtcTimestamp) {
      current = value
    }
  }
}

function createSequentialEntityIdGenerator(): EntityIdGenerator {
  let index = 0

  return {
    generate(): EntityId {
      index += 1

      return parseEntityId(`aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`)
    }
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

function listSessionTables(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND (
           lower(name) = 'sessions'
           OR lower(name) LIKE '%auth%session%'
           OR lower(name) LIKE '%local%session%'
         )
       ORDER BY name`
    )
    .all() as Array<{ readonly name: string }>

  return rows.map((row) => row.name)
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_value, index) => (index + offset) % 256))
}
