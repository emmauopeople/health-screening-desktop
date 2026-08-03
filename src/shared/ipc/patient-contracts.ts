import { z } from 'zod'

import {
  authenticationFailureSchema,
  createAuthenticationFailure,
  utcTimestampSchema
} from './authentication-contracts'
import { createIpcSuccessResultSchema } from './result'

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/u
const entityIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export const patientSexSchema = z.enum(['FEMALE', 'MALE', 'OTHER', 'UNKNOWN'])
export const patientStatusSchema = z.enum(['ACTIVE', 'INACTIVE'])
export const patientAcknowledgmentStatusSchema = z.enum([
  'ACKNOWLEDGED',
  'DECLINED',
  'UNABLE_TO_ACKNOWLEDGE'
])
export const patientDuplicateReasonCodeSchema = z.enum([
  'EXACT_PHONE',
  'DOB_SIMILAR_NAME',
  'EXACT_NAME_RESIDENCE',
  'APPROXIMATE_AGE_NAME_RESIDENCE'
])

export const patientDuplicateReasonLabels = Object.freeze({
  EXACT_PHONE: 'Same phone number',
  DOB_SIMILAR_NAME: 'Same date of birth with similar name',
  EXACT_NAME_RESIDENCE: 'Same name and residence',
  APPROXIMATE_AGE_NAME_RESIDENCE: 'Similar age, name, and residence'
} satisfies Record<PatientDuplicateReasonCode, string>)

const dateOnlySchema = z.string().regex(dateOnlyPattern).max(10)
const boundedTextSchema = (maxLength: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => !hasUnsafeControlCharacter(value))

const optionalBoundedTextSchema = (maxLength: number): z.ZodNullable<z.ZodOptional<z.ZodString>> =>
  boundedTextSchema(maxLength).optional().nullable()

export const patientSearchFiltersSchema = z
  .object({
    dateOfBirth: dateOnlySchema.optional().nullable(),
    approximateAgeYears: z.number().int().min(0).max(120).optional().nullable(),
    sex: patientSexSchema.optional().nullable(),
    village: optionalBoundedTextSchema(80),
    quarter: optionalBoundedTextSchema(80)
  })
  .strict()

export const patientSearchRequestSchema = z
  .object({
    query: z.string().max(160).optional(),
    filters: patientSearchFiltersSchema.optional(),
    page: z.number().int().min(1).max(100000).optional(),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)]).optional()
  })
  .strict()

export const patientGetSummaryRequestSchema = z
  .object({
    patientId: z.string().regex(entityIdPattern)
  })
  .strict()

export const patientRegistrationDraftSchema = z
  .object({
    givenName: boundedTextSchema(80),
    middleName: optionalBoundedTextSchema(80),
    familyName: boundedTextSchema(80),
    sex: patientSexSchema,
    dateOfBirth: dateOnlySchema.optional().nullable(),
    approximateAgeYears: z.number().int().min(0).max(120).optional().nullable(),
    approximateAgeAsOfDate: dateOnlySchema.optional().nullable(),
    village: boundedTextSchema(80),
    quarter: optionalBoundedTextSchema(80),
    phone: optionalBoundedTextSchema(40)
  })
  .strict()
  .refine(
    (value) =>
      (value.dateOfBirth === undefined || value.dateOfBirth === null) !==
      (value.approximateAgeYears === undefined || value.approximateAgeYears === null),
    { message: 'exact-dob-or-approximate-age-required' }
  )
  .refine(
    (value) =>
      value.approximateAgeYears === undefined ||
      value.approximateAgeYears === null ||
      (value.approximateAgeAsOfDate !== undefined && value.approximateAgeAsOfDate !== null),
    { message: 'approximate-age-reference-date-required' }
  )

export const patientFindDuplicatesRequestSchema = patientRegistrationDraftSchema

export const patientCreateRequestSchema = patientRegistrationDraftSchema.extend({
  acknowledgmentStatus: patientAcknowledgmentStatusSchema,
  acknowledgmentReference: optionalBoundedTextSchema(160),
  reviewedDuplicateToken: z.string().min(32).max(128).optional().nullable()
})

