import type Database from 'better-sqlite3'

import { assertActiveDatabaseTransactionConnection } from '@main/database/transaction/transaction-capability'
import type { DatabaseTransactionConnection } from '@main/database/transaction'
import { parseEntityId, type EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { readDataProperties } from '../screening-encounter'
import {
  getRepositoryErrorType,
  RepositoryDataIntegrityError,
  RepositoryReadError,
  RepositoryValidationError,
  RepositoryWriteError
} from '../repository-errors'
import {
  normalizeOtcProductName,
  parseOtcDraftOwnershipInput,
  parseOtcDraftUpdateInput
} from './otc-validation'
import type {
  OtcCurrentlyTakingResponse,
  OtcDraftRecord,
  OtcDraftRowInput,
  OtcDraftRowRecord,
  OtcDraftUpdateInput,
  OtcDraftUpdateResult,
  OtcRecentMedicationSuggestionRecord,
  OtcRepository,
  OtcResponse,
  OtcSourceType
} from './otc-types'

interface ReadConnection {
  prepare(source: string): {
    get(...params: readonly unknown[]): unknown
    all(...params: readonly unknown[]): unknown[]
  }
}

const draftColumns = `
  id,
  encounter_id,
  patient_id,
  screening_session_id,
  location_id,
  installation_id,
  period_start,
  period_end,
  otc_response,
  created_by,
  created_at,
  updated_by,
  updated_at,
  row_version
`

const rowColumns = `
  id,
  otc_draft_id,
  sequence_number,
  product_name_snapshot,
  product_name_normalized,
  reason_for_use,
  dose_text,
  frequency_text,
  duration_text,
  source_of_medication,
  currently_taking_response,
  source_type,
  created_by,
  created_at,
  updated_by,
  updated_at
`

export function createOtcRepository(connection: Database.Database): OtcRepository {
  const repository: OtcRepository = {
    findDraftByEncounter: (encounterId) =>
      readDraftByEncounter(connection, parseEntityId(encounterId)),
    findDraftByEncounterForWrite: (tx, encounterId) => {
      assertActiveDatabaseTransactionConnection(tx)
      return readDraftByEncounter(tx, parseEntityId(encounterId))
    },
    insertDraft: (tx, input) => insertDraft(tx, input),
    updateDraft: (tx, input) => updateDraft(tx, input),
    listRecentPatientMedications: (patientId, currentEncounterId) =>
      listRecentPatientMedications(
        connection,
        parseEntityId(patientId),
        parseEntityId(currentEncounterId)
      ),
    listRecentPatientMedicationsForWrite: (tx, patientId, currentEncounterId) => {
      assertActiveDatabaseTransactionConnection(tx)
      return listRecentPatientMedications(
        tx,
        parseEntityId(patientId),
        parseEntityId(currentEncounterId)
      )
    }
  }
  return Object.freeze(repository)
}

function insertDraft(
  tx: DatabaseTransactionConnection,
  input: Parameters<OtcRepository['insertDraft']>[1]
): OtcDraftRecord {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const parsed = parseOtcDraftOwnershipInput(input)
    tx.prepare(
      `INSERT INTO otc_drafts (
        id,
        encounter_id,
        patient_id,
        screening_session_id,
        location_id,
        installation_id,
        period_start,
        period_end,
        otc_response,
        created_by,
        created_at,
        updated_by,
        updated_at,
        row_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 1)`
    ).run(
      parsed.id,
      parsed.encounterId,
      parsed.patientId,
      parsed.screeningSessionId,
      parsed.locationId,
      parsed.installationId,
      parsed.periodStart,
      parsed.periodEnd,
      parsed.actorId,
      parsed.occurredAt,
      parsed.actorId,
      parsed.occurredAt
    )
    return (
      readDraftById(tx, parsed.id) ??
      (() => {
        throw new RepositoryDataIntegrityError()
      })()
    )
  } catch (error) {
    throw mapWriteError(error)
  }
}

