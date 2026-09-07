import { z } from 'zod'

import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { SyncResourceType } from './sync-transport-types'

export type ContractUuid = string & { readonly __brand: 'ContractUuid' }

const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
const utcTimestamp = z
  .string()
  .refine(
    (value) => value.endsWith('Z') && Number.isFinite(Date.parse(value)),
    'Expected a UTC timestamp.'
  )
const resourceType = z.enum([
  'PATIENT',
  'SCREENING_SESSION',
  'SCREENING_ENCOUNTER',
  'VITALS',
  'LIFESTYLE'
])
const medicalId = z
  .string()
  .regex(
    /^CHS-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/
  )
const nullableUuid = uuid.nullable()

const recordError = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    path: z
      .string()
      .max(240)
      .regex(/^(?:\/.*)?$/),
    retryable: z.boolean()
  })
  .strict()

const outcomeSchema = z
  .object({
    recordId: uuid,
    resourceType,
    localResourceId: uuid,
    sourceRevision: z.number().int().min(1).safe(),
    status: z.enum(['ACCEPTED', 'UNCHANGED', 'REVIEW_REQUIRED', 'REJECTED', 'RETRY']),
    canonicalResourceId: nullableUuid,
    centralPersonId: nullableUuid,
    chsMedicalId: medicalId.nullable(),
    medicalIdStatus: z.enum(['ASSIGNED', 'CONFIRMED', 'PENDING_REVIEW']).nullable(),
    errors: z.array(recordError).max(20)
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.resourceType !== 'PATIENT' &&
      (value.centralPersonId !== null ||
        value.chsMedicalId !== null ||
        value.medicalIdStatus !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Identity fields are patient-only.' })
    }
    if (
      value.resourceType === 'PATIENT' &&
      value.medicalIdStatus === null &&
      (value.centralPersonId !== null || value.chsMedicalId !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid unclassified identity state.' })
    }
    if (
      value.medicalIdStatus === 'PENDING_REVIEW' &&
      (value.status !== 'REVIEW_REQUIRED' ||
        value.centralPersonId !== null ||
        value.chsMedicalId !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid pending-review identity state.' })
    }
    if (
      (value.medicalIdStatus === 'ASSIGNED' || value.medicalIdStatus === 'CONFIRMED') &&
      (!['ACCEPTED', 'UNCHANGED'].includes(value.status) ||
        value.centralPersonId === null ||
        value.chsMedicalId === null)
    ) {
      context.addIssue({ code: 'custom', message: 'Invalid confirmed identity state.' })
    }
  })

const batchResponseSchema = z
  .object({
    contractVersion: z.literal('1.0'),
    batchId: uuid,
    batchStatus: z.enum(['ACCEPTED', 'PARTIAL', 'REJECTED']),
    receivedAt: utcTimestamp,
    completedAt: utcTimestamp,
    outcomes: z.array(outcomeSchema).min(1).max(100)
  })
  .strict()

const identityDeliverySchema = z
  .object({
    resolutionReference: uuid,
    localPatientReference: uuid,
    localPatientCode: z.string().regex(/^PT-[0-9]{6}$/),
    sourceRevision: z.number().int().min(1).safe(),
    centralPersonId: uuid,
    chsMedicalId: z
      .string()
      .regex(
        /^CHS-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/
      ),
    resolvedAt: utcTimestamp
  })
  .strict()

const identityPullResponseSchema = z
  .object({
    contractVersion: z.literal('1.0'),
    deliveries: z.array(identityDeliverySchema).max(100),
    hasMore: z.boolean(),
    serverTime: utcTimestamp
  })
  .strict()

const acknowledgmentResponseSchema = z
  .object({
    contractVersion: z.literal('1.0'),
    acknowledgmentId: uuid,
    resolutionReference: uuid,
    status: z.literal('ACKNOWLEDGED'),
    acknowledgedAt: utcTimestamp,
    replayed: z.boolean()
  })
  .strict()

const problemSchema = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    status: z.number().int(),
    code: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/),
    requestId: z.string().optional()
  })
  .passthrough()

export type SyncRecordOutcome = Readonly<{
  recordId: EntityId
  resourceType: SyncResourceType
  localResourceId: EntityId
  sourceRevision: number
  status: 'ACCEPTED' | 'UNCHANGED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'RETRY'
  canonicalResourceId: ContractUuid | null
  centralPersonId: ContractUuid | null
  chsMedicalId: string | null
  medicalIdStatus: 'ASSIGNED' | 'CONFIRMED' | 'PENDING_REVIEW' | null
  errors: readonly Readonly<{ code: string; path: string; retryable: boolean }>[]
}>

export type SyncBatchResponse = Readonly<{
  contractVersion: '1.0'
  batchId: EntityId
  batchStatus: 'ACCEPTED' | 'PARTIAL' | 'REJECTED'
  receivedAt: UtcTimestamp
  completedAt: UtcTimestamp
  outcomes: readonly SyncRecordOutcome[]
}>

