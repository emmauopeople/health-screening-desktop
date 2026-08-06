import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createScreeningSessionService,
  ScreeningSessionServicePersistenceError,
  ScreeningSessionServiceStateIntegrityError,
  type ScreeningSessionService,
  type ScreeningSessionServiceActor
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocationRepository,
  createPatientRepository,
  createProductionDatabaseMigrationRunner,
  createProtocolVersionRepository,
  createScreeningSessionOutboxRepository,
  createScreeningSessionRepository,
  RepositoryWriteError,
  parseScreeningSessionDate,
  type AuditEventRepository,
  type DatabaseTransactionExecutor,
  type ScreeningSessionOutboxRepository,
  type ScreeningSessionRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T13:34:56.789Z'
const third = '2026-07-29T14:34:56.789Z'
const fourth = '2026-07-29T15:34:56.789Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const nurseId = '33333333-3333-4333-8333-333333333333'
const screenerId = '44444444-4444-4444-8444-444444444444'
const locationId = '55555555-5555-4555-8555-555555555555'
const inactiveLocationId = '56565656-5656-4656-8656-565656565656'
const secondLocationId = '57575757-5757-4757-8757-575757575757'
const activeProtocolId = '66666666-6666-4666-8666-666666666666'
const inactiveProtocolId = '67676767-6767-4767-8767-676767676767'
const secondActiveProtocolId = '68686868-6868-4868-8868-686868686868'
const sessionId = '77777777-7777-4777-8777-777777777777'
const secondSessionId = '78787878-7878-4787-8787-787878787878'
const createdHistoryId = '88888888-8888-4888-8888-888888888888'
const createdAuditId = '99999999-9999-4999-8999-999999999999'
const createdOutboxId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const closedHistoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const closedAuditId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const closedOutboxId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const reopenedHistoryId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const reopenedAuditId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const reopenedOutboxId = '12121212-1212-4212-8212-121212121212'
const fourthHistoryId = '13131313-1313-4313-8313-131313131313'
const fourthAuditId = '14141414-1414-4414-8414-141414141414'
const fourthOutboxId = '15151515-1515-4515-8515-151515151515'
const patientOutboxId = '16161616-1616-4616-8616-161616161616'
const patientAggregateId = '17171717-1717-4717-8717-171717171717'
const sensitiveNote = 'Private mobile screening setup note'
const sensitiveReason = 'Private close reason'

const adminActor: ScreeningSessionServiceActor = {
  userId: parseEntityId(adminId),
  role: 'LOCAL_ADMIN'
}
const nurseActor: ScreeningSessionServiceActor = {
  userId: parseEntityId(nurseId),
  role: 'NURSE'
}
const screenerActor: ScreeningSessionServiceActor = {
  userId: parseEntityId(screenerId),
  role: 'TRAINED_SCREENER'
}

