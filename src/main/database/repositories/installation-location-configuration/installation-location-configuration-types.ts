import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export interface InstallationLocationConfigurationRecord {
  readonly singletonId: 1
  readonly installationId: EntityId
  readonly locationId: EntityId
  readonly configuredAt: UtcTimestamp
  readonly configuredBy: EntityId
  readonly updatedAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly rowVersion: number
}

export interface InsertInstallationLocationConfigurationInput {
  readonly installationId: EntityId
  readonly locationId: EntityId
  readonly configuredAt: UtcTimestamp
  readonly configuredBy: EntityId
}

export interface UpdateInstallationLocationConfigurationInput {
  readonly locationId: EntityId
  readonly updatedAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly expectedRowVersion: number
}

export type UpdateInstallationLocationConfigurationResult =
  | {
      readonly status: 'UPDATED'
      readonly configuration: InstallationLocationConfigurationRecord
    }
  | { readonly status: 'NOT_FOUND' }
  | {
      readonly status: 'CONFIGURATION_VERSION_CONFLICT'
      readonly configuration: InstallationLocationConfigurationRecord
    }

export interface InstallationLocationConfigurationRepository {
  get(): InstallationLocationConfigurationRecord | null
  getForWrite(
    connection: DatabaseTransactionConnection
  ): InstallationLocationConfigurationRecord | null
  insert(
    connection: DatabaseTransactionConnection,
    input: InsertInstallationLocationConfigurationInput
  ): InstallationLocationConfigurationRecord
  updateLocation(
    connection: DatabaseTransactionConnection,
    input: UpdateInstallationLocationConfigurationInput
  ): UpdateInstallationLocationConfigurationResult
}
