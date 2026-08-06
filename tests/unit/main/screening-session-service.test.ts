import { describe, expect, it, vi } from 'vitest'

import {
  createScreeningSessionService,
  ScreeningSessionServicePersistenceError,
  ScreeningSessionServiceStateIntegrityError,
  ScreeningSessionServiceValidationError,
  type ScreeningSessionService,
  type ScreeningSessionServiceActor,
  type ScreeningSessionServiceDependencies
} from '@main/application'
import {
  RepositoryDataIntegrityError,
  parseDeploymentName,
  parseIanaTimeZone,
  parseScreeningSessionDate,
  type AuditEventRepository,
  type InstallationRecord,
  type InstallationRepository,
  type LocationRecord,
  type LocationRepository,
  type ProtocolVersionRepository,
  type ScreeningSessionOutboxRepository,
  type ScreeningSessionRecord,
  type ScreeningSessionRepository
} from '@main/database'
import type {
  DatabaseTransactionConnection,
  DatabaseTransactionContext,
  DatabaseTransactionExecutor
} from '@main/database/transaction'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

const installationId = parseEntityId('11111111-1111-4111-8111-111111111111')
const adminId = parseEntityId('22222222-2222-4222-8222-222222222222')
const nurseId = parseEntityId('33333333-3333-4333-8333-333333333333')
const screenerId = parseEntityId('44444444-4444-4444-8444-444444444444')
const locationId = parseEntityId('55555555-5555-4555-8555-555555555555')
const protocolVersionId = parseEntityId('66666666-6666-4666-8666-666666666666')
const sessionId = parseEntityId('77777777-7777-4777-8777-777777777777')
const lifecycleHistoryId = parseEntityId('88888888-8888-4888-8888-888888888888')
const auditId = parseEntityId('99999999-9999-4999-8999-999999999999')
const outboxId = parseEntityId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
const now = parseUtcTimestamp('2026-07-29T12:34:56.789Z')
const proxyLeakText = 'proxy leaked C:\\secret\\screening-session.sqlite SELECT reason'
const sensitiveText = 'Sensitive screening note value'

const adminActor: ScreeningSessionServiceActor = Object.freeze({
  userId: adminId,
  role: 'LOCAL_ADMIN'
})
const nurseActor: ScreeningSessionServiceActor = Object.freeze({
  userId: nurseId,
  role: 'NURSE'
})
const screenerActor: ScreeningSessionServiceActor = Object.freeze({
  userId: screenerId,
  role: 'TRAINED_SCREENER'
})

