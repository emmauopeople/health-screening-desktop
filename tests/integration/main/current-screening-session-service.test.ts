import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createCurrentScreeningSessionService,
  createInstallationLocationService,
  LocalSessionAuthorizationError,
  LocalSessionUnauthenticatedError,
  type ActiveLocalSessionContext,
  type CurrentScreeningSessionService,
  type LocalAuthenticationSessionService
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  createProtocolVersionRepository,
  createScreeningEncounterRepository,
  createScreeningSessionOutboxRepository,
  createScreeningSessionRepository,
  RepositoryWriteError,
  ScreeningSessionAlreadyExistsError,
  type AuditEventRepository,
  type DatabaseTransactionConnection,
  type LocalUserRecord,
  type LocalUserRole,
  type ScreeningSessionOutboxRepository,
  type ScreeningSessionRepository
} from '@main/database'
import { createEntityIdGenerator, type EntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const installationId = '71000000-0000-4000-8000-000000000001'
const adminId = '71000000-0000-4000-8000-000000000002'
const nurseId = '71000000-0000-4000-8000-000000000003'
const screenerId = '71000000-0000-4000-8000-000000000004'
const locationId = '71000000-0000-4000-8000-000000000006'
const secondLocationId = '71000000-0000-4000-8000-000000000007'
const inactiveLocationId = '71000000-0000-4000-8000-000000000008'
const protocolId = '71000000-0000-4000-8000-000000000009'
const baselineProtocolId = '00000000-0000-4000-8000-000000000007'
const sessionId = '71000000-0000-4000-8000-000000000010'
const secondSessionId = '71000000-0000-4000-8000-000000000011'
const lifecycleHistoryId = '71000000-0000-4000-8000-000000000012'
const auditId = '71000000-0000-4000-8000-000000000013'
const outboxId = '71000000-0000-4000-8000-000000000014'
const secondLifecycleHistoryId = '71000000-0000-4000-8000-000000000015'
const secondAuditId = '71000000-0000-4000-8000-000000000016'
const secondOutboxId = '71000000-0000-4000-8000-000000000017'
const baseTimestamp = '2026-08-10T12:00:00.000Z'
const boundaryTimestamp = '2026-08-10T23:30:00.000Z'
const nextTimestamp = '2026-08-11T12:00:00.000Z'

describe('current screening session service integration', () => {
  it('creates today session from trusted configuration, auth, clock, audit, and outbox', async () => {
    await withCurrentSessionService(({ connection, service, authenticationSessionService }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      const result = service.ensureCurrentScreeningSession()

      expect(result).toEqual({
        status: 'CREATED',
        session: {
          id: sessionId,
          locationId,
          protocolVersionId: protocolId,
          sessionDate: '2026-08-10',
          status: 'OPEN',
          notes: null,
          openedAt: baseTimestamp,
          closedAt: null,
          createdAt: baseTimestamp,
          rowVersion: 1
        },
        location: {
          id: locationId,
          displayName: 'Site One'
        }
      })
      expect(authenticationSessionService.requireAnyRole).toHaveBeenCalledWith([
        'LOCAL_ADMIN',
        'NURSE',
        'TRAINED_SCREENER'
      ])
      expect(readTableCount(connection, 'screening_sessions')).toBe(1)
      expect(readAuditRows(connection)).toEqual([
        expect.objectContaining({
          action: 'SCREENING_SESSION_CREATED',
          entity_id: sessionId
        })
      ])
      expect(readOutboxRows(connection)).toEqual([
        expect.objectContaining({
          operation: 'SCREENING_SESSION_CREATED',
          aggregate_id: sessionId
        })
      ])
    })
  })

  it('creates today session using the migration-provisioned baseline active protocol', async () => {
    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection, { protocol: 'migration-baseline' })
        insertConfiguration(connection, locationId)

        const result = service.ensureCurrentScreeningSession()

        expect(result).toMatchObject({
          status: 'CREATED',
          session: {
            id: sessionId,
            locationId,
            protocolVersionId: baselineProtocolId,
            sessionDate: '2026-08-10',
            status: 'OPEN'
          }
        })
        expect(readTableCount(connection, 'screening_sessions')).toBe(1)
        expect(readAuditRows(connection)).toHaveLength(1)
        expect(readOutboxRows(connection)).toHaveLength(1)
      },
      { preserveBaselineProtocol: true }
    )
  })

  it('returns today existing open session without duplicate session, audit, or outbox rows', async () => {
    await withCurrentSessionService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)
      insertSession(connection, { id: sessionId, locationId, sessionDate: '2026-08-10' })

      const first = service.ensureCurrentScreeningSession()
      const second = service.ensureCurrentScreeningSession()

      expect(first).toMatchObject({ status: 'RESOLVED', session: { id: sessionId } })
      expect(second).toMatchObject({ status: 'RESOLVED', session: { id: sessionId } })
      expect(readTableCount(connection, 'screening_sessions')).toBe(1)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('does not reuse another location session and creates the configured location session', async () => {
    await withCurrentSessionService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertLocation(connection, { id: secondLocationId, name: 'Site Two', isActive: true })
      insertConfiguration(connection, locationId)
      insertSession(connection, {
        id: secondSessionId,
        locationId: secondLocationId,
        sessionDate: '2026-08-10'
      })

      const result = service.ensureCurrentScreeningSession()

      expect(result).toMatchObject({
        status: 'CREATED',
        session: { id: sessionId, locationId, sessionDate: '2026-08-10' }
      })
      expect(readTableCount(connection, 'screening_sessions')).toBe(2)
      expect(readRawSession(connection, secondSessionId)).toMatchObject({
        location_id: secondLocationId,
        status: 'OPEN'
      })
    })
  })

  it('returns SESSION_CLOSED without reopening or replacing the canonical session', async () => {
    await withCurrentSessionService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)
      insertSession(connection, {
        id: sessionId,
        locationId,
        sessionDate: '2026-08-10',
        status: 'CLOSED'
      })

      expect(service.ensureCurrentScreeningSession()).toEqual({ status: 'SESSION_CLOSED' })
      expect(readTableCount(connection, 'screening_sessions')).toBe(1)
      expect(readRawSession(connection, sessionId)).toMatchObject({
        status: 'CLOSED',
        closed_at: baseTimestamp
      })
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('maps configured-location failures without creating records or falling back', async () => {
    await withCurrentSessionService(({ connection, service }) => {
      seedBaseGraph(connection)

      expect(service.ensureCurrentScreeningSession()).toEqual({
        status: 'LOCATION_NOT_CONFIGURED'
      })
      expect(readTableCount(connection, 'screening_sessions')).toBe(0)

      insertConfiguration(connection, inactiveLocationId)
      expect(service.ensureCurrentScreeningSession()).toEqual({ status: 'LOCATION_INACTIVE' })
      expect(readTableCount(connection, 'screening_sessions')).toBe(0)
    })

    await withCurrentSessionService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)
      connection.pragma('foreign_keys = OFF')
      try {
        connection.prepare('DELETE FROM locations WHERE id = ?').run(locationId)
      } finally {
        connection.pragma('foreign_keys = ON')
      }

      expect(service.ensureCurrentScreeningSession()).toEqual({ status: 'LOCATION_NOT_FOUND' })
      expect(readTableCount(connection, 'screening_sessions')).toBe(0)
    })
  })

  it('enforces trusted authentication and screening authorization before creating anything', async () => {
    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        expect(service.ensureCurrentScreeningSession()).toEqual({
          status: 'AUTHENTICATION_REQUIRED'
        })
        expect(readTableCount(connection, 'screening_sessions')).toBe(0)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { authError: new LocalSessionUnauthenticatedError() }
    )

    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        expect(service.ensureCurrentScreeningSession()).toEqual({ status: 'FORBIDDEN' })
        expect(readTableCount(connection, 'screening_sessions')).toBe(0)
      },
      { authError: new LocalSessionAuthorizationError() }
    )
  })

  it('uses the installation timezone for the operational local date', async () => {
    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection, { timeZone: 'Africa/Douala' })
        insertConfiguration(connection, locationId)

        expect(service.ensureCurrentScreeningSession()).toMatchObject({
          status: 'CREATED',
          session: { sessionDate: '2026-08-11' }
        })
      },
      { timestamps: [boundaryTimestamp] }
    )
  })

  it('resolves the next date when the authoritative clock advances', async () => {
    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        const first = service.ensureCurrentScreeningSession()
        const second = service.ensureCurrentScreeningSession()

        expect(first).toMatchObject({
          status: 'CREATED',
          session: { id: sessionId, sessionDate: '2026-08-10' }
        })
        expect(second).toMatchObject({
          status: 'CREATED',
          session: { id: secondSessionId, sessionDate: '2026-08-11' }
        })
        expect(readTableCount(connection, 'screening_sessions')).toBe(2)
      },
      {
        generatedIds: [
          sessionId,
          lifecycleHistoryId,
          auditId,
          outboxId,
          secondSessionId,
          secondLifecycleHistoryId,
          secondAuditId,
          secondOutboxId
        ],
        timestamps: [baseTimestamp, nextTimestamp]
      }
    )
  })

  it('recovers the canonical session when insertion loses the daily uniqueness race', async () => {
    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        const result = service.ensureCurrentScreeningSession()

        expect(result).toMatchObject({
          status: 'RESOLVED',
          session: { id: secondSessionId, locationId, sessionDate: '2026-08-10' }
        })
        expect(readTableCount(connection, 'screening_sessions')).toBe(1)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { insertRace: 'open' }
    )
  })

  it('does not misclassify unrelated write failures as uniqueness races and retry can succeed', async () => {
    await withCurrentSessionService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        expect(service.ensureCurrentScreeningSession()).toEqual({ status: 'UNAVAILABLE' })
        expect(readTableCount(connection, 'screening_sessions')).toBe(0)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { failureMode: 'after-session' }
    )

    await withCurrentSessionService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      expect(service.ensureCurrentScreeningSession()).toMatchObject({ status: 'CREATED' })
      expect(readTableCount(connection, 'screening_sessions')).toBe(1)
    })
  })

  it('rolls back session, audit, and outbox effects together', async () => {
    for (const failureMode of ['after-audit', 'after-outbox'] as const) {
      await withCurrentSessionService(
        ({ connection, service }) => {
          seedBaseGraph(connection)
          insertConfiguration(connection, locationId)

          expect(service.ensureCurrentScreeningSession()).toEqual({ status: 'UNAVAILABLE' })
          expect(readTableCount(connection, 'screening_sessions')).toBe(0)
          expect(readTableCount(connection, 'audit_log')).toBe(0)
          expect(readTableCount(connection, 'sync_outbox')).toBe(0)
        },
        { failureMode }
      )
    }
  })

  it('sequential and concurrent calls return one canonical daily session', async () => {
    await withCurrentSessionService(
      async ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        const sequentialFirst = service.ensureCurrentScreeningSession()
        const sequentialSecond = service.ensureCurrentScreeningSession()
        const concurrent = await Promise.all([
          Promise.resolve().then(() => service.ensureCurrentScreeningSession()),
          Promise.resolve().then(() => service.ensureCurrentScreeningSession())
        ])

        for (const result of [sequentialFirst, sequentialSecond, ...concurrent]) {
          expect(result).toMatchObject({ session: { id: sessionId } })
        }
        expect(readTableCount(connection, 'screening_sessions')).toBe(1)
        expect(readTableCount(connection, 'audit_log')).toBe(1)
        expect(readTableCount(connection, 'sync_outbox')).toBe(1)
      },
      {
        generatedIds: [sessionId, lifecycleHistoryId, auditId, outboxId],
        timestamps: [baseTimestamp, baseTimestamp, baseTimestamp, baseTimestamp]
      }
    )
  })
})

