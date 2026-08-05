import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createPatientAcknowledgmentService,
  type PatientAcknowledgmentService,
  type PatientAcknowledgmentServiceActor
} from '@main/application'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createPatientAcknowledgmentRepository,
  createPatientRepository,
  createProductionDatabaseMigrationRunner,
  DatabaseTransactionStateError,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  RepositoryWriteError,
  type AuditEventRepository,
  type DatabaseTransactionConnection,
  type DatabaseTransactionExecutor,
  type PatientAcknowledgmentRepository,
  type PatientRepository
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-07-29T12:34:56.789Z'
const adjustedNow = '2026-07-29T12:34:56.790Z'
const initialAcknowledgmentRecordedAt = '2026-07-29T12:34:55.789Z'
const later = '2026-07-29T12:34:57.789Z'
const rollbackPrevious = '2026-07-29T12:35:01.111Z'
const rollbackAdjusted = '2026-07-29T12:35:01.112Z'
const installationId = '11111111-1111-4111-8111-111111111111'
const adminId = '22222222-2222-4222-8222-222222222222'
const nurseId = '33333333-3333-4333-8333-333333333333'
const screenerId = '44444444-4444-4444-8444-444444444444'
const missingActorId = '55555555-5555-4555-8555-555555555555'
const patientId = '66666666-6666-4666-8666-666666666666'
const secondPatientId = '77777777-7777-4777-8777-777777777777'
const missingPatientId = '12121212-1212-4212-8212-121212121212'
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
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  '12345678-1234-4234-8234-123456789abc',
  '23456789-2345-4345-8345-23456789abcd',
  '3456789a-3456-4456-8456-3456789abcde',
  '456789ab-4567-4567-8567-456789abcdef',
  '56789abc-5678-4678-8678-56789abcdef0'
] as const
const registryAcknowledgmentType = 'PATIENT_REGISTRY_ACKNOWLEDGMENT'
const proxyInspectionLeakText =
  'acknowledgment proxy exploded at C:\\secret\\acknowledgment.sqlite3 SELECT Amina'
const unsafeNote = 'Synthetic acknowledgment note must stay out of errors.'

const adminActor: PatientAcknowledgmentServiceActor = {
  userId: parseEntityId(adminId),
  role: 'LOCAL_ADMIN'
}
const nurseActor: PatientAcknowledgmentServiceActor = {
  userId: parseEntityId(nurseId),
  role: 'NURSE'
}
const screenerActor: PatientAcknowledgmentServiceActor = {
  userId: parseEntityId(screenerId),
  role: 'TRAINED_SCREENER'
}

