import { z } from 'zod'

import { createIpcSuccessResultSchema, safeIpcErrorMessages } from './result'

const unsafeTransportValue = Symbol('UnsafeScreeningFoodIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const foodDatePattern = /^\d{4}-\d{2}-\d{2}$/u
const foodCatalogCodePattern = /^[A-Z][A-Z0-9_]*$/u
const maximumFoodNameLength = 100
const maximumPreparationNoteLength = 200

export const screeningFoodUuidSchema = z.string().uuid()
export const screeningFoodUtcTimestampSchema = z.string().regex(utcTimestampPattern)
export const screeningFoodDateSchema = z.string().regex(foodDatePattern)
export const screeningFoodVersionSchema = z.number().int().min(1).safe()
export const screeningFoodNullableVersionSchema = screeningFoodVersionSchema.nullable()
export const screeningFoodResponseSchema = z.enum([
  'REPORTED',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
])
export const screeningFoodFrequencyCodeSchema = z.enum([
  '1_DAY',
  '2_TO_3_DAYS',
  '4_TO_6_DAYS',
  'EVERY_DAY'
])
export const screeningFoodCatalogCodeSchema = z
  .string()
  .max(64)
  .regex(foodCatalogCodePattern)
  .refine(isSafeText)
export const screeningFoodNameSchema = z
  .string()
  .refine((value) => value.trim().length > 0)
  .refine((value) => value.trim().length <= maximumFoodNameLength)
  .refine((value) => isSafeText(value.trim()))
export const screeningFoodPreparationNoteSchema = z
  .string()
  .refine((value) => value.trim().length <= maximumPreparationNoteLength)
  .refine((value) => value.trim().length === 0 || isSafeText(value.trim()))

const nullableResponseSchema = screeningFoodResponseSchema.nullable()
const nullableFrequencyCodeSchema = screeningFoodFrequencyCodeSchema.nullable()
const publicPreparationNoteSchema = screeningFoodPreparationNoteSchema.refine(
  (value) => value.trim().length > 0
)
const idOrNullSchema = screeningFoodUuidSchema.nullable()
const positiveIntegerSchema = z.number().int().min(1).safe()

export const screeningFoodGetWorkspaceRequestSchema = exactObject({
  encounterId: screeningFoodUuidSchema
})
const screeningFoodSaveDraftRowRequestSchema = exactObject({
  id: idOrNullSchema,
  sequenceNumber: positiveIntegerSchema,
  catalogCode: screeningFoodCatalogCodeSchema.nullable(),
  foodName: screeningFoodNameSchema,
  frequencyCode: nullableFrequencyCodeSchema,
  preparationNote: screeningFoodPreparationNoteSchema.nullable()
})
export const screeningFoodSaveDraftRequestSchema = exactObject({
  encounterId: screeningFoodUuidSchema,
  expectedVersion: screeningFoodNullableVersionSchema,
  foodResponse: nullableResponseSchema,
  rows: z.array(screeningFoodSaveDraftRowRequestSchema)
})

const publicFoodCatalogItemSchema = z
  .object({
    code: screeningFoodCatalogCodeSchema,
    displayName: screeningFoodNameSchema,
    normalizedSearchName: screeningFoodNameSchema,
    sortOrder: positiveIntegerSchema
  })
  .strict()
const publicFoodRecentSuggestionSchema = z
  .object({
    catalogCode: screeningFoodCatalogCodeSchema.nullable(),
    foodNameSnapshot: screeningFoodNameSchema,
    foodNameNormalized: screeningFoodNameSchema,
    lastRecordedAt: screeningFoodUtcTimestampSchema
  })
  .strict()
const publicFoodDraftRowSchema = z
  .object({
    id: screeningFoodUuidSchema,
    sequenceNumber: positiveIntegerSchema,
    catalogCode: screeningFoodCatalogCodeSchema.nullable(),
    foodNameSnapshot: screeningFoodNameSchema,
    foodNameNormalized: screeningFoodNameSchema,
    frequencyCode: nullableFrequencyCodeSchema,
    preparationNote: publicPreparationNoteSchema.nullable(),
    updatedAt: screeningFoodUtcTimestampSchema
  })
  .strict()
const publicFoodDraftSchema = z
  .object({
    id: screeningFoodUuidSchema,
    encounterId: screeningFoodUuidSchema,
    foodResponse: nullableResponseSchema,
    rowVersion: screeningFoodVersionSchema,
    periodStart: screeningFoodDateSchema,
    periodEnd: screeningFoodDateSchema,
    rows: z.array(publicFoodDraftRowSchema),
    updatedAt: screeningFoodUtcTimestampSchema
  })
  .strict()
const publicFoodWorkspaceSchema = z
  .object({
    encounterId: screeningFoodUuidSchema,
    draft: publicFoodDraftSchema.nullable(),
    catalogItems: z.array(publicFoodCatalogItemSchema),
    recentFoods: z.array(publicFoodRecentSuggestionSchema)
  })
  .strict()

const controlledStatusSchemas = [
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
  controlledStatusSchemas.map((status) =>
    z.object({ status: z.literal(status) }).strict()
  ) as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
)

export type ScreeningFoodIpcErrorCode = 'IPC_FORBIDDEN' | 'IPC_UNAVAILABLE' | 'INTERNAL_ERROR'
export type ScreeningFoodControlledStatus = (typeof controlledStatusSchemas)[number]
export type ScreeningFoodCatalogItem = z.infer<typeof publicFoodCatalogItemSchema>
export type ScreeningFoodRecentSuggestion = z.infer<typeof publicFoodRecentSuggestionSchema>
export type ScreeningFoodDraftRow = z.infer<typeof publicFoodDraftRowSchema>
export type ScreeningFoodDraft = z.infer<typeof publicFoodDraftSchema>
export type ScreeningFoodWorkspace = z.infer<typeof publicFoodWorkspaceSchema>
export type ScreeningFoodResponse = z.infer<typeof screeningFoodResponseSchema>
export type ScreeningFoodFrequencyCode = z.infer<typeof screeningFoodFrequencyCodeSchema>
export type ScreeningFoodIpcFailure = {
  readonly ok: false
  readonly error: {
    readonly code: ScreeningFoodIpcErrorCode
    readonly message: string
  }
}
type ScreeningFoodWorkspaceResult<TStatus extends 'LOADED' | 'SAVED'> =
  | {
      readonly ok: true
      readonly data:
        | { readonly status: TStatus; readonly workspace: ScreeningFoodWorkspace }
        | { readonly status: ScreeningFoodControlledStatus }
    }
  | ScreeningFoodIpcFailure

export type ScreeningFoodGetWorkspaceResult = ScreeningFoodWorkspaceResult<'LOADED'>
export type ScreeningFoodSaveDraftResult = ScreeningFoodWorkspaceResult<'SAVED'>

function successWithWorkspace(status: 'LOADED' | 'SAVED'): z.ZodTypeAny {
  return z.object({ status: z.literal(status), workspace: publicFoodWorkspaceSchema }).strict()
}
function resultWithWorkspace(status: 'LOADED' | 'SAVED'): z.ZodTypeAny {
  return withSafeTransportPreprocess(
    z.discriminatedUnion('ok', [
      createIpcSuccessResultSchema(z.union([successWithWorkspace(status), controlledResultSchema])),
      screeningFoodFailureSchema
    ])
  )
}

export const screeningFoodFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      foodErrorSchema('IPC_FORBIDDEN'),
      foodErrorSchema('IPC_UNAVAILABLE'),
      foodErrorSchema('INTERNAL_ERROR')
    ])
  })
  .strict()