describe('screening session service integration', () => {
  it('creates, closes, reopens, and closes with audit and outbox rows atomically', async () => {
    await withScreeningSessionService(
      ({ connection, service }) => {
        seedCoreRecords(connection)

        expect(
          service.create(
            {
              locationId: parseEntityId(locationId),
              sessionDate: parseScreeningSessionDate('2026-07-29'),
              notes: sensitiveNote
            },
            adminActor
          )
        ).toMatchObject({
          status: 'CREATED',
          session: {
            id: sessionId,
            status: 'OPEN',
            rowVersion: 1,
            protocolVersionId: activeProtocolId,
            notes: sensitiveNote
          }
        })

        expect(
          service.close(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 1,
              reason: sensitiveReason
            },
            nurseActor
          )
        ).toMatchObject({
          status: 'CLOSED',
          session: {
            status: 'CLOSED',
            rowVersion: 2,
            closedBy: nurseId,
            closedAt: later
          }
        })

        expect(
          service.reopen(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 2,
              reason: 'Screening resumed after staff review.'
            },
            adminActor
          )
        ).toMatchObject({
          status: 'REOPENED',
          session: {
            status: 'OPEN',
            rowVersion: 3,
            openedBy: adminId,
            openedAt: third,
            closedBy: null,
            closedAt: null
          }
        })

        expect(
          service.close(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 3,
              reason: null
            },
            screenerActor
          )
        ).toMatchObject({
          status: 'CLOSED',
          session: {
            status: 'CLOSED',
            rowVersion: 4,
            closedBy: screenerId,
            closedAt: fourth
          }
        })

        expect(readRawSession(connection, sessionId)).toMatchObject({
          status: 'CLOSED',
          row_version: 4,
          closed_by: screenerId,
          closed_at: fourth
        })
        expect(readLifecycleRows(connection, sessionId)).toEqual([
          expect.objectContaining({
            id: createdHistoryId,
            transition_type: 'CREATED',
            prior_row_version: null,
            resulting_row_version: 1,
            changed_by: adminId,
            changed_at: now,
            reason: null
          }),
          expect.objectContaining({
            id: closedHistoryId,
            transition_type: 'CLOSED',
            prior_row_version: 1,
            resulting_row_version: 2,
            changed_by: nurseId,
            changed_at: later,
            reason: sensitiveReason
          }),
          expect.objectContaining({
            id: reopenedHistoryId,
            transition_type: 'REOPENED',
            prior_row_version: 2,
            resulting_row_version: 3,
            changed_by: adminId,
            changed_at: third,
            reason: 'Screening resumed after staff review.'
          }),
          expect.objectContaining({
            id: fourthHistoryId,
            transition_type: 'CLOSED',
            prior_row_version: 3,
            resulting_row_version: 4,
            changed_by: screenerId,
            changed_at: fourth,
            reason: null
          })
        ])
        expect(readAuditRows(connection).map((row) => row.action)).toEqual([
          'SCREENING_SESSION_CREATED',
          'SCREENING_SESSION_CLOSED',
          'SCREENING_SESSION_REOPENED',
          'SCREENING_SESSION_CLOSED'
        ])
        for (const row of readAuditRows(connection)) {
          expect(row.entity_type).toBe('SCREENING_SESSION')
          expect(row.entity_id).toBe(sessionId)
          expect(row.metadata_json).not.toContain(sensitiveNote)
          expect(row.metadata_json).not.toContain(sensitiveReason)
          expect(row.metadata_json).not.toContain('payload')
        }
        expect(readOutboxRows(connection).map((row) => row.operation)).toEqual([
          'SCREENING_SESSION_CREATED',
          'SCREENING_SESSION_CLOSED',
          'SCREENING_SESSION_REOPENED',
          'SCREENING_SESSION_CLOSED'
        ])
        expect(readOutboxRows(connection)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              aggregate_type: 'SCREENING_SESSION',
              aggregate_id: sessionId,
              payload_schema_version: 'screening-session.lifecycle.v1',
              status: 'PENDING',
              attempt_count: 0
            })
          ])
        )
        expect(JSON.parse(readOutboxRows(connection)[0]!.payload_json as string)).toMatchObject({
          screening_session_id: sessionId,
          lifecycle_history_id: createdHistoryId,
          transition_type: 'CREATED',
          notes: sensitiveNote,
          resulting_row_version: 1
        })
        expect(getForeignKeysEnabled(connection)).toBe(1)
      },
      { timestamps: [now, later, third, fourth] }
    )
  })

  it('enforces create policy without partial writes', async () => {
    const cases: readonly {
      readonly name: string
      readonly seed: (connection: Database.Database) => void
      readonly expected:
        | 'LOCATION_NOT_FOUND'
        | 'LOCATION_INACTIVE'
        | 'NO_ACTIVE_PROTOCOL'
        | 'SESSION_DATE_NOT_CURRENT'
      readonly locationId?: string
      readonly sessionDate?: string
    }[] = [
      {
        name: 'missing location',
        seed: (connection: Database.Database) => seedCoreRecords(connection, { location: 'none' }),
        expected: 'LOCATION_NOT_FOUND'
      },
      {
        name: 'inactive location',
        seed: (connection: Database.Database) =>
          seedCoreRecords(connection, { location: 'inactive' }),
        expected: 'LOCATION_INACTIVE',
        locationId: inactiveLocationId
      },
      {
        name: 'missing active protocol',
        seed: (connection: Database.Database) => seedCoreRecords(connection, { protocol: 'none' }),
        expected: 'NO_ACTIVE_PROTOCOL'
      },
      {
        name: 'incorrect deployment-local date',
        seed: (connection: Database.Database) => seedCoreRecords(connection),
        expected: 'SESSION_DATE_NOT_CURRENT',
        sessionDate: '2026-07-28'
      }
    ] as const

    for (const testCase of cases) {
      await withScreeningSessionService(({ connection, service }) => {
        testCase.seed(connection)
        const result = service.create(
          {
            locationId: parseEntityId(testCase.locationId ?? locationId),
            sessionDate: parseScreeningSessionDate(testCase.sessionDate ?? '2026-07-29'),
            notes: null
          },
          adminActor
        )

        expect(result).toEqual({ status: testCase.expected })
        expect(readTableCount(connection, 'screening_sessions')).toBe(0)
        expect(readTableCount(connection, 'screening_session_lifecycle_history')).toBe(0)
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      })
    }
  })

  it('fails closed for impossible multiple ACTIVE protocols without writes', async () => {
    await withScreeningSessionService(({ connection, service }) => {
      seedCoreRecords(connection)
      connection.prepare('DROP INDEX ux_protocol_versions_one_active').run()
      insertProtocolVersion(connection, { id: secondActiveProtocolId, status: 'ACTIVE' })

      const error = captureError(() =>
        service.create(
          {
            locationId: parseEntityId(locationId),
            sessionDate: parseScreeningSessionDate('2026-07-29'),
            notes: null
          },
          adminActor
        )
      )

      expect(error).toBeInstanceOf(ScreeningSessionServiceStateIntegrityError)
      expect(readTableCount(connection, 'screening_sessions')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      expectSafeControlledError(error)
    })
  })

  it('maps duplicate location/date to ALREADY_EXISTS without partial writes', async () => {
    await withScreeningSessionService(({ connection, service }) => {
      seedCoreRecords(connection)
      insertSession(connection)
      insertLifecycleHistory(connection, {
        id: createdHistoryId,
        screeningSessionId: sessionId,
        transitionType: 'CREATED',
        fromStatus: null,
        toStatus: 'OPEN',
        reason: null,
        changedBy: adminId,
        changedAt: now,
        priorRowVersion: null,
        resultingRowVersion: 1
      })

      expect(
        service.create(
          {
            locationId: parseEntityId(locationId),
            sessionDate: parseScreeningSessionDate('2026-07-29'),
            notes: null
          },
          adminActor
        )
      ).toEqual({ status: 'ALREADY_EXISTS' })
      expect(readTableCount(connection, 'screening_sessions')).toBe(1)
      expect(readTableCount(connection, 'screening_session_lifecycle_history')).toBe(1)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('allows concurrent OPEN sessions at different locations', async () => {
    await withScreeningSessionService(
      ({ connection, service }) => {
        seedCoreRecords(connection)
        insertLocation(connection, { id: secondLocationId, name: 'Second Site', isActive: true })

        expect(
          service.create(
            {
              locationId: parseEntityId(locationId),
              sessionDate: parseScreeningSessionDate('2026-07-29'),
              notes: null
            },
            adminActor
          ).status
        ).toBe('CREATED')
        expect(
          service.create(
            {
              locationId: parseEntityId(secondLocationId),
              sessionDate: parseScreeningSessionDate('2026-07-29'),
              notes: null
            },
            nurseActor
          ).status
        ).toBe('CREATED')
        expect(
          readAllSessions(connection)
            .filter((row) => row.status === 'OPEN')
            .map((row) => row.id)
        ).toEqual([sessionId, secondSessionId])
      },
      {
        generatedIds: [
          sessionId,
          createdHistoryId,
          createdAuditId,
          createdOutboxId,
          secondSessionId,
          closedHistoryId,
          closedAuditId,
          closedOutboxId
        ]
      }
    )
  })

  it('preserves close and reopen business outcomes without audit or outbox writes', async () => {
    await withScreeningSessionService(
      ({ connection, service }) => {
        seedCoreRecords(connection)
        insertSession(connection, { rowVersion: 2 })
        insertLifecycleHistory(connection, {
          id: createdHistoryId,
          screeningSessionId: sessionId,
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: adminId,
          changedAt: now,
          priorRowVersion: null,
          resultingRowVersion: 1
        })

        expect(
          service.close(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 1,
              reason: null
            },
            adminActor
          )
        ).toMatchObject({ status: 'SESSION_VERSION_CONFLICT', session: { rowVersion: 2 } })
        expect(
          service.close(
            {
              id: parseEntityId('19191919-1919-4919-8919-191919191919'),
              expectedRowVersion: 1,
              reason: null
            },
            adminActor
          )
        ).toEqual({ status: 'NOT_FOUND' })
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)

        updateSessionClosed(connection, {
          closedBy: adminId,
          closedAt: later,
          rowVersion: 2
        })
        expect(
          service.close(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 2,
              reason: null
            },
            adminActor
          )
        ).toMatchObject({ status: 'ALREADY_CLOSED', session: { rowVersion: 2 } })
        expect(
          service.reopen(
            {
              id: parseEntityId('19191919-1919-4919-8919-191919191919'),
              expectedRowVersion: 2,
              reason: 'Reopen'
            },
            adminActor
          )
        ).toEqual({ status: 'NOT_FOUND' })
        expect(
          service.reopen(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 1,
              reason: 'Reopen'
            },
            adminActor
          )
        ).toMatchObject({ status: 'SESSION_VERSION_CONFLICT', session: { rowVersion: 2 } })

        updateSessionOpen(connection, { rowVersion: 2 })
        expect(
          service.reopen(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 2,
              reason: 'Reopen'
            },
            adminActor
          )
        ).toMatchObject({ status: 'ALREADY_OPEN', session: { rowVersion: 2 } })
        expect(readTableCount(connection, 'audit_log')).toBe(0)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
        expect(readTableCount(connection, 'screening_session_lifecycle_history')).toBe(1)
      },
      { timestamps: [now, later, third, fourth, now, later] }
    )
  })

  it('does not block reopen when retained location or protocol later becomes inactive', async () => {
    await withScreeningSessionService(
      ({ connection, service }) => {
        seedCoreRecords(connection)
        insertSession(connection, {
          status: 'CLOSED',
          closedBy: adminId,
          closedAt: now,
          rowVersion: 2
        })
        insertLifecycleHistory(connection, {
          id: createdHistoryId,
          screeningSessionId: sessionId,
          transitionType: 'CREATED',
          fromStatus: null,
          toStatus: 'OPEN',
          reason: null,
          changedBy: adminId,
          changedAt: now,
          priorRowVersion: null,
          resultingRowVersion: 1
        })
        insertLifecycleHistory(connection, {
          id: closedHistoryId,
          screeningSessionId: sessionId,
          transitionType: 'CLOSED',
          fromStatus: 'OPEN',
          toStatus: 'CLOSED',
          reason: null,
          changedBy: adminId,
          changedAt: later,
          priorRowVersion: 1,
          resultingRowVersion: 2
        })
        setLocationActive(connection, locationId, false)
        setProtocolStatus(connection, activeProtocolId, 'INACTIVE')

        expect(
          service.reopen(
            {
              id: parseEntityId(sessionId),
              expectedRowVersion: 2,
              reason: 'Reopen after review.'
            },
            nurseActor
          )
        ).toMatchObject({ status: 'REOPENED', session: { rowVersion: 3, status: 'OPEN' } })
      },
      { timestamps: [third] }
    )
  })

  it('rolls back the full mutation on failures after session, audit, or outbox writes', async () => {
    for (const failureMode of ['after-session', 'after-audit', 'after-outbox'] as const) {
      await withScreeningSessionService(
        ({ connection, service }) => {
          seedCoreRecords(connection)
          const error = captureError(() =>
            service.create(
              {
                locationId: parseEntityId(locationId),
                sessionDate: parseScreeningSessionDate('2026-07-29'),
                notes: sensitiveNote
              },
              adminActor
            )
          )

          expect(error).toBeInstanceOf(ScreeningSessionServicePersistenceError)
          expect(readTableCount(connection, 'screening_sessions')).toBe(0)
          expect(readTableCount(connection, 'screening_session_lifecycle_history')).toBe(0)
          expect(readTableCount(connection, 'audit_log')).toBe(0)
          expect(readTableCount(connection, 'sync_outbox')).toBe(0)
          expectSafeControlledError(error)
        },
        { failureMode }
      )
    }
  })

  it('keeps patient outbox behavior unchanged', async () => {
    await withScreeningSessionService(({ connection, executor }) => {
      seedCoreRecords(connection)
      const patientRepository = createPatientRepository(connection)

      executor.run((context) =>
        patientRepository.insertOutbox(context.connection, {
          id: parseEntityId(patientOutboxId),
          aggregateId: parseEntityId(patientAggregateId),
          operation: 'PATIENT_CREATED',
          payloadSchemaVersion: 'patient.registry.v1',
          createdAt: parseUtcTimestamp(now),
          payload: Object.freeze({ patient_id: patientAggregateId })
        })
      )

      expect(readOutboxRows(connection)).toEqual([
        expect.objectContaining({
          aggregate_type: 'PATIENT',
          aggregate_id: patientAggregateId,
          operation: 'PATIENT_CREATED',
          payload_schema_version: 'patient.registry.v1',
          status: 'PENDING'
        })
      ])
    })
  })

  it('returns get and list results without writes', async () => {
    await withScreeningSessionService(({ connection, service }) => {
      seedCoreRecords(connection)
      insertSession(connection)

      expect(service.getById({ id: parseEntityId(sessionId) }, adminActor)).toMatchObject({
        status: 'FOUND',
        session: {
          id: sessionId
        }
      })
      expect(
        service.getById({ id: parseEntityId('19191919-1919-4919-8919-191919191919') }, adminActor)
      ).toEqual({ status: 'NOT_FOUND' })
      expect(
        service.list(
          {
            locationId: null,
            status: 'OPEN',
            dateFrom: null,
            dateTo: null,
            page: 1,
            pageSize: 25
          },
          screenerActor
        )
      ).toMatchObject({
        status: 'LISTED',
        total: 1,
        items: [expect.objectContaining({ id: sessionId })]
      })
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })
})

