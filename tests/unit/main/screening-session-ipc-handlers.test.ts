import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type {
  ActiveLocalSessionContext,
  LocalAuthenticationSessionService,
  ScreeningSessionService,
  ScreeningSessionWorkspaceContextService
} from '@main/application'
import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError
} from '@main/application'
import type { LocalUserRecord, LocalUserRole, ScreeningSessionRecord } from '@main/database'
import type { EntityId, UtcTimestamp } from '@main/foundation'
import {
  createScreeningSessionIpcHandlers,
  type ScreeningSessionIpcHandlers,
  type ScreeningSessionIpcOperationalLogger
} from '@main/ipc/handlers/screening-session-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createScreeningSessionFailure,
  type ScreeningSessionCloseRequest,
  type ScreeningSessionCreateRequest,
  type ScreeningSessionGetByIdRequest,
  type ScreeningSessionListRequest,
  type ScreeningSessionReopenRequest
} from '@shared/ipc'

const sessionId = '11111111-1111-4111-8111-111111111111' as EntityId
const userId = '22222222-2222-4222-8222-222222222222' as EntityId
const locationId = '33333333-3333-4333-8333-333333333333' as EntityId
const protocolVersionId = '44444444-4444-4444-8444-444444444444' as EntityId
const timestamp = '2026-07-29T12:34:56.789Z' as UtcTimestamp
const sensitiveNote = 'Private session setup note'
const sensitiveReason = 'Private close or reopen reason'

const createRequest: ScreeningSessionCreateRequest = {
  locationId,
  sessionDate: '2026-07-29',
  notes: sensitiveNote
}
const closeRequest: ScreeningSessionCloseRequest = {
  id: sessionId,
  expectedRowVersion: 1,
  reason: sensitiveReason
}
const reopenRequest: ScreeningSessionReopenRequest = {
  id: sessionId,
  expectedRowVersion: 2,
  reason: sensitiveReason
}
const getRequest: ScreeningSessionGetByIdRequest = {
  id: sessionId
}
const listRequest: ScreeningSessionListRequest = {
  locationId: null,
  status: null,
  dateFrom: null,
  dateTo: null,
  page: 1,
  pageSize: 25
}

