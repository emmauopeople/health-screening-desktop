import { z } from 'zod'

import { createIpcSuccessResultSchema, safeIpcErrorMessages } from './result'

const unsafeTransportValue = Symbol('UnsafeScreeningLifestyleIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const lifestyleDatePattern = /^\d{4}-\d{2}-\d{2}$/u

export const screeningLifestyleUuidSchema = z.string().uuid()
export const screeningLifestyleUtcTimestampSchema = z.string().regex(utcTimestampPattern)
export const screeningLifestyleDateSchema = z.string().regex(lifestyleDatePattern)
export const screeningLifestyleVersionSchema = z.number().int().min(1).safe()
export const screeningLifestyleNullableVersionSchema = screeningLifestyleVersionSchema.nullable()
export const screeningLifestyleTextSchema = z.string().max(500)

const responseSchema = z.enum([
  'YES',
  'NO',
  'UNKNOWN',
  'DECLINED',
  'NOT_APPLICABLE',
  'PREFER_NOT_TO_ANSWER'
])
const alcoholStatusSchema = z.enum(['CURRENT', 'FORMER', 'NEVER', 'UNKNOWN', 'DECLINED'])
const alcoholEverSchema = z.enum(['YES', 'NO', 'UNKNOWN', 'DECLINED'])
const beverageTypeSchema = z.enum([
  'BEER',
  'WINE',
  'SPIRITS',
  'COCKTAILS',
  'FORTIFIED_WINE',
  'OTHER'
])
const tobaccoStatusSchema = z.enum([
  'CURRENT_DAILY',
  'CURRENT_SOME_DAYS',
  'FORMER',
  'NEVER',
  'UNKNOWN',
  'DECLINED'
])
const tobaccoEverSchema = z.enum(['YES', 'NO', 'UNKNOWN', 'DECLINED'])
const tobaccoFrequencySchema = z.enum([
  'EVERY_DAY',
  'SOME_DAYS',
  'NOT_AT_ALL',
  'UNKNOWN',
  'DECLINED'
])
const tobaccoProductTypeSchema = z.enum([
  'CIGARETTE',
  'ROLLED_TOBACCO',
  'CIGAR_PIPE',
  'SMOKELESS',
  'SNUFF',
  'HOOKAH',
  'VAPE',
  'OTHER'
])
const tobaccoUnitSchema = z.enum([
  'STICKS_CIGARETTES',
  'SESSIONS',
  'PORTIONS',
  'PINS',
  'PODS_CARTRIDGES',
  'OTHER'
])
const activityDomainSchema = z.enum(['WORK_OR_FARMING', 'TRANSPORT', 'HOUSEHOLD', 'EXERCISE'])
const intensitySchema = z.enum(['LIGHT', 'MODERATE', 'VIGOROUS'])
const employmentStatusSchema = z.enum([
  'EMPLOYED',
  'SELF_EMPLOYED',
  'FARMING',
  'STUDENT',
  'HOMEMAKER_CAREGIVER',
  'UNEMPLOYED',
  'RETIRED',
  'UNABLE_TO_WORK',
  'OTHER',
  'DECLINED'
])
const physicalDemandSchema = z.enum([
  'SITTING',
  'STANDING',
  'WALKING',
  'MODERATE_LABOR',
  'HEAVY_LABOR',
  'VARIES'
])
const shiftPatternSchema = z.enum([
  'DAY',
  'EVENING',
  'NIGHT',
  'ROTATING',
  'IRREGULAR',
  'NOT_APPLICABLE',
  'UNKNOWN',
  'DECLINED'
])
const workResponseSchema = z.enum([
  'USUAL',
  'LESS_THAN_USUAL',
  'MORE_THAN_USUAL',
  'NO_WORK',
  'NOT_APPLICABLE',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
])
const physicalActivityResponseSchema = z.enum([
  'YES',
  'NO',
  'UNKNOWN',
  'DECLINED',
  'NOT_APPLICABLE',
  'UNABLE_TO_ANSWER',
  'PREFER_NOT_TO_ANSWER'
])
const sedentaryTimeResponseSchema = z.enum([
  'RECORDED',
  'UNKNOWN',
  'UNABLE_TO_ANSWER',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
])
const otherActivityResponseSchema = z.enum([
  'YES',
  'NO',
  'UNKNOWN',
  'DECLINED',
  'PREFER_NOT_TO_ANSWER'
])
const otherActivityCategorySchema = z.enum([
  'FARMING_GARDENING',
  'HOUSEHOLD',
  'CAREGIVING',
  'COMMUNITY',
  'COMMUTE',
  'SPORT',
  'OTHER'
])
const draftStatusSchema = z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETE'])

const positiveIntegerSchema = z.number().int().min(1).safe()
const nonNegativeNumberSchema = z.number().nonnegative().finite()
const positiveNumberSchema = z.number().positive().finite()
const nullableNonNegativeNumberSchema = nonNegativeNumberSchema.nullable()
const nullableTextSchema = screeningLifestyleTextSchema.nullable()
const idOrNullSchema = screeningLifestyleUuidSchema.nullable()

export const screeningLifestyleAlcoholBaselineRequestSchema = exactObject({
  encounterId: screeningLifestyleUuidSchema,
  expectedBaselineVersion: screeningLifestyleNullableVersionSchema,
  expectedDraftVersion: screeningLifestyleNullableVersionSchema,
  status: alcoholStatusSchema,
  everConsumed: alcoholEverSchema,
  consumedPast12Months: alcoholEverSchema,
  commonBeverageTypes: z.array(beverageTypeSchema).max(20),
  otherBeverageDescription: nullableTextSchema
})
export const screeningLifestyleSaveTobaccoBaselineRequestSchema = exactObject({
  encounterId: screeningLifestyleUuidSchema,
  expectedBaselineVersion: screeningLifestyleNullableVersionSchema,
  expectedDraftVersion: screeningLifestyleNullableVersionSchema,
  status: tobaccoStatusSchema,
  everRegularlyUsed: tobaccoEverSchema,
  formerUseApproximateStopDate: nullableTextSchema,
  currentUseFrequency: tobaccoFrequencySchema,
  productTypes: z.array(tobaccoProductTypeSchema).max(20),
  otherProductDescription: nullableTextSchema
})
export const screeningLifestyleSaveWorkBaselineRequestSchema = exactObject({
  encounterId: screeningLifestyleUuidSchema,
  expectedBaselineVersion: screeningLifestyleNullableVersionSchema,
  expectedDraftVersion: screeningLifestyleNullableVersionSchema,
  status: employmentStatusSchema,
  occupationJobTitle: nullableTextSchema,
  usualPhysicalDemand: physicalDemandSchema.nullable(),
  typicalWorkdaysPerWeek: z.number().int().min(0).max(7).safe().nullable(),
  typicalHoursPerWorkday: z.number().min(0).max(24).finite().nullable(),
  shiftPattern: shiftPatternSchema.nullable(),
  description: nullableTextSchema
})

const alcoholWeeklyRequestSchema = exactObject({
  id: idOrNullSchema,
  weeklyResponse: responseSchema.nullable(),
  drinkingDays: z.number().int().min(0).max(7).safe().nullable(),
  totalStandardizedDrinks: nullableNonNegativeNumberSchema,
  largestOneDayAmount: nullableNonNegativeNumberSchema,
  daysAtLargestAmount: z.number().int().min(0).max(7).safe().nullable(),
  commonBeverageTypes: z.array(beverageTypeSchema).max(20),
  otherBeverageDescription: nullableTextSchema
})
const tobaccoProductRequestSchema = exactObject({
  id: idOrNullSchema,
  sequenceNumber: positiveIntegerSchema,
  productType: tobaccoProductTypeSchema,
  daysUsed: z.number().int().min(1).max(7).safe(),
  averageQuantityPerUseDay: positiveNumberSchema,
  unit: tobaccoUnitSchema,
  secondhandSmokeExposure: z.boolean().nullable(),
  otherProductDescription: nullableTextSchema,
  otherUnitDescription: nullableTextSchema
})
const tobaccoWeeklyRequestSchema = exactObject({
  id: idOrNullSchema,
  weeklyResponse: responseSchema.nullable(),
  products: z.array(tobaccoProductRequestSchema).max(20)
})
const activityRequestSchema = exactObject({
  id: idOrNullSchema,
  sequenceNumber: positiveIntegerSchema,
  activityDomain: activityDomainSchema,
  description: nullableTextSchema,
  intensity: intensitySchema,
  daysInPastSevenDays: z.number().int().min(1).max(7).safe(),
  averageMinutesPerActiveDay: z.number().int().min(1).max(1440).safe()
})
const physicalActivityWeeklyRequestSchema = exactObject({
  id: idOrNullSchema,
  weeklyResponse: physicalActivityResponseSchema.nullable(),
  sedentaryTimeResponse: sedentaryTimeResponseSchema.nullable(),
  sedentaryMinutesPerDay: z.number().int().min(0).max(1439).safe().nullable(),
  activities: z.array(activityRequestSchema).max(20)
})
const workWeeklyRequestSchema = exactObject({
  id: idOrNullSchema,
  weeklyResponse: workResponseSchema.nullable()
})
const otherActivityRequestSchema = exactObject({
  id: idOrNullSchema,
  sequenceNumber: positiveIntegerSchema,
  category: otherActivityCategorySchema,
  description: screeningLifestyleTextSchema,
  daysInPastSevenDays: z.number().int().min(1).max(7).safe(),
  averageMinutesPerDay: z.number().int().min(1).max(1440).safe(),
  intensity: intensitySchema
})

export const screeningLifestyleSaveDraftRequestSchema = exactObject({
  encounterId: screeningLifestyleUuidSchema,
  expectedVersion: screeningLifestyleNullableVersionSchema,
  alcohol: alcoholWeeklyRequestSchema.nullable(),
  tobacco: tobaccoWeeklyRequestSchema.nullable(),
  physicalActivity: physicalActivityWeeklyRequestSchema.nullable(),
  work: workWeeklyRequestSchema.nullable(),
  otherActivityResponse: otherActivityResponseSchema.nullable(),
  otherActivities: z.array(otherActivityRequestSchema).max(50)
})
export const screeningLifestyleCompleteRequestSchema = exactObject({
  encounterId: screeningLifestyleUuidSchema,
  expectedVersion: screeningLifestyleNullableVersionSchema,
  alcohol: alcoholWeeklyRequestSchema.nullable(),
  tobacco: tobaccoWeeklyRequestSchema.nullable(),
  physicalActivity: physicalActivityWeeklyRequestSchema.nullable(),
  work: workWeeklyRequestSchema.nullable(),
  otherActivityResponse: otherActivityResponseSchema.nullable(),
  otherActivities: z.array(otherActivityRequestSchema).max(50),
  alcoholBaselineReviewConfirmedVersionId: idOrNullSchema,
  tobaccoBaselineReviewConfirmedVersionId: idOrNullSchema
})
export const screeningLifestyleGetWorkspaceRequestSchema = exactObject({
  encounterId: screeningLifestyleUuidSchema
})

const publicAlcoholWeeklySchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    weeklyResponse: responseSchema.nullable(),
    drinkingDays: z.number().int().min(0).max(7).safe().nullable(),
    totalStandardizedDrinks: nullableNonNegativeNumberSchema,
    largestOneDayAmount: nullableNonNegativeNumberSchema,
    daysAtLargestAmount: z.number().int().min(0).max(7).safe().nullable(),
    commonBeverageTypes: z.array(beverageTypeSchema),
    otherBeverageDescription: nullableTextSchema,
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicTobaccoProductSchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    sequenceNumber: positiveIntegerSchema,
    productType: tobaccoProductTypeSchema,
    daysUsed: z.number().int().min(1).max(7).safe(),
    averageQuantityPerUseDay: positiveNumberSchema,
    unit: tobaccoUnitSchema,
    secondhandSmokeExposure: z.boolean().nullable(),
    otherProductDescription: nullableTextSchema,
    otherUnitDescription: nullableTextSchema,
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicTobaccoWeeklySchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    weeklyResponse: responseSchema.nullable(),
    products: z.array(publicTobaccoProductSchema),
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicActivitySchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    sequenceNumber: positiveIntegerSchema,
    activityDomain: activityDomainSchema,
    description: nullableTextSchema,
    intensity: intensitySchema,
    daysInPastSevenDays: z.number().int().min(1).max(7).safe(),
    averageMinutesPerActiveDay: z.number().int().min(1).max(1440).safe(),
    weeklyMinutes: z.number().int().positive().safe(),
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicPhysicalActivityWeeklySchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    weeklyResponse: physicalActivityResponseSchema.nullable(),
    sedentaryTimeResponse: sedentaryTimeResponseSchema.nullable(),
    sedentaryMinutesPerDay: z.number().int().min(0).max(1439).safe().nullable(),
    activities: z.array(publicActivitySchema),
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicWorkWeeklySchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    weeklyResponse: workResponseSchema.nullable(),
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicOtherActivitySchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    sequenceNumber: positiveIntegerSchema,
    category: otherActivityCategorySchema,
    description: screeningLifestyleTextSchema,
    daysInPastSevenDays: z.number().int().min(1).max(7).safe(),
    averageMinutesPerDay: z.number().int().min(1).max(1440).safe(),
    intensity: intensitySchema,
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicAlcoholBaselineSchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    version: screeningLifestyleVersionSchema,
    status: alcoholStatusSchema,
    everConsumed: alcoholEverSchema,
    consumedPast12Months: alcoholEverSchema,
    commonBeverageTypes: z.array(beverageTypeSchema),
    otherBeverageDescription: nullableTextSchema,
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicTobaccoBaselineSchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    version: screeningLifestyleVersionSchema,
    status: tobaccoStatusSchema,
    everRegularlyUsed: tobaccoEverSchema,
    formerUseApproximateStopDate: nullableTextSchema,
    currentUseFrequency: tobaccoFrequencySchema,
    productTypes: z.array(tobaccoProductTypeSchema),
    otherProductDescription: nullableTextSchema,
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicWorkBaselineSchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    version: screeningLifestyleVersionSchema,
    status: employmentStatusSchema,
    occupationJobTitle: nullableTextSchema,
    usualPhysicalDemand: physicalDemandSchema.nullable(),
    typicalWorkdaysPerWeek: z.number().int().min(0).max(7).safe().nullable(),
    typicalHoursPerWorkday: z.number().min(0).max(24).finite().nullable(),
    shiftPattern: shiftPatternSchema.nullable(),
    description: nullableTextSchema,
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicDraftSchema = z
  .object({
    id: screeningLifestyleUuidSchema,
    encounterId: screeningLifestyleUuidSchema,
    status: draftStatusSchema,
    rowVersion: screeningLifestyleVersionSchema,
    periodStart: screeningLifestyleDateSchema,
    periodEnd: screeningLifestyleDateSchema,
    alcoholBaselineVersionId: idOrNullSchema,
    tobaccoBaselineVersionId: idOrNullSchema,
    workBaselineVersionId: idOrNullSchema,
    otherActivityResponse: otherActivityResponseSchema.nullable(),
    alcohol: publicAlcoholWeeklySchema.nullable(),
    tobacco: publicTobaccoWeeklySchema.nullable(),
    physicalActivity: publicPhysicalActivityWeeklySchema.nullable(),
    work: publicWorkWeeklySchema.nullable(),
    otherActivities: z.array(publicOtherActivitySchema),
    updatedAt: screeningLifestyleUtcTimestampSchema
  })
  .strict()
const publicWorkspaceSchema = z
  .object({
    encounterId: screeningLifestyleUuidSchema,
    draft: publicDraftSchema.nullable(),
    activeAlcoholBaseline: publicAlcoholBaselineSchema.nullable(),
    activeTobaccoBaseline: publicTobaccoBaselineSchema.nullable(),
    activeWorkBaseline: publicWorkBaselineSchema.nullable(),
    referencedAlcoholBaseline: publicAlcoholBaselineSchema.nullable(),
    referencedTobaccoBaseline: publicTobaccoBaselineSchema.nullable(),
    referencedWorkBaseline: publicWorkBaselineSchema.nullable()
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

export type ScreeningLifestyleIpcErrorCode = 'IPC_FORBIDDEN' | 'IPC_UNAVAILABLE' | 'INTERNAL_ERROR'
export type ScreeningLifestyleControlledStatus = (typeof controlledStatusSchemas)[number]
export type ScreeningLifestyleWorkspace = z.infer<typeof publicWorkspaceSchema>
export type ScreeningLifestyleIpcFailure = {
  readonly ok: false
  readonly error: {
    readonly code: ScreeningLifestyleIpcErrorCode
    readonly message: string
  }
}
type ScreeningLifestyleWorkspaceResult<TStatus extends 'LOADED' | 'SAVED' | 'COMPLETED'> =
  | {
      readonly ok: true
      readonly data:
        | { readonly status: TStatus; readonly workspace: ScreeningLifestyleWorkspace }
        | { readonly status: ScreeningLifestyleControlledStatus }
    }
  | ScreeningLifestyleIpcFailure
export type ScreeningLifestyleGetWorkspaceResult = ScreeningLifestyleWorkspaceResult<'LOADED'>
export type ScreeningLifestyleSaveAlcoholBaselineResult = ScreeningLifestyleWorkspaceResult<'SAVED'>
export type ScreeningLifestyleSaveTobaccoBaselineResult = ScreeningLifestyleWorkspaceResult<'SAVED'>
export type ScreeningLifestyleSaveWorkBaselineResult = ScreeningLifestyleWorkspaceResult<'SAVED'>
export type ScreeningLifestyleSaveDraftResult = ScreeningLifestyleWorkspaceResult<'SAVED'>
export type ScreeningLifestyleCompleteResult = ScreeningLifestyleWorkspaceResult<'COMPLETED'>

function successWithWorkspace(status: 'LOADED' | 'SAVED' | 'COMPLETED'): z.ZodTypeAny {
  return z.object({ status: z.literal(status), workspace: publicWorkspaceSchema }).strict()
}
function resultWithWorkspace(status: 'LOADED' | 'SAVED' | 'COMPLETED'): z.ZodTypeAny {
  return withSafeTransportPreprocess(
    z.discriminatedUnion('ok', [
      createIpcSuccessResultSchema(z.union([successWithWorkspace(status), controlledResultSchema])),
      screeningLifestyleFailureSchema
    ])
  )
}

export const screeningLifestyleFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      lifestyleErrorSchema('IPC_FORBIDDEN'),
      lifestyleErrorSchema('IPC_UNAVAILABLE'),
      lifestyleErrorSchema('INTERNAL_ERROR')
    ])
  })
  .strict()
