import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createLocalAuthenticationSessionService,
  LocalSessionAuthenticationError,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError,
  type LocalForcedPasswordChangeService,
  type LocalAuthenticationSessionService,
  type LocalLoginAuthenticationService,
  type LocalSessionSnapshot
} from '@main/application'
import {
  createAuthenticationSessionPublisher,
  createAuthenticationIpcHandlers,
  type AuthenticationIpcHandlers,
  type AuthenticationIpcOperationalLogger,
  type AuthenticationSessionPublisher
} from '@main/ipc/authentication'
import type { LocalUserRecord } from '@main/database'
import type { UtcClock, UtcTimestamp } from '@main/foundation'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createAuthenticationFailure,
  createIpcSuccess,
  ipcChannels,
  type AuthLoginRequest
} from '@shared/ipc'

const loginRequest: AuthLoginRequest = {
  username: 'Admin.User',
  password: 'CurrentPassw0rd!'
}
const t0 = '2026-07-31T12:00:00.000Z' as UtcTimestamp
const tIdle = '2026-07-31T12:15:00.000Z' as UtcTimestamp
const tAbsolute = '2026-08-01T00:00:00.000Z' as UtcTimestamp

describe('authentication IPC handlers', () => {
  it('returns minimized public sessions and publishes only changed public state', async () => {
    const activeSnapshot = createActiveSnapshot(3)
    let snapshot: LocalSessionSnapshot = activeSnapshot
    const service = createService({
      getSnapshot: vi.fn(() => snapshot),
      login: vi.fn(async () => ({ status: 'ACTIVE' as const, session: activeSnapshot }))
    })
    const publisher = createPublisher()
    const handlers = createHandlers({ service, publisher })

    const getSessionResult = await handlers.getSession(createAllowedEvent(), {})
    const loginResult = await handlers.login(createAllowedEvent(), loginRequest)

    expect(getSessionResult).toEqual(
      createIpcSuccess({
        status: 'ACTIVE',
        user: {
          username: 'Admin.User',
          displayName: 'Admin User',
          role: 'LOCAL_ADMIN'
        },
        idleExpiresAt: '2026-07-31T12:15:00.000Z',
        absoluteExpiresAt: '2026-08-01T00:00:00.000Z',
        revision: 3
      })
    )
    expect(loginResult).toEqual(getSessionResult)
    expect(service.login).toHaveBeenCalledWith(loginRequest)
    expect(publisher.publish).not.toHaveBeenCalled()

    const changedSnapshot = createActiveSnapshot(4)
    service.recordActivity = vi.fn(() => {
      snapshot = changedSnapshot

      return changedSnapshot
    })

    await expect(handlers.recordActivity(createAllowedEvent(), {})).resolves.toEqual(
      createIpcSuccess({
        status: 'ACTIVE',
        user: {
          username: 'Admin.User',
          displayName: 'Admin User',
          role: 'LOCAL_ADMIN'
        },
        idleExpiresAt: '2026-07-31T12:15:00.000Z',
        absoluteExpiresAt: '2026-08-01T00:00:00.000Z',
        revision: 4
      })
    )
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ACTIVE', revision: 4 })
    )

    const serialized = JSON.stringify(loginResult)

    for (const unsafeFragment of [
      '22222222-2222-4222-8222-222222222222',
      'failedLoginCount',
      'lockedUntil',
      'lastLoginAt',
      'createdAt',
      'updatedAt',
      'authenticatedAt',
      'lastActivityAt',
      'passwordHash',
      'passwordSalt'
    ]) {
      expect(serialized).not.toContain(unsafeFragment)
    }
  })

  it('keeps expected credential rejections as successful typed data without publication', async () => {
    const service = createService({
      login: vi.fn(async () => ({
        status: 'REJECTED' as const,
        reason: 'INVALID_CREDENTIALS' as const,
        retryAt: null
      })),
      unlock: vi.fn(async () => ({
        status: 'REJECTED' as const,
        reason: 'ACCOUNT_LOCKED' as const,
        retryAt: '2026-07-31T12:15:00.000Z' as never
      }))
    })
    const publisher = createPublisher()
    const handlers = createHandlers({ service, publisher })

    await expect(handlers.login(createAllowedEvent(), loginRequest)).resolves.toEqual(
      createIpcSuccess({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      })
    )
    await expect(
      handlers.unlock(createAllowedEvent(), { password: 'CurrentPassw0rd!' })
    ).resolves.toEqual(
      createIpcSuccess({
        status: 'REJECTED',
        reason: 'ACCOUNT_LOCKED',
        retryAt: '2026-07-31T12:15:00.000Z'
      })
    )
    expect(publisher.publish).not.toHaveBeenCalled()
  })

  it('publishes signed out when password-change rejections clear provisional state', async () => {
    for (const reason of ['ACCOUNT_INACTIVE', 'PASSWORD_CHANGE_NOT_REQUIRED'] as const) {
      let snapshot: LocalSessionSnapshot = createPasswordChangeRequiredSnapshot(1)
      const service = createService({
        getSnapshot: vi.fn(() => snapshot),
        changeRequiredPassword: vi.fn(async () => {
          snapshot = { status: 'SIGNED_OUT', revision: 2 }

          return {
            status: 'REJECTED' as const,
            reason,
            retryAt: null
          }
        })
      })
      const publisher = createPublisher()
      const handlers = createHandlers({ service, publisher })

      await expect(
        handlers.changeRequiredPassword(createAllowedEvent(), {
          currentPassword: 'CurrentPassw0rd!',
          newPassword: 'ReplacementPassw0rd!',
          confirmNewPassword: 'ReplacementPassw0rd!'
        })
      ).resolves.toEqual(
        createIpcSuccess({
          status: 'REJECTED',
          reason,
          retryAt: null
        })
      )
      expect(publisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 2 })
    }
  })

  it('publishes signed out when password-change concurrency or integrity failures clear state', async () => {
    const cases = [
      [new LocalSessionConcurrencyError(), 'AUTH_CONCURRENCY'],
      [new LocalSessionStateIntegrityError(), 'AUTH_STATE_INTEGRITY']
    ] as const

    for (const [error, code] of cases) {
      let snapshot: LocalSessionSnapshot = createPasswordChangeRequiredSnapshot(1)
      const service = createService({
        getSnapshot: vi.fn(() => snapshot),
        changeRequiredPassword: vi.fn(async () => {
          snapshot = { status: 'SIGNED_OUT', revision: 2 }
          throw error
        })
      })
      const publisher = createPublisher()
      const handlers = createHandlers({ service, publisher })

      await expect(
        handlers.changeRequiredPassword(createAllowedEvent(), {
          currentPassword: 'CurrentPassw0rd!',
          newPassword: 'ReplacementPassw0rd!',
          confirmNewPassword: 'ReplacementPassw0rd!'
        })
      ).resolves.toEqual(createAuthenticationFailure(code))
      expect(publisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 2 })
    }
  })

  it('publishes signed out when wrong-user unlock clears a locked session', async () => {
    let snapshot: LocalSessionSnapshot = createLockedSnapshot(2)
    const service = createService({
      getSnapshot: vi.fn(() => snapshot),
      unlock: vi.fn(async () => {
        snapshot = { status: 'SIGNED_OUT', revision: 3 }
        throw new LocalSessionConcurrencyError()
      })
    })
    const publisher = createPublisher()
    const handlers = createHandlers({ service, publisher })

    await expect(
      handlers.unlock(createAllowedEvent(), { password: 'CurrentPassw0rd!' })
    ).resolves.toEqual(createAuthenticationFailure('AUTH_CONCURRENCY'))
    expect(publisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 3 })
  })

  it('publishes signed out when unlock concurrency or integrity failures clear state', async () => {
    const cases = [
      [new LocalSessionConcurrencyError(), 'AUTH_CONCURRENCY'],
      [new LocalSessionStateIntegrityError(), 'AUTH_STATE_INTEGRITY']
    ] as const

    for (const [error, code] of cases) {
      let snapshot: LocalSessionSnapshot = createLockedSnapshot(2)
      const service = createService({
        getSnapshot: vi.fn(() => snapshot),
        unlock: vi.fn(async () => {
          snapshot = { status: 'SIGNED_OUT', revision: 3 }
          throw error
        })
      })
      const publisher = createPublisher()
      const handlers = createHandlers({ service, publisher })

      await expect(
        handlers.unlock(createAllowedEvent(), { password: 'CurrentPassw0rd!' })
      ).resolves.toEqual(createAuthenticationFailure(code))
      expect(publisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 3 })
    }
  })

  it('publishes lock invalidations for pending login and password change before throwing', async () => {
    const pendingLogin =
      createDeferred<Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>>()
    const loginHarness = createActualSessionService()
    loginHarness.loginService.authenticate.mockReturnValueOnce(pendingLogin.promise)

    const loginAttempt = loginHarness.service.login(loginRequest)
    const loginPublisher = createPublisher()
    const loginHandlers = createHandlers({
      service: loginHarness.service,
      publisher: loginPublisher
    })

    await expect(loginHandlers.lock(createAllowedEvent(), {})).resolves.toEqual(
      createAuthenticationFailure('AUTH_UNAUTHENTICATED')
    )
    expect(loginPublisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 1 })

    pendingLogin.resolve({ status: 'AUTHENTICATED', user: createUser() })
    await expect(loginAttempt).rejects.toBeInstanceOf(LocalSessionConcurrencyError)

    const pendingPasswordChange =
      createDeferred<Awaited<ReturnType<LocalForcedPasswordChangeService['changePassword']>>>()
    const passwordChangeHarness = createActualSessionService({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      }
    })
    await passwordChangeHarness.service.login(loginRequest)
    passwordChangeHarness.forcedPasswordChangeService.changePassword.mockReturnValueOnce(
      pendingPasswordChange.promise
    )

    const passwordChangeAttempt = passwordChangeHarness.service.changeRequiredPassword({
      currentPassword: 'CurrentPassw0rd!',
      newPassword: 'ReplacementPassw0rd!',
      confirmNewPassword: 'ReplacementPassw0rd!'
    })
    const passwordChangePublisher = createPublisher()
    const passwordChangeHandlers = createHandlers({
      service: passwordChangeHarness.service,
      publisher: passwordChangePublisher
    })

    await expect(passwordChangeHandlers.lock(createAllowedEvent(), {})).resolves.toEqual(
      createAuthenticationFailure('AUTH_PASSWORD_CHANGE_REQUIRED')
    )
    expect(passwordChangePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PASSWORD_CHANGE_REQUIRED', revision: 2 })
    )

    pendingPasswordChange.resolve({
      status: 'PASSWORD_CHANGED',
      user: createUser({ mustChangePassword: false })
    })
    await expect(passwordChangeAttempt).rejects.toBeInstanceOf(LocalSessionConcurrencyError)
  })

  it('does not publish ordinary invalid credentials when revision stays unchanged', async () => {
    const service = createService({
      getSnapshot: vi.fn(() => ({ status: 'SIGNED_OUT' as const, revision: 0 })),
      login: vi.fn(async () => ({
        status: 'REJECTED' as const,
        reason: 'INVALID_CREDENTIALS' as const,
        retryAt: null
      }))
    })
    const publisher = createPublisher()
    const handlers = createHandlers({ service, publisher })

    await expect(handlers.login(createAllowedEvent(), loginRequest)).resolves.toEqual(
      createIpcSuccess({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      })
    )
    expect(publisher.publish).not.toHaveBeenCalled()
  })

  it('keeps the controlled result when post-operation session observation fails', async () => {
    const service = createService({
      getSnapshot: vi
        .fn()
        .mockReturnValueOnce({ status: 'SIGNED_OUT', revision: 0 })
        .mockImplementationOnce(() => {
          throw new LocalSessionStateIntegrityError()
        }),
      login: vi.fn(async () => {
        throw new LocalSessionConcurrencyError()
      })
    })
    const publisher = createPublisher()
    const handlers = createHandlers({ service, publisher })

    await expect(handlers.login(createAllowedEvent(), loginRequest)).resolves.toEqual(
      createAuthenticationFailure('AUTH_CONCURRENCY')
    )
    expect(publisher.publish).not.toHaveBeenCalled()
  })

  it('keeps successful login authoritative when session event delivery fails', async () => {
    let snapshot: LocalSessionSnapshot = { status: 'SIGNED_OUT', revision: 0 }
    const activeSnapshot = createActiveSnapshot(1)
    const service = createService({
      getSnapshot: vi.fn(() => snapshot),
      login: vi.fn(async () => {
        snapshot = activeSnapshot

        return { status: 'ACTIVE' as const, session: activeSnapshot }
      })
    })
    const logger = createLogger()
    let sendCount = 0
    const target = {
      mainFrame: { url: 'http://localhost:5173/' },
      isDestroyed: vi.fn(() => false),
      send: vi.fn(() => {
        sendCount += 1

        if (sendCount === 1) {
          throw new Error('C:\\secret\\renderer-send CurrentPassw0rd!')
        }
      })
    }
    const handlers = createHandlers({
      service,
      logger,
      publisher: createAuthenticationSessionPublisher({
        navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
        getWebContents: () => target
      })
    })

    const loginResult = await handlers.login(createAllowedEvent(), loginRequest)

    expect(loginResult).toEqual(
      createIpcSuccess({
        status: 'ACTIVE',
        user: {
          username: 'Admin.User',
          displayName: 'Admin User',
          role: 'LOCAL_ADMIN'
        },
        idleExpiresAt: '2026-07-31T12:15:00.000Z',
        absoluteExpiresAt: '2026-08-01T00:00:00.000Z',
        revision: 1
      })
    )
    expect(target.send).toHaveBeenCalledTimes(2)

    await expect(handlers.getSession(createAllowedEvent(), {})).resolves.toEqual(loginResult)
    expect(target.send).toHaveBeenCalledTimes(2)

    const rawText = JSON.stringify(loginResult)
    const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

    expect(rawText).not.toContain('renderer-send')
    expect(rawText).not.toContain('CurrentPassw0rd')
    expect(logs).not.toContain('renderer-send')
    expect(logs).not.toContain('CurrentPassw0rd')
    expect(logs).not.toContain('C:\\secret')
  })

  it('publishes lazy locked and signed-out transitions observed by getSession', async () => {
    const idleHarness = createActualSessionService()
    const idlePublisher = createPublisher()
    const idleHandlers = createHandlers({
      service: idleHarness.service,
      publisher: idlePublisher
    })

    await idleHandlers.login(createAllowedEvent(), loginRequest)
    idlePublisher.publish.mockClear()
    idleHarness.clock.set(tIdle)

    await expect(idleHandlers.getSession(createAllowedEvent(), {})).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'LOCKED',
        revision: 2,
        reason: 'IDLE_TIMEOUT'
      }
    })
    expect(idlePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LOCKED', revision: 2, reason: 'IDLE_TIMEOUT' })
    )

    const absoluteHarness = createActualSessionService()
    const absolutePublisher = createPublisher()
    const absoluteHandlers = createHandlers({
      service: absoluteHarness.service,
      publisher: absolutePublisher
    })

    await absoluteHandlers.login(createAllowedEvent(), loginRequest)
    absolutePublisher.publish.mockClear()
    absoluteHarness.clock.set(tAbsolute)

    await expect(absoluteHandlers.getSession(createAllowedEvent(), {})).resolves.toEqual(
      createIpcSuccess({ status: 'SIGNED_OUT', revision: 2 })
    )
    expect(absolutePublisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 2 })
  })

  it('publishes provisional expiry before returning AUTH_UNAUTHENTICATED for password change', async () => {
    const harness = createActualSessionService({
      loginResult: {
        status: 'AUTHENTICATED',
        user: createUser({ mustChangePassword: true })
      }
    })
    const publisher = createPublisher()
    const handlers = createHandlers({
      service: harness.service,
      publisher
    })

    await handlers.login(createAllowedEvent(), loginRequest)
    publisher.publish.mockClear()
    harness.clock.set(tIdle)

    await expect(
      handlers.changeRequiredPassword(createAllowedEvent(), {
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'ReplacementPassw0rd!',
        confirmNewPassword: 'ReplacementPassw0rd!'
      })
    ).resolves.toEqual(createAuthenticationFailure('AUTH_UNAUTHENTICATED'))
    expect(harness.forcedPasswordChangeService.changePassword).not.toHaveBeenCalled()
    expect(publisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 2 })
  })

  it('publishes idle expiry before returning AUTH_LOCKED for recordActivity', async () => {
    const harness = createActualSessionService()
    const publisher = createPublisher()
    const handlers = createHandlers({
      service: harness.service,
      publisher
    })

    await handlers.login(createAllowedEvent(), loginRequest)
    publisher.publish.mockClear()
    harness.clock.set(tIdle)

    await expect(handlers.recordActivity(createAllowedEvent(), {})).resolves.toEqual(
      createAuthenticationFailure('AUTH_LOCKED')
    )
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LOCKED', revision: 2, reason: 'IDLE_TIMEOUT' })
    )
  })

  it('publishes absolute expiry before returning AUTH_UNAUTHENTICATED for unlock', async () => {
    const harness = createActualSessionService()
    const publisher = createPublisher()
    const handlers = createHandlers({
      service: harness.service,
      publisher
    })

    await handlers.login(createAllowedEvent(), loginRequest)
    await handlers.lock(createAllowedEvent(), {})
    publisher.publish.mockClear()
    harness.clock.set(tAbsolute)

    await expect(
      handlers.unlock(createAllowedEvent(), { password: 'CurrentPassw0rd!' })
    ).resolves.toEqual(createAuthenticationFailure('AUTH_UNAUTHENTICATED'))
    expect(publisher.publish).toHaveBeenCalledWith({ status: 'SIGNED_OUT', revision: 3 })
  })

  it('retries failed lazy-transition delivery on the next observation', async () => {
    const harness = createActualSessionService()
    const publisher = createPublisher()
    const handlers = createHandlers({
      service: harness.service,
      publisher
    })

    await handlers.login(createAllowedEvent(), loginRequest)
    publisher.publish.mockClear()
    publisher.publish.mockImplementationOnce(() => false)
    harness.clock.set(tIdle)

    await handlers.getSession(createAllowedEvent(), {})
    expect(publisher.publish).toHaveBeenCalledTimes(1)
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LOCKED', revision: 2 })
    )

    publisher.publish.mockClear()

    await handlers.getSession(createAllowedEvent(), {})
    expect(publisher.publish).toHaveBeenCalledTimes(1)
    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'LOCKED', revision: 2 })
    )
  })

  it('does not publish duplicate unchanged observations', async () => {
    const harness = createActualSessionService()
    const publisher = createPublisher()
    const handlers = createHandlers({
      service: harness.service,
      publisher
    })

    await handlers.login(createAllowedEvent(), loginRequest)
    publisher.publish.mockClear()

    await handlers.getSession(createAllowedEvent(), {})
    await handlers.getSession(createAllowedEvent(), {})

    expect(publisher.publish).not.toHaveBeenCalled()
  })

  it('rejects forbidden senders before request parsing or service access', async () => {
    const service = createService()
    const handlers = createHandlers({ service })
    const hostileRequest = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    await expect(handlers.login(createForbiddenEvent(), hostileRequest)).resolves.toEqual(
      createAuthenticationFailure('IPC_FORBIDDEN')
    )
    await expect(handlers.getSession(createForbiddenEvent(), hostileRequest)).resolves.toEqual(
      createAuthenticationFailure('IPC_FORBIDDEN')
    )
    expect(service.login).not.toHaveBeenCalled()
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('rejects malformed requests before invoking HSD-021', async () => {
    const service = createService()
    const handlers = createHandlers({ service })

    await expect(
      handlers.login(createAllowedEvent(), { ...loginRequest, userId: 'secret' })
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    await expect(
      handlers.changeRequiredPassword(createAllowedEvent(), {
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'ReplacementPassw0rd!',
        confirmNewPassword: 'ReplacementPassw0rd!',
        userId: '22222222-2222-4222-8222-222222222222'
      })
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    await expect(
      handlers.unlock(createAllowedEvent(), {
        username: 'Admin.User',
        password: 'CurrentPassw0rd!'
      })
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    await expect(
      handlers.login(createAllowedEvent(), { ...loginRequest, password: 'short' })
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    await expect(
      handlers.changeRequiredPassword(createAllowedEvent(), {
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'ReplacementPassw0rd!\u2028',
        confirmNewPassword: 'ReplacementPassw0rd!'
      })
    ).resolves.toEqual(createAuthenticationFailure('VALIDATION_FAILED'))
    await expect(handlers.unlock(createAllowedEvent(), { password: 'short' })).resolves.toEqual(
      createAuthenticationFailure('VALIDATION_FAILED')
    )
    expect(service.login).not.toHaveBeenCalled()
    expect(service.changeRequiredPassword).not.toHaveBeenCalled()
    expect(service.unlock).not.toHaveBeenCalled()
    expect(service.getSnapshot).not.toHaveBeenCalled()
  })

  it('maps controlled HSD-021 errors to reviewed safe IPC codes', async () => {
    const cases = [
      [new LocalSessionValidationError(), 'VALIDATION_FAILED'],
      [new LocalSessionOperationInProgressError(), 'AUTH_OPERATION_IN_PROGRESS'],
      [new LocalSessionStateIntegrityError(), 'AUTH_STATE_INTEGRITY'],
      [new LocalSessionConcurrencyError(), 'AUTH_CONCURRENCY'],
      [new LocalSessionUnauthenticatedError(), 'AUTH_UNAUTHENTICATED'],
      [new LocalSessionLockedError(), 'AUTH_LOCKED'],
      [new LocalSessionPasswordChangeRequiredError(), 'AUTH_PASSWORD_CHANGE_REQUIRED'],
      [new LocalSessionAuthenticationError(), 'AUTHENTICATION_UNAVAILABLE']
    ] as const

    for (const [error, code] of cases) {
      const handlers = createHandlers({
        service: createService({
          lock: vi.fn(() => {
            throw error
          })
        })
      })

      await expect(handlers.lock(createAllowedEvent(), {})).resolves.toEqual(
        createAuthenticationFailure(code)
      )
    }
  })

  it('logs only fixed channel, code, and safe error type', async () => {
    const logger = createLogger()
    const handlers = createHandlers({
      logger,
      service: createService({
        logout: vi.fn(() => {
          throw new Error('C:\\secret\\raw-message.txt CurrentPassw0rd!')
        })
      })
    })

    await expect(handlers.logout(createAllowedEvent(), {})).resolves.toEqual(
      createAuthenticationFailure('INTERNAL_ERROR')
    )

    const logs = [...logger.warn.mock.calls, ...logger.error.mock.calls].flat().join('\n')

    expect(logs).toContain(`channel=${ipcChannels.auth.logout}`)
    expect(logs).toContain('code=INTERNAL_ERROR')

    for (const unsafeFragment of ['CurrentPassw0rd', 'raw-message', 'C:\\secret']) {
      expect(logs).not.toContain(unsafeFragment)
    }
  })
})

interface HandlerOptions {
  service?: LocalAuthenticationSessionService
  publisher?: AuthenticationSessionPublisher
  logger?: TestLogger
}

interface TestPublisher extends AuthenticationSessionPublisher {
  publish: ReturnType<typeof vi.fn<AuthenticationSessionPublisher['publish']>>
  dispose: ReturnType<typeof vi.fn<AuthenticationSessionPublisher['dispose']>>
}

interface TestLogger extends AuthenticationIpcOperationalLogger {
  warn: AuthenticationIpcOperationalLogger['warn'] & {
    mock: { calls: unknown[][] }
  }
  error: AuthenticationIpcOperationalLogger['error'] & {
    mock: { calls: unknown[][] }
  }
}

function createHandlers({
  service = createService(),
  publisher = createPublisher(),
  logger = createLogger()
}: HandlerOptions = {}): AuthenticationIpcHandlers {
  return createAuthenticationIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    authenticationSessionService: service,
    sessionPublisher: publisher,
    logger
  })
}

function createService(
  overrides: Partial<LocalAuthenticationSessionService> = {}
): LocalAuthenticationSessionService {
  return {
    getSnapshot: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 0 })),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(() => createLockedSnapshot(2)),
    logout: vi.fn(() => ({ status: 'SIGNED_OUT', revision: 1 })),
    recordActivity: vi.fn(() => createActiveSnapshot(2)),
    requireActiveSession: vi.fn(),
    requireAnyRole: vi.fn(),
    ...overrides
  } as unknown as LocalAuthenticationSessionService
}

