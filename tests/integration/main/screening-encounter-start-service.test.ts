import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createScreeningEncounterStartService,
  type ScreeningEncounterStartService,
  type ScreeningEncounterStartServiceActor
} from '@main/application'
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
  RepositoryWriteError,
  type AuditEventRepository,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type InsertCanonicalRootScreeningEncounterInput,
  type ScreeningEncounterOutboxRepository,
  type ScreeningEncounterRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-06T12:00:00.000Z'
const chicagoBoundaryNow = '2026-08-06T04:30:00.000Z'
const installationId = '20000000-0000-4000-8000-000000000001'
const adminId = '20000000-0000-4000-8000-000000000002'
const nurseId = '20000000-0000-4000-8000-000000000003'
const screenerId = '20000000-0000-4000-8000-000000000004'
const locationId = '20000000-0000-4000-8000-000000000005'
const inactiveLocationId = '20000000-0000-4000-8000-000000000006'
const closedSessionLocationId = '20000000-0000-4000-8000-000000000021'
const protocolId = '20000000-0000-4000-8000-000000000007'
const patientId = '20000000-0000-4000-8000-000000000008'
const inactivePatientId = '20000000-0000-4000-8000-000000000009'
const sessionId = '20000000-0000-4000-8000-000000000010'
const closedSessionId = '20000000-0000-4000-8000-000000000011'
const historicalSessionId = '20000000-0000-4000-8000-000000000012'
const futureSessionId = '20000000-0000-4000-8000-000000000013'
const missingLocationSessionId = '20000000-0000-4000-8000-000000000014'
const encounterId = '20000000-0000-4000-8000-000000000015'
const auditId = '20000000-0000-4000-8000-000000000016'
const outboxId = '20000000-0000-4000-8000-000000000017'
const existingEncounterId = '20000000-0000-4000-8000-000000000018'
const raceEncounterId = '20000000-0000-4000-8000-000000000019'
const voidEncounterId = '20000000-0000-4000-8000-000000000020'

const adminActor: ScreeningEncounterStartServiceActor = {
  userId: parseEntityId(adminId),
  role: 'LOCAL_ADMIN'
}
const nurseActor: ScreeningEncounterStartServiceActor = {
  userId: parseEntityId(nurseId),
  role: 'NURSE'
}
const screenerActor: ScreeningEncounterStartServiceActor = {
  userId: parseEntityId(screenerId),
  role: 'TRAINED_SCREENER'
}

