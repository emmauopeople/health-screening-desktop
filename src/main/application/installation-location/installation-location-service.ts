import type { DatabaseTransactionConnection } from '@main/database/transaction'
import {
  parseAuditActionCode,
  parseAuditEntityType,
  InstallationLocationConfigurationAlreadyExistsError,
  RepositoryDataIntegrityError,
  RepositoryValidationError,
  type AuditMetadata,
  type InstallationLocationConfigurationRecord,
  type InstallationRecord,
  type LocalUserRole,
  type LocationRecord
} from '@main/database'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import {
  LocalSessionAuthorizationError,
  LocalSessionLockedError,
  LocalSessionPasswordChangeRequiredError,
  LocalSessionUnauthenticatedError,
  isLocalSessionError
} from '../authentication/session'
import type {
  ConfiguredInstallationLocation,
  AssignInitialInstallationLocationResult,
  InstallationLocationService,
  InstallationLocationServiceDependencies,
  ReconfigureInstallationLocationResult,
  ResolveConfiguredInstallationLocationResult
} from './installation-location-service-types'

const assignedAction = parseAuditActionCode('INSTALLATION_LOCATION_ASSIGNED')
const changedAction = parseAuditActionCode('INSTALLATION_LOCATION_CHANGED')
const installationEntityType = parseAuditEntityType('INSTALLATION')
const adminRoles = Object.freeze(['LOCAL_ADMIN'] as const)
const locationCommandKeys = Object.freeze(['locationId'] as const)

interface ValidatedActor {
  readonly userId: EntityId
  readonly role: LocalUserRole
}

interface ParsedLocationCommand {
  readonly locationId: EntityId
}

