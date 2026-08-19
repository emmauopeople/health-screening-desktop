import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createInstallationLocationService,
  createScreeningOtcService,
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionUnauthenticatedError,
  type CurrentScreeningSessionService,
  type LocalAuthenticationSessionService,
  type ScreeningOtcService
} from '@main/application'
import {
  RepositoryWriteError,
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationLocationConfigurationRepository,
  createInstallationRepository,
  createLocationRepository,
  createOtcRepository,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  createScreeningSessionRepository,
  parseLocationName,
  parseScreeningSessionDate,
  parseUserDisplayName,
  parseUsername,
  type LocalUserRecord,
  type LocalUserRole,
  type ScreeningEncounterOutboxRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-10T12:00:00.000Z' as UtcTimestamp
const later = '2026-08-10T13:00:00.000Z' as UtcTimestamp
const ids = Object.freeze({
  installation: 'c1000000-0000-4000-8000-000000000001',
  admin: 'c1000000-0000-4000-8000-000000000002',
  location: 'c1000000-0000-4000-8000-000000000003',
  otherLocation: 'c1000000-0000-4000-8000-000000000012',
  patient: 'c1000000-0000-4000-8000-000000000004',
  session: 'c1000000-0000-4000-8000-000000000005',
  encounter: 'c1000000-0000-4000-8000-000000000006',
  draft: 'c1000000-0000-4000-8000-000000000008',
  row: 'c1000000-0000-4000-8000-000000000009',
  audit: 'c1000000-0000-4000-8000-000000000010',
  outbox: 'c1000000-0000-4000-8000-000000000011'
})

describe('screening OTC application service integration', () => {
  it.each(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)(
    'allows approved role %s to load a workspace',
    async (role) => {
      await withOtcService(
        ({ service }) => {
          const result = service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })
          expect(result).toMatchObject({
            status: 'LOADED',
            workspace: { encounterId: ids.encounter, draft: null, recentMedications: [] }
          })
        },
        { sessionRole: role }
      )
    }
  )

  it('maps authentication and request failures to controlled outcomes', async () => {
    await withOtcService(
      ({ service }) => {
        expect(service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })).toEqual({
          status: 'AUTHENTICATION_REQUIRED'
        })
      },
      { authenticationFailure: new LocalSessionLockedError() }
    )
    await withOtcService(
      ({ service }) => {
        expect(service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })).toEqual({
          status: 'AUTHENTICATION_REQUIRED'
        })
      },
      { authenticationFailure: new LocalSessionUnauthenticatedError() }
    )
    await withOtcService(
      ({ service }) => {
        expect(service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })).toEqual({
          status: 'FORBIDDEN'
        })
      },
      { authenticationFailure: new LocalSessionAuthorizationError() }
    )
    await withOtcService(({ service }) => {
      expect(service.saveDraft({ ...draftRequest(), extra: true } as never)).toEqual({
        status: 'VALIDATION_FAILED'
      })
    })
  })

  it('creates a permissive blank draft for the current session and returns authoritative workspace', async () => {
    await withOtcService(({ connection, service, currentSessionCalls }) => {
      const result = service.saveDraft(draftRequest())

      expect(result.status).toBe('SAVED')
      if (result.status !== 'SAVED') return
      expect(result.workspace.draft).toMatchObject({
        encounterId: ids.encounter,
        otcResponse: null,
        rowVersion: 1,
        periodStart: '2026-08-04',
        periodEnd: '2026-08-10',
        rows: []
      })
      expect(readCount(connection, 'otc_drafts')).toBe(1)
      expect(readCount(connection, 'otc_draft_rows')).toBe(0)
      expect(currentSessionCalls.count).toBe(1)
    })
  })

  it('saves partial rows without completing or locking OTC', async () => {
    await withOtcService(({ service }) => {
      const saved = service.saveDraft(
        draftRequest({
          otcResponse: null,
          rows: [
            {
              id: null,
              sequenceNumber: 1,
              productName: null,
              reasonForUse: '  headache  ',
              doseText: '  1 tablet  ',
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTakingResponse: null
            }
          ]
        })
      )

      expect(saved.status).toBe('SAVED')
      if (saved.status !== 'SAVED' || saved.workspace.draft === null) return
      expect(saved.workspace.draft).toMatchObject({
        otcResponse: null,
        rowVersion: 2,
        rows: [
          {
            productNameSnapshot: null,
            productNameNormalized: null,
            reasonForUse: 'headache',
            doseText: '1 tablet'
          }
        ]
      })
      expect(saved.workspace.draft).not.toHaveProperty('status')
    })
  })

  it('clears rows for explicit non-reported responses and preserves REPORTED with zero rows', async () => {
    await withOtcService(({ service }) => {
      const reported = service.saveDraft(
        draftRequest({
          otcResponse: 'REPORTED',
          rows: [
            {
              id: null,
              sequenceNumber: 1,
              productName: 'Pain reliever',
              reasonForUse: null,
              doseText: null,
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTakingResponse: null
            }
          ]
        })
      )
      if (reported.status !== 'SAVED' || reported.workspace.draft === null)
        throw new Error('save failed')

      const unknown = service.saveDraft(
        draftRequest({
          expectedVersion: reported.workspace.draft.rowVersion,
          otcResponse: 'UNKNOWN',
          rows: []
        })
      )
      expect(unknown).toMatchObject({
        status: 'SAVED',
        workspace: { draft: { otcResponse: 'UNKNOWN', rows: [] } }
      })
      if (unknown.status !== 'SAVED' || unknown.workspace.draft === null) return

      const emptyReported = service.saveDraft(
        draftRequest({
          expectedVersion: unknown.workspace.draft.rowVersion,
          otcResponse: 'REPORTED',
          rows: []
        })
      )
      expect(emptyReported).toMatchObject({
        status: 'SAVED',
        workspace: { draft: { otcResponse: 'REPORTED', rows: [] } }
      })
    })
  })

  it('enforces expected versions and rejects non-draft, amendment, wrong-location, and closed-session contexts', async () => {
    await withOtcService(({ connection, service }) => {
      const saved = service.saveDraft(draftRequest())
      expect(saved.status).toBe('SAVED')
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'VERSION_CONFLICT' })

      connection
        .prepare("UPDATE screening_encounters SET status = 'COMPLETED' WHERE id = ?")
        .run(ids.encounter)
      expect(service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })).toEqual({
        status: 'ENCOUNTER_NOT_EDITABLE'
      })
    })

    await withOtcService(({ connection, service }) => {
      connection
        .prepare('UPDATE screening_encounters SET amendment_of_encounter_id = ? WHERE id = ?')
        .run(ids.encounter, ids.encounter)
      expect(service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })).toEqual({
        status: 'ENCOUNTER_NOT_FOUND'
      })
    })

    await withOtcService(({ connection, service }) => {
      connection
        .prepare(
          "UPDATE screening_sessions SET status = 'CLOSED', closed_by = ?, closed_at = ? WHERE id = ?"
        )
        .run(ids.admin, now, ids.session)
      expect(service.getWorkspace({ encounterId: parseEntityId(ids.encounter) })).toEqual({
        status: 'SESSION_CLOSED'
      })
    })
  })

  it('rejects invalid configured/session contexts without side effects', async () => {
    await withOtcService(({ connection, service }) => {
      connection.prepare('DELETE FROM installation_location_configuration').run()
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'LOCATION_NOT_CONFIGURED' })
      expectNoOtcSideEffects(connection)
    })

    await withOtcService(({ connection, service }) => {
      connection.prepare('UPDATE locations SET is_active = 0 WHERE id = ?').run(ids.location)
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'LOCATION_INACTIVE' })
      expectNoOtcSideEffects(connection)
    })

    await withOtcService(({ connection, service }) => {
      insertAlternateLocation(connection)
      connection
        .prepare(
          'UPDATE installation_location_configuration SET location_id = ?, updated_at = ? WHERE singleton_id = 1'
        )
        .run(ids.otherLocation, later)
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'SESSION_NOT_CURRENT' })
      expectNoOtcSideEffects(connection)
    })

    await withOtcService(({ connection, service }) => {
      insertAlternateLocation(connection)
      connection
        .prepare('UPDATE screening_sessions SET location_id = ?, updated_at = ? WHERE id = ?')
        .run(ids.otherLocation, later, ids.session)
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'SESSION_NOT_CURRENT' })
      expectNoOtcSideEffects(connection)
    })

    await withOtcService(({ connection, service }) => {
      connection.pragma('foreign_keys = OFF')
      connection
        .prepare('UPDATE screening_encounters SET screening_session_id = ? WHERE id = ?')
        .run('c1000000-0000-4000-8000-000000000099', ids.encounter)
      connection.pragma('foreign_keys = ON')
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'SESSION_NOT_FOUND' })
      expectNoOtcSideEffects(connection)
    })

    await withOtcService(({ connection, service }) => {
      connection
        .prepare(
          "UPDATE screening_sessions SET status = 'CLOSED', closed_by = ?, closed_at = ? WHERE id = ?"
        )
        .run(ids.admin, now, ids.session)
      expect(service.saveDraft(draftRequest())).toEqual({ status: 'SESSION_CLOSED' })
      expectNoOtcSideEffects(connection)
    })
  }, 15_000)

  it('rejects first draft creation when the encounter is not in the current session', async () => {
    await withOtcService(
      ({ connection, service }) => {
        expect(service.saveDraft(draftRequest())).toEqual({ status: 'SESSION_NOT_CURRENT' })
        expectNoOtcSideEffects(connection)
      },
      { currentSessionStatus: 'SESSION_NOT_FOUND' }
    )
  })

  it('rolls back draft writes when audit/outbox insertion fails', async () => {
    await withOtcService(
      ({ connection, service }) => {
        expect(service.saveDraft(draftRequest())).toEqual({ status: 'UNAVAILABLE' })
        expectNoOtcSideEffects(connection)
      },
      { failOutbox: true }
    )
  })

  it('does not duplicate audit or outbox events for equivalent saves', async () => {
    await withOtcService(({ connection, service }) => {
      const blank = service.saveDraft(draftRequest())
      expect(blank.status).toBe('SAVED')
      if (blank.status !== 'SAVED' || blank.workspace.draft === null) return
      expect(readCount(connection, 'audit_log')).toBe(1)
      expect(readCount(connection, 'sync_outbox')).toBe(1)

      const unchangedBlank = service.saveDraft(
        draftRequest({ expectedVersion: blank.workspace.draft.rowVersion })
      )
      expect(unchangedBlank.status).toBe('SAVED')
      if (unchangedBlank.status !== 'SAVED' || unchangedBlank.workspace.draft === null) return
      expect(unchangedBlank.workspace.draft.rowVersion).toBe(blank.workspace.draft.rowVersion)
      expect(readCount(connection, 'audit_log')).toBe(1)
      expect(readCount(connection, 'sync_outbox')).toBe(1)

      const updated = service.saveDraft(
        draftRequest({
          expectedVersion: unchangedBlank.workspace.draft.rowVersion,
          otcResponse: 'REPORTED',
          rows: [
            {
              id: null,
              sequenceNumber: 1,
              productName: 'Pain reliever',
              reasonForUse: 'Headache',
              doseText: null,
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTakingResponse: 'YES'
            }
          ]
        })
      )
      expect(updated.status).toBe('SAVED')
      if (updated.status !== 'SAVED' || updated.workspace.draft === null) return
      expect(updated.workspace.draft.rowVersion).toBe(2)
      expect(readCount(connection, 'audit_log')).toBe(2)
      expect(readCount(connection, 'sync_outbox')).toBe(2)
      const row = updated.workspace.draft.rows[0]
      if (row === undefined) throw new Error('missing row')

      const equivalentStale = service.saveDraft(
        draftRequest({
          expectedVersion: 1,
          otcResponse: 'REPORTED',
          rows: [
            {
              id: row.id,
              sequenceNumber: 1,
              productName: row.productNameSnapshot,
              reasonForUse: row.reasonForUse,
              doseText: null,
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTakingResponse: 'YES'
            }
          ]
        })
      )
      expect(equivalentStale.status).toBe('SAVED')
      if (equivalentStale.status !== 'SAVED' || equivalentStale.workspace.draft === null) return
      expect(equivalentStale.workspace.draft.rowVersion).toBe(2)
      expect(equivalentStale.workspace.draft.rows[0]?.updatedAt).toBe(row.updatedAt)
      expect(readCount(connection, 'audit_log')).toBe(2)
      expect(readCount(connection, 'sync_outbox')).toBe(2)

      expect(
        service.saveDraft(
          draftRequest({
            expectedVersion: 1,
            otcResponse: 'REPORTED',
            rows: [
              {
                id: row.id,
                sequenceNumber: 1,
                productName: row.productNameSnapshot,
                reasonForUse: row.reasonForUse,
                doseText: 'changed',
                frequencyText: null,
                durationText: null,
                sourceOfMedication: null,
                currentlyTakingResponse: 'YES'
              }
            ]
          })
        )
      ).toEqual({ status: 'VERSION_CONFLICT' })
    })
  })

  it('treats reverse-array equivalent saves as unchanged in the service', async () => {
    await withOtcService(({ connection, service }) => {
      const created = service.saveDraft(
        draftRequest({
          otcResponse: 'REPORTED',
          rows: [
            {
              id: null,
              sequenceNumber: 1,
              productName: 'Pain reliever',
              reasonForUse: 'Headache',
              doseText: null,
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTakingResponse: 'YES'
            },
            {
              id: null,
              sequenceNumber: 2,
              productName: 'Cough syrup',
              reasonForUse: 'Cough',
              doseText: null,
              frequencyText: null,
              durationText: null,
              sourceOfMedication: null,
              currentlyTakingResponse: 'NO'
            }
          ]
        })
      )
      expect(created.status).toBe('SAVED')
      if (created.status !== 'SAVED' || created.workspace.draft === null) return
      const createdDraft = created.workspace.draft
      const rows = createdDraft.rows
      if (rows.length !== 2) throw new Error('expected two rows')
      const reverseRows = [
        {
          id: rows[1]!.id,
          sequenceNumber: 2,
          productName: rows[1]!.productNameSnapshot,
          reasonForUse: rows[1]!.reasonForUse,
          doseText: null,
          frequencyText: null,
          durationText: null,
          sourceOfMedication: null,
          currentlyTakingResponse: 'NO' as const
        },
        {
          id: rows[0]!.id,
          sequenceNumber: 1,
          productName: rows[0]!.productNameSnapshot,
          reasonForUse: rows[0]!.reasonForUse,
          doseText: null,
          frequencyText: null,
          durationText: null,
          sourceOfMedication: null,
          currentlyTakingResponse: 'YES' as const
        }
      ]

      const current = service.saveDraft(
        draftRequest({
          expectedVersion: createdDraft.rowVersion,
          otcResponse: 'REPORTED',
          rows: reverseRows
        })
      )
      expect(current.status).toBe('SAVED')
      if (current.status !== 'SAVED' || current.workspace.draft === null) return
      expect(current.workspace.draft.rowVersion).toBe(createdDraft.rowVersion)
      expect(current.workspace.draft.updatedAt).toBe(createdDraft.updatedAt)
      expect(current.workspace.draft.rows.map((row) => row.id)).toEqual(rows.map((row) => row.id))
      expect(current.workspace.draft.rows.map((row) => row.updatedAt)).toEqual(
        rows.map((row) => row.updatedAt)
      )

      const stale = service.saveDraft(
        draftRequest({
          expectedVersion: 1,
          otcResponse: 'REPORTED',
          rows: reverseRows
        })
      )
      expect(stale.status).toBe('SAVED')
      if (stale.status !== 'SAVED' || stale.workspace.draft === null) return
      expect(stale.workspace.draft.rowVersion).toBe(createdDraft.rowVersion)
      expect(readCount(connection, 'audit_log')).toBe(1)
      expect(readCount(connection, 'sync_outbox')).toBe(1)
    })
  })

  it('writes audit/outbox metadata without medication values or free text', async () => {
    await withOtcService(({ connection, service }) => {
      const result = service.saveDraft(
        draftRequest({
          otcResponse: 'REPORTED',
          rows: [
            {
              id: null,
              sequenceNumber: 1,
              productName: 'Pain reliever',
              reasonForUse: 'Headache',
              doseText: '1 tablet',
              frequencyText: 'daily',
              durationText: '2 days',
              sourceOfMedication: 'Pharmacy',
              currentlyTakingResponse: 'YES'
            }
          ]
        })
      )
      expect(result.status).toBe('SAVED')

      const auditMetadata = readJsonMetadata(connection, 'audit_log')
      const outboxPayload = readJsonMetadata(connection, 'sync_outbox')
      expect(auditMetadata).toEqual(outboxPayload)
      expect(auditMetadata).toEqual({
        draft_id: ids.draft,
        encounter_id: ids.encounter,
        row_version: 2,
        row_count: 1
      })
      const serialized = JSON.stringify(auditMetadata)
      for (const prohibited of [
        'Pain',
        'pain',
        'Headache',
        'tablet',
        'daily',
        'days',
        'Pharmacy',
        'YES',
        'REPORTED'
      ]) {
        expect(serialized).not.toContain(prohibited)
      }
    })
  })
})

