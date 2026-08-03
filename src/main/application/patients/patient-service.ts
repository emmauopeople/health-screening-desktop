import { createHash } from 'node:crypto'

import {
  DatabaseTransactionExecutionError,
  parseAuditActionCode,
  parseAuditEntityType,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  type CreateAuditEventInput,
  type PatientDuplicateCandidateRecord,
  type PatientRecord,
  type PatientRegistrationIdentityInput,
  type PatientSearchInput
} from '@main/database'
import { parseEntityId, type EntityId, type UtcTimestamp } from '@main/foundation'
import {
  normalizePatientPhone,
  normalizePatientSearchText,
  patientDuplicateReasonLabels,
  type PatientCreateRequest,
  type PatientCreateSuccessData,
  type PatientDuplicateCandidate,
  type PatientDuplicateReviewData,
  type PatientFindDuplicatesRequest,
  type PatientGetSummaryRequest,
  type PatientSearchRequest,
  type PatientSearchSuccessData,
  type PublicPatientSummary
} from '@shared/ipc'

import {
  getPatientRegistryErrorType,
  isPatientRegistryError,
  PatientRegistryCreationError,
  PatientRegistryNotFoundError,
  PatientRegistryStateIntegrityError,
  PatientRegistryValidationError,
  rebuildPatientRegistryError
} from './patient-service-errors'
import type {
  PatientRegistryActor,
  PatientRegistryService,
  PatientRegistryServiceDependencies
} from './patient-service-types'

const patientCreatedAction = parseAuditActionCode('PATIENT_CREATED')
const duplicateOverrideAction = parseAuditActionCode('DUPLICATE_OVERRIDE')
const patientEntityType = parseAuditEntityType('PATIENT')

export function createPatientRegistryService({
  installationRepository,
  patientRepository,
  auditEventRepository,
  transactionExecutor
}: PatientRegistryServiceDependencies): PatientRegistryService {
  return Object.freeze({
    search(actor: PatientRegistryActor, request: PatientSearchRequest): PatientSearchSuccessData {
      requireActor(actor)

      try {
        const result = patientRepository.search(toPatientSearchInput(request))

        return {
          rows: result.rows.map(toPublicPatientSummary),
          total: result.total,
          page: result.page,
          pageSize: result.pageSize
        }
      } catch (error) {
        throw toPatientRegistryBoundaryError(error)
      }
    },

    getSummary(
      actor: PatientRegistryActor,
      request: PatientGetSummaryRequest
    ): PublicPatientSummary {
      requireActor(actor)

      try {
        const patient = patientRepository.getById(parseEntityId(request.patientId))

        if (patient === null) {
          throw new PatientRegistryNotFoundError()
        }

        return toPublicPatientSummary(patient)
      } catch (error) {
        throw toPatientRegistryBoundaryError(error)
      }
    },

    findDuplicates(
      actor: PatientRegistryActor,
      request: PatientFindDuplicatesRequest
    ): PatientDuplicateReviewData {
      requireActor(actor)

      try {
        const input = toRegistrationIdentityInput(request)
        const candidates = patientRepository.findDuplicateCandidates(input)

        return toDuplicateReviewData(input, candidates)
      } catch (error) {
        throw toPatientRegistryBoundaryError(error)
      }
    },

    create(actor: PatientRegistryActor, request: PatientCreateRequest): PatientCreateSuccessData {
      requireActor(actor)

      try {
        return transactionExecutor.run((context) => {
          const installation = installationRepository.getState()

          if (installation.status !== 'INITIALIZED') {
            throw new PatientRegistryStateIntegrityError()
          }

          const input = toRegistrationIdentityInput(request)
          const candidates = patientRepository.findDuplicateCandidates(input)
          const duplicateReview = toDuplicateReviewData(input, candidates)
          const hasValidDuplicateReview =
            candidates.length === 0 ||
            request.reviewedDuplicateToken === duplicateReview.reviewToken

          if (!hasValidDuplicateReview) {
            return {
              status: 'DUPLICATE_REVIEW_REQUIRED' as const,
              candidates: duplicateReview.candidates,
              reviewToken: duplicateReview.reviewToken
            }
          }

          const occurredAt = context.nowUtc()
          const patient = patientRepository.insert(context.connection, {
            ...input,
            id: context.newEntityId(),
            identifierId: context.newEntityId(),
            acknowledgmentId: context.newEntityId(),
            outboxId: context.newEntityId(),
            createdBy: actor.user.id,
            createdAt: occurredAt,
            acknowledgmentStatus: request.acknowledgmentStatus,
            acknowledgmentReference: request.acknowledgmentReference ?? null
          })

          if (candidates.length > 0) {
            auditEventRepository.insert(
              context.connection,
              createDuplicateOverrideAuditEvent({
                id: context.newEntityId(),
                installationId: installation.installation.id,
                userId: actor.user.id,
                patientId: patient.id,
                occurredAt,
                candidates
              })
            )
          }

          auditEventRepository.insert(
            context.connection,
            createPatientCreatedAuditEvent({
              id: context.newEntityId(),
              installationId: installation.installation.id,
              userId: actor.user.id,
              patient,
              occurredAt,
              duplicateReviewed: candidates.length > 0
            })
          )

          return {
            status: 'CREATED' as const,
            patient: toPublicPatientSummary(patient)
          }
        })
      } catch (error) {
        throw toPatientRegistryBoundaryError(error)
      }
    }
  })
}

