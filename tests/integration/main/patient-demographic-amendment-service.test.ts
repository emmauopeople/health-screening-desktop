import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createPatientDemographicAmendmentService,
  type PatientDemographicAmendmentService,
  type PatientDemographicAmendmentServiceActor
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createPatientDemographicAmendmentRepository,
  createPatientRepository,
  createProductionDatabaseMigrationRunner,
  RepositoryValidationError,
  RepositoryWriteError,
  type AuditEventRepository,
  type PatientDemographicAmendmentRepository,
  type PatientRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const nurseId = '33333333-3333-4333-8333-333333333333'
const screenerId = '44444444-4444-4444-8444-444444444444'
const patientId = '55555555-5555-4555-8555-555555555555'
const secondPatientId = '66666666-6666-4666-8666-666666666666'
const missingPatientId = '77777777-7777-4777-8777-777777777777'
const initialAcknowledgmentId = '10101010-1010-4010-8010-101010101010'
const secondInitialAcknowledgmentId = '20202020-2020-4020-8020-202020202020'
const generatedIds = [
  '88888888-8888-4888-8888-888888888888',
  '99999999-9999-4999-8999-999999999999',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'ffffffff-ffff-4fff-8fff-ffffffffffff'
] as const

const adminActor: PatientDemographicAmendmentServiceActor = {
  userId: parseEntityId(adminId),
  role: 'LOCAL_ADMIN'
}
const nurseActor: PatientDemographicAmendmentServiceActor = {
  userId: parseEntityId(nurseId),
  role: 'NURSE'
}
const screenerActor: PatientDemographicAmendmentServiceActor = {
  userId: parseEntityId(screenerId),
  role: 'TRAINED_SCREENER'
}

