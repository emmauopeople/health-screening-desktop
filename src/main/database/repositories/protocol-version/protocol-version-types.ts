import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'

export type ProtocolVersionReferenceStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

export interface ProtocolVersionReferenceRecord {
  readonly id: EntityId
  readonly status: ProtocolVersionReferenceStatus
}

export interface ProtocolVersionRepository {
  getByIdForWrite(
    connection: DatabaseTransactionConnection,
    id: EntityId
  ): ProtocolVersionReferenceRecord | null
  getActiveForWrite(
    connection: DatabaseTransactionConnection
  ): ProtocolVersionReferenceRecord | null
}
