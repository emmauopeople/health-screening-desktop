import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ScreeningEncounterOutboxOperation =
  | 'SCREENING_ENCOUNTER_STARTED'
  | 'SCREENING_VITALS_DRAFT_SAVED'
  | 'SCREENING_VITALS_STEP_COMPLETED'
  | 'SCREENING_LIFESTYLE_ALCOHOL_BASELINE_CREATED'
  | 'SCREENING_LIFESTYLE_TOBACCO_BASELINE_CREATED'
  | 'SCREENING_LIFESTYLE_WORK_BASELINE_CREATED'
  | 'SCREENING_LIFESTYLE_DRAFT_SAVED'
  | 'SCREENING_LIFESTYLE_STEP_COMPLETED'
  | 'SCREENING_LIFESTYLE_REOPENED'
export type ScreeningEncounterOutboxPayloadSchemaVersion =
  | 'screening-encounter.start.v1'
  | 'screening-encounter.vitals-draft-saved.v1'
  | 'screening-encounter.vitals-step-completed.v1'
  | 'screening-encounter.lifestyle-alcohol-baseline-created.v1'
  | 'screening-encounter.lifestyle-tobacco-baseline-created.v1'
  | 'screening-encounter.lifestyle-work-baseline-created.v1'
  | 'screening-encounter.lifestyle-draft-saved.v1'
  | 'screening-encounter.lifestyle-step-completed.v1'
  | 'screening-encounter.lifestyle-reopened.v1'

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
