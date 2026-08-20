import { z } from 'zod'

import { createIpcSuccess, createIpcSuccessResultSchema, safeIpcErrorMessages } from './result'
import {
  VITALS_DIASTOLIC_MAX,
  VITALS_DIASTOLIC_MIN,
  VITALS_PULSE_MAX,
  VITALS_PULSE_MIN,
  VITALS_SYSTOLIC_MAX,
  VITALS_SYSTOLIC_MIN
} from '../vitals-bounds'

const unsafeTransportValue = Symbol('UnsafeScreeningEncounterIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export const screeningEncounterUuidSchema = z.string().uuid()
export const screeningEncounterUtcTimestampSchema = z.string().refine(isUtcTimestamp)
export const screeningEncounterStatusSchema = z.enum(['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'])
export const screeningVitalsDraftStatusSchema = z.enum(['DRAFT', 'VITALS_COMPLETE'])
export const screeningVitalsMeasurementSiteSchema = z.enum([
  'RIGHT_ARM',
  'LEFT_ARM',
  'LEFT_LEG',
  'RIGHT_LEG'
])
export const screeningVitalsPatientPositionSchema = z.enum(['LYING', 'STANDING', 'SITTING'])
export const screeningVitalsMeasurementTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u)
export const screeningVitalsPositiveIntegerSchema = z.number().int().min(1).safe()
export const screeningVitalsPositiveNumberSchema = z.number().positive()
export const screeningVitalsSystolicSchema = z
  .number()
  .int()
  .min(VITALS_SYSTOLIC_MIN)
  .max(VITALS_SYSTOLIC_MAX)
  .safe()
export const screeningVitalsDiastolicSchema = z
  .number()
  .int()
  .min(VITALS_DIASTOLIC_MIN)
  .max(VITALS_DIASTOLIC_MAX)
  .safe()
export const screeningVitalsPulseSchema = z
  .number()
  .int()
  .min(VITALS_PULSE_MIN)
  .max(VITALS_PULSE_MAX)
  .safe()
export const publicScreeningVitalsReadingValueSchema = z.number().int().min(1).safe()

export const screeningEncounterStartRequestSchema = exactObject({
  patientId: screeningEncounterUuidSchema,
  screeningSessionId: screeningEncounterUuidSchema
})
export const screeningCompletionSectionSchema = z.enum(['VITALS', 'LIFESTYLE', 'FOOD', 'OTC'])
export const screeningEncounterCompleteRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  expectedEncounterVersion: screeningVitalsPositiveIntegerSchema,
  expectedVitalsVersion: screeningVitalsPositiveIntegerSchema,
  expectedLifestyleVersion: screeningVitalsPositiveIntegerSchema,
  expectedFoodVersion: screeningVitalsPositiveIntegerSchema,
  expectedOtcVersion: screeningVitalsPositiveIntegerSchema,
  reviewConfirmed: z.literal(true),
  alcoholBaselineReviewConfirmedVersionId: screeningEncounterUuidSchema.nullable(),
  tobaccoBaselineReviewConfirmedVersionId: screeningEncounterUuidSchema.nullable()
})
export const screeningVitalsGetDraftRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema
})
export const screeningVitalsDraftReadingRequestSchema = exactObject({
  id: screeningEncounterUuidSchema.nullable(),
  sequenceNumber: screeningVitalsPositiveIntegerSchema,
  systolic: screeningVitalsSystolicSchema.nullable(),
  diastolic: screeningVitalsDiastolicSchema.nullable(),
  pulse: screeningVitalsPulseSchema.nullable(),
  measurementSite: screeningVitalsMeasurementSiteSchema.nullable(),
  patientPosition: screeningVitalsPatientPositionSchema.nullable(),
  measurementTime: screeningVitalsMeasurementTimeSchema.nullable()
})
export const screeningVitalsSaveDraftRequestSchema = exactObject({
  encounterId: screeningEncounterUuidSchema,
  expectedVersion: screeningVitalsPositiveIntegerSchema.nullable(),
  readings: z.array(screeningVitalsDraftReadingRequestSchema).min(1).max(12),
  weightKg: screeningVitalsPositiveNumberSchema.nullable(),
  waistCm: screeningVitalsPositiveNumberSchema.nullable(),
  notes: z.string().max(500).nullable()
})