interface OtcServiceOptions {
  readonly sessionRole?: LocalUserRole
  readonly authenticationFailure?: Error
  readonly currentSessionStatus?: 'FOUND' | 'SESSION_NOT_FOUND' | 'SESSION_CLOSED'
  readonly failOutbox?: boolean
}

async function withOtcService(
  test: (context: {
    readonly connection: Database.Database
    readonly service: ScreeningOtcService
    readonly currentSessionCalls: { count: number }
  }) => void,
  options: OtcServiceOptions = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd048-otc-service-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    seedCoreGraph(connection)
    const authenticationSessionService = createAuthenticationSessionService(options)
    const installationRepository = createInstallationRepository(connection)
    const locationRepository = createLocationRepository(connection)
    const installationConfigurationRepository =
      createInstallationLocationConfigurationRepository(connection)
    const screeningSessionRepository = createScreeningSessionRepository(connection)
    const screeningEncounterRepository = createScreeningEncounterRepository(connection)
    const auditEventRepository = createAuditEventRepository(connection)
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(
        createQueuedIdGenerator([ids.draft, ids.row, ids.audit, ids.outbox])
      ),
      clock: createUtcClock(createQueuedClock([now, later, later, later]))
    })
    const installationLocationService = createInstallationLocationService({
      authenticationSessionService,
      installationRepository,
      locationRepository,
      installationLocationConfigurationRepository: installationConfigurationRepository,
      screeningSessionRepository,
      screeningEncounterRepository,
      auditEventRepository,
      transactionExecutor
    })
    const currentSessionCalls = { count: 0 }
    const currentScreeningSessionService = createMockCurrentSessionService(
      options,
      currentSessionCalls
    )
    const outboxRepository = options.failOutbox
      ? createFailingOutboxRepository()
      : createScreeningEncounterOutboxRepository(connection)
    const service = createScreeningOtcService({
      authenticationSessionService,
      currentScreeningSessionService,
      installationLocationService,
      installationRepository,
      locationRepository,
      screeningSessionRepository,
      screeningEncounterRepository,
      otcRepository: createOtcRepository(connection),
      screeningEncounterOutboxRepository: outboxRepository,
      auditEventRepository,
      transactionExecutor
    })
    test({ connection, service, currentSessionCalls })
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function createAuthenticationSessionService({
  sessionRole = 'LOCAL_ADMIN',
  authenticationFailure
}: OtcServiceOptions): LocalAuthenticationSessionService {
  return {
    login: vi.fn(),
    logout: vi.fn(),
    unlock: vi.fn(),
    changeRequiredPassword: vi.fn(),
    getSnapshot: vi.fn(),
    requireActive: vi.fn(),
    requireAnyRole: vi.fn((roles: readonly LocalUserRole[]) => {
      if (authenticationFailure !== undefined) throw authenticationFailure
      if (!roles.includes(sessionRole)) throw new LocalSessionAuthorizationError()
      return {
        user: {
          id: parseEntityId(ids.admin),
          username: parseUsername('admin'),
          displayName: parseUserDisplayName('Admin User'),
          role: sessionRole,
          isActive: true,
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: null,
          createdAt: now,
          updatedAt: now
        } satisfies LocalUserRecord
      }
    })
  } as unknown as LocalAuthenticationSessionService
}

