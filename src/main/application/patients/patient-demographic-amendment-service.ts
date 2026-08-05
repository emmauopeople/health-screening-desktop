import {
  normalizePatientEditableFields,
  normalizePatientDemographicAmendmentReasonNote,
  parseAuditActionCode,
  parseAuditEntityType,
  parseLocalUserRole,
  parsePatientDemographicAmendmentReasonCode,
  parsePatientRowVersion,
  patientDemographicAmendmentFieldOrder,
  RepositoryValidationError,
  type NormalizedPatientFields,
  type PatientDemographicAmendmentChangeInput,
  type PatientDemographicAmendmentFieldName,
  type PatientDemographicAmendmentValue,
  type PatientDetailRecord
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { PatientAcknowledgmentStatus, PatientEditableFields } from '@shared/ipc'

import type {
  AmendPatientDemographicsRequest,
  AmendPatientDemographicsResult,
  ListPatientDemographicAmendmentHistoryRequest,
  ListPatientDemographicAmendmentHistoryResult,
  PatientDemographicAmendmentService,
  PatientDemographicAmendmentServiceActor,
  PatientDemographicAmendmentServiceDependencies,
  PatientDemographicPatch
} from './patient-demographic-amendment-service-types'

const demographicsAmendedAction = parseAuditActionCode('PATIENT_DEMOGRAPHICS_AMENDED')
const patientEntityType = parseAuditEntityType('PATIENT')

const allowedRoles = Object.freeze(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'] as const)
const statusChangeRoles = new Set(['LOCAL_ADMIN', 'NURSE'])
const patchKeys = Object.freeze([
  'givenName',
  'familyName',
  'otherNames',
  'dateOfBirth',
  'approximateAgeYears',
  'ageAsOfDate',
  'sex',
  'village',
  'quarter',
  'phone',
  'alternateContactName',
  'alternateContactPhone',
  'residenceNotes',
  'status'
] as const satisfies readonly (keyof PatientDemographicPatch)[])
const patchKeySet = new Set<string>(patchKeys)

type PatchKey = (typeof patchKeys)[number]

interface ParsedAmendmentCommand {
  readonly patientId: EntityId
  readonly expectedRowVersion: number
  readonly reasonCode: ReturnType<typeof parsePatientDemographicAmendmentReasonCode>
  readonly reasonNote: string | null
  readonly patch: Partial<Record<PatchKey, unknown>>
}

interface ValidatedActor {
  readonly userId: EntityId
  readonly role: ReturnType<typeof parseLocalUserRole>
}

interface DemographicFieldDescriptor {
  readonly patchKey: PatchKey
  readonly fieldName: PatientDemographicAmendmentFieldName
  readonly getCurrentValue: (patient: PatientDetailRecord) => PatientDemographicAmendmentValue
  readonly getNextValue: (fields: NormalizedPatientFields) => PatientDemographicAmendmentValue
}

const fieldDescriptors = Object.freeze([
  descriptor(
    'givenName',
    'given_name',
    (patient) => patient.givenName,
    (fields) => fields.givenName
  ),
  descriptor(
    'familyName',
    'family_name',
    (patient) => patient.familyName,
    (fields) => fields.familyName
  ),
  descriptor(
    'otherNames',
    'other_names',
    (patient) => patient.otherNames,
    (fields) => fields.otherNames
  ),
  descriptor(
    'dateOfBirth',
    'date_of_birth',
    (patient) => patient.dateOfBirth,
    (fields) => fields.dateOfBirth
  ),
  descriptor(
    'approximateAgeYears',
    'approximate_age_years',
    (patient) => patient.approximateAgeYears,
    (fields) => fields.approximateAgeYears
  ),
  descriptor(
    'ageAsOfDate',
    'age_as_of_date',
    (patient) => patient.ageAsOfDate,
    (fields) => fields.ageAsOfDate
  ),
  descriptor(
    'sex',
    'sex',
    (patient) => patient.sex,
    (fields) => fields.sex
  ),
  descriptor(
    'village',
    'village',
    (patient) => patient.village,
    (fields) => fields.village
  ),
  descriptor(
    'quarter',
    'quarter',
    (patient) => patient.quarter,
    (fields) => fields.quarter
  ),
  descriptor(
    'phone',
    'phone',
    (patient) => patient.phone,
    (fields) => fields.phone
  ),
  descriptor(
    'alternateContactName',
    'alternate_contact_name',
    (patient) => patient.alternateContactName,
    (fields) => fields.alternateContactName
  ),
  descriptor(
    'alternateContactPhone',
    'alternate_contact_phone',
    (patient) => patient.alternateContactPhone,
    (fields) => fields.alternateContactPhone
  ),
  descriptor(
    'residenceNotes',
    'residence_notes',
    (patient) => patient.residenceNotes,
    (fields) => fields.residenceNotes
  ),
  descriptor(
    'status',
    'status',
    (patient) => patient.status,
    (fields) => fields.status
  )
] as const)

export function createPatientDemographicAmendmentService({
  installationRepository,
  patientRepository,
  patientDemographicAmendmentRepository,
  auditEventRepository,
  transactionExecutor
}: PatientDemographicAmendmentServiceDependencies): PatientDemographicAmendmentService {
  return Object.freeze({
    amend(
      request: AmendPatientDemographicsRequest,
      actor: PatientDemographicAmendmentServiceActor
    ): AmendPatientDemographicsResult {
      const validatedActor = validateActor(actor)
      const command = parseAmendmentCommand(request)

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

        const nextFields = createNextNormalizedFields(current, command.patch)
        const changes = calculateChanges(current, nextFields)

        if (changes.length === 0) {
          throw new RepositoryValidationError()
        }

        const changesStatus = changes.some((change) => change.fieldName === 'status')

        if (changesStatus && command.reasonNote === null) {
          throw new RepositoryValidationError()
        }

        if (changesStatus && !statusChangeRoles.has(validatedActor.role)) {
          return Object.freeze({ status: 'FORBIDDEN' as const })
        }

        const occurredAt = context.nowUtc()
        const amendmentId = context.newEntityId()
        const updateResult = patientRepository.updateDemographics(context.connection, {
          id: command.patientId,
          expectedRowVersion: command.expectedRowVersion,
          fields: nextFields,
          updatedBy: validatedActor.userId,
          updatedAt: occurredAt
        })

        if (updateResult.status !== 'UPDATED') {
          return updateResult
        }

        if (updateResult.patient.rowVersion !== command.expectedRowVersion + 1) {
          throw new RepositoryValidationError()
        }

        patientDemographicAmendmentRepository.insert(context.connection, {
          id: amendmentId,
          patientId: command.patientId,
          priorRowVersion: command.expectedRowVersion,
          resultingRowVersion: updateResult.patient.rowVersion,
          reasonCode: command.reasonCode,
          reasonNote: command.reasonNote,
          amendedBy: validatedActor.userId,
          amendedAt: occurredAt,
          changes
        })

        auditEventRepository.insert(context.connection, {
          id: context.newEntityId(),
          installationId: installation.id,
          userId: validatedActor.userId,
          action: demographicsAmendedAction,
          entityType: patientEntityType,
          entityId: command.patientId,
          occurredAt,
          metadata: Object.freeze({
            amendment_id: amendmentId,
            prior_row_version: command.expectedRowVersion,
            resulting_row_version: updateResult.patient.rowVersion,
            reason_code: command.reasonCode,
            changed_field_names: Object.freeze(changes.map((change) => change.fieldName))
          })
        })

        const changedFieldsPayload = Object.freeze(
          changes.map((change) =>
            Object.freeze({
              field_name: change.fieldName,
              previous_value: change.previousValue,
              new_value: change.newValue
            })
          )
        )

        patientRepository.insertOutbox(context.connection, {
          id: context.newEntityId(),
          aggregateId: command.patientId,
          operation: 'PATIENT_DEMOGRAPHICS_AMENDED',
          createdAt: occurredAt,
          payloadSchemaVersion: 'patient.demographic-amendment.v1',
          payload: Object.freeze({
            patient_id: command.patientId,
            amendment_id: amendmentId,
            prior_row_version: command.expectedRowVersion,
            resulting_row_version: updateResult.patient.rowVersion,
            reason_code: command.reasonCode,
            reason_note: command.reasonNote,
            changed_fields: changedFieldsPayload,
            amended_by: validatedActor.userId,
            amended_at: occurredAt
          })
        })

        return Object.freeze({
          status: 'AMENDED' as const,
          patient: updateResult.patient,
          amendmentId
        })
      })
    },

    listHistory(
      request: ListPatientDemographicAmendmentHistoryRequest,
      actor: PatientDemographicAmendmentServiceActor
    ): ListPatientDemographicAmendmentHistoryResult {
      validateActor(actor)

      return patientDemographicAmendmentRepository.listByPatient(request)
    }
  })
}