function updateDraft(
  tx: DatabaseTransactionConnection,
  input: OtcDraftUpdateInput
): OtcDraftUpdateResult {
  assertActiveDatabaseTransactionConnection(tx)
  try {
    const parsedInput = parseOtcDraftUpdateInput(input)
    const parsed = Object.freeze({
      ...parsedInput,
      rows: canonicalizeRows(parsedInput.rows)
    })
    const current = readDraftById(tx, parsed.id)
    if (!current) return { status: 'NOT_FOUND' }
    validateRowOwnership(tx, current, parsed.rows)

    if (current.rowVersion !== parsed.expectedRowVersion) {
      if (isDraftEquivalent(current, parsed)) return { status: 'UNCHANGED', draft: current }
      return { status: 'VERSION_CONFLICT', draft: current }
    }
    if (isDraftEquivalent(current, parsed)) return { status: 'UNCHANGED', draft: current }

    const result = tx
      .prepare(
        'UPDATE otc_drafts SET otc_response = ?, updated_by = ?, updated_at = ?, row_version = row_version + 1 WHERE id = ? AND row_version = ?'
      )
      .run(
        parsed.otcResponse,
        parsed.actorId,
        parsed.occurredAt,
        parsed.id,
        parsed.expectedRowVersion
      )
    if (result.changes !== 1) return { status: 'VERSION_CONFLICT', draft: current }
    reconcileRows(tx, current.id, parsed.rows, parsed.actorId, parsed.occurredAt)
    return {
      status: 'UPDATED',
      draft:
        readDraftById(tx, parsed.id) ??
        (() => {
          throw new RepositoryDataIntegrityError()
        })()
    }
  } catch (error) {
    throw mapWriteError(error)
  }
}

function validateRowOwnership(
  tx: DatabaseTransactionConnection,
  current: OtcDraftRecord,
  rows: readonly OtcDraftRowInput[]
): void {
  const storedById = new Map(current.rows.map((row) => [row.id, row]))
  for (const row of rows) {
    const stored = storedById.get(row.id)
    if (stored !== undefined && stored.otcDraftId !== current.id)
      throw new RepositoryValidationError()
    const owner = tx.prepare('SELECT otc_draft_id FROM otc_draft_rows WHERE id = ?').get(row.id) as
      { otc_draft_id?: unknown } | undefined
    if (owner !== undefined && owner.otc_draft_id !== current.id)
      throw new RepositoryValidationError()
  }
}

function reconcileRows(
  tx: DatabaseTransactionConnection,
  draftId: EntityId,
  rows: readonly OtcDraftRowInput[],
  actorId: EntityId,
  at: string
): void {
  const stored = tx
    .prepare('SELECT * FROM otc_draft_rows WHERE otc_draft_id = ? ORDER BY sequence_number')
    .all(draftId) as Record<string, unknown>[]
  const storedById = new Map(stored.map((row) => [String(row.id), row]))
  const sequenceChangingExistingRows: OtcDraftRowInput[] = []
  const changedExistingRows: OtcDraftRowInput[] = []
  const newRows: OtcDraftRowInput[] = []

  for (const row of rows) {
    const old = storedById.get(row.id)
    if (!old) {
      newRows.push(row)
      continue
    }
    if (Number(old.sequence_number) !== row.sequenceNumber) sequenceChangingExistingRows.push(row)
    if (!sameStoredRow(old, row)) changedExistingRows.push(row)
  }

  const temporarySequences = allocateTemporarySequences(
    stored,
    rows,
    sequenceChangingExistingRows.length
  )
  let temporarySequenceIndex = 0
  for (const row of sequenceChangingExistingRows) {
    tx.prepare(
      'UPDATE otc_draft_rows SET sequence_number = ? WHERE id = ? AND otc_draft_id = ?'
    ).run(temporarySequences[temporarySequenceIndex], row.id, draftId)
    temporarySequenceIndex += 1
  }

  const submitted = new Set(rows.map((row) => String(row.id)))
  for (const old of stored) {
    if (!submitted.has(String(old.id))) {
      tx.prepare('DELETE FROM otc_draft_rows WHERE id = ? AND otc_draft_id = ?').run(
        old.id,
        draftId
      )
    }
  }
  for (const row of changedExistingRows) updateRow(tx, draftId, row, actorId, at)
  for (const row of newRows) insertRow(tx, draftId, row, actorId, at)
}

