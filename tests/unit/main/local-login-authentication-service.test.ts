import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'

import {
  createLocalLoginAuthenticationService,
  LocalLoginConcurrencyError,
  LocalLoginPersistenceError,
  LocalLoginVerificationError
} from '@main/application/authentication'
import {
  AuditEventAlreadyExistsError,
  DatabaseTransactionExecutionError,
  parseUserDisplayName,
  parseUsernameIdentity,
  RepositoryWriteError,
  type AuditEventRecord,
  type AuditEventRepository,
  type CreateAuditEventInput,
  type DatabaseTransactionConnection,
  type DatabaseTransactionContext,
  type DatabaseTransactionExecutor,
  type InstallationRecord,
  type InstallationRepository,
  type LocalUserAuthenticationRecord,
  type LocalUserRecord,
  type LocalUserRepository,
  type UpdateLocalUserAuthenticationStateInput
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcClock } from '@main/foundation/utc-clock'
import {
  PasswordVerificationError,
  type PasswordCredentialService,
  type StoredPasswordCredential
} from '@main/security'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'

const password = 'ValidPassw0rd!'
const observationTime = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const transactionTime = parseUtcTimestamp('2026-07-30T12:01:00.000Z')
const activeLockedUntil = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const expiringLockedUntil = parseUtcTimestamp('2026-07-30T12:00:30.000Z')
const expiredLockedUntil = parseUtcTimestamp('2026-07-30T11:50:00.000Z')
const expiredLockUpdatedAt = parseUtcTimestamp('2026-07-30T11:35:00.000Z')
const fifthAttemptRetryAt = parseUtcTimestamp('2026-07-30T12:16:00.000Z')
const installationId = parseEntityId('11111111-1111-4111-8111-111111111111')
const otherInstallationId = parseEntityId('99999999-9999-4999-8999-999999999999')
const userId = parseEntityId('22222222-2222-4222-8222-222222222222')
const otherUserId = parseEntityId('33333333-3333-4333-8333-333333333333')
const auditId = parseEntityId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const credential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))
const changedCredential = createStoredPasswordCredential(fixedBytes(64, 3), fixedBytes(32, 4))
const dummyCredential = createStoredPasswordCredential(fixedBytes(64, 5), fixedBytes(32, 6))

