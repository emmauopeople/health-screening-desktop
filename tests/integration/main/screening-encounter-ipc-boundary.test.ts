import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  LocalSessionAuthorizationError,
  LocalSessionUnauthenticatedError,
  createScreeningEncounterStartService,
  type ActiveLocalSessionContext,
  type LocalAuthenticationSessionService
} from '@main/application'
import { createDevelopmentNavigationPolicy } from '@main/app/navigation-policy'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createPatientRepository,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  type LocalUserRecord,
  type LocalUserRole
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'
import { createScreeningEncounterIpcHandlers } from '@main/ipc/handlers/screening-encounter-handlers'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'

const now = '2026-08-06T12:00:00.000Z'
const installationId = '20000000-0000-4000-8000-000000000001'
const adminId = '20000000-0000-4000-8000-000000000002'
const nurseId = '20000000-0000-4000-8000-000000000003'
const locationId = '20000000-0000-4000-8000-000000000005'
const inactiveLocationId = '20000000-0000-4000-8000-000000000006'
const closedSessionLocationId = '20000000-0000-4000-8000-000000000021'
const protocolId = '20000000-0000-4000-8000-000000000007'
const patientId = '20000000-0000-4000-8000-000000000008'
const sessionId = '20000000-0000-4000-8000-000000000010'
const closedSessionId = '20000000-0000-4000-8000-000000000011'
const inactiveLocationSessionId = '20000000-0000-4000-8000-000000000012'
const voidEncounterId = '20000000-0000-4000-8000-000000000020'
const encounterId = '20000000-0000-4000-8000-000000000015'
const auditId = '20000000-0000-4000-8000-000000000016'
const outboxId = '20000000-0000-4000-8000-000000000017'

describe('screening encounter IPC integration boundary', () => {
  it('starts and then idempotently returns one canonical root encounter', async () => {
    await withScreeningEncounterIpc(async ({ connection, handlers }) => {
      const first = await handlers.start(createAllowedEvent(), {
        patientId,
        screeningSessionId: sessionId
      })

      expect(first).toMatchObject({
        ok: true,
        data: {
          status: 'STARTED',
          encounter: {
            patientId,
            screeningSessionId: sessionId,
            status: 'DRAFT',
            recordVersion: 1
          }
        }
      })
      expect(readRootEncounterCount(connection)).toBe(1)
      expect(readEncounterAuditActions(connection)).toEqual(['SCREENING_ENCOUNTER_STARTED'])
      expect(readEncounterOutboxOperations(connection)).toEqual(['SCREENING_ENCOUNTER_STARTED'])
      expect(readRawEncounters(connection)[0]).toMatchObject({
        recorded_by: adminId,
        amendment_of_encounter_id: null
      })

      const second = await handlers.start(createAllowedEvent(), {
        patientId,
        screeningSessionId: sessionId
      })

      expect(second).toMatchObject({
        ok: true,
        data: {
          status: 'ALREADY_EXISTS',
          encounter: {
            patientId,
            screeningSessionId: sessionId
          }
        }
      })
      expect(
        first.ok &&
          second.ok &&
          'encounter' in first.data &&
          'encounter' in second.data &&
          first.data.encounter.id === second.data.encounter.id
      ).toBe(true)
      expect(readRootEncounterCount(connection)).toBe(1)
      expect(readEncounterAuditActions(connection)).toEqual(['SCREENING_ENCOUNTER_STARTED'])
      expect(readEncounterOutboxOperations(connection)).toEqual(['SCREENING_ENCOUNTER_STARTED'])
    })
  }, 20000)

  it('returns a VOID root as the canonical existing encounter without replacement writes', async () => {
    await withScreeningEncounterIpc(async ({ connection, handlers }) => {
      insertRawEncounter(connection, { id: voidEncounterId, status: 'VOID', voidReason: 'Void' })

      const result = await handlers.start(createAllowedEvent(), {
        patientId,
        screeningSessionId: sessionId
      })

      expect(result).toMatchObject({
        ok: true,
        data: {
          status: 'ALREADY_EXISTS',
          encounter: { id: voidEncounterId, status: 'VOID' }
        }
      })
      expect(readRootEncounterCount(connection)).toBe(1)
      expect(readEncounterAuditActions(connection)).toEqual([])
      expect(readEncounterOutboxOperations(connection)).toEqual([])
    })
  }, 20000)

  it('performs no writes for invalid, untrusted, or unauthorized invocations', async () => {
    await withScreeningEncounterIpc(async ({ connection, handlers }) => {
      await expect(
        handlers.start(createAllowedEvent(), {
          patientId,
          screeningSessionId: sessionId,
          userId: nurseId
        })
      ).resolves.toMatchObject({ ok: true, data: { status: 'VALIDATION_FAILED' } })
      await expect(
        handlers.start(createForbiddenEvent(), {
          patientId,
          screeningSessionId: sessionId
        })
      ).resolves.toMatchObject({ ok: false, error: { code: 'IPC_FORBIDDEN' } })

      expect(readTableCount(connection, 'screening_encounters')).toBe(0)
      expect(readEncounterAuditActions(connection)).toEqual([])
      expect(readEncounterOutboxOperations(connection)).toEqual([])
    })

    await withScreeningEncounterIpc(
      async ({ connection, handlers }) => {
        await expect(
          handlers.start(createAllowedEvent(), {
            patientId,
            screeningSessionId: sessionId
          })
        ).resolves.toMatchObject({ ok: true, data: { status: 'AUTHENTICATION_REQUIRED' } })
        expect(readTableCount(connection, 'screening_encounters')).toBe(0)
        expect(readEncounterAuditActions(connection)).toEqual([])
        expect(readEncounterOutboxOperations(connection)).toEqual([])
      },
      { authFailure: new LocalSessionUnauthenticatedError() }
    )

    await withScreeningEncounterIpc(
      async ({ connection, handlers }) => {
        await expect(
          handlers.start(createAllowedEvent(), {
            patientId,
            screeningSessionId: sessionId
          })
        ).resolves.toMatchObject({ ok: true, data: { status: 'FORBIDDEN' } })
        expect(readTableCount(connection, 'screening_encounters')).toBe(0)
        expect(readEncounterAuditActions(connection)).toEqual([])
        expect(readEncounterOutboxOperations(connection)).toEqual([])
      },
      { authFailure: new LocalSessionAuthorizationError() }
    )
  }, 20000)

  it('preserves service eligibility and date outcomes across IPC', async () => {
    await withScreeningEncounterIpc(async ({ handlers }) => {
      await expect(
        handlers.start(createAllowedEvent(), {
          patientId,
          screeningSessionId: closedSessionId
        })
      ).resolves.toMatchObject({ ok: true, data: { status: 'SESSION_CLOSED' } })
      await expect(
        handlers.start(createAllowedEvent(), {
          patientId,
          screeningSessionId: inactiveLocationSessionId
        })
      ).resolves.toMatchObject({ ok: true, data: { status: 'LOCATION_INACTIVE' } })
    })
  }, 20000)
})