export type IdentityResolutionDelivery = Readonly<{
  resolutionReference: ContractUuid
  localPatientReference: EntityId
  localPatientCode: string
  sourceRevision: number
  centralPersonId: ContractUuid
  chsMedicalId: string
  resolvedAt: UtcTimestamp
}>

export type IdentityResolutionPullResponse = Readonly<{
  contractVersion: '1.0'
  deliveries: readonly IdentityResolutionDelivery[]
  hasMore: boolean
  serverTime: UtcTimestamp
}>

export type IdentityResolutionAcknowledgmentResponse = Readonly<{
  contractVersion: '1.0'
  acknowledgmentId: EntityId
  resolutionReference: ContractUuid
  status: 'ACKNOWLEDGED'
  acknowledgedAt: UtcTimestamp
  replayed: boolean
}>

export type SyncProblem = Readonly<{ status: number; code: string }>

export function parseSyncBatchResponse(
  bodyText: string,
  expectedRequestJson: string
): SyncBatchResponse {
  const parsed = batchResponseSchema.parse(parseJson(bodyText))
  const expected = parseExpectedRequest(expectedRequestJson)
  if (parsed.batchId !== expected.batchId || parsed.completedAt < parsed.receivedAt) {
    throw new Error('SYNC_RESPONSE_MISMATCH')
  }
  if (new Set(parsed.outcomes.map((outcome) => outcome.recordId)).size !== parsed.outcomes.length) {
    throw new Error('SYNC_RESPONSE_MISMATCH')
  }
  if (parsed.outcomes.length !== expected.records.length) throw new Error('SYNC_RESPONSE_MISMATCH')

  const expectedById = new Map(expected.records.map((record) => [record.recordId, record]))
  for (const outcome of parsed.outcomes) {
    const record = expectedById.get(outcome.recordId)
    if (
      record === undefined ||
      outcome.resourceType !== record.resourceType ||
      outcome.localResourceId !== record.localResourceId ||
      outcome.sourceRevision !== record.sourceRevision
    ) {
      throw new Error('SYNC_RESPONSE_MISMATCH')
    }
  }
  return parsed as unknown as SyncBatchResponse
}

export function parseSyncProblem(bodyText: string): SyncProblem | null {
  try {
    return problemSchema.parse(parseJson(bodyText))
  } catch {
    return null
  }
}

export function parseIdentityResolutionPullResponse(
  bodyText: string
): IdentityResolutionPullResponse {
  const parsed = identityPullResponseSchema.parse(parseJson(bodyText))
  if (
    new Set(parsed.deliveries.map((delivery) => delivery.resolutionReference)).size !==
      parsed.deliveries.length ||
    new Set(parsed.deliveries.map((delivery) => delivery.localPatientReference)).size !==
      parsed.deliveries.length ||
    parsed.deliveries.some(
      (delivery) => Date.parse(delivery.resolvedAt) > Date.parse(parsed.serverTime)
    )
  ) {
    throw new Error('IDENTITY_DELIVERY_DUPLICATE')
  }
  return parsed as unknown as IdentityResolutionPullResponse
}

export function parseIdentityResolutionAcknowledgmentResponse(
  bodyText: string,
  acknowledgmentId: EntityId,
  resolutionReference: ContractUuid,
  appliedAt: UtcTimestamp
): IdentityResolutionAcknowledgmentResponse {
  const parsed = acknowledgmentResponseSchema.parse(parseJson(bodyText))
  if (
    parsed.acknowledgmentId !== acknowledgmentId ||
    parsed.resolutionReference !== resolutionReference ||
    Date.parse(parsed.acknowledgedAt) < Date.parse(appliedAt)
  ) {
    throw new Error('IDENTITY_ACKNOWLEDGMENT_MISMATCH')
  }
  return parsed as IdentityResolutionAcknowledgmentResponse
}

export function parseContractUuid(value: unknown): ContractUuid {
  return uuid.parse(value) as ContractUuid
}

function parseJson(value: string): unknown {
  if (typeof value !== 'string' || value.length === 0) throw new Error('INVALID_JSON_RESPONSE')
  return JSON.parse(value) as unknown
}

function parseExpectedRequest(value: string): Readonly<{
  batchId: string
  records: readonly Readonly<{
    recordId: string
    resourceType: string
    localResourceId: string
    sourceRevision: number
  }>[]
}> {
  const schema = z
    .object({
      batchId: uuid,
      records: z.array(
        z.object({
          recordId: uuid,
          resourceType,
          localResourceId: uuid,
          sourceRevision: z.number().int().min(1).safe()
        })
      )
    })
    .passthrough()
  return schema.parse(parseJson(value))
}
