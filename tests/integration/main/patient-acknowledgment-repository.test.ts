import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createPatientAcknowledgmentRepository,
  createPatientRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  RepositoryWriteError,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type InsertPatientAcknowledgmentInput,
  type PatientAcknowledgmentRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const later = '2026-07-29T12:34:57.789Z'
const actorId = '11111111-1111-4111-8111-111111111111'
const secondActorId = '22222222-2222-4222-8222-222222222222'
const missingActorId = '33333333-3333-4333-8333-333333333333'
const patientId = '44444444-4444-4444-8444-444444444444'
const secondPatientId = '55555555-5555-4555-8555-555555555555'
const thirdPatientId = '66666666-6666-4666-8666-666666666666'
const missingPatientId = '77777777-7777-4777-8777-777777777777'
const acknowledgmentId = '88888888-8888-4888-8888-888888888888'
const secondAcknowledgmentId = '99999999-9999-4999-8999-999999999999'
const generatedId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const registryAcknowledgmentType = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'

describe('patient acknowledgment repository', () => {
  it('inserts acknowledged and declined events with canonical physical values', async () => {
    await withAcknowledgmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            status: 'ACKNOWLEDGED',
            note: '  Patient approved synthetic registry use.  '
          })
        )
      )
      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId(secondAcknowledgmentId),
            status: 'DECLINED',
            note: '   ',
            priorRowVersion: 2,
            resultingRowVersion: 3
          })
        )
      )

      expect(readRawAcknowledgments(connection)).toEqual([
        {
          id: acknowledgmentId,
          patient_id: patientId,
          consent_type: registryAcknowledgmentType,
          status: 'ACKNOWLEDGED',
          source_type: 'LOCAL',
          effective_at: now,
          withdrawn_at: null,
          notes: 'Patient approved synthetic registry use.',
          recorded_by: actorId,
          recorded_at: now,
          patient_prior_row_version: 1,
          patient_resulting_row_version: 2
        },
        {
          id: secondAcknowledgmentId,
          patient_id: patientId,
          consent_type: registryAcknowledgmentType,
          status: 'DECLINED',
          source_type: 'LOCAL',
          effective_at: now,
          withdrawn_at: null,
          notes: null,
          recorded_by: actorId,
          recorded_at: now,
          patient_prior_row_version: 2,
          patient_resulting_row_version: 3
        }
      ])
    })
  })

  it('rejects invalid insert inputs before persisting rows', async () => {
    await withAcknowledgmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      const getterInput = createUncheckedInput(createValidRawInput())
      Object.defineProperty(getterInput, 'id', {
        enumerable: true,
        get: () => parseEntityId(acknowledgmentId)
      })

      const invalidInputs: readonly InsertPatientAcknowledgmentInput[] = [
        createUncheckedInput({ ...createValidRawInput(), status: 'NOT_REQUESTED' }),
        createUncheckedInput({ ...createValidRawInput(), status: 'PENDING' }),
        createUncheckedInput({ ...createValidRawInput(), id: 'bad-id' }),
        createUncheckedInput({ ...createValidRawInput(), patientId: 'bad-id' }),
        createUncheckedInput({ ...createValidRawInput(), recordedBy: 'bad-id' }),
        createUncheckedInput({ ...createValidRawInput(), recordedAt: 'not-a-timestamp' }),
        createUncheckedInput({ ...createValidRawInput(), priorRowVersion: 0 }),
        createUncheckedInput({ ...createValidRawInput(), resultingRowVersion: 3 }),
        createUncheckedInput({ ...createValidRawInput(), extra: 'unexpected' }),
        getterInput,
        createUncheckedInput({ ...createValidRawInput(), note: 'a'.repeat(501) }),
        createUncheckedInput({ ...createValidRawInput(), note: 'Unsafe\nnote' }),
        createUncheckedInput({ ...createValidRawInput(), note: 'Unsafe\uD800note' })
      ]

      for (const input of invalidInputs) {
        expect(() =>
          executor.run((context) => repository.insert(context.connection, input))
        ).toThrow(RepositoryValidationError)
      }

      expect(readTableCount(connection, 'consent_records')).toBe(0)
    })
  })

  it('enforces foreign keys, duplicate IDs, and transaction capability', async () => {
    await withAcknowledgmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      const missingPatientError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({ patientId: parseEntityId(missingPatientId) })
          )
        )
      )
      expect(missingPatientError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(missingPatientError)

      const missingActorError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({ recordedBy: parseEntityId(missingActorId) })
          )
        )
      )
      expect(missingActorError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(missingActorError)

      executor.run((context) => repository.insert(context.connection, createValidInput()))
      const duplicateIdError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({ priorRowVersion: 2, resultingRowVersion: 3 })
          )
        )
      )
      expect(duplicateIdError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(duplicateIdError)

      const rawConnectionError = captureError(() =>
        repository.insert(
          connection as unknown as DatabaseTransactionConnection,
          createValidInput({
            id: parseEntityId(secondAcknowledgmentId),
            priorRowVersion: 2,
            resultingRowVersion: 3
          })
        )
      )
      expect(rawConnectionError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(rawConnectionError)

      const fabricatedError = captureError(() =>
        repository.insert(
          createFabricatedScopedConnection(connection),
          createValidInput({
            id: parseEntityId(secondAcknowledgmentId),
            priorRowVersion: 2,
            resultingRowVersion: 3
          })
        )
      )
      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(fabricatedError)

      let expiredConnection: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        expiredConnection = context.connection
      })
      const expiredError = captureError(() =>
        repository.insert(
          expiredConnection!,
          createValidInput({
            id: parseEntityId(secondAcknowledgmentId),
            priorRowVersion: 2,
            resultingRowVersion: 3
          })
        )
      )
      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(expiredError)

      const fakeConnection = createFakeExecutorConnection()
      const fakeRepository = createPatientAcknowledgmentRepository(fakeConnection)
      createDatabaseTransactionExecutor({
        connection: fakeConnection,
        idGenerator: createEntityIdGenerator(() => generatedId),
        clock: createUtcClock(() => now),
        logger: { error: vi.fn() }
      }).run((context) => fakeRepository.insert(context.connection, createValidInput()))
      expect(fakeConnection.execSql).toEqual(['BEGIN IMMEDIATE', 'COMMIT'])
      expect(fakeConnection.preparedSql.join('\n')).not.toMatch(
        /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/u
      )
    })
  })

  it('rolls back acknowledgment inserts with surrounding transaction failures', async () => {
    await withAcknowledgmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      const thrownError = captureError(() =>
        executor.run((context) => {
          repository.insert(context.connection, createValidInput())
          throw new Error('C:\\secret\\acknowledgment.sqlite3 SELECT consent_records')
        })
      )

      expect(thrownError).toBeInstanceOf(DatabaseTransactionExecutionError)
      expect(readTableCount(connection, 'consent_records')).toBe(0)

      const laterWriteError = captureError(() =>
        executor.run((context) => {
          repository.insert(context.connection, createValidInput())
          insertSetting(context.connection, 'synthetic-key', '"first"')
          insertSetting(context.connection, 'synthetic-key', '"duplicate"')
        })
      )

      expect(laterWriteError).toBeInstanceOf(DatabaseTransactionExecutionError)
      expect(readTableCount(connection, 'consent_records')).toBe(0)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expectSafeControlledError(laterWriteError)
    })
  })

  it('returns paginated immutable patient-isolated history in deterministic order', async () => {
    await withAcknowledgmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawUser(connection, { id: secondActorId, username: 'nurse', displayName: 'Nurse User' })
      insertRawPatient(connection)
      insertRawPatient(connection, { id: secondPatientId, patientCode: 'PT-000002' })
      insertRawAcknowledgment(connection, {
        id: '00000000-0000-4000-8000-000000000001',
        status: 'NOT_REQUESTED',
        notes: null,
        recordedAt: '2026-07-29T11:00:00.000Z',
        effectiveAt: '2026-07-29T11:00:00.000Z',
        priorRowVersion: null,
        resultingRowVersion: null
      })
      insertRawAcknowledgment(connection, {
        id: '00000000-0000-4000-8000-000000000002',
        consentType: 'TEST_UNRELATED_ACKNOWLEDGMENT',
        status: 'ACKNOWLEDGED'
      })

      for (let index = 1; index <= 25; index += 1) {
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              id: parseEntityId(historyAcknowledgmentId(index)),
              status: index % 2 === 0 ? 'DECLINED' : 'ACKNOWLEDGED',
              recordedAt: parseUtcTimestamp(
                `2026-07-29T12:00:${String(index).padStart(2, '0')}.000Z`
              ),
              priorRowVersion: index,
              resultingRowVersion: index + 1
            })
          )
        )
      }

      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
            status: 'DECLINED',
            recordedBy: parseEntityId(secondActorId),
            recordedAt: parseUtcTimestamp(later),
            priorRowVersion: 26,
            resultingRowVersion: 27,
            note: 'Reviewed in synthetic registry.'
          })
        )
      )
      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
            status: 'ACKNOWLEDGED',
            recordedAt: parseUtcTimestamp(later),
            priorRowVersion: 27,
            resultingRowVersion: 28
          })
        )
      )
      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId(secondAcknowledgmentId),
            patientId: parseEntityId(secondPatientId),
            priorRowVersion: 1,
            resultingRowVersion: 2
          })
        )
      )

      const pageOne = repository.listByPatient({
        patientId: parseEntityId(patientId),
        page: 1,
        pageSize: 25
      })
      const pageTwo = repository.listByPatient({
        patientId: parseEntityId(patientId),
        page: 2,
        pageSize: 25
      })
      const pageFifty = repository.listByPatient({
        patientId: parseEntityId(patientId),
        page: 1,
        pageSize: 50
      })
      const pageHundred = repository.listByPatient({
        patientId: parseEntityId(patientId),
        page: 1,
        pageSize: 100
      })
      const isolated = repository.listByPatient({
        patientId: parseEntityId(secondPatientId),
        page: 1,
        pageSize: 25
      })
      const empty = repository.listByPatient({
        patientId: parseEntityId(thirdPatientId),
        page: 1,
        pageSize: 25
      })

      expect(pageOne.total).toBe(28)
      expect(pageOne.items).toHaveLength(25)
      expect(pageTwo.items).toHaveLength(3)
      expect(pageFifty.items).toHaveLength(28)
      expect(pageHundred.items).toHaveLength(28)
      expect(pageOne.items.map((item) => item.id).slice(0, 2)).toEqual([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      ])
      expect(pageOne.items[1]).toMatchObject({
        status: 'DECLINED',
        sourceType: 'LOCAL',
        note: 'Reviewed in synthetic registry.',
        recordedBy: secondActorId,
        recordedByDisplayName: 'Nurse User',
        priorRowVersion: 26,
        resultingRowVersion: 27
      })
      expect(pageFifty.items.at(-1)).toMatchObject({
        status: 'NOT_REQUESTED',
        priorRowVersion: null,
        resultingRowVersion: null
      })
      expect(pageTwo.page).toBe(2)
      expect(pageTwo.pageSize).toBe(25)
      expect(pageTwo.total).toBe(28)
      expect(isolated.total).toBe(1)
      expect(isolated.items.map((item) => item.patientId)).toEqual([secondPatientId])
      expect(empty).toEqual({ items: [], page: 1, pageSize: 25, total: 0 })
      expect(Object.isFrozen(pageOne)).toBe(true)
      expect(Object.isFrozen(pageOne.items)).toBe(true)
      expect(Object.isFrozen(pageOne.items[0])).toBe(true)
    })
  })

  it('retrieves the latest registry acknowledgment with deterministic ordering', async () => {
    await withAcknowledgmentRepository(({ connection, repository }) => {
      insertRawUser(connection)
      insertRawPatient(connection)
      insertRawPatient(connection, { id: secondPatientId, patientCode: 'PT-000002' })
      insertRawPatient(connection, { id: thirdPatientId, patientCode: 'PT-000003' })

      expect(repository.getLatestByPatient(parseEntityId(patientId))).toBeNull()

      insertRawAcknowledgment(connection, {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'ACKNOWLEDGED',
        recordedAt: later,
        effectiveAt: later,
        priorRowVersion: null,
        resultingRowVersion: null
      })
      insertRawAcknowledgment(connection, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'DECLINED',
        recordedAt: later,
        effectiveAt: later,
        priorRowVersion: 1,
        resultingRowVersion: 2
      })
      insertRawAcknowledgment(connection, {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        consentType: 'TEST_UNRELATED_ACKNOWLEDGMENT',
        status: 'DECLINED',
        recordedAt: '2026-07-29T13:00:00.000Z',
        effectiveAt: '2026-07-29T13:00:00.000Z'
      })
      insertRawAcknowledgment(connection, {
        id: secondAcknowledgmentId,
        patientId: secondPatientId,
        status: 'NOT_REQUESTED',
        recordedAt: now,
        effectiveAt: now,
        priorRowVersion: null,
        resultingRowVersion: null
      })

      expect(repository.getLatestByPatient(parseEntityId(patientId))).toMatchObject({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'ACKNOWLEDGED',
        priorRowVersion: null,
        resultingRowVersion: null
      })
      expect(repository.getLatestByPatient(parseEntityId(secondPatientId))).toMatchObject({
        id: secondAcknowledgmentId,
        status: 'NOT_REQUESTED',
        priorRowVersion: null,
        resultingRowVersion: null
      })
      expect(repository.getLatestByPatient(parseEntityId(thirdPatientId))).toBeNull()
    })
  })

  it('fails closed on malformed persisted acknowledgment rows', async () => {
    const malformedCases: readonly MalformedAcknowledgmentCase[] = [
      { status: 'PENDING' },
      { sourceType: 'REMOTE' },
      { recordedAt: 'not-a-timestamp' },
      { notes: '  noncanonical note  ' },
      { priorRowVersion: 1, resultingRowVersion: null, ignoreChecks: true },
      { priorRowVersion: 1, resultingRowVersion: 3, ignoreChecks: true },
      { effectiveAt: '2026-07-29T12:34:57.789Z' },
      { withdrawnAt: '2026-07-29T12:34:57.789Z' },
      { actorDisplayName: '' }
    ]

    for (const malformedCase of malformedCases) {
      await withAcknowledgmentRepository(({ connection, repository }) => {
        insertRawUser(connection, {
          displayName:
            'actorDisplayName' in malformedCase ? malformedCase.actorDisplayName : 'Admin User'
        })
        insertRawPatient(connection)
        insertRawAcknowledgment(connection, malformedCase)

        const error = captureError(() =>
          repository.listByPatient({ patientId: parseEntityId(patientId), page: 1, pageSize: 25 })
        )

        expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
        expectSafeControlledError(error)
      })
    }
  })

  it('keeps existing patient detail latest acknowledgment tied by ID instead of rowid', async () => {
    await withAcknowledgmentRepository(({ connection }) => {
      insertRawUser(connection)
      insertRawPatient(connection)
      const patientRepository = createPatientRepository(connection)

      insertRawAcknowledgment(connection, {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'ACKNOWLEDGED',
        recordedAt: later,
        effectiveAt: later
      })
      insertRawAcknowledgment(connection, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'DECLINED',
        recordedAt: later,
        effectiveAt: later
      })

      expect(patientRepository.getById(parseEntityId(patientId))).toMatchObject({
        acknowledgmentStatus: 'ACKNOWLEDGED',
        acknowledgmentRecordedAt: later,
        acknowledgmentRecordedByDisplayName: 'Admin User'
      })
    })
  })
})