export const screeningFoodGetWorkspaceResultSchema = resultWithWorkspace(
  'LOADED'
) as z.ZodType<ScreeningFoodGetWorkspaceResult>
export const screeningFoodSaveDraftResultSchema = resultWithWorkspace(
  'SAVED'
) as z.ZodType<ScreeningFoodSaveDraftResult>

export type ScreeningFoodGetWorkspaceRequest = z.infer<
  typeof screeningFoodGetWorkspaceRequestSchema
>
export type ScreeningFoodSaveDraftRowRequest = z.infer<
  typeof screeningFoodSaveDraftRowRequestSchema
>
export type ScreeningFoodSaveDraftRequest = z.infer<typeof screeningFoodSaveDraftRequestSchema>
export type ScreeningFoodApi = {
  getWorkspace(request: ScreeningFoodGetWorkspaceRequest): Promise<ScreeningFoodGetWorkspaceResult>
  saveDraft(request: ScreeningFoodSaveDraftRequest): Promise<ScreeningFoodSaveDraftResult>
}

export function createScreeningFoodIpcFailure(code: ScreeningFoodIpcErrorCode): {
  readonly ok: false
  readonly error: {
    readonly code: ScreeningFoodIpcErrorCode
    readonly message: string
  }
} {
  const messages = {
    IPC_FORBIDDEN: safeIpcErrorMessages.IPC_FORBIDDEN,
    IPC_UNAVAILABLE: safeIpcErrorMessages.IPC_UNAVAILABLE,
    INTERNAL_ERROR: safeIpcErrorMessages.INTERNAL_ERROR
  } as const
  return { ok: false as const, error: { code, message: messages[code] } }
}

function exactObject<TShape extends z.ZodRawShape>(
  shape: TShape
): z.ZodType<z.infer<z.ZodObject<TShape>>> {
  return withSafeTransportPreprocess(z.object(shape).strict())
}

function foodErrorSchema<TCode extends ScreeningFoodIpcErrorCode>(
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
  if (typeof value !== 'object') return value
  const objectValue = value as object
  if (active.has(objectValue)) return unsafeTransportValue
  active.add(objectValue)
  try {
    const prototype = Object.getPrototypeOf(objectValue)
    const descriptors = Object.getOwnPropertyDescriptors(objectValue)
    if (prototype !== Object.prototype && prototype !== Array.prototype) return unsafeTransportValue
    if (Object.getOwnPropertySymbols(descriptors).length > 0) return unsafeTransportValue
    if (Array.isArray(objectValue)) {
      const copy: unknown[] = []
      for (const key of Object.getOwnPropertyNames(descriptors)) {
        if (key === 'length') continue
        const descriptor = descriptors[key]
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value'))
          return unsafeTransportValue
        const child = copySafeTransportValue(descriptor.value, active)
        if (child === unsafeTransportValue) return unsafeTransportValue
        copy[Number(key)] = child
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
      copy[key] = child
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
    if ((code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31)) {
      return true
    }
    if (code === 127) return true
  }
  return false
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }
  return false
}
