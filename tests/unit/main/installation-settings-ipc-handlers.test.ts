import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import type {
  ActiveLocalSessionContext,
  InstallationLocationService,
  LocalAuthenticationSessionService
} from '@main/application'
import { LocalSessionAuthorizationError, LocalSessionUnauthenticatedError } from '@main/application'
import type {
  LocalUserRecord,
  LocalUserRole,
  LocationRecord,
  LocationRepository
} from '@main/database'
import type { EntityId, UtcTimestamp } from '@main/foundation'
import {
  createInstallationSettingsIpcHandlers,
  type InstallationSettingsIpcHandlers,
  type InstallationSettingsIpcOperationalLogger
} from '@main/ipc/handlers/installation-settings-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import { createInstallationSettingsFailure } from '@shared/ipc'

const userId = '22222222-2222-4222-8222-222222222222' as EntityId
const locationId = '33333333-3333-4333-8333-333333333333' as EntityId
const secondLocationId = '44444444-4444-4444-8444-444444444444' as EntityId
const timestamp = '2026-08-11T12:34:56.789Z' as UtcTimestamp

describe('installation-settings IPC handlers', () => {
  it('authorizes local administrators and delegates to the approved P0 service boundary', async () => {
    const harness = createHarness()

    await expect(harness.handlers.getConfiguredLocation(createAllowedEvent(), {})).resolves.toEqual(
      {
        ok: true,
        data: {
          status: 'RESOLVED',
          location: { id: locationId, name: 'Bastos Hall' }
        }
      }
    )
    await expect(harness.handlers.listEligibleLocations(createAllowedEvent(), {})).resolves.toEqual(
      {
        ok: true,
        data: {
          status: 'LISTED',
          locations: [
            { id: locationId, name: 'Bastos Hall' },
            { id: secondLocationId, name: 'Central Church' }
          ]
        }
      }
    )
    await expect(
      harness.handlers.assignInitialLocation(createAllowedEvent(), { locationId })
    ).resolves.toMatchObject({ ok: true, data: { status: 'ASSIGNED' } })
    await expect(
      harness.handlers.reconfigureLocation(createAllowedEvent(), { locationId: secondLocationId })
    ).resolves.toMatchObject({ ok: true, data: { status: 'UPDATED' } })

    expect(harness.authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
      'LOCAL_ADMIN'
    ])
    expect(
      harness.installationLocationService.resolveConfiguredInstallationLocation
    ).toHaveBeenCalledOnce()
    expect(harness.locationRepository.listActive).toHaveBeenCalledOnce()
    expect(
      harness.installationLocationService.assignInitialInstallationLocation
    ).toHaveBeenCalledWith({
      locationId
    })
    expect(
      harness.installationLocationService.reconfigureInstallationLocation
    ).toHaveBeenCalledWith({
      locationId: secondLocationId
    })
  })

  it('rejects untrusted senders before parsing or service execution', async () => {
    const harness = createHarness()
    let inspected = false
    const request = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          inspected = true
          throw new Error('proxy leaked location payload')
        }
      }
    )

    await expect(
      harness.handlers.assignInitialLocation(createForbiddenEvent(), request)
    ).resolves.toEqual(createInstallationSettingsFailure('IPC_FORBIDDEN'))
    expect(inspected).toBe(false)
    expect(
      harness.installationLocationService.assignInitialInstallationLocation
    ).not.toHaveBeenCalled()
  })

  it('rejects unauthorized direct invocation before parsing request authority', async () => {
    const harness = createHarness({ role: 'NURSE' })
    let inspected = false
    const request = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          inspected = true
          throw new Error('proxy leaked role payload')
        }
      }
    )

    await expect(
      harness.handlers.reconfigureLocation(createAllowedEvent(), request)
    ).resolves.toEqual(createInstallationSettingsFailure('AUTHORIZATION_FAILED'))
    expect(inspected).toBe(false)
    expect(
      harness.installationLocationService.reconfigureInstallationLocation
    ).not.toHaveBeenCalled()
  })

  it('maps missing authentication to a sanitized authentication failure', async () => {
    const harness = createHarness({ authError: new LocalSessionUnauthenticatedError() })

    await expect(harness.handlers.getConfiguredLocation(createAllowedEvent(), {})).resolves.toEqual(
      createInstallationSettingsFailure('AUTH_UNAUTHENTICATED')
    )
    expect(
      harness.installationLocationService.resolveConfiguredInstallationLocation
    ).not.toHaveBeenCalled()
  })

  it('strictly rejects empty, malformed, and authority-bearing mutation requests', async () => {
    for (const request of [
      {},
      { locationId: '' },
      { locationId: 'not-a-uuid' },
      { locationId, role: 'LOCAL_ADMIN' },
      { locationId, actor: { userId, role: 'LOCAL_ADMIN' } },
      { locationId, userId },
      { locationId, installationId: locationId },
      { locationId, force: true },
      { locationId, bypass: true },
      { locationId, timestamp }
    ]) {
      const harness = createHarness()

      await expect(
        harness.handlers.assignInitialLocation(createAllowedEvent(), request)
      ).resolves.toEqual(createInstallationSettingsFailure('VALIDATION_FAILED'))
      await expect(
        harness.handlers.reconfigureLocation(createAllowedEvent(), request)
      ).resolves.toEqual(createInstallationSettingsFailure('VALIDATION_FAILED'))
      expect(
        harness.installationLocationService.assignInitialInstallationLocation
      ).not.toHaveBeenCalled()
      expect(
        harness.installationLocationService.reconfigureInstallationLocation
      ).not.toHaveBeenCalled()
    }
  })

  it('maps controlled P0 active-work and idempotent results without raw details', async () => {
    const activeWorkHarness = createHarness({
      reconfigureLocation: () => ({ status: 'ACTIVE_SCREENING_WORK' })
    })
    const unchangedHarness = createHarness({
      assignInitialLocation: () => ({
        status: 'UNCHANGED',
        location: { id: locationId, displayName: 'Bastos Hall' as never }
      })
    })

    await expect(
      activeWorkHarness.handlers.reconfigureLocation(createAllowedEvent(), {
        locationId: secondLocationId
      })
    ).resolves.toEqual({
      ok: true,
      data: { status: 'ACTIVE_SCREENING_WORK' }
    })
    await expect(
      unchangedHarness.handlers.assignInitialLocation(createAllowedEvent(), { locationId })
    ).resolves.toEqual({
      ok: true,
      data: {
        status: 'UNCHANGED',
        location: { id: locationId, name: 'Bastos Hall' }
      }
    })
  })

  it('sanitizes unexpected repository and service failures', async () => {
    const listHarness = createHarness({
      listActive: () => {
        throw new Error('C:\\secret\\screening.sqlite SELECT * FROM locations')
      }
    })
    const serviceHarness = createHarness({
      assignInitialLocation: () => {
        throw new Error('sqlite raw location failure')
      }
    })

    await expect(
      listHarness.handlers.listEligibleLocations(createAllowedEvent(), {})
    ).resolves.toEqual(createInstallationSettingsFailure('INTERNAL_ERROR'))
    await expect(
      serviceHarness.handlers.assignInitialLocation(createAllowedEvent(), { locationId })
    ).resolves.toEqual(createInstallationSettingsFailure('INTERNAL_ERROR'))
    expectLogsAreSafe(listHarness.logger)
    expectLogsAreSafe(serviceHarness.logger)
  })
})