describe('screening-session IPC handlers', () => {
  it('authorizes context, create, close, get, and list for all local roles using trusted actor data', async () => {
    for (const role of ['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const) {
      const harness = createHarness({ role })

      await expect(harness.handlers.getWorkspaceContext(createAllowedEvent(), {})).resolves.toEqual(
        {
          ok: true,
          data: {
            deploymentLocalDate: '2026-07-29',
            activeLocations: [{ id: locationId, name: 'Central Church' }]
          }
        }
      )
      await expect(
        harness.handlers.create(createAllowedEvent(), createRequest)
      ).resolves.toMatchObject({
        ok: true,
        data: { status: 'CREATED' }
      })
      await expect(
        harness.handlers.close(createAllowedEvent(), closeRequest)
      ).resolves.toMatchObject({
        ok: true,
        data: { status: 'CLOSED' }
      })
      await expect(
        harness.handlers.getById(createAllowedEvent(), getRequest)
      ).resolves.toMatchObject({
        ok: true,
        data: { status: 'FOUND' }
      })
      await expect(harness.handlers.list(createAllowedEvent(), listRequest)).resolves.toMatchObject(
        {
          ok: true,
          data: { status: 'LISTED', total: 1 }
        }
      )

      expect(harness.screeningSessionService.create).toHaveBeenCalledWith(
        { ...createRequest, notes: sensitiveNote },
        { userId, role }
      )
      expect(harness.screeningSessionService.close).toHaveBeenCalledWith(
        { ...closeRequest, reason: sensitiveReason },
        { userId, role }
      )
      expect(harness.screeningSessionService.reopen).not.toHaveBeenCalled()
      expect(harness.screeningSessionService.getById).toHaveBeenCalledWith(getRequest, {
        userId,
        role
      })
      expect(harness.screeningSessionService.list).toHaveBeenCalledWith(listRequest, {
        userId,
        role
      })
      expect(harness.authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
        'LOCAL_ADMIN',
        'NURSE',
        'TRAINED_SCREENER'
      ])
      expect(
        Object.isFrozen(await harness.handlers.create(createAllowedEvent(), createRequest))
      ).toBe(true)
    }
  })

  it('authorizes reopen only for local administrators and nurses before request parsing', async () => {
    for (const role of ['LOCAL_ADMIN', 'NURSE'] as const) {
      const harness = createHarness({ role })

      await expect(
        harness.handlers.reopen(createAllowedEvent(), reopenRequest)
      ).resolves.toMatchObject({
        ok: true,
        data: { status: 'REOPENED' }
      })
      expect(harness.authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
        'LOCAL_ADMIN',
        'NURSE'
      ])
      expect(harness.screeningSessionService.reopen).toHaveBeenCalledWith(reopenRequest, {
        userId,
        role
      })
    }

    const harness = createHarness({ role: 'TRAINED_SCREENER' })
    let requestInspected = false
    const hostileRequest = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          requestInspected = true
          throw new Error('proxy leaked sensitive reopen request')
        }
      }
    )

    await expect(harness.handlers.reopen(createAllowedEvent(), hostileRequest)).resolves.toEqual(
      createScreeningSessionFailure('AUTHORIZATION_FAILED')
    )
    expect(harness.authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
      'LOCAL_ADMIN',
      'NURSE'
    ])
    expect(requestInspected).toBe(false)
    expect(harness.screeningSessionService.reopen).not.toHaveBeenCalled()
  })

  it('performs sender and authentication authorization before parsing unsafe requests', async () => {
    for (const failure of [
      {
        harness: createHarness(),
        event: createForbiddenEvent(),
        expected: createScreeningSessionFailure('IPC_FORBIDDEN')
      },
      {
        harness: createHarness({ authError: new LocalSessionUnauthenticatedError() }),
        event: createAllowedEvent(),
        expected: createScreeningSessionFailure('AUTH_UNAUTHENTICATED')
      },
      {
        harness: createHarness({ authError: new LocalSessionLockedError() }),
        event: createAllowedEvent(),
        expected: createScreeningSessionFailure('AUTH_LOCKED')
      },
      {
        harness: createHarness({ authError: new LocalSessionPasswordChangeRequiredError() }),
        event: createAllowedEvent(),
        expected: createScreeningSessionFailure('AUTH_PASSWORD_CHANGE_REQUIRED')
      }
    ]) {
      let getterInvoked = false
      const request = new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            getterInvoked = true
            throw new Error('proxy leaked sensitive request')
          }
        }
      )

      await expect(failure.harness.handlers.create(failure.event, request)).resolves.toEqual(
        failure.expected
      )
      expect(getterInvoked).toBe(false)
      expect(failure.harness.screeningSessionService.create).not.toHaveBeenCalled()
    }
  })

  it('rejects renderer-supplied authority and generated create fields before service invocation', async () => {
    for (const extra of [
      { userId },
      { role: 'LOCAL_ADMIN' },
      { actor: { userId, role: 'LOCAL_ADMIN' } },
      { protocolVersionId },
      { rowVersion: 1 },
      { status: 'OPEN' }
    ]) {
      const harness = createHarness()

      await expect(
        harness.handlers.create(createAllowedEvent(), {
          ...createRequest,
          ...extra
        })
      ).resolves.toEqual(createScreeningSessionFailure('VALIDATION_FAILED'))
      expect(harness.screeningSessionService.create).not.toHaveBeenCalled()
    }
  })

  it('maps expected service outcomes as successful typed results', async () => {
    for (const status of [
      'ALREADY_EXISTS',
      'SESSION_DATE_NOT_CURRENT',
      'LOCATION_NOT_FOUND',
      'LOCATION_INACTIVE',
      'NO_ACTIVE_PROTOCOL'
    ] as const) {
      await expect(
        createHarness({
          create: () => ({ status })
        }).handlers.create(createAllowedEvent(), createRequest)
      ).resolves.toEqual({ ok: true, data: { status } })
    }

    for (const status of ['NOT_FOUND', 'SESSION_VERSION_CONFLICT', 'ALREADY_CLOSED'] as const) {
      await expect(
        createHarness({
          close: () =>
            status === 'NOT_FOUND'
              ? { status }
              : { status, session: createSession({ status: 'CLOSED' }) }
        }).handlers.close(createAllowedEvent(), closeRequest)
      ).resolves.toMatchObject({ ok: true, data: { status } })
    }

    for (const status of [
      'NOT_FOUND',
      'SESSION_VERSION_CONFLICT',
      'ALREADY_OPEN',
      'FORBIDDEN'
    ] as const) {
      await expect(
        createHarness({
          reopen: () =>
            status === 'NOT_FOUND' || status === 'FORBIDDEN'
              ? { status }
              : { status, session: createSession() }
        }).handlers.reopen(createAllowedEvent(), reopenRequest)
      ).resolves.toMatchObject({ ok: true, data: { status } })
    }

    await expect(
      createHarness({ getById: () => ({ status: 'NOT_FOUND' }) }).handlers.getById(
        createAllowedEvent(),
        getRequest
      )
    ).resolves.toEqual({ ok: true, data: { status: 'NOT_FOUND' } })
  })

  it('fails closed for malformed service output and thrown errors without leaking sensitive data', async () => {
    const malformedHarness = createHarness({
      getById: () => ({ status: 'FOUND', session: createSession({ rowVersion: 0 }) })
    })
    const thrownHarness = createHarness({
      close: () => {
        throw new Error(`SELECT ${sensitiveNote} ${sensitiveReason} C:\\secret\\db.sqlite3`)
      }
    })

    await expect(
      malformedHarness.handlers.getById(createAllowedEvent(), getRequest)
    ).resolves.toEqual(createScreeningSessionFailure('INTERNAL_ERROR'))
    await expect(thrownHarness.handlers.close(createAllowedEvent(), closeRequest)).resolves.toEqual(
      createScreeningSessionFailure('INTERNAL_ERROR')
    )
    expectLogsAreSafe(malformedHarness.logger)
    expectLogsAreSafe(thrownHarness.logger)
  })

  it('validates workspace context output and maps query failures safely', async () => {
    const malformedHarness = createHarness({
      workspaceContext: () => ({
        deploymentLocalDate: '2026-07-29',
        activeLocations: [{ id: 'not-a-uuid', name: 'Central Church' }]
      })
    })
    const thrownHarness = createHarness({
      workspaceContext: () => {
        throw new Error(`timezone ${sensitiveNote} C:\\secret`)
      }
    })

    await expect(
      malformedHarness.handlers.getWorkspaceContext(createAllowedEvent(), {})
    ).resolves.toEqual(createScreeningSessionFailure('INTERNAL_ERROR'))
    await expect(
      thrownHarness.handlers.getWorkspaceContext(createAllowedEvent(), {})
    ).resolves.toEqual(createScreeningSessionFailure('INTERNAL_ERROR'))
    expectLogsAreSafe(thrownHarness.logger)
  })
})

