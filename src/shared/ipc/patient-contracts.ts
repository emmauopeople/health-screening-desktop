import { z } from 'zod'

import { createIpcSuccessResultSchema } from './result'

const unsafeTransportValue = Symbol('UnsafePatientIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const patientCodePattern = /^PT-\d{6}$/u

export const patientSexSchema = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'])
export const patientStatusSchema = z.enum(['ACTIVE', 'INACTIVE'])
export const patientAcknowledgmentStatusSchema = z.enum([
  'ACKNOWLEDGED',
  'DECLINED',
  'NOT_REQUESTED'
])
export const patientDuplicateReviewStatusSchema = z.enum(['POSSIBLE_DUPLICATE', 'NOT_DUPLICATE'])

export type PatientSex = z.infer<typeof patientSexSchema>
export type PatientStatus = z.infer<typeof patientStatusSchema>
export type PatientAcknowledgmentStatus = z.infer<typeof patientAcknowledgmentStatusSchema>
export type PatientDuplicateReviewStatus = z.infer<typeof patientDuplicateReviewStatusSchema>

export const patientPageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)])
export const patientListLimitSchema = z.number().int().min(1).max(25).safe()
export const patientUuidSchema = z.string().uuid()
export const patientUtcTimestampSchema = z.string().refine(isUtcTimestamp)
export const patientLocalDateSchema = z.string().refine(isValidLocalDate)
export const patientCodeSchema = z.string().regex(patientCodePattern)
export const patientOptionalTextSchema = z.string().max(240).nullable()

export const publicPatientSummarySchema = z
  .object({
    id: patientUuidSchema,
    patientCode: patientCodeSchema,
    displayName: z.string().min(1).max(180),
    givenName: patientOptionalTextSchema,
    familyName: patientOptionalTextSchema,
    otherNames: patientOptionalTextSchema,
    dateOfBirth: patientLocalDateSchema.nullable(),
    approximateAgeYears: z.number().int().min(0).max(120).safe().nullable(),
    ageAsOfDate: patientLocalDateSchema.nullable(),
    sex: patientSexSchema,
    village: patientOptionalTextSchema,
    quarter: patientOptionalTextSchema,
    phone: patientOptionalTextSchema,
    status: patientStatusSchema,
    rowVersion: z.number().int().min(1).safe(),
    updatedAt: patientUtcTimestampSchema
  })
  .strict()

export const publicPatientAcknowledgmentSchema = z
  .object({
    status: patientAcknowledgmentStatusSchema,
    recordedAt: patientUtcTimestampSchema.nullable(),
    recordedByDisplayName: z.string().min(1).max(120).nullable()
  })
  .strict()

export const publicPatientDetailSchema = publicPatientSummarySchema
  .extend({
    alternateContactName: patientOptionalTextSchema,
    alternateContactPhone: patientOptionalTextSchema,
    residenceNotes: z.string().max(500).nullable(),
    acknowledgment: publicPatientAcknowledgmentSchema,
    createdAt: patientUtcTimestampSchema,
    createdByDisplayName: z.string().min(1).max(120),
    updatedByDisplayName: z.string().min(1).max(120),
    clinicalStatus: z.literal('NOT_AVAILABLE')
  })
  .strict()

export const patientEditableFieldsSchema = z
  .object({
    givenName: z.string().max(120).nullable(),
    familyName: z.string().max(120).nullable(),
    otherNames: z.string().max(120).nullable(),
    dateOfBirth: patientLocalDateSchema.nullable(),
    approximateAgeYears: z.number().int().min(0).max(120).safe().nullable(),
    ageAsOfDate: patientLocalDateSchema.nullable(),
    sex: patientSexSchema,
    village: z.string().max(120).nullable(),
    quarter: z.string().max(120).nullable(),
    phone: z.string().max(80).nullable(),
    alternateContactName: z.string().max(120).nullable(),
    alternateContactPhone: z.string().max(80).nullable(),
    residenceNotes: z.string().max(500).nullable(),
    status: patientStatusSchema,
    acknowledgmentStatus: patientAcknowledgmentStatusSchema
  })
  .strict()

export const patientSearchRequestSchema = exactObject({
  query: z.string().max(160),
  page: z.number().int().min(1).max(10000).safe(),
  pageSize: patientPageSizeSchema
})

export const patientGetRequestSchema = exactObject({
  patientId: patientUuidSchema
})

