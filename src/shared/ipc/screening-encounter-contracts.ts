import { z } from 'zod'

import { createIpcSuccess, createIpcSuccessResultSchema, safeIpcErrorMessages } from './result'

const unsafeTransportValue = Symbol('UnsafeScreeningEncounterIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export const screeningEncounterUuidSchema = z.string().uuid()
export const screeningEncounterUtcTimestampSchema = z.string().refine(isUtcTimestamp)
export const screeningEncounterStatusSchema = z.enum(['DRAFT', 'COMPLETED', 'AMENDED', 'VOID'])

export const screeningEncounterStartRequestSchema = exactObject({
  patientId: screeningEncounterUuidSchema,
  screeningSessionId: screeningEncounterUuidSchema
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

export type ScreeningEncounterStatus = z.infer<typeof screeningEncounterStatusSchema>
export type ScreeningEncounterStartRequest = z.infer<typeof screeningEncounterStartRequestSchema>
export type PublicScreeningEncounterStartSummary = z.infer<
  typeof publicScreeningEncounterStartSummarySchema
>
export type ScreeningEncounterStartSuccessData = z.infer<
  typeof screeningEncounterStartSuccessDataSchema
>
export type ScreeningEncounterStartResult = z.infer<typeof screeningEncounterStartResultSchema>

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

  if (isArrayValue) {
    return unsafeTransportValue
  }

  const objectValue = value as object

  if (active.has(objectValue)) {
    return unsafeTransportValue
  }

  active.add(objectValue)

  try {
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
