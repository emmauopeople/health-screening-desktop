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
export const patientAcknowledgmentDecisionStatusSchema = z.enum(['ACKNOWLEDGED', 'DECLINED'])
export const patientDuplicateReviewStatusSchema = z.enum(['POSSIBLE_DUPLICATE', 'NOT_DUPLICATE'])
export const patientDemographicAmendmentReasonCodeSchema = z.enum([
  'DATA_ENTRY_CORRECTION',
  'PATIENT_REPORTED_CHANGE',
  'CONTACT_INFORMATION_UPDATE',
  'RESIDENCE_INFORMATION_UPDATE',
  'STATUS_CHANGE',
  'OTHER'
])
export const patientDemographicAmendmentPublicFieldNameSchema = z.enum([
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
])

export type PatientSex = z.infer<typeof patientSexSchema>
export type PatientStatus = z.infer<typeof patientStatusSchema>
export type PatientAcknowledgmentStatus = z.infer<typeof patientAcknowledgmentStatusSchema>
export type PatientAcknowledgmentDecisionStatus = z.infer<
  typeof patientAcknowledgmentDecisionStatusSchema
>
export type PatientDuplicateReviewStatus = z.infer<typeof patientDuplicateReviewStatusSchema>
export type PatientDemographicAmendmentReasonCode = z.infer<
  typeof patientDemographicAmendmentReasonCodeSchema
>
export type PatientDemographicAmendmentPublicFieldName = z.infer<
  typeof patientDemographicAmendmentPublicFieldNameSchema
>

export const patientPageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)])
export const patientListLimitSchema = z.number().int().min(1).max(25).safe()
export const patientUuidSchema = z.string().uuid()
export const patientUtcTimestampSchema = z.string().refine(isUtcTimestamp)
export const patientLocalDateSchema = z.string().refine(isValidLocalDate)
export const patientCodeSchema = z.string().regex(patientCodePattern)
export const patientOptionalTextSchema = z.string().max(240).nullable()
export const patientAmendmentNoteSchema = z.string().refine(isSafeBoundedAmendmentText).nullable()
export const patientDemographicAmendmentValueSchema = z.union([
  z.string(),
  z.number().refine(isFiniteSafeNumber),
  z.null()
])

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

export const patientDemographicAmendmentPatchSchema = withSafeTransportPreprocess(
  z
    .object({
      givenName: z.string().max(120).nullable().optional(),
      familyName: z.string().max(120).nullable().optional(),
      otherNames: z.string().max(120).nullable().optional(),
      dateOfBirth: patientLocalDateSchema.nullable().optional(),
      approximateAgeYears: z.number().int().min(0).max(120).safe().nullable().optional(),
      ageAsOfDate: patientLocalDateSchema.nullable().optional(),
      sex: patientSexSchema.optional(),
      village: z.string().max(120).nullable().optional(),
      quarter: z.string().max(120).nullable().optional(),
      phone: z.string().max(80).nullable().optional(),
      alternateContactName: z.string().max(120).nullable().optional(),
      alternateContactPhone: z.string().max(80).nullable().optional(),
      residenceNotes: z.string().max(500).nullable().optional(),
      status: patientStatusSchema.optional()
    })
    .strict()
    .refine((patch) => Object.keys(patch).length > 0)
)

export const patientAmendDemographicsRequestSchema = exactObject({
  patientId: patientUuidSchema,
  expectedRowVersion: z.number().int().min(1).safe(),
  reasonCode: patientDemographicAmendmentReasonCodeSchema,
  reasonNote: patientAmendmentNoteSchema,
  patch: patientDemographicAmendmentPatchSchema
})

export const patientListDemographicAmendmentHistoryRequestSchema = exactObject({
  patientId: patientUuidSchema,
  page: z.number().int().min(1).max(10000).safe(),
  pageSize: patientPageSizeSchema
})

export const patientRecordAcknowledgmentRequestSchema = exactObject({
  patientId: patientUuidSchema,
  expectedRowVersion: z.number().int().min(1).safe(),
  status: patientAcknowledgmentDecisionStatusSchema,
  note: patientAmendmentNoteSchema
})

