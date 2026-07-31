import { describe, expect, it, vi } from 'vitest'

import {
  createLocalAuthenticationSessionService,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError
} from '@main/application'
import type {
  LocalAuthenticationSessionService,
  LocalForcedPasswordChangeService,
  LocalLoginAuthenticationService
} from '@main/application'
import {
  parseLocalUserRole,
  parseUserDisplayName,
  parseUsernameIdentity,
  type LocalUserRecord
} from '@main/database'
import {
  parseEntityId,
  parseUtcTimestamp,
  type UtcClock,
  type UtcTimestamp
} from '@main/foundation'

const currentPassword = 'CurrentPassw0rd!'
const newPassword = 'ReplacementPassw0rd!'
const wrongPassword = 'WrongPassw0rd!'
const userId = parseEntityId('11111111-1111-4111-8111-111111111111')
const otherUserId = parseEntityId('22222222-2222-4222-8222-222222222222')
const createdAt = parseUtcTimestamp('2026-07-30T09:00:00.000Z')
const t0 = parseUtcTimestamp('2026-07-30T12:00:00.000Z')
const t5 = parseUtcTimestamp('2026-07-30T12:05:00.000Z')
const t10 = parseUtcTimestamp('2026-07-30T12:10:00.000Z')
const t15 = parseUtcTimestamp('2026-07-30T12:15:00.000Z')
const t20 = parseUtcTimestamp('2026-07-30T12:20:00.000Z')
const t12h = parseUtcTimestamp('2026-07-31T00:00:00.000Z')

interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
}