describe('screening encounter start service integration', () => {
  it('starts one canonical root encounter with audit and outbox rows', async () => {
    await withStartService(({ connection, service }) => {
      seedCoreGraph(connection)
      const beforePatient = readPatient(connection, patientId)

      const result = service.start(createRequest(), adminActor)

      expect(result).toEqual({
        status: 'STARTED',
        encounter: {
          id: encounterId,
          patientId,
          screeningSessionId: sessionId,
          status: 'DRAFT',
          startedAt: now,
          recordVersion: 1
        }
      })
      expect(Object.isFrozen(result)).toBe(true)
      expect(result.status === 'STARTED' && Object.isFrozen(result.encounter)).toBe(true)
      expect(readRawEncounters(connection)).toEqual([
        expect.objectContaining({
          id: encounterId,
          patient_id: patientId,
          screening_session_id: sessionId,
          location_id: locationId,
          protocol_version_id: protocolId,
          status: 'DRAFT',
          source_type: 'LOCAL',
          recorded_by: adminId,
          amendment_of_encounter_id: null,
          record_version: 1
        })
      ])
      expect(readPatient(connection, patientId)).toEqual(beforePatient)
      expect(readTableCount(connection, 'blood_pressure_readings')).toBe(0)
      expect(readTableCount(connection, 'referrals')).toBe(0)
      expect(readAuditRows(connection)).toEqual([
        expect.objectContaining({
          action: 'SCREENING_ENCOUNTER_STARTED',
          entity_type: 'SCREENING_ENCOUNTER',
          entity_id: encounterId
        })
      ])
      expect(readAuditRows(connection)[0]!.metadata_json).not.toContain('Patient One')
      expect(readOutboxRows(connection)).toEqual([
        expect.objectContaining({
          aggregate_type: 'SCREENING_ENCOUNTER',
          aggregate_id: encounterId,
          operation: 'SCREENING_ENCOUNTER_STARTED',
          payload_schema_version: 'screening-encounter.start.v1',
          status: 'PENDING',
          attempt_count: 0
        })
      ])
      expect(JSON.parse(readOutboxRows(connection)[0]!.payload_json as string)).toEqual({
        encounter_id: encounterId,
        location_id: locationId,
        patient_id: patientId,
        protocol_version_id: protocolId,
        record_version: 1,
        recorded_by: adminId,
        screening_session_id: sessionId,
        started_at: now,
        status: 'DRAFT'
      })
    })
  })

  it('allows every operational role and rejects malformed or unauthorized actors before writes', async () => {
    for (const actor of [adminActor, nurseActor, screenerActor]) {
      await withStartService(({ connection, service }) => {
        seedCoreGraph(connection)

        expect(service.start(createRequest(), actor).status).toBe('STARTED')
      })
    }

    await withStartService(({ connection, service }) => {
      seedCoreGraph(connection)

      expect(service.start(createRequest(), null as never)).toEqual({
        status: 'AUTHENTICATION_REQUIRED'
      })
      expect(
        service.start(createRequest(), { ...adminActor, extra: 'renderer-role' } as never)
      ).toEqual({ status: 'AUTHENTICATION_REQUIRED' })
      expect(
        service.start(createRequest(), { userId: adminId, role: 'SUPER_ADMIN' } as never)
      ).toEqual({ status: 'FORBIDDEN' })
      expect(readTableCount(connection, 'screening_encounters')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('strictly validates request shape and rejects renderer-supplied authority', async () => {
    await withStartService(({ connection, service }) => {
      seedCoreGraph(connection)

      for (const request of [
        { patientId: 'bad-id', screeningSessionId: sessionId },
        { patientId, screeningSessionId: sessionId, locationId },
        { patientId, screeningSessionId: sessionId, actorId: adminId },
        { patientId, screeningSessionId: sessionId, status: 'DRAFT' },
        { patientId, screeningSessionId: sessionId, startedAt: now }
      ]) {
        expect(service.start(request as never, adminActor)).toEqual({ status: 'VALIDATION_FAILED' })
      }

      expect(readTableCount(connection, 'screening_encounters')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('enforces patient and session eligibility without partial writes', async () => {
    const cases: readonly {
      readonly name: string
      readonly request: ReturnType<typeof createRequest>
      readonly expected:
        | 'PATIENT_NOT_FOUND'
        | 'PATIENT_INELIGIBLE'
        | 'SESSION_NOT_FOUND'
        | 'SESSION_CLOSED'
        | 'SESSION_NOT_CURRENT'
        | 'LOCATION_NOT_FOUND'
        | 'LOCATION_INACTIVE'
      readonly mutate?: (connection: Database.Database) => void
    }[] = [
      {
        name: 'patient not found',
        request: createRequest({ patientId: '20000000-0000-4000-8000-000000000099' }),
        expected: 'PATIENT_NOT_FOUND'
      },
      {
        name: 'patient inactive',
        request: createRequest({ patientId: inactivePatientId }),
        expected: 'PATIENT_INELIGIBLE'
      },
      {
        name: 'session not found',
        request: createRequest({ screeningSessionId: '20000000-0000-4000-8000-000000000098' }),
        expected: 'SESSION_NOT_FOUND'
      },
      {
        name: 'session closed',
        request: createRequest({ screeningSessionId: closedSessionId }),
        expected: 'SESSION_CLOSED'
      },
      {
        name: 'historical session',
        request: createRequest({ screeningSessionId: historicalSessionId }),
        expected: 'SESSION_NOT_CURRENT'
      },
      {
        name: 'future session',
        request: createRequest({ screeningSessionId: futureSessionId }),
        expected: 'SESSION_NOT_CURRENT'
      },
      {
        name: 'inactive location',
        request: createRequest(),
        expected: 'LOCATION_INACTIVE',
        mutate: (connection) => {
          connection
            .prepare('UPDATE screening_sessions SET location_id = ? WHERE id = ?')
            .run(inactiveLocationId, sessionId)
        }
      },
      {
        name: 'missing location',
        request: createRequest({ screeningSessionId: missingLocationSessionId }),
        expected: 'LOCATION_NOT_FOUND'
      }
    ] as const

    for (const testCase of cases) {
      await withStartService(({ connection, service }) => {
        seedCoreGraph(connection)
        testCase.mutate?.(connection)

        expect(service.start(testCase.request, adminActor), testCase.name).toEqual({
          status: testCase.expected
        })
        expect(readTableCount(connection, 'screening_encounters')).toBe(0)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
        expect(readSession(connection, sessionId).status).toBe('OPEN')
      })
    }
  })

  it('uses installation timezone for current-date eligibility without request date authority', async () => {
    await withStartService(
      ({ connection, service }) => {
        seedCoreGraph(connection, { timeZone: 'America/Chicago' })
        connection
          .prepare('UPDATE screening_sessions SET session_date = ? WHERE id = ?')
          .run('2026-08-05', sessionId)

        expect(service.start(createRequest(), adminActor).status).toBe('STARTED')
      },
      { timestamps: [chicagoBoundaryNow] }
    )

    await withStartService(({ connection, service }) => {
      seedCoreGraph(connection, { timeZone: 'Invalid/Zone' })

      expect(service.start(createRequest(), adminActor)).toEqual({ status: 'UNAVAILABLE' })
      expect(readTableCount(connection, 'screening_encounters')).toBe(0)
    })
  })

  it('returns existing root encounters idempotently, including VOID roots, without duplicate events', async () => {
    await withStartService(({ connection, service }) => {
      seedCoreGraph(connection)
      insertRawEncounter(connection, { id: existingEncounterId })

      expect(service.start(createRequest(), adminActor)).toEqual({
        status: 'ALREADY_EXISTS',
        encounter: {
          id: existingEncounterId,
          patientId,
          screeningSessionId: sessionId,
          status: 'DRAFT',
          startedAt: now,
          recordVersion: 1
        }
      })
      expect(readTableCount(connection, 'screening_encounters')).toBe(1)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })

    await withStartService(({ connection, service }) => {
      seedCoreGraph(connection)
      insertRawEncounter(connection, { id: voidEncounterId, status: 'VOID', voidReason: 'Void' })

      expect(service.start(createRequest(), adminActor)).toMatchObject({
        status: 'ALREADY_EXISTS',
        encounter: { id: voidEncounterId, status: 'VOID' }
      })
      expect(readRootEncounterCount(connection)).toBe(1)
    })
  })

  it('resolves an identity-constraint race to the existing encounter without duplicate audit or outbox rows', async () => {
    await withStartService(
      ({ connection, service }) => {
        seedCoreGraph(connection)

        expect(service.start(createRequest(), adminActor)).toMatchObject({
          status: 'ALREADY_EXISTS',
          encounter: { id: raceEncounterId }
        })
        expect(readRootEncounterCount(connection)).toBe(1)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { failureMode: 'identity-race' }
    )
  })

  it('does not treat encounter-ID collisions as idempotent identity conflicts', async () => {
    await withStartService(
      ({ connection, service }) => {
        seedCoreGraph(connection)
        insertRawEncounter(connection, {
          id: encounterId,
          patientId: inactivePatientId,
          screeningSessionId: closedSessionId
        })

        expect(service.start(createRequest(), adminActor)).toEqual({ status: 'UNAVAILABLE' })
        expect(readTableCount(connection, 'screening_encounters')).toBe(1)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      },
      { generatedIds: [encounterId, auditId, outboxId] }
    )
  })

  it('rolls back encounter, audit, and outbox writes when any mutation boundary fails', async () => {
    for (const failureMode of ['after-encounter', 'after-audit', 'after-outbox'] as const) {
      await withStartService(
        ({ connection, service }) => {
          seedCoreGraph(connection)

          expect(service.start(createRequest(), adminActor), failureMode).toEqual({
            status: 'UNAVAILABLE'
          })
          expect(readTableCount(connection, 'screening_encounters')).toBe(0)
          expect(readTableCount(connection, 'audit_log')).toBe(0)
          expect(readTableCount(connection, 'sync_outbox')).toBe(0)
        },
        { failureMode }
      )
    }
  })
})

type FailureMode = 'after-encounter' | 'after-audit' | 'after-outbox' | 'identity-race'

interface HarnessOptions {
  readonly generatedIds?: readonly string[]
  readonly timestamps?: readonly string[]
  readonly failureMode?: FailureMode
}

interface StartServiceHarness {
  readonly connection: Database.Database
  readonly service: ScreeningEncounterStartService
  readonly executor: DatabaseTransactionExecutor
}

async function withStartService(
  test: (context: StartServiceHarness) => void | Promise<void>,
  options: HarnessOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd029-encounter-start-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => now)
    })(connection)
    const ids = [...(options.generatedIds ?? [encounterId, auditId, outboxId])]
    const timestamps = [...(options.timestamps ?? [now])]
    const executor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => {
        const next = ids.shift()

        if (next === undefined) {
          throw new Error('No generated encounter test ID remains.')
        }

        return next
      }),
      clock: createUtcClock(() => {
        const next = timestamps.shift()

        if (next === undefined) {
          throw new Error('No encounter test timestamp remains.')
        }

        return next as UtcTimestamp
      }),
      logger: { error: vi.fn() }
    })
    const encounterRepository = createScreeningEncounterRepository(connection)
    const auditRepository = createAuditEventRepository(connection)
    const outboxRepository = createScreeningEncounterOutboxRepository(connection)
    const service = createScreeningEncounterStartService({
      installationRepository: createInstallationRepository(connection),
      patientRepository: createPatientRepository(connection),
      locationRepository: createLocationRepository(connection),
      screeningSessionRepository: createScreeningSessionRepository(connection),
      screeningEncounterRepository: wrapEncounterRepository(
        connection,
        encounterRepository,
        options.failureMode
      ),
      screeningEncounterOutboxRepository: wrapOutboxRepository(
        outboxRepository,
        options.failureMode
      ),
      auditEventRepository: wrapAuditRepository(auditRepository, options.failureMode),
      transactionExecutor: executor
    })

    await test({ connection, service, executor })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function wrapEncounterRepository(
  rawConnection: Database.Database,
  repository: ScreeningEncounterRepository,
  failureMode: FailureMode | undefined
): ScreeningEncounterRepository {
  void rawConnection

  return Object.freeze({
    ...repository,
    insertCanonicalRoot(
      connection: DatabaseTransactionConnection,
      input: InsertCanonicalRootScreeningEncounterInput
    ) {
      if (failureMode === 'identity-race') {
        insertRawEncounterWithConnection(connection, {
          id: raceEncounterId,
          patientId: input.patientId,
          screeningSessionId: input.screeningSessionId,
          locationId: input.locationId,
          protocolVersionId: input.protocolVersionId,
          recordedBy: input.recordedBy,
          startedAt: input.startedAt
        })
      }

      const result = repository.insertCanonicalRoot(connection, input)

      if (failureMode === 'after-encounter' && result.status === 'CREATED') {
        throw new RepositoryWriteError()
      }

      return result
    }
  })
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
  repository: ScreeningEncounterOutboxRepository,
  failureMode: FailureMode | undefined
): ScreeningEncounterOutboxRepository {
  return Object.freeze({
    insert(
      connection: Parameters<ScreeningEncounterOutboxRepository['insert']>[0],
      input: Parameters<ScreeningEncounterOutboxRepository['insert']>[1]
    ) {
      repository.insert(connection, input)

      if (failureMode === 'after-outbox') {
        throw new RepositoryWriteError()
      }
    }
  })
}

function createRequest(
  override: {
    readonly patientId?: string
    readonly screeningSessionId?: string
  } = {}
): Parameters<ScreeningEncounterStartService['start']>[0] {
  return {
    patientId: parseEntityId(override.patientId ?? patientId),
    screeningSessionId: parseEntityId(override.screeningSessionId ?? sessionId)
  }
}

function seedCoreGraph(
  connection: Database.Database,
  options: { readonly timeZone?: string } = {}
): void {
  insertInstallation(connection, options.timeZone ?? 'UTC')
  insertUser(connection, adminId, 'admin', 'LOCAL_ADMIN')
  insertUser(connection, nurseId, 'nurse', 'NURSE')
  insertUser(connection, screenerId, 'screener', 'TRAINED_SCREENER')
  insertLocation(connection, locationId, true)
  insertLocation(connection, inactiveLocationId, false)
  insertLocation(connection, closedSessionLocationId, true)
  insertProtocolVersion(connection)
  insertPatient(connection, patientId, 'PT-000001', 'Patient One', 'ACTIVE')
  insertPatient(connection, inactivePatientId, 'PT-000002', 'Patient Two', 'INACTIVE')
  insertSession(connection, sessionId, 'OPEN', '2026-08-06', locationId)
  insertSession(connection, closedSessionId, 'CLOSED', '2026-08-06', closedSessionLocationId)
  insertSession(connection, historicalSessionId, 'OPEN', '2026-08-04', locationId)
  insertSession(connection, futureSessionId, 'OPEN', '2026-08-07', locationId)
  insertSessionWithMissingLocation(connection)
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
    .run(installationId, timeZone, now, now)
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

function insertPatient(
  connection: Database.Database,
  id: string,
  patientCode: string,
  displayName: string,
  status: 'ACTIVE' | 'INACTIVE'
): void {
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
      ) VALUES (?, ?, ?, ?, 'Test', ?, 'UNKNOWN', '1990-01-01', ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      patientCode,
      displayName,
      displayName,
      displayName.toLowerCase(),
      status,
      adminId,
      now,
      adminId,
      now
    )
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

function insertSessionWithMissingLocation(connection: Database.Database): void {
  const originalForeignKeys = connection.pragma('foreign_keys', { simple: true }) as number

  try {
    connection.pragma('foreign_keys = OFF')
    insertSession(
      connection,
      missingLocationSessionId,
      'OPEN',
      '2026-08-06',
      '20000000-0000-4000-8000-000000000097'
    )
  } finally {
    connection.pragma(`foreign_keys = ${originalForeignKeys === 1 ? 'ON' : 'OFF'}`)
  }
}

function insertRawEncounter(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly patientId?: string
    readonly screeningSessionId?: string
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
      input.patientId ?? patientId,
      input.screeningSessionId ?? sessionId,
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

function insertRawEncounterWithConnection(
  connection: DatabaseTransactionConnection,
  input: {
    readonly id: string
    readonly patientId: string
    readonly screeningSessionId: string
    readonly locationId: string
    readonly protocolVersionId: string
    readonly recordedBy: string
    readonly startedAt: string
  }
): void {
  connection
    .prepare<[string, string, string, string, string, string, string, string, string]>(
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
    .run(
      input.id,
      input.patientId,
      input.screeningSessionId,
      input.locationId,
      input.protocolVersionId,
      input.startedAt,
      input.recordedBy,
      input.startedAt,
      input.startedAt
    )
}

function readRawEncounters(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        id,
        patient_id,
        screening_session_id,
        location_id,
        protocol_version_id,
        status,
        source_type,
        recorded_by,
        amendment_of_encounter_id,
        record_version
       FROM screening_encounters
       ORDER BY id`
    )
    .all() as Array<Record<string, unknown>>
}

function readPatient(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<
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

function readRootEncounterCount(connection: Database.Database): number {
  const row = connection
    .prepare(
      `SELECT COUNT(*) AS total
       FROM screening_encounters
       WHERE patient_id = ?
         AND screening_session_id = ?
         AND amendment_of_encounter_id IS NULL`
    )
    .get(patientId, sessionId) as { total: number }

  return row.total
}

function readAuditRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT action, entity_type, entity_id, metadata_json
       FROM audit_log
       ORDER BY rowid`
    )
    .all() as Array<Record<string, unknown>>
}

function readOutboxRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        aggregate_type,
        aggregate_id,
        operation,
        payload_json,
        payload_schema_version,
        status,
        attempt_count
       FROM sync_outbox
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
