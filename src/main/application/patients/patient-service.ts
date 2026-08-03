import { randomUUID } from 'node:crypto'

import {
  normalizeDuplicateReasonCodes,
  normalizePatientEditableFields,
  parseAuditActionCode,
  parseAuditEntityType,
  parsePatientEntityId,
  parsePatientRowVersion,
  RepositoryValidationError,
  type NormalizedPatientFields,
  type PatientDetailRecord,
  type PatientDuplicateCandidateRecord,
  type PatientDuplicatePairRecord,
  type PatientSummaryRecord
} from '@main/database'
import {
  createIpcSuccess,
  createPatientFailure,
  type PatientCreateRequest,
  type PatientCreateResult,
  type PatientFindDuplicatesRequest,
  type PatientFindDuplicatesResult,
  type PatientGetRequest,
  type PatientGetResult,
  type PatientListRecentRequest,
  type PatientListRecentResult,
  type PatientMarkNotDuplicateRequest,
  type PatientMarkNotDuplicateResult,
  type PatientSearchRequest,
  type PatientSearchResult,
  type PatientUpdateRequest,
  type PatientUpdateResult,
  type PublicPatientDetail,
  type PublicPatientDuplicateCandidate,
  type PublicPatientDuplicatePair,
  type PublicPatientSummary
} from '@shared/ipc'

import type {
  PatientRegistryService,
  PatientRegistryServiceDependencies,
  PatientServiceActor
} from './patient-service-types'

const patientCreatedAction = parseAuditActionCode('PATIENT_CREATED')
const patientUpdatedAction = parseAuditActionCode('PATIENT_UPDATED')
const duplicateReviewedAction = parseAuditActionCode('DUPLICATE_REVIEWED')
const patientEntityType = parseAuditEntityType('PATIENT')
const duplicateReviewEntityType = parseAuditEntityType('PATIENT_DUPLICATE_REVIEW')

interface DuplicateReviewTokenState {
  readonly signature: string
  readonly candidateIds: readonly string[]
}