export const patientListAcknowledgmentHistoryRequestSchema = exactObject({
  patientId: patientUuidSchema,
  page: z.number().int().min(1).max(10000).safe(),
  pageSize: patientPageSizeSchema
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

export const publicPatientDemographicAmendmentChangeSchema = z
  .object({
    fieldName: patientDemographicAmendmentPublicFieldNameSchema,
    previousValue: patientDemographicAmendmentValueSchema,
    newValue: patientDemographicAmendmentValueSchema
  })
  .strict()

export const publicPatientDemographicAmendmentRecordSchema = z
  .object({
    amendmentId: patientUuidSchema,
    patientId: patientUuidSchema,
    priorRowVersion: z.number().int().min(1).safe(),
    resultingRowVersion: z.number().int().min(1).safe(),
    reasonCode: patientDemographicAmendmentReasonCodeSchema,
    reasonNote: patientAmendmentNoteSchema,
    amendedByUserId: patientUuidSchema,
    amendedByDisplayName: z.string().min(1).max(120),
    amendedAt: patientUtcTimestampSchema,
    changes: z.array(publicPatientDemographicAmendmentChangeSchema).min(1)
  })
  .strict()
  .superRefine((record, context) => {
    if (record.resultingRowVersion !== record.priorRowVersion + 1) {
      context.addIssue({ code: 'custom', path: ['resultingRowVersion'] })
    }

    validateDemographicChangeOrder(record.changes, context, ['changes'])
  })

export const publicPatientAcknowledgmentHistoryRecordSchema = z
  .object({
    acknowledgmentId: patientUuidSchema,
    patientId: patientUuidSchema,
    status: patientAcknowledgmentStatusSchema,
    sourceType: z.literal('LOCAL'),
    note: patientAmendmentNoteSchema,
    recordedByUserId: patientUuidSchema,
    recordedByDisplayName: z.string().min(1).max(120),
    recordedAt: patientUtcTimestampSchema,
    priorRowVersion: z.number().int().min(1).safe().nullable(),
    resultingRowVersion: z.number().int().min(1).safe().nullable()
  })
  .strict()
  .superRefine((record, context) => {
    validateNullableConsecutiveRowVersions(
      record.priorRowVersion,
      record.resultingRowVersion,
      context
    )
  })

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

export const patientAmendDemographicsSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('AMENDED'),
      amendmentId: patientUuidSchema,
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

export const patientListDemographicAmendmentHistorySuccessDataSchema = z
  .object({
    items: z.array(publicPatientDemographicAmendmentRecordSchema),
    page: z.number().int().min(1).safe(),
    pageSize: patientPageSizeSchema,
    total: z.number().int().min(0).safe()
  })
  .strict()

export const patientRecordAcknowledgmentSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('RECORDED'),
      acknowledgmentId: patientUuidSchema,
      patient: publicPatientDetailSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('PATIENT_VERSION_CONFLICT'),
      patient: publicPatientDetailSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('DUPLICATE_DECISION'),
      patient: publicPatientDetailSchema,
      acknowledgment: publicPatientAcknowledgmentHistoryRecordSchema
    })
    .strict()
])

export const patientListAcknowledgmentHistorySuccessDataSchema = z
  .object({
    items: z.array(publicPatientAcknowledgmentHistoryRecordSchema),
    page: z.number().int().min(1).safe(),
    pageSize: patientPageSizeSchema,
    total: z.number().int().min(0).safe()
  })
  .strict()

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
export const patientAmendDemographicsResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientAmendDemographicsSuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientListDemographicAmendmentHistoryResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientListDemographicAmendmentHistorySuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientRecordAcknowledgmentResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientRecordAcknowledgmentSuccessDataSchema),
    patientFailureSchema
  ])
)
export const patientListAcknowledgmentHistoryResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(patientListAcknowledgmentHistorySuccessDataSchema),
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
export type PublicPatientDemographicAmendmentChange = z.infer<
  typeof publicPatientDemographicAmendmentChangeSchema
>
export type PublicPatientDemographicAmendmentRecord = z.infer<
  typeof publicPatientDemographicAmendmentRecordSchema
>
export type PublicPatientAcknowledgmentHistoryRecord = z.infer<
  typeof publicPatientAcknowledgmentHistoryRecordSchema
>
export type PatientEditableFields = z.infer<typeof patientEditableFieldsSchema>
export type PatientDemographicAmendmentPatch = z.infer<
  typeof patientDemographicAmendmentPatchSchema
>
export type PatientDemographicAmendmentValue = z.infer<
  typeof patientDemographicAmendmentValueSchema