describe('local login authentication service', () => {
  it('uses dummy verification and writes identifier-free audit for unknown usernames', async () => {
    const harness = createHarness({
      observedAuthentication: null,
      transactionAuthentication: null,
      verifyResult: true
    })

    await expect(harness.service.authenticate(createCommand())).resolves.toEqual({
      status: 'REJECTED',
      reason: 'INVALID_CREDENTIALS',
      retryAt: null
    })

    expect(harness.passwordCredentialService.verify).toHaveBeenCalledWith(password, dummyCredential)
    expect(harness.localUserRepository.updateAuthenticationState).not.toHaveBeenCalled()
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        userId: null,
        action: 'LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS',
        entityType: 'AUTHENTICATION',
        entityId: null,
        metadata: {
          outcome: 'invalid_credentials',
          user_resolved: false
        }
      })
    ])
  })

  it('fails stale unknown-username observations when the user appears before finalization', async () => {
    const harness = createHarness({
      observedAuthentication: null,
      transactionAuthentication: createAuthenticationRecord(),
      verifyResult: false
    })

    await expect(harness.service.authenticate(createCommand())).rejects.toBeInstanceOf(
      LocalLoginConcurrencyError
    )
    expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
    expect(harness.localUserRepository.updateAuthenticationState).not.toHaveBeenCalled()
  })

  it('increments wrong-password state and audits resolved invalid credentials', async () => {
    const authentication = createAuthenticationRecord({ failedLoginCount: 2 })
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication,
      verifyResult: false
    })

    await expect(harness.service.authenticate(createCommand())).resolves.toEqual({
      status: 'REJECTED',
      reason: 'INVALID_CREDENTIALS',
      retryAt: null
    })

    expect(harness.updates).toEqual([
      expect.objectContaining({
        id: userId,
        expected: expect.objectContaining({ failedLoginCount: 2, lockedUntil: null }),
        next: expect.objectContaining({
          failedLoginCount: 3,
          lockedUntil: null,
          lastLoginAt: null,
          updatedAt: transactionTime
        })
      })
    ])
    expect(harness.auditEvents[0]).toMatchObject({
      userId: null,
      action: 'LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS',
      entityType: 'LOCAL_USER',
      entityId: userId,
      metadata: {
        outcome: 'invalid_credentials',
        user_resolved: true,
        failed_login_count: 3
      }
    })
  })

  it('applies the fifth-attempt lock and returns retryAt', async () => {
    const authentication = createAuthenticationRecord({ failedLoginCount: 4 })
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication,
      verifyResult: false
    })

    await expect(harness.service.authenticate(createCommand())).resolves.toEqual({
      status: 'REJECTED',
      reason: 'ACCOUNT_LOCKED',
      retryAt: fifthAttemptRetryAt
    })
    expect(harness.updates[0]?.next).toEqual({
      failedLoginCount: 5,
      lockedUntil: fifthAttemptRetryAt,
      lastLoginAt: null,
      updatedAt: transactionTime
    })
    expect(harness.auditEvents[0]?.metadata).toEqual({
      outcome: 'account_locked',
      failed_login_count: 5,
      lock_applied: true,
      retry_at: fifthAttemptRetryAt
    })
  })

  it('starts a new failed cycle after an expired lock', async () => {
    const authentication = createAuthenticationRecord({
      failedLoginCount: 5,
      lockedUntil: expiredLockedUntil,
      updatedAt: expiredLockUpdatedAt
    })
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication,
      verifyResult: false
    })

    await expect(harness.service.authenticate(createCommand())).resolves.toMatchObject({
      status: 'REJECTED',
      reason: 'INVALID_CREDENTIALS',
      retryAt: null
    })
    expect(harness.updates[0]?.next).toMatchObject({
      failedLoginCount: 1,
      lockedUntil: null,
      updatedAt: transactionTime
    })
  })

  it('returns credential-free authenticated users after state reset and success audit', async () => {
    const authentication = createAuthenticationRecord({
      failedLoginCount: 3,
      mustChangePassword: true,
      role: 'LOCAL_ADMIN'
    })
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication,
      verifyResult: true
    })

    const result = await harness.service.authenticate(createCommand())

    expect(result).toEqual({
      status: 'AUTHENTICATED',
      user: {
        ...authentication.user,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: transactionTime,
        updatedAt: transactionTime
      }
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.status === 'AUTHENTICATED' && Object.isFrozen(result.user)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('passwordHash')
    expect(JSON.stringify(result)).not.toContain('passwordSalt')
    expect(harness.auditEvents[0]).toMatchObject({
      userId,
      action: 'LOCAL_LOGIN_SUCCEEDED',
      entityType: 'LOCAL_USER',
      entityId: userId,
      metadata: {
        outcome: 'authenticated',
        must_change_password: true,
        role: 'LOCAL_ADMIN'
      }
    })
  })

  it('rejects inactive accounts without state mutation after real verification', async () => {
    for (const testCase of [
      {
        verifyResult: true,
        reason: 'ACCOUNT_INACTIVE',
        action: 'LOCAL_LOGIN_REJECTED_ACCOUNT_INACTIVE',
        metadata: { outcome: 'account_inactive' }
      },
      {
        verifyResult: false,
        reason: 'INVALID_CREDENTIALS',
        action: 'LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS',
        metadata: {
          outcome: 'invalid_credentials',
          user_resolved: true,
          failed_login_count: 0
        }
      }
    ] as const) {
      const authentication = createAuthenticationRecord({ isActive: false })
      const harness = createHarness({
        observedAuthentication: authentication,
        transactionAuthentication: authentication,
        verifyResult: testCase.verifyResult
      })

      await expect(harness.service.authenticate(createCommand())).resolves.toEqual({
        status: 'REJECTED',
        reason: testCase.reason,
        retryAt: null
      })
      expect(harness.localUserRepository.updateAuthenticationState).not.toHaveBeenCalled()
      expect(harness.auditEvents[0]).toMatchObject({
        action: testCase.action,
        userId: null,
        entityType: 'LOCAL_USER',
        entityId: userId,
        metadata: testCase.metadata
      })
    }
  })

  it('skips verification under active lock and never extends lockedUntil', async () => {
    const authentication = createAuthenticationRecord({
      failedLoginCount: 5,
      lockedUntil: activeLockedUntil
    })
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication,
      verifyResult: true
    })

    await expect(harness.service.authenticate(createCommand())).resolves.toEqual({
      status: 'REJECTED',
      reason: 'ACCOUNT_LOCKED',
      retryAt: activeLockedUntil
    })
    expect(harness.passwordCredentialService.verify).not.toHaveBeenCalled()
    expect(harness.updates[0]?.next).toEqual({
      failedLoginCount: 5,
      lockedUntil: activeLockedUntil,
      lastLoginAt: null,
      updatedAt: transactionTime
    })
    expect(harness.auditEvents[0]?.metadata).toEqual({
      outcome: 'account_locked',
      failed_login_count: 5,
      lock_applied: false,
      retry_at: activeLockedUntil
    })
  })

  it('fails safely when an observed active lock expires before finalization', async () => {
    const authentication = createAuthenticationRecord({
      failedLoginCount: 5,
      lockedUntil: expiringLockedUntil
    })
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication
    })

    await expect(harness.service.authenticate(createCommand())).rejects.toBeInstanceOf(
      LocalLoginConcurrencyError
    )
    expect(harness.passwordCredentialService.verify).not.toHaveBeenCalled()
    expect(harness.localUserRepository.updateAuthenticationState).not.toHaveBeenCalled()
    expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
  })

  it('detects transaction-time installation, credential, activation, identity, and state changes', async () => {
    const observed = createAuthenticationRecord({ failedLoginCount: 1 })

    for (const testCase of [
      {
        name: 'installation',
        options: {
          transactionInstallation: createInstallation(otherInstallationId),
          transactionAuthentication: observed
        }
      },
      {
        name: 'user id',
        options: {
          transactionAuthentication: createAuthenticationRecord({
            id: otherUserId,
            failedLoginCount: 1
          })
        }
      },
      {
        name: 'canonical username',
        options: {
          transactionAuthentication: createAuthenticationRecord({
            username: parseUsernameIdentity('Other.User').username,
            failedLoginCount: 1
          })
        }
      },
      {
        name: 'credential',
        options: {
          transactionAuthentication: createAuthenticationRecord({
            credential: changedCredential,
            failedLoginCount: 1
          })
        }
      },
      {
        name: 'activation',
        options: {
          transactionAuthentication: createAuthenticationRecord({
            isActive: false,
            failedLoginCount: 1
          })
        }
      },
      {
        name: 'authentication state',
        options: {
          transactionAuthentication: createAuthenticationRecord({ failedLoginCount: 2 })
        }
      }
    ] as const) {
      const harness = createHarness({
        observedAuthentication: observed,
        verifyResult: true,
        ...testCase.options
      })

      await expect(
        harness.service.authenticate(createCommand()),
        testCase.name
      ).rejects.toBeInstanceOf(LocalLoginConcurrencyError)
      expect(harness.localUserRepository.updateAuthenticationState).not.toHaveBeenCalled()
      expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
    }
  })

  it('contains verification, mutation, audit, and transaction failures behind controlled errors', async () => {
    const authentication = createAuthenticationRecord()
    const cases = [
      {
        name: 'verification',
        options: {
          verifyError: new PasswordVerificationError('Error')
        },
        expected: LocalLoginVerificationError
      },
      {
        name: 'state mutation',
        options: {
          updateError: new RepositoryWriteError('SqliteError')
        },
        expected: LocalLoginPersistenceError
      },
      {
        name: 'audit',
        options: {
          auditError: new AuditEventAlreadyExistsError('SqliteError')
        },
        expected: LocalLoginPersistenceError
      },
      {
        name: 'transaction',
        options: {
          transactionError: new DatabaseTransactionExecutionError('SqliteError')
        },
        expected: LocalLoginPersistenceError
      }
    ] as const

    for (const testCase of cases) {
      const harness = createHarness({
        observedAuthentication: authentication,
        transactionAuthentication: authentication,
        verifyResult: true,
        ...testCase.options
      })

      await expect(
        harness.service.authenticate(createCommand()),
        testCase.name
      ).rejects.toBeInstanceOf(testCase.expected)
    }
  })

  it('uses a synchronous transaction callback and returns no result before commit', async () => {
    const authentication = createAuthenticationRecord()
    const harness = createHarness({
      observedAuthentication: authentication,
      transactionAuthentication: authentication,
      verifyResult: true
    })
    let settled = false
    const attempt = harness.service.authenticate(createCommand())
    attempt.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    await expect(attempt).resolves.toMatchObject({ status: 'AUTHENTICATED' })
    expect(harness.transactionCallbackReturnedPromise).toBe(false)
    expect(harness.promiseSettledBeforeCommit).toBe(false)
    expect(settled).toBe(true)
  })
})