function createMockCurrentSessionService(
  options: OtcServiceOptions,
  calls: { count: number }
): CurrentScreeningSessionService {
  return {
    findCurrentScreeningSession: vi.fn(),
    ensureCurrentScreeningSession: vi.fn(),
    findCurrentScreeningSessionInTransaction: vi.fn(() => {
      calls.count += 1
      if (options.currentSessionStatus === 'SESSION_NOT_FOUND')
        return { status: 'SESSION_NOT_FOUND' as const }
      if (options.currentSessionStatus === 'SESSION_CLOSED')
        return { status: 'SESSION_CLOSED' as const }
      return {
        status: 'FOUND' as const,
        session: {
          id: parseEntityId(ids.session),
          locationId: parseEntityId(ids.location),
          protocolVersionId: parseEntityId('00000000-0000-4000-8000-000000000007'),
          sessionDate: parseScreeningSessionDate('2026-08-10'),
          status: 'OPEN',
          openedBy: parseEntityId(ids.admin),
          openedAt: now,
          closedBy: null,
          closedAt: null,
          closeReason: null,
          createdBy: parseEntityId(ids.admin),
          createdAt: now,
          updatedBy: parseEntityId(ids.admin),
          updatedAt: now,
          rowVersion: 1
        }
      }
    })
  } as unknown as CurrentScreeningSessionService
}

