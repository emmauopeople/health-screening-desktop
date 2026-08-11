import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createInstallationLocationService,
  createProductionInstallationLocationService,
  LocalSessionAuthorizationError,
  LocalSessionUnauthenticatedError,
  type ActiveLocalSessionContext,
  type InstallationLocationService,
  type LocalAuthenticationSessionService
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocationRepository,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  RepositoryWriteError,
  type DatabaseTransactionConnection,
  type InstallationLocationConfigurationRepository,
  type LocalUserRecord,
  type LocalUserRole,
  type UpdateInstallationLocationConfigurationInput
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-10T12:00:00.000Z'
const later = '2026-08-10T13:00:00.000Z'
const installationId = '63000000-0000-4000-8000-000000000001'
const adminId = '63000000-0000-4000-8000-000000000002'
const nurseId = '63000000-0000-4000-8000-000000000003'
const locationId = '63000000-0000-4000-8000-000000000004'
const secondLocationId = '63000000-0000-4000-8000-000000000005'
const inactiveLocationId = '63000000-0000-4000-8000-000000000006'
const protocolId = '63000000-0000-4000-8000-000000000007'
const patientId = '63000000-0000-4000-8000-000000000008'
const sessionId = '63000000-0000-4000-8000-000000000009'
const closedSessionId = '63000000-0000-4000-8000-000000000010'
const encounterId = '63000000-0000-4000-8000-000000000011'
const auditId = '63000000-0000-4000-8000-000000000012'