export function createPatientRegistryService({
  installationRepository,
  patientRepository,
  auditEventRepository,
  transactionExecutor
}: PatientRegistryServiceDependencies): PatientRegistryService {
  const duplicateReviewTokens = new Map<string, DuplicateReviewTokenState>()

  return Object.freeze({
    search(request: PatientSearchRequest): PatientSearchResult {
      try {
        const result = patientRepository.search({
          query: request.query,
          page: request.page,
          pageSize: request.pageSize
        })

        return createIpcSuccess({
          items: result.items.map(toPublicSummary),
          page: result.page,
          pageSize: result.pageSize,
          total: result.total
        }) as PatientSearchResult
      } catch (error) {
        return toPatientFailure(error) as PatientSearchResult
      }
    },

    get(request: PatientGetRequest, actor: PatientServiceActor): PatientGetResult {
      try {
        const patientId = parsePatientEntityId(request.patientId)
        const patient = transactionExecutor.run((context) => {
          const detail = patientRepository.getById(patientId)

          if (detail === null) {
            throw new RepositoryValidationError()
          }

          patientRepository.recordRecentAccess(
            context.connection,
            actor.userId,
            patientId,
            context.nowUtc()
          )

          return detail
        })

        return createIpcSuccess(toPublicDetail(patient)) as PatientGetResult
      } catch (error) {
        return toPatientFailure(error) as PatientGetResult
      }
    },

    create(request: PatientCreateRequest, actor: PatientServiceActor): PatientCreateResult {
      try {
        const now = new Date().toISOString().slice(0, 10)
        const fields = normalizePatientEditableFields(request, { today: now })
        const candidates = patientRepository.findDuplicateCandidates(fields, {
          excludePatientId: null,
          limit: 10
        })
        const signature = createDuplicateSignature(fields, candidates)

        if (!isDuplicateReviewAccepted(request, signature, candidates)) {
          const token = randomUUID()
          duplicateReviewTokens.set(token, {
            signature,
            candidateIds: candidates.map((candidate) => candidate.patient.id)
          })

          if (candidates.length > 0) {
            return createIpcSuccess({
              status: 'DUPLICATE_REVIEW_REQUIRED',
              candidates: candidates.map(toPublicCandidate),
              duplicateReviewToken: token
            }) as PatientCreateResult
          }
        }

        if (request.duplicateReviewToken !== null) {
          duplicateReviewTokens.delete(request.duplicateReviewToken)
        }

        const created = transactionExecutor.run((context) => {
          const installation = installationRepository.get()

          if (installation === null) {
            throw new RepositoryValidationError()
          }

          const occurredAt = context.nowUtc()
          const patientId = context.newEntityId()
          const patientCode = patientRepository.nextPatientCode(context.connection, occurredAt)
          const patient = patientRepository.insert(context.connection, {
            id: patientId,
            patientCode,
            fields,
            createdBy: actor.userId,
            createdAt: occurredAt
          })

          auditEventRepository.insert(context.connection, {
            id: context.newEntityId(),
            installationId: installation.id,
            userId: actor.userId,
            action: patientCreatedAction,
            entityType: patientEntityType,
            entityId: patientId,
            occurredAt,
            metadata: Object.freeze({
              row_version: patient.rowVersion,
              duplicate_reviewed: candidates.length > 0
            })
          })
          patientRepository.insertOutbox(context.connection, {
            id: context.newEntityId(),
            aggregateId: patientId,
            operation: 'PATIENT_CREATED',
            createdAt: occurredAt,
            payload: Object.freeze({
              patient_id: patientId,
              patient_code: patient.patientCode,
              row_version: patient.rowVersion
            })
          })
          patientRepository.recordRecentAccess(
            context.connection,
            actor.userId,
            patientId,
            occurredAt
          )

          return patient
        })

        return createIpcSuccess({
          status: 'CREATED',
          patient: toPublicDetail(created)
        }) as PatientCreateResult
      } catch (error) {
        return toPatientFailure(error) as PatientCreateResult
      }
    },

    update(request: PatientUpdateRequest, actor: PatientServiceActor): PatientUpdateResult {
      try {
        const expectedRowVersion = parsePatientRowVersion(request.expectedRowVersion)
        const patientId = parsePatientEntityId(request.patientId)
        const now = new Date().toISOString().slice(0, 10)
        const fields = normalizePatientEditableFields(request.patch, { today: now })
        const result = transactionExecutor.run((context) => {
          const installation = installationRepository.get()

          if (installation === null) {
            throw new RepositoryValidationError()
          }

          const occurredAt = context.nowUtc()
          const updateResult = patientRepository.update(context.connection, {
            id: patientId,
            expectedRowVersion,
            fields,
            updatedBy: actor.userId,
            updatedAt: occurredAt
          })

          if (updateResult.status !== 'UPDATED') {
            return updateResult
          }

          auditEventRepository.insert(context.connection, {
            id: context.newEntityId(),
            installationId: installation.id,
            userId: actor.userId,
            action: patientUpdatedAction,
            entityType: patientEntityType,
            entityId: patientId,
            occurredAt,
            metadata: Object.freeze({
              previous_row_version: expectedRowVersion,
              row_version: updateResult.patient.rowVersion
            })
          })
          patientRepository.insertOutbox(context.connection, {
            id: context.newEntityId(),
            aggregateId: patientId,
            operation: 'PATIENT_UPDATED',
            createdAt: occurredAt,
            payload: Object.freeze({
              patient_id: patientId,
              row_version: updateResult.patient.rowVersion
            })
          })

          return updateResult
        })

        if (result.status === 'NOT_FOUND') {
          return createPatientFailure('VALIDATION_FAILED') as PatientUpdateResult
        }

        if (result.status === 'PATIENT_VERSION_CONFLICT') {
          return createIpcSuccess({
            status: 'PATIENT_VERSION_CONFLICT',
            patient: toPublicDetail(result.patient)
          }) as PatientUpdateResult
        }

        return createIpcSuccess({
          status: 'UPDATED',
          patient: toPublicDetail(result.patient)
        }) as PatientUpdateResult
      } catch (error) {
        return toPatientFailure(error) as PatientUpdateResult
      }
    },

    listRecent(
      request: PatientListRecentRequest,
      actor: PatientServiceActor
    ): PatientListRecentResult {
      try {
        return createIpcSuccess(
          patientRepository.listRecent(actor.userId, request.limit).map(toPublicSummary)
        ) as PatientListRecentResult
      } catch (error) {
        return toPatientFailure(error) as PatientListRecentResult
      }
    },

    findDuplicates(request: PatientFindDuplicatesRequest): PatientFindDuplicatesResult {
      try {
        if (request.identity === null) {
          const pairs =
            request.patientId === null
              ? patientRepository.listPossibleDuplicatePairs(request.limit)
              : patientRepository
                  .listPossibleDuplicatePairs(request.limit)
                  .filter(
                    (pair) =>
                      pair.first.id === request.patientId || pair.second.id === request.patientId
                  )

          return createIpcSuccess({
            candidates: [],
            pairs: pairs.map(toPublicPair)
          }) as PatientFindDuplicatesResult
        }

        const today = new Date().toISOString().slice(0, 10)
        const fields = normalizePatientEditableFields(request.identity, { today })
        const candidates = patientRepository.findDuplicateCandidates(fields, {
          excludePatientId:
            request.patientId === null ? null : parsePatientEntityId(request.patientId),
          limit: request.limit
        })

        return createIpcSuccess({
          candidates: candidates.map(toPublicCandidate),
          pairs: []
        }) as PatientFindDuplicatesResult
      } catch (error) {
        return toPatientFailure(error) as PatientFindDuplicatesResult
      }
    },

    markNotDuplicate(
      request: PatientMarkNotDuplicateRequest,
      actor: PatientServiceActor
    ): PatientMarkNotDuplicateResult {
      try {
        const patientIdA = parsePatientEntityId(request.patientIdA)
        const patientIdB = parsePatientEntityId(request.patientIdB)
        const reasonCodes = normalizeDuplicateReasonCodes(request.reasonCodes)
        const result = transactionExecutor.run((context) => {
          const installation = installationRepository.get()
          const first = patientRepository.getById(patientIdA)
          const second = patientRepository.getById(patientIdB)

          if (
            installation === null ||
            first === null ||
            second === null ||
            first.id === second.id
          ) {
            throw new RepositoryValidationError()
          }

          const ordered = orderPair(first, second)
          const pairKey = `${ordered.first.id}:${ordered.second.id}`
          const reviewedAt = context.nowUtc()

          patientRepository.markNotDuplicate(context.connection, {
            id: context.newEntityId(),
            patientIdA: ordered.first.id,
            patientIdB: ordered.second.id,
            pairKey,
            patientARowVersion: ordered.first.rowVersion,
            patientBRowVersion: ordered.second.rowVersion,
            patientAIdentityKey: createPatientIdentityKey(ordered.first),
            patientBIdentityKey: createPatientIdentityKey(ordered.second),
            reasonCodes,
            reviewedBy: actor.userId,
            reviewedAt
          })
          auditEventRepository.insert(context.connection, {
            id: context.newEntityId(),
            installationId: installation.id,
            userId: actor.userId,
            action: duplicateReviewedAction,
            entityType: duplicateReviewEntityType,
            entityId: null,
            occurredAt: reviewedAt,
            metadata: Object.freeze({
              pair_key: pairKey,
              status: 'NOT_DUPLICATE',
              reason_codes: reasonCodes
            })
          })
          patientRepository.insertOutbox(context.connection, {
            id: context.newEntityId(),
            aggregateId: ordered.first.id,
            operation: 'DUPLICATE_REVIEWED',
            createdAt: reviewedAt,
            payload: Object.freeze({
              pair_key: pairKey,
              patient_id_a: ordered.first.id,
              patient_id_b: ordered.second.id,
              status: 'NOT_DUPLICATE'
            })
          })

          return { pairKey, reviewedAt }
        })

        return createIpcSuccess({
          status: 'MARKED_NOT_DUPLICATE',
          pairKey: result.pairKey,
          reviewedAt: result.reviewedAt
        }) as PatientMarkNotDuplicateResult
      } catch (error) {
        return toPatientFailure(error) as PatientMarkNotDuplicateResult
      }
    }
  })

  function isDuplicateReviewAccepted(
    request: PatientCreateRequest,
    signature: string,
    candidates: readonly PatientDuplicateCandidateRecord[]
  ): boolean {
    if (candidates.length === 0) {
      return true
    }

    if (request.duplicateReviewToken === null) {
      return false
    }

    const tokenState = duplicateReviewTokens.get(request.duplicateReviewToken)

    return (
      tokenState !== undefined &&
      tokenState.signature === signature &&
      arraysEqual(
        tokenState.candidateIds,
        candidates.map((candidate) => candidate.patient.id)
      )
    )
  }
}