function createActiveSnapshot(
  revision: number
): Extract<LocalSessionSnapshot, { status: 'ACTIVE' }> {
  return {
    status: 'ACTIVE',
    user: createUser(),
    authenticatedAt: '2026-07-31T12:00:00.000Z',
    lastActivityAt: '2026-07-31T12:00:00.000Z',
    idleExpiresAt: '2026-07-31T12:15:00.000Z',
    absoluteExpiresAt: '2026-08-01T00:00:00.000Z',
    revision
  } as Extract<LocalSessionSnapshot, { status: 'ACTIVE' }>
}

function createLockedSnapshot(
  revision: number
): Extract<LocalSessionSnapshot, { status: 'LOCKED' }> {
  return {
    status: 'LOCKED',
    user: createUser(),
    authenticatedAt: '2026-07-31T12:00:00.000Z',
    lockedAt: '2026-07-31T12:05:00.000Z',
    reason: 'MANUAL',
    absoluteExpiresAt: '2026-08-01T00:00:00.000Z',
    revision
  } as Extract<LocalSessionSnapshot, { status: 'LOCKED' }>
}

function createPasswordChangeRequiredSnapshot(
  revision: number
): Extract<LocalSessionSnapshot, { status: 'PASSWORD_CHANGE_REQUIRED' }> {
  return {
    status: 'PASSWORD_CHANGE_REQUIRED',
    user: createUser({ mustChangePassword: true }),
    establishedAt: '2026-07-31T12:00:00.000Z',
    expiresAt: '2026-07-31T12:15:00.000Z',
    revision
  } as Extract<LocalSessionSnapshot, { status: 'PASSWORD_CHANGE_REQUIRED' }>
}