export function createInstallationLocationService({
  authenticationSessionService,
  installationRepository,
  installationLocationConfigurationRepository,
  locationRepository,
  screeningSessionRepository,
  screeningEncounterRepository,
  auditEventRepository,
  transactionExecutor
}: InstallationLocationServiceDependencies): InstallationLocationService {
  return Object.freeze({
    resolveConfiguredInstallationLocation(): ResolveConfiguredInstallationLocationResult {
      try {
        const configuration = installationLocationConfigurationRepository.get()

        if (configuration === null) {
          return resolveResult('LOCATION_NOT_CONFIGURED')
        }

        const location = locationRepository.getById(configuration.locationId)

        return resolveLocation(location)
      } catch {
        return resolveResult('UNAVAILABLE')
      }
    },

    assignInitialInstallationLocation(request: unknown): AssignInitialInstallationLocationResult {
      const actorResult = resolveTrustedAdmin(authenticationSessionService, assignResult)

      if (actorResult.status !== 'VALID') {
        return actorResult.result
      }

      const commandResult = parseLocationCommand(request, assignResult)

      if (commandResult.status !== 'VALID') {
        return commandResult.result
      }

      try {
        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const installation = readInitializedInstallation(installationRepository)
          const currentConfiguration = installationLocationConfigurationRepository.getForWrite(
            context.connection
          )

          if (currentConfiguration !== null) {
            return resolveExistingInitialAssignment(
              currentConfiguration,
              commandResult.command.locationId,
              locationRepository,
              context.connection
            )
          }

          const proposedLocation = locationRepository.getByIdForWrite(
            context.connection,
            commandResult.command.locationId
          )

          if (proposedLocation === null) {
            return assignResult('LOCATION_NOT_FOUND')
          }

          if (!proposedLocation.isActive) {
            return assignResult('LOCATION_INACTIVE')
          }

          if (
            hasActiveScreeningWork({
              connection: context.connection,
              screeningSessionRepository,
              screeningEncounterRepository
            })
          ) {
            return assignResult('ACTIVE_SCREENING_WORK')
          }

          let configuration: InstallationLocationConfigurationRecord

          try {
            configuration = installationLocationConfigurationRepository.insert(context.connection, {
              installationId: installation.id,
              locationId: proposedLocation.id,
              configuredAt: occurredAt,
              configuredBy: actorResult.actor.userId
            })
          } catch (error) {
            if (error instanceof InstallationLocationConfigurationAlreadyExistsError) {
              return recoverConcurrentInitialAssignment(
                commandResult.command.locationId,
                installationLocationConfigurationRepository,
                locationRepository,
                context.connection
              )
            }

            throw error
          }

          insertLocationAssignedAudit({
            auditEventId: context.newEntityId(),
            auditEventRepository,
            installation,
            actor: actorResult.actor,
            configuration,
            occurredAt,
            connection: context.connection
          })

          return Object.freeze({
            status: 'ASSIGNED' as const,
            location: toConfiguredLocation(proposedLocation)
          })
        })
      } catch {
        return assignResult('UNAVAILABLE')
      }
    },

    reconfigureInstallationLocation(request: unknown): ReconfigureInstallationLocationResult {
      const actorResult = resolveTrustedAdmin(authenticationSessionService, reconfigureResult)

      if (actorResult.status !== 'VALID') {
        return actorResult.result
      }

      const commandResult = parseLocationCommand(request, reconfigureResult)

      if (commandResult.status !== 'VALID') {
        return commandResult.result
      }

      try {
        return transactionExecutor.run((context) => {
          const occurredAt = context.nowUtc()
          const installation = readInitializedInstallation(installationRepository)
          const configuration = installationLocationConfigurationRepository.getForWrite(
            context.connection
          )

          if (configuration === null) {
            return reconfigureResult('LOCATION_NOT_CONFIGURED')
          }

          const proposedLocation = locationRepository.getByIdForWrite(
            context.connection,
            commandResult.command.locationId
          )

          if (proposedLocation === null) {
            return reconfigureResult('LOCATION_NOT_FOUND')
          }

          if (!proposedLocation.isActive) {
            return reconfigureResult('LOCATION_INACTIVE')
          }

          if (proposedLocation.id === configuration.locationId) {
            return Object.freeze({
              status: 'UNCHANGED' as const,
              location: toConfiguredLocation(proposedLocation)
            })
          }

          if (
            hasActiveScreeningWork({
              connection: context.connection,
              screeningSessionRepository,
              screeningEncounterRepository
            })
          ) {
            return reconfigureResult('ACTIVE_SCREENING_WORK')
          }

          const updateResult = installationLocationConfigurationRepository.updateLocation(
            context.connection,
            {
              locationId: proposedLocation.id,
              updatedAt: occurredAt,
              updatedBy: actorResult.actor.userId,
              expectedRowVersion: configuration.rowVersion
            }
          )

          if (updateResult.status === 'NOT_FOUND') {
            return reconfigureResult('LOCATION_NOT_CONFIGURED')
          }

          if (updateResult.status === 'CONFIGURATION_VERSION_CONFLICT') {
            return reconfigureResult('CONFIGURATION_CONFLICT')
          }

          insertLocationChangedAudit({
            auditEventId: context.newEntityId(),
            auditEventRepository,
            installation,
            actor: actorResult.actor,
            previousConfiguration: configuration,
            updatedConfiguration: updateResult.configuration,
            occurredAt,
            connection: context.connection
          })

          return Object.freeze({
            status: 'UPDATED' as const,
            location: toConfiguredLocation(proposedLocation)
          })
        })
      } catch {
        return reconfigureResult('UNAVAILABLE')
      }
    }
  })
}

function resolveTrustedAdmin<Result>(
  authenticationSessionService: InstallationLocationServiceDependencies['authenticationSessionService'],
  createFailureResult: (status: AuthenticationFailureStatus) => Result
):
  | { readonly status: 'VALID'; readonly actor: ValidatedActor }
  | { readonly status: 'INVALID'; readonly result: Result } {
  try {
    const context = authenticationSessionService.requireAnyRole(adminRoles)

    return {
      status: 'VALID',
      actor: Object.freeze({ userId: context.user.id, role: context.user.role })
    }
  } catch (error) {
    return { status: 'INVALID', result: mapAuthenticationFailure(error, createFailureResult) }
  }
}

function parseLocationCommand<Result>(
  request: unknown,
  createFailureResult: (status: 'VALIDATION_FAILED') => Result
):
  | { readonly status: 'VALID'; readonly command: ParsedLocationCommand }
  | { readonly status: 'INVALID'; readonly result: Result } {
  try {
    const data = readDataProperties(request, locationCommandKeys)

    return {
      status: 'VALID',
      command: Object.freeze({ locationId: parseEntityId(data.locationId) })
    }
  } catch {
    return { status: 'INVALID', result: createFailureResult('VALIDATION_FAILED') }
  }
}