type FailureMode = 'after-session' | 'after-audit' | 'after-outbox'
type InsertRaceMode = 'open' | 'closed'

interface HarnessOptions {
  readonly role?: LocalUserRole
  readonly authError?: Error
  readonly generatedIds?: readonly string[]
  readonly timestamps?: readonly string[]
  readonly failureMode?: FailureMode
  readonly insertRace?: InsertRaceMode
  readonly preserveBaselineProtocol?: boolean
}

interface CurrentSessionServiceHarness {
  readonly connection: Database.Database
  readonly authenticationSessionService: LocalAuthenticationSessionService & {
    requireAnyRole: ReturnType<typeof vi.fn>
  }
  readonly service: CurrentScreeningSessionService
}

async function withCurrentSessionService(
  test: (harness: CurrentSessionServiceHarness) => void | Promise<void>,
  options: HarnessOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029c-current-session-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => baseTimestamp)
    })(connection)
    if (options.preserveBaselineProtocol !== true) {
      deactivateBaselineProtocol(connection)
    }

    const ids = [...(options.generatedIds ?? [sessionId, lifecycleHistoryId, auditId, outboxId])]
    const timestamps = [...(options.timestamps ?? Array.from({ length: 16 }, () => baseTimestamp))]
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => {
        const next = ids.shift()

        if (next === undefined) {
          throw new Error('No current-session test ID remains.')
        }

        return next as EntityId
      }),
      clock: createUtcClock(() => {
        const next = timestamps.shift()

        if (next === undefined) {
          throw new Error('No current-session test timestamp remains.')
        }

        return next as UtcTimestamp
      }),
      logger: { error: vi.fn() }
    })
    const authenticationSessionService = createAuthenticationSessionService(options)
    const installationRepository = createInstallationRepository(connection)
    const locationRepository = createLocationRepository(connection)
    const screeningSessionRepository = createScreeningSessionRepository(connection)
    const auditEventRepository = createAuditEventRepository(connection)
    const installationLocationService = createInstallationLocationService({
      authenticationSessionService,
      installationRepository,
      installationLocationConfigurationRepository:
        createInstallationLocationConfigurationRepository(connection),
      locationRepository,
      screeningSessionRepository,
      screeningEncounterRepository: createScreeningEncounterRepository(connection),
      auditEventRepository,
      transactionExecutor
    })
    const service = createCurrentScreeningSessionService({
      authenticationSessionService,
      installationLocationService,
      installationRepository,
      locationRepository,
      protocolVersionRepository: createProtocolVersionRepository(connection),
      screeningSessionRepository: wrapScreeningSessionRepository(
        screeningSessionRepository,
        options
      ),
      screeningSessionOutboxRepository: wrapOutboxRepository(
        createScreeningSessionOutboxRepository(connection),
        options.failureMode
      ),
      auditEventRepository: wrapAuditRepository(auditEventRepository, options.failureMode),
      transactionExecutor
    })

    await test({ connection, authenticationSessionService, service })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createAuthenticationSessionService({
  role = 'NURSE',
  authError
}: HarnessOptions): CurrentSessionServiceHarness['authenticationSessionService'] {
  const requireAnyRole = vi.fn((roles: readonly LocalUserRole[]) => {
    if (authError !== undefined) {
      throw authError
    }

    if (!roles.includes(role)) {
      throw new LocalSessionAuthorizationError()
    }

    return createActiveSessionContext(role)
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
  } as unknown as CurrentSessionServiceHarness['authenticationSessionService']
}

function createActiveSessionContext(role: LocalUserRole): ActiveLocalSessionContext {
  const idByRole: Partial<Record<LocalUserRole, string>> = {
    LOCAL_ADMIN: adminId,
    NURSE: nurseId,
    TRAINED_SCREENER: screenerId
  }
  const userId = idByRole[role] ?? screenerId

  return Object.freeze({
    user: Object.freeze({
      id: userId,
      username: role.toLowerCase(),
      usernameNormalized: role.toLowerCase(),
      displayName: `${role} User`,
      role,
      isActive: true,
      mustChangePassword: false,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: baseTimestamp,
      createdAt: baseTimestamp,
      updatedAt: baseTimestamp
    }) as unknown as LocalUserRecord,
    authenticatedAt: baseTimestamp as UtcTimestamp,
    lastActivityAt: baseTimestamp as UtcTimestamp,
    idleExpiresAt: '2026-08-10T12:30:00.000Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-08-11T00:00:00.000Z' as UtcTimestamp
  })
}

function wrapScreeningSessionRepository(
  repository: ScreeningSessionRepository,
  options: HarnessOptions
): ScreeningSessionRepository {
  return Object.freeze({
    ...repository,
    insert(
      connection: DatabaseTransactionConnection,
      input: Parameters<ScreeningSessionRepository['insert']>[1]
    ) {
      if (options.insertRace !== undefined) {
        insertSessionForRace(connection, {
          id: secondSessionId,
          locationId: input.locationId,
          sessionDate: input.sessionDate,
          status: options.insertRace === 'closed' ? 'CLOSED' : 'OPEN'
        })
        throw new ScreeningSessionAlreadyExistsError()
      }

      const result = repository.insert(connection, input)

      if (options.failureMode === 'after-session') {
        throw new RepositoryWriteError()
      }

      return result
    }
  })
}

function insertSessionForRace(
  connection: DatabaseTransactionConnection,
  input: {
    readonly id: string
    readonly locationId: string
    readonly sessionDate: string
    readonly status: 'OPEN' | 'CLOSED'
  }
): void {
  const closedBy = input.status === 'CLOSED' ? adminId : null
  const closedAt = input.status === 'CLOSED' ? baseTimestamp : null

  connection
    .prepare(
      `INSERT INTO screening_sessions (
        id,
        location_id,
        protocol_version_id,
        session_date,
        status,
        notes,
        opened_by,
        opened_at,
        closed_by,
        closed_at,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.locationId,
      protocolId,
      input.sessionDate,
      input.status,
      adminId,
      baseTimestamp,
      closedBy,
      closedAt,
      adminId,
      baseTimestamp,
      closedBy ?? adminId,
      closedAt ?? baseTimestamp,
      input.status === 'OPEN' ? 1 : 2
    )
}

function wrapAuditRepository(
  repository: AuditEventRepository,
  failureMode: FailureMode | undefined
): AuditEventRepository {
  return Object.freeze({
    ...repository,
    insert(
      connection: Parameters<AuditEventRepository['insert']>[0],
      input: Parameters<AuditEventRepository['insert']>[1]
    ) {
      const result = repository.insert(connection, input)

      if (failureMode === 'after-audit') {
        throw new RepositoryWriteError()
      }

      return result
    }
  })
}

function wrapOutboxRepository(
  repository: ScreeningSessionOutboxRepository,
  failureMode: FailureMode | undefined
): ScreeningSessionOutboxRepository {
  return Object.freeze({
    insert(
      connection: Parameters<ScreeningSessionOutboxRepository['insert']>[0],
      input: Parameters<ScreeningSessionOutboxRepository['insert']>[1]
    ) {
      repository.insert(connection, input)

      if (failureMode === 'after-outbox') {
        throw new RepositoryWriteError()
      }
    }
  })
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function seedBaseGraph(
  connection: Database.Database,
  options: {
    readonly timeZone?: string
    readonly protocol?: 'inserted' | 'migration-baseline'
  } = {}
): void {
  insertInstallation(connection, options.timeZone ?? 'UTC')
  insertUser(connection, { id: adminId, username: 'admin', role: 'LOCAL_ADMIN' })
  insertUser(connection, { id: nurseId, username: 'nurse', role: 'NURSE' })
  insertUser(connection, { id: screenerId, username: 'screener', role: 'TRAINED_SCREENER' })
  insertLocation(connection, { id: locationId, name: 'Site One', isActive: true })
  insertLocation(connection, { id: inactiveLocationId, name: 'Inactive Site', isActive: false })
  if (options.protocol !== 'migration-baseline') {
    insertProtocolVersion(connection, protocolId)
  }
}

function deactivateBaselineProtocol(connection: Database.Database): void {
  connection
    .prepare(
      "UPDATE protocol_versions SET status = 'INACTIVE' WHERE protocol_key = 'health-screening-baseline'"
    )
    .run()
}

function insertInstallation(connection: Database.Database, timeZone: string): void {
  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (1, ?, 'Local Deployment', ?, ?, ?)`
    )
    .run(installationId, timeZone, baseTimestamp, baseTimestamp)
}

function insertUser(
  connection: Database.Database,
  input: { readonly id: string; readonly username: string; readonly role: string }
): void {
  connection
    .prepare(
      `INSERT INTO users (
        id,
        username,
        username_normalized,
        display_name,
        password_hash,
        password_salt,
        role,
        is_active,
        must_change_password,
        failed_login_count,
        locked_until,
        last_login_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', ?, 1, 0, 0, NULL, NULL, ?, ?)`
    )
    .run(
      input.id,
      input.username,
      input.username,
      `${input.username} User`,
      input.role,
      baseTimestamp,
      baseTimestamp
    )
}

function insertLocation(
  connection: Database.Database,
  input: { readonly id: string; readonly name: string; readonly isActive: boolean }
): void {
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
      baseTimestamp,
      adminId,
      baseTimestamp
    )
}

