import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  type ActiveLocalSessionContext,
  type LocalAuthenticationSessionService
} from '@main/application'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createAuthenticationFailure } from '@shared/ipc'

const activeContext = {
  user: {
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
  },
  authenticatedAt: '2026-07-31T12:00:00.000Z',
  lastActivityAt: '2026-07-31T12:00:00.000Z',
  idleExpiresAt: '2026-07-31T12:15:00.000Z',
  absoluteExpiresAt: '2026-08-01T00:00:00.000Z'
} as ActiveLocalSessionContext

describe('authenticated handler authorization adapter', () => {
  it('returns active context for authorized senders without parsing business payloads', () => {
    const service = createService({
      requireActiveSession: vi.fn(() => activeContext)
    })
    const authorization = createAuthorization(service)

    expect(authorization.requireActiveSession(createAllowedEvent())).toEqual({
      ok: true,
      context: activeContext
    })
    expect(service.requireActiveSession).toHaveBeenCalledOnce()
  })

  it('rejects forbidden senders before session authorization', () => {
    const service = createService()
    const authorization = createAuthorization(service)

    expect(authorization.requireAnyRole(createForbiddenEvent(), ['LOCAL_ADMIN'])).toEqual({
      ok: false,
      failure: createAuthenticationFailure('IPC_FORBIDDEN')
    })
    expect(service.requireAnyRole).not.toHaveBeenCalled()
  })

  it('maps non-active session states to fixed authorization failures', () => {
    const cases = [
      [new LocalSessionUnauthenticatedError(), 'AUTH_UNAUTHENTICATED'],
      [new LocalSessionLockedError(), 'AUTH_LOCKED'],
      [new LocalSessionPasswordChangeRequiredError(), 'AUTH_PASSWORD_CHANGE_REQUIRED']
    ] as const

    for (const [error, code] of cases) {
      const authorization = createAuthorization(
        createService({
          requireActiveSession: vi.fn(() => {
            throw error
          })
        })
      )

      expect(authorization.requireActiveSession(createAllowedEvent())).toEqual({
        ok: false,
        failure: createAuthenticationFailure(code)
      })
    }
  })

  it('uses main-owned role lists and maps denied roles safely', () => {
    const allowedService = createService({
      requireAnyRole: vi.fn(() => activeContext)
    })
    const deniedService = createService({
      requireAnyRole: vi.fn(() => {
        throw new LocalSessionAuthorizationError()
      })
    })

    expect(
      createAuthorization(allowedService).requireAnyRole(createAllowedEvent(), ['LOCAL_ADMIN'])
    ).toEqual({
      ok: true,
      context: activeContext
    })
    expect(allowedService.requireAnyRole).toHaveBeenCalledWith(['LOCAL_ADMIN'])
    expect(
      createAuthorization(deniedService).requireAnyRole(createAllowedEvent(), ['NURSE'])
    ).toEqual({
      ok: false,
      failure: createAuthenticationFailure('AUTHORIZATION_FAILED')
    })
  })
})

function createAuthorization(
  service: LocalAuthenticationSessionService
): ReturnType<typeof createAuthenticatedHandlerAuthorization> {
  return createAuthenticatedHandlerAuthorization({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    authenticationSessionService: service
  })
}

function createService(
  overrides: Partial<LocalAuthenticationSessionService> = {}
): LocalAuthenticationSessionService {
  return {
    getSnapshot: vi.fn(),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(),
    requireAnyRole: vi.fn(),
    ...overrides
  } as unknown as LocalAuthenticationSessionService
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