export const screeningLifestyleGetWorkspaceResultSchema = resultWithWorkspace(
  'LOADED'
) as z.ZodType<ScreeningLifestyleGetWorkspaceResult>
export const screeningLifestyleSaveAlcoholBaselineResultSchema = resultWithWorkspace(
  'SAVED'
) as z.ZodType<ScreeningLifestyleSaveAlcoholBaselineResult>
export const screeningLifestyleSaveTobaccoBaselineResultSchema = resultWithWorkspace(
  'SAVED'
) as z.ZodType<ScreeningLifestyleSaveTobaccoBaselineResult>
export const screeningLifestyleSaveWorkBaselineResultSchema = resultWithWorkspace(
  'SAVED'
) as z.ZodType<ScreeningLifestyleSaveWorkBaselineResult>
export const screeningLifestyleSaveDraftResultSchema = resultWithWorkspace(
  'SAVED'
) as z.ZodType<ScreeningLifestyleSaveDraftResult>
export const screeningLifestyleCompleteResultSchema = resultWithWorkspace(
  'COMPLETED'
) as z.ZodType<ScreeningLifestyleCompleteResult>

export type ScreeningLifestyleGetWorkspaceRequest = z.infer<
  typeof screeningLifestyleGetWorkspaceRequestSchema
>
export type ScreeningLifestyleSaveAlcoholBaselineRequest = z.infer<
  typeof screeningLifestyleAlcoholBaselineRequestSchema
