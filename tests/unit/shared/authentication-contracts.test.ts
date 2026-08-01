import { describe, expect, it } from 'vitest'

import {
  authChangeRequiredPasswordRequestSchema,
  authenticationSafeErrorMessages,
  authenticationPasswordTransportSchema,
  authGetSessionRequestSchema,
  authGetSessionResultSchema,
  authLockRequestSchema,
  authLoginRequestSchema,
  authLoginResultSchema,
  authLogoutRequestSchema,
  authRecordActivityRequestSchema,
  authUnlockRequestSchema,
  createAuthenticationFailure,
  createIpcSuccess,
  ipcChannels,
  publicAuthenticationSessionSchema,
  type AuthLoginRequest,
  type PublicActiveAuthenticationSession
} from '@shared/ipc'

const validLoginRequest: AuthLoginRequest = {
  username: ' Admin.User ',
  password: '  ExactPassw0rd!  '
}

const activeSession: PublicActiveAuthenticationSession = {
  status: 'ACTIVE',
  user: {
    username: 'Admin.User',
    displayName: 'Admin User',
    role: 'LOCAL_ADMIN'
  },
  idleExpiresAt: '2026-07-31T12:15:00.000Z' as never,
  absoluteExpiresAt: '2026-08-01T00:00:00.000Z' as never,
  revision: 4
}

