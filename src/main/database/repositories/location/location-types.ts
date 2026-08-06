import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type LocationType = 'CHURCH' | 'QUARTER' | 'VILLAGE' | 'COMMUNITY_SITE' | 'OTHER'

export type LocationName = string & { readonly __brand: 'LocationName' }
export type NormalizedLocationName = string & { readonly __brand: 'NormalizedLocationName' }
export type LocationAdministrativeArea = string & {
  readonly __brand: 'LocationAdministrativeArea'
}
export type LocationDirections = string & { readonly __brand: 'LocationDirections' }

export interface LocationNameIdentity {
  readonly name: LocationName
  readonly nameNormalized: NormalizedLocationName
}

export interface LocationRecord {
  readonly id: EntityId
  readonly name: LocationName
  readonly locationType: LocationType
  readonly village: LocationAdministrativeArea | null
  readonly subdivision: LocationAdministrativeArea | null
  readonly region: LocationAdministrativeArea | null
  readonly directions: LocationDirections | null
  readonly isActive: boolean
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly updatedBy: EntityId
  readonly updatedAt: UtcTimestamp
}

export interface CreateLocationInput {
  readonly id: EntityId
  readonly name: LocationName
  readonly locationType: LocationType
  readonly village: LocationAdministrativeArea | null
  readonly subdivision: LocationAdministrativeArea | null
  readonly region: LocationAdministrativeArea | null
  readonly directions: LocationDirections | null
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
}

export interface LocationRepository {
  hasAny(): boolean
  getById(id: EntityId): LocationRecord | null
  getByIdForWrite(connection: DatabaseTransactionConnection, id: EntityId): LocationRecord | null
  listAll(): readonly LocationRecord[]
  listActive(): readonly LocationRecord[]
  insert(connection: DatabaseTransactionConnection, input: CreateLocationInput): LocationRecord
}
