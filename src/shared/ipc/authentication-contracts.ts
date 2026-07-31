import { z } from 'zod'

import { createIpcSuccessResultSchema } from './result'

const unsafeTransportValue = Symbol('UnsafeAuthenticationIpcTransportValue')
const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u

export type UtcTimestamp = string & { readonly __brand: 'UtcTimestamp' }

export const localUserRoleSchema = z.enum(['LOCAL_ADMIN', 'NURSE', 'TRAINED_SCREENER'])
export type LocalUserRole = z.infer<typeof localUserRoleSchema>

export const utcTimestampSchema = z.string().refine(isUtcTimestamp) as z.ZodType<UtcTimestamp>

export const authGetSessionRequestSchema = exactObject({})
export const authLockRequestSchema = exactObject({})
export const authLogoutRequestSchema = exactObject({})
export const authRecordActivityRequestSchema = exactObject({})

export const authLoginRequestSchema = exactObject({
  username: z.string().max(128),
  password: z.string().max(256)
})

export const authChangeRequiredPasswordRequestSchema = exactObject({
  currentPassword: z.string().max(256),
  newPassword: z.string().max(256),
  confirmNewPassword: z.string().max(256)
})

export const authUnlockRequestSchema = exactObject({
  password: z.string().max(256)
})

export type AuthGetSessionRequest = z.infer<typeof authGetSessionRequestSchema>
export type AuthLoginRequest = z.infer<typeof authLoginRequestSchema>
export type AuthChangeRequiredPasswordRequest = z.infer<
  typeof authChangeRequiredPasswordRequestSchema
>
export type AuthUnlockRequest = z.infer<typeof authUnlockRequestSchema>
export type AuthLockRequest = z.infer<typeof authLockRequestSchema>
export type AuthLogoutRequest = z.infer<typeof authLogoutRequestSchema>
export type AuthRecordActivityRequest = z.infer<typeof authRecordActivityRequestSchema>

export const publicAuthenticatedUserSchema = z
  .object({
    username: z.string().min(1).max(64),
    displayName: z.string().min(1).max(120),
    role: localUserRoleSchema
  })
  .strict()

export type PublicAuthenticatedUser = z.infer<typeof publicAuthenticatedUserSchema>

export const publicSignedOutSessionSchema = z
  .object({
    status: z.literal('SIGNED_OUT'),
    revision: z.number().int().min(0).safe()
  })
  .strict()

export const publicPasswordChangeRequiredSessionSchema = z
  .object({
    status: z.literal('PASSWORD_CHANGE_REQUIRED'),
    user: publicAuthenticatedUserSchema,
    expiresAt: utcTimestampSchema,
    revision: z.number().int().min(0).safe()
  })
  .strict()

export const publicActiveSessionSchema = z
  .object({
    status: z.literal('ACTIVE'),
    user: publicAuthenticatedUserSchema,
    idleExpiresAt: utcTimestampSchema,
    absoluteExpiresAt: utcTimestampSchema,
    revision: z.number().int().min(0).safe()
  })
  .strict()

export const publicLockedSessionSchema = z
  .object({
    status: z.literal('LOCKED'),
    user: publicAuthenticatedUserSchema,
    reason: z.enum(['MANUAL', 'IDLE_TIMEOUT']),
    absoluteExpiresAt: utcTimestampSchema,
    revision: z.number().int().min(0).safe()
  })
  .strict()

export const publicAuthenticationSessionSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('status', [
    publicSignedOutSessionSchema,
    publicPasswordChangeRequiredSessionSchema,
    publicActiveSessionSchema,
    publicLockedSessionSchema
  ])
)

export type PublicSignedOutAuthenticationSession = z.infer<typeof publicSignedOutSessionSchema>
export type PublicPasswordChangeRequiredAuthenticationSession = z.infer<
  typeof publicPasswordChangeRequiredSessionSchema
>
export type PublicActiveAuthenticationSession = z.infer<typeof publicActiveSessionSchema>
export type PublicLockedAuthenticationSession = z.infer<typeof publicLockedSessionSchema>
export type PublicAuthenticationSession = z.infer<typeof publicAuthenticationSessionSchema>

