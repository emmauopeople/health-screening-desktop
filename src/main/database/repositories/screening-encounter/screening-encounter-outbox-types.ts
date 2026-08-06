import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ScreeningEncounterOutboxOperation = 'SCREENING_ENCOUNTER_STARTED'
export type ScreeningEncounterOutboxPayloadSchemaVersion = 'screening-encounter.start.v1'

export type ScreeningEncounterOutboxPayloadScalar = null | boolean | number | string
export type ScreeningEncounterOutboxPayloadValue =
  | ScreeningEncounterOutboxPayloadScalar
  | readonly ScreeningEncounterOutboxPayloadValue[]
  | Readonly<{ [key: string]: ScreeningEncounterOutboxPayloadValue }>

export type ScreeningEncounterOutboxPayload = Readonly<{
  [key: string]: ScreeningEncounterOutboxPayloadValue
}>

export interface InsertScreeningEncounterOutboxInput {
  readonly id: EntityId
  readonly aggregateId: EntityId
  readonly operation: ScreeningEncounterOutboxOperation
  readonly payloadSchemaVersion: ScreeningEncounterOutboxPayloadSchemaVersion
  readonly createdAt: UtcTimestamp
  readonly payload: ScreeningEncounterOutboxPayload
}

export interface ScreeningEncounterOutboxRepository {
  insert(
    connection: DatabaseTransactionConnection,
    input: InsertScreeningEncounterOutboxInput
  ): void
}
