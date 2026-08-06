import { z } from 'zod'

import { createIpcSuccessResultSchema } from './result'

const unsafeTransportValue = Symbol('UnsafeScreeningSessionIpcTransportValue')
const maximumScreeningSessionTransportArrayLength = 250
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const localDatePattern = /^\d{4}-\d{2}-\d{2}$/u

export const screeningSessionStatusSchema = z.enum(['OPEN', 'CLOSED'])
export const screeningSessionPageSizeSchema = z.union([
  z.literal(25),
  z.literal(50),
  z.literal(100)
])
export const screeningSessionUuidSchema = z.string().uuid()
export const screeningSessionUtcTimestampSchema = z.string().refine(isUtcTimestamp)
export const screeningSessionLocalDateSchema = z.string().refine(isValidLocalDate)
export const screeningSessionOptionalTextSchema = z.string().refine(isSafeNonblankText).nullable()
export const screeningSessionRequiredTextSchema = z.string().refine(isSafeNonblankText)

export const screeningSessionGetWorkspaceContextRequestSchema = exactObject({})

export const screeningSessionCreateRequestSchema = exactObject({
  locationId: screeningSessionUuidSchema,
  sessionDate: screeningSessionLocalDateSchema,
  notes: screeningSessionOptionalTextSchema.optional()
})

export const screeningSessionCloseRequestSchema = exactObject({
  id: screeningSessionUuidSchema,
  expectedRowVersion: z.number().int().min(1).safe(),
  reason: screeningSessionOptionalTextSchema.optional()
})

export const screeningSessionReopenRequestSchema = exactObject({
  id: screeningSessionUuidSchema,
  expectedRowVersion: z.number().int().min(1).safe(),
  reason: screeningSessionRequiredTextSchema
})

export const screeningSessionGetByIdRequestSchema = exactObject({
  id: screeningSessionUuidSchema
})

export const screeningSessionListRequestSchema = exactObject({
  locationId: screeningSessionUuidSchema.nullable(),
  status: screeningSessionStatusSchema.nullable(),
  dateFrom: screeningSessionLocalDateSchema.nullable(),
  dateTo: screeningSessionLocalDateSchema.nullable(),
  page: z.number().int().min(1).max(10000).safe(),
  pageSize: screeningSessionPageSizeSchema
}).superRefine((request, context) => {
  if (request.dateFrom !== null && request.dateTo !== null && request.dateFrom > request.dateTo) {
    context.addIssue({
      code: 'custom',
      path: ['dateTo'],
      message: 'End date must be on or after start date.'
    })
  }
})

export const publicScreeningSessionSchema = z
  .object({
    id: screeningSessionUuidSchema,
    locationId: screeningSessionUuidSchema,
    protocolVersionId: screeningSessionUuidSchema,
    sessionDate: screeningSessionLocalDateSchema,
    status: screeningSessionStatusSchema,
    notes: screeningSessionOptionalTextSchema,
    openedAt: screeningSessionUtcTimestampSchema,
    closedAt: screeningSessionUtcTimestampSchema.nullable(),
    createdAt: screeningSessionUtcTimestampSchema,
    rowVersion: z.number().int().min(1).safe()
  })
  .strict()
  .superRefine((session, context) => {
    if (session.status === 'OPEN' && session.closedAt !== null) {
      context.addIssue({ code: 'custom', path: ['closedAt'] })
    }

    if (session.status === 'CLOSED' && session.closedAt === null) {
      context.addIssue({ code: 'custom', path: ['closedAt'] })
    }
  })

export const publicScreeningSessionWorkspaceLocationSchema = z
  .object({
    id: screeningSessionUuidSchema,
    name: z.string().min(1).max(120)
  })
  .strict()

export const screeningSessionWorkspaceContextSuccessDataSchema = z
  .object({
    deploymentLocalDate: screeningSessionLocalDateSchema,
    activeLocations: z.array(publicScreeningSessionWorkspaceLocationSchema).max(250)
  })
  .strict()

export const screeningSessionCreateSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('CREATED'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z.object({ status: z.literal('ALREADY_EXISTS') }).strict(),
  z.object({ status: z.literal('SESSION_DATE_NOT_CURRENT') }).strict(),
  z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
  z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
  z.object({ status: z.literal('NO_ACTIVE_PROTOCOL') }).strict()
])

