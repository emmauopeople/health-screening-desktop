import {
  parseScreeningSessionDate,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError,
  type InstallationRecord
} from '@main/database'
import { getErrorType } from '@main/foundation/error-type'
import { parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

import {
  ScreeningSessionServicePersistenceError,
  ScreeningSessionServiceStateIntegrityError
} from './screening-session-service-errors'
import type {
  ScreeningSessionWorkspaceContext,
  ScreeningSessionWorkspaceContextService,
  ScreeningSessionWorkspaceContextServiceDependencies
} from './screening-session-workspace-context-types'

export function createScreeningSessionWorkspaceContextService({
  installationRepository,
  locationRepository,
  clock
}: ScreeningSessionWorkspaceContextServiceDependencies): ScreeningSessionWorkspaceContextService {
  return Object.freeze({
    getContext(): ScreeningSessionWorkspaceContext {
      try {
        const occurredAt = clock.now()
        const installation = readInitializedInstallation(installationRepository)
        const deploymentLocalDate = getDeploymentLocalDate(occurredAt, installation)
        const activeLocations = locationRepository.listActive().map((location) =>
          Object.freeze({
            id: location.id,
            name: location.name
          })
        )

        return Object.freeze({
          deploymentLocalDate,
          activeLocations: Object.freeze(activeLocations)
        })
      } catch (error) {
        if (
          error instanceof ScreeningSessionServicePersistenceError ||
          error instanceof ScreeningSessionServiceStateIntegrityError
        ) {
          throw error
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
        }

        if (
          error instanceof RepositoryReadError ||
          error instanceof RepositoryValidationError ||
          error instanceof RepositoryWriteError
        ) {
          throw new ScreeningSessionServicePersistenceError(getErrorType(error))
        }

        throw new ScreeningSessionServiceStateIntegrityError(getErrorType(error))
      }
    }
  })
}

function readInitializedInstallation(
  installationRepository: ScreeningSessionWorkspaceContextServiceDependencies['installationRepository']
): InstallationRecord {
  try {
    const installation = installationRepository.get()

    if (installation === null) {
      throw new ScreeningSessionServiceStateIntegrityError()
    }

    return installation
  } catch (error) {
    if (error instanceof ScreeningSessionServiceStateIntegrityError) {
      throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
    }

    if (
      error instanceof RepositoryReadError ||
      error instanceof RepositoryValidationError ||
      error instanceof RepositoryWriteError
    ) {
      throw new ScreeningSessionServicePersistenceError(getErrorType(error))
    }

    throw error
  }
}

function getDeploymentLocalDate(
  utcTimestamp: UtcTimestamp,
  installation: InstallationRecord
): ReturnType<typeof parseScreeningSessionDate> {
  try {
    const parsedTimestamp = parseUtcTimestamp(utcTimestamp)
    const instant = new Date(parsedTimestamp)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: installation.timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    const parts = formatter.formatToParts(instant)
    const year = readDatePart(parts, 'year')
    const month = readDatePart(parts, 'month')
    const day = readDatePart(parts, 'day')

    return parseScreeningSessionDate(`${year}-${month}-${day}`)
  } catch (error) {
    if (error instanceof ScreeningSessionServiceStateIntegrityError) {
      throw new ScreeningSessionServiceStateIntegrityError(error.errorType)
    }

    throw new ScreeningSessionServiceStateIntegrityError(getErrorType(error))
  }
}

function readDatePart(parts: readonly Intl.DateTimeFormatPart[], type: string): string {
  const part = parts.find((candidate) => candidate.type === type)

  if (part === undefined || !/^\d{2,4}$/u.test(part.value)) {
    throw new ScreeningSessionServiceStateIntegrityError()
  }

  return part.value
}
