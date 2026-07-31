import type { NavigationPolicy } from '@main/app/navigation-policy'
import type {
  ActiveLocalSessionContext,
  LocalAuthenticationSessionService
} from '@main/application'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import type { LocalUserRole } from '@main/database'
import {
  createAuthenticationFailure,
  type AuthenticationErrorCode,
  type AuthenticationFailure
} from '@shared/ipc'

import {
  getAuthenticationIpcFailureCode,
  type AuthenticationIpcOperationalLogger
} from './authentication-ipc-errors'

export type AuthenticatedAuthorizationResult =
  | {
      readonly ok: true
      readonly context: ActiveLocalSessionContext
    }
  | {
      readonly ok: false
      readonly failure: AuthenticationFailure
    }

export interface AuthenticatedHandlerAuthorization {
  requireActiveSession(event: IpcSenderValidationEvent): AuthenticatedAuthorizationResult
  requireAnyRole(
    event: IpcSenderValidationEvent,
    allowedRoles: readonly LocalUserRole[]
  ): AuthenticatedAuthorizationResult
}

export interface AuthenticatedHandlerAuthorizationOptions {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly logger?: AuthenticationIpcOperationalLogger
}

export function createAuthenticatedHandlerAuthorization({
  navigationPolicy,
  authenticationSessionService
}: AuthenticatedHandlerAuthorizationOptions): AuthenticatedHandlerAuthorization {
  return Object.freeze({
    requireActiveSession(event: IpcSenderValidationEvent): AuthenticatedAuthorizationResult {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        return createAuthorizationFailure('IPC_FORBIDDEN')
      }

      try {
        return Object.freeze({
          ok: true as const,
          context: authenticationSessionService.requireActiveSession()
        })
      } catch (error) {
        return createAuthorizationFailure(getAuthenticationIpcFailureCode(error))
      }
    },

    requireAnyRole(
      event: IpcSenderValidationEvent,
      allowedRoles: readonly LocalUserRole[]
    ): AuthenticatedAuthorizationResult {
      if (!isIpcSenderAllowed(event, navigationPolicy)) {
        return createAuthorizationFailure('IPC_FORBIDDEN')
      }

      try {
        return Object.freeze({
          ok: true as const,
          context: authenticationSessionService.requireAnyRole(allowedRoles)
        })
      } catch (error) {
        return createAuthorizationFailure(getAuthenticationIpcFailureCode(error))
      }
    }
  })
}

function createAuthorizationFailure(
  code: AuthenticationErrorCode
): AuthenticatedAuthorizationResult {
  return Object.freeze({
    ok: false as const,
    failure: createAuthenticationFailure(code) as AuthenticationFailure
  })
}
