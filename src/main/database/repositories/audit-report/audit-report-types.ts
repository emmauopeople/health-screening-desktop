import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

import type { AuditActionCode, AuditEntityType, AuditMetadata } from '../audit-event'
import type { IanaTimeZone } from '../installation'
import type { LocalUserRole } from '../local-user'

export type AuditReportPageSize = 25 | 50 | 100

export type AuditReportActorFilter =
  | { readonly kind: 'ALL' }
  | { readonly kind: 'SYSTEM' }
  | { readonly kind: 'USER'; readonly userId: string }

export interface AuditReportSearchInput {
  readonly query: string
  readonly occurredFromInclusive: string | null
  readonly occurredToExclusive: string | null
  readonly actor: AuditReportActorFilter
  readonly action: string | null
  readonly entityType: string | null
  readonly entityId: string | null
  readonly page: number
  readonly pageSize: AuditReportPageSize
}

export interface AuditReportActorRecord {
  readonly id: EntityId
  readonly username: string
  readonly displayName: string
  readonly role: LocalUserRole
}

export interface AuditReportDeploymentRecord {
  readonly id: EntityId
  readonly name: string
  readonly timeZone: IanaTimeZone
}

export interface AuditReportEventRecord {
  readonly id: EntityId
  readonly action: AuditActionCode
  readonly entityType: AuditEntityType
  readonly entityId: EntityId | null
  readonly occurredAt: UtcTimestamp
  readonly actor: AuditReportActorRecord | null
  readonly deployment: AuditReportDeploymentRecord
  readonly metadata: AuditMetadata
}

export interface AuditReportContextRecord {
  readonly deployment: AuditReportDeploymentRecord
  readonly actors: readonly AuditReportActorRecord[]
  readonly actions: readonly AuditActionCode[]
  readonly entityTypes: readonly AuditEntityType[]
  readonly hasSystemEvents: boolean
}

export interface AuditReportSearchResult {
  readonly items: readonly AuditReportEventRecord[]
  readonly page: number
  readonly pageSize: AuditReportPageSize
  readonly total: number
}

export interface AuditReportRepository {
  getContext(): AuditReportContextRecord
  search(input: AuditReportSearchInput): AuditReportSearchResult
}
