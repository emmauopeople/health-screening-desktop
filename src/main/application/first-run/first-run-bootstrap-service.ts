import {
  DatabaseTransactionExecutionError,
  InstallationAlreadyExistsError,
  LocalUserAlreadyExistsError,
  LocationAlreadyExistsError,
  parseAuditActionCode,
  parseAuditEntityType,
  type AuditEventRecord,
  type CreateAuditEventInput,
  type InstallationState,
  type LocationType
} from '@main/database'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'
import {
  PasswordCredentialFormatError,
  PasswordHashingError,
  PasswordValidationError,
  type StoredPasswordCredential
} from '@main/security'

import {
  FirstRunAlreadyInitializedError,
  FirstRunInitializationError,
  FirstRunInitializationInProgressError,
  FirstRunStateIntegrityError,
  FirstRunValidationError,
  getFirstRunErrorType,
  isFirstRunError,
  rebuildFirstRunError
} from './first-run-errors'
import { parseFirstRunInitializationInput } from './first-run-validation'
import type {
  FirstRunBootstrapService,
  FirstRunBootstrapServiceDependencies,
  FirstRunBootstrapState,
  FirstRunInitializationResult,
  FirstRunInconsistencyCode,
  ParsedFirstRunInitializationInput
} from './first-run-types'

const installationInitializedAction = parseAuditActionCode('INSTALLATION_INITIALIZED')
const localUserCreatedAction = parseAuditActionCode('LOCAL_USER_CREATED')
const locationCreatedAction = parseAuditActionCode('LOCATION_CREATED')
const installationEntityType = parseAuditEntityType('INSTALLATION')
const localUserEntityType = parseAuditEntityType('LOCAL_USER')
const locationEntityType = parseAuditEntityType('LOCATION')

export function createFirstRunBootstrapService({
  installationRepository,
  localUserRepository,
  locationRepository,
  auditEventRepository,
  passwordCredentialService,
  transactionExecutor
}: FirstRunBootstrapServiceDependencies): FirstRunBootstrapService {
  let initializationInProgress = false

  const getState = (): FirstRunBootstrapState => {
    try {
      return readBootstrapState({
        installationRepository,
        localUserRepository,
        locationRepository
      })
    } catch (error) {
      throw toFirstRunBoundaryError(error)
    }
  }

  const initialize = async (input: unknown): Promise<FirstRunInitializationResult> => {
    if (initializationInProgress) {
      throw new FirstRunInitializationInProgressError()
    }

    initializationInProgress = true
    let parsedInput: ParsedFirstRunInitializationInput | undefined
    let credential: StoredPasswordCredential | undefined

    try {
      parsedInput = parseFirstRunInitializationInput(input)
      const parsedCommand = parsedInput
      requireRequiredState(getState())
      credential = await passwordCredentialService.hash(
        parsedCommand.administrator.temporaryPassword
      )
      const preparedCredential = credential

      const result = transactionExecutor.run((context) => {
        requireRequiredState(getState())

        const occurredAt = context.nowUtc()
        const installationId = context.newEntityId()
        const administratorId = context.newEntityId()
        const locationId = context.newEntityId()
        const installationAuditId = context.newEntityId()
        const userAuditId = context.newEntityId()
        const locationAuditId = context.newEntityId()

        const installation = installationRepository.insert(context.connection, {
          id: installationId,
          deploymentName: parsedCommand.deploymentName,
          timeZone: parsedCommand.timeZone,
          createdAt: occurredAt,
          updatedAt: occurredAt
        })
        const administrator = localUserRepository.insert(context.connection, {
          id: administratorId,
          username: parsedCommand.administrator.username,
          displayName: parsedCommand.administrator.displayName,
          credential: preparedCredential,
          role: 'LOCAL_ADMIN',
          mustChangePassword: true,
          createdAt: occurredAt,
          updatedAt: occurredAt
        })
        const initialLocation = locationRepository.insert(context.connection, {
          id: locationId,
          name: parsedCommand.initialLocation.name,
          locationType: parsedCommand.initialLocation.locationType,
          village: parsedCommand.initialLocation.village,
          subdivision: parsedCommand.initialLocation.subdivision,
          region: parsedCommand.initialLocation.region,
          directions: parsedCommand.initialLocation.directions,
          createdBy: administratorId,
          createdAt: occurredAt
        })
        const auditEvents = createBootstrapAuditEvents({
          installationId,
          administratorId,
          locationId,
          installationAuditId,
          userAuditId,
          locationAuditId,
          occurredAt,
          locationType: parsedCommand.initialLocation.locationType,
          insert: (event) => auditEventRepository.insert(context.connection, event)
        })

        return Object.freeze({
          status: 'INITIALIZED' as const,
          installation,
          administrator,
          initialLocation,
          auditEvents: Object.freeze(auditEvents)
        })
      })

      return result
    } catch (error) {
      throw toFirstRunBoundaryError(error)
    } finally {
      parsedInput = undefined
      credential = undefined
      initializationInProgress = false
    }
  }

  return Object.freeze({
    getState,
    initialize
  })
}

