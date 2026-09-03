import { z } from 'zod'

import { createIpcSuccessResultSchema, ipcFailureResultSchema } from './result'

export const referralUuidSchema = z.string().uuid()
export const referralDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  })
export const referralUtcTimestampSchema = z.string().datetime({ offset: false })
export const referralStatusSchema = z.enum([
  'OPEN',
  'CONTACTED',
  'SEEN',
  'UNABLE_TO_CONFIRM',
  'CLOSED'
])
export const referralUrgencySchema = z.enum(['STANDARD', 'URGENT'])
export const referralPageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)])
export const referralTreatmentActionSchema = z.enum([
  'TREATMENT_INITIATED',
  'TREATMENT_MODIFIED',
  'NEW_MEDICATION'
])
export const referralMedicationChangeTypeSchema = z.enum(['NEW_MEDICATION', 'TREATMENT_MODIFIED'])

const optionalText = (maximum: number): z.ZodType<string | null> =>
  z.string().trim().min(1).max(maximum).nullable()
const controlledStatusSchema = z.enum([
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'LOCATION_NOT_CONFIGURED',
  'LOCATION_NOT_FOUND',
  'LOCATION_INACTIVE',
  'REFERRAL_NOT_FOUND',
  'VERSION_CONFLICT',
  'UNAVAILABLE'
])

export const publicReferralSummarySchema = z
  .object({
    id: referralUuidSchema,
    patientId: referralUuidSchema,
    encounterId: referralUuidSchema,
    patientCode: z.string().min(1),
    patientDisplayName: z.string().min(1),
    urgency: referralUrgencySchema,
    dueDate: referralDateSchema,
    status: referralStatusSchema,
    lastContactDate: referralDateSchema.nullable(),
    recordVersion: z.number().int().min(1),
    createdAt: referralUtcTimestampSchema,
    updatedAt: referralUtcTimestampSchema
  })
  .strict()

export const publicReferralStatusHistorySchema = z
  .object({
    id: referralUuidSchema,
    fromStatus: referralStatusSchema.nullable(),
    toStatus: referralStatusSchema,
    changeReason: optionalText(1000),
    changedByDisplayName: z.string().min(1),
    changedAt: referralUtcTimestampSchema
  })
  .strict()

export const publicReferralFollowupSchema = z
  .object({
    id: referralUuidSchema,
    contactDate: referralDateSchema,
    contactMethod: z.string().min(1).max(100),
    informationSource: z.string().min(1).max(100),
    providerSeen: z.boolean().nullable(),
    facilityName: optionalText(255),
    dateSeen: referralDateSchema.nullable(),
    reportedOutcome: optionalText(2000),
    reportedMedicationsOrAdvice: optionalText(2000),
    nextAction: optionalText(1000),
    nextFollowupDate: referralDateSchema.nullable(),
    sourceType: z.string().min(1).max(100),
    treatmentActions: z.array(referralTreatmentActionSchema).max(3),
    medicationChanges: z.array(
      z
        .object({
          id: referralUuidSchema,
          changeType: referralMedicationChangeTypeSchema,
          medicationName: z.string().min(1).max(255),
          dosage: optionalText(255),
          frequency: optionalText(255)
        })
        .strict()
    ),
    recordedByDisplayName: z.string().min(1),
    recordedAt: referralUtcTimestampSchema
  })
  .strict()

export const publicReferralDetailSchema = publicReferralSummarySchema.extend({
  reasonCodes: z.array(z.string().min(1)),
  reasonText: optionalText(1000),
  triggeringBloodPressure: z
    .object({
      systolic: z.number().int().min(1).max(300),
      diastolic: z.number().int().min(1).max(200)
    })
    .strict()
    .nullable()
    .optional(),
  destinationName: optionalText(255),
  closureReason: optionalText(1000),
  closedAt: referralUtcTimestampSchema.nullable(),
  statusHistory: z.array(publicReferralStatusHistorySchema),
  followups: z.array(publicReferralFollowupSchema)
})

export const referralSearchRequestSchema = z
  .object({
    query: z.string().trim().max(100),
    screeningSessionId: referralUuidSchema.nullable().optional(),
    statuses: z.array(referralStatusSchema).max(5),
    urgency: referralUrgencySchema.nullable(),
    dueFrom: referralDateSchema.nullable(),
    dueTo: referralDateSchema.nullable(),
    page: z.number().int().min(1),
    pageSize: referralPageSizeSchema
  })
  .strict()

export const referralGetDetailRequestSchema = z.object({ referralId: referralUuidSchema }).strict()
export const referralUpdateStatusRequestSchema = z
  .object({
    referralId: referralUuidSchema,
    expectedVersion: z.number().int().min(1),
    status: referralStatusSchema,
    reason: optionalText(1000)
  })
  .strict()