interface HarnessOptions {
  readonly installation?: InstallationRecord | null
  readonly transactionInstallation?: InstallationRecord | null
  readonly observedAuthentication?: LocalUserAuthenticationRecord | null
  readonly transactionAuthentication?: LocalUserAuthenticationRecord | null
  readonly verifyResult?: boolean
  readonly verifyError?: unknown
  readonly updateError?: unknown
  readonly auditError?: unknown
  readonly transactionError?: unknown
}

interface Harness {
  readonly service: ReturnType<typeof createLocalLoginAuthenticationService>
  readonly installationRepository: InstallationRepository & {
    readonly get: ReturnType<typeof vi.fn<InstallationRepository['get']>>
  }
  readonly localUserRepository: LocalUserRepository & {
    readonly getAuthenticationByUsername: ReturnType<
      typeof vi.fn<LocalUserRepository['getAuthenticationByUsername']>
    >
    readonly updateAuthenticationState: ReturnType<
      typeof vi.fn<LocalUserRepository['updateAuthenticationState']>
    >
  }
  readonly auditEventRepository: AuditEventRepository & {
    readonly insert: ReturnType<typeof vi.fn<AuditEventRepository['insert']>>
  }
  readonly passwordCredentialService: PasswordCredentialService & {
    readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
  }
  readonly updates: readonly UpdateLocalUserAuthenticationStateInput[]
  readonly auditEvents: readonly CreateAuditEventInput[]
  readonly transactionCallbackReturnedPromise: boolean
  readonly promiseSettledBeforeCommit: boolean
}