describe('screening session service', () => {
  it('accepts exact creation requests and rejects caller-generated fields', () => {
    const harness = createHarness()

    const result = harness.service.create(createCreateRequest(), adminActor)

    expect(result).toMatchObject({
      status: 'CREATED',
      session: {
        id: sessionId,
        locationId,
        protocolVersionId,
        sessionDate: '2026-07-29',
        rowVersion: 1
      }
    })
    expect(harness.screeningSessionRepository.insert).toHaveBeenCalledWith(
      harness.connection,
      expect.objectContaining({
        id: sessionId,
        lifecycleHistoryId,
        protocolVersionId,
        createdBy: adminId,
        createdAt: now
      })
    )

    for (const extra of ['protocolVersionId', 'id', 'rowVersion', 'status'] as const) {
      const rejected = captureError(() =>
        harness.service.create(
          { ...createCreateRequest(), [extra]: 'not accepted' } as never,
          adminActor
        )
      )

      expect(rejected).toBeInstanceOf(ScreeningSessionServiceValidationError)
    }
  })

  it('validates actors as trusted exact transport objects', () => {
    const harness = createHarness()
    const inherited = Object.create({ role: 'LOCAL_ADMIN' }) as Record<string, unknown>
    inherited.userId = adminId
    const symbolActor = { ...adminActor, [Symbol('role')]: 'LOCAL_ADMIN' }
    const customPrototypeActor = Object.create({ leaked: true }) as Record<string, unknown>
    Object.assign(customPrototypeActor, adminActor)

    for (const actor of [
      { ...adminActor, extra: true },
      inherited,
      symbolActor,
      customPrototypeActor,
      createInspectionThrowingProxy({ ...adminActor }, 'getPrototypeOf'),
      createInspectionThrowingProxy({ ...adminActor }, 'ownKeys'),
      createInspectionThrowingProxy({ ...adminActor }, 'getOwnPropertyDescriptor')
    ]) {
      const error = captureError(() => harness.service.getById({ id: sessionId }, actor as never))

      expect(error).toBeInstanceOf(ScreeningSessionServiceValidationError)
      expectSafeControlledError(error)
    }
  })

  it('enforces operation authorization without trusting renderer-supplied roles', () => {
    for (const actor of [adminActor, nurseActor, screenerActor]) {
      expect(createHarness().service.create(createCreateRequest(), actor).status).toBe('CREATED')
      expect(createHarness().service.close(createCloseRequest(), actor).status).toBe('CLOSED')
      expect(createHarness().service.getById({ id: sessionId }, actor).status).toBe('FOUND')
      expect(createHarness().service.list(createListRequest(), actor).status).toBe('LISTED')
    }

    const screenerHarness = createHarness()

    expect(screenerHarness.service.reopen(createReopenRequest(), screenerActor)).toEqual({
      status: 'FORBIDDEN'
    })
    expect(screenerHarness.screeningSessionRepository.reopen).not.toHaveBeenCalled()

    for (const actor of [adminActor, nurseActor]) {
      const harness = createHarness()

      expect(harness.service.reopen(createReopenRequest(), actor).status).toBe('REOPENED')
      expect(harness.screeningSessionRepository.reopen).toHaveBeenCalledTimes(1)
    }
  })

  it('derives the permitted session date from the deployment IANA timezone', () => {
    expect(
      createHarness({
        now: parseUtcTimestamp('2026-07-29T23:30:00.000Z'),
        timeZone: 'Africa/Douala'
      }).service.create(
        createCreateRequest({ sessionDate: parseScreeningSessionDate('2026-07-30') }),
        adminActor
      ).status
    ).toBe('CREATED')
    expect(
      createHarness({
        now: parseUtcTimestamp('2026-07-29T23:30:00.000Z'),
        timeZone: 'Africa/Douala'
      }).service.create(createCreateRequest(), adminActor).status
    ).toBe('SESSION_DATE_NOT_CURRENT')
    expect(
      createHarness({
        now: parseUtcTimestamp('2026-03-08T05:30:00.000Z'),
        timeZone: 'America/Chicago'
      }).service.create(
        createCreateRequest({ sessionDate: parseScreeningSessionDate('2026-03-07') }),
        adminActor
      ).status
    ).toBe('CREATED')
    expect(
      createHarness({
        now: parseUtcTimestamp('2026-07-29T23:30:00.000Z'),
        timeZone: 'Etc/GMT-3'
      }).service.create(
        createCreateRequest({ sessionDate: parseScreeningSessionDate('2026-07-30') }),
        adminActor
      ).status
    ).toBe('CREATED')
  })

  it('contains invalid stored timezone failures without falling back', () => {
    const harness = createHarness({ unsafeTimeZone: 'Invalid/Zone' })
    const error = captureError(() => harness.service.create(createCreateRequest(), adminActor))

    expect(error).toBeInstanceOf(ScreeningSessionServiceStateIntegrityError)
    expectSafeControlledError(error)
    expect(JSON.stringify(error)).not.toContain('Invalid/Zone')
    expect(harness.screeningSessionRepository.insert).not.toHaveBeenCalled()
  })

  it('validates notes and transition reasons before repository writes', () => {
    const supplementary = '\u{1f642}'.repeat(500)

    expect(
      createHarness().service.create(createCreateRequest({ notes: supplementary }), adminActor)
        .status
    ).toBe('CREATED')
    expect(
      createHarness().service.close({ ...createCloseRequest(), reason: undefined }, adminActor)
        .status
    ).toBe('CLOSED')

    for (const request of [
      createCreateRequest({ notes: `${supplementary}\u{1f642}` }),
      createCreateRequest({ notes: '\n' }),
      createCreateRequest({ notes: '\ud800' })
    ]) {
      const harness = createHarness()
      const error = captureError(() => harness.service.create(request, adminActor))

      expect(error).toBeInstanceOf(ScreeningSessionServiceValidationError)
      expect(harness.screeningSessionRepository.insert).not.toHaveBeenCalled()
    }

    expect(() =>
      createHarness().service.close({ ...createCloseRequest(), reason: '   ' }, adminActor)
    ).toThrow(ScreeningSessionServiceValidationError)
    expect(() =>
      createHarness().service.reopen({ ...createReopenRequest(), reason: '' }, adminActor)
    ).toThrow(ScreeningSessionServiceValidationError)
  })

  it('rejects unsafe transition versions before repository writes', () => {
    const harness = createHarness()

    expect(() =>
      harness.service.close(
        { ...createCloseRequest(), expectedRowVersion: Number.MAX_SAFE_INTEGER },
        adminActor
      )
    ).toThrow(ScreeningSessionServiceValidationError)
    expect(() =>
      harness.service.reopen(
        { ...createReopenRequest(), expectedRowVersion: Number.MAX_SAFE_INTEGER },
        adminActor
      )
    ).toThrow(ScreeningSessionServiceValidationError)
    expect(harness.screeningSessionRepository.close).not.toHaveBeenCalled()
    expect(harness.screeningSessionRepository.reopen).not.toHaveBeenCalled()
  })

  it('maps business results safely and freezes returned envelopes', () => {
    const conflictSession = createSession({ rowVersion: 2 })
    const harness = createHarness({
      closeResult: { status: 'SESSION_VERSION_CONFLICT', session: conflictSession },
      listResult: {
        items: Object.freeze([conflictSession]),
        page: 1,
        pageSize: 25,
        total: 1
      }
    })

    const close = harness.service.close(createCloseRequest(), adminActor)
    const list = harness.service.list(createListRequest(), adminActor)

    expect(close).toEqual({ status: 'SESSION_VERSION_CONFLICT', session: conflictSession })
    expect(Object.isFrozen(close)).toBe(true)
    expect(list).toEqual({
      status: 'LISTED',
      items: [conflictSession],
      page: 1,
      pageSize: 25,
      total: 1
    })
    expect(Object.isFrozen(list)).toBe(true)
    expect(Object.isFrozen(list.items)).toBe(true)
  })

  it('maps repository failures to sanitized service errors', () => {
    const dataError = captureError(() =>
      createHarness({
        protocolReadError: new RepositoryDataIntegrityError('SqliteError')
      }).service.create(createCreateRequest(), adminActor)
    )
    const writeError = captureError(() =>
      createHarness({
        outboxError: new Error(`INSERT ${sensitiveText} C:\\secret\\sync_outbox.sqlite`)
      }).service.create(createCreateRequest({ notes: sensitiveText }), adminActor)
    )

    expect(dataError).toBeInstanceOf(ScreeningSessionServiceStateIntegrityError)
    expect(writeError).toBeInstanceOf(ScreeningSessionServicePersistenceError)
    expectSafeControlledError(dataError)
    expectSafeControlledError(writeError)
    expect(JSON.stringify(writeError)).not.toContain(sensitiveText)
  })
})