export const publicScreeningEncounterStartSummarySchema = z
  .object({
    id: screeningEncounterUuidSchema,
    patientId: screeningEncounterUuidSchema,
    screeningSessionId: screeningEncounterUuidSchema,
    status: screeningEncounterStatusSchema,
    startedAt: screeningEncounterUtcTimestampSchema,
    recordVersion: z.number().int().min(1).safe()
  })
  .strict()
export const publicCompletedScreeningEncounterSummarySchema = z
  .object({
    id: screeningEncounterUuidSchema,
    patientId: screeningEncounterUuidSchema,
    screeningSessionId: screeningEncounterUuidSchema,
    status: z.literal('COMPLETED'),
    startedAt: screeningEncounterUtcTimestampSchema,
    completedAt: screeningEncounterUtcTimestampSchema,
    recordVersion: z.number().int().min(1).safe()
  })
  .strict()

export const screeningEncounterStartSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('STARTED'),
      encounter: publicScreeningEncounterStartSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('ALREADY_EXISTS'),
      encounter: publicScreeningEncounterStartSummarySchema
    })
    .strict(),
  z.object({ status: z.literal('PATIENT_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('PATIENT_INELIGIBLE') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('SESSION_CLOSED') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_CURRENT') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
  z.object({ status: z.literal('FORBIDDEN') }).strict(),
  z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
  z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
  z.object({ status: z.literal('UNAVAILABLE') }).strict()
])
export const screeningVitalsDraftReadingSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    sequenceNumber: screeningVitalsPositiveIntegerSchema,
    systolic: publicScreeningVitalsReadingValueSchema.nullable(),
    diastolic: publicScreeningVitalsReadingValueSchema.nullable(),
    pulse: publicScreeningVitalsReadingValueSchema.nullable(),
    measurementSite: screeningVitalsMeasurementSiteSchema.nullable(),
    patientPosition: screeningVitalsPatientPositionSchema.nullable(),
    measurementTime: screeningVitalsMeasurementTimeSchema.nullable()
  })
  .strict()
export const publicScreeningVitalsDraftSchema = z
  .object({
    id: screeningEncounterUuidSchema,
    encounterId: screeningEncounterUuidSchema,
    status: screeningVitalsDraftStatusSchema,
    readings: z.array(screeningVitalsDraftReadingSchema).min(1).max(12),
    weightKg: screeningVitalsPositiveNumberSchema.nullable(),
    waistCm: screeningVitalsPositiveNumberSchema.nullable(),
    notes: z.string().max(500).nullable(),
    rowVersion: screeningVitalsPositiveIntegerSchema,
    updatedAt: screeningEncounterUtcTimestampSchema
  })
  .strict()
const screeningVitalsControlledStatusSchemas = [
  z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
  z.object({ status: z.literal('FORBIDDEN') }).strict(),
  z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_CONFIGURED') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('ENCOUNTER_NOT_EDITABLE') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('SESSION_CLOSED') }).strict(),
  z.object({ status: z.literal('SESSION_NOT_CURRENT') }).strict(),
  z.object({ status: z.literal('VERSION_CONFLICT') }).strict(),
  z.object({ status: z.literal('UNAVAILABLE') }).strict()
] as const
export const screeningVitalsGetDraftSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('LOADED'),
      draft: publicScreeningVitalsDraftSchema.nullable()
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])
export const screeningVitalsSaveDraftSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('SAVED'),
      draft: publicScreeningVitalsDraftSchema
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])
export const screeningVitalsCompleteStepSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('COMPLETED'),
      draft: publicScreeningVitalsDraftSchema
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])
export const screeningEncounterCompleteSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('COMPLETED'),
      encounter: publicCompletedScreeningEncounterSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('ALREADY_COMPLETED'),
      encounter: publicCompletedScreeningEncounterSummarySchema
    })
    .strict(),
  z
    .object({
      status: z.literal('INCOMPLETE'),
      section: screeningCompletionSectionSchema
    })
    .strict(),
  ...screeningVitalsControlledStatusSchemas
])

