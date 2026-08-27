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
    recordedByDisplayName: z.string().min(1),
    recordedAt: referralUtcTimestampSchema
  })
  .strict()

export const publicReferralDetailSchema = publicReferralSummarySchema.extend({
  reasonCodes: z.array(z.string().min(1)),
  reasonText: optionalText(1000),
  destinationName: optionalText(255),
  closureReason: optionalText(1000),
  closedAt: referralUtcTimestampSchema.nullable(),
  statusHistory: z.array(publicReferralStatusHistorySchema),
  followups: z.array(publicReferralFollowupSchema)
})

export const referralSearchRequestSchema = z
  .object({
    query: z.string().trim().max(100),
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
    newStatus: referralStatusSchema.nullable(),
    statusReason: optionalText(1000)
  })
  .strict()

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