export const publicPatientSummarySchema = z
  .object({
    patientId: z.string().regex(entityIdPattern),
    patientCode: z.string().min(3).max(24),
    displayName: z.string().min(1).max(180),
    status: patientStatusSchema,
    sex: patientSexSchema.nullable(),
    dateOfBirth: dateOnlySchema.nullable(),
    approximateAgeYears: z.number().int().min(0).max(120).nullable(),
    approximateAgeAsOfDate: dateOnlySchema.nullable(),
    ageDobDisplay: z.string().min(1).max(80),
    village: z.string().min(1).max(80).nullable(),
    quarter: z.string().min(1).max(80).nullable(),
    phoneAvailable: z.boolean(),
    lastScreening: z.null(),
    referralFollowUp: z.null(),
    revision: utcTimestampSchema
  })
  .strict()

export const patientDuplicateCandidateSchema = z
  .object({
    patient: publicPatientSummarySchema,
    reasonCodes: z.array(patientDuplicateReasonCodeSchema).min(1).max(4),
    reasonLabels: z.array(z.string().min(1).max(80)).min(1).max(4)
  })
  .strict()

export const patientSearchSuccessDataSchema = z
  .object({
    rows: z.array(publicPatientSummarySchema).max(100),
    total: z.number().int().min(0).safe(),
    page: z.number().int().min(1).safe(),
    pageSize: z.union([z.literal(25), z.literal(50), z.literal(100)])
  })
  .strict()

export const patientDuplicateReviewDataSchema = z
  .object({
    candidates: z.array(patientDuplicateCandidateSchema).max(25),
    reviewToken: z.string().min(32).max(128)
  })
  .strict()

export const patientCreateSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('CREATED'),
      patient: publicPatientSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('DUPLICATE_REVIEW_REQUIRED'),
      candidates: z.array(patientDuplicateCandidateSchema).max(25),
      reviewToken: z.string().min(32).max(128)
    })
    .strict()
])

export const patientSearchResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(patientSearchSuccessDataSchema),
  authenticationFailureSchema
])
export const patientGetSummaryResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(publicPatientSummarySchema),
  authenticationFailureSchema
])
export const patientFindDuplicatesResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(patientDuplicateReviewDataSchema),
  authenticationFailureSchema
])
export const patientCreateResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(patientCreateSuccessDataSchema),
  authenticationFailureSchema
])

export type PatientSex = z.infer<typeof patientSexSchema>
export type PatientStatus = z.infer<typeof patientStatusSchema>
export type PatientAcknowledgmentStatus = z.infer<typeof patientAcknowledgmentStatusSchema>
export type PatientDuplicateReasonCode = z.infer<typeof patientDuplicateReasonCodeSchema>
export type PatientSearchFilters = z.infer<typeof patientSearchFiltersSchema>
export type PatientSearchRequest = z.infer<typeof patientSearchRequestSchema>
export type PatientGetSummaryRequest = z.infer<typeof patientGetSummaryRequestSchema>
export type PatientRegistrationDraft = z.infer<typeof patientRegistrationDraftSchema>
export type PatientFindDuplicatesRequest = z.infer<typeof patientFindDuplicatesRequestSchema>
export type PatientCreateRequest = z.infer<typeof patientCreateRequestSchema>
export type PublicPatientSummary = z.infer<typeof publicPatientSummarySchema>
export type PatientDuplicateCandidate = z.infer<typeof patientDuplicateCandidateSchema>
export type PatientSearchSuccessData = z.infer<typeof patientSearchSuccessDataSchema>
export type PatientDuplicateReviewData = z.infer<typeof patientDuplicateReviewDataSchema>
export type PatientCreateSuccessData = z.infer<typeof patientCreateSuccessDataSchema>
export type PatientSearchResult = z.infer<typeof patientSearchResultSchema>
export type PatientGetSummaryResult = z.infer<typeof patientGetSummaryResultSchema>
export type PatientFindDuplicatesResult = z.infer<typeof patientFindDuplicatesResultSchema>
export type PatientCreateResult = z.infer<typeof patientCreateResultSchema>

export function createPatientFailure<
  TCode extends Parameters<typeof createAuthenticationFailure>[0]
>(code: TCode): ReturnType<typeof createAuthenticationFailure<TCode>> {
  return createAuthenticationFailure(code)
}

export function normalizePatientSearchText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US')
}

export function normalizePatientPhone(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const digits = value.replace(/\D/gu, '')

  return digits.length === 0 ? null : digits
}

function hasUnsafeControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!

    if ((codePoint <= 0x1f && codePoint !== 0x09) || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true
    }
  }

  return false
}
