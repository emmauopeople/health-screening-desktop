import {
  normalizePatientAcknowledgmentNote,
  parseAuditActionCode,
  parseAuditEntityType,
  parseLocalUserRole,
  parsePatientAcknowledgmentDecisionStatus,
  parsePatientAcknowledgmentRowVersion,
  RepositoryValidationError,
  type PatientDetailRecord
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import type {
  ListPatientAcknowledgmentHistoryRequest,
  ListPatientAcknowledgmentHistoryResult,
  PatientAcknowledgmentService,
  PatientAcknowledgmentServiceActor,
  PatientAcknowledgmentServiceDependencies,
  RecordPatientAcknowledgmentRequest,
  RecordPatientAcknowledgmentResult
} from './patient-acknowledgment-service-types'

const acknowledgmentRecordedAction = parseAuditActionCode('PATIENT_ACKNOWLEDGMENT_RECORDED')
const patientEntityType = parseAuditEntityType('PATIENT')
const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)

interface ValidatedActor {
  readonly userId: EntityId
  readonly role: ReturnType<typeof parseLocalUserRole>
}

interface ParsedRecordAcknowledgmentCommand {
  readonly patientId: EntityId
  readonly expectedRowVersion: number
  readonly status: ReturnType<typeof parsePatientAcknowledgmentDecisionStatus>
  readonly note: string | null
}

export function createPatientAcknowledgmentService({
  installationRepository,
  patientRepository,
  patientAcknowledgmentRepository,
  auditEventRepository,
  transactionExecutor
}: PatientAcknowledgmentServiceDependencies): PatientAcknowledgmentService {
  return Object.freeze({
    record(
      request: RecordPatientAcknowledgmentRequest,
      actor: PatientAcknowledgmentServiceActor
    ): RecordPatientAcknowledgmentResult {
      const validatedActor = validateActor(actor)
      const command = parseRecordAcknowledgmentCommand(request)

      return transactionExecutor.run((context) => {
        const installation = installationRepository.get()

        if (installation === null) {
          throw new RepositoryValidationError()
        }

        const current = patientRepository.getByIdForWrite(context.connection, command.patientId)

        if (current === null) {
          return Object.freeze({ status: 'NOT_FOUND' as const })
        }

        if (current.rowVersion !== command.expectedRowVersion) {
          return Object.freeze({
            status: 'PATIENT_VERSION_CONFLICT' as const,
            patient: current
          })
        }

        const latestAcknowledgment = patientAcknowledgmentRepository.getLatestByPatientForWrite(
          context.connection,
          command.patientId
        )
        const previousStatus = latestAcknowledgment?.status ?? 'NOT_REQUESTED'

        if (latestAcknowledgment?.status === command.status) {
          return Object.freeze({
            status: 'DUPLICATE_DECISION' as const,
            patient: current,
            acknowledgment: latestAcknowledgment
          })
        }

        const recordedAt = createMonotonicAcknowledgmentTimestamp(
          context.nowUtc(),
          latestAcknowledgment?.recordedAt ?? null
        )
        const acknowledgmentId = context.newEntityId()
        const advanceResult = patientRepository.advanceRowVersionForAcknowledgment(
          context.connection,
          {
            patientId: command.patientId,
            expectedRowVersion: command.expectedRowVersion,
            updatedBy: validatedActor.userId,
            updatedAt: recordedAt
          }
        )

        if (advanceResult.status !== 'ADVANCED') {
          return advanceResult
        }

        const resultingRowVersion = command.expectedRowVersion + 1

        if (advanceResult.resultingRowVersion !== resultingRowVersion) {
          throw new RepositoryValidationError()
        }

        patientAcknowledgmentRepository.insert(context.connection, {
          id: acknowledgmentId,
          patientId: command.patientId,
          status: command.status,
          note: command.note,
          recordedBy: validatedActor.userId,
          recordedAt,
          priorRowVersion: command.expectedRowVersion,
          resultingRowVersion
        })

        auditEventRepository.insert(context.connection, {
          id: context.newEntityId(),
          installationId: installation.id,
          userId: validatedActor.userId,
          action: acknowledgmentRecordedAction,
          entityType: patientEntityType,
          entityId: command.patientId,
          occurredAt: recordedAt,
          metadata: Object.freeze({
            acknowledgment_id: acknowledgmentId,
            prior_row_version: command.expectedRowVersion,
            resulting_row_version: resultingRowVersion,
            previous_status: previousStatus,
            status: command.status
          })
        })

        patientRepository.insertOutbox(context.connection, {
          id: context.newEntityId(),
          aggregateId: command.patientId,
          operation: 'PATIENT_ACKNOWLEDGMENT_RECORDED',
          createdAt: recordedAt,
          payloadSchemaVersion: 'patient.acknowledgment.v1',
          payload: Object.freeze({
            patient_id: command.patientId,
            acknowledgment_id: acknowledgmentId,
            previous_acknowledgment_id: latestAcknowledgment?.id ?? null,
            previous_status: previousStatus,
            status: command.status,
            note: command.note,
            prior_row_version: command.expectedRowVersion,
            resulting_row_version: resultingRowVersion,
            source_type: 'LOCAL',
            recorded_by: validatedActor.userId,
            recorded_at: recordedAt
          })
        })

        const updated = patientRepository.getByIdForWrite(context.connection, command.patientId)

        verifyRecordedPatient(updated, command.status, resultingRowVersion, recordedAt)

        return Object.freeze({
          status: 'RECORDED' as const,
          patient: updated,
          acknowledgmentId
        })
      })
    },

    listHistory(
      request: ListPatientAcknowledgmentHistoryRequest,
      actor: PatientAcknowledgmentServiceActor
    ): ListPatientAcknowledgmentHistoryResult {
      validateActor(actor)

      return patientAcknowledgmentRepository.listByPatient(request)
    }
  })
}