interface HandlerOverrides {
  readonly role?: LocalUserRole
  readonly authError?: Error | null
  readonly workspaceContext?: () => unknown
  readonly create?: ScreeningSessionService['create']
  readonly close?: ScreeningSessionService['close']
  readonly reopen?: ScreeningSessionService['reopen']
  readonly getById?: ScreeningSessionService['getById']
  readonly list?: ScreeningSessionService['list']
}

interface HandlerHarness {
  readonly handlers: ScreeningSessionIpcHandlers
  readonly authenticationSessionService: LocalAuthenticationSessionService & {
    requireAnyRole: ReturnType<typeof vi.fn>
  }
  readonly screeningSessionService: ScreeningSessionService & {
    create: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    reopen: ReturnType<typeof vi.fn>
    getById: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
  }
  readonly logger: TestLogger
}

interface TestLogger extends ScreeningSessionIpcOperationalLogger {
  warn: ScreeningSessionIpcOperationalLogger['warn'] & { mock: { calls: unknown[][] } }
  error: ScreeningSessionIpcOperationalLogger['error'] & { mock: { calls: unknown[][] } }
}

function createHarness(overrides: HandlerOverrides = {}): HandlerHarness {
  const logger = createLogger()
  const authenticationSessionService = createAuthenticationSessionService(
    overrides.role ?? 'LOCAL_ADMIN',
    overrides.authError
  )
  const screeningSessionService = createScreeningSessionService(overrides)
  const workspaceContextService = createWorkspaceContextService(overrides.workspaceContext)
  const handlers = createScreeningSessionIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    authenticationSessionService,
    screeningSessionService,
    screeningSessionWorkspaceContextService: workspaceContextService,
    logger
  })

  return {
    handlers,
    authenticationSessionService,
    screeningSessionService,
    logger
  }
}