interface IpcHarness {
  readonly connection: Database.Database
  readonly handlers: ReturnType<typeof createScreeningEncounterIpcHandlers>
}

async function withScreeningEncounterIpc(
  test: (harness: IpcHarness) => Promise<void> | void,
  options: { readonly authFailure?: unknown } = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029b-encounter-ipc-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: 'test',
      logger: createLogger(),
      clock: createUtcClock(() => now)
    })(connection)
    deactivateBaselineProtocol(connection)
    seedCoreGraph(connection)

    const idQueue = [encounterId, auditId, outboxId]
    const screeningEncounterStartService = createScreeningEncounterStartService({
      authenticationSessionService: createAuthenticationSessionService({
        userId: adminId,
        role: 'LOCAL_ADMIN',
        failure: options.authFailure
      }),
      installationRepository: createInstallationRepository(connection),
      patientRepository: createPatientRepository(connection),
      locationRepository: createLocationRepository(connection),
      screeningSessionRepository: createScreeningSessionRepository(connection),
      screeningEncounterRepository: createScreeningEncounterRepository(connection),
      screeningEncounterOutboxRepository: createScreeningEncounterOutboxRepository(connection),
      auditEventRepository: createAuditEventRepository(connection),
      transactionExecutor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => {
          const next = idQueue.shift()

          if (next === undefined) {
            throw new Error('No screening-encounter IPC test ID remains.')
          }

          return next
        }),
        clock: createUtcClock(() => now),
        logger: createLogger()
      })
    })

    await test({
      connection,
      handlers: createScreeningEncounterIpcHandlers({
        navigationPolicy: createDevelopmentNavigationPolicy('http://localhost:5173/'),
        screeningEncounterStartService,
        logger: createLogger()
      })
    })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function createAuthenticationSessionService({
  userId,
  role,
  failure
}: {
  readonly userId: string
  readonly role: LocalUserRole
  readonly failure?: unknown
}): LocalAuthenticationSessionService {
  const context = createActiveContext(userId, role)

  return {
    getSnapshot: vi.fn(),
    login: vi.fn(),
    changeRequiredPassword: vi.fn(),
    unlock: vi.fn(),
    lock: vi.fn(),
    logout: vi.fn(),
    recordActivity: vi.fn(),
    requireActiveSession: vi.fn(() => {
      if (failure !== undefined) {
        throw failure
      }

      return context
    }),
    requireAnyRole: vi.fn((roles: readonly LocalUserRole[]) => {
      if (failure !== undefined) {
        throw failure
      }

      if (!roles.includes(role)) {
        throw new LocalSessionAuthorizationError()
      }

      return context
    })
  } as unknown as LocalAuthenticationSessionService
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
    idleExpiresAt: '2026-08-06T12:15:00.000Z' as UtcTimestamp,
    absoluteExpiresAt: '2026-08-07T00:00:00.000Z' as UtcTimestamp
  })
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function deactivateBaselineProtocol(connection: Database.Database): void {
  connection
    .prepare(
      "UPDATE protocol_versions SET status = 'INACTIVE' WHERE protocol_key = 'health-screening-baseline'"
    )
    .run()
}