function validateActor(actor: PatientAcknowledgmentServiceActor): ValidatedActor {
  try {
    const data = readDataProperties(actor, ['userId', 'role'])
    const userId = parseEntityId(data.userId)
    const role = parseLocalUserRole(data.role)

    if (!allowedRoles.includes(role)) {
      throw new RepositoryValidationError()
    }

    return Object.freeze({ userId, role })
  } catch {
    throw new RepositoryValidationError()
  }
}

function parseRecordAcknowledgmentCommand(
  request: RecordPatientAcknowledgmentRequest
): ParsedRecordAcknowledgmentCommand {
  try {
    const data = readDataProperties(request, ['patientId', 'expectedRowVersion', 'status', 'note'])

    return Object.freeze({
      patientId: parseEntityId(data.patientId),
      expectedRowVersion: parsePatientAcknowledgmentRowVersion(data.expectedRowVersion),
      status: parsePatientAcknowledgmentDecisionStatus(data.status),
      note: normalizePatientAcknowledgmentNote(data.note)
    })
  } catch {
    throw new RepositoryValidationError()
  }
}

function verifyRecordedPatient(
  patient: PatientDetailRecord | null,
  status: ParsedRecordAcknowledgmentCommand['status'],
  resultingRowVersion: number,
  recordedAt: UtcTimestamp
): asserts patient is PatientDetailRecord {
  if (
    patient === null ||
    patient.rowVersion !== resultingRowVersion ||
    patient.acknowledgmentStatus !== status ||
    patient.acknowledgmentRecordedAt !== recordedAt
  ) {
    throw new RepositoryValidationError()
  }
}

function createMonotonicAcknowledgmentTimestamp(
  clockTimestamp: UtcTimestamp,
  previousRecordedAt: UtcTimestamp | null
): UtcTimestamp {
  try {
    const parsedClockTimestamp = parseUtcTimestamp(clockTimestamp)

    if (previousRecordedAt === null) {
      return parsedClockTimestamp
    }

    const parsedPreviousRecordedAt = parseUtcTimestamp(previousRecordedAt)
    const clockMilliseconds = new Date(parsedClockTimestamp).getTime()
    const previousMilliseconds = new Date(parsedPreviousRecordedAt).getTime()

    if (!Number.isFinite(clockMilliseconds) || !Number.isFinite(previousMilliseconds)) {
      throw new RepositoryValidationError()
    }

    if (clockMilliseconds > previousMilliseconds) {
      return parsedClockTimestamp
    }

    const adjustedMilliseconds = previousMilliseconds + 1

    if (!Number.isFinite(adjustedMilliseconds)) {
      throw new RepositoryValidationError()
    }

    return parseUtcTimestamp(new Date(adjustedMilliseconds).toISOString())
  } catch {
    throw new RepositoryValidationError()
  }
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RepositoryValidationError()
  }

  let prototype: object | null

  try {
    prototype = Object.getPrototypeOf(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new RepositoryValidationError()
  }

  let descriptors: PropertyDescriptorMap

  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)
  const stringKeys: string[] = []

  for (const key of keys) {
    if (typeof key !== 'string') {
      throw new RepositoryValidationError()
    }

    stringKeys.push(key)
  }

  if (
    stringKeys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => stringKeys.includes(propertyName))
  ) {
    throw new RepositoryValidationError()
  }

  const data: Record<string, unknown> = {}

  for (const propertyName of stringKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}