function createAuthenticationSessionService(
  role: LocalUserRole,
  authError: Error | null | undefined
): HandlerHarness['authenticationSessionService'] {
  const requireAnyRole = vi.fn((roles: readonly LocalUserRole[]) => {
    if (authError) {
      throw authError
    }

    if (!roles.includes(role)) {
      throw new LocalSessionAuthorizationError()
    }

    return createActiveContext(role)
  })

  return {
    getSnapshot: vi.fn(),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(),
    requireAnyRole
  } as unknown as HandlerHarness['authenticationSessionService']
}

function createScreeningSessionService(
  overrides: HandlerOverrides
): HandlerHarness['screeningSessionService'] {
  return {
    create: vi.fn(overrides.create ?? (() => ({ status: 'CREATED', session: createSession() }))),
    close: vi.fn(
      overrides.close ??
        (() => ({ status: 'CLOSED', session: createSession({ status: 'CLOSED' }) }))
    ),
    reopen: vi.fn(
      overrides.reopen ??
        (() => ({
          status: 'REOPENED',
          session: createSession()
        }))
    ),
    getById: vi.fn(overrides.getById ?? (() => ({ status: 'FOUND', session: createSession() }))),
    list: vi.fn(
      overrides.list ??
        (() => ({
          status: 'LISTED',
          items: Object.freeze([createSession()]),
          page: 1,
          pageSize: 25,
          total: 1
        }))
    )
  } as unknown as HandlerHarness['screeningSessionService']
}

function createWorkspaceContextService(
  implementation?: () => unknown
): ScreeningSessionWorkspaceContextService {
  return {
    getContext: vi.fn(
      implementation ??
        (() =>
          Object.freeze({
            deploymentLocalDate: '2026-07-29',
            activeLocations: Object.freeze([
              Object.freeze({
                id: locationId,
                name: 'Central Church'
              })
            ])
          }))
    )
  } as unknown as ScreeningSessionWorkspaceContextService
}

function createActiveContext(role: LocalUserRole): ActiveLocalSessionContext {
  return Object.freeze({
    user: Object.freeze({
      id: userId,
      username: 'admin',
      usernameNormalized: 'admin',
      displayName: 'Admin User',
      role,
      isActive: true,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    }) as unknown as LocalUserRecord,
    authenticatedAt: timestamp,
    lastActivityAt: timestamp,
    idleExpiresAt: '2026-07-29T12:49:56.789Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-07-30T00:34:56.789Z' as UtcTimestamp
  })
}

function createSession(overrides: Partial<ScreeningSessionRecord> = {}): ScreeningSessionRecord {
  const status = overrides.status ?? 'OPEN'

  return Object.freeze({
    id: sessionId,
    locationId,
    protocolVersionId,
    sessionDate: '2026-07-29' as ScreeningSessionRecord['sessionDate'],
    status,
    notes: sensitiveNote,
    openedBy: userId,
    openedAt: timestamp,
    closedBy: status === 'CLOSED' ? userId : null,
    closedAt: status === 'CLOSED' ? timestamp : null,
    createdBy: userId,
    createdAt: timestamp,
    updatedBy: userId,
    updatedAt: timestamp,
    rowVersion: status === 'CLOSED' ? 2 : 1,
    ...overrides
  })
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

function createLogger(): TestLogger {
  return {
    warn: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>()
  } as TestLogger
}

function expectLogsAreSafe(logger: TestLogger): void {
  const logs = logger.warn.mock.calls.concat(logger.error.mock.calls).join('\n')

  expect(logs).not.toContain(sensitiveNote)
  expect(logs).not.toContain(sensitiveReason)
  expect(logs).not.toContain('SELECT')
  expect(logs).not.toContain('C:\\')
  expect(logs).not.toContain('payload')
}