function descriptor(
  patchKey: PatchKey,
  fieldName: PatientDemographicAmendmentFieldName,
  getCurrentValue: (patient: PatientDetailRecord) => PatientDemographicAmendmentValue,
  getNextValue: (fields: NormalizedPatientFields) => PatientDemographicAmendmentValue
): DemographicFieldDescriptor {
  return Object.freeze({
    patchKey,
    fieldName,
    getCurrentValue,
    getNextValue
  })
}

function validateActor(actor: PatientDemographicAmendmentServiceActor): ValidatedActor {
  const data = readDataProperties(actor, ['userId', 'role'])
  const userId = parseEntityId(data.userId)
  const role = parseLocalUserRole(data.role)

  if (!allowedRoles.includes(role)) {
    throw new RepositoryValidationError()
  }

  return Object.freeze({ userId, role })
}

function parseAmendmentCommand(request: AmendPatientDemographicsRequest): ParsedAmendmentCommand {
  const data = readDataProperties(request, [
    'patientId',
    'expectedRowVersion',
    'reasonCode',
    'reasonNote',
    'patch'
  ])
  const patch = parsePatch(data.patch)
  const reasonCode = parsePatientDemographicAmendmentReasonCode(data.reasonCode)
  const reasonNote = normalizePatientDemographicAmendmentReasonNote(data.reasonNote)

  if (reasonCode === 'OTHER' && reasonNote === null) {
    throw new RepositoryValidationError()
  }

  return Object.freeze({
    patientId: parseEntityId(data.patientId),
    expectedRowVersion: parsePatientRowVersion(data.expectedRowVersion),
    reasonCode,
    reasonNote,
    patch
  })
}