function createHarness(options: HarnessOptions = {}): Harness {
  const installation =
    options.installation === undefined ? createInstallation() : options.installation
  const transactionInstallation =
    options.transactionInstallation === undefined ? installation : options.transactionInstallation
  const observedAuthentication =
    options.observedAuthentication === undefined
      ? createAuthenticationRecord()
      : options.observedAuthentication
  const transactionAuthentication =
    options.transactionAuthentication === undefined
      ? observedAuthentication
      : options.transactionAuthentication
  const updates: UpdateLocalUserAuthenticationStateInput[] = []
  const auditEvents: CreateAuditEventInput[] = []
  const transactionState = {
    callbackReturnedPromise: false,
    promiseSettledBeforeCommit: false
  }
  let installationReads = 0
  let authenticationReads = 0
  let promiseSettled = false

  const installationRepository = {
    get: vi.fn(() => {
      const value = installationReads === 0 ? installation : transactionInstallation
      installationReads += 1

      return value
    }),
    getState: vi.fn(),
    insert: vi.fn()
  } as unknown as Harness['installationRepository']
  const localUserRepository = {
    hasAny: vi.fn(),
    getById: vi.fn(),
    getByUsername: vi.fn(),
    getAuthenticationByUsername: vi.fn(() => {
      const value = authenticationReads === 0 ? observedAuthentication : transactionAuthentication
      authenticationReads += 1

      return value
    }),
    insert: vi.fn(),
    updateAuthenticationState: vi.fn((_connection, input) => {
      if (options.updateError !== undefined) {
        throw options.updateError
      }

      updates.push(input)
      const baseUser = transactionAuthentication?.user ?? observedAuthentication?.user

      if (baseUser === undefined) {
        throw new RepositoryWriteError()
      }

      return freezeUserRecord({
        ...baseUser,
        failedLoginCount: input.next.failedLoginCount,
        lockedUntil: input.next.lockedUntil,
        lastLoginAt: input.next.lastLoginAt,
        updatedAt: input.next.updatedAt
      })
    })
  } as unknown as Harness['localUserRepository']
  const auditEventRepository = {
    getById: vi.fn(),
    listRecent: vi.fn(),
    listForEntity: vi.fn(),
    insert: vi.fn((_connection, input) => {
      if (options.auditError !== undefined) {
        throw options.auditError
      }

      auditEvents.push(input)
      return Object.freeze({
        id: input.id,
        installationId: input.installationId,
        userId: input.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        occurredAt: input.occurredAt,
        metadata: input.metadata
      }) as AuditEventRecord
    })
  } as unknown as Harness['auditEventRepository']
  const passwordCredentialService = {
    validateCredential: vi.fn((credential) => credential),
    hash: vi.fn(),
    verify: vi.fn(async () => {
      if (options.verifyError !== undefined) {
        throw options.verifyError
      }

      return options.verifyResult ?? true
    })
  } as unknown as Harness['passwordCredentialService']
  const transactionExecutor = {
    run: vi.fn((work) => {
      if (options.transactionError !== undefined) {
        throw options.transactionError
      }

      const result = work(createTransactionContext())
      transactionState.callbackReturnedPromise = isThenable(result)
      transactionState.promiseSettledBeforeCommit = promiseSettled

      return result
    })
  } as unknown as DatabaseTransactionExecutor
  const clock = {
    now: vi.fn(() => observationTime)
  } as unknown as UtcClock
  const service = createLocalLoginAuthenticationService({
    installationRepository,
    localUserRepository,
    auditEventRepository,
    passwordCredentialService,
    transactionExecutor,
    clock,
    dummyCredential
  })

  const originalAuthenticate = service.authenticate
  const instrumentedService = Object.freeze({
    authenticate(input: unknown) {
      const promise = originalAuthenticate(input)
      promise.then(
        () => {
          promiseSettled = true
        },
        () => {
          promiseSettled = true
        }
      )

      return promise
    }
  })

  return {
    service: instrumentedService,
    installationRepository,
    localUserRepository,
    auditEventRepository,
    passwordCredentialService,
    updates,
    auditEvents,
    get transactionCallbackReturnedPromise(): boolean {
      return transactionState.callbackReturnedPromise
    },
    get promiseSettledBeforeCommit(): boolean {
      return transactionState.promiseSettledBeforeCommit
    }
  }
}