export const screeningEncounterIpcErrorCodeSchema = z.enum([
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR'
])

export type ScreeningEncounterIpcErrorCode = z.infer<typeof screeningEncounterIpcErrorCodeSchema>

export const screeningEncounterSafeErrorMessages = {
  IPC_FORBIDDEN: safeIpcErrorMessages.IPC_FORBIDDEN,
  IPC_UNAVAILABLE: safeIpcErrorMessages.IPC_UNAVAILABLE,
  INTERNAL_ERROR: safeIpcErrorMessages.INTERNAL_ERROR
} as const satisfies Record<ScreeningEncounterIpcErrorCode, string>

export const screeningEncounterFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createScreeningEncounterErrorSchema('IPC_FORBIDDEN'),
      createScreeningEncounterErrorSchema('IPC_UNAVAILABLE'),
      createScreeningEncounterErrorSchema('INTERNAL_ERROR')
    ])
  })
  .strict()

export const screeningEncounterStartResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningEncounterStartSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningVitalsGetDraftResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningVitalsGetDraftSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningVitalsSaveDraftResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningVitalsSaveDraftSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningVitalsCompleteStepResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningVitalsCompleteStepSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)
export const screeningEncounterCompleteResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningEncounterCompleteSuccessDataSchema),
    screeningEncounterFailureSchema
  ])
)

export type ScreeningEncounterStatus = z.infer<typeof screeningEncounterStatusSchema>
export type ScreeningEncounterStartRequest = z.infer<typeof screeningEncounterStartRequestSchema>
export type ScreeningCompletionSection = z.infer<typeof screeningCompletionSectionSchema>
export type ScreeningEncounterCompleteRequest = z.infer<
  typeof screeningEncounterCompleteRequestSchema
>
export type PublicScreeningEncounterStartSummary = z.infer<
  typeof publicScreeningEncounterStartSummarySchema
>
export type PublicCompletedScreeningEncounterSummary = z.infer<
  typeof publicCompletedScreeningEncounterSummarySchema
>
export type ScreeningEncounterCompleteSuccessData = z.infer<
  typeof screeningEncounterCompleteSuccessDataSchema
>
export type ScreeningEncounterCompleteResult = z.infer<
  typeof screeningEncounterCompleteResultSchema
>
export type ScreeningEncounterStartSuccessData = z.infer<
  typeof screeningEncounterStartSuccessDataSchema
>
export type ScreeningEncounterStartResult = z.infer<typeof screeningEncounterStartResultSchema>
export type ScreeningVitalsDraftStatus = z.infer<typeof screeningVitalsDraftStatusSchema>
export type ScreeningVitalsMeasurementSite = z.infer<typeof screeningVitalsMeasurementSiteSchema>
export type ScreeningVitalsPatientPosition = z.infer<typeof screeningVitalsPatientPositionSchema>
export type ScreeningVitalsDraftReadingRequest = z.infer<
  typeof screeningVitalsDraftReadingRequestSchema
>
export type ScreeningVitalsGetDraftRequest = z.infer<typeof screeningVitalsGetDraftRequestSchema>
export type ScreeningVitalsSaveDraftRequest = z.infer<typeof screeningVitalsSaveDraftRequestSchema>
export type PublicScreeningVitalsDraft = z.infer<typeof publicScreeningVitalsDraftSchema>
export type ScreeningVitalsGetDraftSuccessData = z.infer<
  typeof screeningVitalsGetDraftSuccessDataSchema
>
export type ScreeningVitalsSaveDraftSuccessData = z.infer<
  typeof screeningVitalsSaveDraftSuccessDataSchema
>
export type ScreeningVitalsCompleteStepSuccessData = z.infer<
  typeof screeningVitalsCompleteStepSuccessDataSchema
>
export type ScreeningVitalsGetDraftResult = z.infer<typeof screeningVitalsGetDraftResultSchema>
export type ScreeningVitalsSaveDraftResult = z.infer<typeof screeningVitalsSaveDraftResultSchema>
export type ScreeningVitalsCompleteStepResult = z.infer<
  typeof screeningVitalsCompleteStepResultSchema
>