function parsePatch(value: unknown): Partial<Record<PatchKey, unknown>> {
  const rawPatch = readDataProperties(value, null)
  const keys = Object.keys(rawPatch)

  if (keys.length === 0) {
    throw new RepositoryValidationError()
  }

  for (const key of keys) {
    if (!patchKeySet.has(key)) {
      throw new RepositoryValidationError()
    }
  }

  return Object.freeze(rawPatch) as Partial<Record<PatchKey, unknown>>
}

function createNextNormalizedFields(
  current: PatientDetailRecord,
  patch: Partial<Record<PatchKey, unknown>>
): NormalizedPatientFields {
  const editable: PatientEditableFields = {
    givenName: current.givenName,
    familyName: current.familyName,
    otherNames: current.otherNames,
    dateOfBirth: current.dateOfBirth,
    approximateAgeYears: current.approximateAgeYears,
    ageAsOfDate: current.ageAsOfDate,
    sex: current.sex,
    village: current.village,
    quarter: current.quarter,
    phone: current.phone,
    alternateContactName: current.alternateContactName,
    alternateContactPhone: current.alternateContactPhone,
    residenceNotes: current.residenceNotes,
    status: current.status,
    acknowledgmentStatus: current.acknowledgmentStatus as PatientAcknowledgmentStatus
  }

  const mutableEditable = editable as Record<PatchKey, unknown>

  for (const key of Object.keys(patch) as PatchKey[]) {
    mutableEditable[key] = patch[key]
  }

  return normalizePatientEditableFields(editable, { today: new Date().toISOString().slice(0, 10) })
}

function calculateChanges(
  current: PatientDetailRecord,
  nextFields: NormalizedPatientFields
): readonly PatientDemographicAmendmentChangeInput[] {
  const changes = fieldDescriptors
    .map((field) => {
      const previousValue = field.getCurrentValue(current)
      const newValue = field.getNextValue(nextFields)

      return Object.is(previousValue, newValue)
        ? null
        : Object.freeze({
            fieldName: field.fieldName,
            previousValue,
            newValue
          })
    })
    .filter((change): change is PatientDemographicAmendmentChangeInput => change !== null)
    .sort(
      (left, right) =>
        patientDemographicAmendmentFieldOrder.indexOf(left.fieldName) -
        patientDemographicAmendmentFieldOrder.indexOf(right.fieldName)
    )

  return Object.freeze(changes)
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[] | null
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
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
    expectedKeys !== null &&
    (stringKeys.length !== expectedKeys.length ||
      !expectedKeys.every((propertyName) => stringKeys.includes(propertyName)))
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
