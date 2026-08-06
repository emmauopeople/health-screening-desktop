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
  createPatientRepository,
  createProductionDatabaseMigrationRunner
} from '@main/database'
import { createEntityIdGenerator, createUtcClock, parseEntityId } from '@main/foundation'
import type { PatientRegistrationFields } from '@shared/ipc'

const now = '2026-07-29T12:34:56.789Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const generatedIds = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777',
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
] as const

describe('patient registry service integration', () => {
  it('creates searchable patients with immutable local codes, recent access, audit, and outbox rows', async () => {
    await withPatientRegistry(({ connection, service, actor }) => {
      const created = service.create(
        {
          ...createFields({
            givenName: ' Ada ',
            otherNames: ' Marie ',
            familyName: ' Biko ',
            phone: ' 650 555 0100 '
          }),
          duplicateReviewToken: null
        },
        actor
      )

      if (!created.ok || created.data.status !== 'CREATED') {
        throw new Error('Expected patient creation to succeed.')
      }

      expect(created.data.patient).toMatchObject({
        id: generatedIds[0],
        patientCode: 'PT-000001',
        displayName: 'Ada Marie Biko',
        phone: '650 555 0100',
        rowVersion: 1,
        acknowledgment: { status: 'NOT_REQUESTED' },
        createdByDisplayName: 'Admin User',
        updatedByDisplayName: 'Admin User'
      })
      expect(readTableCount(connection, 'patients')).toBe(1)
      expect(readLocalPatientCodeIdentifier(connection, created.data.patient.id)).toEqual({
        identifier_type: 'LOCAL_PATIENT_CODE',
        identifier_value: 'PT-000001',
        status: 'ACTIVE',
        is_primary: 1
      })

      const search = service.search({ query: '6505550100', page: 1, pageSize: 25 }, actor)
      if (!search.ok) {
        throw new Error('Expected patient search to succeed.')
      }
      expect(search.data.items.map((patient) => patient.patientCode)).toEqual(['PT-000001'])
      expect(search.data.total).toBe(1)

      const loaded = service.get({ patientId: created.data.patient.id }, actor)
      expect(loaded.ok).toBe(true)
      const recent = service.listRecent({ limit: 25 }, actor)
      if (!recent.ok) {
        throw new Error('Expected recent patient list to succeed.')
      }
      expect(recent.data.map((patient) => patient.id)).toEqual([created.data.patient.id])
      expect(readAuditActions(connection)).toEqual(['PATIENT_CREATED'])
      expect(readOutboxOperations(connection)).toEqual(['PATIENT_CREATED'])
    })
  })

  it('requires duplicate review before insert and suppresses reviewed pairs until identity changes', async () => {
    await withPatientRegistry(({ connection, service, actor }) => {
      const first = service.create(
        {
          ...createFields({ givenName: 'Ada', familyName: 'Biko', phone: '(650) 555-0100' }),
          duplicateReviewToken: null
        },
        actor
      )
      if (!first.ok || first.data.status !== 'CREATED') {
        throw new Error('Expected first patient creation to succeed.')
      }

      const duplicateAttempt = service.create(
        {
          ...createFields({ givenName: 'Adah', familyName: 'Beko', phone: '650.555.0100' }),
          duplicateReviewToken: null
        },
        actor
      )
      if (!duplicateAttempt.ok || duplicateAttempt.data.status !== 'DUPLICATE_REVIEW_REQUIRED') {
        throw new Error('Expected duplicate review to be required.')
      }

      expect(readTableCount(connection, 'patients')).toBe(1)
      expect(duplicateAttempt.data.candidates[0]?.patient.patientCode).toBe('PT-000001')
      expect(duplicateAttempt.data.candidates[0]?.matchedOn).toContain('phone')

      const second = service.create(
        {
          ...createFields({ givenName: 'Adah', familyName: 'Beko', phone: '650.555.0100' }),
          duplicateReviewToken: duplicateAttempt.data.duplicateReviewToken
        },
        actor
      )
      if (!second.ok || second.data.status !== 'CREATED') {
        throw new Error('Expected reviewed duplicate creation to succeed.')
      }
      expect(second.data.patient.patientCode).toBe('PT-000002')
      expect(readTableCount(connection, 'patients')).toBe(2)

      const pairs = service.findDuplicates({ identity: null, patientId: null, limit: 25 }, actor)
      if (!pairs.ok) {
        throw new Error('Expected possible duplicate lookup to succeed.')
      }
      expect(pairs.data.pairs).toHaveLength(1)
      expect(pairs.data.pairs[0]?.matchedOn).toContain('phone')

      const review = service.markNotDuplicate(
        {
          patientIdA: first.data.patient.id,
          patientIdB: second.data.patient.id,
          reasonCodes: ['manual review']
        },
        actor
      )
      if (!review.ok) {
        throw new Error('Expected duplicate review save to succeed.')
      }
      expect(review.data.status).toBe('MARKED_NOT_DUPLICATE')
      expect(readDuplicateReview(connection)).toMatchObject({
        pair_key: `${first.data.patient.id}:${second.data.patient.id}`,
        status: 'NOT_DUPLICATE',
        reason_codes_json: '["MANUAL_REVIEW"]'
      })
      expect(readDuplicateReview(connection)?.patient_a_identity_key.length).toBeGreaterThan(0)
      expect(readDuplicateReview(connection)?.patient_b_identity_key.length).toBeGreaterThan(0)

      const suppressed = service.findDuplicates(
        { identity: null, patientId: null, limit: 25 },
        actor
      )
      if (!suppressed.ok) {
        throw new Error('Expected possible duplicate lookup to succeed.')
      }
      expect(suppressed.data.pairs).toEqual([])

      const stillSuppressed = service.findDuplicates(
        { identity: null, patientId: null, limit: 25 },
        actor
      )
      if (!stillSuppressed.ok) {
        throw new Error('Expected possible duplicate lookup to succeed.')
      }
      expect(stillSuppressed.data.pairs).toEqual([])
      expect(readOutboxOperations(connection)).toEqual([
        'PATIENT_CREATED',
        'PATIENT_CREATED',
        'DUPLICATE_REVIEWED'
      ])
    })
  })
})