describe('patient demographic amendment service', () => {
  it('atomically amends ordinary demographics for all roles without acknowledgment writes', async () => {
    for (const actor of [adminActor, nurseActor, screenerActor]) {
      await withAmendmentService(({ connection, service }) => {
        seedCoreRecords(connection)

        const result = service.amend(
          {
            patientId: parseEntityId(patientId),
            expectedRowVersion: 1,
            reasonCode: 'DATA_ENTRY_CORRECTION',
            reasonNote: '  Corrected from source worksheet.  ',
            patch: {
              givenName: 'Test Ada',
              familyName: 'Registry',
              otherNames: null,
              phone: '(650) 555-0199',
              village: 'Test Limbe'
            }
          },
          actor
        )

        expect(result).toMatchObject({
          status: 'AMENDED',
          amendmentId: generatedIds[0],
          patient: {
            id: patientId,
            displayName: 'Test Ada Registry',
            givenName: 'Test Ada',
            familyName: 'Registry',
            otherNames: null,
            phone: '(650) 555-0199',
            village: 'Test Limbe',
            rowVersion: 2,
            acknowledgmentStatus: 'NOT_REQUESTED'
          }
        })
        expect(readPatient(connection, patientId)).toMatchObject({
          display_name: 'Test Ada Registry',
          name_normalized: 'test ada registry',
          phone_normalized: '6505550199',
          row_version: 2,
          updated_by: actor.userId,
          updated_at: now
        })
        expect(readAmendmentHeader(connection)).toMatchObject({
          id: generatedIds[0],
          patient_id: patientId,
          prior_row_version: 1,
          resulting_row_version: 2,
          reason_code: 'DATA_ENTRY_CORRECTION',
          reason_note: 'Corrected from source worksheet.',
          amended_by: actor.userId,
          amended_at: now
        })
        expect(readAmendmentChanges(connection)).toEqual([
          {
            field_name: 'given_name',
            previous_value_json: '"Amina"',
            new_value_json: '"Test Ada"'
          },
          {
            field_name: 'family_name',
            previous_value_json: '"Patient"',
            new_value_json: '"Registry"'
          },
          { field_name: 'other_names', previous_value_json: '"Marie"', new_value_json: 'null' },
          {
            field_name: 'village',
            previous_value_json: '"Test Buea"',
            new_value_json: '"Test Limbe"'
          },
          {
            field_name: 'phone',
            previous_value_json: '"650 555 0100"',
            new_value_json: '"(650) 555-0199"'
          }
        ])
        expect(readTableCount(connection, 'consent_records')).toBe(1)
        expect(readAuditRows(connection)).toEqual([
          {
            action: 'PATIENT_DEMOGRAPHICS_AMENDED',
            entity_type: 'PATIENT',
            entity_id: patientId,
            metadata_json: JSON.stringify({
              amendment_id: generatedIds[0],
              changed_field_names: ['given_name', 'family_name', 'other_names', 'village', 'phone'],
              prior_row_version: 1,
              reason_code: 'DATA_ENTRY_CORRECTION',
              resulting_row_version: 2
            })
          }
        ])
        const outbox = readOutboxRows(connection)
        expect(outbox).toHaveLength(1)
        expect(outbox[0]).toMatchObject({
          operation: 'PATIENT_DEMOGRAPHICS_AMENDED',
          payload_schema_version: 'patient.demographic-amendment.v1'
        })
        expect(JSON.parse(outbox[0]!.payload_json)).toEqual({
          patient_id: patientId,
          amendment_id: generatedIds[0],
          prior_row_version: 1,
          resulting_row_version: 2,
          reason_code: 'DATA_ENTRY_CORRECTION',
          reason_note: 'Corrected from source worksheet.',
          changed_fields: [
            { field_name: 'given_name', previous_value: 'Amina', new_value: 'Test Ada' },
            { field_name: 'family_name', previous_value: 'Patient', new_value: 'Registry' },
            { field_name: 'other_names', previous_value: 'Marie', new_value: null },
            { field_name: 'village', previous_value: 'Test Buea', new_value: 'Test Limbe' },
            { field_name: 'phone', previous_value: '650 555 0100', new_value: '(650) 555-0199' }
          ],
          amended_by: actor.userId,
          amended_at: now
        })
        expect(outbox[0]!.payload_json).toContain('previous_value')
      })
    }
  })

  it('enforces status-change authorization and note requirements', async () => {
    await withAmendmentService(({ connection, service }) => {
      seedCoreRecords(connection)

      const forbidden = service.amend(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          reasonCode: 'STATUS_CHANGE',
          reasonNote: 'Status changed after registry review.',
          patch: { status: 'INACTIVE' }
        },
        screenerActor
      )

      expect(forbidden).toEqual({ status: 'FORBIDDEN' })
      expect(readPatient(connection, patientId)).toMatchObject({ status: 'ACTIVE', row_version: 1 })
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })

    for (const actor of [adminActor, nurseActor]) {
      await withAmendmentService(({ connection, service }) => {
        seedCoreRecords(connection)

        const result = service.amend(
          {
            patientId: parseEntityId(patientId),
            expectedRowVersion: 1,
            reasonCode: 'OTHER',
            reasonNote: 'Status changed after synthetic review.',
            patch: { status: 'INACTIVE' }
          },
          actor
        )

        expect(result).toMatchObject({ status: 'AMENDED', patient: { status: 'INACTIVE' } })
        expect(readAmendmentChanges(connection)).toEqual([
          { field_name: 'status', previous_value_json: '"ACTIVE"', new_value_json: '"INACTIVE"' }
        ])
      })
    }
  })

  it('returns optimistic-concurrency results without writing history, audit, or outbox rows', async () => {
    await withAmendmentService(({ connection, service }) => {
      seedCoreRecords(connection, { rowVersion: 2, village: 'Test Bamenda' })

      const result = service.amend(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          reasonCode: 'PATIENT_REPORTED_CHANGE',
          reasonNote: null,
          patch: { village: 'Test Limbe' }
        },
        adminActor
      )

      expect(result).toMatchObject({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: { rowVersion: 2, village: 'Test Bamenda' }
      })
      expect(readPatient(connection, patientId)).toMatchObject({
        row_version: 2,
        village: 'Test Bamenda'
      })
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
      expect(readTableCount(connection, 'audit_log')).toBe(0)
      expect(readTableCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('validates missing patients, malformed patches, reasons, and safe errors', async () => {
    await withAmendmentService(({ connection, service }) => {
      seedCoreRecords(connection)

      expect(
        service.amend(
          {
            patientId: parseEntityId(missingPatientId),
            expectedRowVersion: 1,
            reasonCode: 'DATA_ENTRY_CORRECTION',
            reasonNote: null,
            patch: { village: 'Test Limbe' }
          },
          adminActor
        )
      ).toEqual({ status: 'NOT_FOUND' })

      const getterPatch = {}
      Object.defineProperty(getterPatch, 'village', {
        enumerable: true,
        get: () => 'Test Limbe'
      })

      const invalidRequests: readonly {
        readonly reasonCode?: Parameters<typeof service.amend>[0]['reasonCode']
        readonly reasonNote?: string | null
        readonly patch: unknown
      }[] = [
        { patch: {} },
        { patch: { patientCode: 'PT-999999' } },
        { patch: getterPatch },
        { patch: { sex: 'BAD' } },
        { patch: { village: 'Test Buea' } },
        { reasonCode: 'OTHER', reasonNote: null, patch: { village: 'Test Limbe' } },
        { reasonNote: null, patch: { status: 'INACTIVE' } },
        { reasonNote: 'a'.repeat(501), patch: { village: 'Test Limbe' } },
        { reasonNote: 'Unsafe\nnote', patch: { village: 'Test Limbe' } }
      ] as const

      for (const invalid of invalidRequests) {
        const error = captureError(() =>
          service.amend(
            {
              patientId: parseEntityId(patientId),
              expectedRowVersion: 1,
              reasonCode: invalid.reasonCode ?? 'DATA_ENTRY_CORRECTION',
              reasonNote: Object.prototype.hasOwnProperty.call(invalid, 'reasonNote')
                ? invalid.reasonNote
                : null,
              patch: invalid.patch
            } as Parameters<typeof service.amend>[0],
            adminActor
          )
        )

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
      }

      expect(readPatient(connection, patientId)).toMatchObject({ row_version: 1 })
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
    })
  })

  it('records exact nullable field history without derived fields', async () => {
    await withAmendmentService(({ connection, service }) => {
      seedCoreRecords(connection)

      const result = service.amend(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          reasonCode: 'CONTACT_INFORMATION_UPDATE',
          reasonNote: null,
          patch: {
            alternateContactName: null,
            alternateContactPhone: null,
            residenceNotes: null
          }
        },
        adminActor
      )

      expect(result).toMatchObject({
        status: 'AMENDED',
        patient: {
          rowVersion: 2,
          alternateContactName: null,
          alternateContactPhone: null,
          residenceNotes: null,
          displayName: 'Amina Marie Patient'
        }
      })
      expect(readAmendmentChanges(connection)).toEqual([
        {
          field_name: 'alternate_contact_name',
          previous_value_json: '"Test Contact"',
          new_value_json: 'null'
        },
        {
          field_name: 'alternate_contact_phone',
          previous_value_json: '"650 555 0199"',
          new_value_json: 'null'
        },
        {
          field_name: 'residence_notes',
          previous_value_json: '"Synthetic residence note."',
          new_value_json: 'null'
        }
      ])
      expect(readAmendmentChanges(connection).map((row) => row.field_name)).not.toContain(
        'display_name'
      )
    })
  })

  it('keeps existing registry outbox operations on patient.registry.v1', async () => {
    await withAmendmentService(({ connection, patientRepository, executor }) => {
      seedCoreRecords(connection)

      executor.run((context) => {
        patientRepository.insertOutbox(context.connection, {
          id: parseEntityId(generatedIds[0]),
          aggregateId: parseEntityId(patientId),
          operation: 'PATIENT_UPDATED',
          createdAt: parseUtcTimestamp(now),
          payloadSchemaVersion: 'patient.registry.v1',
          payload: { patient_id: patientId, row_version: 1 }
        })
      })

      expect(readOutboxRows(connection)).toEqual([
        {
          operation: 'PATIENT_UPDATED',
          payload_schema_version: 'patient.registry.v1',
          payload_json: JSON.stringify({ patient_id: patientId, row_version: 1 })
        }
      ])
    })
  })

  it('rolls back patient, history, audit, and outbox writes after each write boundary', async () => {
    const failureModes = [
      'after-patient-update',
      'after-amendment',
      'after-audit',
      'after-outbox'
    ] as const

    for (const failureMode of failureModes) {
      await withAmendmentService(
        ({ connection, service }) => {
          seedCoreRecords(connection)

          const error = captureError(() =>
            service.amend(
              {
                patientId: parseEntityId(patientId),
                expectedRowVersion: 1,
                reasonCode: 'DATA_ENTRY_CORRECTION',
                reasonNote: 'Rollback boundary test.',
                patch: { village: 'Test Limbe' }
              },
              adminActor
            )
          )

          expect(error).toBeInstanceOf(Error)
          expectSafeControlledError(error)
          expect(readPatient(connection, patientId)).toMatchObject({
            row_version: 1,
            village: 'Test Buea'
          })
          expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(0)
          expect(readTableCount(connection, 'patient_demographic_amendment_changes')).toBe(0)
          expect(readTableCount(connection, 'audit_log')).toBe(0)
          expect(readTableCount(connection, 'sync_outbox')).toBe(0)
        },
        { failureMode }
      )
    }
  })

  it('lists demographic history for all roles without writing rows', async () => {
    await withAmendmentService(({ connection, service }) => {
      seedCoreRecords(connection)
      seedCoreRecords(connection, { patientId: secondPatientId, patientCode: 'PT-000002' })

      service.amend(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          reasonCode: 'RESIDENCE_INFORMATION_UPDATE',
          reasonNote: null,
          patch: { village: 'Test Limbe' }
        },
        adminActor
      )
      service.amend(
        {
          patientId: parseEntityId(secondPatientId),
          expectedRowVersion: 1,
          reasonCode: 'RESIDENCE_INFORMATION_UPDATE',
          reasonNote: null,
          patch: { village: 'Test Yaounde' }
        },
        adminActor
      )
      const writeCounts = {
        amendments: readTableCount(connection, 'patient_demographic_amendments'),
        audit: readTableCount(connection, 'audit_log'),
        outbox: readTableCount(connection, 'sync_outbox')
      }

      for (const actor of [adminActor, nurseActor, screenerActor]) {
        const history = service.listHistory(
          { patientId: parseEntityId(patientId), page: 1, pageSize: 25 },
          actor
        )

        expect(history).toMatchObject({ page: 1, pageSize: 25, total: 1 })
        expect(history.items).toHaveLength(1)
        expect(history.items[0]).toMatchObject({ patientId, amendedBy: adminId })
        expect(Object.isFrozen(history)).toBe(true)
        expect(Object.isFrozen(history.items)).toBe(true)
      }

      expect(
        service.listHistory(
          { patientId: parseEntityId(patientId), page: 2, pageSize: 25 },
          adminActor
        )
      ).toMatchObject({
        items: [],
        page: 2,
        pageSize: 25,
        total: 1
      })
      expect(
        service.listHistory(
          { patientId: parseEntityId(secondPatientId), page: 1, pageSize: 25 },
          adminActor
        ).total
      ).toBe(1)
      expect(readTableCount(connection, 'patient_demographic_amendments')).toBe(
        writeCounts.amendments
      )
      expect(readTableCount(connection, 'audit_log')).toBe(writeCounts.audit)
      expect(readTableCount(connection, 'sync_outbox')).toBe(writeCounts.outbox)
    })
  })
})

interface AmendmentServiceHarness {
  readonly connection: Database.Database
  readonly service: PatientDemographicAmendmentService
  readonly patientRepository: PatientRepository
  readonly executor: ReturnType<typeof createDatabaseTransactionExecutor>
}

type FailureMode = 'after-patient-update' | 'after-amendment' | 'after-audit' | 'after-outbox'

async function withAmendmentService(
  test: (harness: AmendmentServiceHarness) => void,
  options: { readonly failureMode?: FailureMode } = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd026-amendment-service-'))
  const databasePath = join(directory, 'health-screening.sqlite3')
  const connection = new Database(databasePath)

  try {
    configurePragmas(connection)
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: vi.fn(), error: vi.fn() },
      clock: { now: () => now }
    })(connection)

    const ids = [...generatedIds]
    const executor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(() => {
        const next = ids.shift()

        if (next === undefined) {
          throw new Error('Ran out of generated IDs.')
        }

        return next
      }),
      clock: createUtcClock(() => now),
      logger: { error: vi.fn() }
    })
    const patientRepository = createPatientRepository(connection)
    const amendmentRepository = createPatientDemographicAmendmentRepository(connection)
    const auditRepository = createAuditEventRepository(connection)
    const service = createPatientDemographicAmendmentService({
      installationRepository: createInstallationRepository(connection),
      patientRepository: wrapPatientRepository(patientRepository, options.failureMode),
      patientDemographicAmendmentRepository: wrapAmendmentRepository(
        amendmentRepository,
        options.failureMode
      ),
      auditEventRepository: wrapAuditRepository(auditRepository, options.failureMode),
      transactionExecutor: executor
    })

    test({ connection, service, patientRepository, executor })
  } finally {
    connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function wrapPatientRepository(
  repository: PatientRepository,
  failureMode: FailureMode | undefined
): PatientRepository {
  return Object.freeze({
    ...repository,
    updateDemographics(
      connection: Parameters<PatientRepository['updateDemographics']>[0],
      input: Parameters<PatientRepository['updateDemographics']>[1]
    ) {
      const result = repository.updateDemographics(connection, input)

      if (failureMode === 'after-patient-update') {
        throw new RepositoryWriteError()
      }

      return result
    },
    insertOutbox(
      connection: Parameters<PatientRepository['insertOutbox']>[0],
      input: Parameters<PatientRepository['insertOutbox']>[1]
    ) {
      repository.insertOutbox(connection, input)

      if (failureMode === 'after-outbox') {
        throw new Error('C:\\secret\\amendment.sqlite3 INSERT sync_outbox')
      }
    }
  })
}

function wrapAmendmentRepository(
  repository: PatientDemographicAmendmentRepository,
  failureMode: FailureMode | undefined
): PatientDemographicAmendmentRepository {
  return Object.freeze({
    ...repository,
    insert(
      connection: Parameters<PatientDemographicAmendmentRepository['insert']>[0],
      input: Parameters<PatientDemographicAmendmentRepository['insert']>[1]
    ) {
      repository.insert(connection, input)

      if (failureMode === 'after-amendment') {
        throw new RepositoryWriteError()
      }
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
      const record = repository.insert(connection, input)

      if (failureMode === 'after-audit') {
        throw new RepositoryWriteError()
      }

      return record
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
  overrides: {
    readonly patientId?: string
    readonly patientCode?: string
    readonly rowVersion?: number
    readonly village?: string
  } = {}
): void {
  insertInstallation(connection)
  insertUser(connection, {
    id: adminId,
    username: 'admin',
    displayName: 'Admin User',
    role: 'LOCAL_ADMIN'
  })
  insertUser(connection, {
    id: nurseId,
    username: 'nurse',
    displayName: 'Nurse User',
    role: 'NURSE'
  })
  insertUser(connection, {
    id: screenerId,
    username: 'screener',
    displayName: 'Screener User',
    role: 'TRAINED_SCREENER'
  })
  insertRawPatient(connection, overrides)
  insertRawAcknowledgment(connection, {
    patientId: overrides.patientId ?? patientId,
    recordedBy: adminId
  })
}

function insertInstallation(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT OR IGNORE INTO installation (
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

function insertUser(
  connection: Database.Database,
  input: {
    readonly id: string
    readonly username: string
    readonly displayName: string
    readonly role: string
  }
): void {
  connection
    .prepare(
      `INSERT OR IGNORE INTO users (
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
    .run(
      input.id,
      input.username,
      input.username.toLowerCase(),
      input.displayName,
      'hash',
      'salt',
      input.role,
      now,
      now
    )
}

function insertRawPatient(
  connection: Database.Database,
  overrides: {
    readonly patientId?: string
    readonly patientCode?: string
    readonly rowVersion?: number
    readonly village?: string
  } = {}
): void {
  connection
    .prepare(
      `INSERT INTO patients (
        id,
        patient_code,
        display_name,
        given_name,
        family_name,
        other_names,
        name_normalized,
        sex,
        date_of_birth,
        approximate_age_years,
        age_as_of_date,
        phone,
        phone_normalized,
        alternate_contact_name,
        alternate_contact_phone,
        village,
        quarter,
        residence_notes,
        status,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`
    )
    .run(
      overrides.patientId ?? patientId,
      overrides.patientCode ?? 'PT-000001',
      'Amina Marie Patient',
      'Amina',
      'Patient',
      'Marie',
      'amina marie patient',
      'FEMALE',
      '1990-01-01',
      '650 555 0100',
      '6505550100',
      'Test Contact',
      '650 555 0199',
      overrides.village ?? 'Test Buea',
      'Test Quarter',
      'Synthetic residence note.',
      adminId,
      now,
      adminId,
      now,
      overrides.rowVersion ?? 1
    )
}

function insertRawAcknowledgment(
  connection: Database.Database,
  input: { readonly patientId: string; readonly recordedBy: string }
): void {
  const acknowledgmentId =
    input.patientId === secondPatientId ? secondInitialAcknowledgmentId : initialAcknowledgmentId

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
        recorded_at
      ) VALUES (?, ?, 'PATIENT_REGISTRY_ACKNOWLEDGMENT', 'NOT_REQUESTED', 'LOCAL', ?, NULL, NULL, ?, ?)`
    )
    .run(parseEntityId(acknowledgmentId), input.patientId, now, input.recordedBy, now)
}

function readPatient(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function readAmendmentHeader(connection: Database.Database): Record<string, unknown> {
  return connection.prepare('SELECT * FROM patient_demographic_amendments').get() as Record<
    string,
    unknown
  >
}

function readAmendmentChanges(connection: Database.Database): Array<Record<string, unknown>> {
  return connection
    .prepare(
      `SELECT field_name, previous_value_json, new_value_json
       FROM patient_demographic_amendment_changes
       ORDER BY rowid`
    )
    .all() as Array<Record<string, unknown>>
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

function readOutboxRows(connection: Database.Database): Array<{
  operation: string
  payload_schema_version: string
  payload_json: string
}> {
  return connection
    .prepare(
      `SELECT operation, payload_schema_version, payload_json
       FROM sync_outbox
       ORDER BY rowid`
    )
    .all() as Array<{
    operation: string
    payload_schema_version: string
    payload_json: string
  }>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
    total: number
  }

  return row.total
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
  expect(JSON.stringify(error)).not.toContain('Amina')
  expect(JSON.stringify(error)).not.toContain('Rollback boundary test')
  expect(JSON.stringify(error)).not.toContain('Corrected from source worksheet')
  expect(JSON.stringify(error)).not.toContain('SQLITE')
  expect(JSON.stringify(error)).not.toContain('constraint failed')
  expect(JSON.stringify(error)).not.toContain('E:\\')
  expect(JSON.stringify(error)).not.toContain('C:\\')
}
