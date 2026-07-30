import { z } from 'zod'

import { createIpcSuccessResultSchema } from './result'

const unsafeTransportValue = Symbol('UnsafeFirstRunIpcTransportValue')

export const firstRunGetStateRequestSchema = exactObject({})

export const firstRunLocationTypeSchema = z.enum([
  'CHURCH',
  'QUARTER',
  'VILLAGE',
  'COMMUNITY_SITE',
  'OTHER'
])

export const firstRunInitializeRequestSchema = exactObject({
  deploymentName: z.string().max(240),
  timeZone: z.string().max(128),
  administrator: exactObject({
    username: z.string().max(128),
    displayName: z.string().max(240),
    temporaryPassword: z.string().max(256)
  }),
  initialLocation: exactObject({
    name: z.string().max(240),
    locationType: firstRunLocationTypeSchema,
    village: z.string().max(240).nullable(),
    subdivision: z.string().max(240).nullable(),
    region: z.string().max(240).nullable(),
    directions: z.string().max(1000).nullable()
  })
})

export type FirstRunGetStateRequest = z.infer<typeof firstRunGetStateRequestSchema>
export type FirstRunInitializeRequest = z.infer<typeof firstRunInitializeRequestSchema>
export type FirstRunLocationType = z.infer<typeof firstRunLocationTypeSchema>

export const firstRunInconsistencyCodeSchema = z.enum([
  'INSTALLATION_MISSING_WITH_LOCAL_DATA',
  'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR',
  'INSTALLATION_PRESENT_WITHOUT_LOCATION',
  'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR_AND_LOCATION'
])

export type FirstRunPublicInconsistencyCode = z.infer<typeof firstRunInconsistencyCodeSchema>

export const firstRunRequiredStateSchema = z
  .object({
    status: z.literal('REQUIRED')
  })
  .strict()

export const firstRunInitializedStateSchema = z
  .object({
    status: z.literal('INITIALIZED'),
    deploymentName: z.string().min(1).max(120),
    timeZone: z.string().min(1).max(64)
  })
  .strict()

export const firstRunInconsistentStateSchema = z
  .object({
    status: z.literal('INCONSISTENT'),
    code: firstRunInconsistencyCodeSchema
  })
  .strict()

export const firstRunPublicStateSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('status', [
    firstRunRequiredStateSchema,
    firstRunInitializedStateSchema,
    firstRunInconsistentStateSchema
  ])
)

export type FirstRunRequiredState = z.infer<typeof firstRunRequiredStateSchema>
export type FirstRunInitializedState = z.infer<typeof firstRunInitializedStateSchema>
export type FirstRunInconsistentState = z.infer<typeof firstRunInconsistentStateSchema>
export type FirstRunPublicState = z.infer<typeof firstRunPublicStateSchema>

export const firstRunSafeErrorMessages = {
  VALIDATION_FAILED: 'The request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.',
  FIRST_RUN_ALREADY_INITIALIZED: 'Application setup is already complete.',
  FIRST_RUN_STATE_INTEGRITY: 'Application setup state is inconsistent.',
  FIRST_RUN_INITIALIZATION_IN_PROGRESS: 'Application setup is already in progress.',
  FIRST_RUN_INITIALIZATION_FAILED: 'Application setup could not be completed.'
} as const

export const firstRunGetStateErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR'
])

export const firstRunInitializeErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'FIRST_RUN_ALREADY_INITIALIZED',
  'FIRST_RUN_STATE_INTEGRITY',
  'FIRST_RUN_INITIALIZATION_IN_PROGRESS',
  'FIRST_RUN_INITIALIZATION_FAILED'
])

export type FirstRunGetStateErrorCode = z.infer<typeof firstRunGetStateErrorCodeSchema>
export type FirstRunInitializeErrorCode = z.infer<typeof firstRunInitializeErrorCodeSchema>

const firstRunGetStateFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createFirstRunErrorSchema('VALIDATION_FAILED'),
      createFirstRunErrorSchema('IPC_FORBIDDEN'),
      createFirstRunErrorSchema('IPC_UNAVAILABLE'),
      createFirstRunErrorSchema('INTERNAL_ERROR')
    ])
  })
  .strict()

const firstRunInitializeFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createFirstRunErrorSchema('VALIDATION_FAILED'),
      createFirstRunErrorSchema('IPC_FORBIDDEN'),
      createFirstRunErrorSchema('IPC_UNAVAILABLE'),
      createFirstRunErrorSchema('INTERNAL_ERROR'),
      createFirstRunErrorSchema('FIRST_RUN_ALREADY_INITIALIZED'),
      createFirstRunErrorSchema('FIRST_RUN_STATE_INTEGRITY'),
      createFirstRunErrorSchema('FIRST_RUN_INITIALIZATION_IN_PROGRESS'),
      createFirstRunErrorSchema('FIRST_RUN_INITIALIZATION_FAILED')
    ])
  })
  .strict()

export const firstRunGetStateResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(firstRunPublicStateSchema),
    firstRunGetStateFailureSchema
  ])
)

export const firstRunInitializeResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(firstRunInitializedStateSchema),
    firstRunInitializeFailureSchema
  ])
)

export type FirstRunGetStateFailure = z.infer<typeof firstRunGetStateFailureSchema>
export type FirstRunInitializeFailure = z.infer<typeof firstRunInitializeFailureSchema>
export type FirstRunGetStateResult = z.infer<typeof firstRunGetStateResultSchema>
export type FirstRunInitializeResult = z.infer<typeof firstRunInitializeResultSchema>

export function createFirstRunFailure<TCode extends FirstRunInitializeErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof firstRunSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: firstRunSafeErrorMessages[code]
    }
  }
}

function createFirstRunErrorSchema<TCode extends FirstRunInitializeErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof firstRunSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(firstRunSafeErrorMessages[code])
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
  return z.preprocess((value) => {
    return copySafeTransportValue(value)
  }, schema)
}

function copySafeTransportValue(value: unknown, active = new WeakSet<object>()): unknown {
  if (value === null) {
    return null
  }

  if (typeof value !== 'object') {
    return isRejectedPrimitive(value) ? unsafeTransportValue : value
  }

  if (active.has(value)) {
    return unsafeTransportValue
  }

  active.add(value)

  let prototype: object | null
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    active.delete(value)
    return unsafeTransportValue
  }

  if (prototype !== Object.prototype) {
    active.delete(value)
    return unsafeTransportValue
  }

  if (Object.getOwnPropertySymbols(descriptors).length > 0) {
    active.delete(value)
    return unsafeTransportValue
  }

  const copy: Record<string, unknown> = {}

  for (const key of Object.getOwnPropertyNames(descriptors)) {
    const descriptor = descriptors[key]

    if (descriptor === undefined) {
      active.delete(value)
      return unsafeTransportValue
    }

    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      active.delete(value)
      return unsafeTransportValue
    }

    const copiedValue = copySafeTransportValue(descriptor.value, active)

    if (copiedValue === unsafeTransportValue) {
      active.delete(value)
      return unsafeTransportValue
    }

    Object.defineProperty(copy, key, {
      value: copiedValue,
      enumerable: true,
      writable: true,
      configurable: true
    })
  }

  active.delete(value)
  return copy
}

function isRejectedPrimitive(value: unknown): boolean {
  return typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol'
}