describe('installation location service integration', () => {
  it('resolves the configured active location and reports absent configuration without mutation', async () => {
    await withService(({ connection, service }) => {
      seedBaseGraph(connection)

      expect(service.resolveConfiguredInstallationLocation()).toEqual({
        status: 'LOCATION_NOT_CONFIGURED'
      })
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)

      insertConfiguration(connection, locationId)

      expect(service.resolveConfiguredInstallationLocation()).toEqual({
        status: 'RESOLVED',
        location: {
          id: locationId,
          displayName: 'Site One'
        }
      })
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(1)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
    })
  })

  it('does not fall back when the configured location is missing or inactive', async () => {
    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      connection.pragma('foreign_keys = OFF')
      try {
        connection.prepare('DELETE FROM locations WHERE id = ?').run(locationId)
      } finally {
        connection.pragma('foreign_keys = ON')
      }

      expect(service.resolveConfiguredInstallationLocation()).toEqual({
        status: 'LOCATION_NOT_FOUND'
      })
      expect(readConfiguration(connection).location_id).toBe(locationId)
    })

    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, inactiveLocationId)

      expect(service.resolveConfiguredInstallationLocation()).toEqual({
        status: 'LOCATION_INACTIVE'
      })
      expect(readConfiguration(connection).location_id).toBe(inactiveLocationId)
    })
  })

  it('uses the trusted admin session and rejects missing or insufficient authentication before writes', async () => {
    for (const authFailure of [
      new LocalSessionUnauthenticatedError(),
      new LocalSessionUnauthenticatedError('expired')
    ]) {
      await withService(
        ({ connection, service }) => {
          seedBaseGraph(connection)
          insertConfiguration(connection, locationId)

          expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual(
            {
              status: 'AUTHENTICATION_REQUIRED'
            }
          )
          expect(readConfiguration(connection).location_id).toBe(locationId)
          expect(readTableCount(connection, 'audit_log')).toBe(0)
        },
        { authFailure }
      )
    }

    await withService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual({
          status: 'FORBIDDEN'
        })
        expect(readConfiguration(connection).location_id).toBe(locationId)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
      },
      { authFailure: new LocalSessionAuthorizationError(), sessionRole: 'NURSE' }
    )
  })

  it('strictly accepts only locationId for reconfiguration and rejects authority-bearing fields', async () => {
    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      for (const request of [
        {},
        { locationId: '' },
        { locationId: secondLocationId, userId: adminId },
        { locationId: secondLocationId, role: 'LOCAL_ADMIN' },
        { locationId: secondLocationId, actor: { userId: adminId } },
        { locationId: secondLocationId, installationId },
        { locationId: secondLocationId, force: true },
        { locationId: secondLocationId, date: '2026-08-10' }
      ]) {
        expect(service.reconfigureInstallationLocation(request)).toEqual({
          status: 'VALIDATION_FAILED'
        })
      }

      expect(readConfiguration(connection).location_id).toBe(locationId)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
    })
  })

  it('reconfigures to another active location with trusted actor, audit, and no outbox event', async () => {
    await withService(({ connection, service, authenticationSessionService }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      const result = service.reconfigureInstallationLocation({ locationId: secondLocationId })

      expect(result).toEqual({
        status: 'UPDATED',
        location: {
          id: secondLocationId,
          displayName: 'Site Two'
        }
      })
      expect(authenticationSessionService.requireAnyRole).toHaveBeenCalledWith(['LOCAL_ADMIN'])
      expect(readConfiguration(connection)).toMatchObject({
        location_id: secondLocationId,
        configured_at: now,
        configured_by: adminId,
        updated_at: later,
        updated_by: adminId,
        row_version: 2
      })
      expect(readAuditRows(connection)).toEqual([
        {
          action: 'INSTALLATION_LOCATION_CHANGED',
          entity_type: 'INSTALLATION',
          entity_id: installationId,
          user_id: adminId,
          occurred_at: later,
          metadata_json:
            '{"new_location_id":"63000000-0000-4000-8000-000000000005","previous_location_id":"63000000-0000-4000-8000-000000000004","prior_row_version":1,"resulting_row_version":2}'
        }
      ])
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('treats same-location reconfiguration as an idempotent no-op', async () => {
    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      expect(service.reconfigureInstallationLocation({ locationId })).toEqual({
        status: 'UNCHANGED',
        location: {
          id: locationId,
          displayName: 'Site One'
        }
      })
      expect(readConfiguration(connection)).toMatchObject({
        location_id: locationId,
        row_version: 1,
        updated_at: now
      })
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('returns controlled failures for missing configuration, unknown locations, and inactive locations', async () => {
    await withService(({ connection, service }) => {
      seedBaseGraph(connection)

      expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual({
        status: 'LOCATION_NOT_CONFIGURED'
      })
      expect(readTableCount(connection, 'installation_location_configuration')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
    })

    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      expect(
        service.reconfigureInstallationLocation({
          locationId: '63000000-0000-4000-8000-000000000099'
        })
      ).toEqual({ status: 'LOCATION_NOT_FOUND' })
      expect(service.reconfigureInstallationLocation({ locationId: inactiveLocationId })).toEqual({
        status: 'LOCATION_INACTIVE'
      })
      expect(readConfiguration(connection).location_id).toBe(locationId)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
    })
  })

  it('blocks reconfiguration while open sessions or draft encounters exist', async () => {
    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)
      insertProtocolVersion(connection)
      insertOpenSession(connection)

      expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual({
        status: 'ACTIVE_SCREENING_WORK'
      })
      expect(readConfiguration(connection).location_id).toBe(locationId)
      expect(readSession(connection, sessionId).status).toBe('OPEN')
      expect(readTableCount(connection, 'audit_log')).toBe(0)
    })

    await withService(({ connection, service }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)
      insertProtocolVersion(connection)
      insertPatient(connection)
      insertClosedSession(connection)
      insertDraftEncounter(connection)

      expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual({
        status: 'ACTIVE_SCREENING_WORK'
      })
      expect(readConfiguration(connection).location_id).toBe(locationId)
      expect(readEncounter(connection, encounterId).status).toBe('DRAFT')
      expect(readTableCount(connection, 'audit_log')).toBe(0)
    })
  })

  it('sanitizes repository failures and reports optimistic conflicts without raw database details', async () => {
    await withService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual({
          status: 'CONFIGURATION_CONFLICT'
        })
        expect(readConfiguration(connection).location_id).toBe(locationId)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
      },
      { updateMode: 'conflict' }
    )

    await withService(
      ({ connection, service }) => {
        seedBaseGraph(connection)
        insertConfiguration(connection, locationId)

        expect(service.reconfigureInstallationLocation({ locationId: secondLocationId })).toEqual({
          status: 'UNAVAILABLE'
        })
        expect(readConfiguration(connection).location_id).toBe(locationId)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
      },
      { updateMode: 'throw' }
    )
  })

  it('production composition resolves persisted configuration through the real boundary', async () => {
    await withService(({ connection, authenticationSessionService }) => {
      seedBaseGraph(connection)
      insertConfiguration(connection, locationId)

      const service = createProductionInstallationLocationService({
        connection,
        authenticationSessionService,
        logger: { error: vi.fn() }
      })

      expect(service.resolveConfiguredInstallationLocation()).toEqual({
        status: 'RESOLVED',
        location: {
          id: locationId,
          displayName: 'Site One'
        }
      })
    })
  })
})

