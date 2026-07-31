import { describe, expect, it, vi } from 'vitest'

import {
  createLocalForcedPasswordChangeService,
  LocalForcedPasswordChangeHashingError,
  type LocalForcedPasswordChangeService,
  type LocalForcedPasswordChangeServiceDependencies
} from '@main/application'
import type {
  AuditEventRecord,
  CreateAuditEventInput,
  DatabaseTransactionContext,
  InstallationRecord,
  LocalUserRecord
} from '@main/database'
import { parseEntityId, parseUtcTimestamp } from '@main/foundation'
import { createStoredPasswordCredential } from '@main/security/password/password-credential-format'
import { PasswordCredentialFormatError } from '@main/security'
import type { PasswordCredentialService, StoredPasswordCredential } from '@main/security'

const userId = parseEntityId('11111111-1111-4111-8111-111111111111')
const auditId = parseEntityId('22222222-2222-4222-8222-222222222222')
const installationId = parseEntityId('33333333-3333-4333-8333-333333333333')
const createdAt = parseUtcTimestamp('2026-07-30T09:00:00.000Z')
const observationTime = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const transactionTime = parseUtcTimestamp('2026-07-30T12:01:00.000Z')
const activeLockedUntil = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const previousLoginAt = parseUtcTimestamp('2026-07-29T08:00:00.000Z')
const currentPassword = 'CurrentPassw0rd!'
const newPassword = 'ReplacementPassw0rd!'
const credential = createStoredPasswordCredential(fixedBytes(64, 1), fixedBytes(32, 2))
const replacementCredential = createStoredPasswordCredential(fixedBytes(64, 3), fixedBytes(32, 4))

