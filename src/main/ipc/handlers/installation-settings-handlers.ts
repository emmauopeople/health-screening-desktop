import type { z } from 'zod'

import type { NavigationPolicy } from '@main/app/navigation-policy'
import type {
  AssignInitialInstallationLocationResult as InternalAssignInitialInstallationLocationResult,
  InstallationLocationService,
  LocalAuthenticationSessionService,
  ReconfigureInstallationLocationResult as InternalReconfigureInstallationLocationResult,
  ResolveConfiguredInstallationLocationResult as InternalResolveConfiguredInstallationLocationResult
} from '@main/application'
import type { LocationRecord, LocationRepository } from '@main/database'
import { getErrorType } from '@main/foundation/error-type'
import { createAuthenticatedHandlerAuthorization } from '@main/ipc/authentication/authenticated-handler-authorization'
import type { IpcSenderValidationEvent } from '@main/ipc/sender-policy'
import {
  createInstallationSettingsFailure,
  createIpcSuccess,
  installationSettingsAssignInitialLocationRequestSchema,
  installationSettingsAssignInitialLocationResultSchema,
  installationSettingsGetConfiguredLocationRequestSchema,
  installationSettingsGetConfiguredLocationResultSchema,
  installationSettingsListEligibleLocationsRequestSchema,
  installationSettingsListEligibleLocationsResultSchema,
  installationSettingsReconfigureLocationRequestSchema,
  installationSettingsReconfigureLocationResultSchema,
  ipcChannels,
  type AuthenticationFailure,
  type InstallationSettingsAssignInitialLocationResult,
  type InstallationSettingsErrorCode,
  type InstallationSettingsGetConfiguredLocationResult,
  type InstallationSettingsIpcChannel,
  type InstallationSettingsListEligibleLocationsResult,
  type InstallationSettingsReconfigureLocationResult,
  type PublicInstallationSettingsLocation
} from '@shared/ipc'

export interface InstallationSettingsIpcOperationalLogger {
  warn(message: string): void
  error(message: string): void
}

export interface InstallationSettingsIpcHandlerDependencies {
  readonly navigationPolicy: NavigationPolicy
  readonly authenticationSessionService: LocalAuthenticationSessionService
  readonly installationLocationService: InstallationLocationService
  readonly locationRepository: LocationRepository
  readonly logger?: InstallationSettingsIpcOperationalLogger
}