describe('patient acknowledgment service', () => {
  it('records explicit decisions atomically for all roles', async () => {
    const cases = [
      {
        actor: adminActor,
        status: 'ACKNOWLEDGED',
        note: '  Synthetic patient approved data-use acknowledgment.  ',
        expectedNote: 'Synthetic patient approved data-use acknowledgment.'
      },
      {
        actor: nurseActor,
        status: 'DECLINED',
        note: '   ',
        expectedNote: null
      },
      {
        actor: screenerActor,
        status: 'ACKNOWLEDGED',
        note: null,
        expectedNote: null
      }
    ] as const

    for (const testCase of cases) {
      await withAcknowledgmentService(({ connection, service }) => {
        seedCoreRecords(connection)

        const result = service.record(
          {
            patientId: parseEntityId(patientId),
            expectedRowVersion: 1,
            status: testCase.status,
            note: testCase.note
          },
          testCase.actor
        )

        expect(result).toMatchObject({
          status: 'RECORDED',
          acknowledgmentId: generatedIds[0],
          patient: {
            id: patientId,
            rowVersion: 2,
            acknowledgmentStatus: testCase.status,
            acknowledgmentRecordedAt: now,
            displayName: 'Amina Marie Patient'
          }
        })
        expect(Object.isFrozen(result)).toBe(true)
        expect(Object.isFrozen(result.status === 'RECORDED' ? result.patient : null)).toBe(true)
        expect(readPatient(connection, patientId)).toMatchObject({
          row_version: 2,
          updated_by: testCase.actor.userId,
          updated_at: now,
          display_name: 'Amina Marie Patient',
          given_name: 'Amina',
          family_name: 'Patient',
          village: 'Test Buea'
        })
        expect(readRawAcknowledgments(connection)).toEqual([
          expect.objectContaining({
            id: initialAcknowledgmentId,
            status: 'NOT_REQUESTED',
            patient_prior_row_version: null,
            patient_resulting_row_version: null
          }),
          {
            id: generatedIds[0],
            patient_id: patientId,
            consent_type: registryAcknowledgmentType,
            status: testCase.status,
            source_type: 'LOCAL',
            effective_at: now,
            withdrawn_at: null,
            notes: testCase.expectedNote,
            recorded_by: testCase.actor.userId,
            recorded_at: now,
            patient_prior_row_version: 1,
            patient_resulting_row_version: 2
          }
        ])
        expect(readAuditRows(connection)).toEqual([
          {
            action: 'PATIENT_ACKNOWLEDGMENT_RECORDED',
            entity_type: 'PATIENT',
            entity_id: patientId,
            metadata_json: JSON.stringify({
              acknowledgment_id: generatedIds[0],
              previous_status: 'NOT_REQUESTED',
              prior_row_version: 1,
              resulting_row_version: 2,
              status: testCase.status
            })
          }
        ])
        expect(readAuditRows(connection)[0]!.metadata_json).not.toContain('note')
        expect(readAuditRows(connection)[0]!.metadata_json).not.toContain('Amina')
        expect(readOutboxRows(connection)).toEqual([
          {
            operation: 'PATIENT_ACKNOWLEDGMENT_RECORDED',
            payload_schema_version: 'patient.acknowledgment.v1',
            payload_json: JSON.stringify({
              patient_id: patientId,
              acknowledgment_id: generatedIds[0],
              previous_acknowledgment_id: initialAcknowledgmentId,
              previous_status: 'NOT_REQUESTED',
              status: testCase.status,
              note: testCase.expectedNote,
              prior_row_version: 1,
              resulting_row_version: 2,
              source_type: 'LOCAL',
              recorded_by: testCase.actor.userId,
              recorded_at: now
            })
          }
        ])
      })
    }
  })

  it('enforces repeated-status policy without blocking opposite explicit decisions', async () => {
    await withAcknowledgmentService(({ connection, service }) => {
      seedCoreRecords(connection)

      expect(
        service.record(
          {
            patientId: parseEntityId(patientId),
            expectedRowVersion: 1,
            status: 'ACKNOWLEDGED',
            note: null
          },
          adminActor
        )
      ).toMatchObject({ status: 'RECORDED', patient: { rowVersion: 2 } })
      expect(
        service.record(
          {
            patientId: parseEntityId(patientId),
            expectedRowVersion: 2,
            status: 'DECLINED',
            note: null
          },
          adminActor
        )
      ).toMatchObject({ status: 'RECORDED', patient: { rowVersion: 3 } })
      expect(
        service.record(
          {
            patientId: parseEntityId(patientId),
            expectedRowVersion: 3,
            status: 'ACKNOWLEDGED',
            note: null
          },
          adminActor
        )
      ).toMatchObject({ status: 'RECORDED', patient: { rowVersion: 4 } })

      const duplicateCounts = readWriteCounts(connection)
      const duplicate = service.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 4,
          status: 'ACKNOWLEDGED',
          note: 'This duplicate must not be persisted.'
        },
        adminActor
      )

      expect(duplicate).toMatchObject({
        status: 'DUPLICATE_DECISION',
        patient: { rowVersion: 4, acknowledgmentStatus: 'ACKNOWLEDGED' },
        acknowledgment: {
          id: generatedIds[6],
          status: 'ACKNOWLEDGED',
          priorRowVersion: 3,
          resultingRowVersion: 4
        }
      })
      expect(Object.isFrozen(duplicate)).toBe(true)
      expect(
        Object.isFrozen(duplicate.status === 'DUPLICATE_DECISION' ? duplicate.acknowledgment : null)
      ).toBe(true)
      expect(readWriteCounts(connection)).toEqual(duplicateCounts)
    })

    await withAcknowledgmentService(({ connection: secondConnection, service: secondService }) => {
      seedCoreRecords(secondConnection)
      secondService.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          status: 'DECLINED',
          note: null
        },
        nurseActor
      )
      const counts = readWriteCounts(secondConnection)
      const declinedDuplicate = secondService.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 2,
          status: 'DECLINED',
          note: null
        },
        nurseActor
      )

      expect(declinedDuplicate).toMatchObject({
        status: 'DUPLICATE_DECISION',
        patient: { rowVersion: 2, acknowledgmentStatus: 'DECLINED' },
        acknowledgment: { status: 'DECLINED' }
      })
      expect(readWriteCounts(secondConnection)).toEqual(counts)
    })

    for (const status of ['ACKNOWLEDGED', 'DECLINED'] as const) {
      await withAcknowledgmentService(({ connection, service }) => {
        seedCoreRecords(connection)
        expect(
          service.record(
            {
              patientId: parseEntityId(patientId),
              expectedRowVersion: 1,
              status,
              note: null
            },
            adminActor
          )
        ).toMatchObject({ status: 'RECORDED', patient: { acknowledgmentStatus: status } })
      })
    }
  })

  it('adjusts equal-timestamp acknowledgment events so the new event becomes latest', async () => {
    await withAcknowledgmentService(({ connection, service, acknowledgmentRepository }) => {
      const previousAcknowledgmentId = generatedIds[7]

      seedCoreRecords(connection, { rowVersion: 2 })
      insertRawAcknowledgment(connection, {
        id: previousAcknowledgmentId,
        status: 'ACKNOWLEDGED',
        recordedAt: now,
        effectiveAt: now,
        priorRowVersion: 1,
        resultingRowVersion: 2
      })

      const result = service.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 2,
          status: 'DECLINED',
          note: null
        },
        adminActor
      )

      expect(result).toMatchObject({
        status: 'RECORDED',
        acknowledgmentId: generatedIds[0],
        patient: {
          rowVersion: 3,
          acknowledgmentStatus: 'DECLINED',
          acknowledgmentRecordedAt: adjustedNow
        }
      })
      expect(acknowledgmentRepository.getLatestByPatient(parseEntityId(patientId))).toMatchObject({
        id: generatedIds[0],
        status: 'DECLINED',
        recordedAt: adjustedNow,
        priorRowVersion: 2,
        resultingRowVersion: 3
      })
      expect(readPatient(connection, patientId)).toMatchObject({
        row_version: 3,
        updated_at: adjustedNow
      })
      expect(readRawAcknowledgment(connection, generatedIds[0])).toMatchObject({
        effective_at: adjustedNow,
        recorded_at: adjustedNow,
        patient_prior_row_version: 2,
        patient_resulting_row_version: 3
      })
      expect(readAuditRowsWithOccurredAt(connection)).toEqual([
        expect.objectContaining({ occurred_at: adjustedNow })
      ])
      expect(readOutboxRowsWithCreatedAt(connection)).toEqual([
        expect.objectContaining({ created_at: adjustedNow })
      ])
      expect(JSON.parse(readOutboxRowsWithCreatedAt(connection)[0]!.payload_json)).toMatchObject({
        acknowledgment_id: generatedIds[0],
        previous_acknowledgment_id: previousAcknowledgmentId,
        previous_status: 'ACKNOWLEDGED',
        status: 'DECLINED',
        recorded_at: adjustedNow
      })
    })
  })

  it('adjusts acknowledgment timestamps when the transaction clock moves backward', async () => {
    await withAcknowledgmentService(({ connection, service, acknowledgmentRepository }) => {
      const previousAcknowledgmentId = generatedIds[7]

      seedCoreRecords(connection, { rowVersion: 2 })
      insertRawAcknowledgment(connection, {
        id: previousAcknowledgmentId,
        status: 'DECLINED',
        recordedAt: rollbackPrevious,
        effectiveAt: rollbackPrevious,
        priorRowVersion: 1,
        resultingRowVersion: 2
      })

      const result = service.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 2,
          status: 'ACKNOWLEDGED',
          note: null
        },
        nurseActor
      )

      expect(result).toMatchObject({
        status: 'RECORDED',
        acknowledgmentId: generatedIds[0],
        patient: {
          rowVersion: 3,
          acknowledgmentStatus: 'ACKNOWLEDGED',
          acknowledgmentRecordedAt: rollbackAdjusted
        }
      })
      expect(acknowledgmentRepository.getLatestByPatient(parseEntityId(patientId))).toMatchObject({
        id: generatedIds[0],
        status: 'ACKNOWLEDGED',
        recordedAt: rollbackAdjusted
      })
      expect(readRawAcknowledgment(connection, generatedIds[0])).toMatchObject({
        effective_at: rollbackAdjusted,
        recorded_at: rollbackAdjusted
      })
      expect(readPatient(connection, patientId)).toMatchObject({
        row_version: 3,
        updated_at: rollbackAdjusted
      })
    })
  })

  it('returns optimistic-concurrency and missing-patient results without writes', async () => {
    await withAcknowledgmentService(({ connection, service }) => {
      seedCoreRecords(connection, { rowVersion: 2 })

      const result = service.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          status: 'ACKNOWLEDGED',
          note: null
        },
        adminActor
      )

      expect(result).toMatchObject({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: { rowVersion: 2 }
      })
      expectNoAcknowledgmentWrites(connection, { rowVersion: 2 })
    })

    await withAcknowledgmentService(({ connection, service }) => {
      seedCoreRecords(connection)

      expect(
        service.record(
          {
            patientId: parseEntityId(missingPatientId),
            expectedRowVersion: 1,
            status: 'ACKNOWLEDGED',
            note: null
          },
          adminActor
        )
      ).toEqual({ status: 'NOT_FOUND' })
      expectNoAcknowledgmentWrites(connection)
    })
  })

  it('validates commands and actors as exact transport objects with safe errors', async () => {
    await withAcknowledgmentService(({ connection, service }) => {
      seedCoreRecords(connection)

      const getterRequest = createValidRequest()
      Object.defineProperty(getterRequest, 'status', {
        enumerable: true,
        get: () => 'ACKNOWLEDGED'
      })
      const requestWithSymbol = createValidRequest()
      Object.defineProperty(requestWithSymbol, Symbol('status'), {
        enumerable: true,
        value: 'ACKNOWLEDGED'
      })
      const customPrototypeRequest = Object.assign(Object.create({ inherited: true }), {
        patientId: parseEntityId(patientId),
        expectedRowVersion: 1,
        status: 'ACKNOWLEDGED',
        note: null
      })
      const inheritedRequest = Object.assign(Object.create({ status: 'ACKNOWLEDGED' }), {
        patientId: parseEntityId(patientId),
        expectedRowVersion: 1,
        note: null
      })
      const getterActor = { ...adminActor }
      Object.defineProperty(getterActor, 'role', {
        enumerable: true,
        get: () => 'LOCAL_ADMIN'
      })
      const invalidActions = [
        () =>
          service.record({ ...createValidRequest(), status: 'NOT_REQUESTED' } as never, adminActor),
        () => service.record({ ...createValidRequest(), status: 'PENDING' } as never, adminActor),
        () => service.record({ ...createValidRequest(), patientId: 'bad-id' } as never, adminActor),
        () => service.record({ ...createValidRequest(), expectedRowVersion: 0 }, adminActor),
        () => service.record({ ...createValidRequest(), expectedRowVersion: 1.5 }, adminActor),
        () => service.record({ ...createValidRequest(), extra: 'unexpected' } as never, adminActor),
        () =>
          service.record(
            {
              patientId: parseEntityId(patientId),
              expectedRowVersion: 1,
              status: 'ACKNOWLEDGED'
            } as never,
            adminActor
          ),
        () => service.record(getterRequest, adminActor),
        () => service.record(inheritedRequest as never, adminActor),
        () => service.record(requestWithSymbol, adminActor),
        () => service.record(customPrototypeRequest as never, adminActor),
        () => service.record(createValidRequest(), getterActor),
        () =>
          service.record(createValidRequest(), {
            userId: parseEntityId(adminId),
            role: 'UNSUPPORTED'
          } as never),
        () =>
          service.record(createValidRequest(), { userId: 'bad-id', role: 'LOCAL_ADMIN' } as never),
        () =>
          service.record(
            createInspectionThrowingProxy(createValidRequest(), 'getPrototypeOf'),
            adminActor
          ),
        () =>
          service.record(
            createValidRequest(),
            createInspectionThrowingProxy({ ...adminActor }, 'getPrototypeOf')
          ),
        () =>
          service.record(
            createInspectionThrowingProxy(createValidRequest(), 'ownKeys'),
            adminActor
          ),
        () =>
          service.record(
            createValidRequest(),
            createInspectionThrowingProxy({ ...adminActor }, 'getOwnPropertyDescriptor')
          ),
        () => service.record({ ...createValidRequest(), note: 'a'.repeat(501) }, adminActor),
        () => service.record({ ...createValidRequest(), note: 'Unsafe\nnote' }, adminActor),
        () => service.record({ ...createValidRequest(), note: 'Unsafe\uD800note' }, adminActor)
      ]

      for (const action of invalidActions) {
        const error = captureError(action)

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
        expectNoAcknowledgmentWrites(connection)
      }
    })
  })

  it('supports transaction-scoped latest acknowledgment reads and fails closed on bad capability or data', async () => {
    await withAcknowledgmentService(({ connection, acknowledgmentRepository, executor }) => {
      seedCoreRecords(connection)
      insertRawAcknowledgment(connection, {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        status: 'ACKNOWLEDGED',
        recordedAt: later,
        effectiveAt: later,
        priorRowVersion: 1,
        resultingRowVersion: 2
      })
      insertRawAcknowledgment(connection, {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        status: 'DECLINED',
        recordedAt: later,
        effectiveAt: later,
        priorRowVersion: 2,
        resultingRowVersion: 3
      })

      expect(
        executor.run((context) =>
          acknowledgmentRepository.getLatestByPatientForWrite(
            context.connection,
            parseEntityId(patientId)
          )
        )
      ).toMatchObject({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'DECLINED' })

      const rawConnectionError = captureError(() =>
        acknowledgmentRepository.getLatestByPatientForWrite(
          connection as unknown as DatabaseTransactionConnection,
          parseEntityId(patientId)
        )
      )
      expect(rawConnectionError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(rawConnectionError)

      const fabricatedError = captureError(() =>
        acknowledgmentRepository.getLatestByPatientForWrite(
          createFabricatedScopedConnection(connection),
          parseEntityId(patientId)
        )
      )
      expect(fabricatedError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(fabricatedError)

      let expiredConnection: DatabaseTransactionConnection | undefined
      executor.run((context) => {
        expiredConnection = context.connection
      })
      const expiredError = captureError(() =>
        acknowledgmentRepository.getLatestByPatientForWrite(
          expiredConnection!,
          parseEntityId(patientId)
        )
      )
      expect(expiredError).toBeInstanceOf(DatabaseTransactionStateError)
      expectSafeControlledError(expiredError)
    })

    await withAcknowledgmentService(({ connection, acknowledgmentRepository, executor }) => {
      seedCoreRecords(connection)
      insertRawAcknowledgment(connection, {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        status: 'PENDING',
        ignoreChecks: true
      })

      const error = captureError(() =>
        executor.run((context) =>
          acknowledgmentRepository.getLatestByPatientForWrite(
            context.connection,
            parseEntityId(patientId)
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })

    await withAcknowledgmentService(({ connection, acknowledgmentRepository, executor }) => {
      seedCoreRecords(connection)
      insertRawAcknowledgmentWithForeignKeysDisabled(connection, {
        recordedBy: missingActorId,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        recordedAt: later,
        effectiveAt: later
      })

      const error = captureError(() =>
        executor.run((context) =>
          acknowledgmentRepository.getLatestByPatientForWrite(
            context.connection,
            parseEntityId(patientId)
          )
        )
      )

      expect(error).toBeInstanceOf(RepositoryDataIntegrityError)
      expectSafeControlledError(error)
    })

    const fakeConnection = createFakeExecutorConnection()
    createDatabaseTransactionExecutor({
      connection: fakeConnection,
      idGenerator: createEntityIdGenerator(() => generatedIds[0]),
      clock: createUtcClock(() => now),
      logger: { error: vi.fn() }
    }).run((context) =>
      createPatientAcknowledgmentRepository(fakeConnection).getLatestByPatientForWrite(
        context.connection,
        parseEntityId(patientId)
      )
    )
    expect(fakeConnection.execSql).toEqual(['BEGIN IMMEDIATE', 'COMMIT'])
    expect(fakeConnection.preparedSql.join('\n')).not.toMatch(/\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/u)
  })

  it('advances patient row version for acknowledgment without touching demographics or consent rows', async () => {
    await withAcknowledgmentService(({ connection, patientRepository, executor }) => {
      seedCoreRecords(connection)

      const before = readPatient(connection, patientId)
      const result = executor.run((context) =>
        patientRepository.advanceRowVersionForAcknowledgment(context.connection, {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          updatedBy: parseEntityId(nurseId),
          updatedAt: parseUtcTimestamp(now)
        })
      )

      expect(result).toEqual({ status: 'ADVANCED', resultingRowVersion: 2 })
      expect(readPatient(connection, patientId)).toMatchObject({
        ...before,
        updated_by: nurseId,
        updated_at: now,
        row_version: 2
      })
      expect(readTableCount(connection, 'consent_records')).toBe(1)

      const conflict = executor.run((context) =>
        patientRepository.advanceRowVersionForAcknowledgment(context.connection, {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          updatedBy: parseEntityId(nurseId),
          updatedAt: parseUtcTimestamp(now)
        })
      )
      expect(conflict).toMatchObject({
        status: 'PATIENT_VERSION_CONFLICT',
        patient: { rowVersion: 2 }
      })
    })
  })

  it('rejects invalid acknowledgment outbox schema pairings without writes', async () => {
    await withAcknowledgmentService(({ connection, patientRepository, executor }) => {
      seedCoreRecords(connection)

      const invalidInputs = [
        {
          id: parseEntityId(generatedIds[0]),
          aggregateId: parseEntityId(patientId),
          operation: 'PATIENT_ACKNOWLEDGMENT_RECORDED',
          createdAt: parseUtcTimestamp(now),
          payloadSchemaVersion: 'patient.registry.v1',
          payload: { patient_id: patientId, note: unsafeNote }
        },
        {
          id: parseEntityId(generatedIds[0]),
          aggregateId: parseEntityId(patientId),
          operation: 'PATIENT_UPDATED',
          createdAt: parseUtcTimestamp(now),
          payloadSchemaVersion: 'patient.acknowledgment.v1',
          payload: { patient_id: patientId, note: unsafeNote }
        }
      ] as const

      for (const input of invalidInputs) {
        const error = captureError(() =>
          executor.run((context) =>
            patientRepository.insertOutbox(
              context.connection,
              input as unknown as Parameters<PatientRepository['insertOutbox']>[1]
            )
          )
        )

        expect(error).toBeInstanceOf(RepositoryValidationError)
        expectSafeControlledError(error)
        expect(readTableCount(connection, 'sync_outbox')).toBe(0)
      }

      executor.run((context) =>
        patientRepository.insertOutbox(context.connection, {
          id: parseEntityId(generatedIds[0]),
          aggregateId: parseEntityId(patientId),
          operation: 'PATIENT_ACKNOWLEDGMENT_RECORDED',
          createdAt: parseUtcTimestamp(now),
          payloadSchemaVersion: 'patient.acknowledgment.v1',
          payload: { patient_id: patientId }
        })
      )
      executor.run((context) =>
        patientRepository.insertOutbox(context.connection, {
          id: parseEntityId(generatedIds[1]),
          aggregateId: parseEntityId(patientId),
          operation: 'PATIENT_UPDATED',
          createdAt: parseUtcTimestamp(now),
          payloadSchemaVersion: 'patient.registry.v1',
          payload: { patient_id: patientId }
        })
      )
      executor.run((context) =>
        patientRepository.insertOutbox(context.connection, {
          id: parseEntityId(generatedIds[2]),
          aggregateId: parseEntityId(patientId),
          operation: 'PATIENT_DEMOGRAPHICS_AMENDED',
          createdAt: parseUtcTimestamp(now),
          payloadSchemaVersion: 'patient.demographic-amendment.v1',
          payload: { patient_id: patientId }
        })
      )
      expect(readTableCount(connection, 'sync_outbox')).toBe(3)
    })
  })

  it('rolls back patient advancement, acknowledgment, audit, and outbox writes after failures', async () => {
    const failureModes = [
      'after-patient-advance',
      'after-acknowledgment',
      'after-audit',
      'after-outbox'
    ] as const

    for (const failureMode of failureModes) {
      await withAcknowledgmentService(
        ({ connection, service }) => {
          seedCoreRecords(connection)

          const error = captureError(() =>
            service.record(
              {
                patientId: parseEntityId(patientId),
                expectedRowVersion: 1,
                status: 'ACKNOWLEDGED',
                note: unsafeNote
              },
              adminActor
            )
          )

          expect(error).toBeInstanceOf(Error)
          expectSafeControlledError(error)
          expectNoAcknowledgmentWrites(connection)
        },
        { failureMode }
      )
    }
  })

  it('lists acknowledgment history for all roles without writing rows', async () => {
    await withAcknowledgmentService(({ connection, service }) => {
      seedCoreRecords(connection)
      seedCoreRecords(connection, { patientId: secondPatientId, patientCode: 'PT-000002' })

      service.record(
        {
          patientId: parseEntityId(patientId),
          expectedRowVersion: 1,
          status: 'ACKNOWLEDGED',
          note: null
        },
        adminActor
      )
      service.record(
        {
          patientId: parseEntityId(secondPatientId),
          expectedRowVersion: 1,
          status: 'DECLINED',
          note: null
        },
        adminActor
      )
      const writeCounts = readWriteCounts(connection)

      for (const actor of [adminActor, nurseActor, screenerActor]) {
        const history = service.listHistory(
          { patientId: parseEntityId(patientId), page: 1, pageSize: 25 },
          actor
        )

        expect(history).toMatchObject({ page: 1, pageSize: 25, total: 2 })
        expect(history.items.map((item) => item.status)).toEqual(['ACKNOWLEDGED', 'NOT_REQUESTED'])
        expect(history.items[1]).toMatchObject({
          id: initialAcknowledgmentId,
          priorRowVersion: null,
          resultingRowVersion: null
        })
        expect(Object.isFrozen(history)).toBe(true)
        expect(Object.isFrozen(history.items)).toBe(true)
      }

      expect(
        service.listHistory(
          { patientId: parseEntityId(patientId), page: 2, pageSize: 25 },
          adminActor
        )
      ).toMatchObject({ items: [], page: 2, pageSize: 25, total: 2 })
      expect(
        service
          .listHistory(
            { patientId: parseEntityId(secondPatientId), page: 1, pageSize: 25 },
            adminActor
          )
          .items.map((item) => item.patientId)
      ).toEqual([secondPatientId, secondPatientId])
      expect(readWriteCounts(connection)).toEqual(writeCounts)
    })
  })
})

interface AcknowledgmentServiceHarness {
  readonly connection: Database.Database
  readonly service: PatientAcknowledgmentService
  readonly patientRepository: PatientRepository
  readonly acknowledgmentRepository: PatientAcknowledgmentRepository
  readonly executor: DatabaseTransactionExecutor
}

type FailureMode = 'after-patient-advance' | 'after-acknowledgment' | 'after-audit' | 'after-outbox'
type InspectionTrap = 'getPrototypeOf' | 'ownKeys' | 'getOwnPropertyDescriptor'

async function withAcknowledgmentService(
  test: (harness: AcknowledgmentServiceHarness) => void,
  options: { readonly failureMode?: FailureMode } = {}
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd026-acknowledgment-service-'))
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
    const acknowledgmentRepository = createPatientAcknowledgmentRepository(connection)
    const auditRepository = createAuditEventRepository(connection)
    const service = createPatientAcknowledgmentService({
      installationRepository: createInstallationRepository(connection),
      patientRepository: wrapPatientRepository(patientRepository, options.failureMode),
      patientAcknowledgmentRepository: wrapAcknowledgmentRepository(
        acknowledgmentRepository,
        options.failureMode
      ),
      auditEventRepository: wrapAuditRepository(auditRepository, options.failureMode),
      transactionExecutor: executor
    })

    test({ connection, service, patientRepository, acknowledgmentRepository, executor })
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
    advanceRowVersionForAcknowledgment(
      connection: Parameters<PatientRepository['advanceRowVersionForAcknowledgment']>[0],
      input: Parameters<PatientRepository['advanceRowVersionForAcknowledgment']>[1]
    ) {
      const result = repository.advanceRowVersionForAcknowledgment(connection, input)

      if (failureMode === 'after-patient-advance') {
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
        throw new Error('C:\\secret\\acknowledgment.sqlite3 INSERT sync_outbox')
      }
    }
  })
}

function wrapAcknowledgmentRepository(
  repository: PatientAcknowledgmentRepository,
  failureMode: FailureMode | undefined
): PatientAcknowledgmentRepository {
  return Object.freeze({
    ...repository,
    insert(
      connection: Parameters<PatientAcknowledgmentRepository['insert']>[0],
      input: Parameters<PatientAcknowledgmentRepository['insert']>[1]
    ) {
      repository.insert(connection, input)

      if (failureMode === 'after-acknowledgment') {
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
    id:
      overrides.patientId === secondPatientId
        ? secondInitialAcknowledgmentId
        : initialAcknowledgmentId,
    patientId: overrides.patientId ?? patientId,
    status: 'NOT_REQUESTED',
    effectiveAt: initialAcknowledgmentRecordedAt,
    recordedBy: adminId,
    recordedAt: initialAcknowledgmentRecordedAt,
    priorRowVersion: null,
    resultingRowVersion: null
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`
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
      'Test Buea',
      'Test Quarter',
      'Synthetic residence note.',
      adminId,
      now,
      adminId,
      now,
      overrides.rowVersion ?? 1
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
        overrides.id ?? initialAcknowledgmentId,
        overrides.patientId ?? patientId,
        overrides.consentType ?? registryAcknowledgmentType,
        overrides.status ?? 'ACKNOWLEDGED',
        overrides.sourceType ?? 'LOCAL',
        Object.prototype.hasOwnProperty.call(overrides, 'effectiveAt')
          ? overrides.effectiveAt
          : now,
        overrides.withdrawnAt ?? null,
        Object.prototype.hasOwnProperty.call(overrides, 'notes') ? overrides.notes : null,
        overrides.recordedBy ?? adminId,
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

function insertRawAcknowledgmentWithForeignKeysDisabled(
  connection: Database.Database,
  overrides: RawAcknowledgmentOverrides = {}
): void {
  connection.pragma('foreign_keys = OFF')
  try {
    insertRawAcknowledgment(connection, overrides)
  } finally {
    connection.pragma('foreign_keys = ON')
  }
}

function createValidRequest(): Parameters<PatientAcknowledgmentService['record']>[0] {
  return {
    patientId: parseEntityId(patientId),
    expectedRowVersion: 1,
    status: 'ACKNOWLEDGED',
    note: null
  }
}

function readPatient(connection: Database.Database, id: string): Record<string, unknown> {
  return connection.prepare('SELECT * FROM patients WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
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
      ORDER BY recorded_at ASC, id ASC`
    )
    .all() as Array<Record<string, unknown>>
}

function readRawAcknowledgment(
  connection: Database.Database,
  acknowledgmentId: string
): Record<string, unknown> {
  const row = connection.prepare('SELECT * FROM consent_records WHERE id = ?').get(acknowledgmentId)

  if (row === undefined) {
    return {}
  }

  return row as Record<string, unknown>
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

function readAuditRowsWithOccurredAt(connection: Database.Database): Array<Record<string, string>> {
  return connection
    .prepare(
      `SELECT action, entity_type, entity_id, occurred_at, metadata_json
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

function readOutboxRowsWithCreatedAt(connection: Database.Database): Array<{
  operation: string
  payload_schema_version: string
  payload_json: string
  created_at: string
}> {
  return connection
    .prepare(
      `SELECT operation, payload_schema_version, payload_json, created_at
       FROM sync_outbox
       ORDER BY rowid`
    )
    .all() as Array<{
    operation: string
    payload_schema_version: string
    payload_json: string
    created_at: string
  }>
}

function readTableCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS total FROM ${tableName}`).get() as {
    total: number
  }

  return row.total
}

function readWriteCounts(connection: Database.Database): {
  readonly patientRowVersion: unknown
  readonly acknowledgments: number
  readonly audit: number
  readonly outbox: number
} {
  return Object.freeze({
    patientRowVersion: readPatient(connection, patientId).row_version,
    acknowledgments: readTableCount(connection, 'consent_records'),
    audit: readTableCount(connection, 'audit_log'),
    outbox: readTableCount(connection, 'sync_outbox')
  })
}

function expectNoAcknowledgmentWrites(
  connection: Database.Database,
  options: { readonly rowVersion?: number } = {}
): void {
  expect(readPatient(connection, patientId)).toMatchObject({
    row_version: options.rowVersion ?? 1,
    given_name: 'Amina',
    family_name: 'Patient',
    village: 'Test Buea'
  })
  expect(readTableCount(connection, 'consent_records')).toBe(1)
  expect(readTableCount(connection, 'audit_log')).toBe(0)
  expect(readTableCount(connection, 'sync_outbox')).toBe(0)
}

function createInspectionThrowingProxy<T extends object>(target: T, trap: InspectionTrap): T {
  return new Proxy(target, {
    getPrototypeOf(value) {
      if (trap === 'getPrototypeOf') {
        throw new Error(proxyInspectionLeakText)
      }

      return Reflect.getPrototypeOf(value)
    },
    ownKeys(value) {
      if (trap === 'ownKeys') {
        throw new Error(proxyInspectionLeakText)
      }

      return Reflect.ownKeys(value)
    },
    getOwnPropertyDescriptor(value, property) {
      if (trap === 'getOwnPropertyDescriptor') {
        throw new Error(proxyInspectionLeakText)
      }

      return Reflect.getOwnPropertyDescriptor(value, property)
    }
  })
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
        run: vi.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
        get: vi.fn(() => undefined),
        all: vi.fn(() => []),
        iterate: vi.fn(),
        pluck: vi.fn(),
        expand: vi.fn(),
        raw: vi.fn(),
        bind: vi.fn(),
        columns: vi.fn(() => []),
        safeIntegers: vi.fn()
      } as unknown as Database.Statement
    },
    close: vi.fn(),
    loadExtension: vi.fn(),
    defaultSafeIntegers: vi.fn(),
    unsafeMode: vi.fn(),
    pragma: vi.fn(),
    transaction: vi.fn(),
    function: vi.fn(),
    aggregate: vi.fn(),
    table: vi.fn(),
    backup: vi.fn(),
    serialize: vi.fn(),
    name: 'fake',
    memory: true,
    readonly: false,
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
  expect(JSON.stringify(error)).not.toContain('Amina')
  expect(JSON.stringify(error)).not.toContain(patientId)
  expect(JSON.stringify(error)).not.toContain(unsafeNote)
  expect(JSON.stringify(error)).not.toContain(proxyInspectionLeakText)
  expect(JSON.stringify(error)).not.toContain('SQLITE')
  expect(JSON.stringify(error)).not.toContain('constraint failed')
  expect(JSON.stringify(error)).not.toContain('E:\\')
  expect(JSON.stringify(error)).not.toContain('C:\\')
}
