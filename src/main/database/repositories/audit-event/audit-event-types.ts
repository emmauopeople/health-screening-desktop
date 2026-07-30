import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type AuditActionCode = string & { readonly __brand: 'AuditActionCode' }
export type AuditEntityType = string & { readonly __brand: 'AuditEntityType' }
export type AuditQueryLimit = number & { readonly __brand: 'AuditQueryLimit' }

export type AuditMetadataScalar = null | boolean | number | string
export type AuditMetadataValue =
  | AuditMetadataScalar
  | readonly AuditMetadataValue[]
  | Readonly<{ [key: string]: AuditMetadataValue }>
export type AuditMetadata = Readonly<{ [key: string]: AuditMetadataValue }>

export interface ParsedAuditMetadata {
  readonly metadata: AuditMetadata
  readonly metadataJson: string
}

export interface AuditEventRecord {
  readonly id: EntityId
  readonly installationId: EntityId
  readonly userId: EntityId | null
  readonly action: AuditActionCode
  readonly entityType: AuditEntityType
  readonly entityId: EntityId | null
  readonly occurredAt: UtcTimestamp
  readonly metadata: AuditMetadata
}

export interface CreateAuditEventInput {
  readonly id: EntityId
  readonly installationId: EntityId
  readonly userId: EntityId | null
  readonly action: AuditActionCode
  readonly entityType: AuditEntityType
  readonly entityId: EntityId | null
  readonly occurredAt: UtcTimestamp
  readonly metadata: AuditMetadata
}

export interface AuditEventRepository {
  getById(id: EntityId): AuditEventRecord | null
  listRecent(limit: AuditQueryLimit): readonly AuditEventRecord[]
  listForEntity(
    entityType: AuditEntityType,
    entityId: EntityId,
    limit: AuditQueryLimit
  ): readonly AuditEventRecord[]
  insert(connection: DatabaseTransactionConnection, input: CreateAuditEventInput): AuditEventRecord
}