function toPatientSearchInput(request: PatientSearchRequest): PatientSearchInput {
  return Object.freeze({
    query: request.query ?? '',
    filters: Object.freeze({
      dateOfBirth: request.filters?.dateOfBirth ?? null,
      approximateAgeYears: request.filters?.approximateAgeYears ?? null,
      sex: request.filters?.sex ?? null,
      village: request.filters?.village ?? null,
      quarter: request.filters?.quarter ?? null
    }),
    page: request.page ?? 1,
    pageSize: request.pageSize ?? 25
  })
}

function toRegistrationIdentityInput(
  request: PatientFindDuplicatesRequest | PatientCreateRequest
): PatientRegistrationIdentityInput {
  return Object.freeze({
    givenName: request.givenName,
    middleName: request.middleName ?? null,
    familyName: request.familyName,
    sex: request.sex,
    dateOfBirth: request.dateOfBirth ?? null,
    approximateAgeYears: request.approximateAgeYears ?? null,
    approximateAgeAsOfDate: request.approximateAgeAsOfDate ?? null,
    village: request.village,
    quarter: request.quarter ?? null,
    phone: request.phone ?? null
  })
}

function toDuplicateReviewData(
  input: PatientRegistrationIdentityInput,
  candidates: readonly PatientDuplicateCandidateRecord[]
): PatientDuplicateReviewData {
  const publicCandidates = candidates.map(toPublicDuplicateCandidate)

  return {
    candidates: publicCandidates,
    reviewToken: createDuplicateReviewToken(input, candidates)
  }
}

function toPublicDuplicateCandidate(
  candidate: PatientDuplicateCandidateRecord
): PatientDuplicateCandidate {
  return {
    patient: toPublicPatientSummary(candidate.patient),
    reasonCodes: [...candidate.reasonCodes],
    reasonLabels: candidate.reasonCodes.map(
      (reasonCode) => patientDuplicateReasonLabels[reasonCode]
    )
  }
}

function toPublicPatientSummary(patient: PatientRecord): PublicPatientSummary {
  return {
    patientId: patient.id,
    patientCode: patient.patientCode,
    displayName: patient.displayName,
    status: patient.status,
    sex: patient.sex,
    dateOfBirth: patient.dateOfBirth,
    approximateAgeYears: patient.approximateAgeYears,
    approximateAgeAsOfDate: patient.approximateAgeAsOfDate,
    ageDobDisplay: formatAgeDobDisplay(patient),
    village: patient.village,
    quarter: patient.quarter,
    phoneAvailable: patient.phoneNormalized !== null,
    lastScreening: null,
    referralFollowUp: null,
    revision: patient.updatedAt
  }
}

