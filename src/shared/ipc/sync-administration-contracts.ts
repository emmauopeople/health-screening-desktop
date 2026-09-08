import { z } from 'zod'

import { utcTimestampSchema } from './authentication-contracts'
import { createIpcSuccessResultSchema } from './result'

const unsafeTransportValue = Symbol('UnsafeSyncAdministrationIpcTransportValue')

export const syncAdministrationGetStateRequestSchema = exactObject({})
export const syncAdministrationConfigureRequestSchema = exactObject({
  apiBaseUrl: z.string().min(1).max(2048),
  installationToken: z.string().regex(/^chs_inst_v1_[A-Za-z0-9_-]{43}$/)
})

export const syncAdministrationActivityStateSchema = z.enum([
  'NOT_CONFIGURED',
  'UP_TO_DATE',
  'PENDING',
  'SYNCHRONIZING',
  'RETRY_SCHEDULED'
])

const configuredSyncAdministrationConfigurationSchema = z
  .object({
    status: z.literal('CONFIGURED'),
    apiBaseUrl: z.string().url().max(2048),
    tokenPrefix: z.string().regex(/^chs_inst_v1_[A-Za-z0-9_-]{8}$/),
    updatedAt: utcTimestampSchema
  })
  .strict()

export const publicSyncAdministrationConfigurationSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('NOT_CONFIGURED') }).strict(),
  configuredSyncAdministrationConfigurationSchema
])

export const publicSyncAdministrationActivitySchema = z
  .object({
    state: syncAdministrationActivityStateSchema,
    pendingChangeCount: z.number().int().min(0).safe(),
    pendingAcknowledgmentCount: z.number().int().min(0).safe(),
    lastCompletedBatchAt: utcTimestampSchema.nullable(),
    nextRetryAt: utcTimestampSchema.nullable()
  })
  .strict()

export const syncAdministrationGetStateSuccessDataSchema = z
  .object({
    status: z.literal('READY'),
    configuration: publicSyncAdministrationConfigurationSchema,
    activity: publicSyncAdministrationActivitySchema
  })
  .strict()

export const syncAdministrationConfigureSuccessDataSchema = z
  .object({
    status: z.literal('CONFIGURED'),
    configuration: configuredSyncAdministrationConfigurationSchema
  })
  .strict()

export const syncAdministrationSafeErrorMessages = {
  VALIDATION_FAILED: 'The synchronization settings could not be processed.',
  PROTECTION_UNAVAILABLE: 'Secure credential storage is unavailable on this computer.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.',
  AUTH_UNAUTHENTICATED: 'Sign in is required.',
  AUTH_LOCKED: 'The local session is locked.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'A required password change must be completed.',
  AUTHORIZATION_FAILED: 'Only local administrators can manage synchronization.'
} as const

export const syncAdministrationErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'PROTECTION_UNAVAILABLE',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED'
])

export type SyncAdministrationErrorCode = z.infer<typeof syncAdministrationErrorCodeSchema>

export const syncAdministrationFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createErrorSchema('VALIDATION_FAILED'),
      createErrorSchema('PROTECTION_UNAVAILABLE'),
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

export const syncAdministrationGetStateResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(syncAdministrationGetStateSuccessDataSchema),
    syncAdministrationFailureSchema
  ])
)

export const syncAdministrationConfigureResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(syncAdministrationConfigureSuccessDataSchema),
    syncAdministrationFailureSchema
  ])
)

export type SyncAdministrationGetStateRequest = z.infer<
  typeof syncAdministrationGetStateRequestSchema
>
export type SyncAdministrationConfigureRequest = z.infer<
  typeof syncAdministrationConfigureRequestSchema
>
export type SyncAdministrationGetStateResult = z.infer<
  typeof syncAdministrationGetStateResultSchema
>
export type SyncAdministrationConfigureResult = z.infer<
  typeof syncAdministrationConfigureResultSchema
>
export type PublicSyncAdministrationConfiguration = z.infer<
  typeof publicSyncAdministrationConfigurationSchema
>
export type PublicSyncAdministrationActivity = z.infer<
  typeof publicSyncAdministrationActivitySchema
>

export function createSyncAdministrationFailure<TCode extends SyncAdministrationErrorCode>(
  code: TCode
): {
  ok: false
  error: { code: TCode; message: (typeof syncAdministrationSafeErrorMessages)[TCode] }
} {
  return { ok: false, error: { code, message: syncAdministrationSafeErrorMessages[code] } }
}

function createErrorSchema<TCode extends SyncAdministrationErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof syncAdministrationSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(syncAdministrationSafeErrorMessages[code])
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
  if (value === null || typeof value !== 'object') {
    return typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function'
      ? unsafeTransportValue
      : value
  }
  if (active.has(value)) return unsafeTransportValue
  active.add(value)
  try {
    if (Array.isArray(value)) {
      if (value.length > 32) return unsafeTransportValue
      return value.map((item) => copySafeTransportValue(item, active))
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return unsafeTransportValue
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Reflect.ownKeys(descriptors)
    if (keys.length > 32 || keys.some((key) => typeof key !== 'string')) return unsafeTransportValue
    const copied: Record<string, unknown> = {}
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return unsafeTransportValue
      }
      copied[key] = copySafeTransportValue(descriptor.value, active)
    }
    return copied
  } catch {
    return unsafeTransportValue
  } finally {
    active.delete(value)
  }
}
