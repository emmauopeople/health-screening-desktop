import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import { DatabaseTransactionStateError } from '@main/database/transaction'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { classifyScreeningEncounterIdentityConstraintError } from '@main/database/sqlite-constraint-classification'
import { parseEntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  parseInsertCanonicalRootScreeningEncounterInput,
  parseNullableScreeningEncounterText,
  parseScreeningEncounterRecordVersion,
  parseScreeningEncounterStatus,
  readDataProperties
} from './screening-encounter-validation'
import type {
  InsertCanonicalRootScreeningEncounterInput,
  InsertCanonicalRootScreeningEncounterResult,
  ScreeningEncounterRecord,
  ScreeningEncounterRepository,
  ScreeningEncounterSourceType
} from './screening-encounter-types'

interface ScreeningEncounterReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
  }
}

const screeningEncounterRowKeys = Object.freeze([
  'id',
  'patient_id',
  'screening_session_id',
  'location_id',
  'protocol_version_id',
  'status',
  'started_at',
  'completed_at',
  'source_type',
  'recorded_by',
  'summary_systolic',
  'summary_diastolic',
  'summary_pulse',
  'next_action_category',
  'decision_json',
  'amendment_of_encounter_id',
  'amendment_reason',
  'void_reason',
  'record_version',
  'created_at',
  'updated_at'
] as const)

const existsRowKeys = Object.freeze(['has_any'] as const)

const screeningEncounterColumns = `
  id,
  patient_id,
  screening_session_id,
  location_id,
  protocol_version_id,
  status,
  started_at,
  completed_at,
  source_type,
  recorded_by,
  summary_systolic,
  summary_diastolic,
  summary_pulse,
  next_action_category,
  decision_json,
  amendment_of_encounter_id,
  amendment_reason,
  void_reason,
  record_version,
  created_at,
  updated_at
`

const selectScreeningEncounterByIdSql = `
SELECT
${screeningEncounterColumns}
FROM screening_encounters
WHERE id = ?;
`

const selectCanonicalRootByPatientAndSessionSql = `
SELECT
${screeningEncounterColumns}
FROM screening_encounters
WHERE patient_id = ?
  AND screening_session_id = ?
  AND amendment_of_encounter_id IS NULL
ORDER BY started_at DESC, id DESC
LIMIT 1;
`

const selectActiveDraftByPatientAndSessionSql = `
SELECT
${screeningEncounterColumns}
FROM screening_encounters
WHERE patient_id = ?
  AND screening_session_id = ?
  AND amendment_of_encounter_id IS NULL
  AND status = 'DRAFT'
ORDER BY started_at DESC, id DESC
LIMIT 1;
`

const selectHasDraftScreeningEncounterForLocationSql = `
SELECT EXISTS(
  SELECT 1
  FROM screening_encounters
  WHERE location_id = ?
    AND status = 'DRAFT'
  LIMIT 1
) AS has_any;
`

const selectHasAnyDraftScreeningEncounterSql = `
SELECT EXISTS(
  SELECT 1
  FROM screening_encounters
  WHERE status = 'DRAFT'
  LIMIT 1
) AS has_any;
`

const selectHasCompletedRootByPatientAndSessionSql = `
SELECT EXISTS(
  SELECT 1
  FROM screening_encounters
  WHERE patient_id = ?
    AND screening_session_id = ?
    AND amendment_of_encounter_id IS NULL
    AND status IN ('COMPLETED', 'AMENDED')
  LIMIT 1
) AS has_any;
`

const insertCanonicalRootSql = `
INSERT INTO screening_encounters (
  id,
  patient_id,
  screening_session_id,
  location_id,
  protocol_version_id,
  status,
  started_at,
  completed_at,
  source_type,
  recorded_by,
  summary_systolic,
  summary_diastolic,
  summary_pulse,
  next_action_category,
  decision_json,
  amendment_of_encounter_id,
  amendment_reason,
  void_reason,
  record_version,
  created_at,
  updated_at
) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, NULL, 'LOCAL', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1, ?, ?);
`