function formatAgeDobDisplay(patient: PatientRecord): string {
  if (patient.dateOfBirth !== null) {
    return `DOB ${patient.dateOfBirth}`
  }

  return `Approx. ${patient.approximateAgeYears} as of ${patient.approximateAgeAsOfDate}`
}

function createDuplicateReviewToken(
  input: PatientRegistrationIdentityInput,
  candidates: readonly PatientDuplicateCandidateRecord[]
): string {
  const canonical = {
    name: normalizePatientSearchText(
      [input.givenName, input.middleName, input.familyName].filter(Boolean).join(' ')
    ),
    sex: input.sex,
    dateOfBirth: input.dateOfBirth,
    approximateAgeYears: input.approximateAgeYears,
    approximateAgeAsOfDate: input.approximateAgeAsOfDate,
    village: normalizePatientSearchText(input.village),
    quarter: input.quarter === null ? null : normalizePatientSearchText(input.quarter),
    phone: normalizePatientPhone(input.phone),
    candidates: candidates.map((candidate) => ({
      id: candidate.patient.id,
      revision: candidate.patient.updatedAt,
      reasons: candidate.reasonCodes
    }))
  }

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

function createPatientCreatedAuditEvent({
  id,
  installationId,
  userId,
  patient,
  occurredAt,
  duplicateReviewed
}: {
  readonly id: EntityId
  readonly installationId: EntityId
  readonly userId: EntityId
  readonly patient: PatientRecord
  readonly occurredAt: UtcTimestamp
  readonly duplicateReviewed: boolean
}): CreateAuditEventInput {
  return {
    id,
    installationId,
    userId,
    action: patientCreatedAction,
    entityType: patientEntityType,
    entityId: patient.id,
    occurredAt,
    metadata: Object.freeze({
      patient_code: patient.patientCode,
      duplicate_reviewed: duplicateReviewed
    })
  }
}

function createDuplicateOverrideAuditEvent({
  id,
  installationId,
  userId,
  patientId,
  occurredAt,
  candidates
}: {
  readonly id: EntityId
  readonly installationId: EntityId
  readonly userId: EntityId
  readonly patientId: EntityId
  readonly occurredAt: UtcTimestamp
  readonly candidates: readonly PatientDuplicateCandidateRecord[]
}): CreateAuditEventInput {
  return {
    id,
    installationId,
    userId,
    action: duplicateOverrideAction,
    entityType: patientEntityType,
    entityId: patientId,
    occurredAt,
    metadata: Object.freeze({
      candidate_count: candidates.length,
      reason_codes: Object.freeze(
        Array.from(new Set(candidates.flatMap((candidate) => candidate.reasonCodes))).sort()
      )
    })
  }
}

function requireActor(actor: PatientRegistryActor): void {
  if (actor.user.id.length === 0) {
    throw new PatientRegistryStateIntegrityError()
  }
}

function toPatientRegistryBoundaryError(error: unknown): Error {
  if (isPatientRegistryError(error)) {
    return rebuildPatientRegistryError(error)
  }

  if (error instanceof RepositoryValidationError) {
    return new PatientRegistryValidationError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new PatientRegistryStateIntegrityError(error.errorType)
  }

  if (error instanceof DatabaseTransactionExecutionError) {
    return mapTransactionExecutionError(error)
  }

  return new PatientRegistryCreationError(getPatientRegistryErrorType(error))
}

function mapTransactionExecutionError(error: DatabaseTransactionExecutionError): Error {
  if (
    error.errorType === 'PatientRegistryValidationError' ||
    error.errorType === 'RepositoryValidationError'
  ) {
    return new PatientRegistryValidationError(error.errorType)
  }

  if (
    error.errorType === 'PatientRegistryStateIntegrityError' ||
    error.errorType === 'RepositoryDataIntegrityError'
  ) {
    return new PatientRegistryStateIntegrityError(error.errorType)
  }

  return new PatientRegistryCreationError(error.errorType)
}