interface ActualSessionHarness {
  readonly service: LocalAuthenticationSessionService
  readonly clock: MutableClock
  readonly loginService: MockLoginService
  readonly forcedPasswordChangeService: MockForcedPasswordChangeService
}

interface MutableClock extends UtcClock {
  set(value: UtcTimestamp): void
}

interface ActualSessionHarnessOptions {
  readonly loginResult?: Awaited<ReturnType<LocalLoginAuthenticationService['authenticate']>>
  readonly forcedPasswordChangeResult?: Awaited<
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

function createActualSessionService({
  loginResult = {
    status: 'AUTHENTICATED' as const,
    user: createUser()
  },
  forcedPasswordChangeResult = {
    status: 'PASSWORD_CHANGED' as const,
    user: createUser({ updatedAt: '2026-07-31T12:05:00.000Z' as never })
  }
}: ActualSessionHarnessOptions = {}): ActualSessionHarness {
  const clock = createMutableClock(t0)
  const loginService = {
    authenticate: vi.fn(async () => loginResult)
  } as MockLoginService
  const forcedPasswordChangeService = {
    changePassword: vi.fn(async () => forcedPasswordChangeResult)
  } as MockForcedPasswordChangeService
  const service = createLocalAuthenticationSessionService({
    loginService,
    forcedPasswordChangeService,
    clock
  })

  return {
    service,
    clock,
    loginService,
    forcedPasswordChangeService
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

function createUser(override: Partial<LocalUserRecord> = {}): LocalUserRecord {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    username: 'Admin.User',
    displayName: 'Admin User',
    role: 'LOCAL_ADMIN',
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: '2026-07-31T12:00:00.000Z',
    createdAt: '2026-07-29T12:00:00.000Z',
    updatedAt: '2026-07-31T12:00:00.000Z',
    ...override
  } as LocalUserRecord
}

function createPublisher(): TestPublisher {
  return {
    publish: vi.fn(() => true),
    dispose: vi.fn()
  } as TestPublisher
}

function createLogger(): TestLogger {
  return {
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  } as TestLogger
}

function createAllowedEvent(): IpcSenderValidationEvent {
  return createEvent('http://localhost:5173/')
}

function createForbiddenEvent(): IpcSenderValidationEvent {
  return createEvent('https://example.invalid/')
}

function createEvent(url: string): IpcSenderValidationEvent {
  const mainFrame = { url }

  return {
    sender: { mainFrame },
    senderFrame: mainFrame
  }
}

function createDeferred<T>(): {
  readonly promise: Promise<T>
  resolve(value: T): void
} {
  let resolveDeferred: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    resolveDeferred = resolve
  })

  return {
    promise,
    resolve: resolveDeferred
  }
}