describe('local authentication session service', () => {
  it('starts signed out with frozen credential-free snapshots', () => {
    const harness = createHarness()
    const snapshot = harness.service.getSnapshot()

    expect(snapshot).toEqual({ status: 'SIGNED_OUT', revision: 0 })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(() => harness.service.requireActiveSession()).toThrow(LocalSessionUnauthenticatedError)
    expect(JSON.stringify(snapshot)).not.toContain('password')
  })

  it('passes login input unchanged and keeps rejected logins signed out', async () => {
    const harness = createHarness({
      loginResult: {
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      }
    })
    const input = Object.freeze({ username: 'Admin.User', password: currentPassword })

    await expect(harness.service.login(input)).resolves.toEqual({
      status: 'REJECTED',
      reason: 'INVALID_CREDENTIALS',
      retryAt: null
    })

    expect(harness.loginService.authenticate).toHaveBeenCalledWith(input)
    expect(harness.service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 0 })
  })

  it('establishes ACTIVE or PASSWORD_CHANGE_REQUIRED from successful login contracts', async () => {
    const activeHarness = createHarness()

    await expect(activeHarness.service.login(createLoginCommand())).resolves.toMatchObject({
      status: 'ACTIVE',
      session: {
        status: 'ACTIVE',
        user: expect.objectContaining({ id: userId, mustChangePassword: false }),
        authenticatedAt: t0,
        lastActivityAt: t0,
        idleExpiresAt: t15,
        absoluteExpiresAt: t12h,
        revision: 1
      }
    })
    expect(Object.isFrozen(activeHarness.service.getSnapshot())).toBe(true)

    const passwordChangeHarness = createHarness({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      }
    })

    await expect(passwordChangeHarness.service.login(createLoginCommand())).resolves.toMatchObject({
      status: 'PASSWORD_CHANGE_REQUIRED',
      session: {
        status: 'PASSWORD_CHANGE_REQUIRED',
        user: expect.objectContaining({ id: userId, mustChangePassword: true }),
        establishedAt: t0,
        expiresAt: t15,
        revision: 1
      }
    })
    expect(() => passwordChangeHarness.service.requireActiveSession()).toThrow(
      LocalSessionPasswordChangeRequiredError
    )
  })

  it('injects provisional user ID into forced change and rejects caller-supplied user IDs', async () => {
    const harness = createHarness({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      },
      forcedPasswordChangeResult: {
        status: 'PASSWORD_CHANGED',
        user: createUser({ mustChangePassword: false, updatedAt: t5 })
      }
    })

    await harness.service.login(createLoginCommand())

    await expect(
      harness.service.changeRequiredPassword({
        currentPassword,
        newPassword,
        confirmNewPassword: newPassword,
        userId: otherUserId
      })
    ).rejects.toBeInstanceOf(LocalSessionValidationError)
    expect(harness.forcedPasswordChangeService.changePassword).not.toHaveBeenCalled()

    await expect(
      harness.service.changeRequiredPassword(createPasswordChangeCommand())
    ).resolves.toMatchObject({
      status: 'ACTIVE',
      session: {
        status: 'ACTIVE',
        user: expect.objectContaining({ id: userId, mustChangePassword: false })
      }
    })
    expect(harness.forcedPasswordChangeService.changePassword).toHaveBeenCalledWith({
      userId,
      currentPassword,
      newPassword,
      confirmNewPassword: newPassword
    })
  })

  it('retains provisional context for expected rejections and clears untrustworthy outcomes', async () => {
    const retained = createHarness({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      },
      forcedPasswordChangeResult: {
        status: 'REJECTED',
        reason: 'CURRENT_PASSWORD_INVALID',
        retryAt: null
      }
    })

    await retained.service.login(createLoginCommand())
    await expect(
      retained.service.changeRequiredPassword(createPasswordChangeCommand())
    ).resolves.toEqual({
      status: 'REJECTED',
      reason: 'CURRENT_PASSWORD_INVALID',
      retryAt: null
    })
    expect(retained.service.getSnapshot()).toMatchObject({
      status: 'PASSWORD_CHANGE_REQUIRED',
      revision: 1
    })

    const cleared = createHarness({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      },
      forcedPasswordChangeResult: {
        status: 'REJECTED',
        reason: 'ACCOUNT_INACTIVE',
        retryAt: null
      }
    })

    await cleared.service.login(createLoginCommand())
    await expect(
      cleared.service.changeRequiredPassword(createPasswordChangeCommand())
    ).resolves.toEqual({
      status: 'REJECTED',
      reason: 'ACCOUNT_INACTIVE',
      retryAt: null
    })
    expect(cleared.service.getSnapshot()).toMatchObject({ status: 'SIGNED_OUT' })
  })

  it('lazily records activity, locks, authorizes roles, and unlocks only the same user', async () => {
    const harness = createHarness()

    await harness.service.login(createLoginCommand())
    harness.clock.set(t5)

    const activity = harness.service.recordActivity()
    expect(activity).toMatchObject({
      status: 'ACTIVE',
      lastActivityAt: t5,
      idleExpiresAt: t20,
      absoluteExpiresAt: t12h
    })
    expect(harness.service.requireAnyRole(['LOCAL_ADMIN']).user.id).toBe(userId)
    expect(() => harness.service.requireAnyRole(['NURSE'])).toThrow()

    harness.clock.set(t10)
    expect(harness.service.lock()).toMatchObject({
      status: 'LOCKED',
      reason: 'MANUAL',
      lockedAt: t10
    })
    expect(() => harness.service.requireActiveSession()).toThrow(LocalSessionLockedError)

    harness.loginResult = {
      status: 'REJECTED',
      reason: 'INVALID_CREDENTIALS',
      retryAt: null
    }
    await expect(harness.service.unlock({ password: wrongPassword })).resolves.toEqual({
      status: 'REJECTED',
      reason: 'INVALID_CREDENTIALS',
      retryAt: null
    })
    expect(harness.service.getSnapshot()).toMatchObject({ status: 'LOCKED' })

    harness.loginResult = {
      status: 'AUTHENTICATED',
      user: createUser({ updatedAt: t10, lastLoginAt: t10 })
    }
    await expect(harness.service.unlock({ password: currentPassword })).resolves.toMatchObject({
      status: 'ACTIVE',
      session: {
        status: 'ACTIVE',
        user: expect.objectContaining({ id: userId }),
        authenticatedAt: t10
      }
    })
    expect(harness.loginService.authenticate).toHaveBeenLastCalledWith({
      username: 'Admin.User',
      password: currentPassword
    })
  })

  it('enforces idle, absolute, and provisional expiry at exact boundaries', async () => {
    const active = createHarness()
    await active.service.login(createLoginCommand())
    active.clock.set(t15)
    expect(active.service.getSnapshot()).toMatchObject({
      status: 'LOCKED',
      reason: 'IDLE_TIMEOUT',
      lockedAt: t15
    })

    const absolute = createHarness()
    await absolute.service.login(createLoginCommand())
    absolute.clock.set(t12h)
    expect(absolute.service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 2 })

    const provisional = createHarness({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      }
    })
    await provisional.service.login(createLoginCommand())
    provisional.clock.set(t15)
    expect(provisional.service.getSnapshot()).toEqual({ status: 'SIGNED_OUT', revision: 2 })
  })

  it('rejects a second authentication-changing operation before dependency calls', async () => {
    const deferred =
      createDeferred<Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>>()
    const harness = createHarness()
    harness.loginService.authenticate.mockReturnValueOnce(deferred.promise)

    const first = harness.service.login(createLoginCommand())

    await expect(harness.service.login(createLoginCommand())).rejects.toBeInstanceOf(
      LocalSessionOperationInProgressError
    )
    expect(harness.loginService.authenticate).toHaveBeenCalledTimes(1)

    deferred.resolve({ status: 'AUTHENTICATED', user: createUser() })
    await expect(first).resolves.toMatchObject({ status: 'ACTIVE' })
  })

  it('logout prevents stale async login, password-change, and unlock results from recreating state', async () => {
    const loginDeferred =
      createDeferred<Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>>()
    const loginHarness = createHarness()
    loginHarness.loginService.authenticate.mockReturnValueOnce(loginDeferred.promise)
    const loginAttempt = loginHarness.service.login(createLoginCommand())

    loginHarness.service.logout()
    loginDeferred.resolve({ status: 'AUTHENTICATED', user: createUser() })
    await expect(loginAttempt).rejects.toBeInstanceOf(LocalSessionConcurrencyError)
    expect(loginHarness.service.getSnapshot()).toMatchObject({ status: 'SIGNED_OUT' })

    const changeDeferred =
      createDeferred<Awaited<ReturnType<LocalForcedPasswordChangeService['changePassword']>>>()
    const changeHarness = createHarness({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      }
    })
    await changeHarness.service.login(createLoginCommand())
    changeHarness.forcedPasswordChangeService.changePassword.mockReturnValueOnce(
      changeDeferred.promise
    )
    const changeAttempt = changeHarness.service.changeRequiredPassword(
      createPasswordChangeCommand()
    )
    changeHarness.service.logout()
    changeDeferred.resolve({
      status: 'PASSWORD_CHANGED',
      user: createUser({ mustChangePassword: false })
    })
    await expect(changeAttempt).rejects.toBeInstanceOf(LocalSessionConcurrencyError)
    expect(changeHarness.service.getSnapshot()).toMatchObject({ status: 'SIGNED_OUT' })

    const unlockDeferred =
      createDeferred<Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>>()
    const unlockHarness = createHarness()
    await unlockHarness.service.login(createLoginCommand())
    unlockHarness.service.lock()
    unlockHarness.loginService.authenticate.mockReturnValueOnce(unlockDeferred.promise)
    const unlockAttempt = unlockHarness.service.unlock({ password: currentPassword })
    unlockHarness.service.logout()
    unlockDeferred.resolve({ status: 'AUTHENTICATED', user: createUser({ updatedAt: t10 }) })
    await expect(unlockAttempt).rejects.toBeInstanceOf(LocalSessionConcurrencyError)
    expect(unlockHarness.service.getSnapshot()).toMatchObject({ status: 'SIGNED_OUT' })
  })

  it('fails closed on backward time and wrong-user unlock success', async () => {
    const backward = createHarness()
    await backward.service.login(createLoginCommand())
    backward.clock.set(parseUtcTimestamp('2026-07-30T11:59:59.999Z'))
    expect(() => backward.service.getSnapshot()).toThrow(LocalSessionStateIntegrityError)
    expect(backward.service.logout()).toMatchObject({ status: 'SIGNED_OUT' })

    const wrongUser = createHarness()
    await wrongUser.service.login(createLoginCommand())
    wrongUser.service.lock()
    wrongUser.loginResult = {
      status: 'AUTHENTICATED',
      user: createUser({ id: otherUserId, updatedAt: t10, lastLoginAt: t10 })
    }

    await expect(wrongUser.service.unlock({ password: currentPassword })).rejects.toBeInstanceOf(
      LocalSessionConcurrencyError
    )
    expect(wrongUser.service.getSnapshot()).toMatchObject({ status: 'SIGNED_OUT' })
  })
})