>
export type ScreeningLifestyleSaveTobaccoBaselineRequest = z.infer<
  typeof screeningLifestyleSaveTobaccoBaselineRequestSchema
>
export type ScreeningLifestyleSaveWorkBaselineRequest = z.infer<
  typeof screeningLifestyleSaveWorkBaselineRequestSchema
>
export type ScreeningLifestyleSaveDraftRequest = z.infer<
  typeof screeningLifestyleSaveDraftRequestSchema
>
export type ScreeningLifestyleCompleteRequest = z.infer<
  typeof screeningLifestyleCompleteRequestSchema
>
export type ScreeningLifestyleApi = {
  getWorkspace(
    request: ScreeningLifestyleGetWorkspaceRequest
  ): Promise<ScreeningLifestyleGetWorkspaceResult>
  saveAlcoholBaseline(
    request: ScreeningLifestyleSaveAlcoholBaselineRequest
  ): Promise<ScreeningLifestyleSaveAlcoholBaselineResult>
  saveTobaccoBaseline(
    request: ScreeningLifestyleSaveTobaccoBaselineRequest
  ): Promise<ScreeningLifestyleSaveTobaccoBaselineResult>
  saveWorkBaseline(
    request: ScreeningLifestyleSaveWorkBaselineRequest
  ): Promise<ScreeningLifestyleSaveWorkBaselineResult>
  saveDraft(request: ScreeningLifestyleSaveDraftRequest): Promise<ScreeningLifestyleSaveDraftResult>
  complete(request: ScreeningLifestyleCompleteRequest): Promise<ScreeningLifestyleCompleteResult>
}

export function createScreeningLifestyleIpcFailure(code: ScreeningLifestyleIpcErrorCode): {
  readonly ok: false
  readonly error: {
    readonly code: ScreeningLifestyleIpcErrorCode
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

function lifestyleErrorSchema<TCode extends ScreeningLifestyleIpcErrorCode>(
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