interface AcknowledgmentHarness {
  readonly connection: Database.Database
  readonly repository: PatientAcknowledgmentRepository
  readonly executor: DatabaseTransactionExecutor
}

async function withAcknowledgmentRepository(
  test: (harness: AcknowledgmentHarness) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd026-acknowledgment-repository-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: { now: () => now }
    })(connection)

    test({
      connection,
      repository: createPatientAcknowledgmentRepository(connection),
      executor: createExecutorForConnection(connection)
    })
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

function createExecutorForConnection(connection: Database.Database): DatabaseTransactionExecutor {
  return createDatabaseTransactionExecutor({
    connection,
    idGenerator: createEntityIdGenerator(() => generatedId),
    clock: createUtcClock(() => now),
    logger: { error: vi.fn() }
  })
}

function createValidInput(
  overrides: Partial<InsertPatientAcknowledgmentInput> = {}
): InsertPatientAcknowledgmentInput {
  return Object.freeze({
    id: parseEntityId(acknowledgmentId),
    patientId: parseEntityId(patientId),
    status: 'ACKNOWLEDGED',
    note: null,
    recordedBy: parseEntityId(actorId),
    recordedAt: parseUtcTimestamp(now),
    priorRowVersion: 1,
    resultingRowVersion: 2,
    ...overrides
  })
}

