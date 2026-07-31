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
  createAuthenticationFailure,
  ipcChannels,
  publicAuthenticationSessionSchema,
  type AuthChangeRequiredPasswordRequest,
  type AuthChangeRequiredPasswordResult,
  type AuthGetSessionResult,
  type AuthLockResult,
  type AuthLoginRequest,
  type AuthLoginResult,
  type AuthLogoutResult,
  type AuthRecordActivityResult,
  type AuthenticationSessionChangedListener,
  type AuthUnlockRequest,
  type AuthUnlockResult,
  type PublicAuthenticationSession
} from '@shared/ipc'

export type IpcInvoke = (channel: string, request: unknown) => Promise<unknown>
export type IpcUnsubscribe = () => void
export type IpcSubscribe = (channel: string, listener: (payload: unknown) => void) => IpcUnsubscribe

export interface PreloadAuthenticationApi {
  getSession(): Promise<AuthGetSessionResult>
  login(request: AuthLoginRequest): Promise<AuthLoginResult>
  changeRequiredPassword(
    request: AuthChangeRequiredPasswordRequest
  ): Promise<AuthChangeRequiredPasswordResult>
  unlock(request: AuthUnlockRequest): Promise<AuthUnlockResult>
  lock(): Promise<AuthLockResult>
  logout(): Promise<AuthLogoutResult>
  recordActivity(): Promise<AuthRecordActivityResult>
  onSessionChanged(listener: AuthenticationSessionChangedListener): () => void
}

export function createAuthenticationApi({
  invoke,
  subscribe = unavailableSubscribe
}: {
  readonly invoke: IpcInvoke
  readonly subscribe?: IpcSubscribe
}): PreloadAuthenticationApi {
  return Object.freeze({
    getSession: () =>
      invokeValidated<AuthGetSessionResult>({
        invoke,
        channel: ipcChannels.auth.getSession,
        request: authGetSessionRequestSchema.parse({}),
        resultSchema: authGetSessionResultSchema,
        unavailableResult: createAuthenticationFailure('IPC_UNAVAILABLE') as AuthGetSessionResult
      }),
    login: (request: AuthLoginRequest) => {
      const requestResult = safeParseIpcValue(authLoginRequestSchema, request)

      if (!requestResult.success) {
        return Promise.resolve(
          freezeIpcResult(createAuthenticationFailure('VALIDATION_FAILED') as AuthLoginResult)
        )
      }

      return invokeValidated<AuthLoginResult>({
        invoke,
        channel: ipcChannels.auth.login,
        request: requestResult.data,
        resultSchema: authLoginResultSchema,
        unavailableResult: createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLoginResult
      })
    },
    changeRequiredPassword: (request: AuthChangeRequiredPasswordRequest) => {
      const requestResult = safeParseIpcValue(authChangeRequiredPasswordRequestSchema, request)

      if (!requestResult.success) {
        return Promise.resolve(
          freezeIpcResult(
            createAuthenticationFailure('VALIDATION_FAILED') as AuthChangeRequiredPasswordResult
          )
        )
      }

      return invokeValidated<AuthChangeRequiredPasswordResult>({
        invoke,
        channel: ipcChannels.auth.changeRequiredPassword,
        request: requestResult.data,
        resultSchema: authChangeRequiredPasswordResultSchema,
        unavailableResult: createAuthenticationFailure(
          'IPC_UNAVAILABLE'
        ) as AuthChangeRequiredPasswordResult
      })
    },
    unlock: (request: AuthUnlockRequest) => {
      const requestResult = safeParseIpcValue(authUnlockRequestSchema, request)

      if (!requestResult.success) {
        return Promise.resolve(
          freezeIpcResult(createAuthenticationFailure('VALIDATION_FAILED') as AuthUnlockResult)
        )
      }

      return invokeValidated<AuthUnlockResult>({
        invoke,
        channel: ipcChannels.auth.unlock,
        request: requestResult.data,
        resultSchema: authUnlockResultSchema,
        unavailableResult: createAuthenticationFailure('IPC_UNAVAILABLE') as AuthUnlockResult
      })
    },
    lock: () =>
      invokeValidated<AuthLockResult>({
        invoke,
        channel: ipcChannels.auth.lock,
        request: authLockRequestSchema.parse({}),
        resultSchema: authLockResultSchema,
        unavailableResult: createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLockResult
      }),
    logout: () =>
      invokeValidated<AuthLogoutResult>({
        invoke,
        channel: ipcChannels.auth.logout,
        request: authLogoutRequestSchema.parse({}),
        resultSchema: authLogoutResultSchema,
        unavailableResult: createAuthenticationFailure('IPC_UNAVAILABLE') as AuthLogoutResult
      }),
    recordActivity: () =>
      invokeValidated<AuthRecordActivityResult>({
        invoke,
        channel: ipcChannels.auth.recordActivity,
        request: authRecordActivityRequestSchema.parse({}),
        resultSchema: authRecordActivityResultSchema,
        unavailableResult: createAuthenticationFailure(
          'IPC_UNAVAILABLE'
        ) as AuthRecordActivityResult
      }),
    onSessionChanged(listener: AuthenticationSessionChangedListener): () => void {
      if (typeof listener !== 'function') {
        return noop
      }

      let unsubscribe: IpcUnsubscribe

      try {
        unsubscribe = subscribe(ipcChannels.auth.sessionChanged, (payload) => {
          const payloadResult = safeParseIpcValue(publicAuthenticationSessionSchema, payload)

          if (!payloadResult.success) {
            return
          }

          listener(freezePublicSession(payloadResult.data))
        })
      } catch {
        return noop
      }

      return createIdempotentUnsubscribe(unsubscribe)
    }
  })
}

interface InvokeValidatedInput<TResult> {
  invoke: IpcInvoke
  channel: string
  request: unknown
  resultSchema: {
    safeParse(value: unknown): { success: true; data: TResult } | { success: false }
  }
  unavailableResult: TResult
}

async function invokeValidated<TResult>({
  invoke,
  channel,
  request,
  resultSchema,
  unavailableResult
}: InvokeValidatedInput<TResult>): Promise<TResult> {
  try {
    const response = await invoke(channel, request)
    const result = safeParseIpcValue(resultSchema, response)

    if (!result.success) {
      return freezeIpcResult(unavailableResult)
    }

    return freezeIpcResult(result.data)
  } catch {
    return freezeIpcResult(unavailableResult)
  }
}

interface IpcSchema<TResult> {
  safeParse(value: unknown): { success: true; data: TResult } | { success: false }
}

function safeParseIpcValue<TResult>(
  schema: IpcSchema<TResult>,
  value: unknown
): { success: true; data: TResult } | { success: false } {
  try {
    return schema.safeParse(value)
  } catch {
    return { success: false }
  }
}

function freezeIpcResult<TResult>(result: TResult): TResult {
  return deepFreeze(result)
}

function freezePublicSession(session: PublicAuthenticationSession): PublicAuthenticationSession {
  return deepFreeze(session)
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }

  for (const propertyName of Object.getOwnPropertyNames(value)) {
    const child = (value as Record<string, unknown>)[propertyName]
    deepFreeze(child)
  }

  return Object.freeze(value)
}

function createIdempotentUnsubscribe(unsubscribe: IpcUnsubscribe): IpcUnsubscribe {
  let unsubscribed = false

  return () => {
    if (unsubscribed) {
      return
    }

    unsubscribed = true
    unsubscribe()
  }
}

function unavailableSubscribe(): IpcUnsubscribe {
  return noop
}

function noop(): void {
  return undefined
}
