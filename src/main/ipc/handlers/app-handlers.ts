import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import {
  getApplicationHealth,
  getApplicationInfo,
  type ApplicationInfoProvider
} from '@main/app/application-info'
import { isIpcSenderAllowed, type IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  appGetHealthRequestSchema,
  appGetInfoRequestSchema,
  appHealthSchema,
  appInfoSchema,
  createIpcFailure,
  createIpcSuccess,
  ipcChannels,
  type AppHealth,
  type AppInfo,
  type AppIpcChannel,
  type IpcErrorCode,
  type IpcResult
} from '@shared/ipc'

export interface IpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface AppIpcHandlerDependencies {
  navigationPolicy: NavigationPolicy
  applicationInfoProvider: ApplicationInfoProvider
  getInfo?: () => unknown | Promise<unknown>
  getHealth?: () => unknown | Promise<unknown>
  logger?: IpcOperationalLogger
}

export interface AppIpcHandlers {
  getInfo(event: IpcSenderValidationEvent, request: unknown): Promise<IpcResult<AppInfo>>
  getHealth(event: IpcSenderValidationEvent, request: unknown): Promise<IpcResult<AppHealth>>
}

export function createAppIpcHandlers({
  navigationPolicy,
  applicationInfoProvider,
  getInfo = () => getApplicationInfo(applicationInfoProvider),
  getHealth = () => getApplicationHealth(),
  logger = console
}: AppIpcHandlerDependencies): AppIpcHandlers {
  return {
    getInfo: createValidatedAppHandler({
      channel: ipcChannels.app.getInfo,
      navigationPolicy,
      requestSchema: appGetInfoRequestSchema,
      responseSchema: appInfoSchema,
      execute: getInfo,
      logger
    }),
    getHealth: createValidatedAppHandler({
      channel: ipcChannels.app.getHealth,
      navigationPolicy,
      requestSchema: appGetHealthRequestSchema,
      responseSchema: appHealthSchema,
      execute: getHealth,
      logger
    })
  }
}

interface ValidatedAppHandlerInput<TResponse> {
  channel: AppIpcChannel
  navigationPolicy: NavigationPolicy
  requestSchema: z.ZodType
  responseSchema: z.ZodType<TResponse>
  execute(): unknown | Promise<unknown>
  logger: IpcOperationalLogger
}

function createValidatedAppHandler<TResponse>({
  channel,
  navigationPolicy,
  requestSchema,
  responseSchema,
  execute,
  logger
}: ValidatedAppHandlerInput<TResponse>) {
  return async (
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<IpcResult<TResponse>> => {
    if (!isIpcSenderAllowed(event, navigationPolicy)) {
      logIpcFailure(logger, channel, 'IPC_FORBIDDEN')
      return createIpcFailure('IPC_FORBIDDEN')
    }

    const requestResult = requestSchema.safeParse(request)

    if (!requestResult.success) {
      logIpcFailure(logger, channel, 'VALIDATION_FAILED')
      return createIpcFailure('VALIDATION_FAILED')
    }

    try {
      const response = await execute()
      const responseResult = responseSchema.safeParse(response)

      if (!responseResult.success) {
        logIpcFailure(logger, channel, 'INTERNAL_ERROR', responseResult.error)
        return createIpcFailure('INTERNAL_ERROR')
      }

      return createIpcSuccess(responseResult.data)
    } catch (error) {
      logIpcFailure(logger, channel, 'INTERNAL_ERROR', error)
      return createIpcFailure('INTERNAL_ERROR')
    }
  }
}

function logIpcFailure(
  logger: IpcOperationalLogger,
  channel: AppIpcChannel,
  code: IpcErrorCode,
  error?: unknown
): void {
  const errorType = error ? `; errorType=${getErrorType(error)}` : ''
  const message = `IPC handler result channel=${channel}; code=${code}${errorType}`

  if (code === 'INTERNAL_ERROR') {
    logger.error(message)
    return
  }

  logger.warn(message)
}

function getErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
