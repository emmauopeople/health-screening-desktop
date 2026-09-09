import { z } from 'zod'

import { createIpcSuccessResultSchema } from './result'

export const reportDocumentPatientIdSchema = z.uuid()
export const reportDocumentKindSchema = z.enum(['GENERAL', 'VITALS', 'LIFESTYLE', 'REFERRALS'])
export const reportDocumentFileNameSchema = z
  .string()
  .trim()
  .min(5)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/u)
export const savedReportDocumentFileNameSchema = z
  .string()
  .trim()
  .min(5)
  .max(255)
  .regex(/^[^/\\]+\.pdf$/iu)
  .refine(isSafeSavedFileName)

export const reportDocumentRequestSchema = z
  .object({
    patientId: reportDocumentPatientIdSchema,
    reportKind: reportDocumentKindSchema,
    suggestedFileName: reportDocumentFileNameSchema
  })
  .strict()

export const reportDocumentActionDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('SAVED'),
      fileName: savedReportDocumentFileNameSchema
    })
    .strict(),
  z.object({ status: z.literal('PRINTED') }).strict(),
  z.object({ status: z.literal('CANCELLED') }).strict(),
  z.object({ status: z.literal('UNAVAILABLE') }).strict()
])

export const reportDocumentSafeErrorMessages = {
  VALIDATION_FAILED: 'The report request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The report document service is unavailable.',
  INTERNAL_ERROR: 'The report document could not be created.',
  AUTH_UNAUTHENTICATED: 'Sign in is required.',
  AUTH_LOCKED: 'The local session is locked.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'A required password change must be completed.',
  AUTHORIZATION_FAILED: 'The current user cannot export this report.'
} as const

export const reportDocumentErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export type ReportDocumentErrorCode = z.infer<typeof reportDocumentErrorCodeSchema>

export const reportDocumentFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createErrorSchema('VALIDATION_FAILED'),
      createErrorSchema('IPC_FORBIDDEN'),
      createErrorSchema('IPC_UNAVAILABLE'),
      createErrorSchema('INTERNAL_ERROR'),
      createErrorSchema('AUTH_UNAUTHENTICATED'),
      createErrorSchema('AUTH_LOCKED'),
      createErrorSchema('AUTH_PASSWORD_CHANGE_REQUIRED'),
      createErrorSchema('AUTHORIZATION_FAILED')
    ])
  })
  .strict()

export const reportDocumentActionResultSchema = z.discriminatedUnion('ok', [
  createIpcSuccessResultSchema(reportDocumentActionDataSchema),
  reportDocumentFailureSchema
])

export type ReportDocumentKind = z.infer<typeof reportDocumentKindSchema>
export type ReportDocumentRequest = z.infer<typeof reportDocumentRequestSchema>
export type ReportDocumentActionData = z.infer<typeof reportDocumentActionDataSchema>
export type ReportDocumentActionResult = z.infer<typeof reportDocumentActionResultSchema>

export function createReportDocumentFailure<TCode extends ReportDocumentErrorCode>(
  code: TCode
): {
  ok: false
  error: { code: TCode; message: (typeof reportDocumentSafeErrorMessages)[TCode] }
} {
  return { ok: false, error: { code, message: reportDocumentSafeErrorMessages[code] } }
}

export interface ReportDocumentApi {
  savePdf(request: ReportDocumentRequest): Promise<ReportDocumentActionResult>
  print(request: ReportDocumentRequest): Promise<ReportDocumentActionResult>
}

function createErrorSchema<TCode extends ReportDocumentErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof reportDocumentSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(reportDocumentSafeErrorMessages[code])
    })
    .strict()
}

function isSafeSavedFileName(value: string): boolean {
  return Array.from(value).every((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint >= 32 && codePoint !== 127
  })
}
