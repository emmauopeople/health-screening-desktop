import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  LocalSessionAuthenticationError,
  LocalSessionConcurrencyError,
  LocalSessionLockedError,
  LocalSessionOperationInProgressError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionStateIntegrityError,
  LocalSessionUnauthenticatedError,
  LocalSessionValidationError,
  type LocalAuthenticationSessionService,
  type LocalSessionSnapshot
} from '@main/application'
import {
  createAuthenticationIpcHandlers,
  type AuthenticationIpcHandlers,
  type AuthenticationIpcOperationalLogger,
  type AuthenticationSessionPublisher
} from '@main/ipc/authentication'
import type { LocalUserRecord } from '@main/database'
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

describe('authentication IPC handlers', () => {
  it('returns minimized public sessions and publishes only changed public state', async () => {
    const activeSnapshot = createActiveSnapshot(3)
    const service = createService({
      getSnapshot: vi.fn(() => activeSnapshot),
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
    expect(service.getSnapshot).toHaveBeenCalledOnce()
    expect(service.login).toHaveBeenCalledWith(loginRequest)
    expect(publisher.publish).not.toHaveBeenCalled()

    const changedSnapshot = createActiveSnapshot(4)
    service.recordActivity = vi.fn(() => changedSnapshot)

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
    expect(service.login).not.toHaveBeenCalled()
    expect(service.changeRequiredPassword).not.toHaveBeenCalled()
    expect(service.unlock).not.toHaveBeenCalled()
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
  publisher?: TestPublisher
  logger?: TestLogger
}

interface TestPublisher extends AuthenticationSessionPublisher {
  publish: AuthenticationSessionPublisher['publish'] & {
    mock: { calls: unknown[][] }
  }
  dispose: AuthenticationSessionPublisher['dispose'] & {
    mock: { calls: unknown[][] }
  }
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

function createUser(): LocalUserRecord {
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
    updatedAt: '2026-07-31T12:00:00.000Z'
  } as LocalUserRecord
}

function createPublisher(): TestPublisher {
  return {
    publish: vi.fn(),
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
