import type {
  InstallationRepository,
  LocationRepository,
  ScreeningSessionDate
} from '@main/database'
import type { EntityId, UtcClock } from '@main/foundation'

export interface ScreeningSessionWorkspaceLocation {
  readonly id: EntityId
  readonly name: string
}

export interface ScreeningSessionWorkspaceContext {
  readonly deploymentLocalDate: ScreeningSessionDate
  readonly activeLocations: readonly ScreeningSessionWorkspaceLocation[]
}

export interface ScreeningSessionWorkspaceContextService {
  getContext(): ScreeningSessionWorkspaceContext
}

export interface ScreeningSessionWorkspaceContextServiceDependencies {
  readonly installationRepository: InstallationRepository
  readonly locationRepository: LocationRepository
  readonly clock: UtcClock
}