describe('forced password change service', () => {
  it('returns confirmation mismatch before dependency calls', async () => {
    const harness = createHarness()

    const result = await harness.service.changePassword({
      userId,
      currentPassword,
      newPassword,
      confirmNewPassword: 'DifferentPassw0rd!'
    })

    expect(result).toEqual({
      status: 'REJECTED',
      reason: 'NEW_PASSWORD_CONFIRMATION_MISMATCH',
      retryAt: null
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(harness.installationRepository.get).not.toHaveBeenCalled()
    expect(harness.localUserRepository.getById).not.toHaveBeenCalled()
    expect(harness.passwordCredentialService.verify).not.toHaveBeenCalled()
    expect(harness.passwordCredentialService.hash).not.toHaveBeenCalled()
    expect(harness.transactionExecutor.run).not.toHaveBeenCalled()
  })

  it('active lock skips verification and hashing while preserving the lock', async () => {
    const lockedUser = createUser({
      failedLoginCount: 5,
      lockedUntil: activeLockedUntil
    })
    const harness = createHarness({ user: lockedUser })

    const result = await harness.service.changePassword(createCommand())

    expect(result).toEqual({
      status: 'REJECTED',
      reason: 'ACCOUNT_LOCKED',
      retryAt: activeLockedUntil
    })
    expect(harness.passwordCredentialService.verify).not.toHaveBeenCalled()
    expect(harness.passwordCredentialService.hash).not.toHaveBeenCalled()
    expect(harness.localUserRepository.updateCredentialState).not.toHaveBeenCalled()
    expect(harness.localUserRepository.updateAuthenticationState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        next: expect.objectContaining({
          failedLoginCount: 5,
          lockedUntil: activeLockedUntil,
          lastLoginAt: previousLoginAt,
          updatedAt: transactionTime
        })
      })
    )
    expect(harness.auditEventRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: null,
        action: 'LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_LOCKED',
        metadata: expect.objectContaining({
          lock_applied: false,
          retry_at: activeLockedUntil
        })
      })
    )
  })

  it('rejects when hash returns the existing credential without opening a transaction', async () => {
    const passwordCredentialService = createMockPasswordCredentialService({
      hashCredential: credential,
      verifyResults: [true, false]
    })
    const harness = createHarness({ passwordCredentialService })

    const error = await captureAsyncError(() => harness.service.changePassword(createCommand()))

    expect(error).toBeInstanceOf(LocalForcedPasswordChangeHashingError)
    expect(passwordCredentialService.verify).toHaveBeenCalledTimes(2)
    expect(passwordCredentialService.hash).toHaveBeenCalledOnce()
    expect(passwordCredentialService.validateCredential).toHaveBeenCalledOnce()
    expectNoTransactionOrAudit(harness)
  })

  it('rejects when the replacement credential does not verify the new password', async () => {
    const passwordCredentialService = createMockPasswordCredentialService({
      verifyResults: [true, false, false]
    })
    const harness = createHarness({ passwordCredentialService })

    const error = await captureAsyncError(() => harness.service.changePassword(createCommand()))

    expect(error).toBeInstanceOf(LocalForcedPasswordChangeHashingError)
    expect(passwordCredentialService.verify).toHaveBeenCalledTimes(3)
    expect(passwordCredentialService.hash).toHaveBeenCalledOnce()
    expect(passwordCredentialService.validateCredential).toHaveBeenCalledOnce()
    expectNoTransactionOrAudit(harness)
  })

  it('rejects when the replacement credential still verifies the current password', async () => {
    const passwordCredentialService = createMockPasswordCredentialService({
      verifyResults: [true, false, true, true]
    })
    const harness = createHarness({ passwordCredentialService })

    const error = await captureAsyncError(() => harness.service.changePassword(createCommand()))

    expect(error).toBeInstanceOf(LocalForcedPasswordChangeHashingError)
    expect(passwordCredentialService.verify).toHaveBeenCalledTimes(4)
    expect(passwordCredentialService.hash).toHaveBeenCalledOnce()
    expect(passwordCredentialService.validateCredential).toHaveBeenCalledOnce()
    expectNoTransactionOrAudit(harness)
  })

  it('rejects malformed replacement credentials without opening a transaction', async () => {
    const passwordCredentialService = createMockPasswordCredentialService({
      hashCredential: Object.freeze({
        passwordHash: 'not-a-password-hash',
        passwordSalt: 'not-a-password-salt'
      }) as StoredPasswordCredential,
      validateCredentialError: new PasswordCredentialFormatError('PasswordCredentialFormatError'),
      verifyResults: [true, false]
    })
    const harness = createHarness({ passwordCredentialService })

    const error = await captureAsyncError(() => harness.service.changePassword(createCommand()))

    expect(error).toBeInstanceOf(LocalForcedPasswordChangeHashingError)
    expect(passwordCredentialService.verify).toHaveBeenCalledTimes(2)
    expect(passwordCredentialService.hash).toHaveBeenCalledOnce()
    expect(passwordCredentialService.validateCredential).toHaveBeenCalledOnce()
    expectNoTransactionOrAudit(harness)
  })

  it('valid distinct replacement verifies before writing state, credential, and audit', async () => {
    const order: string[] = []
    const harness = createHarness({ order })

    const result = await harness.service.changePassword(createCommand())

    expect(result).toMatchObject({
      status: 'PASSWORD_CHANGED',
      user: {
        id: userId,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: previousLoginAt,
        updatedAt: transactionTime
      }
    })
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.status === 'PASSWORD_CHANGED' && Object.isFrozen(result.user)).toBe(true)
    expect(order).toEqual([
      'verify-current',
      'verify-reuse',
      'hash-new',
      'validate-replacement',
      'verify-replacement-new',
      'verify-replacement-current',
      'transaction',
      'update-authentication-state',
      'update-credential-state',
      'audit'
    ])
    expect(harness.localUserRepository.updateCredentialState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        expected: expect.objectContaining({
          credential,
          mustChangePassword: true,
          updatedAt: transactionTime
        }),
        next: expect.objectContaining({
          credential: replacementCredential,
          mustChangePassword: false,
          updatedAt: transactionTime
        })
      })
    )
    expect(harness.auditEventRepository.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId,
        action: 'LOCAL_PASSWORD_CHANGE_SUCCEEDED',
        metadata: expect.objectContaining({
          forced_change_completed: true,
          outcome: 'password_changed',
          role: 'LOCAL_ADMIN'
        })
      })
    )
  })
})

interface HarnessOptions {
  readonly user?: LocalUserRecord
  readonly order?: string[]
  readonly passwordCredentialService?: PasswordCredentialService
}

interface Harness extends LocalForcedPasswordChangeServiceDependencies {
  readonly service: LocalForcedPasswordChangeService
}