function readInitializedInstallation(
  installationRepository: InstallationLocationServiceDependencies['installationRepository']
): InstallationRecord {
  const installation = installationRepository.get()

  if (installation === null) {
    throw new RepositoryDataIntegrityError()
  }

  return installation
}

function resolveLocation(
  location: LocationRecord | null
): ResolveConfiguredInstallationLocationResult {
  if (location === null) {
    return resolveResult('LOCATION_NOT_FOUND')
  }

  if (!location.isActive) {
    return resolveResult('LOCATION_INACTIVE')
  }

  return Object.freeze({
    status: 'RESOLVED' as const,
    location: toConfiguredLocation(location)
  })
}

function toConfiguredLocation(location: LocationRecord): ConfiguredInstallationLocation {
  return Object.freeze({
    id: location.id,
    displayName: location.name
  })
}

function resolveExistingInitialAssignment(
  configuration: InstallationLocationConfigurationRecord,
  requestedLocationId: EntityId,
  locationRepository: InstallationLocationServiceDependencies['locationRepository'],
  connection: DatabaseTransactionConnection
): AssignInitialInstallationLocationResult {
  if (configuration.locationId !== requestedLocationId) {
    return assignResult('LOCATION_ALREADY_CONFIGURED')
  }

  const location = locationRepository.getByIdForWrite(connection, configuration.locationId)

  if (location === null) {
    return assignResult('LOCATION_NOT_FOUND')
  }

  if (!location.isActive) {
    return assignResult('LOCATION_INACTIVE')
  }

  return Object.freeze({
    status: 'UNCHANGED' as const,
    location: toConfiguredLocation(location)
  })
}

function recoverConcurrentInitialAssignment(
  requestedLocationId: EntityId,
  installationLocationConfigurationRepository: InstallationLocationServiceDependencies['installationLocationConfigurationRepository'],
  locationRepository: InstallationLocationServiceDependencies['locationRepository'],
  connection: DatabaseTransactionConnection
): AssignInitialInstallationLocationResult {
  const configuration = installationLocationConfigurationRepository.getForWrite(connection)

  if (configuration === null) {
    return assignResult('CONFIGURATION_CONFLICT')
  }

  return resolveExistingInitialAssignment(
    configuration,
    requestedLocationId,
    locationRepository,
    connection
  )
}

function hasActiveScreeningWork({
  connection,
  screeningSessionRepository,
  screeningEncounterRepository
}: {
  readonly connection: DatabaseTransactionConnection
  readonly screeningSessionRepository: InstallationLocationServiceDependencies['screeningSessionRepository']
  readonly screeningEncounterRepository: InstallationLocationServiceDependencies['screeningEncounterRepository']
}): boolean {
  return (
    screeningSessionRepository.hasAnyOpenForWrite(connection) ||
    screeningEncounterRepository.hasAnyDraftForWrite(connection)
  )
}

function insertLocationAssignedAudit({
  auditEventRepository,
  auditEventId,
  installation,
  actor,
  configuration,
  occurredAt,
  connection
}: {
  readonly auditEventRepository: InstallationLocationServiceDependencies['auditEventRepository']
  readonly auditEventId: EntityId
  readonly installation: InstallationRecord
  readonly actor: ValidatedActor
  readonly configuration: InstallationLocationConfigurationRecord
  readonly occurredAt: UtcTimestamp
  readonly connection: DatabaseTransactionConnection
}): void {
  auditEventRepository.insert(connection, {
    id: auditEventId,
    installationId: installation.id,
    userId: actor.userId,
    action: assignedAction,
    entityType: installationEntityType,
    entityId: installation.id,
    occurredAt,
    metadata: createAssignedAuditMetadata(configuration)
  })
}

