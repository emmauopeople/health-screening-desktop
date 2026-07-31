import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import type { LocalAuthenticationSessionService } from '@main/application'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  authChangeRequiredPasswordRequestSchema,
  authChangeRequiredPasswordResultSchema,
  authGetSessionRequestSchema,
  authGetSessionResultSchema,
  authLockRequestSchema,
  authLockResultSchema,
  authLoginRequestSchema,
  authLoginResultSchema,
  authLogoutRequestSchema,
  authLogoutResultSchema,
  authRecordActivityRequestSchema,
  authRecordActivityResultSchema,
  authUnlockRequestSchema,
  authUnlockResultSchema,
  createIpcSuccess,
  ipcChannels,
  type AuthChangeRequiredPasswordResult,
  type AuthGetSessionResult,
  type AuthLockResult,
  type AuthLoginResult,
  type AuthLogoutResult,
  type AuthRecordActivityResult,
  type AuthenticationIpcChannel,
  type AuthUnlockResult,
  type PublicAuthenticationSession
} from '@shared/ipc'

import {
  createAuthenticationIpcFailure,
  getAuthenticationIpcFailureCode,
  logAuthenticationIpcFailure,
  type AuthenticationIpcOperationalLogger
} from './authentication-ipc-errors'
import {
  toAuthenticationLoginData,
  toAuthenticationPasswordChangeData,
  toAuthenticationUnlockData,
  toPublicActiveAuthenticationSession,
  toPublicAuthenticationSession,
  toPublicSignedOutAuthenticationSession
} from './authentication-ipc-mapping'
import type { AuthenticationSessionPublisher } from './authentication-session-publisher'

export interface AuthenticationIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly sessionPublisher: AuthenticationSessionPublisher
  readonly logger?: AuthenticationIpcOperationalLogger
}

export interface AuthenticationIpcHandlers {
  getSession(event: IpcSenderValidationEvent, request: unknown): Promise<AuthGetSessionResult>
  login(event: IpcSenderValidationEvent, request: unknown): Promise<AuthLoginResult>
  changeRequiredPassword(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<AuthChangeRequiredPasswordResult>
  unlock(event: IpcSenderValidationEvent, request: unknown): Promise<AuthUnlockResult>
  lock(event: IpcSenderValidationEvent, request: unknown): Promise<AuthLockResult>
  logout(event: IpcSenderValidationEvent, request: unknown): Promise<AuthLogoutResult>
  recordActivity(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<AuthRecordActivityResult>
}

export function createAuthenticationIpcHandlers({
  navigationPolicy,
  authenticationSessionService,
  sessionPublisher,
  logger = console
}: AuthenticationIpcHandlerDependencies): AuthenticationIpcHandlers {
  let lastObservedRevision: number | undefined

  function observeSession(
    session: PublicAuthenticationSession,
    publishWhenUnobserved: boolean
  ): void {
    const previousRevision = lastObservedRevision
    lastObservedRevision = session.revision

    if (
      (previousRevision === undefined && publishWhenUnobserved) ||
      (previousRevision !== undefined && previousRevision !== session.revision)
    ) {
      sessionPublisher.publish(session)
    }
  }

  return Object.freeze({
    async getSession(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<AuthGetSessionResult> {
      const channel = ipcChannels.auth.getSession

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthGetSessionResult
      }

      const requestResult = safeParseIpcValue(authGetSessionRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure('VALIDATION_FAILED') as AuthGetSessionResult
      }

      try {
        const publicSession = toPublicAuthenticationSession(
          authenticationSessionService.getSnapshot()
        )
        observeSession(publicSession, false)

        return createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authGetSessionResultSchema,
          logger
        }) as AuthGetSessionResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthGetSessionResult
      }
    },

    async login(event: IpcSenderValidationEvent, request: unknown): Promise<AuthLoginResult> {
      const channel = ipcChannels.auth.login

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthLoginResult
      }

      const requestResult = safeParseIpcValue(authLoginRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure('VALIDATION_FAILED') as AuthLoginResult
      }

      try {
        const result = await authenticationSessionService.login(requestResult.data)
        const data = toAuthenticationLoginData(result)

        if (data.status !== 'REJECTED') {
          observeSession(data, true)
        }

        return createValidatedSuccessResult({
          channel,
          data,
          resultSchema: authLoginResultSchema,
          logger
        }) as AuthLoginResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthLoginResult
      }
    },

    async changeRequiredPassword(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<AuthChangeRequiredPasswordResult> {
      const channel = ipcChannels.auth.changeRequiredPassword

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthChangeRequiredPasswordResult
      }

      const requestResult = safeParseIpcValue(authChangeRequiredPasswordRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure(
          'VALIDATION_FAILED'
        ) as AuthChangeRequiredPasswordResult
      }

      try {
        const result = await authenticationSessionService.changeRequiredPassword(requestResult.data)
        const data = toAuthenticationPasswordChangeData(result)

        if (data.status !== 'REJECTED') {
          observeSession(data, true)
        }

        return createValidatedSuccessResult({
          channel,
          data,
          resultSchema: authChangeRequiredPasswordResultSchema,
          logger
        }) as AuthChangeRequiredPasswordResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthChangeRequiredPasswordResult
      }
    },

    async unlock(event: IpcSenderValidationEvent, request: unknown): Promise<AuthUnlockResult> {
      const channel = ipcChannels.auth.unlock

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthUnlockResult
      }

      const requestResult = safeParseIpcValue(authUnlockRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure('VALIDATION_FAILED') as AuthUnlockResult
      }

      try {
        const result = await authenticationSessionService.unlock(requestResult.data)
        const data = toAuthenticationUnlockData(result)

        if (data.status !== 'REJECTED') {
          observeSession(data, true)
        }

        return createValidatedSuccessResult({
          channel,
          data,
          resultSchema: authUnlockResultSchema,
          logger
        }) as AuthUnlockResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthUnlockResult
      }
    },