export const authLoginRejectionReasonSchema = z.enum([
  'INVALID_CREDENTIALS',
  'ACCOUNT_INACTIVE',
  'ACCOUNT_LOCKED'
])

export const authForcedPasswordChangeRejectionReasonSchema = z.enum([
  'CURRENT_PASSWORD_INVALID',
  'ACCOUNT_INACTIVE',
  'ACCOUNT_LOCKED',
  'PASSWORD_CHANGE_NOT_REQUIRED',
  'NEW_PASSWORD_REUSES_CURRENT_PASSWORD',
  'NEW_PASSWORD_CONFIRMATION_MISMATCH'
])

export type AuthLoginRejectionReason = z.infer<typeof authLoginRejectionReasonSchema>
export type AuthForcedPasswordChangeRejectionReason = z.infer<
  typeof authForcedPasswordChangeRejectionReasonSchema
>

export const authLoginRejectedResultSchema = z
  .object({
    status: z.literal('REJECTED'),
    reason: authLoginRejectionReasonSchema,
    retryAt: utcTimestampSchema.nullable()
  })
  .strict()

export const authPasswordChangeRejectedResultSchema = z
  .object({
    status: z.literal('REJECTED'),
    reason: authForcedPasswordChangeRejectionReasonSchema,
    retryAt: utcTimestampSchema.nullable()
  })
  .strict()

export type AuthLoginRejectedResult = z.infer<typeof authLoginRejectedResultSchema>
export type AuthPasswordChangeRejectedResult = z.infer<
  typeof authPasswordChangeRejectedResultSchema
>

export const authLoginSuccessDataSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('status', [
    publicActiveSessionSchema,
    publicPasswordChangeRequiredSessionSchema,
    authLoginRejectedResultSchema
  ])
)

export const authChangeRequiredPasswordSuccessDataSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('status', [
    publicActiveSessionSchema,
    authPasswordChangeRejectedResultSchema
  ])
)

export const authUnlockSuccessDataSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('status', [publicActiveSessionSchema, authLoginRejectedResultSchema])
)

export type AuthLoginSuccessData = z.infer<typeof authLoginSuccessDataSchema>
export type AuthChangeRequiredPasswordSuccessData = z.infer<
  typeof authChangeRequiredPasswordSuccessDataSchema
>
export type AuthUnlockSuccessData = z.infer<typeof authUnlockSuccessDataSchema>

export const authenticationSafeErrorMessages = {
  VALIDATION_FAILED: 'The request could not be processed.',
  IPC_FORBIDDEN: 'This operation is unavailable from the current window.',
  IPC_UNAVAILABLE: 'The desktop service is unavailable.',
  INTERNAL_ERROR: 'The application could not complete the request.',
  AUTH_OPERATION_IN_PROGRESS: 'Another authentication operation is in progress.',
  AUTH_STATE_INTEGRITY: 'The local authentication state is inconsistent.',
  AUTH_CONCURRENCY: 'The authentication result is no longer current.',
  AUTH_UNAUTHENTICATED: 'Sign in is required.',
  AUTH_LOCKED: 'The local session is locked.',
  AUTH_PASSWORD_CHANGE_REQUIRED: 'A required password change must be completed.',
  AUTHORIZATION_FAILED: 'The active session is not authorized for this operation.',
  AUTHENTICATION_UNAVAILABLE: 'Authentication is unavailable.'
} as const

export const authenticationErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'IPC_FORBIDDEN',
  'IPC_UNAVAILABLE',
  'INTERNAL_ERROR',
  'AUTH_OPERATION_IN_PROGRESS',
  'AUTH_STATE_INTEGRITY',
  'AUTH_CONCURRENCY',
  'AUTH_UNAUTHENTICATED',
  'AUTH_LOCKED',
  'AUTH_PASSWORD_CHANGE_REQUIRED',
  'AUTHORIZATION_FAILED',
  'AUTHENTICATION_UNAVAILABLE'
])