interface BootstrapStateRepositories {
  readonly installationRepository: FirstRunBootstrapServiceDependencies['installationRepository']
  readonly localUserRepository: FirstRunBootstrapServiceDependencies['localUserRepository']
  readonly locationRepository: FirstRunBootstrapServiceDependencies['locationRepository']
}

interface CreateBootstrapAuditEventsInput {
  readonly installationId: EntityId
  readonly administratorId: EntityId
  readonly locationId: EntityId
  readonly installationAuditId: EntityId
  readonly userAuditId: EntityId
  readonly locationAuditId: EntityId
  readonly occurredAt: UtcTimestamp
  readonly locationType: LocationType
  readonly insert: (event: CreateAuditEventInput) => AuditEventRecord
}

function readBootstrapState({
  installationRepository,
  localUserRepository,
  locationRepository
}: BootstrapStateRepositories): FirstRunBootstrapState {
  const installationState = installationRepository.getState()
  const hasUsers = localUserRepository.hasAny()
  const hasLocations = locationRepository.hasAny()

  if (installationState.status === 'UNINITIALIZED' && !hasUsers && !hasLocations) {
    return Object.freeze({ status: 'REQUIRED' as const })
  }

  if (installationState.status === 'INITIALIZED' && hasUsers && hasLocations) {
    return Object.freeze({
      status: 'INITIALIZED' as const,
      installation: installationState.installation
    })
  }

  return Object.freeze({
    status: 'INCONSISTENT' as const,
    code: getInconsistencyCode(installationState, hasUsers, hasLocations)
  })
}

function getInconsistencyCode(
  installationState: InstallationState,
  hasUsers: boolean,
  hasLocations: boolean
): FirstRunInconsistencyCode {
  if (installationState.status === 'UNINITIALIZED') {
    return 'INSTALLATION_MISSING_WITH_LOCAL_DATA'
  }

  if (!hasUsers && !hasLocations) {
    return 'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR_AND_LOCATION'
  }

  if (!hasUsers) {
    return 'INSTALLATION_PRESENT_WITHOUT_ADMINISTRATOR'
  }

  return 'INSTALLATION_PRESENT_WITHOUT_LOCATION'
}

function requireRequiredState(state: FirstRunBootstrapState): void {
  if (state.status === 'REQUIRED') {
    return
  }

  if (state.status === 'INITIALIZED') {
    throw new FirstRunAlreadyInitializedError()
  }

  throw new FirstRunStateIntegrityError()
}

function createBootstrapAuditEvents({
  installationId,
  administratorId,
  locationId,
  installationAuditId,
  userAuditId,
  locationAuditId,
  occurredAt,
  locationType,
  insert
}: CreateBootstrapAuditEventsInput): readonly AuditEventRecord[] {
  const installationAudit = insert({
    id: installationAuditId,
    installationId,
    userId: null,
    action: installationInitializedAction,
    entityType: installationEntityType,
    entityId: installationId,
    occurredAt,
    metadata: Object.freeze({ bootstrap: true })
  })
  const userAudit = insert({
    id: userAuditId,
    installationId,
    userId: null,
    action: localUserCreatedAction,
    entityType: localUserEntityType,
    entityId: administratorId,
    occurredAt,
    metadata: Object.freeze({
      bootstrap: true,
      must_change_password: true,
      role: 'LOCAL_ADMIN'
    })
  })
  const locationAudit = insert({
    id: locationAuditId,
    installationId,
    userId: null,
    action: locationCreatedAction,
    entityType: locationEntityType,
    entityId: locationId,
    occurredAt,
    metadata: Object.freeze({
      bootstrap: true,
      initial_location: true,
      location_type: locationType
    })
  })

  return [installationAudit, userAudit, locationAudit]
}

function toFirstRunBoundaryError(error: unknown): Error {
  if (isFirstRunError(error)) {
    return rebuildFirstRunError(error)
  }

  if (error instanceof PasswordValidationError) {
    return new FirstRunValidationError(error.errorType)
  }

  if (
    error instanceof PasswordHashingError ||
    error instanceof PasswordCredentialFormatError ||
    error instanceof LocalUserAlreadyExistsError ||
    error instanceof LocationAlreadyExistsError
  ) {
    return new FirstRunInitializationError(getFirstRunErrorType(error))
  }

  if (error instanceof InstallationAlreadyExistsError) {
    return new FirstRunAlreadyInitializedError(error.errorType)
  }

  if (error instanceof DatabaseTransactionExecutionError) {
    return mapTransactionExecutionError(error)
  }

  return new FirstRunInitializationError(getFirstRunErrorType(error))
}

function mapTransactionExecutionError(error: DatabaseTransactionExecutionError): Error {
  if (
    error.errorType === 'FirstRunAlreadyInitializedError' ||
    error.errorType === 'InstallationAlreadyExistsError'
  ) {
    return new FirstRunAlreadyInitializedError(error.errorType)
  }

  if (error.errorType === 'FirstRunStateIntegrityError') {
    return new FirstRunStateIntegrityError(error.errorType)
  }

  return new FirstRunInitializationError(error.errorType)
}