function toPublicSummary(record: PatientSummaryRecord): PublicPatientSummary {
  return {
    id: record.id,
    patientCode: record.patientCode,
    displayName: record.displayName,
    givenName: record.givenName,
    familyName: record.familyName,
    otherNames: record.otherNames,
    dateOfBirth: record.dateOfBirth,
    approximateAgeYears: record.approximateAgeYears,
    ageAsOfDate: record.ageAsOfDate,
    sex: record.sex,
    village: record.village,
    quarter: record.quarter,
    phone: record.phone,
    status: record.status,
    rowVersion: record.rowVersion,
    updatedAt: record.updatedAt
  }
}

function toPublicDetail(record: PatientDetailRecord): PublicPatientDetail {
  return {
    ...toPublicSummary(record),
    alternateContactName: record.alternateContactName,
    alternateContactPhone: record.alternateContactPhone,
    residenceNotes: record.residenceNotes,
    acknowledgment: {
      status: record.acknowledgmentStatus,
      recordedAt: record.acknowledgmentRecordedAt,
      recordedByDisplayName: record.acknowledgmentRecordedByDisplayName
    },
    createdAt: record.createdAt,
    createdByDisplayName: record.createdByDisplayName,
    updatedByDisplayName: record.updatedByDisplayName,
    clinicalStatus: 'NOT_AVAILABLE'
  }
}