interface HandlerOverrides {
  readonly role?: LocalUserRole
  readonly authError?: Error | null
  readonly resolveConfigured?: InstallationLocationService['resolveConfiguredInstallationLocation']
  readonly assignInitialLocation?: InstallationLocationService['assignInitialInstallationLocation']
  readonly reconfigureLocation?: InstallationLocationService['reconfigureInstallationLocation']
  readonly listActive?: LocationRepository['listActive']
}

interface HandlerHarness {
  readonly handlers: InstallationSettingsIpcHandlers
  readonly authenticationSessionService: LocalAuthenticationSessionService & {
    requireAnyRole: ReturnType<typeof vi.fn>
  }
  readonly installationLocationService: InstallationLocationService & {
    resolveConfiguredInstallationLocation: ReturnType<typeof vi.fn>
    assignInitialInstallationLocation: ReturnType<typeof vi.fn>
    reconfigureInstallationLocation: ReturnType<typeof vi.fn>
  }
  readonly locationRepository: LocationRepository & {
    listActive: ReturnType<typeof vi.fn>
  }
  readonly logger: TestLogger
}

interface TestLogger extends InstallationSettingsIpcOperationalLogger {
  warn: InstallationSettingsIpcOperationalLogger['warn'] & { mock: { calls: unknown[][] } }
  error: InstallationSettingsIpcOperationalLogger['error'] & { mock: { calls: unknown[][] } }
}

function createHarness(overrides: HandlerOverrides = {}): HandlerHarness {
  const logger = createLogger()
  const authenticationSessionService = createAuthenticationSessionService(
    overrides.role ?? 'LOCAL_ADMIN',
    overrides.authError
  )
  const installationLocationService = createInstallationLocationService(overrides)
  const locationRepository = createLocationRepository(overrides)
  const handlers = createInstallationSettingsIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    authenticationSessionService,
    installationLocationService,
    locationRepository,
    logger
  })

  return {
    handlers,
    authenticationSessionService,
    installationLocationService,
    locationRepository,
    logger
  }
}

function createInstallationLocationService(
  overrides: HandlerOverrides
): HandlerHarness['installationLocationService'] {
  return {
    resolveConfiguredInstallationLocation: vi.fn(
      overrides.resolveConfigured ??
        (() => ({
          status: 'RESOLVED',
          location: { id: locationId, displayName: 'Bastos Hall' }
        }))
    ),
    assignInitialInstallationLocation: vi.fn(
      overrides.assignInitialLocation ??
        (() => ({
          status: 'ASSIGNED',
          location: { id: locationId, displayName: 'Bastos Hall' }
        }))
    ),
    reconfigureInstallationLocation: vi.fn(
      overrides.reconfigureLocation ??
        (() => ({
          status: 'UPDATED',
          location: { id: secondLocationId, displayName: 'Central Church' }
        }))
    )
  } as unknown as HandlerHarness['installationLocationService']
}

function createLocationRepository(
  overrides: HandlerOverrides
): HandlerHarness['locationRepository'] {
  return {
    listActive: vi.fn(overrides.listActive ?? (() => [createLocation(), createSecondLocation()]))
  } as unknown as HandlerHarness['locationRepository']
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
    idleExpiresAt: '2026-08-11T12:49:56.789Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-08-12T00:34:56.789Z' as UtcTimestamp
  })
}

function createLocation(): LocationRecord {
  return Object.freeze({
    id: locationId,
    name: 'Bastos Hall' as never,
    locationType: 'COMMUNITY_SITE',
    village: null,
    subdivision: null,
    region: null,
    directions: null,
    isActive: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: userId,
    updatedBy: userId
  })
}

function createSecondLocation(): LocationRecord {
  return Object.freeze({
    ...createLocation(),
    id: secondLocationId,
    name: 'Central Church' as never,
    locationType: 'CHURCH'
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

  expect(logs).not.toContain('secret')
  expect(logs).not.toContain('sqlite')
  expect(logs).not.toContain('SELECT')
  expect(logs).not.toContain('C:\\')
  expect(logs).not.toContain('payload')
}