export function createScreeningEncounterRepository(
  connection: Database.Database
): ScreeningEncounterRepository {
  return Object.freeze({
    getById(id: ScreeningEncounterRecord['id']): ScreeningEncounterRecord | null {
      const parsedId = parseReadEntityId(id)

      try {
        return readScreeningEncounter(
          connection,
          selectScreeningEncounterByIdSql,
          [parsedId],
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    getByIdForWrite(
      scopedConnection: DatabaseTransactionConnection,
      id: ScreeningEncounterRecord['id']
    ): ScreeningEncounterRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return readScreeningEncounter(
          scopedConnection,
          selectScreeningEncounterByIdSql,
          [parseReadEntityId(id)],
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    findCanonicalRootByPatientAndSession(
      patientId: ScreeningEncounterRecord['patientId'],
      screeningSessionId: ScreeningEncounterRecord['screeningSessionId']
    ): ScreeningEncounterRecord | null {
      const parsedPatientId = parseReadEntityId(patientId)
      const parsedSessionId = parseReadEntityId(screeningSessionId)

      try {
        return readScreeningEncounter(
          connection,
          selectCanonicalRootByPatientAndSessionSql,
          [parsedPatientId, parsedSessionId],
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    findCanonicalRootByPatientAndSessionForWrite(
      scopedConnection: DatabaseTransactionConnection,
      patientId: ScreeningEncounterRecord['patientId'],
      screeningSessionId: ScreeningEncounterRecord['screeningSessionId']
    ): ScreeningEncounterRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return readScreeningEncounter(
          scopedConnection,
          selectCanonicalRootByPatientAndSessionSql,
          [parseReadEntityId(patientId), parseReadEntityId(screeningSessionId)],
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    findActiveDraftByPatientAndSession(
      patientId: ScreeningEncounterRecord['patientId'],
      screeningSessionId: ScreeningEncounterRecord['screeningSessionId']
    ): ScreeningEncounterRecord | null {
      const parsedPatientId = parseReadEntityId(patientId)
      const parsedSessionId = parseReadEntityId(screeningSessionId)

      try {
        return readScreeningEncounter(
          connection,
          selectActiveDraftByPatientAndSessionSql,
          [parsedPatientId, parsedSessionId],
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    findActiveDraftByPatientAndSessionForWrite(
      scopedConnection: DatabaseTransactionConnection,
      patientId: ScreeningEncounterRecord['patientId'],
      screeningSessionId: ScreeningEncounterRecord['screeningSessionId']
    ): ScreeningEncounterRecord | null {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return readScreeningEncounter(
          scopedConnection,
          selectActiveDraftByPatientAndSessionSql,
          [parseReadEntityId(patientId), parseReadEntityId(screeningSessionId)],
          (error) => new RepositoryReadError(error)
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    hasCompletedRootByPatientAndSessionForWrite(
      scopedConnection: DatabaseTransactionConnection,
      patientId: ScreeningEncounterRecord['patientId'],
      screeningSessionId: ScreeningEncounterRecord['screeningSessionId']
    ): boolean {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return decodeExistsRow(
          scopedConnection
            .prepare<[string, string]>(selectHasCompletedRootByPatientAndSessionSql)
            .get(parseReadEntityId(patientId), parseReadEntityId(screeningSessionId))
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    hasDraftForLocationForWrite(
      scopedConnection: DatabaseTransactionConnection,
      locationId: ScreeningEncounterRecord['locationId']
    ): boolean {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return decodeExistsRow(
          scopedConnection
            .prepare<[string]>(selectHasDraftScreeningEncounterForLocationSql)
            .get(parseReadEntityId(locationId))
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryValidationError) {
          throw new RepositoryValidationError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    hasAnyDraftForWrite(scopedConnection: DatabaseTransactionConnection): boolean {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        return decodeExistsRow(
          scopedConnection.prepare(selectHasAnyDraftScreeningEncounterSql).get()
        )
      } catch (error) {
        if (error instanceof DatabaseTransactionStateError) {
          throw new DatabaseTransactionStateError(error.errorType)
        }

        if (error instanceof RepositoryDataIntegrityError) {
          throw new RepositoryDataIntegrityError(error.errorType)
        }

        throw new RepositoryReadError(getRepositoryErrorType(error))
      }
    },

    insertCanonicalRoot(
      scopedConnection: DatabaseTransactionConnection,
      input: InsertCanonicalRootScreeningEncounterInput
    ): InsertCanonicalRootScreeningEncounterResult {
      assertActiveDatabaseTransactionConnection(scopedConnection)

      try {
        const parsed = parseInsertCanonicalRootScreeningEncounterInput(input)

        scopedConnection
          .prepare<[string, string, string, string, string, string, string, string, string]>(
            insertCanonicalRootSql
          )
          .run(
            parsed.id,
            parsed.patientId,
            parsed.screeningSessionId,
            parsed.locationId,
            parsed.protocolVersionId,
            parsed.startedAt,
            parsed.recordedBy,
            parsed.startedAt,
            parsed.startedAt
          )

        const created = readScreeningEncounterAfterWrite(scopedConnection, parsed.id)

        if (created === null) {
          throw new RepositoryWriteError()
        }

        return Object.freeze({ status: 'CREATED' as const, encounter: created })
      } catch (error) {
        if (
          classifyScreeningEncounterIdentityConstraintError(error) ===
          'SCREENING_ENCOUNTER_IDENTITY_CONFLICT'
        ) {
          return Object.freeze({ status: 'IDENTITY_CONFLICT' as const })
        }

        throw toWriteError(error)
      }
    }
  })
}

function readScreeningEncounterAfterWrite(
  connection: DatabaseTransactionConnection,
  id: string
): ScreeningEncounterRecord | null {
  return readScreeningEncounter(
    connection,
    selectScreeningEncounterByIdSql,
    [id],
    (error) => new RepositoryWriteError(error)
  )
}

function readScreeningEncounter(
  connection: ScreeningEncounterReadConnection,
  sql: string,
  params: readonly unknown[],
  createFailure: (errorType?: string) => RepositoryReadError | RepositoryWriteError
): ScreeningEncounterRecord | null {
  try {
    const row = connection.prepare(sql).get(...params)

    return row === undefined ? null : decodeScreeningEncounterRow(row)
  } catch (error) {
    if (error instanceof DatabaseTransactionStateError) {
      throw new DatabaseTransactionStateError(error.errorType)
    }

    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw createFailure(getRepositoryErrorType(error))
  }
}

function decodeScreeningEncounterRow(row: unknown): ScreeningEncounterRecord {
  try {
    const data = readDataProperties(row, screeningEncounterRowKeys)
    const id = parseEntityId(data.id)
    const patientId = parseEntityId(data.patient_id)
    const screeningSessionId = parseEntityId(data.screening_session_id)
    const locationId = parseEntityId(data.location_id)
    const protocolVersionId = parseEntityId(data.protocol_version_id)
    const status = parseScreeningEncounterStatus(data.status)
    const startedAt = parseUtcTimestamp(data.started_at)
    const completedAt = data.completed_at === null ? null : parseUtcTimestamp(data.completed_at)
    const sourceType = parseSourceType(data.source_type)
    const recordedBy = parseEntityId(data.recorded_by)
    const summarySystolic = readNullablePositiveInteger(data.summary_systolic)
    const summaryDiastolic = readNullablePositiveInteger(data.summary_diastolic)
    const summaryPulse = readNullablePositiveInteger(data.summary_pulse)
    const nextActionCategory = parseNullableScreeningEncounterText(data.next_action_category)
    const decisionJson = parseNullableDecisionJson(data.decision_json)
    const amendmentOfEncounterId =
      data.amendment_of_encounter_id === null ? null : parseEntityId(data.amendment_of_encounter_id)
    const amendmentReason = parseNullableScreeningEncounterText(data.amendment_reason)
    const voidReason = parseNullableScreeningEncounterText(data.void_reason)
    const recordVersion = parseScreeningEncounterRecordVersion(data.record_version)
    const createdAt = parseUtcTimestamp(data.created_at)
    const updatedAt = parseUtcTimestamp(data.updated_at)

    if (updatedAt < createdAt || (completedAt !== null && completedAt < startedAt)) {
      throw new RepositoryDataIntegrityError()
    }

    return Object.freeze({
      id,
      patientId,
      screeningSessionId,
      locationId,
      protocolVersionId,
      status,
      startedAt,
      completedAt,
      sourceType,
      recordedBy,
      summarySystolic,
      summaryDiastolic,
      summaryPulse,
      nextActionCategory,
      decisionJson,
      amendmentOfEncounterId,
      amendmentReason,
      voidReason,
      recordVersion,
      createdAt,
      updatedAt
    })
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function decodeExistsRow(row: unknown): boolean {
  try {
    const data = readDataProperties(row, existsRowKeys)

    if (data.has_any === 0) {
      return false
    }

    if (data.has_any === 1) {
      return true
    }

    throw new RepositoryDataIntegrityError()
  } catch (error) {
    if (error instanceof RepositoryDataIntegrityError) {
      throw new RepositoryDataIntegrityError(error.errorType)
    }

    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }
}

function parseSourceType(value: unknown): ScreeningEncounterSourceType {
  if (value !== 'LOCAL') {
    throw new RepositoryDataIntegrityError()
  }

  return 'LOCAL'
}

function parseNullableDecisionJson(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'string') {
    throw new RepositoryDataIntegrityError()
  }

  try {
    JSON.parse(value)
  } catch (error) {
    throw new RepositoryDataIntegrityError(getRepositoryErrorType(error))
  }

  return value
}

function readNullablePositiveInteger(value: unknown): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryDataIntegrityError()
  }

  return value
}

function parseReadEntityId(value: unknown): string {
  try {
    return parseEntityId(value)
  } catch (error) {
    throw new RepositoryValidationError(getRepositoryErrorType(error))
  }
}

function toWriteError(error: unknown): Error {
  if (error instanceof DatabaseTransactionStateError) {
    return new DatabaseTransactionStateError(error.errorType)
  }

  if (error instanceof RepositoryValidationError) {
    return new RepositoryValidationError(error.errorType)
  }

  if (error instanceof RepositoryDataIntegrityError) {
    return new RepositoryDataIntegrityError(error.errorType)
  }

  if (error instanceof RepositoryWriteError) {
    return new RepositoryWriteError(error.errorType)
  }

  return new RepositoryWriteError(getRepositoryErrorType(error))
}
