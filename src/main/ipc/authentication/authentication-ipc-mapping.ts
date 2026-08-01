import type {
  LocalSessionLoginResult,
  LocalSessionPasswordChangeResult,
  LocalSessionSnapshot,
  LocalSessionUnlockResult
} from '@main/application'
import {
  authChangeRequiredPasswordSuccessDataSchema,
  authLoginSuccessDataSchema,
  authUnlockSuccessDataSchema,
  publicActiveSessionSchema,
  publicAuthenticationSessionSchema,
  publicSignedOutSessionSchema,
  type AuthChangeRequiredPasswordSuccessData,
  type AuthLoginSuccessData,
  type AuthUnlockSuccessData,
  type PublicActiveAuthenticationSession,
  type PublicAuthenticationSession,
  type PublicSignedOutAuthenticationSession
} from '@shared/ipc'

import { AuthenticationIpcResponseValidationError } from './authentication-ipc-errors'

export function toPublicAuthenticationSession(
  snapshot: LocalSessionSnapshot
): PublicAuthenticationSession {
  const user =
    snapshot.status === 'SIGNED_OUT'
      ? undefined
      : Object.freeze({
          username: snapshot.user.username,
          displayName: snapshot.user.displayName,
          role: snapshot.user.role
        })

  const publicSession =
    snapshot.status === 'SIGNED_OUT'
      ? Object.freeze({
          status: 'SIGNED_OUT' as const,
          revision: snapshot.revision
        })
      : snapshot.status === 'PASSWORD_CHANGE_REQUIRED'
        ? Object.freeze({
            status: 'PASSWORD_CHANGE_REQUIRED' as const,
            user: user!,
            expiresAt: snapshot.expiresAt,
            revision: snapshot.revision
          })
        : snapshot.status === 'ACTIVE'
          ? Object.freeze({
              status: 'ACTIVE' as const,
              user: user!,
              idleExpiresAt: snapshot.idleExpiresAt,
              absoluteExpiresAt: snapshot.absoluteExpiresAt,
              revision: snapshot.revision
            })
          : Object.freeze({
              status: 'LOCKED' as const,
              user: user!,
              reason: snapshot.reason,
              absoluteExpiresAt: snapshot.absoluteExpiresAt,
              revision: snapshot.revision
            })

  return parseTrustedOutput(publicAuthenticationSessionSchema, publicSession)
}

export function toPublicActiveAuthenticationSession(
  snapshot: LocalSessionSnapshot
): PublicActiveAuthenticationSession {
  const session = toPublicAuthenticationSession(snapshot)

  return parseTrustedOutput(publicActiveSessionSchema, session)
}

export function toPublicSignedOutAuthenticationSession(
  snapshot: LocalSessionSnapshot
): PublicSignedOutAuthenticationSession {
  const session = toPublicAuthenticationSession(snapshot)

  return parseTrustedOutput(publicSignedOutSessionSchema, session)
}

export function toAuthenticationLoginData(result: LocalSessionLoginResult): AuthLoginSuccessData {
  const data =
    result.status === 'REJECTED'
      ? Object.freeze({
          status: 'REJECTED' as const,
          reason: result.reason,
          retryAt: result.retryAt
        })
      : toPublicAuthenticationSession(result.session)

  return parseTrustedOutput(authLoginSuccessDataSchema, data)
}

export function toAuthenticationPasswordChangeData(
  result: LocalSessionPasswordChangeResult
): AuthChangeRequiredPasswordSuccessData {
  const data =
    result.status === 'REJECTED'
      ? Object.freeze({
          status: 'REJECTED' as const,
          reason: result.reason,
          retryAt: result.retryAt
        })
      : toPublicActiveAuthenticationSession(result.session)

  return parseTrustedOutput(authChangeRequiredPasswordSuccessDataSchema, data)
}

export function toAuthenticationUnlockData(
  result: LocalSessionUnlockResult
): AuthUnlockSuccessData {
  const data =
    result.status === 'REJECTED'
      ? Object.freeze({
          status: 'REJECTED' as const,
          reason: result.reason,
          retryAt: result.retryAt
        })
      : toPublicActiveAuthenticationSession(result.session)

  return parseTrustedOutput(authUnlockSuccessDataSchema, data)
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false }
}

function parseTrustedOutput<TResult>(schema: IpcSchema<TResult>, value: unknown): TResult {
  try {
    const result = schema.safeParse(value)

    if (result.success) {
      return result.data
    }
  } catch {
    // The caller maps this fixed error into a safe INTERNAL_ERROR response.
  }

  throw new AuthenticationIpcResponseValidationError()
}
