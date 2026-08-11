import { z } from 'zod'

import { createIpcSuccessResultSchema } from './result'

const unsafeTransportValue = Symbol('UnsafeInstallationSettingsIpcTransportValue')
const maximumInstallationSettingsTransportArrayLength = 250

export const installationSettingsUuidSchema = z.string().uuid()

export const installationSettingsGetConfiguredLocationRequestSchema = exactObject({})
export const installationSettingsListEligibleLocationsRequestSchema = exactObject({})
export const installationSettingsAssignInitialLocationRequestSchema = exactObject({
  locationId: installationSettingsUuidSchema
})
export const installationSettingsReconfigureLocationRequestSchema = exactObject({
  locationId: installationSettingsUuidSchema
})

export const publicInstallationSettingsLocationSchema = z
  .object({
    id: installationSettingsUuidSchema,
    name: z.string().min(1).max(120)
  })
  .strict()

export const installationSettingsGetConfiguredLocationSuccessDataSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('RESOLVED'),
        location: publicInstallationSettingsLocationSchema
      })
      .strict(),
    z.object({ status: z.literal('LOCATION_NOT_CONFIGURED') }).strict(),
    z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
    z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
    z.object({ status: z.literal('UNAVAILABLE') }).strict()
  ]
)

export const installationSettingsListEligibleLocationsSuccessDataSchema = z
  .object({
    status: z.literal('LISTED'),
    locations: z.array(publicInstallationSettingsLocationSchema).max(250)
  })
  .strict()

export const installationSettingsAssignInitialLocationSuccessDataSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('ASSIGNED'),
        location: publicInstallationSettingsLocationSchema
      })
      .strict(),
    z
      .object({
        status: z.literal('UNCHANGED'),
        location: publicInstallationSettingsLocationSchema
      })
      .strict(),
    z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
    z.object({ status: z.literal('FORBIDDEN') }).strict(),
    z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
    z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
    z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
    z.object({ status: z.literal('LOCATION_ALREADY_CONFIGURED') }).strict(),
    z.object({ status: z.literal('ACTIVE_SCREENING_WORK') }).strict(),
    z.object({ status: z.literal('CONFIGURATION_CONFLICT') }).strict(),
    z.object({ status: z.literal('UNAVAILABLE') }).strict()
  ]
)

export const installationSettingsReconfigureLocationSuccessDataSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        status: z.literal('UPDATED'),
        location: publicInstallationSettingsLocationSchema
      })
      .strict(),
    z
      .object({
        status: z.literal('UNCHANGED'),
        location: publicInstallationSettingsLocationSchema
      })
      .strict(),
    z.object({ status: z.literal('AUTHENTICATION_REQUIRED') }).strict(),
    z.object({ status: z.literal('FORBIDDEN') }).strict(),
    z.object({ status: z.literal('VALIDATION_FAILED') }).strict(),
    z.object({ status: z.literal('LOCATION_NOT_CONFIGURED') }).strict(),
    z.object({ status: z.literal('LOCATION_NOT_FOUND') }).strict(),
    z.object({ status: z.literal('LOCATION_INACTIVE') }).strict(),
    z.object({ status: z.literal('ACTIVE_SCREENING_WORK') }).strict(),
    z.object({ status: z.literal('CONFIGURATION_CONFLICT') }).strict(),
    z.object({ status: z.literal('UNAVAILABLE') }).strict()
  ]
)

export const installationSettingsSafeErrorMessages = {
  VALIDATION_FAILED: 'The request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.',
  AUTH_UNAUTHENTICATED: 'Sign in is required.',
  AUTH_LOCKED: 'The local session is locked.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'A required password change must be completed.',
  AUTHORIZATION_FAILED: 'The active session is not authorized for this operation.'
} as const

export const installationSettingsErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export type InstallationSettingsErrorCode = z.infer<typeof installationSettingsErrorCodeSchema>

