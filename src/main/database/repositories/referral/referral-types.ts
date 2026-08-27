import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ReferralUrgency = 'STANDARD' | 'URGENT'
export type ReferralStatus = 'OPEN' | 'CONTACTED' | 'SEEN' | 'UNABLE_TO_CONFIRM' | 'CLOSED'
export type AutomaticReferralReasonCode = 'BP_SCREENING_REFERRAL' | 'BP_SCREENING_URGENT_REFERRAL'

export interface ReferralRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly encounterId: EntityId
  readonly protocolVersionId: EntityId
  readonly reasonCodes: readonly AutomaticReferralReasonCode[]
  readonly urgency: ReferralUrgency
  readonly dueDate: string
  readonly status: 'OPEN'
  readonly createdBy: EntityId
  readonly createdAt: UtcTimestamp
  readonly recordVersion: 1
}

export interface CreateAutomaticReferralInput {
  readonly id: EntityId
  readonly statusHistoryId: EntityId
  readonly outboxId: EntityId
  readonly patientId: EntityId
  readonly encounterId: EntityId
  readonly protocolVersionId: EntityId
  readonly reasonCode: AutomaticReferralReasonCode
  readonly urgency: ReferralUrgency
  readonly dueDate: string
  readonly actorId: EntityId
  readonly createdAt: UtcTimestamp
}

export type CreateAutomaticReferralResult =
  | { readonly status: 'CREATED'; readonly referral: ReferralRecord }
  | { readonly status: 'EXISTING'; readonly referral: ReferralRecord }

export interface ReferralRepository {
  createAutomaticReferral(
    connection: DatabaseTransactionConnection,
    input: CreateAutomaticReferralInput
  ): CreateAutomaticReferralResult
}
