import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { createPatientRegistryService } from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createLocalUserRepository,
  createPatientRepository,
  createProductionDatabaseMigrationRunner
} from '@main/database'
import {
  createEntityIdGenerator,
  createUtcClock,
  parseEntityId,
  parseUtcTimestamp
} from '@main/foundation'
import type { PatientCreateRequest } from '@shared/ipc'

const now = parseUtcTimestamp('2026-08-03T12:00:00.000Z')
const installationId = parseEntityId('00000000-0000-4000-8000-000000000010')
const actorId = parseEntityId('00000000-0000-4000-8000-000000000011')

describe('patient registry service integration', () => {
  it('requires duplicate review before creating a matching patient and records the override audit', async () => {
    await withPatientRegistryService(({ connection, service, actor }) => {
      const first = service.create(actor, createRequest())

      expect(first.status).toBe('CREATED')
      expect(first.status === 'CREATED' ? first.patient.patientCode : null).toBe('PT-000001')

      const duplicateDraft = createRequest({
        phone: '+1 312 555 0101',
        acknowledgmentReference: 'duplicate reviewed with patient present'
      })
      const duplicateReview = service.findDuplicates(actor, duplicateDraft)
      const blocked = service.create(actor, duplicateDraft)

      expect(blocked.status).toBe('DUPLICATE_REVIEW_REQUIRED')
      expect(blocked.status === 'DUPLICATE_REVIEW_REQUIRED' ? blocked.reviewToken : null).toBe(
        duplicateReview.reviewToken
      )
      expect(
        blocked.status === 'DUPLICATE_REVIEW_REQUIRED'
          ? blocked.candidates.map((candidate) => ({
              code: candidate.patient.patientCode,
              reasons: candidate.reasonCodes
            }))
          : []
      ).toEqual([
        {
          code: 'PT-000001',
          reasons: ['EXACT_PHONE', 'DOB_SIMILAR_NAME', 'EXACT_NAME_RESIDENCE']
        }
      ])
      expect(readTableCount(connection, 'patients')).toBe(1)
      expect(readTableCount(connection, 'sync_outbox')).toBe(1)
      expect(readAuditActions(connection)).toEqual(['PATIENT_CREATED'])

      const createdAfterReview = service.create(actor, {
        ...duplicateDraft,
        reviewedDuplicateToken: duplicateReview.reviewToken
      })

      expect(createdAfterReview.status).toBe('CREATED')
      expect(
        createdAfterReview.status === 'CREATED' ? createdAfterReview.patient.patientCode : null
      ).toBe('PT-000002')
      expect(readTableCount(connection, 'patients')).toBe(2)
      expect(readTableCount(connection, 'patient_identifiers')).toBe(2)
      expect(readTableCount(connection, 'consent_records')).toBe(2)
      expect(readTableCount(connection, 'sync_outbox')).toBe(2)
      expect(readAuditActions(connection).sort()).toEqual([
        'DUPLICATE_OVERRIDE',
        'PATIENT_CREATED',
        'PATIENT_CREATED'
      ])

      const search = service.search(actor, { query: 'alice tangwa', page: 1, pageSize: 25 })

      expect(search.total).toBe(2)
      expect(search.rows.every((patient) => patient.lastScreening === null)).toBe(true)
      expect(search.rows.every((patient) => patient.referralFollowUp === null)).toBe(true)
    })
  })

  it('rejects stale duplicate review tokens without writing registry side effects', async () => {
    await withPatientRegistryService(({ connection, service, actor }) => {
      service.create(actor, createRequest())

      const staleReview = service.create(actor, {
        ...createRequest({ phone: '312-555-0101' }),
        phone: '+1 312 555 0101',
        reviewedDuplicateToken: 'stale-review-token'
      })

      expect(staleReview.status).toBe('DUPLICATE_REVIEW_REQUIRED')
      expect(readTableCount(connection, 'patients')).toBe(1)
      expect(readTableCount(connection, 'patient_identifiers')).toBe(1)
      expect(readTableCount(connection, 'consent_records')).toBe(1)
      expect(readTableCount(connection, 'sync_outbox')).toBe(1)
      expect(readAuditActions(connection)).toEqual(['PATIENT_CREATED'])
    })
  })
})

async function withPatientRegistryService(
  test: (context: {
    readonly connection: Database.Database
    readonly service: ReturnType<typeof createPatientRegistryService>
    readonly actor: Parameters<ReturnType<typeof createPatientRegistryService>['create']>[0]
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd025-patient-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configureHsd006Pragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: {
        info: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>()
      },
      clock: { now: () => now }
    })(connection)
    insertInstallation(connection)
    insertUser(connection)

    const localUserRepository = createLocalUserRepository(connection)
    const actor = { user: localUserRepository.getById(actorId)! }

    test({
      connection,
      actor,
      service: createPatientRegistryService({
        installationRepository: createInstallationRepository(connection),
        patientRepository: createPatientRepository(connection),
        auditEventRepository: createAuditEventRepository(connection),
        transactionExecutor: createDatabaseTransactionExecutor({
          connection,
          idGenerator: createEntityIdGenerator(createSequentialUuidProvider()),
          clock: createUtcClock(() => now),
          logger: {
            error: vi.fn<(message: string) => void>()
          }
        })
      })
    })
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function configureHsd006Pragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
}

function createRequest(overrides: Partial<PatientCreateRequest> = {}): PatientCreateRequest {
  return {
    givenName: 'Alice',
    middleName: null,
    familyName: 'Tangwa',
    sex: 'FEMALE',
    dateOfBirth: '1990-05-12',
    approximateAgeYears: null,
    approximateAgeAsOfDate: null,
    village: 'Nkwen',
    quarter: 'Upper',
    phone: '+1 312 555 0101',
    acknowledgmentStatus: 'ACKNOWLEDGED',
    acknowledgmentReference: null,
    reviewedDuplicateToken: null,
    ...overrides
  }
}

function createSequentialUuidProvider(): () => string {
  let nextValue = 1000

  return () => {
    nextValue += 1
    return `00000000-0000-4000-8000-${String(nextValue).padStart(12, '0')}`
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
      ) VALUES (1, ?, 'Test Deployment', 'America/Chicago', ?, ?)`
    )
    .run(installationId, now, now)
}

function insertUser(connection: Database.Database): void {
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
      ) VALUES (?, 'admin', 'admin', 'Administrator', 'hash', 'salt', 'LOCAL_ADMIN', 1, 0, 0, ?, ?)`
    )
    .run(actorId, now, now)
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return row.count
}

function readAuditActions(connection: Database.Database): string[] {
  return (
    connection.prepare('SELECT action FROM audit_log ORDER BY occurred_at, id').all() as Array<{
      action: string
    }>
  ).map((row) => row.action)
}
