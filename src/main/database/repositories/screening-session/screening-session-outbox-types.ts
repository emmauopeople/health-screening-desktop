import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ScreeningSessionOutboxOperation =
  'SCREENING_SESSION_CREATED' | 'SCREENING_SESSION_CLOSED' | 'SCREENING_SESSION_REOPENED'

export type ScreeningSessionOutboxPayloadSchemaVersion = 'screening-session.lifecycle.v1'

export type ScreeningSessionOutboxPayloadScalar = null | boolean | number | string
export type ScreeningSessionOutboxPayloadValue =
  | ScreeningSessionOutboxPayloadScalar
  | readonly ScreeningSessionOutboxPayloadValue[]
  | Readonly<{ [key: string]: ScreeningSessionOutboxPayloadValue }>

export type ScreeningSessionOutboxPayload = Readonly<{
  [key: string]: ScreeningSessionOutboxPayloadValue
}>

export interface InsertScreeningSessionOutboxInput {
  readonly id: EntityId
  readonly aggregateId: EntityId
  readonly operation: ScreeningSessionOutboxOperation
  readonly payloadSchemaVersion: ScreeningSessionOutboxPayloadSchemaVersion
  readonly createdAt: UtcTimestamp
  readonly payload: ScreeningSessionOutboxPayload
}

export interface ScreeningSessionOutboxRepository {
  insert(connection: DatabaseTransactionConnection, input: InsertScreeningSessionOutboxInput): void
}
