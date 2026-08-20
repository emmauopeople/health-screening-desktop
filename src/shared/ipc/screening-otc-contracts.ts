import { z } from 'zod'

import {
  OTC_DOSE_TEXT_MAX_LENGTH,
  OTC_DURATION_TEXT_MAX_LENGTH,
  OTC_FREQUENCY_TEXT_MAX_LENGTH,
  OTC_PRODUCT_NAME_MAX_LENGTH,
  OTC_REASON_FOR_USE_MAX_LENGTH,
  OTC_SOURCE_OF_MEDICATION_MAX_LENGTH
} from '@shared/otc-text-limits'

import { createIpcSuccessResultSchema, safeIpcErrorMessages } from './result'

const unsafeTransportValue = Symbol('UnsafeScreeningOtcIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const otcDatePattern = /^\d{4}-\d{2}-\d{2}$/u

export const screeningOtcUuidSchema = z.string().uuid()
export const screeningOtcUtcTimestampSchema = z.string().regex(utcTimestampPattern)
export const screeningOtcDateSchema = z.string().regex(otcDatePattern)
export const screeningOtcVersionSchema = z.number().int().min(1).safe()
export const screeningOtcNullableVersionSchema = screeningOtcVersionSchema.nullable()
export const screeningOtcResponseSchema = z.enum([
  'REPORTED',
  'NONE_REPORTED',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
])
export const screeningOtcCurrentlyTakingResponseSchema = z.enum(['YES', 'NO', 'UNKNOWN'])

const nullableOtcResponseSchema = screeningOtcResponseSchema.nullable()
const nullableCurrentlyTakingResponseSchema = screeningOtcCurrentlyTakingResponseSchema.nullable()
const nullableText = (maximumLength: number): z.ZodType<string | null> =>
  z
    .string()
    .refine((value) => value.trim().length > 0)
    .refine((value) => value.trim().length <= maximumLength)
    .refine((value) => isSafeText(value.trim()))
    .nullable()

export const screeningOtcProductNameSchema = nullableText(OTC_PRODUCT_NAME_MAX_LENGTH)
export const screeningOtcReasonForUseSchema = nullableText(OTC_REASON_FOR_USE_MAX_LENGTH)
export const screeningOtcDoseTextSchema = nullableText(OTC_DOSE_TEXT_MAX_LENGTH)
export const screeningOtcFrequencyTextSchema = nullableText(OTC_FREQUENCY_TEXT_MAX_LENGTH)
export const screeningOtcDurationTextSchema = nullableText(OTC_DURATION_TEXT_MAX_LENGTH)
export const screeningOtcSourceOfMedicationSchema = nullableText(
  OTC_SOURCE_OF_MEDICATION_MAX_LENGTH
)

const positiveIntegerSchema = z.number().int().min(1).safe()
const idOrNullSchema = screeningOtcUuidSchema.nullable()

export const screeningOtcGetWorkspaceRequestSchema = exactObject({
  encounterId: screeningOtcUuidSchema
})

const screeningOtcSaveDraftRowRequestSchema = exactObject({
  id: idOrNullSchema,
  sequenceNumber: positiveIntegerSchema,
  productName: screeningOtcProductNameSchema,
  reasonForUse: screeningOtcReasonForUseSchema,
  doseText: screeningOtcDoseTextSchema,
  frequencyText: screeningOtcFrequencyTextSchema,
  durationText: screeningOtcDurationTextSchema,
  sourceOfMedication: screeningOtcSourceOfMedicationSchema,
  currentlyTakingResponse: nullableCurrentlyTakingResponseSchema
})

export const screeningOtcSaveDraftRequestSchema = exactObject({
  encounterId: screeningOtcUuidSchema,
  expectedVersion: screeningOtcNullableVersionSchema,
  otcResponse: nullableOtcResponseSchema,
  rows: z.array(screeningOtcSaveDraftRowRequestSchema)
})

const publicOtcDraftRowSchema = z
  .object({
    id: screeningOtcUuidSchema,
    sequenceNumber: positiveIntegerSchema,
    productNameSnapshot: screeningOtcProductNameSchema,
    productNameNormalized: screeningOtcProductNameSchema,
    reasonForUse: screeningOtcReasonForUseSchema,
    doseText: screeningOtcDoseTextSchema,
    frequencyText: screeningOtcFrequencyTextSchema,
    durationText: screeningOtcDurationTextSchema,
    sourceOfMedication: screeningOtcSourceOfMedicationSchema,
    currentlyTakingResponse: nullableCurrentlyTakingResponseSchema,
    updatedAt: screeningOtcUtcTimestampSchema
  })
  .strict()

const publicOtcDraftSchema = z
  .object({
    id: screeningOtcUuidSchema,
    encounterId: screeningOtcUuidSchema,
    otcResponse: nullableOtcResponseSchema,
    rowVersion: screeningOtcVersionSchema,
    periodStart: screeningOtcDateSchema,
    periodEnd: screeningOtcDateSchema,
    rows: z.array(publicOtcDraftRowSchema),
    updatedAt: screeningOtcUtcTimestampSchema
  })
  .strict()

const publicOtcRecentMedicationSchema = z
  .object({
    productNameSnapshot: z
      .string()
      .refine((value) => value.trim().length > 0)
      .refine((value) => value.trim().length <= OTC_PRODUCT_NAME_MAX_LENGTH)
      .refine((value) => isSafeText(value.trim()))
  })
  .strict()

const publicOtcWorkspaceSchema = z
  .object({
    encounterId: screeningOtcUuidSchema,
    draft: publicOtcDraftSchema.nullable(),
    recentMedications: z.array(publicOtcRecentMedicationSchema)
  })
  .strict()

const controlledStatuses = [
  'AUTHENTICATION_REQUIRED',
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'LOCATION_NOT_CONFIGURED',
  'LOCATION_NOT_FOUND',
  'LOCATION_INACTIVE',
  'ENCOUNTER_NOT_FOUND',
  'ENCOUNTER_NOT_EDITABLE',
  'SESSION_NOT_FOUND',
  'SESSION_CLOSED',
  'SESSION_NOT_CURRENT',
  'VERSION_CONFLICT',
  'UNAVAILABLE'
] as const

const controlledResultSchema = z.union(
  controlledStatuses.map((status) =>
    z.object({ status: z.literal(status) }).strict()
  ) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
)

export type ScreeningOtcIpcErrorCode = 'IPC_FORBIDDEN' | 'IPC_UNAVAILABLE' | 'INTERNAL_ERROR'
export type ScreeningOtcControlledStatus = (typeof controlledStatuses)[number]
export type ScreeningOtcResponse = z.infer<typeof screeningOtcResponseSchema>
export type ScreeningOtcCurrentlyTakingResponse = z.infer<
  typeof screeningOtcCurrentlyTakingResponseSchema
>
export type ScreeningOtcDraftRow = z.infer<typeof publicOtcDraftRowSchema>
export type ScreeningOtcDraft = z.infer<typeof publicOtcDraftSchema>
export type ScreeningOtcRecentMedication = z.infer<typeof publicOtcRecentMedicationSchema>
export type ScreeningOtcWorkspace = z.infer<typeof publicOtcWorkspaceSchema>
export type ScreeningOtcIpcFailure = {
  readonly ok: false
  readonly error: {
    readonly code: ScreeningOtcIpcErrorCode
    readonly message: string
  }
}

type ScreeningOtcWorkspaceResult<TStatus extends 'LOADED' | 'SAVED'> =
  | {
      readonly ok: true
      readonly data:
        | { readonly status: TStatus; readonly workspace: ScreeningOtcWorkspace }
        | { readonly status: ScreeningOtcControlledStatus }
    }
  | ScreeningOtcIpcFailure

export const screeningOtcFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      otcErrorSchema('IPC_FORBIDDEN'),
      otcErrorSchema('IPC_UNAVAILABLE'),
      otcErrorSchema('INTERNAL_ERROR')
    ])
  })
  .strict()