export const referralRecordFollowupRequestSchema = z
  .object({
    referralId: referralUuidSchema,
    expectedVersion: z.number().int().min(1),
    contactDate: referralDateSchema,
    contactMethod: z.string().trim().min(1).max(100),
    informationSource: z.string().trim().min(1).max(100),
    providerSeen: z.boolean().nullable(),
    facilityName: optionalText(255),
    dateSeen: referralDateSchema.nullable(),
    reportedOutcome: optionalText(2000),
    reportedMedicationsOrAdvice: optionalText(2000),
    nextAction: optionalText(1000),
    nextFollowupDate: referralDateSchema.nullable(),
    sourceType: z.string().trim().min(1).max(100),
    treatmentActions: z.array(referralTreatmentActionSchema).max(3),
    medicationChanges: z
      .array(
        z
          .object({
            changeType: referralMedicationChangeTypeSchema,
            medicationName: z.string().trim().min(1).max(255),
            dosage: optionalText(255),
            frequency: optionalText(255)
          })
          .strict()
      )
      .max(20),
    newStatus: referralStatusSchema.nullable(),
    statusReason: optionalText(1000)
  })
  .strict()
  .superRefine((value, context) => {
    const uniqueActions = new Set(value.treatmentActions)
    if (uniqueActions.size !== value.treatmentActions.length)
      context.addIssue({ code: 'custom', path: ['treatmentActions'], message: 'Duplicate action.' })
    if (
      value.providerSeen !== true &&
      (value.treatmentActions.length > 0 || value.medicationChanges.length > 0)
    )
      context.addIssue({
        code: 'custom',
        path: ['providerSeen'],
        message: 'Provider must be seen.'
      })
    for (const changeType of ['NEW_MEDICATION', 'TREATMENT_MODIFIED'] as const) {
      const hasAction = uniqueActions.has(changeType)
      const hasRows = value.medicationChanges.some((row) => row.changeType === changeType)
      if (hasAction !== hasRows)
        context.addIssue({
          code: 'custom',
          path: ['medicationChanges'],
          message: 'Action and medication rows must match.'
        })
    }
  })

const searchDataSchema = z.union([
  z
    .object({
      status: z.literal('LOADED'),
      items: z.array(publicReferralSummarySchema),
      total: z.number().int().min(0),
      page: z.number().int().min(1),
      pageSize: referralPageSizeSchema
    })
    .strict(),
  z.object({ status: controlledStatusSchema }).strict()
])
const detailDataSchema = z.union([
  z.object({ status: z.literal('LOADED'), detail: publicReferralDetailSchema }).strict(),
  z.object({ status: controlledStatusSchema }).strict()
])
const mutationDataSchema = z.union([
  z.object({ status: z.literal('UPDATED'), detail: publicReferralDetailSchema }).strict(),
  z.object({ status: controlledStatusSchema }).strict()
])

export const referralSearchResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(searchDataSchema),
  ipcFailureResultSchema
])
export const referralGetDetailResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(detailDataSchema),
  ipcFailureResultSchema
])
export const referralUpdateStatusResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(mutationDataSchema),
  ipcFailureResultSchema
])
export const referralRecordFollowupResultSchema = referralUpdateStatusResultSchema

export type ReferralStatus = z.infer<typeof referralStatusSchema>
export type ReferralUrgency = z.infer<typeof referralUrgencySchema>
export type ReferralTreatmentAction = z.infer<typeof referralTreatmentActionSchema>
export type ReferralMedicationChangeType = z.infer<typeof referralMedicationChangeTypeSchema>
export type ReferralSearchRequest = z.infer<typeof referralSearchRequestSchema>
export type ReferralGetDetailRequest = z.infer<typeof referralGetDetailRequestSchema>
export type ReferralUpdateStatusRequest = z.infer<typeof referralUpdateStatusRequestSchema>
export type ReferralRecordFollowupRequest = z.infer<typeof referralRecordFollowupRequestSchema>
export type ReferralSearchResult = z.infer<typeof referralSearchResultSchema>
export type ReferralGetDetailResult = z.infer<typeof referralGetDetailResultSchema>
export type ReferralUpdateStatusResult = z.infer<typeof referralUpdateStatusResultSchema>
export type ReferralRecordFollowupResult = z.infer<typeof referralRecordFollowupResultSchema>
export type PublicReferralSummary = z.infer<typeof publicReferralSummarySchema>
export type PublicReferralDetail = z.infer<typeof publicReferralDetailSchema>

export interface ReferralApi {
  search(request: ReferralSearchRequest): Promise<ReferralSearchResult>
  getDetail(request: ReferralGetDetailRequest): Promise<ReferralGetDetailResult>
  updateStatus(request: ReferralUpdateStatusRequest): Promise<ReferralUpdateStatusResult>
  recordFollowup(request: ReferralRecordFollowupRequest): Promise<ReferralRecordFollowupResult>
}
