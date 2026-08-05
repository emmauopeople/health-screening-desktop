import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createDatabaseTransactionExecutor,
  createPatientDemographicAmendmentRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionExecutionError,
  DatabaseTransactionStateError,
  patientDemographicAmendmentFieldOrder,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  RepositoryWriteError,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type InsertPatientDemographicAmendmentInput,
  type PatientDemographicAmendmentChangeInput,
  type PatientDemographicAmendmentFieldName,
  type PatientDemographicAmendmentRepository,
  type PatientDemographicAmendmentValue
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
const missingPatientId = '66666666-6666-4666-8666-666666666666'
const amendmentId = '77777777-7777-4777-8777-777777777777'
const secondAmendmentId = '88888888-8888-4888-8888-888888888888'
const generatedId = '99999999-9999-4999-8999-999999999999'

describe('patient demographic amendment repository', () => {
  it('inserts an amendment header and deterministic canonical scalar changes', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            reasonNote: '  Corrected from source form.  ',
            changes: [
              createChange('approximate_age_years', 30, 31),
              createChange('given_name', 'Amina', 'Test Amina'),
              createChange('other_names', null, 'Marie')
            ]
          })
        )
      )

      expect(readRawAmendmentHeader(connection, amendmentId)).toEqual({
        id: amendmentId,
        patient_id: patientId,
        prior_row_version: 1,
        resulting_row_version: 2,
        reason_code: 'DATA_ENTRY_CORRECTION',
        reason_note: 'Corrected from source form.',
        amended_by: actorId,
        amended_at: now
      })
      expect(readRawAmendmentChanges(connection, amendmentId)).toEqual([
        {
          field_name: 'given_name',
          previous_value_json: '"Amina"',
          new_value_json: '"Test Amina"'
        },
        {
          field_name: 'other_names',
          previous_value_json: 'null',
          new_value_json: '"Marie"'
        },
        {
          field_name: 'approximate_age_years',
          previous_value_json: '30',
          new_value_json: '31'
        }
      ])

      const history = repository.listByPatient({
        patientId: parseEntityId(patientId),
        page: 1,
        pageSize: 25
      })

      expect(history.total).toBe(1)
      expect(history.items[0]).toMatchObject({
        id: amendmentId,
        patientId,
        priorRowVersion: 1,
        resultingRowVersion: 2,
        reasonCode: 'DATA_ENTRY_CORRECTION',
        reasonNote: 'Corrected from source form.',
        amendedBy: actorId,
        amendedByDisplayName: 'Admin User',
        amendedAt: now
      })
      expect(history.items[0]?.changes).toEqual([
        createChange('given_name', 'Amina', 'Test Amina'),
        createChange('other_names', null, 'Marie'),
        createChange('approximate_age_years', 30, 31)
      ])
      expect(Object.isFrozen(history)).toBe(true)
      expect(Object.isFrozen(history.items)).toBe(true)
      expect(Object.isFrozen(history.items[0])).toBe(true)
      expect(Object.isFrozen(history.items[0]?.changes)).toBe(true)
      expect(Object.isFrozen(history.items[0]?.changes[0])).toBe(true)
    })
  })

  it('rejects invalid insert inputs before persisting rows', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      const excessiveChanges = patientDemographicAmendmentFieldOrder.map((fieldName) =>
        createChange(
          fieldName,
          fieldName === 'approximate_age_years' ? 1 : 'old',
          fieldName === 'approximate_age_years' ? 2 : 'new'
        )
      )

      const invalidInputs: readonly InsertPatientDemographicAmendmentInput[] = [
        createUncheckedInput({ ...createValidRawInput(), changes: [] }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [...excessiveChanges, createChange('given_name', 'again', 'again-new')]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('given_name', 'A', 'B'), createChange('given_name', 'C', 'D')]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('given_name', 'A', 'A')]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [
            {
              fieldName: 'patient_code',
              previousValue: 'PT-000001',
              newValue: 'PT-000002'
            }
          ]
        }),
        createUncheckedInput({ ...createValidRawInput(), priorRowVersion: 0 }),
        createUncheckedInput({ ...createValidRawInput(), resultingRowVersion: 3 }),
        createUncheckedInput({ ...createValidRawInput(), reasonCode: 'NOT_A_REASON' }),
        createUncheckedInput({ ...createValidRawInput(), reasonCode: 'OTHER', reasonNote: null }),
        createUncheckedInput({
          ...createValidRawInput(),
          reasonNote: null,
          changes: [createChange('status', 'ACTIVE', 'INACTIVE')]
        }),
        createUncheckedInput({ ...createValidRawInput(), reasonNote: 'x'.repeat(501) }),
        createUncheckedInput({ ...createValidRawInput(), id: 'not-a-uuid' }),
        createUncheckedInput({ ...createValidRawInput(), amendedAt: 'not-a-timestamp' }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('given_name', 'A', 12)]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('approximate_age_years', 1, 121)]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('approximate_age_years', 1, 1.5)]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('sex', 'FEMALE', 'INVALID')]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('status', 'ACTIVE', 'UNKNOWN')]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('approximate_age_years', 1, Number.NaN)]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('approximate_age_years', 1, Number.POSITIVE_INFINITY)]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('given_name', 'A', true)]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('given_name', 'A', ['B'])]
        }),
        createUncheckedInput({
          ...createValidRawInput(),
          changes: [createChange('given_name', 'A', { value: 'B' })]
        })
      ]

      for (const input of invalidInputs) {
        const error = captureError(() =>
          executor.run((context) => repository.insert(context.connection, input))
        )

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
        expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
        expect(readTableCount(connection, 'patient_demographic_amendment_changes')).toBe(0)
        expect(connection.inTransaction).toBe(false)
      }
    })
  })

  it('keeps foreign keys and uniqueness SQLite-enforced without partial rows', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
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
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)

      const missingActorError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({ amendedBy: parseEntityId(missingActorId) })
          )
        )
      )
      expect(missingActorError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(missingActorError)
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)

      executor.run((context) => repository.insert(context.connection, createValidInput()))

      const duplicateVersionError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              id: parseEntityId(secondAmendmentId),
              priorRowVersion: 1,
              resultingRowVersion: 2
            })
          )
        )
      )
      expect(duplicateVersionError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(duplicateVersionError)

      const duplicateIdError = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              id: parseEntityId(amendmentId),
              priorRowVersion: 2,
              resultingRowVersion: 3
            })
          )
        )
      )
      expect(duplicateIdError).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(duplicateIdError)
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(1)
      expect(readTableCount(connection, 'patient_demographic_amendment_changes')).toBe(1)
    })
  })

  it('requires an active transaction capability and never issues transaction SQL', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      executor.run((context) => repository.insert(context.connection, createValidInput()))
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(1)

      connection.exec('BEGIN IMMEDIATE')
      try {
        const rawConnectionError = captureError(() =>
          repository.insert(
            connection as unknown as DatabaseTransactionConnection,
            createValidInput({
              id: parseEntityId(secondAmendmentId),
              priorRowVersion: 2,
              resultingRowVersion: 3
            })
          )
        )

        expect(rawConnectionError).toBeInstanceOf(DatabaseTransactionStateError)
        expectSafeControlledError(rawConnectionError)
      } finally {
        if (connection.inTransaction) {
          connection.exec('ROLLBACK')
        }
      }

      const fabricatedError = captureError(() =>
        repository.insert(
          createFabricatedScopedConnection(connection),
          createValidInput({
            id: parseEntityId(secondAmendmentId),
            priorRowVersion: 2,
            resultingRowVersion: 3
          })
        )
      )
      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(fabricatedError)

      let capturedConnection: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        capturedConnection = context.connection
        return 'captured'
      })

      const expiredError = captureError(() =>
        repository.insert(
          capturedConnection!,
          createUncheckedInput({ ...createValidRawInput(), id: 'not-a-uuid' })
        )
      )
      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expect(expiredError).not.toBeInstanceOf(RepositoryValidationError)
      expectSafeControlledError(expiredError)
    })

    const fakeConnection = createFakeExecutorConnection()

    createExecutorForConnection(fakeConnection).run((context) =>
      createPatientDemographicAmendmentRepository({} as Database.Database).insert(
        context.connection,
        createValidInput()
      )
    )

    expect(fakeConnection.execSql).toEqual(['BEGIN IMMEDIATE', 'COMMIT'])
    expect(fakeConnection.preparedSql.join('\n')).toContain('patient_demographic_amendments')
    expect(fakeConnection.preparedSql.join('\n')).not.toMatch(
      /\b(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i
    )
  })

  it('rolls back successful headers and child rows when the surrounding transaction fails', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)

      const error = captureError(() =>
        executor.run((context) => {
          repository.insert(
            context.connection,
            createValidInput({
              changes: [
                createChange('given_name', 'Amina', 'Test Amina'),
                createChange('family_name', 'Patient', 'Tester')
              ]
            })
          )
          insertSetting(context.connection, 'amendment.rollback', '{"enabled":true}')
          throw new Error('C:\\secret\\amendment.sqlite3 SELECT patients')
        })
      )

      expect(error).toBeInstanceOf(DatabaseTransactionExecutionError)
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
      expect(readTableCount(connection, 'patient_demographic_amendment_changes')).toBe(0)
      expect(readTableCount(connection, 'app_settings')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('rolls back the header and earlier child rows when a later child insert fails', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawPatient(connection)
      connection.exec(`
        CREATE TRIGGER tr_test_fail_family_name_amendment_change
        BEFORE INSERT ON patient_demographic_amendment_changes
        WHEN NEW.field_name = 'family_name'
        BEGIN
          SELECT RAISE(ABORT, 'test child insert failure');
        END;
      `)

      const error = captureError(() =>
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              changes: [
                createChange('given_name', 'Amina', 'Test Amina'),
                createChange('family_name', 'Patient', 'Tester')
              ]
            })
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryWriteError)
      expectSafeControlledError(error)
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
      expect(readTableCount(connection, 'patient_demographic_amendment_changes')).toBe(0)
      expect(connection.inTransaction).toBe(false)
    })
  })

  it('returns paginated immutable patient-isolated history in deterministic order', async () => {
    await withAmendmentRepository(({ connection, repository, executor }) => {
      insertRawUser(connection)
      insertRawUser(connection, { id: secondActorId, username: 'nurse', displayName: 'Nurse User' })
      insertRawPatient(connection)
      insertRawPatient(connection, { id: secondPatientId, patientCode: 'PT-000002' })

      for (let index = 1; index <= 25; index += 1) {
        executor.run((context) =>
          repository.insert(
            context.connection,
            createValidInput({
              id: parseEntityId(historyAmendmentId(index)),
              priorRowVersion: index,
              resultingRowVersion: index + 1,
              amendedAt: parseUtcTimestamp(
                `2026-07-29T12:00:${String(index).padStart(2, '0')}.000Z`
              )
            })
          )
        )
      }

      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
            priorRowVersion: 26,
            resultingRowVersion: 27,
            amendedAt: parseUtcTimestamp(later),
            amendedBy: parseEntityId(secondActorId),
            changes: [
              createChange('status', 'ACTIVE', 'INACTIVE'),
              createChange('given_name', 'Amina', 'Test Amina')
            ],
            reasonCode: 'STATUS_CHANGE',
            reasonNote: 'Status changed after registry review.'
          })
        )
      )
      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
            priorRowVersion: 27,
            resultingRowVersion: 28,
            amendedAt: parseUtcTimestamp(later)
          })
        )
      )
      executor.run((context) =>
        repository.insert(
          context.connection,
          createValidInput({
            id: parseEntityId(secondAmendmentId),
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
        patientId: parseEntityId(missingPatientId),
        page: 1,
        pageSize: 25
      })

      expect(pageOne.total).toBe(27)
      expect(pageOne.items).toHaveLength(25)
      expect(pageTwo.items).toHaveLength(2)
      expect(pageFifty.items).toHaveLength(27)
      expect(pageHundred.items).toHaveLength(27)
      expect(pageOne.items.map((item) => item.id).slice(0, 2)).toEqual([
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      ])
      expect(pageOne.items[1]).toMatchObject({
        amendedBy: secondActorId,
        amendedByDisplayName: 'Nurse User',
        reasonCode: 'STATUS_CHANGE',
        reasonNote: 'Status changed after registry review.'
      })
      expect(pageOne.items[1]?.changes).toEqual([
        createChange('given_name', 'Amina', 'Test Amina'),
        createChange('status', 'ACTIVE', 'INACTIVE')
      ])
      expect(pageTwo.page).toBe(2)
      expect(pageTwo.pageSize).toBe(25)
      expect(pageTwo.total).toBe(27)
      expect(isolated.total).toBe(1)
      expect(isolated.items.map((item) => item.patientId)).toEqual([secondPatientId])
      expect(empty).toEqual({ items: [], page: 1, pageSize: 25, total: 0 })
      expect(Object.isFrozen(pageOne.items[0])).toBe(true)
      expect(Object.isFrozen(pageOne.items[0]?.changes)).toBe(true)
    })
  })

  it('fails closed on malformed JSON and incompatible persisted field values', async () => {
    await withAmendmentRepository(({ connection, repository }) => {
      insertRawUser(connection)
      insertRawPatient(connection)
      insertMalformedAmendmentFixture(connection, {
        previousValueJson: '{invalid',
        newValueJson: '"Test Amina"'
      })

      const error = captureError(() =>
        repository.listByPatient({ patientId: parseEntityId(patientId), page: 1, pageSize: 25 })
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })

    await withAmendmentRepository(({ connection, repository }) => {
      insertRawUser(connection)
      insertRawPatient(connection)
      insertMalformedAmendmentFixture(connection, {
        fieldName: 'approximate_age_years',
        previousValueJson: '40',
        newValueJson: '"forty-one"'
      })

      const error = captureError(() =>
        repository.listByPatient({ patientId: parseEntityId(patientId), page: 1, pageSize: 25 })
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })
  })

  it('fails closed when persisted status changes are missing a reason note', async () => {
    await withAmendmentRepository(({ connection, repository }) => {
      insertRawUser(connection)
      insertRawPatient(connection)
      insertMalformedAmendmentFixture(connection, {
        fieldName: 'status',
        previousValueJson: '"ACTIVE"',
        newValueJson: '"INACTIVE"',
        reasonNote: null
      })

      const error = captureError(() =>
        repository.listByPatient({ patientId: parseEntityId(patientId), page: 1, pageSize: 25 })
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
      expect(JSON.stringify(error)).not.toContain('SQLITE')
      expect(JSON.stringify(error)).not.toContain('constraint')
    })
  })
})

interface AmendmentHarness {
  readonly connection: Database.Database
  readonly repository: PatientDemographicAmendmentRepository
  readonly executor: DatabaseTransactionExecutor
}

async function withAmendmentRepository(test: (harness: AmendmentHarness) => void): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd026-amendment-repository-'))
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
      repository: createPatientDemographicAmendmentRepository(connection),
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
  overrides: Partial<InsertPatientDemographicAmendmentInput> = {}
): InsertPatientDemographicAmendmentInput {
  return {
    id: parseEntityId(amendmentId),
    patientId: parseEntityId(patientId),
    priorRowVersion: 1,
    resultingRowVersion: 2,
    reasonCode: 'DATA_ENTRY_CORRECTION',
    reasonNote: 'Corrected synthetic test demographic data.',
    amendedBy: parseEntityId(actorId),
    amendedAt: parseUtcTimestamp(now),
    changes: [createChange('given_name', 'Amina', 'Test Amina')],
    ...overrides
  }
}

function createValidRawInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: amendmentId,
    patientId,
    priorRowVersion: 1,
    resultingRowVersion: 2,
    reasonCode: 'DATA_ENTRY_CORRECTION',
    reasonNote: 'Corrected synthetic test demographic data.',
    amendedBy: actorId,
    amendedAt: now,
    changes: [createChange('given_name', 'Amina', 'Test Amina')],
    ...overrides
  }
}

function createUncheckedInput(
  input: Record<string, unknown>
): InsertPatientDemographicAmendmentInput {
  return input as unknown as InsertPatientDemographicAmendmentInput
}

function createChange(
  fieldName: PatientDemographicAmendmentFieldName,
  previousValue: PatientDemographicAmendmentValue,
  newValue: PatientDemographicAmendmentValue
): PatientDemographicAmendmentChangeInput
function createChange(
  fieldName: string,
  previousValue: unknown,
  newValue: unknown
): PatientDemographicAmendmentChangeInput
function createChange(
  fieldName: string,
  previousValue: unknown,
  newValue: unknown
): PatientDemographicAmendmentChangeInput {
  return Object.freeze({
    fieldName,
    previousValue,
    newValue
  }) as unknown as PatientDemographicAmendmentChangeInput
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

function insertMalformedAmendmentFixture(
  connection: Database.Database,
  overrides: {
    fieldName?: string
    previousValueJson?: string
    newValueJson?: string
    reasonNote?: string | null
  }
): void {
  connection
    .prepare(
      `INSERT INTO patient_demographic_amendments (
      id,
      patient_id,
      prior_row_version,
      resulting_row_version,
      reason_code,
      reason_note,
      amended_by,
      amended_at
    ) VALUES (?, ?, 1, 2, 'DATA_ENTRY_CORRECTION', ?, ?, ?)`
    )
    .run(
      amendmentId,
      patientId,
      Object.prototype.hasOwnProperty.call(overrides, 'reasonNote')
        ? overrides.reasonNote
        : 'Malformed synthetic fixture.',
      actorId,
      now
    )

  connection.pragma('ignore_check_constraints = ON')
  try {
    connection
      .prepare(
        `INSERT INTO patient_demographic_amendment_changes (
        amendment_id,
        field_name,
        previous_value_json,
        new_value_json
      ) VALUES (?, ?, ?, ?)`
      )
      .run(
        amendmentId,
        overrides.fieldName ?? 'given_name',
        overrides.previousValueJson ?? '"Amina"',
        overrides.newValueJson ?? '"Test Amina"'
      )
  } finally {
    connection.pragma('ignore_check_constraints = OFF')
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

function readRawAmendmentHeader(
  connection: Database.Database,
  id: string
): Record<string, unknown> | undefined {
  return connection
    .prepare(
      `SELECT
        id,
        patient_id,
        prior_row_version,
        resulting_row_version,
        reason_code,
        reason_note,
        amended_by,
        amended_at
      FROM patient_demographic_amendments
      WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
}

function readRawAmendmentChanges(
  connection: Database.Database,
  id: string
): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT
        field_name,
        previous_value_json,
        new_value_json
      FROM patient_demographic_amendment_changes
      WHERE amendment_id = ?
      ORDER BY rowid ASC`
    )
    .all(id) as Array<Record<string, unknown>>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }

  return row.count
}

function historyAmendmentId(index: number): string {
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
  expect(JSON.stringify(error)).not.toContain('patients')
  expect(JSON.stringify(error)).not.toContain('Amina')
  expect(JSON.stringify(error)).not.toContain('Patient')
  expect(JSON.stringify(error)).not.toContain('C:\\secret')
}