export const screeningSessionCloseSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('CLOSED'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z.object({ status: z.literal('NOT_FOUND') }).strict(),
  z
    .object({
      status: z.literal('SESSION_VERSION_CONFLICT'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('ALREADY_CLOSED'),
      session: publicScreeningSessionSchema
    })
    .strict()
])

export const screeningSessionReopenSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('REOPENED'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z.object({ status: z.literal('NOT_FOUND') }).strict(),
  z
    .object({
      status: z.literal('SESSION_VERSION_CONFLICT'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z
    .object({
      status: z.literal('ALREADY_OPEN'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z.object({ status: z.literal('FORBIDDEN') }).strict()
])

export const screeningSessionGetByIdSuccessDataSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('FOUND'),
      session: publicScreeningSessionSchema
    })
    .strict(),
  z.object({ status: z.literal('NOT_FOUND') }).strict()
])

export const screeningSessionListSuccessDataSchema = z
  .object({
    status: z.literal('LISTED'),
    items: z.array(publicScreeningSessionSchema),
    page: z.number().int().min(1).safe(),
    pageSize: screeningSessionPageSizeSchema,
    total: z.number().int().min(0).safe()
  })
  .strict()

export const screeningSessionSafeErrorMessages = {
  VALIDATION_FAILED: 'The request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.',
  AUTH_UNAUTHENTICATED: 'Sign in is required.',
  AUTH_LOCKED: 'The local session is locked.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'A required password change must be completed.',
  AUTHORIZATION_FAILED: 'The active session is not authorized for this operation.'
} as const

export const screeningSessionErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export type ScreeningSessionErrorCode = z.infer<typeof screeningSessionErrorCodeSchema>

export const screeningSessionFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createScreeningSessionErrorSchema('VALIDATION_FAILED'),
      createScreeningSessionErrorSchema('IPC_FORBIDDEN'),
      createScreeningSessionErrorSchema('IPC_UNAVAILABLE'),
      createScreeningSessionErrorSchema('INTERNAL_ERROR'),
      createScreeningSessionErrorSchema('AUTH_UNAUTHENTICATED'),
      createScreeningSessionErrorSchema('AUTH_LOCKED'),
      createScreeningSessionErrorSchema('AUTH_PASSWORD_CHANGE_REQUIRED'),
      createScreeningSessionErrorSchema('AUTHORIZATION_FAILED')
    ])
  })
  .strict()

export const screeningSessionGetWorkspaceContextResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningSessionWorkspaceContextSuccessDataSchema),
    screeningSessionFailureSchema
  ])
)
export const screeningSessionCreateResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningSessionCreateSuccessDataSchema),
    screeningSessionFailureSchema
  ])
)
export const screeningSessionCloseResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningSessionCloseSuccessDataSchema),
    screeningSessionFailureSchema
  ])
)
export const screeningSessionReopenResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningSessionReopenSuccessDataSchema),
    screeningSessionFailureSchema
  ])
)
export const screeningSessionGetByIdResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningSessionGetByIdSuccessDataSchema),
    screeningSessionFailureSchema
  ])
)
export const screeningSessionListResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(screeningSessionListSuccessDataSchema),
    screeningSessionFailureSchema
  ])
)

export type ScreeningSessionStatus = z.infer<typeof screeningSessionStatusSchema>
export type ScreeningSessionPageSize = z.infer<typeof screeningSessionPageSizeSchema>
export type PublicScreeningSession = z.infer<typeof publicScreeningSessionSchema>
export type PublicScreeningSessionWorkspaceLocation = z.infer<
  typeof publicScreeningSessionWorkspaceLocationSchema
>
export type ScreeningSessionWorkspaceContextSuccessData = z.infer<
  typeof screeningSessionWorkspaceContextSuccessDataSchema
>
export type ScreeningSessionGetWorkspaceContextRequest = z.infer<
  typeof screeningSessionGetWorkspaceContextRequestSchema