type FailureMode = 'after-session' | 'after-audit' | 'after-outbox'

interface HarnessOptions {
  readonly generatedIds?: readonly string[]
  readonly timestamps?: readonly string[]
  readonly failureMode?: FailureMode
}

interface ScreeningSessionServiceHarness {
  readonly connection: Database.Database
  readonly executor: DatabaseTransactionExecutor
  readonly service: ScreeningSessionService
}

async function withScreeningSessionService(
  test: (harness: ScreeningSessionServiceHarness) => void | Promise<void>,
  options: HarnessOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd027-screening-session-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: createUtcClock(() => now)
    })(connection)

    const ids = [
      ...(options.generatedIds ?? [
        sessionId,
        createdHistoryId,
        createdAuditId,
        createdOutboxId,
        closedHistoryId,
        closedAuditId,
        closedOutboxId,
        reopenedHistoryId,
        reopenedAuditId,
        reopenedOutboxId,
        fourthHistoryId,
        fourthAuditId,
        fourthOutboxId
      ])
    ]
    const timestamps = [...(options.timestamps ?? [now, later, third, fourth])]
    const executor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => {
        const next = ids.shift()

        if (next === undefined) {
          throw new Error('No generated screening-session test ID remains.')
        }

        return next
      }),
      clock: createUtcClock(() => {
        const next = timestamps.shift()

        if (next === undefined) {
          throw new Error('No screening-session test timestamp remains.')
        }

        return next as UtcTimestamp
      }),
      logger: { error: vi.fn() }
    })
    const screeningSessionRepository = createScreeningSessionRepository(connection)
    const auditEventRepository = createAuditEventRepository(connection)
    const outboxRepository = createScreeningSessionOutboxRepository(connection)
    const service = createScreeningSessionService({
      installationRepository: createInstallationRepository(connection),
      locationRepository: createLocationRepository(connection),
      protocolVersionRepository: createProtocolVersionRepository(connection),
      screeningSessionRepository: wrapScreeningSessionRepository(
        screeningSessionRepository,
        options.failureMode
      ),
      screeningSessionOutboxRepository: wrapOutboxRepository(outboxRepository, options.failureMode),
      auditEventRepository: wrapAuditRepository(auditEventRepository, options.failureMode),
      transactionExecutor: executor
    })

    await test({ connection, executor, service })
  } finally {
    if (connection.open) {
      connection.close()
    }
    await rm(directory, { recursive: true, force: true })
  }
}