export const installationSettingsFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createInstallationSettingsErrorSchema('VALIDATION_FAILED'),
      createInstallationSettingsErrorSchema('IPC_FORBIDDEN'),
      createInstallationSettingsErrorSchema('IPC_UNAVAILABLE'),
      createInstallationSettingsErrorSchema('INTERNAL_ERROR'),
      createInstallationSettingsErrorSchema('AUTH_UNAUTHENTICATED'),
      createInstallationSettingsErrorSchema('AUTH_LOCKED'),
      createInstallationSettingsErrorSchema('AUTH_PASSWORD_CHANGE_REQUIRED'),
      createInstallationSettingsErrorSchema('AUTHORIZATION_FAILED')
    ])
  })
  .strict()

export const installationSettingsGetConfiguredLocationResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(installationSettingsGetConfiguredLocationSuccessDataSchema),
    installationSettingsFailureSchema
  ])
)

export const installationSettingsListEligibleLocationsResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(installationSettingsListEligibleLocationsSuccessDataSchema),
    installationSettingsFailureSchema
  ])
)

export const installationSettingsAssignInitialLocationResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(installationSettingsAssignInitialLocationSuccessDataSchema),
    installationSettingsFailureSchema
  ])
)

export const installationSettingsReconfigureLocationResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(installationSettingsReconfigureLocationSuccessDataSchema),
    installationSettingsFailureSchema
  ])
)

export type PublicInstallationSettingsLocation = z.infer<
  typeof publicInstallationSettingsLocationSchema
>
export type InstallationSettingsGetConfiguredLocationRequest = z.infer<
  typeof installationSettingsGetConfiguredLocationRequestSchema
>
export type InstallationSettingsListEligibleLocationsRequest = z.infer<
  typeof installationSettingsListEligibleLocationsRequestSchema
>
export type InstallationSettingsAssignInitialLocationRequest = z.infer<
  typeof installationSettingsAssignInitialLocationRequestSchema
>
export type InstallationSettingsReconfigureLocationRequest = z.infer<
  typeof installationSettingsReconfigureLocationRequestSchema
>
export type InstallationSettingsGetConfiguredLocationSuccessData = z.infer<
  typeof installationSettingsGetConfiguredLocationSuccessDataSchema
>
export type InstallationSettingsListEligibleLocationsSuccessData = z.infer<
  typeof installationSettingsListEligibleLocationsSuccessDataSchema
>
export type InstallationSettingsAssignInitialLocationSuccessData = z.infer<
  typeof installationSettingsAssignInitialLocationSuccessDataSchema
>
export type InstallationSettingsReconfigureLocationSuccessData = z.infer<
  typeof installationSettingsReconfigureLocationSuccessDataSchema
>
export type InstallationSettingsGetConfiguredLocationResult = z.infer<
  typeof installationSettingsGetConfiguredLocationResultSchema
>
export type InstallationSettingsListEligibleLocationsResult = z.infer<
  typeof installationSettingsListEligibleLocationsResultSchema
>
export type InstallationSettingsAssignInitialLocationResult = z.infer<
  typeof installationSettingsAssignInitialLocationResultSchema
>
export type InstallationSettingsReconfigureLocationResult = z.infer<
  typeof installationSettingsReconfigureLocationResultSchema
>

export function createInstallationSettingsFailure<TCode extends InstallationSettingsErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof installationSettingsSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: installationSettingsSafeErrorMessages[code]
    }
  }
}

function createInstallationSettingsErrorSchema<TCode extends InstallationSettingsErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof installationSettingsSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(installationSettingsSafeErrorMessages[code])
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
    if ((value as readonly unknown[]).length > maximumInstallationSettingsTransportArrayLength) {
      return unsafeTransportValue
    }

    const copiedArray = (value as readonly unknown[]).map((item) =>
      copySafeTransportValue(item, active)
    )

    return copiedArray.includes(unsafeTransportValue) ? unsafeTransportValue : copiedArray
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
