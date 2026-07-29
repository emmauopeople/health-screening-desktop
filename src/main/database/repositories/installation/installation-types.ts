import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type DeploymentName = string & { readonly __brand: 'DeploymentName' }
export type IanaTimeZone = string & { readonly __brand: 'IanaTimeZone' }

export interface InstallationRecord {
  readonly id: EntityId
  readonly deploymentName: DeploymentName
  readonly timeZone: IanaTimeZone
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export interface CreateInstallationInput {
  readonly id: EntityId
  readonly deploymentName: DeploymentName
  readonly timeZone: IanaTimeZone
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export type InstallationState =
  | { readonly status: 'UNINITIALIZED' }
  | { readonly status: 'INITIALIZED'; readonly installation: InstallationRecord }

export interface InstallationRepository {
  get(): InstallationRecord | null
  getState(): InstallationState
  insert(
    connection: DatabaseTransactionConnection,
    input: CreateInstallationInput
  ): InstallationRecord
}