function createHarness({
  user = createUser(),
  order = [],
  passwordCredentialService = createMockPasswordCredentialService({ order })
}: HarnessOptions = {}): Harness {
  let currentUser = user

  const installationRepository = {
    get: vi.fn(() => createInstallation()),
    getState: vi.fn(),
    insert: vi.fn()
  }
  const localUserRepository = {
    hasAny: vi.fn(),
    getById: vi.fn(() => currentUser),
    getByUsername: vi.fn(),
    getAuthenticationByUsername: vi.fn(() => ({
      user: currentUser,
      credential
    })),
    insert: vi.fn(),
    updateAuthenticationState: vi.fn((_connection, input) => {
      order.push('update-authentication-state')
      currentUser = createUser({
        ...currentUser,
        failedLoginCount: input.next.failedLoginCount,
        lockedUntil: input.next.lockedUntil,
        lastLoginAt: input.next.lastLoginAt,
        updatedAt: input.next.updatedAt
      })

      return currentUser
    }),
    updateCredentialState: vi.fn((_connection, input) => {
      order.push('update-credential-state')
      currentUser = createUser({
        ...currentUser,
        mustChangePassword: input.next.mustChangePassword,
        updatedAt: input.next.updatedAt
      })

      return currentUser
    })
  }
  const auditEventRepository = {
    getById: vi.fn(),
    listRecent: vi.fn(),
    listForEntity: vi.fn(),
    insert: vi.fn((_connection, input: CreateAuditEventInput) => {
      order.push('audit')
      return Object.freeze({
        ...input
      }) as AuditEventRecord
    })
  }
  const transactionExecutor = {
    run: vi.fn(<T>(work: (context: DatabaseTransactionContext) => T): T => {
      order.push('transaction')

      return work({
        connection: {},
        newEntityId: () => auditId,
        nowUtc: () => transactionTime
      } as DatabaseTransactionContext)
    })
  }
  const dependencies = {
    installationRepository,
    localUserRepository,
    auditEventRepository,
    passwordCredentialService,
    transactionExecutor,
    clock: {
      now: () => observationTime
    }
  } as unknown as LocalForcedPasswordChangeServiceDependencies

  return {
    ...dependencies,
    service: createLocalForcedPasswordChangeService(dependencies)
  }
}

function createMockPasswordCredentialService({
  hashCredential = replacementCredential,
  order = [],
  validateCredentialError,
  verifyResults = [true, false, true, false]
}: {
  readonly hashCredential?: StoredPasswordCredential
  readonly order?: string[]
  readonly validateCredentialError?: Error
  readonly verifyResults?: readonly boolean[]
} = {}): PasswordCredentialService & {
  readonly hash: ReturnType<typeof vi.fn<PasswordCredentialService['hash']>>
  readonly verify: ReturnType<typeof vi.fn<PasswordCredentialService['verify']>>
  readonly validateCredential: ReturnType<
    typeof vi.fn<PasswordCredentialService['validateCredential']>
  >
} {
  let verifyCount = 0
  const verificationSteps = Object.freeze([
    'verify-current',
    'verify-reuse',
    'verify-replacement-new',
    'verify-replacement-current'
  ] as const)

  return {
    validateCredential: vi.fn(() => {
      order.push('validate-replacement')

      if (validateCredentialError !== undefined) {
        throw validateCredentialError
      }

      return Object.freeze({
        passwordHash: hashCredential.passwordHash,
        passwordSalt: hashCredential.passwordSalt
      })
    }),
    verify: vi.fn(async () => {
      const step = verificationSteps[verifyCount] ?? `verify-${verifyCount + 1}`
      const result = verifyResults[verifyCount]
      verifyCount += 1
      order.push(step)

      if (result === undefined) {
        throw new Error('Unexpected replacement credential verification')
      }

      return result
    }),
    hash: vi.fn(async () => {
      order.push('hash-new')

      return hashCredential
    })
  }
}

function expectNoTransactionOrAudit(harness: Harness): void {
  expect(harness.transactionExecutor.run).not.toHaveBeenCalled()
  expect(harness.localUserRepository.updateAuthenticationState).not.toHaveBeenCalled()
  expect(harness.localUserRepository.updateCredentialState).not.toHaveBeenCalled()
  expect(harness.auditEventRepository.insert).not.toHaveBeenCalled()
}

function createCommand(): Record<string, unknown> {
  return {
    userId,
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword
  }
}

function createInstallation(): InstallationRecord {
  return {
    id: installationId,
    deploymentName: 'Test Deployment' as InstallationRecord['deploymentName'],
    timeZone: 'UTC' as InstallationRecord['timeZone'],
    createdAt,
    updatedAt: createdAt
  }
}

function createUser(override: Partial<LocalUserRecord> = {}): LocalUserRecord {
  return Object.freeze({
    id: userId,
    username: 'Admin.User' as LocalUserRecord['username'],
    displayName: 'Admin User' as LocalUserRecord['displayName'],
    role: 'LOCAL_ADMIN',
    isActive: true,
    mustChangePassword: true,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: previousLoginAt,
    createdAt,
    updatedAt: observationTime,
    ...override
  })
}

function fixedBytes(length: number, offset: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, index) => (index + offset) % 256))
}

async function captureAsyncError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}