type UpdateMode = 'normal' | 'conflict' | 'throw'

interface HarnessOptions {
  readonly authFailure?: unknown
  readonly sessionRole?: LocalUserRole
  readonly sessionUserId?: string
  readonly updateMode?: UpdateMode
}

async function withService(
  test: (context: {
    readonly connection: Database.Database
    readonly service: InstallationLocationService
    readonly authenticationSessionService: LocalAuthenticationSessionService & {
      readonly requireAnyRole: ReturnType<typeof vi.fn>
    }
  }) => void,
  options: HarnessOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029c-p0-installation-location-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => now)
    })(connection)

    const authenticationSessionService = createAuthenticationSessionService({
      userId: options.sessionUserId ?? adminId,
      role: options.sessionRole ?? 'LOCAL_ADMIN',
      failure: options.authFailure
    })
    const rawConfigurationRepository = createInstallationLocationConfigurationRepository(connection)
    const service = createInstallationLocationService({
      authenticationSessionService,
      installationRepository: createInstallationRepository(connection),
      installationLocationConfigurationRepository: wrapConfigurationRepository(
        rawConfigurationRepository,
        options.updateMode ?? 'normal'
      ),
      locationRepository: createLocationRepository(connection),
      screeningSessionRepository: createScreeningSessionRepository(connection),
      screeningEncounterRepository: createScreeningEncounterRepository(connection),
      auditEventRepository: createAuditEventRepository(connection),
      transactionExecutor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => auditId),
        clock: createUtcClock(() => later),
        logger: { error: vi.fn() }
      })
    })

    test({ connection, service, authenticationSessionService })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function wrapConfigurationRepository(
  repository: InstallationLocationConfigurationRepository,
  updateMode: UpdateMode
): InstallationLocationConfigurationRepository {
  return Object.freeze({
    ...repository,
    updateLocation(
      connection: DatabaseTransactionConnection,
      input: UpdateInstallationLocationConfigurationInput
    ) {
      if (updateMode === 'throw') {
        throw new RepositoryWriteError('C:\\secret\\configuration.sqlite3')
      }

      if (updateMode === 'conflict') {
        return Object.freeze({
          status: 'CONFIGURATION_VERSION_CONFLICT' as const,
          configuration: repository.getForWrite(connection)!
        })
      }

      return repository.updateLocation(connection, input)
    }
  })
}

function createAuthenticationSessionService({
  userId,
  role,
  failure
}: {
  readonly userId: string
  readonly role: LocalUserRole
  readonly failure?: unknown
}): LocalAuthenticationSessionService & { readonly requireAnyRole: ReturnType<typeof vi.fn> } {
  const context = createActiveContext(userId, role)
  const requireAnyRole = vi.fn((roles: unknown) => {
    if (failure !== undefined) {
      throw failure
    }

    if (!Array.isArray(roles) || !roles.includes(role)) {
      throw new LocalSessionAuthorizationError()
    }

    return context
  })

  return Object.freeze({
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    getSnapshot: vi.fn(),
    recordActivity: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    requireActiveSession: vi.fn(() => context),
    requireAnyRole
  }) as unknown as LocalAuthenticationSessionService & {
    readonly requireAnyRole: ReturnType<typeof vi.fn>
  }
}