function wrapScreeningSessionRepository(
  repository: ScreeningSessionRepository,
  failureMode: FailureMode | undefined
): ScreeningSessionRepository {
  return Object.freeze({
    ...repository,
    insert(
      connection: Parameters<ScreeningSessionRepository['insert']>[0],
      input: Parameters<ScreeningSessionRepository['insert']>[1]
    ) {
      const result = repository.insert(connection, input)

      if (failureMode === 'after-session') {
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

function seedCoreRecords(
  connection: Database.Database,
  options: {
    readonly location?: 'active' | 'inactive' | 'none'
    readonly protocol?: 'active' | 'inactive' | 'none'
  } = {}
): void {
  insertInstallation(connection)
  insertUser(connection, { id: adminId, username: 'admin', role: 'LOCAL_ADMIN' })
  insertUser(connection, { id: nurseId, username: 'nurse', role: 'NURSE' })
  insertUser(connection, { id: screenerId, username: 'screener', role: 'TRAINED_SCREENER' })

  if (options.location !== 'none') {
    insertLocation(connection, {
      id: options.location === 'inactive' ? inactiveLocationId : locationId,
      name: options.location === 'inactive' ? 'Inactive Site' : 'Active Site',
      isActive: options.location !== 'inactive'
    })
  }

  if (options.protocol !== 'none') {
    insertProtocolVersion(connection, {
      id: options.protocol === 'inactive' ? inactiveProtocolId : activeProtocolId,
      status: options.protocol === 'inactive' ? 'INACTIVE' : 'ACTIVE'
    })
  }
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
    .run(input.id, input.username, input.username, `${input.username} User`, input.role, now, now)
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
      now,
      adminId,
      now
    )
}

function insertProtocolVersion(
  connection: Database.Database,
  input: { readonly id: string; readonly status: string }
): void {
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
      ) VALUES (?, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      `screening-${input.id}`,
      `label-${input.id}`,
      input.status,
      `checksum-${input.id}`,
      adminId,
      now,
      input.status === 'ACTIVE' ? adminId : null,
      input.status === 'ACTIVE' ? now : null,
      now
    )
}

function insertSession(
  connection: Database.Database,
  overrides: {
    readonly id?: string
    readonly locationId?: string
    readonly protocolVersionId?: string
    readonly status?: string
    readonly closedBy?: string | null
    readonly closedAt?: string | null
    readonly rowVersion?: number
  } = {}
): void {
  const status = overrides.status ?? 'OPEN'
  const closedBy = Object.prototype.hasOwnProperty.call(overrides, 'closedBy')
    ? overrides.closedBy
    : status === 'CLOSED'
      ? adminId
      : null
  const closedAt = Object.prototype.hasOwnProperty.call(overrides, 'closedAt')
    ? overrides.closedAt
    : status === 'CLOSED'
      ? now
      : null

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
      ) VALUES (?, ?, ?, '2026-07-29', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.id ?? sessionId,
      overrides.locationId ?? locationId,
      overrides.protocolVersionId ?? activeProtocolId,
      status,
      adminId,
      now,
      closedBy,
      closedAt,
      adminId,
      now,
      closedBy ?? adminId,
      closedAt ?? now,
      overrides.rowVersion ?? (status === 'OPEN' ? 1 : 2)
    )
}

function insertLifecycleHistory(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly screeningSessionId: string
    readonly transitionType: string
    readonly fromStatus: string | null
    readonly toStatus: string
    readonly reason: string | null
    readonly changedBy: string
    readonly changedAt: string
    readonly priorRowVersion: number | null
    readonly resultingRowVersion: number
  }
): void {
  connection
    .prepare(
      `INSERT INTO screening_session_lifecycle_history (
        id,
        screening_session_id,
        transition_type,
        from_status,
        to_status,
        reason,
        changed_by,
        changed_at,
        prior_row_version,
        resulting_row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.screeningSessionId,
      input.transitionType,
      input.fromStatus,
      input.toStatus,
      input.reason,
      input.changedBy,
      input.changedAt,
      input.priorRowVersion,
      input.resultingRowVersion
    )
}

function updateSessionClosed(
  connection: Database.Database,
  input: { readonly closedBy: string; readonly closedAt: string; readonly rowVersion: number }
): void {
  connection
    .prepare(
      `UPDATE screening_sessions
       SET status = 'CLOSED',
           closed_by = ?,
           closed_at = ?,
           updated_by = ?,
           updated_at = ?,
           row_version = ?
       WHERE id = ?`
    )
    .run(
      input.closedBy,
      input.closedAt,
      input.closedBy,
      input.closedAt,
      input.rowVersion,
      sessionId
    )
}

function updateSessionOpen(
  connection: Database.Database,
  input: { readonly rowVersion: number }
): void {
  connection
    .prepare(
      `UPDATE screening_sessions
       SET status = 'OPEN',
           closed_by = NULL,
           closed_at = NULL,
           updated_by = ?,
           updated_at = ?,
           row_version = ?
       WHERE id = ?`
    )
    .run(adminId, later, input.rowVersion, sessionId)
}

function setLocationActive(connection: Database.Database, id: string, isActive: boolean): void {
  connection.prepare('UPDATE locations SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id)
}

function setProtocolStatus(connection: Database.Database, id: string, status: string): void {
  connection.prepare('UPDATE protocol_versions SET status = ? WHERE id = ?').run(status, id)
}

function readRawSession(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM screening_sessions WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function readAllSessions(connection: Database.Database): Array<Record<string, unknown>> {
  return connection.prepare('SELECT * FROM screening_sessions ORDER BY rowid').all() as Array<
    Record<string, unknown>
  >
}

function readLifecycleRows(
  connection: Database.Database,
  screeningSessionId: string
): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        id,
        transition_type,
        from_status,
        to_status,
        reason,
        changed_by,
        changed_at,
        prior_row_version,
        resulting_row_version
       FROM screening_session_lifecycle_history
       WHERE screening_session_id = ?
       ORDER BY changed_at ASC, id ASC`
    )
    .all(screeningSessionId) as Array<Record<string, unknown>>
}

function readAuditRows(connection: Database.Database): Array<Record<string, string>> {
  return connection
    .prepare(
      `SELECT action, entity_type, entity_id, metadata_json
       FROM audit_log
       ORDER BY rowid`
    )
    .all() as Array<Record<string, string>>
}

function readOutboxRows(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        id,
        aggregate_type,
        aggregate_id,
        operation,
        payload_json,
        payload_schema_version,
        created_at,
        status,
        attempt_count
       FROM sync_outbox
       ORDER BY rowid`
    )
    .all() as Array<Record<string, unknown>>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
    total: number
  }

  return row.total
}

function getForeignKeysEnabled(connection: Database.Database): number {
  return connection.pragma('foreign_keys', { simple: true }) as number
}

function captureError(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw.')
}

function expectSafeControlledError(error: unknown): void {
  const serialized = JSON.stringify(error)

  expect(serialized).not.toContain('C:\\')
  expect(serialized).not.toContain('SELECT')
  expect(serialized).not.toContain('INSERT')
  expect(serialized).not.toContain('sqlite')
  expect(serialized).not.toContain(sensitiveNote)
  expect(serialized).not.toContain(sensitiveReason)
  expect(serialized).not.toContain('payload')
  expect((error as { readonly stack?: unknown }).stack).toBeUndefined()
}
