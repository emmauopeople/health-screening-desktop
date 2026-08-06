import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createProductionFirstRunBootstrapService,
  createProductionLocalAuthenticationSessionService,
  createScreeningSessionService,
  createScreeningSessionWorkspaceContextService,
  type ActiveLocalSessionContext,
  type LocalAuthenticationSessionService
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  createProtocolVersionRepository,
  createScreeningSessionOutboxRepository,
  createScreeningSessionRepository,
  type DatabaseTransactionLogger,
  type LocalUserRole
} from '@main/database'
import { createEntityIdGenerator, type EntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import { createScreeningSessionIpcHandlers } from '@main/ipc/handlers/screening-session-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'

const temporaryPassword = 'TemporaryPassw0rd!'
const replacementPassword = 'ReplacementPassw0rd!'
const protocolVersionId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const createdHistoryId = '33333333-3333-4333-8333-333333333333'
const createdAuditId = '44444444-4444-4444-8444-444444444444'
const createdOutboxId = '55555555-5555-4555-8555-555555555555'
const closedHistoryId = '66666666-6666-4666-8666-666666666666'
const closedAuditId = '77777777-7777-4777-8777-777777777777'
const closedOutboxId = '88888888-8888-4888-8888-888888888888'
const reopenedHistoryId = '99999999-9999-4999-8999-999999999999'
const reopenedAuditId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const reopenedOutboxId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const activeLocationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const inactiveLocationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const clockTimestamp = '2026-07-29T00:30:00.000Z'
const closeTimestamp = '2026-07-29T01:30:00.000Z'
const reopenTimestamp = '2026-07-29T02:30:00.000Z'
const sensitiveNote = 'Private mobile setup note'
const sensitiveReason = 'Private lifecycle reason'

describe('screening-session IPC integration boundary', () => {
  it('exposes workspace context and lifecycle operations through authenticated handlers', async () => {
    await withScreeningSessionIpc(async ({ connection, handlers, initialLocationId }) => {
      const context = await handlers.getWorkspaceContext(createAllowedEvent(), {})

      expect(context).toEqual({
        ok: true,
        data: {
          deploymentLocalDate: '2026-07-28',
          activeLocations: [
            { id: activeLocationId, name: 'Alpha Site' },
            { id: initialLocationId, name: 'Central Church' }
          ]
        }
      })
      expect(JSON.stringify(context)).not.toContain(inactiveLocationId)

      const createResult = await handlers.create(createAllowedEvent(), {
        locationId: initialLocationId,
        sessionDate: '2026-07-28',
        notes: sensitiveNote
      })

      expect(createResult).toMatchObject({
        ok: true,
        data: {
          status: 'CREATED',
          session: {
            id: sessionId,
            locationId: initialLocationId,
            protocolVersionId,
            status: 'OPEN',
            rowVersion: 1,
            notes: sensitiveNote
          }
        }
      })
      expect(JSON.stringify(createResult)).not.toContain('openedBy')
      expect(readLifecycleTransitions(connection)).toEqual(['CREATED'])
      expect(readScreeningAuditActions(connection)).toEqual(['SCREENING_SESSION_CREATED'])
      expect(readScreeningOutboxOperations(connection)).toEqual(['SCREENING_SESSION_CREATED'])

      await expect(
        handlers.list(createAllowedEvent(), {
          locationId: null,
          status: null,
          dateFrom: null,
          dateTo: null,
          page: 1,
          pageSize: 25
        })
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: 'LISTED',
          total: 1,
          items: [{ id: sessionId, rowVersion: 1 }]
        }
      })

      await expect(
        handlers.close(createAllowedEvent(), {
          id: sessionId,
          expectedRowVersion: 1,
          reason: sensitiveReason
        })
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: 'CLOSED',
          session: {
            id: sessionId,
            status: 'CLOSED',
            rowVersion: 2,
            closedAt: closeTimestamp
          }
        }
      })

      const screenerHandlers = createHandlers({
        connection,
        authenticationSessionService: createFakeAuthenticationSessionService({
          userId: readAdminId(connection),
          role: 'TRAINED_SCREENER'
        }),
        ids: ['12121212-1212-4212-8212-121212121212'],
        timestamps: ['2026-07-29T03:30:00.000Z']
      })

      await expect(
        screenerHandlers.reopen(createAllowedEvent(), {
          id: sessionId,
          expectedRowVersion: 2,
          reason: sensitiveReason
        })
      ).resolves.toEqual({ ok: true, data: { status: 'FORBIDDEN' } })
      expect(readRawSession(connection)).toMatchObject({ status: 'CLOSED', row_version: 2 })
      expect(readLifecycleTransitions(connection)).toEqual(['CREATED', 'CLOSED'])

      await expect(
        handlers.reopen(createAllowedEvent(), {
          id: sessionId,
          expectedRowVersion: 2,
          reason: sensitiveReason
        })
      ).resolves.toMatchObject({
        ok: true,
        data: {
          status: 'REOPENED',
          session: {
            id: sessionId,
            status: 'OPEN',
            rowVersion: 3,
            closedAt: null
          }
        }
      })

      expect(readLifecycleTransitions(connection)).toEqual(['CREATED', 'CLOSED', 'REOPENED'])
      expect(readScreeningAuditActions(connection)).toEqual([
        'SCREENING_SESSION_CREATED',
        'SCREENING_SESSION_CLOSED',
        'SCREENING_SESSION_REOPENED'
      ])
      expect(readScreeningOutboxOperations(connection)).toEqual([
        'SCREENING_SESSION_CREATED',
        'SCREENING_SESSION_CLOSED',
        'SCREENING_SESSION_REOPENED'
      ])
    })
  }, 20000)

  it('performs no writes for untrusted sender or invalid requests', async () => {
    await withScreeningSessionIpc(async ({ connection, handlers, initialLocationId }) => {
      await expect(
        handlers.create(createForbiddenEvent(), {
          locationId: initialLocationId,
          sessionDate: '2026-07-28',
          notes: sensitiveNote
        })
      ).resolves.toMatchObject({ ok: false, error: { code: 'IPC_FORBIDDEN' } })
      await expect(
        handlers.create(createAllowedEvent(), {
          locationId: initialLocationId,
          sessionDate: '2026-07-28',
          notes: sensitiveNote,
          protocolVersionId
        })
      ).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } })

      expect(readTableCount(connection, 'screening_sessions')).toBe(0)
      expect(readLifecycleTransitions(connection)).toEqual([])
      expect(readScreeningAuditActions(connection)).toEqual([])
      expect(readScreeningOutboxOperations(connection)).toEqual([])
    })
  }, 20000)
})