function toPublicCandidate(
  record: PatientDuplicateCandidateRecord
): PublicPatientDuplicateCandidate {
  return {
    patient: toPublicSummary(record.patient),
    matchedOn: [...record.matchedOn],
    score: record.score,
    status: 'POSSIBLE_DUPLICATE'
  }
}

function toPublicPair(record: PatientDuplicatePairRecord): PublicPatientDuplicatePair {
  return {
    pairKey: record.pairKey,
    first: toPublicSummary(record.first),
    second: toPublicSummary(record.second),
    matchedOn: [...record.matchedOn],
    score: record.score,
    status: 'POSSIBLE_DUPLICATE'
  }
}

function createDuplicateSignature(
  fields: NormalizedPatientFields,
  candidates: readonly PatientDuplicateCandidateRecord[]
): string {
  return JSON.stringify({
    fields: {
      name: fields.nameNormalized,
      dateOfBirth: fields.dateOfBirth,
      approximateAgeYears: fields.approximateAgeYears,
      ageAsOfDate: fields.ageAsOfDate,
      sex: fields.sex,
      village: fields.village,
      phone: fields.phoneNormalized
    },
    candidates: candidates.map((candidate) => [
      candidate.patient.id,
      candidate.patient.rowVersion,
      candidate.matchedOn
    ])
  })
}

function orderPair(
  first: PatientDetailRecord,
  second: PatientDetailRecord
): { readonly first: PatientDetailRecord; readonly second: PatientDetailRecord } {
  return first.id < second.id ? { first, second } : { first: second, second: first }
}

function createPatientIdentityKey(patient: PatientSummaryRecord): string {
  return [
    patient.displayName.toLowerCase(),
    patient.dateOfBirth ?? '',
    patient.approximateAgeYears?.toString() ?? '',
    patient.ageAsOfDate ?? '',
    patient.sex,
    normalizePhoneDigitsForIdentity(patient.phone),
    patient.village?.toLowerCase() ?? '',
    patient.quarter?.toLowerCase() ?? ''
  ].join('|')
}

function normalizePhoneDigitsForIdentity(phone: string | null): string {
  return phone?.replace(/\D/gu, '') ?? ''
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function toPatientFailure(
  error: unknown
):
  | PatientSearchResult
  | PatientGetResult
  | PatientCreateResult
  | PatientUpdateResult
  | PatientListRecentResult
  | PatientFindDuplicatesResult
  | PatientMarkNotDuplicateResult {
  if (error instanceof RepositoryValidationError) {
    return createPatientFailure('VALIDATION_FAILED')
  }

  return createPatientFailure('INTERNAL_ERROR')
}