export const patientCreateRequestSchema = withSafeTransportPreprocess(
  patientEditableFieldsSchema
    .extend({
      duplicateReviewToken: z.string().min(16).max(256).nullable()
    })
    .strict()
)

export const patientUpdateRequestSchema = exactObject({
  patientId: patientUuidSchema,
  expectedRowVersion: z.number().int().min(1).safe(),
  patch: patientEditableFieldsSchema
})

export const patientListRecentRequestSchema = exactObject({
  limit: patientListLimitSchema
})

export const patientFindDuplicatesRequestSchema = exactObject({
  identity: patientEditableFieldsSchema.nullable(),
  patientId: patientUuidSchema.nullable(),
  limit: patientListLimitSchema
})

export const patientMarkNotDuplicateRequestSchema = exactObject({
  patientIdA: patientUuidSchema,
  patientIdB: patientUuidSchema,
  reasonCodes: z.array(z.string().min(1).max(64)).max(12)
})

export const publicPatientDuplicateCandidateSchema = z
  .object({
    patient: publicPatientSummarySchema,
    matchedOn: z.array(z.string().min(1).max(48)).min(1).max(8),
    score: z.number().int().min(1).max(100).safe(),
    status: patientDuplicateReviewStatusSchema
  })
  .strict()

export const publicPatientDuplicatePairSchema = z
  .object({
    pairKey: z.string().min(1).max(160),
    first: publicPatientSummarySchema,
    second: publicPatientSummarySchema,
    matchedOn: z.array(z.string().min(1).max(48)).min(1).max(8),
    score: z.number().int().min(1).max(100).safe(),
    status: z.literal('POSSIBLE_DUPLICATE')
  })
  .strict()

export const patientSearchSuccessDataSchema = z
  .object({
    items: z.array(publicPatientSummarySchema),
    page: z.number().int().min(1).safe(),
    pageSize: patientPageSizeSchema,
    total: z.number().int().min(0).safe()
  })
  .strict()

export const patientCreateSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('DUPLICATE_REVIEW_REQUIRED'),
      candidates: z.array(publicPatientDuplicateCandidateSchema).min(1),
      duplicateReviewToken: z.string().min(16).max(256)
    })
    .strict(),
  z
    .object({
      status: z.literal('CREATED'),
      patient: publicPatientDetailSchema
    })
    .strict()
])

export const patientUpdateSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('UPDATED'),
      patient: publicPatientDetailSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('PATIENT_VERSION_CONFLICT'),
      patient: publicPatientDetailSchema
    })
    .strict()
])

export const patientFindDuplicatesSuccessDataSchema = z
  .object({
    candidates: z.array(publicPatientDuplicateCandidateSchema),
    pairs: z.array(publicPatientDuplicatePairSchema)
  })
  .strict()

export const patientMarkNotDuplicateSuccessDataSchema = z
  .object({
    status: z.literal('MARKED_NOT_DUPLICATE'),
    pairKey: z.string().min(1).max(160),
    reviewedAt: patientUtcTimestampSchema
  })
  .strict()

export const patientSafeErrorMessages = {
  VALIDATION_FAILED: 'The request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.',
  AUTH_UNAUTHENTICATED: 'Sign in is required.',
  AUTH_LOCKED: 'The local session is locked.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'A required password change must be completed.',
  AUTHORIZATION_FAILED: 'The active session is not authorized for this operation.'
} as const

export const patientErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export type PatientErrorCode = z.infer<typeof patientErrorCodeSchema>

export const patientFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createPatientErrorSchema('VALIDATION_FAILED'),
      createPatientErrorSchema('IPC_FORBIDDEN'),
      createPatientErrorSchema('IPC_UNAVAILABLE'),
      createPatientErrorSchema('INTERNAL_ERROR'),
      createPatientErrorSchema('AUTH_UNAUTHENTICATED'),
      createPatientErrorSchema('AUTH_LOCKED'),
      createPatientErrorSchema('AUTH_PASSWORD_CHANGE_REQUIRED'),
      createPatientErrorSchema('AUTHORIZATION_FAILED')
    ])
  })
  .strict()

export const patientSearchResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientSearchSuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientGetResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(publicPatientDetailSchema),
    patientFailureSchema
  ])
)
export const patientCreateResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientCreateSuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientUpdateResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientUpdateSuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientListRecentResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(z.array(publicPatientSummarySchema)),
    patientFailureSchema
  ])
)
export const patientFindDuplicatesResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientFindDuplicatesSuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientMarkNotDuplicateResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientMarkNotDuplicateSuccessDataSchema),
    patientFailureSchema
  ])
)