>
export type PatientSearchRequest = z.infer<typeof patientSearchRequestSchema>
export type PatientGetRequest = z.infer<typeof patientGetRequestSchema>
export type PatientCreateRequest = z.infer<typeof patientCreateRequestSchema>
export type PatientUpdateRequest = z.infer<typeof patientUpdateRequestSchema>
export type PatientAmendDemographicsRequest = z.infer<typeof patientAmendDemographicsRequestSchema>
export type PatientListDemographicAmendmentHistoryRequest = z.infer<
  typeof patientListDemographicAmendmentHistoryRequestSchema
>
export type PatientRecordAcknowledgmentRequest = z.infer<
  typeof patientRecordAcknowledgmentRequestSchema
>
export type PatientListAcknowledgmentHistoryRequest = z.infer<
  typeof patientListAcknowledgmentHistoryRequestSchema
>
export type PatientListRecentRequest = z.infer<typeof patientListRecentRequestSchema>
export type PatientFindDuplicatesRequest = z.infer<typeof patientFindDuplicatesRequestSchema>
export type PatientMarkNotDuplicateRequest = z.infer<typeof patientMarkNotDuplicateRequestSchema>
export type PatientSearchResult = z.infer<typeof patientSearchResultSchema>
export type PatientGetResult = z.infer<typeof patientGetResultSchema>
export type PatientCreateResult = z.infer<typeof patientCreateResultSchema>
export type PatientUpdateResult = z.infer<typeof patientUpdateResultSchema>
export type PatientAmendDemographicsSuccessData = z.infer<
  typeof patientAmendDemographicsSuccessDataSchema
>
export type PatientListDemographicAmendmentHistorySuccessData = z.infer<
  typeof patientListDemographicAmendmentHistorySuccessDataSchema
>
export type PatientRecordAcknowledgmentSuccessData = z.infer<
  typeof patientRecordAcknowledgmentSuccessDataSchema
>
export type PatientListAcknowledgmentHistorySuccessData = z.infer<
  typeof patientListAcknowledgmentHistorySuccessDataSchema
>
export type PatientAmendDemographicsResult = z.infer<typeof patientAmendDemographicsResultSchema>
export type PatientListDemographicAmendmentHistoryResult = z.infer<
  typeof patientListDemographicAmendmentHistoryResultSchema
>
export type PatientRecordAcknowledgmentResult = z.infer<
  typeof patientRecordAcknowledgmentResultSchema
>
export type PatientListAcknowledgmentHistoryResult = z.infer<
  typeof patientListAcknowledgmentHistoryResultSchema
>
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

const demographicAmendmentPublicFieldOrder = Object.freeze([
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
] as const)

function validateDemographicChangeOrder(
  changes: readonly { readonly fieldName: PatientDemographicAmendmentPublicFieldName }[],
  context: z.RefinementCtx,
  basePath: readonly (string | number)[]
): void {
  const seen = new Set<string>()
  let previousOrderIndex = -1

  for (const [index, change] of changes.entries()) {
    const orderIndex = demographicAmendmentPublicFieldOrder.indexOf(change.fieldName)

    if (seen.has(change.fieldName)) {
      context.addIssue({
        code: 'custom',
        path: [...basePath, index, 'fieldName'],
        message: 'Duplicate demographic amendment field.'
      })
      continue
    }

    seen.add(change.fieldName)

    if (orderIndex <= previousOrderIndex) {
      context.addIssue({
        code: 'custom',
        path: [...basePath, index, 'fieldName'],
        message: 'Demographic amendment changes must use canonical field order.'
      })
      continue
    }

    previousOrderIndex = orderIndex
  }
}

function validateNullableConsecutiveRowVersions(
  priorRowVersion: number | null,
  resultingRowVersion: number | null,
  context: z.RefinementCtx
): void {
  if (priorRowVersion === null && resultingRowVersion === null) {
    return
  }

  if (
    priorRowVersion === null ||
    resultingRowVersion === null ||
    resultingRowVersion !== priorRowVersion + 1
  ) {
    context.addIssue({
      code: 'custom',
      path: ['resultingRowVersion'],
      message: 'Acknowledgment row-version metadata must be null together or consecutive.'
    })
  }
}

function isFiniteSafeNumber(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
}

function isSafeBoundedAmendmentText(value: string): boolean {
  return (
    Array.from(value).length <= 500 &&
    !hasUnpairedSurrogate(value) &&
    !hasUnsafeTextCharacter(value)
  )
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)

      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true
      }

      index += 1
      continue
    }

    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }

  return false
}

function hasUnsafeTextCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!

    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    ) {
      return true
    }
  }

  return false
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