function createFailingOutboxRepository(): ScreeningEncounterOutboxRepository {
  return {
    insert: () => {
      throw new RepositoryWriteError()
    }
  }
}

function draftRequest(
  overrides: Partial<Parameters<ScreeningOtcService['saveDraft']>[0]> = {}
): Parameters<ScreeningOtcService['saveDraft']>[0] {
  return {
    encounterId: parseEntityId(ids.encounter),
    expectedVersion: null,
    otcResponse: null,
    rows: [],
    ...overrides
  }
}

function seedCoreGraph(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(ids.admin, 'admin', 'admin', 'Admin User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(
      ids.location,
      parseLocationName('Test Location'),
      'test location',
      'COMMUNITY_SITE',
      ids.admin,
      now,
      ids.admin,
      now
    )
  connection
    .prepare(
      'INSERT INTO installation_location_configuration (singleton_id, installation_id, location_id, configured_by, configured_at, updated_by, updated_at, row_version) VALUES (1, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(ids.installation, ids.location, ids.admin, now, ids.admin, now)
  const protocolId = (
    connection
      .prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE' LIMIT 1")
      .get() as {
      id: string
    }
  ).id
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.patient,
      'TEST-1',
      'Test Patient',
      'test patient',
      'ACTIVE',
      ids.admin,
      now,
      ids.admin,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      ids.session,
      ids.location,
      protocolId,
      '2026-08-10',
      'OPEN',
      ids.admin,
      now,
      ids.admin,
      now,
      ids.admin,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, amendment_of_encounter_id, amendment_reason, void_reason, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, 1, ?, ?)'
    )
    .run(
      ids.encounter,
      ids.patient,
      ids.session,
      ids.location,
      protocolId,
      'DRAFT',
      now,
      'LOCAL',
      ids.admin,
      now,
      now
    )
}