function insertProtocolVersion(connection: Database.Database, id: string): void {
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
      ) VALUES (?, ?, ?, 'ACTIVE', '{}', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      `screening-${id}`,
      `label-${id}`,
      `checksum-${id}`,
      adminId,
      baseTimestamp,
      adminId,
      baseTimestamp,
      baseTimestamp
    )
}

function insertConfiguration(connection: Database.Database, configuredLocationId: string): void {
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (
        singleton_id,
        installation_id,
        location_id,
        configured_at,
        configured_by,
        updated_at,
        updated_by,
        row_version
      ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, configuredLocationId, baseTimestamp, adminId, baseTimestamp, adminId)
}

function insertSession(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly locationId: string
    readonly sessionDate: string
    readonly status?: 'OPEN' | 'CLOSED'
  }
): void {
  const status = input.status ?? 'OPEN'
  const closedBy = status === 'CLOSED' ? adminId : null
  const closedAt = status === 'CLOSED' ? baseTimestamp : null

  connection
    .prepare(
      `INSERT INTO screening_sessions (
        id,
        location_id,
        protocol_version_id,
        session_date,
        status,
        notes,
        opened_by,
        opened_at,
        closed_by,
        closed_at,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.locationId,
      protocolId,
      input.sessionDate,
      status,
      adminId,
      baseTimestamp,
      closedBy,
      closedAt,
      adminId,
      baseTimestamp,
      closedBy ?? adminId,
      closedAt ?? baseTimestamp,
      status === 'OPEN' ? 1 : 2
    )
}

function readRawSession(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM screening_sessions WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function readAuditRows(connection: Database.Database): Array<Record<string, string>> {
  return connection
    .prepare('SELECT action, entity_type, entity_id, metadata_json FROM audit_log ORDER BY rowid')
    .all() as Array<Record<string, string>>
}

function readOutboxRows(connection: Database.Database): Array<Record<string, string>> {
  return connection
    .prepare('SELECT operation, aggregate_id, payload_json FROM sync_outbox ORDER BY rowid')
    .all() as Array<Record<string, string>>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
    total: number
  }

  return row.total
}
