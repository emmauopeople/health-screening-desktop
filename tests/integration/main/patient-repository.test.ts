import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createPatientRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  type CreatePatientInput,
  type PatientRepository,
  type PatientSearchInput
} from '@main/database'
import {
  createEntityIdGenerator,
  createUtcClock,
  parseEntityId,
  parseUtcTimestamp
} from '@main/foundation'

const now = parseUtcTimestamp('2026-08-03T12:00:00.000Z')
const actorId = parseEntityId('00000000-0000-4000-8000-000000000001')

describe('patient repository integration', () => {
  it('creates local registry patients atomically with sequential codes and searchable summaries', async () => {
    await withPatientRepository(({ connection, repository, executor }) => {
      const first = executor.run((context) =>
        repository.insert(context.connection, createPatientInput('000000000101'))
      )
      const second = executor.run((context) =>
        repository.insert(
          context.connection,
          createPatientInput('000000000102', {
            givenName: 'Beatrice',
            familyName: 'Manka',
            dateOfBirth: null,
            approximateAgeYears: 41,
            approximateAgeAsOfDate: '2026-08-03',
            phone: '+1 (312) 555-0102',
            village: 'Mbingo',
            quarter: 'Lower'
          })
        )
      )

      expect(first.patientCode).toBe('PT-000001')
      expect(second.patientCode).toBe('PT-000002')
      expect(readTableCount(connection, 'patients')).toBe(2)
      expect(readTableCount(connection, 'patient_identifiers')).toBe(2)
      expect(readTableCount(connection, 'consent_records')).toBe(2)
      expect(readTableCount(connection, 'sync_outbox')).toBe(2)
      expect(readLocalSequenceValue(connection)).toBe(3)

      expect(searchCodes(repository, { query: 'PT-000001' })).toEqual(['PT-000001'])
      expect(searchCodes(repository, { query: 'alice' })).toEqual(['PT-000001'])
      expect(searchCodes(repository, { query: '13125550102' })).toEqual(['PT-000002'])
      expect(searchCodes(repository, { filters: { dateOfBirth: '1990-05-12' } })).toEqual([
        'PT-000001'
      ])
      expect(
        searchCodes(repository, {
          filters: {
            approximateAgeYears: 41,
            sex: 'FEMALE',
            village: 'Mbingo',
            quarter: 'Lower'
          }
        })
      ).toEqual(['PT-000002'])
    })
  })

  it('returns deterministic duplicate candidates without merging records', async () => {
    await withPatientRepository(({ repository, executor }) => {
      executor.run((context) =>
        repository.insert(
          context.connection,
          createPatientInput('000000000201', {
            givenName: 'Alice',
            familyName: 'Tangwa',
            dateOfBirth: null,
            approximateAgeYears: 38,
            approximateAgeAsOfDate: '2026-08-03',
            phone: '+1 312 555 0101',
            village: 'Nkwen',
            quarter: 'Upper'
          })
        )
      )
      executor.run((context) =>
        repository.insert(
          context.connection,
          createPatientInput('000000000202', {
            givenName: 'Alice',
            familyName: 'Tangwa',
            phone: '+1 312 555 9999',
            village: 'Nkwen',
            quarter: 'Upper'
          })
        )
      )

      const candidates = repository.findDuplicateCandidates({
        givenName: 'Alice',
        middleName: null,
        familyName: 'Tangwa',
        sex: 'FEMALE',
        dateOfBirth: null,
        approximateAgeYears: 39,
        approximateAgeAsOfDate: '2026-08-03',
        village: 'Nkwen',
        quarter: 'Upper',
        phone: '+1 312 555 0101'
      })

      expect(candidates.map((candidate) => candidate.patient.patientCode)).toEqual([
        'PT-000001',
        'PT-000002'
      ])
      expect(candidates[0]?.reasonCodes).toEqual([
        'EXACT_PHONE',
        'EXACT_NAME_RESIDENCE',
        'APPROXIMATE_AGE_NAME_RESIDENCE'
      ])
      expect(candidates[1]?.reasonCodes).toEqual(['EXACT_NAME_RESIDENCE'])
    })
  })

  it('rolls back patient, identifier, acknowledgment, outbox, and sequence writes together', async () => {
    await withPatientRepository(({ connection, repository, executor }) => {
      expect(() =>
        executor.run((context) => {
          repository.insert(context.connection, createPatientInput('000000000301'))
          throw new Error('abort')
        })
      ).toThrow(DatabaseTransactionExecutionError)

      expect(readTableCount(connection, 'patients')).toBe(0)
      expect(readTableCount(connection, 'patient_identifiers')).toBe(0)
      expect(readTableCount(connection, 'consent_records')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      expect(readLocalSequenceValue(connection)).toBe(1)

      const created = executor.run((context) =>
        repository.insert(context.connection, createPatientInput('000000000302'))
      )

      expect(created.patientCode).toBe('PT-000001')
    })
  })
})

async function withPatientRepository(
  test: (context: {
    readonly connection: Database.Database
    readonly repository: PatientRepository
    readonly executor: ReturnType<typeof createDatabaseTransactionExecutor>
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd025-patient-repository-'))
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
    insertUser(connection)

    test({
      connection,
      repository: createPatientRepository(connection),
      executor: createDatabaseTransactionExecutor({
        connection,
        idGenerator: createEntityIdGenerator(() => '00000000-0000-4000-8000-000000009999'),
        clock: createUtcClock(() => now),
        logger: {
          error: vi.fn<(message: string) => void>()
        }
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

function createPatientInput(
  idSuffix: string,
  overrides: Partial<CreatePatientInput> = {}
): CreatePatientInput {
  return {
    id: parseEntityId(`00000000-0000-4000-8000-${idSuffix}`),
    identifierId: parseEntityId(`00000000-0000-4000-8001-${idSuffix}`),
    acknowledgmentId: parseEntityId(`00000000-0000-4000-8002-${idSuffix}`),
    outboxId: parseEntityId(`00000000-0000-4000-8003-${idSuffix}`),
    createdBy: actorId,
    createdAt: now,
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
    ...overrides
  }
}

function searchCodes(
  repository: PatientRepository,
  overrides: {
    readonly query?: string
    readonly filters?: Partial<PatientSearchInput['filters']>
  }
): string[] {
  return repository
    .search({
      query: overrides.query ?? '',
      filters: {
        dateOfBirth: overrides.filters?.dateOfBirth ?? null,
        approximateAgeYears: overrides.filters?.approximateAgeYears ?? null,
        sex: overrides.filters?.sex ?? null,
        village: overrides.filters?.village ?? null,
        quarter: overrides.filters?.quarter ?? null
      },
      page: 1,
      pageSize: 25
    })
    .rows.map((patient) => patient.patientCode)
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return row.count
}

function readLocalSequenceValue(connection: Database.Database): number {
  const row = connection
    .prepare("SELECT next_value FROM local_sequences WHERE key = 'patient_code'")
    .get() as { next_value: number }

  return row.next_value
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