export const screeningOtcGetWorkspaceResultSchema = resultWithWorkspace(
  'LOADED'
) as z.ZodType<ScreeningOtcGetWorkspaceResult>
export const screeningOtcSaveDraftResultSchema = resultWithWorkspace(
  'SAVED'
) as z.ZodType<ScreeningOtcSaveDraftResult>

export type ScreeningOtcGetWorkspaceRequest = z.infer<typeof screeningOtcGetWorkspaceRequestSchema>
export type ScreeningOtcSaveDraftRowRequest = z.infer<typeof screeningOtcSaveDraftRowRequestSchema>
export type ScreeningOtcSaveDraftRequest = z.infer<typeof screeningOtcSaveDraftRequestSchema>
export type ScreeningOtcGetWorkspaceResult = ScreeningOtcWorkspaceResult<'LOADED'>
export type ScreeningOtcSaveDraftResult = ScreeningOtcWorkspaceResult<'SAVED'>
export type ScreeningOtcApi = {
  getWorkspace(request: ScreeningOtcGetWorkspaceRequest): Promise<ScreeningOtcGetWorkspaceResult>
  saveDraft(request: ScreeningOtcSaveDraftRequest): Promise<ScreeningOtcSaveDraftResult>
}

export function createScreeningOtcIpcFailure(
  code: ScreeningOtcIpcErrorCode
): ScreeningOtcIpcFailure {
  const messages = {
    IPC_FORBIDDEN: safeIpcErrorMessages.IPC_FORBIDDEN,
    IPC_UNAVAILABLE: safeIpcErrorMessages.IPC_UNAVAILABLE,
    INTERNAL_ERROR: safeIpcErrorMessages.INTERNAL_ERROR
  } as const
  return { ok: false, error: { code, message: messages[code] } }
}