function createActiveContext(userId: string, role: LocalUserRole): ActiveLocalSessionContext {
  const user: LocalUserRecord = Object.freeze({
    id: parseEntityId(userId),
    username: `user-${userId.slice(-2)}` as LocalUserRecord['username'],
    displayName: `User ${userId.slice(-2)}` as LocalUserRecord['displayName'],
    role,
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: now as UtcTimestamp,
    createdAt: now as UtcTimestamp,
    updatedAt: now as UtcTimestamp
  })

  return Object.freeze({
    user,
    authenticatedAt: now as UtcTimestamp,
    lastActivityAt: now as UtcTimestamp,
    idleExpiresAt: '2026-08-10T12:15:00.000Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-08-11T00:00:00.000Z' as UtcTimestamp
  })
}

function seedBaseGraph(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (1, ?, 'Deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
  insertUser(connection, adminId, 'admin', 'LOCAL_ADMIN')
  insertUser(connection, nurseId, 'nurse', 'NURSE')
  insertLocation(connection, locationId, 'Site One', true)
  insertLocation(connection, secondLocationId, 'Site Two', true)
  insertLocation(connection, inactiveLocationId, 'Inactive Site', false)
}

function insertUser(
  connection: Database.Database,
  id: string,
  username: string,
  role: LocalUserRole
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
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, 'hash', 'salt', ?, 1, 0, 0, ?, ?)`
    )
    .run(id, username, username, `${username} User`, role, now, now)
}

function insertLocation(
  connection: Database.Database,
  id: string,
  name: string,
  isActive: boolean
): void {
  connection
    .prepare(
      `INSERT INTO locations (
        id,
        name,
        name_normalized,
        location_type,
        is_active,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, ?, ?, 'COMMUNITY_SITE', ?, ?, ?, ?, ?)`
    )
    .run(id, name, name.toLowerCase(), isActive ? 1 : 0, adminId, now, adminId, now)
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
    .run(installationId, configuredLocationId, now, adminId, now, adminId)
}

function insertProtocolVersion(connection: Database.Database): void {
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
      ) VALUES (?, 'screening', 'v1', 'ACTIVE', '{}', 'checksum', ?, ?, ?, ?, ?)`
    )
    .run(protocolId, adminId, now, adminId, now, now)
}

function insertPatient(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        given_name,
        family_name,
        name_normalized,
        sex,
        date_of_birth,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at
      ) VALUES (?, 'PT-000001', 'Patient One', 'Patient', 'One', 'patient one',
        'UNKNOWN', '1990-01-01', 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(patientId, adminId, now, adminId, now)
}

function insertOpenSession(connection: Database.Database): void {
  insertSession(connection, sessionId, 'OPEN')
}

function insertClosedSession(connection: Database.Database): void {
  insertSession(connection, closedSessionId, 'CLOSED')
}

function insertSession(connection: Database.Database, id: string, status: 'OPEN' | 'CLOSED'): void {
  const closedBy = status === 'CLOSED' ? adminId : null
  const closedAt = status === 'CLOSED' ? now : null
  const rowVersion = status === 'CLOSED' ? 2 : 1

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
      ) VALUES (?, ?, ?, '2026-08-10', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      locationId,
      protocolId,
      status,
      adminId,
      now,
      closedBy,
      closedAt,
      adminId,
      now,
      adminId,
      now,
      rowVersion
    )
}

function insertDraftEncounter(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO screening_encounters (
        id,
        patient_id,
        screening_session_id,
        location_id,
        protocol_version_id,
        status,
        started_at,
        completed_at,
        source_type,
        recorded_by,
        amendment_of_encounter_id,
        amendment_reason,
        void_reason,
        record_version,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, NULL, 'LOCAL', ?, NULL, NULL, NULL, 1, ?, ?)`
    )
    .run(encounterId, patientId, closedSessionId, locationId, protocolId, now, adminId, now, now)
}

function readConfiguration(connection: Database.Database): Record<string, unknown> {
  return connection.prepare('SELECT * FROM installation_location_configuration').get() as Record<
    string,
    unknown
  >
}

function readSession(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM screening_sessions WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function readEncounter(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM screening_encounters WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function readAuditRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT action, entity_type, entity_id, user_id, occurred_at, metadata_json
       FROM audit_log
       ORDER BY rowid`
    )
    .all() as Array<Record<string, unknown>>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection
    .prepare(`SELECT COUNT(*) AS total FROM "${tableName.replaceAll('"', '""')}"`)
    .get() as { total: number }

  return row.total
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}