function insertAlternateLocation(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(
      ids.otherLocation,
      parseLocationName('Other Location'),
      'other location',
      'COMMUNITY_SITE',
      ids.admin,
      now,
      ids.admin,
      now
    )
}

function readCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as
    { count?: unknown } | undefined
  return Number(row?.count ?? 0)
}

function expectNoOtcSideEffects(connection: Database.Database): void {
  expect(readCount(connection, 'otc_drafts')).toBe(0)
  expect(readCount(connection, 'audit_log')).toBe(0)
  expect(readCount(connection, 'sync_outbox')).toBe(0)
}

function readJsonMetadata(
  connection: Database.Database,
  tableName: 'audit_log' | 'sync_outbox'
): Record<string, unknown> {
  const column = tableName === 'audit_log' ? 'metadata_json' : 'payload_json'
  const row = connection.prepare(`SELECT ${column} AS json FROM ${tableName}`).get() as
    { json: string } | undefined
  return JSON.parse(row?.json ?? '{}') as Record<string, unknown>
}

function createQueuedIdGenerator(initialIds: readonly string[]): () => string {
  const queue = [...initialIds]
  let generatedSuffix = 100
  return () => {
    const next = queue.shift()
    if (next !== undefined) return next
    const generated = `c1000000-0000-4000-8000-${String(generatedSuffix).padStart(12, '0')}`
    generatedSuffix += 1
    return generated
  }
}

function createQueuedClock(initialTimestamps: readonly string[]): () => string {
  const queue = [...initialTimestamps]
  let last = initialTimestamps.at(-1) ?? now
  return () => {
    const next = queue.shift()
    if (next !== undefined) {
      last = next
      return next
    }
    return last
  }
}