describe('shared authentication IPC contracts', () => {
  it('defines exactly the approved authentication channel strings', () => {
    expect(ipcChannels.auth).toEqual({
      getSession: 'health-screening:auth:get-session',
      login: 'health-screening:auth:login',
      changeRequiredPassword: 'health-screening:auth:change-required-password',
      unlock: 'health-screening:auth:unlock',
      lock: 'health-screening:auth:lock',
      logout: 'health-screening:auth:logout',
      recordActivity: 'health-screening:auth:record-activity',
      sessionChanged: 'health-screening:auth:session-changed'
    })
    expect(new Set(Object.values(ipcChannels.auth)).size).toBe(8)
  })

  it('accepts valid requests while preserving exact username and password text', () => {
    expect(authGetSessionRequestSchema.parse({})).toEqual({})
    expect(authLockRequestSchema.parse({})).toEqual({})
    expect(authLogoutRequestSchema.parse({})).toEqual({})
    expect(authRecordActivityRequestSchema.parse({})).toEqual({})

    const parsedLogin = authLoginRequestSchema.parse(validLoginRequest)

    expect(parsedLogin).toEqual(validLoginRequest)
    expect(parsedLogin.username).toBe(' Admin.User ')
    expect(parsedLogin.password).toBe('  ExactPassw0rd!  ')
    expect(
      authChangeRequiredPasswordRequestSchema.parse({
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'ReplacementPassw0rd!',
        confirmNewPassword: 'ReplacementPassw0rd!'
      })
    ).toEqual({
      currentPassword: 'CurrentPassw0rd!',
      newPassword: 'ReplacementPassw0rd!',
      confirmNewPassword: 'ReplacementPassw0rd!'
    })
    expect(authUnlockRequestSchema.parse({ password: 'CurrentPassw0rd!' })).toEqual({
      password: 'CurrentPassw0rd!'
    })
  })

  it('enforces HSD-010 password transport without changing exact strings', () => {
    const minimum = 'A'.repeat(12)
    const maximum = 'A'.repeat(128)
    const maximumUtf8 = '\u{1f600}'.repeat(128)
    const padded = '  ExactPassw0rd!  '
    const composed = 'ExactPassw0rd\u00e9'
    const decomposed = 'ExactPassw0rde\u0301'

    for (const password of [minimum, maximum, maximumUtf8, padded, composed, decomposed]) {
      expect(authenticationPasswordTransportSchema.parse(password)).toBe(password)
    }

    expect(authenticationPasswordTransportSchema.parse(composed)).not.toBe(
      authenticationPasswordTransportSchema.parse(decomposed)
    )
    expect(authenticationPasswordTransportSchema.parse(padded)).not.toBe('ExactPassw0rd!')

    const malformedPasswords = [
      'A'.repeat(11),
      'A'.repeat(129),
      '\u{1f600}'.repeat(129),
      'ValidPassw0rd!\ud800',
      'ValidPassw0rd!\udc00',
      'ValidPassw0rd!\u0000',
      'ValidPassw0rd!\u0085',
      'ValidPassw0rd!\u2028',
      'ValidPassw0rd!\u2029'
    ]

    for (const password of malformedPasswords) {
      expect(authenticationPasswordTransportSchema.safeParse(password).success).toBe(false)
      expect(authLoginRequestSchema.safeParse({ ...validLoginRequest, password }).success).toBe(
        false
      )
      expect(
        authChangeRequiredPasswordRequestSchema.safeParse({
          currentPassword: password,
          newPassword: 'ReplacementPassw0rd!',
          confirmNewPassword: 'ReplacementPassw0rd!'
        }).success
      ).toBe(false)
      expect(
        authChangeRequiredPasswordRequestSchema.safeParse({
          currentPassword: 'CurrentPassw0rd!',
          newPassword: password,
          confirmNewPassword: 'ReplacementPassw0rd!'
        }).success
      ).toBe(false)
      expect(
        authChangeRequiredPasswordRequestSchema.safeParse({
          currentPassword: 'CurrentPassw0rd!',
          newPassword: 'ReplacementPassw0rd!',
          confirmNewPassword: password
        }).success
      ).toBe(false)
      expect(authUnlockRequestSchema.safeParse({ password }).success).toBe(false)
    }
  })

  it('rejects extra authority-bearing or malformed authentication requests', () => {
    const symbolRequest = Object.defineProperty({ ...validLoginRequest }, Symbol('secret'), {
      value: true,
      enumerable: true
    })
    const accessorRequest = { ...validLoginRequest }
    let getterInvoked = false
    Object.defineProperty(accessorRequest, 'password', {
      enumerable: true,
      get() {
        getterInvoked = true
        return 'ExactPassw0rd!'
      }
    })
    const inheritedRequest = Object.create({ username: 'Admin.User' }) as Record<string, unknown>
    inheritedRequest.password = 'ExactPassw0rd!'
    const descriptorTrapRequest = new Proxy(
      { ...validLoginRequest },
      {
        getOwnPropertyDescriptor() {
          throw new Error('C:\\secret\\descriptor.txt')
        }
      }
    )

    for (const value of [
      null,
      [],
      'request',
      { ...validLoginRequest, userId: '22222222-2222-4222-8222-222222222222' },
      { ...validLoginRequest, role: 'LOCAL_ADMIN' },
      { username: 'Admin.User' },
      { password: 'ExactPassw0rd!' },
      { ...validLoginRequest, password: () => undefined },
      { ...validLoginRequest, password: 1n },
      Object.setPrototypeOf({ ...validLoginRequest }, { trusted: false }),
      symbolRequest,
      accessorRequest,
      inheritedRequest,
      descriptorTrapRequest
    ]) {
      expect(authLoginRequestSchema.safeParse(value).success).toBe(false)
    }

    expect(getterInvoked).toBe(false)
    expect(
      authChangeRequiredPasswordRequestSchema.safeParse({
        currentPassword: 'CurrentPassw0rd!',
        newPassword: 'ReplacementPassw0rd!',
        confirmNewPassword: 'ReplacementPassw0rd!',
        userId: '22222222-2222-4222-8222-222222222222'
      }).success
    ).toBe(false)
    expect(
      authUnlockRequestSchema.safeParse({
        username: 'Admin.User',
        password: 'CurrentPassw0rd!'
      }).success
    ).toBe(false)
  })

  it('validates minimized public session variants and rejects persistence details', () => {
    expect(publicAuthenticationSessionSchema.parse({ status: 'SIGNED_OUT', revision: 0 })).toEqual({
      status: 'SIGNED_OUT',
      revision: 0
    })
    expect(publicAuthenticationSessionSchema.parse(activeSession)).toEqual(activeSession)
    expect(
      publicAuthenticationSessionSchema.parse({
        status: 'PASSWORD_CHANGE_REQUIRED',
        user: activeSession.user,
        expiresAt: '2026-07-31T12:15:00.000Z',
        revision: 2
      })
    ).toMatchObject({ status: 'PASSWORD_CHANGE_REQUIRED', revision: 2 })
    expect(
      publicAuthenticationSessionSchema.parse({
        status: 'LOCKED',
        user: activeSession.user,
        reason: 'IDLE_TIMEOUT',
        absoluteExpiresAt: '2026-08-01T00:00:00.000Z',
        revision: 5
      })
    ).toMatchObject({ status: 'LOCKED', reason: 'IDLE_TIMEOUT' })

    for (const value of [
      {
        ...activeSession,
        user: { ...activeSession.user, id: '22222222-2222-4222-8222-222222222222' }
      },
      { ...activeSession, authenticatedAt: '2026-07-31T12:00:00.000Z' },
      { ...activeSession, lastActivityAt: '2026-07-31T12:00:00.000Z' },
      { ...activeSession, user: { ...activeSession.user, failedLoginCount: 0 } },
      { ...activeSession, user: { ...activeSession.user, lockedUntil: null } },
      { ...activeSession, user: { ...activeSession.user, passwordHash: 'hash' } },
      { ...activeSession, user: { ...activeSession.user, passwordSalt: 'salt' } },
      { ...activeSession, user: { ...activeSession.user, role: 'SUPERUSER' } },
      { ...activeSession, idleExpiresAt: 'not-a-timestamp' },
      { ...activeSession, revision: -1 },
      { ...activeSession, revision: Number.MAX_SAFE_INTEGER + 1 }
    ]) {
      expect(publicAuthenticationSessionSchema.safeParse(value).success).toBe(false)
    }
  })

  it('uses fixed authentication failure envelopes and result data unions', () => {
    for (const [code, message] of Object.entries(authenticationSafeErrorMessages)) {
      expect(authGetSessionResultSchema.parse({ ok: false, error: { code, message } })).toEqual({
        ok: false,
        error: { code, message }
      })
    }

    expect(authLoginResultSchema.parse(createIpcSuccess(activeSession))).toEqual(
      createIpcSuccess(activeSession)
    )
    expect(
      authLoginResultSchema.parse(
        createIpcSuccess({
          status: 'REJECTED',
          reason: 'INVALID_CREDENTIALS',
          retryAt: null
        })
      )
    ).toEqual(
      createIpcSuccess({
        status: 'REJECTED',
        reason: 'INVALID_CREDENTIALS',
        retryAt: null
      })
    )
    expect(
      authLoginResultSchema.safeParse({
        ok: false,
        error: {
          code: 'AUTH_LOCKED',
          message: 'arbitrary raw message'
        }
      }).success
    ).toBe(false)
    expect(JSON.stringify(createAuthenticationFailure('IPC_UNAVAILABLE'))).not.toContain('secret')
  })

  it('keeps authentication request and response values structured-clone safe', () => {
    expect(structuredClone(validLoginRequest)).toEqual(validLoginRequest)
    expect(structuredClone(createIpcSuccess(activeSession))).toEqual(
      createIpcSuccess(activeSession)
    )
    expect(structuredClone(createAuthenticationFailure('AUTH_LOCKED'))).toEqual(
      createAuthenticationFailure('AUTH_LOCKED')
    )
  })
})