interface IpcHarness {
  readonly connection: Database.Database
  readonly handlers: ReturnType<typeof createScreeningSessionIpcHandlers>
  readonly initialLocationId: string
}

async function withScreeningSessionIpc(
  test: (harness: IpcHarness) => Promise<void> | void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd028-screening-session-ipc-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)
  const logger = createLogger()

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger,
      clock: createUtcClock(() => clockTimestamp)
    })(connection)

    const firstRunService = createProductionFirstRunBootstrapService({
      connection,
      logger
    })
    await firstRunService.initialize({
      deploymentName: 'Cameroon Pilot',
      timeZone: 'America/Chicago',
      administrator: {
        username: 'Admin.User',
        displayName: 'Admin User',
        temporaryPassword
      },
      initialLocation: {
        name: 'Central Church',
        locationType: 'CHURCH',
        village: 'Messa',
        subdivision: 'Yaounde I',
        region: 'Centre',
        directions: 'Opposite market gate.'
      }
    })

    const authenticationSessionService = await createProductionLocalAuthenticationSessionService({
      connection,
      logger
    })
    await authenticationSessionService.login({
      username: 'Admin.User',
      password: temporaryPassword
    })
    await authenticationSessionService.changeRequiredPassword({
      currentPassword: temporaryPassword,
      newPassword: replacementPassword,
      confirmNewPassword: replacementPassword
    })

    const initialLocationId = readInitialLocationId(connection)
    insertLocation(connection, {
      id: activeLocationId,
      name: 'Alpha Site',
      isActive: true
    })
    insertLocation(connection, {
      id: inactiveLocationId,
      name: 'Inactive Site',
      isActive: false
    })
    insertProtocolVersion(connection)

    await test({
      connection,
      handlers: createHandlers({
        connection,
        authenticationSessionService,
        ids: [
          sessionId,
          createdHistoryId,
          createdAuditId,
          createdOutboxId,
          closedHistoryId,
          closedAuditId,
          closedOutboxId,
          reopenedHistoryId,
          reopenedAuditId,
          reopenedOutboxId
        ],
        timestamps: [clockTimestamp, closeTimestamp, reopenTimestamp]
      }),
      initialLocationId
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createHandlers({
  connection,
  authenticationSessionService,
  ids,
  timestamps
}: {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly ids: readonly string[]
  readonly timestamps: readonly string[]
}): ReturnType<typeof createScreeningSessionIpcHandlers> {
  const idQueue = [...ids]
  const timestampQueue = [...timestamps]
  const screeningSessionService = createScreeningSessionService({
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    protocolVersionRepository: createProtocolVersionRepository(connection),
    screeningSessionRepository: createScreeningSessionRepository(connection),
    screeningSessionOutboxRepository: createScreeningSessionOutboxRepository(connection),
    auditEventRepository: createAuditEventRepository(connection),
    transactionExecutor: createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => {
        const next = idQueue.shift()

        if (next === undefined) {
          throw new Error('No screening-session IPC test ID remains.')
        }

        return next
      }),
      clock: createUtcClock(() => {
        const next = timestampQueue.shift()

        if (next === undefined) {
          throw new Error('No screening-session IPC test timestamp remains.')
        }

        return next
      }),
      logger: createLogger()
    })
  })
  const workspaceContextService = createScreeningSessionWorkspaceContextService({
    installationRepository: createInstallationRepository(connection),
    locationRepository: createLocationRepository(connection),
    clock: createUtcClock(() => clockTimestamp)
  })

  return createScreeningSessionIpcHandlers({
    navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
    authenticationSessionService,
    screeningSessionService,
    screeningSessionWorkspaceContextService: workspaceContextService,
    logger: createLogger()
  })
}