export type PublicPatientSummary = z.infer<typeof publicPatientSummarySchema>
export type PublicPatientDetail = z.infer<typeof publicPatientDetailSchema>
export type PublicPatientDuplicateCandidate = z.infer<typeof publicPatientDuplicateCandidateSchema>
export type PublicPatientDuplicatePair = z.infer<typeof publicPatientDuplicatePairSchema>
export type PatientEditableFields = z.infer<typeof patientEditableFieldsSchema>
export type PatientSearchRequest = z.infer<typeof patientSearchRequestSchema>
export type PatientGetRequest = z.infer<typeof patientGetRequestSchema>
export type PatientCreateRequest = z.infer<typeof patientCreateRequestSchema>
export type PatientUpdateRequest = z.infer<typeof patientUpdateRequestSchema>
export type PatientListRecentRequest = z.infer<typeof patientListRecentRequestSchema>
export type PatientFindDuplicatesRequest = z.infer<typeof patientFindDuplicatesRequestSchema>
export type PatientMarkNotDuplicateRequest = z.infer<typeof patientMarkNotDuplicateRequestSchema>
export type PatientSearchResult = z.infer<typeof patientSearchResultSchema>
export type PatientGetResult = z.infer<typeof patientGetResultSchema>
export type PatientCreateResult = z.infer<typeof patientCreateResultSchema>
export type PatientUpdateResult = z.infer<typeof patientUpdateResultSchema>
export type PatientListRecentResult = z.infer<typeof patientListRecentResultSchema>
export type PatientFindDuplicatesResult = z.infer<typeof patientFindDuplicatesResultSchema>
export type PatientMarkNotDuplicateResult = z.infer<typeof patientMarkNotDuplicateResultSchema>

export function createPatientFailure<TCode extends PatientErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof patientSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: patientSafeErrorMessages[code]
    }
  }
}

function createPatientErrorSchema<TCode extends PatientErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof patientSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(patientSafeErrorMessages[code])
    })
    .strict()
}

function exactObject<TShape extends z.ZodRawShape>(
  shape: TShape
): z.ZodType<z.infer<z.ZodObject<TShape>>> {
  return withSafeTransportPreprocess(z.object(shape).strict())
}

function withSafeTransportPreprocess<TSchema extends z.ZodType>(
  schema: TSchema
): z.ZodPreprocess<TSchema> {
  return z.preprocess((value) => {
    return copySafeTransportValue(value)
  }, schema)
}

function copySafeTransportValue(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null) {
    return null
  }

  if (typeof value !== 'object') {
    return isRejectedPrimitive(value) ? unsafeTransportValue : value
  }

  if (active.has(value)) {
    return unsafeTransportValue
  }

  active.add(value)

  if (Array.isArray(value)) {
    const items: unknown[] = []

    for (const item of value) {
      const copied = copySafeTransportValue(item, active)

      if (copied === unsafeTransportValue) {
        active.delete(value)
        return unsafeTransportValue
      }

      items.push(copied)
    }

    active.delete(value)
    return items
  }

  let prototype: object | null
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    active.delete(value)
    return unsafeTransportValue
  }

  if (prototype !== Object.prototype) {
    active.delete(value)
    return unsafeTransportValue
  }

  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    active.delete(value)
    return unsafeTransportValue
  }

  const copy: Record<string, unknown> = {}

  for (const key of Object.getOwnPropertyNames(descriptors)) {
    const descriptor = descriptors[key]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      active.delete(value)
      return unsafeTransportValue
    }

    const copiedValue = copySafeTransportValue(descriptor.value, active)

    if (copiedValue === unsafeTransportValue) {
      active.delete(value)
      return unsafeTransportValue
    }

    Object.defineProperty(copy, key, {
      value: copiedValue,
      enumerable: true,
      writable: true,
      configurable: true
    })
  }

  active.delete(value)
  return copy
}

function isRejectedPrimitive(value: unknown): boolean {
  return typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol'
}

function isUtcTimestamp(value: string): boolean {
  if (!utcTimestampPattern.test(value)) {
    return false
  }

  const parsed = new Date(value)

  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}

function isValidLocalDate(value: string): boolean {
  if (!localDatePattern.test(value)) {
    return false
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)

  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