function insertLocationChangedAudit({
  auditEventRepository,
  auditEventId,
  installation,
  actor,
  previousConfiguration,
  updatedConfiguration,
  occurredAt,
  connection
}: {
  readonly auditEventRepository: InstallationLocationServiceDependencies['auditEventRepository']
  readonly auditEventId: EntityId
  readonly installation: InstallationRecord
  readonly actor: ValidatedActor
  readonly previousConfiguration: InstallationLocationConfigurationRecord
  readonly updatedConfiguration: InstallationLocationConfigurationRecord
  readonly occurredAt: UtcTimestamp
  readonly connection: DatabaseTransactionConnection
}): void {
  auditEventRepository.insert(connection, {
    id: auditEventId,
    installationId: installation.id,
    userId: actor.userId,
    action: changedAction,
    entityType: installationEntityType,
    entityId: installation.id,
    occurredAt,
    metadata: createChangedAuditMetadata(previousConfiguration, updatedConfiguration)
  })
}

function createAssignedAuditMetadata(
  configuration: InstallationLocationConfigurationRecord
): AuditMetadata {
  return Object.freeze({
    location_id: configuration.locationId,
    row_version: configuration.rowVersion
  })
}

function createChangedAuditMetadata(
  previousConfiguration: InstallationLocationConfigurationRecord,
  updatedConfiguration: InstallationLocationConfigurationRecord
): AuditMetadata {
  return Object.freeze({
    new_location_id: updatedConfiguration.locationId,
    previous_location_id: previousConfiguration.locationId,
    prior_row_version: previousConfiguration.rowVersion,
    resulting_row_version: updatedConfiguration.rowVersion
  })
}

function resolveResult(
  status: Exclude<ResolveConfiguredInstallationLocationResult['status'], 'RESOLVED'>
): ResolveConfiguredInstallationLocationResult {
  return Object.freeze({ status }) as ResolveConfiguredInstallationLocationResult
}

function assignResult(
  status: Exclude<AssignInitialInstallationLocationResult['status'], 'ASSIGNED' | 'UNCHANGED'>
): AssignInitialInstallationLocationResult {
  return Object.freeze({ status }) as AssignInitialInstallationLocationResult
}

function reconfigureResult(
  status: Exclude<ReconfigureInstallationLocationResult['status'], 'UPDATED' | 'UNCHANGED'>
): ReconfigureInstallationLocationResult {
  return Object.freeze({ status }) as ReconfigureInstallationLocationResult
}

type AuthenticationFailureStatus = 'AUTHENTICATION_REQUIRED' | 'FORBIDDEN' | 'UNAVAILABLE'

function mapAuthenticationFailure<Result>(
  error: unknown,
  createFailureResult: (status: AuthenticationFailureStatus) => Result
): Result {
  if (
    error instanceof LocalSessionUnauthenticatedError ||
    error instanceof LocalSessionLockedError ||
    error instanceof LocalSessionPasswordChangeRequiredError
  ) {
    return createFailureResult('AUTHENTICATION_REQUIRED')
  }

  if (error instanceof LocalSessionAuthorizationError) {
    return createFailureResult('FORBIDDEN')
  }

  if (isLocalSessionError(error)) {
    return createFailureResult('UNAVAILABLE')
  }

  return createFailureResult('UNAVAILABLE')
}

function readDataProperties(
  value: unknown,
  expectedKeys: readonly string[]
): Record<string, unknown> {
  let isArray: boolean

  try {
    isArray = Array.isArray(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (typeof value !== 'object' || value === null || isArray) {
    throw new RepositoryValidationError()
  }

  let prototype: unknown
  let descriptors: PropertyDescriptorMap

  try {
    prototype = Object.getPrototypeOf(value)
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    throw new RepositoryValidationError()
  }

  if (prototype !== Object.prototype && prototype !== null) {
    throw new RepositoryValidationError()
  }

  const keys = Reflect.ownKeys(descriptors)

  if (
    keys.length !== expectedKeys.length ||
    !expectedKeys.every((propertyName) => keys.includes(propertyName))
  ) {
    throw new RepositoryValidationError()
  }

  const data: Record<string, unknown> = {}

  for (const propertyName of expectedKeys) {
    const descriptor = descriptors[propertyName]

    if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RepositoryValidationError()
    }

    data[propertyName] = descriptor.value
  }

  return data
}
