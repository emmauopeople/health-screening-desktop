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
  let undeliveredRevision: number | undefined

  function retryUndeliveredSession(session: PublicAuthenticationSession): void {
    if (undeliveredRevision === session.revision) {
      publishSession(session)
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
        retryUndeliveredSession(publicSession)

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

      const before = captureCurrentPublicSessionRevision(channel)

      if (!before.success) {
        return before.failure as AuthLoginResult
      }

      try {
        const result = await authenticationSessionService.login(requestResult.data)
        const data = toAuthenticationLoginData(result)

        const response = createValidatedSuccessResult({
          channel,
          data,
          resultSchema: authLoginResultSchema,
          logger
        }) as AuthLoginResult

        publishSessionIfRevisionChanged(before.revision)

        return response
      } catch (error) {
        const failure = createFailureFromError(channel, logger, error)

        if (isControlledAuthenticationFailure(failure)) {
          publishSessionIfRevisionChanged(before.revision)
        }

        return failure as AuthLoginResult
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

      const before = captureCurrentPublicSessionRevision(channel)

      if (!before.success) {
        return before.failure as AuthChangeRequiredPasswordResult
      }

      try {
        const result = await authenticationSessionService.changeRequiredPassword(requestResult.data)
        const data = toAuthenticationPasswordChangeData(result)

        const response = createValidatedSuccessResult({
          channel,
          data,
          resultSchema: authChangeRequiredPasswordResultSchema,
          logger
        }) as AuthChangeRequiredPasswordResult

        publishSessionIfRevisionChanged(before.revision)

        return response
      } catch (error) {
        const failure = createFailureFromError(channel, logger, error)

        if (isControlledAuthenticationFailure(failure)) {
          publishSessionIfRevisionChanged(before.revision)
        }

        return failure as AuthChangeRequiredPasswordResult
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

      const before = captureCurrentPublicSessionRevision(channel)

      if (!before.success) {
        return before.failure as AuthUnlockResult
      }

      try {
        const result = await authenticationSessionService.unlock(requestResult.data)
        const data = toAuthenticationUnlockData(result)

        const response = createValidatedSuccessResult({
          channel,
          data,
          resultSchema: authUnlockResultSchema,
          logger
        }) as AuthUnlockResult

        publishSessionIfRevisionChanged(before.revision)

        return response
      } catch (error) {
        const failure = createFailureFromError(channel, logger, error)

        if (isControlledAuthenticationFailure(failure)) {
          publishSessionIfRevisionChanged(before.revision)
        }

        return failure as AuthUnlockResult
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

      const before = captureCurrentPublicSessionRevision(channel)

      if (!before.success) {
        return before.failure as AuthLockResult
      }

      try {
        const publicSession = toPublicAuthenticationSession(authenticationSessionService.lock())

        const response = createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authLockResultSchema,
          logger
        }) as AuthLockResult

        publishSessionIfRevisionChanged(before.revision)

        return response
      } catch (error) {
        const failure = createFailureFromError(channel, logger, error)

        if (isControlledAuthenticationFailure(failure)) {
          publishSessionIfRevisionChanged(before.revision)
        }

        return failure as AuthLockResult
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

      const before = captureCurrentPublicSessionRevision(channel)

      if (!before.success) {
        return before.failure as AuthLogoutResult
      }

      try {
        const publicSession = toPublicSignedOutAuthenticationSession(
          authenticationSessionService.logout()
        )

        const response = createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authLogoutResultSchema,
          logger
        }) as AuthLogoutResult

        publishSessionIfRevisionChanged(before.revision)

        return response
      } catch (error) {
        const failure = createFailureFromError(channel, logger, error)

        if (isControlledAuthenticationFailure(failure)) {
          publishSessionIfRevisionChanged(before.revision)
        }

        return failure as AuthLogoutResult
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

      const before = captureCurrentPublicSessionRevision(channel)

      if (!before.success) {
        return before.failure as AuthRecordActivityResult
      }

      try {
        const publicSession = toPublicActiveAuthenticationSession(
          authenticationSessionService.recordActivity()
        )

        const response = createValidatedSuccessResult({
          channel,
          data: publicSession,
          resultSchema: authRecordActivityResultSchema,
          logger
        }) as AuthRecordActivityResult

        publishSessionIfRevisionChanged(before.revision)

        return response
      } catch (error) {
        const failure = createFailureFromError(channel, logger, error)

        if (isControlledAuthenticationFailure(failure)) {
          publishSessionIfRevisionChanged(before.revision)
        }

        return failure as AuthRecordActivityResult
      }
    }
  })

  function captureCurrentPublicSessionRevision(channel: AuthenticationIpcChannel):
    | { readonly success: true; readonly revision: number }
    | {
        readonly success: false
        readonly failure: ReturnType<typeof createAuthenticationIpcFailure>
      } {
    try {
      const session = toPublicAuthenticationSession(authenticationSessionService.getSnapshot())

      return { success: true, revision: session.revision }
    } catch (error) {
      return { success: false, failure: createFailureFromError(channel, logger, error) }
    }
  }

  function publishSessionIfRevisionChanged(beforeRevision: number): void {
    let session: PublicAuthenticationSession

    try {
      session = toPublicAuthenticationSession(authenticationSessionService.getSnapshot())
    } catch {
      return
    }

    if (session.revision !== beforeRevision) {
      publishSession(session)
    }
  }

  function publishSession(session: PublicAuthenticationSession): void {
    let delivered = false

    try {
      delivered = sessionPublisher.publish(session)
    } catch {
      delivered = false
    }

    if (delivered) {
      if (undeliveredRevision === session.revision) {
        undeliveredRevision = undefined
      }

      return
    }

    undeliveredRevision = session.revision
  }
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

function isControlledAuthenticationFailure(
  failure: ReturnType<typeof createAuthenticationIpcFailure>
): boolean {
  return failure.error.code !== 'INTERNAL_ERROR'
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