export interface InstallationSettingsIpcHandlers {
  getConfiguredLocation(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<InstallationSettingsGetConfiguredLocationResult>
  listEligibleLocations(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<InstallationSettingsListEligibleLocationsResult>
  assignInitialLocation(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<InstallationSettingsAssignInitialLocationResult>
  reconfigureLocation(
    event: IpcSenderValidationEvent,
    request: unknown
  ): Promise<InstallationSettingsReconfigureLocationResult>
}

const adminRoles = Object.freeze(['LOCAL_ADMIN'] as const)

export function createInstallationSettingsIpcHandlers({
  navigationPolicy,
  authenticationSessionService,
  installationLocationService,
  locationRepository,
  logger = console
}: InstallationSettingsIpcHandlerDependencies): InstallationSettingsIpcHandlers {
  const authorization = createAuthenticatedHandlerAuthorization({
    navigationPolicy,
    authenticationSessionService,
    logger
  })

  return Object.freeze({
    async getConfiguredLocation(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<InstallationSettingsGetConfiguredLocationResult> {
      return handleInstallationSettingsRequest({
        channel: ipcChannels.installationSettings.getConfiguredLocation,
        request,
        requestSchema: installationSettingsGetConfiguredLocationRequestSchema,
        resultSchema: installationSettingsGetConfiguredLocationResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, adminRoles),
        invoke: () =>
          mapResolveConfiguredLocationResult(
            installationLocationService.resolveConfiguredInstallationLocation()
          )
      })
    },

    async listEligibleLocations(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<InstallationSettingsListEligibleLocationsResult> {
      return handleInstallationSettingsRequest({
        channel: ipcChannels.installationSettings.listEligibleLocations,
        request,
        requestSchema: installationSettingsListEligibleLocationsRequestSchema,
        resultSchema: installationSettingsListEligibleLocationsResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, adminRoles),
        invoke: () =>
          createIpcSuccess({
            status: 'LISTED' as const,
            locations: locationRepository.listActive().map(toPublicLocation)
          })
      })
    },

    async assignInitialLocation(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<InstallationSettingsAssignInitialLocationResult> {
      return handleInstallationSettingsRequest({
        channel: ipcChannels.installationSettings.assignInitialLocation,
        request,
        requestSchema: installationSettingsAssignInitialLocationRequestSchema,
        resultSchema: installationSettingsAssignInitialLocationResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, adminRoles),
        invoke: (data) =>
          mapAssignInitialLocationResult(
            installationLocationService.assignInitialInstallationLocation(data)
          )
      })
    },

    async reconfigureLocation(
      event: IpcSenderValidationEvent,
      request: unknown
    ): Promise<InstallationSettingsReconfigureLocationResult> {
      return handleInstallationSettingsRequest({
        channel: ipcChannels.installationSettings.reconfigureLocation,
        request,
        requestSchema: installationSettingsReconfigureLocationRequestSchema,
        resultSchema: installationSettingsReconfigureLocationResultSchema,
        logger,
        authorize: () => authorization.requireAnyRole(event, adminRoles),
        invoke: (data) =>
          mapReconfigureLocationResult(
            installationLocationService.reconfigureInstallationLocation(data)
          )
      })
    }
  })
}

interface HandleInstallationSettingsRequestOptions<TRequest, TResult> {
  readonly channel: InstallationSettingsIpcChannel
  readonly request: unknown
  readonly requestSchema: IpcSchema<TRequest>
  readonly resultSchema: IpcSchema<TResult>
  readonly logger: InstallationSettingsIpcOperationalLogger
  authorize(): ReturnType<
    ReturnType<typeof createAuthenticatedHandlerAuthorization>['requireAnyRole']
  >
  invoke(request: TRequest): TResult
}

function handleInstallationSettingsRequest<TRequest, TResult>({
  channel,
  request,
  requestSchema,
  resultSchema,
  logger,
  authorize,
  invoke
}: HandleInstallationSettingsRequestOptions<TRequest, TResult>): TResult {
  const authorization = authorize()

  if (!authorization.ok) {
    const failure = toInstallationSettingsAuthorizationFailure(authorization.failure)
    logInstallationSettingsIpcFailure(logger, channel, failure.error.code)
    return failure as TResult
  }

  const requestResult = safeParseIpcValue(requestSchema, request)

  if (!requestResult.success) {
    logInstallationSettingsIpcFailure(logger, channel, 'VALIDATION_FAILED')
    return createInstallationSettingsFailure('VALIDATION_FAILED') as TResult
  }

  try {
    const result = invoke(requestResult.data)
    const resultEnvelope = safeParseIpcValue(resultSchema, result)

    if (!resultEnvelope.success) {
      logInstallationSettingsIpcFailure(logger, channel, 'INTERNAL_ERROR')
      return createInstallationSettingsFailure('INTERNAL_ERROR') as TResult
    }

    return resultEnvelope.data
  } catch (error) {
    logInstallationSettingsIpcFailure(logger, channel, 'INTERNAL_ERROR', error)
    return createInstallationSettingsFailure('INTERNAL_ERROR') as TResult
  }
}

function mapResolveConfiguredLocationResult(
  result: InternalResolveConfiguredInstallationLocationResult
): InstallationSettingsGetConfiguredLocationResult {
  if (result.status === 'RESOLVED') {
    return createIpcSuccess({
      status: 'RESOLVED',
      location: {
        id: result.location.id,
        name: result.location.displayName
      }
    }) as InstallationSettingsGetConfiguredLocationResult
  }

  return createIpcSuccess({
    status: result.status
  }) as InstallationSettingsGetConfiguredLocationResult
}

function mapAssignInitialLocationResult(
  result: InternalAssignInitialInstallationLocationResult
): InstallationSettingsAssignInitialLocationResult {
  if (result.status === 'ASSIGNED' || result.status === 'UNCHANGED') {
    return createIpcSuccess({
      status: result.status,
      location: {
        id: result.location.id,
        name: result.location.displayName
      }
    }) as InstallationSettingsAssignInitialLocationResult
  }

  return createIpcSuccess({
    status: result.status
  }) as InstallationSettingsAssignInitialLocationResult
}

function mapReconfigureLocationResult(
  result: InternalReconfigureInstallationLocationResult
): InstallationSettingsReconfigureLocationResult {
  if (result.status === 'UPDATED' || result.status === 'UNCHANGED') {
    return createIpcSuccess({
      status: result.status,
      location: {
        id: result.location.id,
        name: result.location.displayName
      }
    }) as InstallationSettingsReconfigureLocationResult
  }

  return createIpcSuccess({
    status: result.status
  }) as InstallationSettingsReconfigureLocationResult
}

function toPublicLocation(location: LocationRecord): PublicInstallationSettingsLocation {
  return Object.freeze({
    id: location.id,
    name: location.name
  })
}

function toInstallationSettingsAuthorizationFailure(failure: AuthenticationFailure): {
  ok: false
  error: { code: InstallationSettingsErrorCode; message: string }
} {
  switch (failure.error.code) {
    case 'IPC_FORBIDDEN':
      return createInstallationSettingsFailure('IPC_FORBIDDEN')
    case 'AUTH_UNAUTHENTICATED':
      return createInstallationSettingsFailure('AUTH_UNAUTHENTICATED')
    case 'AUTH_LOCKED':
      return createInstallationSettingsFailure('AUTH_LOCKED')
    case 'AUTH_PASSWORD_CHANGE_REQUIRED':
      return createInstallationSettingsFailure('AUTH_PASSWORD_CHANGE_REQUIRED')
    case 'AUTHORIZATION_FAILED':
      return createInstallationSettingsFailure('AUTHORIZATION_FAILED')
    case 'VALIDATION_FAILED':
      return createInstallationSettingsFailure('VALIDATION_FAILED')
    default:
      return createInstallationSettingsFailure('INTERNAL_ERROR')
  }
}

function logInstallationSettingsIpcFailure(
  logger: InstallationSettingsIpcOperationalLogger,
  channel: InstallationSettingsIpcChannel,
  code: InstallationSettingsErrorCode,
  error?: unknown
): void {
  try {
    const errorType = error === undefined ? '' : `; errorType=${getErrorType(error)}`
    const message = `IPC handler result event=installation-settings; channel=${channel}; code=${code}${errorType}`

    if (code === 'INTERNAL_ERROR') {
      logger.error(message)
      return
    }

    logger.warn(message)
  } catch {
    // Logging must not alter IPC results.
  }
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
  } catch {
    return { success: false }
  }
}