export function createScreeningEncounterIpcFailure<TCode extends ScreeningEncounterIpcErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof screeningEncounterSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: screeningEncounterSafeErrorMessages[code]
    }
  }
}

export function createScreeningEncounterStartStatusResult<
  TStatus extends Exclude<
    ScreeningEncounterStartSuccessData['status'],
    'STARTED' | 'ALREADY_EXISTS'
  >
>(
  status: TStatus
): {
  ok: true
  data: { status: TStatus }
} {
  return createIpcSuccess({ status })
}

export function createScreeningVitalsGetDraftLoadedResult(
  draft: PublicScreeningVitalsDraft | null
): {
  ok: true
  data: { status: 'LOADED'; draft: PublicScreeningVitalsDraft | null }
} {
  return createIpcSuccess({ status: 'LOADED', draft })
}

export function createScreeningVitalsSaveDraftStatusResult<
  TStatus extends Exclude<ScreeningVitalsSaveDraftSuccessData['status'], 'SAVED'>
>(
  status: TStatus
): {
  ok: true
  data: { status: TStatus }
} {
  return createIpcSuccess({ status })
}

export function createScreeningVitalsCompleteStepStatusResult<
  TStatus extends Exclude<ScreeningVitalsCompleteStepSuccessData['status'], 'COMPLETED'>
>(
  status: TStatus
): {
  ok: true
  data: { status: TStatus }
} {
  return createIpcSuccess({ status })
}

function createScreeningEncounterErrorSchema<TCode extends ScreeningEncounterIpcErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof screeningEncounterSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(screeningEncounterSafeErrorMessages[code])
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
  return z.preprocess((value) => copySafeTransportValue(value), schema)
}

function copySafeTransportValue(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null) {
    return null
  }

  let valueType: string

  try {
    valueType = typeof value
  } catch {
    return unsafeTransportValue
  }

  if (valueType !== 'object') {
    return isRejectedPrimitive(value) ? unsafeTransportValue : value
  }

  let isArrayValue: boolean

  try {
    isArrayValue = Array.isArray(value as object)
  } catch {
    return unsafeTransportValue
  }

  const objectValue = value as object

  if (active.has(objectValue)) {
    return unsafeTransportValue
  }

  active.add(objectValue)

  try {
    if (isArrayValue) {
      return copySafeTransportArray(objectValue, active)
    }

    let prototype: object | null
    let descriptors: PropertyDescriptorMap

    try {
      prototype = Object.getPrototypeOf(objectValue)
      descriptors = Object.getOwnPropertyDescriptors(objectValue)
    } catch {
      return unsafeTransportValue
    }

    if (prototype !== Object.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
      return unsafeTransportValue
    }

    const copy: Record<string, unknown> = {}

    for (const key of Object.getOwnPropertyNames(descriptors)) {
      const descriptor = descriptors[key]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return unsafeTransportValue
      }

      const copiedValue = copySafeTransportValue(descriptor.value, active)

      if (copiedValue === unsafeTransportValue) {
        return unsafeTransportValue
      }

      Object.defineProperty(copy, key, {
        value: copiedValue,
        enumerable: true,
        writable: true,
        configurable: true
      })
    }

    return copy
  } finally {
    active.delete(objectValue)
  }
}

function copySafeTransportArray(value: object, active: WeakSet<object>): unknown {
  let prototype: object | null
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return unsafeTransportValue
  }

  if (prototype !== Array.prototype || Object.getOwnPropertySymbols(descriptors).length > 0) {
    return unsafeTransportValue
  }

  const lengthDescriptor = descriptors['length']

  if (
    lengthDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    typeof lengthDescriptor.value !== 'number' ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return unsafeTransportValue
  }

  const length = lengthDescriptor.value
  const copy: unknown[] = []

  for (const key of Object.getOwnPropertyNames(descriptors)) {
    if (key === 'length') {
      continue
    }

    if (!/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= length) {
      return unsafeTransportValue
    }
  }

  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      return unsafeTransportValue
    }

    const copiedValue = copySafeTransportValue(descriptor.value, active)

    if (copiedValue === unsafeTransportValue) {
      return unsafeTransportValue
    }

    copy.push(copiedValue)
  }

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