function createValidRawInput(): Record<string, unknown> {
  return {
    id: parseEntityId(acknowledgmentId),
    patientId: parseEntityId(patientId),
    status: 'ACKNOWLEDGED',
    note: null,
    recordedBy: parseEntityId(actorId),
    recordedAt: parseUtcTimestamp(now),
    priorRowVersion: 1,
    resultingRowVersion: 2
  }
}

function createUncheckedInput(input: Record<string, unknown>): InsertPatientAcknowledgmentInput {
  return input as unknown as InsertPatientAcknowledgmentInput
}

function insertRawUser(
  connection: Database.Database,
  overrides: { id?: string; username?: string; displayName?: string } = {}
): void {
  const id = overrides.id ?? actorId
  const username = overrides.username ?? 'admin'

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
      ) VALUES (?, ?, ?, ?, ?, ?, 'LOCAL_ADMIN', 1, 0, 0, NULL, NULL, ?, ?)`
    )
    .run(
      id,
      username,
      username.toLowerCase(),
      overrides.displayName ?? 'Admin User',
      'hash',
      'salt',
      now,
      now
    )
}

function insertRawPatient(
  connection: Database.Database,
  overrides: { id?: string; patientCode?: string; createdBy?: string } = {}
): void {
  const id = overrides.id ?? patientId
  const patientCode = overrides.patientCode ?? 'PT-000001'
  const createdBy = overrides.createdBy ?? actorId

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
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, 1)`
    )
    .run(
      id,
      patientCode,
      'Test Amina Patient',
      'Amina',
      'Patient',
      'test amina patient',
      'FEMALE',
      '1990-01-01',
      createdBy,
      now,
      createdBy,
      now
    )
}