function createTransactionContext(): DatabaseTransactionContext {
  return Object.freeze({
    connection: {} as DatabaseTransactionConnection,
    newEntityId: () => auditId,
    nowUtc: () => transactionTime
  })
}

function createCommand(): Record<string, unknown> {
  return {
    username: 'Admin.User',
    password
  }
}

function createInstallation(id: EntityId = installationId): InstallationRecord {
  return Object.freeze({
    id,
    deploymentName: 'Cameroon Pilot' as InstallationRecord['deploymentName'],
    timeZone: 'UTC' as InstallationRecord['timeZone'],
    createdAt: observationTime,
    updatedAt: observationTime
  })
}

function createAuthenticationRecord(
  override: Partial<LocalUserRecord> & {
    readonly credential?: StoredPasswordCredential
  } = {}
): LocalUserAuthenticationRecord {
  const { credential: nextCredential = credential, ...userOverride } = override

  return Object.freeze({
    user: createUser(userOverride),
    credential: nextCredential
  })
}

function createUser(override: Partial<LocalUserRecord> = {}): LocalUserRecord {
  const username = parseUsernameIdentity(override.username ?? 'Admin.User').username

  return freezeUserRecord({
    id: override.id ?? userId,
    username,
    displayName: override.displayName ?? parseUserDisplayName('Admin User'),
    role: override.role ?? 'LOCAL_ADMIN',
    isActive: override.isActive ?? true,
    mustChangePassword: override.mustChangePassword ?? false,
    failedLoginCount: override.failedLoginCount ?? 0,
    lockedUntil: override.lockedUntil ?? null,
    lastLoginAt: override.lastLoginAt ?? null,
    createdAt: override.createdAt ?? observationTime,
    updatedAt: override.updatedAt ?? observationTime
  })
}

function freezeUserRecord(user: LocalUserRecord): LocalUserRecord {
  return Object.freeze({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  })
}

function isThenable(value: unknown): boolean {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  )
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}