    async lock(event: IpcSenderValidationEvent, request: unknown): Promise<AuthLockResult> {
      const channel = ipcChannels.auth.lock

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthLockResult
      }

      const requestResult = safeParseIpcValue(authLockRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure('VALIDATION_FAILED') as AuthLockResult
      }

      try {
        const publicSession = toPublicAuthenticationSession(authenticationSessionService.lock())
        observeSession(publicSession, true)

        return createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authLockResultSchema,
          logger
        }) as AuthLockResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthLockResult
      }
    },

    async logout(event: IpcSenderValidationEvent, request: unknown): Promise<AuthLogoutResult> {
      const channel = ipcChannels.auth.logout

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthLogoutResult
      }

      const requestResult = safeParseIpcValue(authLogoutRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure('VALIDATION_FAILED') as AuthLogoutResult
      }

      try {
        const publicSession = toPublicSignedOutAuthenticationSession(
          authenticationSessionService.logout()
        )
        observeSession(publicSession, true)

        return createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authLogoutResultSchema,
          logger
        }) as AuthLogoutResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthLogoutResult
      }
    },

    async recordActivity(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<AuthRecordActivityResult> {
      const channel = ipcChannels.auth.recordActivity

      if (!isAuthenticationSenderAllowed(event, navigationPolicy, logger, channel)) {
        return createAuthenticationIpcFailure('IPC_FORBIDDEN') as AuthRecordActivityResult
      }

      const requestResult = safeParseIpcValue(authRecordActivityRequestSchema, request)

      if (!requestResult.success) {
        logAuthenticationIpcFailure(logger, channel, 'VALIDATION_FAILED')
        return createAuthenticationIpcFailure('VALIDATION_FAILED') as AuthRecordActivityResult
      }

      try {
        const publicSession = toPublicActiveAuthenticationSession(
          authenticationSessionService.recordActivity()
        )
        observeSession(publicSession, true)

        return createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authRecordActivityResultSchema,
          logger
        }) as AuthRecordActivityResult
      } catch (error) {
        return createFailureFromError(channel, logger, error) as AuthRecordActivityResult
      }
    }
  })
}

function isAuthenticationSenderAllowed(
  event: IpcSenderValidationEvent,
  navigationPolicy: NavigationPolicy,
  logger: AuthenticationIpcOperationalLogger,
  channel: AuthenticationIpcChannel
): boolean {
  if (isIpcSenderAllowed(event, navigationPolicy)) {
    return true
  }

  logAuthenticationIpcFailure(logger, channel, 'IPC_FORBIDDEN')
  return false
}

function createFailureFromError(
  channel: AuthenticationIpcChannel,
  logger: AuthenticationIpcOperationalLogger,
  error: unknown
): ReturnType<typeof createAuthenticationIpcFailure> {
  const code = getAuthenticationIpcFailureCode(error)
  logAuthenticationIpcFailure(logger, channel, code, error)

  return createAuthenticationIpcFailure(code)
}

function createValidatedSuccessResult<TResult>({
  channel,
  data,
  resultSchema,
  logger
}: {
  readonly channel: AuthenticationIpcChannel
  readonly data: unknown
  readonly resultSchema: IpcSchema<TResult>
  readonly logger: AuthenticationIpcOperationalLogger
}): TResult {
  const envelope = createIpcSuccess(data)
  const envelopeResult = safeParseIpcValue(resultSchema, envelope)

  if (envelopeResult.success) {
    return envelopeResult.data
  }

  logAuthenticationIpcFailure(logger, channel, 'INTERNAL_ERROR')
  return createAuthenticationIpcFailure('INTERNAL_ERROR') as TResult
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false; error?: unknown }
}

function safeParseIpcValue<TResult>(
  schema: z.ZodType<TResult> | IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false; error?: unknown } {
  try {
    return schema.safeParse(value)
  } catch (error) {
    return { success: false, error }
  }
}
