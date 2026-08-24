import type { DatabaseTransactionConnection } from '@main/database/transaction'
import type { EntityId } from '@main/foundation/entity-id'
import type { UtcTimestamp } from '@main/foundation/utc-clock'

export type ScreeningEncounterStatus = 'DRAFT' | 'COMPLETED' | 'AMENDED' | 'VOID'
export type ScreeningEncounterSourceType = 'LOCAL'

export interface ScreeningEncounterRecord {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly protocolVersionId: EntityId
  readonly status: ScreeningEncounterStatus
  readonly startedAt: UtcTimestamp
  readonly completedAt: UtcTimestamp | null
  readonly sourceType: ScreeningEncounterSourceType
  readonly recordedBy: EntityId
  readonly summarySystolic: number | null
  readonly summaryDiastolic: number | null
  readonly summaryPulse: number | null
  readonly nextActionCategory: string | null
  readonly decisionJson: string | null
  readonly amendmentOfEncounterId: EntityId | null
  readonly amendmentReason: string | null
  readonly voidReason: string | null
  readonly recordVersion: number
  readonly createdAt: UtcTimestamp
  readonly updatedAt: UtcTimestamp
}

export interface InsertCanonicalRootScreeningEncounterInput {
  readonly id: EntityId
  readonly patientId: EntityId
  readonly screeningSessionId: EntityId
  readonly locationId: EntityId
  readonly protocolVersionId: EntityId
  readonly startedAt: UtcTimestamp
  readonly recordedBy: EntityId
}

export type InsertCanonicalRootScreeningEncounterResult =
  | {
      readonly status: 'CREATED'
      readonly encounter: ScreeningEncounterRecord
    }
  | {
      readonly status: 'IDENTITY_CONFLICT'
    }

export interface ScreeningEncounterRepository {
  getById(id: EntityId): ScreeningEncounterRecord | null
  getByIdForWrite(
    connection: DatabaseTransactionConnection,
    id: EntityId
  ): ScreeningEncounterRecord | null
  findCanonicalRootByPatientAndSession(
    patientId: EntityId,
    screeningSessionId: EntityId
  ): ScreeningEncounterRecord | null
  findCanonicalRootByPatientAndSessionForWrite(
    connection: DatabaseTransactionConnection,
    patientId: EntityId,
    screeningSessionId: EntityId
  ): ScreeningEncounterRecord | null
  findActiveDraftByPatientAndSession(
    patientId: EntityId,
    screeningSessionId: EntityId
  ): ScreeningEncounterRecord | null
  findActiveDraftByPatientAndSessionForWrite(
    connection: DatabaseTransactionConnection,
    patientId: EntityId,
    screeningSessionId: EntityId
  ): ScreeningEncounterRecord | null
  hasCompletedRootByPatientAndSessionForWrite(
    connection: DatabaseTransactionConnection,
    patientId: EntityId,
    screeningSessionId: EntityId
  ): boolean
  hasDraftForLocationForWrite(
    connection: DatabaseTransactionConnection,
    locationId: EntityId
  ): boolean
  hasAnyDraftForWrite(connection: DatabaseTransactionConnection): boolean
  insertCanonicalRoot(
    connection: DatabaseTransactionConnection,
    input: InsertCanonicalRootScreeningEncounterInput
  ): InsertCanonicalRootScreeningEncounterResult
}