function updateRow(
  tx: DatabaseTransactionConnection,
  draftId: EntityId,
  row: OtcDraftRowInput,
  actorId: EntityId,
  at: string
): void {
  const normalized = normalizeNullableProductName(row.productNameSnapshot)
  tx.prepare(
    `UPDATE otc_draft_rows
     SET sequence_number = ?,
         product_name_snapshot = ?,
         product_name_normalized = ?,
         reason_for_use = ?,
         dose_text = ?,
         frequency_text = ?,
         duration_text = ?,
         source_of_medication = ?,
         currently_taking_response = ?,
         source_type = ?,
         updated_by = ?,
         updated_at = ?
     WHERE id = ? AND otc_draft_id = ?`
  ).run(
    row.sequenceNumber,
    normalized.snapshot,
    normalized.normalized,
    row.reasonForUse,
    row.doseText,
    row.frequencyText,
    row.durationText,
    row.sourceOfMedication,
    row.currentlyTakingResponse,
    row.sourceType,
    actorId,
    at,
    row.id,
    draftId
  )
}

function insertRow(
  tx: DatabaseTransactionConnection,
  draftId: EntityId,
  row: OtcDraftRowInput,
  actorId: EntityId,
  at: string
): void {
  const normalized = normalizeNullableProductName(row.productNameSnapshot)
  tx.prepare(
    `INSERT INTO otc_draft_rows (
      id,
      otc_draft_id,
      sequence_number,
      product_name_snapshot,
      product_name_normalized,
      reason_for_use,
      dose_text,
      frequency_text,
      duration_text,
      source_of_medication,
      currently_taking_response,
      source_type,
      created_by,
      created_at,
      updated_by,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    draftId,
    row.sequenceNumber,
    normalized.snapshot,
    normalized.normalized,
    row.reasonForUse,
    row.doseText,
    row.frequencyText,
    row.durationText,
    row.sourceOfMedication,
    row.currentlyTakingResponse,
    row.sourceType,
    actorId,
    at,
    actorId,
    at
  )
}

function normalizeNullableProductName(value: string | null): {
  readonly snapshot: string | null
  readonly normalized: string | null
} {
  if (value === null) return { snapshot: null, normalized: null }
  return normalizeOtcProductName(value)
}

function allocateTemporarySequences(
  storedRows: readonly Record<string, unknown>[],
  submittedRows: readonly OtcDraftRowInput[],
  count: number
): readonly number[] {
  if (count === 0) return Object.freeze([])
  const maxStoredSequence = storedRows.reduce(
    (max, row) => Math.max(max, parseStoredPositiveInteger(row.sequence_number)),
    0
  )
  const maxSubmittedSequence = submittedRows.reduce(
    (max, row) => Math.max(max, row.sequenceNumber),
    0
  )
  const firstTemporarySequence = Math.max(maxStoredSequence, maxSubmittedSequence) + 1
  const lastTemporarySequence = firstTemporarySequence + count - 1
  if (
    !Number.isSafeInteger(firstTemporarySequence) ||
    !Number.isSafeInteger(lastTemporarySequence) ||
    firstTemporarySequence <= 0 ||
    lastTemporarySequence > Number.MAX_SAFE_INTEGER
  )
    throw new RepositoryValidationError()
  return Object.freeze(Array.from({ length: count }, (_, index) => firstTemporarySequence + index))
}

function isDraftEquivalent(current: OtcDraftRecord, next: OtcDraftUpdateInput): boolean {
  const currentRows = [...current.rows].sort(compareRowsBySequence)
  const nextRows = canonicalizeRows(next.rows)
  return (
    current.otcResponse === next.otcResponse &&
    currentRows.length === nextRows.length &&
    currentRows.every((row, index) => {
      const candidate = nextRows[index]
      return candidate !== undefined && sameRecordAndInput(row, candidate)
    })
  )
}

function canonicalizeRows(rows: readonly OtcDraftRowInput[]): readonly OtcDraftRowInput[] {
  return Object.freeze([...rows].sort((left, right) => left.sequenceNumber - right.sequenceNumber))
}

function compareRowsBySequence(left: OtcDraftRowRecord, right: OtcDraftRowRecord): number {
  return left.sequenceNumber - right.sequenceNumber
}

function sameRecordAndInput(record: OtcDraftRowRecord, input: OtcDraftRowInput): boolean {
  const normalized = normalizeNullableProductName(input.productNameSnapshot)
  return (
    record.id === input.id &&
    record.sequenceNumber === input.sequenceNumber &&
    record.productNameSnapshot === normalized.snapshot &&
    record.productNameNormalized === normalized.normalized &&
    record.reasonForUse === input.reasonForUse &&
    record.doseText === input.doseText &&
    record.frequencyText === input.frequencyText &&
    record.durationText === input.durationText &&
    record.sourceOfMedication === input.sourceOfMedication &&
    record.currentlyTakingResponse === input.currentlyTakingResponse &&
    record.sourceType === input.sourceType
  )
}

function sameStoredRow(stored: Record<string, unknown>, input: OtcDraftRowInput): boolean {
  const normalized = normalizeNullableProductName(input.productNameSnapshot)
  return (
    Number(stored.sequence_number) === input.sequenceNumber &&
    stored.product_name_snapshot === normalized.snapshot &&
    stored.product_name_normalized === normalized.normalized &&
    stored.reason_for_use === input.reasonForUse &&
    stored.dose_text === input.doseText &&
    stored.frequency_text === input.frequencyText &&
    stored.duration_text === input.durationText &&
    stored.source_of_medication === input.sourceOfMedication &&
    stored.currently_taking_response === input.currentlyTakingResponse &&
    stored.source_type === input.sourceType
  )
}

function readDraftByEncounter(
  connection: ReadConnection,
  encounterId: EntityId
): OtcDraftRecord | null {
  const row = connection
    .prepare(`SELECT ${draftColumns} FROM otc_drafts WHERE encounter_id = ?`)
    .get(encounterId)
  return row === undefined ? null : decodeDraft(connection, row)
}

function readDraftById(connection: ReadConnection, id: EntityId): OtcDraftRecord | null {
  const row = connection.prepare(`SELECT ${draftColumns} FROM otc_drafts WHERE id = ?`).get(id)
  return row === undefined ? null : decodeDraft(connection, row)
}

function decodeDraft(connection: ReadConnection, row: unknown): OtcDraftRecord {
  try {
    const data = readDataProperties(row, [
      'id',
      'encounter_id',
      'patient_id',
      'screening_session_id',
      'location_id',
      'installation_id',
      'period_start',
      'period_end',
      'otc_response',
      'created_by',
      'created_at',
      'updated_by',
      'updated_at',
      'row_version'
    ] as const)
    const id = parseEntityId(data.id)
    return Object.freeze({
      id,
      encounterId: parseEntityId(data.encounter_id),
      patientId: parseEntityId(data.patient_id),
      screeningSessionId: parseEntityId(data.screening_session_id),
      locationId: parseEntityId(data.location_id),
      installationId: parseEntityId(data.installation_id),
      periodStart: String(data.period_start) as OtcDraftRecord['periodStart'],
      periodEnd: String(data.period_end) as OtcDraftRecord['periodEnd'],
      otcResponse: data.otc_response as OtcResponse | null,
      createdBy: parseEntityId(data.created_by),
      createdAt: parseUtcTimestamp(data.created_at),
      updatedBy: parseEntityId(data.updated_by),
      updatedAt: parseUtcTimestamp(data.updated_at),
      rowVersion: parseStoredPositiveInteger(data.row_version),
      rows: Object.freeze(readRows(connection, id))
    })
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function readRows(connection: ReadConnection, draftId: EntityId): readonly OtcDraftRowRecord[] {
  return Object.freeze(
    (
      connection
        .prepare(
          `SELECT ${rowColumns} FROM otc_draft_rows WHERE otc_draft_id = ? ORDER BY sequence_number`
        )
        .all(draftId) as readonly unknown[]
    ).map(decodeRow)
  )
}

function decodeRow(row: unknown): OtcDraftRowRecord {
  const data = readDataProperties(row, [
    'id',
    'otc_draft_id',
    'sequence_number',
    'product_name_snapshot',
    'product_name_normalized',
    'reason_for_use',
    'dose_text',
    'frequency_text',
    'duration_text',
    'source_of_medication',
    'currently_taking_response',
    'source_type',
    'created_by',
    'created_at',
    'updated_by',
    'updated_at'
  ] as const)
  return Object.freeze({
    id: parseEntityId(data.id),
    otcDraftId: parseEntityId(data.otc_draft_id),
    sequenceNumber: parseStoredPositiveInteger(data.sequence_number),
    productNameSnapshot:
      data.product_name_snapshot === null ? null : String(data.product_name_snapshot),
    productNameNormalized:
      data.product_name_normalized === null ? null : String(data.product_name_normalized),
    reasonForUse: data.reason_for_use === null ? null : String(data.reason_for_use),
    doseText: data.dose_text === null ? null : String(data.dose_text),
    frequencyText: data.frequency_text === null ? null : String(data.frequency_text),
    durationText: data.duration_text === null ? null : String(data.duration_text),
    sourceOfMedication:
      data.source_of_medication === null ? null : String(data.source_of_medication),
    currentlyTakingResponse:
      data.currently_taking_response === null
        ? null
        : (data.currently_taking_response as OtcCurrentlyTakingResponse),
    sourceType: data.source_type as OtcSourceType,
    createdBy: parseEntityId(data.created_by),
    createdAt: parseUtcTimestamp(data.created_at),
    updatedBy: parseEntityId(data.updated_by),
    updatedAt: parseUtcTimestamp(data.updated_at)
  })
}

function listRecentPatientMedications(
  connection: ReadConnection,
  patientId: EntityId,
  currentEncounterId: EntityId
): readonly OtcRecentMedicationSuggestionRecord[] {
  try {
    return Object.freeze(
      (
        connection
          .prepare(
            `SELECT product_name, product_name_normalized, recorded_at
             FROM (
               SELECT
                 otc_medication_logs.product_name,
                 otc_medication_logs.product_name_normalized,
                 otc_medication_logs.recorded_at,
                 row_number() OVER (
                   PARTITION BY lower(otc_medication_logs.product_name_normalized)
                   ORDER BY otc_medication_logs.recorded_at DESC, otc_medication_logs.id DESC
                 ) AS occurrence_rank
               FROM otc_medication_logs
               INNER JOIN screening_encounters
                 ON screening_encounters.id = otc_medication_logs.encounter_id
               WHERE screening_encounters.patient_id = ?
                 AND screening_encounters.id <> ?
                 AND screening_encounters.status = 'COMPLETED'
             )
             WHERE occurrence_rank = 1
             ORDER BY recorded_at DESC, lower(product_name_normalized), product_name
             LIMIT 10`
          )
          .all(patientId, currentEncounterId) as readonly unknown[]
      ).map(decodeRecentMedicationSuggestion)
    )
  } catch (error) {
    throw new RepositoryReadError(getRepositoryErrorType(error))
  }
}

function decodeRecentMedicationSuggestion(row: unknown): OtcRecentMedicationSuggestionRecord {
  const data = readDataProperties(row, [
    'product_name',
    'product_name_normalized',
    'recorded_at'
  ] as const)
  return Object.freeze({
    productNameSnapshot: String(data.product_name),
    productNameNormalized: String(data.product_name_normalized),
    lastRecordedAt: parseUtcTimestamp(data.recorded_at)
  })
}

function parseStoredPositiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new RepositoryReadError()
  return value
}

function mapWriteError(error: unknown): Error {
  if (
    error instanceof RepositoryValidationError ||
    error instanceof RepositoryDataIntegrityError ||
    error instanceof RepositoryReadError
  )
    return error
  return new RepositoryWriteError(getRepositoryErrorType(error))
}