interface PatientRegistryHarness {
  readonly connection: Database.Database
  readonly service: ReturnType<typeof createPatientRegistryService>
  readonly actor: { readonly userId: ReturnType<typeof parseEntityId> }
}

async function withPatientRegistry(test: (harness: PatientRegistryHarness) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd025-patient-registry-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: { now: () => now }
    })(connection)
    insertInstallation(connection)
    insertUser(connection)

    const ids = [...generatedIds]
    let clockTick = 0
    const service = createPatientRegistryService({
      installationRepository: createInstallationRepository(connection),
      patientRepository: createPatientRepository(connection),
      auditEventRepository: createAuditEventRepository(connection),
      transactionExecutor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => {
          const nextId = ids.shift()

          if (nextId === undefined) {
            throw new Error('Ran out of generated IDs.')
          }

          return nextId
        }),
        clock: createUtcClock(() => {
          const timestamp = new Date(Date.parse(now) + clockTick).toISOString()
          clockTick += 1

          return timestamp
        }),
        logger: { error: vi.fn() }
      })
    })

    test({ connection, service, actor: { userId: parseEntityId(userId) } })
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function configurePragmas(connection: Database.Database): void {
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
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
      ) VALUES (1, ?, ?, ?, ?, ?)`
    )
    .run(installationId, 'Local Deployment', 'Africa/Douala', now, now)
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
        locked_until,
        last_login_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, NULL, NULL, ?, ?)`
    )
    .run(userId, 'Admin.User', 'admin.user', 'Admin User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
}

function createFields(
  overrides: Partial<PatientRegistrationFields> = {}
): PatientRegistrationFields {
  return {
    givenName: 'Ada',
    familyName: 'Biko',
    otherNames: null,
    dateOfBirth: '1990-01-01',
    approximateAgeYears: null,
    ageAsOfDate: null,
    sex: 'FEMALE',
    village: 'Melen',
    quarter: null,
    phone: null,
    alternateContactName: null,
    alternateContactPhone: null,
    residenceNotes: null,
    status: 'ACTIVE',
    ...overrides
  }
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
    total: number
  }

  return row.total
}

function readLocalPatientCodeIdentifier(
  connection: Database.Database,
  patientId: string
): {
  identifier_type: string
  identifier_value: string
  status: string
  is_primary: number
} | null {
  return (connection
    .prepare(
      `SELECT identifier_type, identifier_value, status, is_primary
         FROM patient_identifiers
         WHERE patient_id = ?`
    )
    .get(patientId) ?? null) as {
    identifier_type: string
    identifier_value: string
    status: string
    is_primary: number
  } | null
}

function readAuditActions(connection: Database.Database): string[] {
  return (
    connection.prepare('SELECT action FROM audit_log ORDER BY rowid').all() as Array<{
      action: string
    }>
  ).map((row) => row.action)
}

function readOutboxOperations(connection: Database.Database): string[] {
  return (
    connection.prepare('SELECT operation FROM sync_outbox ORDER BY rowid').all() as Array<{
      operation: string
    }>
  ).map((row) => row.operation)
}

function readDuplicateReview(connection: Database.Database): {
  pair_key: string
  patient_a_identity_key: string
  patient_b_identity_key: string
  status: string
  reason_codes_json: string
} | null {
  return (connection
    .prepare(
      `SELECT pair_key, patient_a_identity_key, patient_b_identity_key, status, reason_codes_json
         FROM patient_duplicate_reviews`
    )
    .get() ?? null) as {
    pair_key: string
    patient_a_identity_key: string
    patient_b_identity_key: string
    status: string
    reason_codes_json: string
  } | null
}