export type AuthenticationErrorCode = z.infer<typeof authenticationErrorCodeSchema>

export const authenticationFailureSchema = z
  .object({
    ok: z.literal(false),
    error: z.discriminatedUnion('code', [
      createAuthenticationErrorSchema('VALIDATION_FAILED'),
      createAuthenticationErrorSchema('IPC_FORBIDDEN'),
      createAuthenticationErrorSchema('IPC_UNAVAILABLE'),
      createAuthenticationErrorSchema('INTERNAL_ERROR'),
      createAuthenticationErrorSchema('AUTH_OPERATION_IN_PROGRESS'),
      createAuthenticationErrorSchema('AUTH_STATE_INTEGRITY'),
      createAuthenticationErrorSchema('AUTH_CONCURRENCY'),
      createAuthenticationErrorSchema('AUTH_UNAUTHENTICATED'),
      createAuthenticationErrorSchema('AUTH_LOCKED'),
      createAuthenticationErrorSchema('AUTH_PASSWORD_CHANGE_REQUIRED'),
      createAuthenticationErrorSchema('AUTHORIZATION_FAILED'),
      createAuthenticationErrorSchema('AUTHENTICATION_UNAVAILABLE')
    ])
  })
  .strict()

export type AuthenticationFailure = z.infer<typeof authenticationFailureSchema>

export const authGetSessionResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(publicAuthenticationSessionSchema),
    authenticationFailureSchema
  ])
)

export const authLoginResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(authLoginSuccessDataSchema),
    authenticationFailureSchema
  ])
)

export const authChangeRequiredPasswordResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(authChangeRequiredPasswordSuccessDataSchema),
    authenticationFailureSchema
  ])
)

export const authUnlockResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(authUnlockSuccessDataSchema),
    authenticationFailureSchema
  ])
)

export const authLockResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(publicAuthenticationSessionSchema),
    authenticationFailureSchema
  ])
)

export const authLogoutResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(publicSignedOutSessionSchema),
    authenticationFailureSchema
  ])
)

export const authRecordActivityResultSchema = withSafeTransportPreprocess(
  z.discriminatedUnion('ok', [
    createIpcSuccessResultSchema(publicActiveSessionSchema),
    authenticationFailureSchema
  ])
)

export type AuthGetSessionResult = z.infer<typeof authGetSessionResultSchema>
export type AuthLoginResult = z.infer<typeof authLoginResultSchema>
export type AuthChangeRequiredPasswordResult = z.infer<
  typeof authChangeRequiredPasswordResultSchema
>
export type AuthUnlockResult = z.infer<typeof authUnlockResultSchema>
export type AuthLockResult = z.infer<typeof authLockResultSchema>
export type AuthLogoutResult = z.infer<typeof authLogoutResultSchema>
export type AuthRecordActivityResult = z.infer<typeof authRecordActivityResultSchema>

export type AuthenticationSessionChangedListener = (session: PublicAuthenticationSession) => void

export function createAuthenticationFailure<TCode extends AuthenticationErrorCode>(
  code: TCode
): {
  ok: false
  error: {
    code: TCode
    message: (typeof authenticationSafeErrorMessages)[TCode]
  }
} {
  return {
    ok: false,
    error: {
      code,
      message: authenticationSafeErrorMessages[code]
    }
  }
}

function createAuthenticationErrorSchema<TCode extends AuthenticationErrorCode>(
  code: TCode
): z.ZodObject<{
  code: z.ZodLiteral<TCode>
  message: z.ZodLiteral<(typeof authenticationSafeErrorMessages)[TCode]>
}> {
  return z
    .object({
      code: z.literal(code),
      message: z.literal(authenticationSafeErrorMessages[code])
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

  if (Array.isArray(value)) {
    return unsafeTransportValue
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

function isUtcTimestamp(value: string): value is UtcTimestamp {
  if (!utcTimestampPattern.test(value)) {
    return false
  }

  const parsed = new Date(value)

  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value
}