interface Harness {
  readonly service: LocalAuthenticationSessionService
  readonly clock: MutableClock
  readonly loginService: MockLoginService
  readonly forcedPasswordChangeService: MockForcedPasswordChangeService
  loginResult: Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>
  forcedPasswordChangeResult: Awaited<
    ReturnType<LocalForcedPasswordChangeService['changePassword']>
  >
}

type MockLoginService = LocalLoginAuthenticationService & {
  readonly authenticate: ReturnType<typeof vi.fn<LocalLoginAuthenticationService['authenticate']>>
}
type MockForcedPasswordChangeService = LocalForcedPasswordChangeService & {
  readonly changePassword: ReturnType<
    typeof vi.fn<LocalForcedPasswordChangeService['changePassword']>
  >
}

interface HarnessOptions {
  readonly loginResult?: Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>
  readonly forcedPasswordChangeResult?: Awaited<
    ReturnType<LocalForcedPasswordChangeService['changePassword']>
  >
}

function createHarness(options: HarnessOptions = {}): Harness {
  const harness = {
    clock: createMutableClock(t0),
    loginResult: options.loginResult ?? {
      status: 'AUTHENTICATED',
      user: createUser()
    },
    forcedPasswordChangeResult: options.forcedPasswordChangeResult ?? {
      status: 'PASSWORD_CHANGED',
      user: createUser({ updatedAt: t5 })
    }
  } as Harness
  const loginService: MockLoginService = {
    authenticate: vi.fn(async () => harness.loginResult)
  }
  const forcedPasswordChangeService: MockForcedPasswordChangeService = {
    changePassword: vi.fn(async () => harness.forcedPasswordChangeResult)
  }
  const service = createLocalAuthenticationSessionService({
    loginService,
    forcedPasswordChangeService,
    clock: harness.clock
  })

  return Object.assign(harness, {
    service,
    loginService,
    forcedPasswordChangeService
  })
}

interface MutableClock extends UtcClock {
  set(value: UtcTimestamp): void
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

function createUser(override: Partial<LocalUserRecord> = {}): LocalUserRecord {
  return Object.freeze({
    id: userId,
    username: parseUsernameIdentity('Admin.User').username,
    displayName: parseUserDisplayName('Admin User'),
    role: parseLocalUserRole('LOCAL_ADMIN'),
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: t0,
    createdAt,
    updatedAt: t0,
    ...override
  })
}

function createLoginCommand(): Record<string, unknown> {
  return {
    username: 'Admin.User',
    password: currentPassword
  }
}

function createPasswordChangeCommand(): Record<string, unknown> {
  return {
    currentPassword,
    newPassword,
    confirmNewPassword: newPassword
  }
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