interface RawAcknowledgmentOverrides {
  readonly id?: string
  readonly patientId?: string
  readonly consentType?: string
  readonly status?: string
  readonly sourceType?: string
  readonly effectiveAt?: string | null
  readonly withdrawnAt?: string | null
  readonly notes?: string | null
  readonly recordedBy?: string
  readonly recordedAt?: string
  readonly priorRowVersion?: number | null
  readonly resultingRowVersion?: number | null
  readonly ignoreChecks?: boolean
}

interface MalformedAcknowledgmentCase extends RawAcknowledgmentOverrides {
  readonly actorDisplayName?: string
}

function insertRawAcknowledgment(
  connection: Database.Database,
  overrides: RawAcknowledgmentOverrides = {}
): void {
  if (overrides.ignoreChecks === true) {
    connection.pragma('ignore_check_constraints = ON')
  }

  try {
    connection
      .prepare(
        `INSERT INTO consent_records (
        id,
        patient_id,
        consent_type,
        status,
        source_type,
        effective_at,
        withdrawn_at,
        notes,
        recorded_by,
        recorded_at,
        patient_prior_row_version,
        patient_resulting_row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        overrides.id ?? acknowledgmentId,
        overrides.patientId ?? patientId,
        overrides.consentType ?? registryAcknowledgmentType,
        overrides.status ?? 'ACKNOWLEDGED',
        overrides.sourceType ?? 'LOCAL',
        Object.prototype.hasOwnProperty.call(overrides, 'effectiveAt')
          ? overrides.effectiveAt
          : now,
        overrides.withdrawnAt ?? null,
        Object.prototype.hasOwnProperty.call(overrides, 'notes') ? overrides.notes : null,
        overrides.recordedBy ?? actorId,
        overrides.recordedAt ?? now,
        Object.prototype.hasOwnProperty.call(overrides, 'priorRowVersion')
          ? overrides.priorRowVersion
          : 1,
        Object.prototype.hasOwnProperty.call(overrides, 'resultingRowVersion')
          ? overrides.resultingRowVersion
          : 2
      )
  } finally {
    if (overrides.ignoreChecks === true) {
      connection.pragma('ignore_check_constraints = OFF')
    }
  }
}

function insertSetting(
  connection: DatabaseTransactionConnection,
  key: string,
  valueJson: string
): void {
  connection
    .prepare<[string, string, string, string]>(
      `INSERT INTO app_settings (
      key,
      value_json,
      updated_at,
      sensitivity_classification
    ) VALUES (?, ?, ?, ?)`
    )
    .run(key, valueJson, now, 'STANDARD')
}

function readRawAcknowledgments(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        id,
        patient_id,
        consent_type,
        status,
        source_type,
        effective_at,
        withdrawn_at,
        notes,
        recorded_by,
        recorded_at,
        patient_prior_row_version,
        patient_resulting_row_version
      FROM consent_records
      ORDER BY id ASC`
    )
    .all() as Array<Record<string, unknown>>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return row.count
}

function historyAcknowledgmentId(index: number): string {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function createFabricatedScopedConnection(
  connection: Database.Database
): DatabaseTransactionConnection {
  const fabricated = {
    open: connection.open,
    inTransaction: connection.inTransaction,
    prepare: connection.prepare.bind(
      connection
    ) as unknown as DatabaseTransactionConnection['prepare'],
    exec(): DatabaseTransactionConnection {
      return fabricated
    }
  } as unknown as DatabaseTransactionConnection

  return fabricated
}

interface FakeExecutorConnection extends Database.Database {
  readonly preparedSql: string[]
  readonly execSql: string[]
}

function createFakeExecutorConnection(): FakeExecutorConnection {
  const preparedSql: string[] = []
  const execSql: string[] = []
  let inTransaction = false

  return {
    get open(): boolean {
      return true
    },
    get inTransaction(): boolean {
      return inTransaction
    },
    exec(sql: string): Database.Database {
      execSql.push(sql)

      if (sql === 'BEGIN IMMEDIATE') {
        inTransaction = true
        return this as unknown as Database.Database
      }

      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        inTransaction = false
        return this as unknown as Database.Database
      }

      return this as unknown as Database.Database
    },
    prepare(sql: string): Database.Statement {
      preparedSql.push(sql)

      return {
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 }))
      } as unknown as Database.Statement
    },
    preparedSql,
    execSql
  } as unknown as FakeExecutorConnection
}

function captureError(action: () => void): unknown {
  try {
    action()
  } catch (error) {
    return error
  }

  throw new Error('Expected action to throw')
}

function expectSafeControlledError(error: unknown): void {
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).stack).toBeUndefined()
  expect(JSON.stringify(error)).not.toContain('SELECT')
  expect(JSON.stringify(error)).not.toContain('INSERT')
  expect(JSON.stringify(error)).not.toContain('consent_records')
  expect(JSON.stringify(error)).not.toContain('Amina')
  expect(JSON.stringify(error)).not.toContain('Patient')
  expect(JSON.stringify(error)).not.toContain('Patient approved synthetic registry use')
  expect(JSON.stringify(error)).not.toContain('SQLITE')
  expect(JSON.stringify(error)).not.toContain('constraint failed')
  expect(JSON.stringify(error)).not.toContain('E:\\')
  expect(JSON.stringify(error)).not.toContain('C:\\')
}