function createFakeAuthenticationSessionService({
  userId,
  role
}: {
  readonly userId: EntityId
  readonly role: LocalUserRole
}): LocalAuthenticationSessionService {
  const context: ActiveLocalSessionContext = Object.freeze({
    user: Object.freeze({
      id: userId,
      username: 'screener',
      usernameNormalized: 'screener',
      displayName: 'Screener User',
      role,
      isActive: true,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: clockTimestamp,
      createdAt: clockTimestamp,
      updatedAt: clockTimestamp
    }) as unknown as ActiveLocalSessionContext['user'],
    authenticatedAt: clockTimestamp as UtcTimestamp,
    lastActivityAt: clockTimestamp as UtcTimestamp,
    idleExpiresAt: '2026-07-29T00:45:00.000Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-07-29T12:30:00.000Z' as UtcTimestamp
  })

  return {
    getSnapshot: vi.fn(),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(() => context),
    requireAnyRole: vi.fn(() => context)
  } as unknown as LocalAuthenticationSessionService
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function insertProtocolVersion(connection: Database.Database): void {
  const adminId = readAdminId(connection)

  connection
    .prepare(
      `INSERT INTO protocol_versions (
        id,
        protocol_key,
        version_label,
        status,
        configuration_json,
        checksum,
        imported_by,
        imported_at,
        activated_by,
        activated_at,
        created_at
      ) VALUES (?, 'screening-ipc', 'IPC Test Protocol', 'ACTIVE', '{}', 'checksum-ipc', ?, ?, ?, ?, ?)`
    )
    .run(protocolVersionId, adminId, clockTimestamp, adminId, clockTimestamp, clockTimestamp)
}

function insertLocation(
  connection: Database.Database,
  input: { readonly id: string; readonly name: string; readonly isActive: boolean }
): void {
  const adminId = readAdminId(connection)

  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        village,
        subdivision,
        region,
        directions,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, 'COMMUNITY_SITE', NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.name,
      input.name.toLowerCase(),
      input.isActive ? 1 : 0,
      adminId,
      clockTimestamp,
      adminId,
      clockTimestamp
    )
}

function readInitialLocationId(connection: Database.Database): string {
  const row = connection.prepare("SELECT id FROM locations WHERE name = 'Central Church'").get() as
    { readonly id: string } | undefined

  if (row === undefined) {
    throw new Error('Expected initial location.')
  }

  return row.id
}

function readAdminId(connection: Database.Database): EntityId {
  const row = connection.prepare("SELECT id FROM users WHERE username = 'Admin.User'").get() as
    { readonly id: string } | undefined

  if (row === undefined) {
    throw new Error('Expected admin user.')
  }

  return row.id as EntityId
}

function readRawSession(connection: Database.Database): Record<string, unknown> {
  return connection
    .prepare('SELECT * FROM screening_sessions WHERE id = ?')
    .get(sessionId) as Record<string, unknown>
}

function readLifecycleTransitions(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT transition_type
       FROM screening_session_lifecycle_history
       ORDER BY changed_at ASC, id ASC`
    )
    .all() as Array<{ readonly transition_type: string }>

  return rows.map((row) => row.transition_type)
}

function readScreeningAuditActions(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT action, metadata_json
       FROM audit_log
       WHERE entity_type = 'SCREENING_SESSION'
       ORDER BY rowid`
    )
    .all() as Array<{ readonly action: string; readonly metadata_json: string }>

  for (const row of rows) {
    expect(row.metadata_json).not.toContain(sensitiveNote)
    expect(row.metadata_json).not.toContain(sensitiveReason)
  }

  return rows.map((row) => row.action)
}

function readScreeningOutboxOperations(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT operation, aggregate_type, payload_schema_version
       FROM sync_outbox
       WHERE aggregate_type = 'SCREENING_SESSION'
       ORDER BY rowid`
    )
    .all() as Array<{
    readonly operation: string
    readonly aggregate_type: string
    readonly payload_schema_version: string
  }>

  for (const row of rows) {
    expect(row.aggregate_type).toBe('SCREENING_SESSION')
    expect(row.payload_schema_version).toBe('screening-session.lifecycle.v1')
  }

  return rows.map((row) => row.operation)
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
    readonly total: number
  }

  return row.total
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

function createLogger(): DatabaseTransactionLogger & {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}