function resultWithWorkspace(status: 'LOADED' | 'SAVED'): z.ZodTypeAny {
  return withSafeTransportPreprocess(
    z.discriminatedUnion('ok', [
      createIpcSuccessResultSchema(
        z.union([
          z.object({ status: z.literal(status), workspace: publicOtcWorkspaceSchema }).strict(),
          controlledResultSchema
        ])
      ),
      screeningOtcFailureSchema
    ])
  )
}

function exactObject<TShape extends z.ZodRawShape>(
  shape: TShape
): z.ZodType<z.infer<z.ZodObject<TShape>>> {
  return withSafeTransportPreprocess(z.object(shape).strict())
}

function otcErrorSchema<TCode extends ScreeningOtcIpcErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof safeIpcErrorMessages)[TCode]>
}> {
  return z
    .object({ code: z.literal(code), message: z.literal(safeIpcErrorMessages[code]) })
    .strict()
}

function withSafeTransportPreprocess<TSchema extends z.ZodType>(
  schema: TSchema
): z.ZodPreprocess<TSchema> {
  return z.preprocess((value) => copySafeTransportValue(value), schema)
}

function copySafeTransportValue(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null) return null
  const valueType = typeof value
  if (valueType !== 'object')
    return valueType === 'string' || valueType === 'number' || valueType === 'boolean'
      ? value
      : unsafeTransportValue
  const objectValue = value as object
  if (active.has(objectValue)) return unsafeTransportValue
  active.add(objectValue)
  try {
    const prototype = Object.getPrototypeOf(objectValue)
    const descriptors = Object.getOwnPropertyDescriptors(objectValue)
    if (prototype !== Object.prototype && prototype !== Array.prototype) return unsafeTransportValue
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return unsafeTransportValue
    if (Array.isArray(objectValue)) {
      const lengthDescriptor = descriptors.length
      if (
        !lengthDescriptor ||
        !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0 ||
        lengthDescriptor.value > 0xffffffff - 1
      )
        return unsafeTransportValue

      const length = lengthDescriptor.value
      const propertyNames = Object.getOwnPropertyNames(descriptors)
      if (propertyNames.length !== length + 1) return unsafeTransportValue

      const copy: unknown[] = new Array(length)
      for (let index = 0; index < length; index += 1) {
        const key = String(index)
        const descriptor = descriptors[key]
        if (
          !descriptor ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value') ||
          !Object.prototype.hasOwnProperty.call(descriptors, key)
        )
          return unsafeTransportValue
        const child = copySafeTransportValue(descriptor.value, active)
        if (child === unsafeTransportValue) return unsafeTransportValue
        copy[index] = child
      }

      for (const key of propertyNames) {
        if (key === 'length') continue
        const index = Number(key)
        if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key)
          return unsafeTransportValue
      }
      return copy
    }
    const copy: Record<string, unknown> = {}
    for (const key of Object.getOwnPropertyNames(descriptors)) {
      const descriptor = descriptors[key]
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
        return unsafeTransportValue
      const child = copySafeTransportValue(descriptor.value, active)
      if (child === unsafeTransportValue) return unsafeTransportValue
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true
      })
      if (key === '__proto__') return unsafeTransportValue
    }
    return copy
  } catch {
    return unsafeTransportValue
  } finally {
    active.delete(objectValue)
  }
}

function isSafeText(value: string): boolean {
  return !hasUnsafeTextCharacter(value) && !hasUnpairedSurrogate(value)
}

function hasUnsafeTextCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31))
      return true
    if (code === 127) return true
  }
  return false
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}