>
export type ScreeningSessionCreateRequest = z.infer<typeof screeningSessionCreateRequestSchema>
export type ScreeningSessionCloseRequest = z.infer<typeof screeningSessionCloseRequestSchema>
export type ScreeningSessionReopenRequest = z.infer<typeof screeningSessionReopenRequestSchema>
export type ScreeningSessionGetByIdRequest = z.infer<typeof screeningSessionGetByIdRequestSchema>
export type ScreeningSessionListRequest = z.infer<typeof screeningSessionListRequestSchema>
export type ScreeningSessionGetWorkspaceContextResult = z.infer<
  typeof screeningSessionGetWorkspaceContextResultSchema
>
export type ScreeningSessionCreateResult = z.infer<typeof screeningSessionCreateResultSchema>
export type ScreeningSessionCloseResult = z.infer<typeof screeningSessionCloseResultSchema>
export type ScreeningSessionReopenResult = z.infer<typeof screeningSessionReopenResultSchema>
export type ScreeningSessionGetByIdResult = z.infer<typeof screeningSessionGetByIdResultSchema>
export type ScreeningSessionListResult = z.infer<typeof screeningSessionListResultSchema>
export type ScreeningSessionCreateSuccessData = z.infer<
  typeof screeningSessionCreateSuccessDataSchema
>
export type ScreeningSessionCloseSuccessData = z.infer<
  typeof screeningSessionCloseSuccessDataSchema
>
export type ScreeningSessionReopenSuccessData = z.infer<
  typeof screeningSessionReopenSuccessDataSchema
>
export type ScreeningSessionGetByIdSuccessData = z.infer<
  typeof screeningSessionGetByIdSuccessDataSchema
>
export type ScreeningSessionListSuccessData = z.infer<typeof screeningSessionListSuccessDataSchema>

export function createScreeningSessionFailure<TCode extends ScreeningSessionErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof screeningSessionSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: screeningSessionSafeErrorMessages[code]
    }
  }
}

function createScreeningSessionErrorSchema<TCode extends ScreeningSessionErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof screeningSessionSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(screeningSessionSafeErrorMessages[code])
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

  const objectValue = value as object
  let isArrayValue: boolean

  try {
    isArrayValue = Array.isArray(objectValue)
  } catch {
    return unsafeTransportValue
  }

  if (active.has(objectValue)) {
    return unsafeTransportValue
  }

  active.add(objectValue)

  if (isArrayValue) {
    return copySafeTransportArray(objectValue, active)
  }

  return copySafeTransportObject(objectValue, active)
}

function copySafeTransportArray(value: object, active: WeakSet<object>): unknown {
  try {
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

    if (length > maximumScreeningSessionTransportArrayLength) {
      return unsafeTransportValue
    }

    const propertyNames = Object.getOwnPropertyNames(descriptors)

    if (propertyNames.length !== length + 1) {
      return unsafeTransportValue
    }

    for (const key of propertyNames) {
      if (key !== 'length' && !isCanonicalArrayIndexKey(key, length)) {
        return unsafeTransportValue
      }
    }

    const copy: unknown[] = []

    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]

      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return unsafeTransportValue
      }

      const copied = copySafeTransportValue(descriptor.value, active)

      if (copied === unsafeTransportValue) {
        return unsafeTransportValue
      }

      copy.push(copied)
    }

    return copy
  } finally {
    active.delete(value)
  }
}

function copySafeTransportObject(value: object, active: WeakSet<object>): unknown {
  try {
    let prototype: object | null
    let descriptors: PropertyDescriptorMap

    try {
      prototype = Object.getPrototypeOf(value)
      descriptors = Object.getOwnPropertyDescriptors(value)
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
    active.delete(value)
  }
}

function isCanonicalArrayIndexKey(key: string, length: number): boolean {
  if (key.length === 0 || (key.length > 1 && key[0] === '0')) {
    return false
  }

  const index = Number(key)

  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key
}

function isRejectedPrimitive(value: unknown): boolean {
  return typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol'
}

function isSafeNonblankText(value: string): boolean {
  return (
    Array.from(value).length <= 500 &&
    value.trim().length > 0 &&
    !hasUnpairedSurrogate(value) &&
    !hasUnsafeTextCharacter(value)
  )
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)

    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1)

      if (Number.isNaN(nextCodeUnit) || nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
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