function seedCoreGraph(connection: Database.Database): void {
  insertInstallation(connection)
  insertUser(connection, adminId, 'admin', 'LOCAL_ADMIN')
  insertUser(connection, nurseId, 'nurse', 'NURSE')
  insertLocation(connection, locationId, true)
  insertLocation(connection, inactiveLocationId, false)
  insertLocation(connection, closedSessionLocationId, true)
  insertProtocolVersion(connection)
  insertPatient(connection)
  insertSession(connection, sessionId, 'OPEN', '2026-08-06', locationId)
  insertSession(connection, closedSessionId, 'CLOSED', '2026-08-06', closedSessionLocationId)
  insertSession(connection, inactiveLocationSessionId, 'OPEN', '2026-08-06', inactiveLocationId)
}

function insertInstallation(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO installation (
        singleton_id,
        id,
        deployment_name,
        timezone,
        created_at,
        updated_at
      ) VALUES (1, ?, 'Local Deployment', 'UTC', ?, ?)`
    )
    .run(installationId, now, now)
}

function insertUser(
  connection: Database.Database,
  id: string,
  username: string,
  role: string
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

function insertLocation(connection: Database.Database, id: string, isActive: boolean): void {
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
    .run(id, `Site ${id}`, `site ${id}`, isActive ? 1 : 0, adminId, now, adminId, now)
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
      ) VALUES (?, 'PT-000001', 'Test Patient', 'Test', 'Patient', 'test patient', 'UNKNOWN', '1990-01-01', 'ACTIVE', ?, ?, ?, ?)`
    )
    .run(patientId, adminId, now, adminId, now)
}

function insertSession(
  connection: Database.Database,
  id: string,
  status: 'OPEN' | 'CLOSED',
  sessionDate: string,
  sessionLocationId: string
): void {
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
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      sessionLocationId,
      protocolId,
      sessionDate,
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

function insertRawEncounter(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly status?: 'DRAFT' | 'VOID'
    readonly voidReason?: string | null
  }
): void {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'LOCAL', ?, NULL, NULL, ?, 1, ?, ?)`
    )
    .run(
      input.id,
      patientId,
      sessionId,
      locationId,
      protocolId,
      input.status ?? 'DRAFT',
      now,
      adminId,
      input.voidReason ?? null,
      now,
      now
    )
}

function readRootEncounterCount(connection: Database.Database): number {
  const row = connection
    .prepare(
      `SELECT COUNT(*) AS total
       FROM screening_encounters
       WHERE patient_id = ?
         AND screening_session_id = ?
         AND amendment_of_encounter_id IS NULL`
    )
    .get(patientId, sessionId) as { readonly total: number }

  return row.total
}

function readRawEncounters(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        id,
        patient_id,
        screening_session_id,
        status,
        recorded_by,
        amendment_of_encounter_id
       FROM screening_encounters
       ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>
}

function readEncounterAuditActions(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT action, entity_type, metadata_json
       FROM audit_log
       WHERE entity_type = 'SCREENING_ENCOUNTER'
       ORDER BY rowid`
    )
    .all() as Array<{ readonly action: string; readonly metadata_json: string }>

  for (const row of rows) {
    expect(row.metadata_json).not.toContain('Test Patient')
    expect(row.metadata_json).not.toContain('1990-01-01')
  }

  return rows.map((row) => row.action)
}

function readEncounterOutboxOperations(connection: Database.Database): readonly string[] {
  const rows = connection
    .prepare(
      `SELECT operation, aggregate_type, payload_schema_version, payload_json
       FROM sync_outbox
       WHERE aggregate_type = 'SCREENING_ENCOUNTER'
       ORDER BY rowid`
    )
    .all() as Array<{
    readonly operation: string
    readonly aggregate_type: string
    readonly payload_schema_version: string
    readonly payload_json: string
  }>

  for (const row of rows) {
    expect(row.aggregate_type).toBe('SCREENING_ENCOUNTER')
    expect(row.payload_schema_version).toBe('screening-encounter.start.v1')
    expect(row.payload_json).not.toContain('Test Patient')
    expect(row.payload_json).not.toContain('1990-01-01')
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

function createLogger(): {
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