type InspectionTrap = 'getPrototypeOf' | 'ownKeys' | 'getOwnPropertyDescriptor'

interface HarnessOptions {
  readonly now?: UtcTimestamp
  readonly timeZone?: string
  readonly unsafeTimeZone?: string
  readonly closeResult?: ReturnType<ScreeningSessionRepository['close']>
  readonly reopenResult?: ReturnType<ScreeningSessionRepository['reopen']>
  readonly listResult?: ReturnType<ScreeningSessionRepository['list']>
  readonly protocolReadError?: Error
  readonly outboxError?: Error
}

interface Harness {
  readonly service: ScreeningSessionService
  readonly connection: DatabaseTransactionConnection
  readonly screeningSessionRepository: ScreeningSessionRepository & {
    readonly insert: ReturnType<typeof vi.fn<ScreeningSessionRepository['insert']>>
    readonly close: ReturnType<typeof vi.fn<ScreeningSessionRepository['close']>>
    readonly reopen: ReturnType<typeof vi.fn<ScreeningSessionRepository['reopen']>>
  }
}

function createHarness(options: HarnessOptions = {}): Harness {
  const connection = Object.freeze({}) as DatabaseTransactionConnection
  const ids = [sessionId, lifecycleHistoryId, auditId, outboxId]
  const context: DatabaseTransactionContext = Object.freeze({
    connection,
    nowUtc: () => options.now ?? now,
    newEntityId: () => {
      const next = ids.shift()

      if (next === undefined) {
        throw new Error('No test ID available.')
      }

      return next
    }
  })
  const installationRepository: InstallationRepository = Object.freeze({
    get: vi.fn(() => createInstallation(options)),
    getState: vi.fn(),
    insert: vi.fn()
  } as unknown as InstallationRepository)
  const locationRepository: LocationRepository = Object.freeze({
    hasAny: vi.fn(),
    getById: vi.fn(),
    getByIdForWrite: vi.fn(() => createLocation()),
    listAll: vi.fn(),
    listActive: vi.fn(),
    insert: vi.fn()
  } as unknown as LocationRepository)
  const protocolVersionRepository: ProtocolVersionRepository = Object.freeze({
    getByIdForWrite: vi.fn(),
    getActiveForWrite: vi.fn(() => {
      if (options.protocolReadError !== undefined) {
        throw options.protocolReadError
      }

      return Object.freeze({ id: protocolVersionId, status: 'ACTIVE' as const })
    })
  })
  const screeningSessionRepository: Harness['screeningSessionRepository'] = Object.freeze({
    getById: vi.fn(() => createSession()),
    getByIdForWrite: vi.fn(() => createSession()),
    list: vi.fn(
      () =>
        options.listResult ??
        Object.freeze({ items: Object.freeze([]), page: 1, pageSize: 25, total: 0 })
    ),
    insert: vi.fn((_, input) =>
      createSession({
        id: input.id,
        locationId: input.locationId,
        protocolVersionId: input.protocolVersionId,
        sessionDate: input.sessionDate,
        notes: input.notes,
        openedBy: input.createdBy,
        createdBy: input.createdBy,
        updatedBy: input.createdBy,
        openedAt: input.createdAt,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
    ),
    close: vi.fn(
      () =>
        options.closeResult ??
        Object.freeze({
          status: 'CLOSED' as const,
          session: createSession({
            status: 'CLOSED',
            rowVersion: 2,
            closedBy: adminId,
            closedAt: now,
            updatedBy: adminId,
            updatedAt: now
          })
        })
    ),
    reopen: vi.fn(
      () =>
        options.reopenResult ??
        Object.freeze({
          status: 'REOPENED' as const,
          session: createSession({
            status: 'OPEN',
            rowVersion: 3,
            openedBy: adminId,
            openedAt: now,
            updatedBy: adminId,
            updatedAt: now
          })
        })
    )
  } satisfies ScreeningSessionRepository) as Harness['screeningSessionRepository']
  const auditEventRepository: AuditEventRepository = Object.freeze({
    getById: vi.fn(),
    listRecent: vi.fn(),
    listForEntity: vi.fn(),
    insert: vi.fn((_, input) => Object.freeze({ ...input }))
  } as unknown as AuditEventRepository)
  const screeningSessionOutboxRepository: ScreeningSessionOutboxRepository = Object.freeze({
    insert: vi.fn(() => {
      if (options.outboxError !== undefined) {
        throw options.outboxError
      }
    })
  })
  const transactionExecutor: DatabaseTransactionExecutor = Object.freeze({
    run: vi.fn((work) => work(context))
  })
  const dependencies: ScreeningSessionServiceDependencies = {
    installationRepository,
    locationRepository,
    protocolVersionRepository,
    screeningSessionRepository,
    screeningSessionOutboxRepository,
    auditEventRepository,
    transactionExecutor
  }

  return Object.freeze({
    service: createScreeningSessionService(dependencies),
    connection,
    screeningSessionRepository
  })
}

function createInstallation(options: HarnessOptions = {}): InstallationRecord {
  return Object.freeze({
    id: installationId,
    deploymentName: parseDeploymentName('Local Deployment'),
    timeZone:
      options.unsafeTimeZone === undefined
        ? parseIanaTimeZone(options.timeZone ?? 'UTC')
        : (options.unsafeTimeZone as InstallationRecord['timeZone']),
    createdAt: now,
    updatedAt: now
  })
}

function createLocation(): LocationRecord {
  return Object.freeze({
    id: locationId,
    name: 'Screening Site' as LocationRecord['name'],
    locationType: 'COMMUNITY_SITE',
    village: null,
    subdivision: null,
    region: null,
    directions: null,
    isActive: true,
    createdBy: adminId,
    createdAt: now,
    updatedBy: adminId,
    updatedAt: now
  })
}

function createSession(overrides: Partial<ScreeningSessionRecord> = {}): ScreeningSessionRecord {
  const status = overrides.status ?? 'OPEN'

  return Object.freeze({
    id: overrides.id ?? sessionId,
    locationId: overrides.locationId ?? locationId,
    protocolVersionId: overrides.protocolVersionId ?? protocolVersionId,
    sessionDate: overrides.sessionDate ?? parseScreeningSessionDate('2026-07-29'),
    status,
    notes: Object.prototype.hasOwnProperty.call(overrides, 'notes') ? overrides.notes! : null,
    openedBy: overrides.openedBy ?? adminId,
    openedAt: overrides.openedAt ?? now,
    closedBy: Object.prototype.hasOwnProperty.call(overrides, 'closedBy')
      ? overrides.closedBy!
      : null,
    closedAt: Object.prototype.hasOwnProperty.call(overrides, 'closedAt')
      ? overrides.closedAt!
      : null,
    createdBy: overrides.createdBy ?? adminId,
    createdAt: overrides.createdAt ?? now,
    updatedBy: overrides.updatedBy ?? adminId,
    updatedAt: overrides.updatedAt ?? now,
    rowVersion: overrides.rowVersion ?? (status === 'OPEN' ? 1 : 2)
  })
}

function createCreateRequest(
  overrides: Partial<Parameters<ScreeningSessionService['create']>[0]> = {}
): Parameters<ScreeningSessionService['create']>[0] {
  return Object.freeze({
    locationId,
    sessionDate: parseScreeningSessionDate('2026-07-29'),
    notes: null,
    ...overrides
  })
}

function createCloseRequest(): Parameters<ScreeningSessionService['close']>[0] {
  return Object.freeze({
    id: sessionId,
    expectedRowVersion: 1,
    reason: null
  })
}

function createReopenRequest(): Parameters<ScreeningSessionService['reopen']>[0] {
  return Object.freeze({
    id: sessionId,
    expectedRowVersion: 2,
    reason: 'Reopen requested for the screening day.'
  })
}

function createListRequest(): Parameters<ScreeningSessionService['list']>[0] {
  return Object.freeze({
    locationId: null,
    status: null,
    dateFrom: null,
    dateTo: null,
    page: 1,
    pageSize: 25
  })
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw.')
}

function createInspectionThrowingProxy<T extends object>(target: T, trap: InspectionTrap): T {
  return new Proxy(target, {
    getPrototypeOf(value) {
      if (trap === 'getPrototypeOf') {
        throw new Error(proxyLeakText)
      }

      return Reflect.getPrototypeOf(value)
    },
    ownKeys(value) {
      if (trap === 'ownKeys') {
        throw new Error(proxyLeakText)
      }

      return Reflect.ownKeys(value)
    },
    getOwnPropertyDescriptor(value, property) {
      if (trap === 'getOwnPropertyDescriptor') {
        throw new Error(proxyLeakText)
      }

      return Reflect.getOwnPropertyDescriptor(value, property)
    }
  })
}

function expectSafeControlledError(error: unknown): void {
  expect(JSON.stringify(error)).not.toContain('C:\\')
  expect(JSON.stringify(error)).not.toContain('SELECT')
  expect(JSON.stringify(error)).not.toContain('INSERT')
  expect(JSON.stringify(error)).not.toContain('sqlite')
  expect(JSON.stringify(error)).not.toContain('reason')
  expect(JSON.stringify(error)).not.toContain(proxyLeakText)
  expect((error as { readonly stack?: unknown }).stack).toBeUndefined()
}
