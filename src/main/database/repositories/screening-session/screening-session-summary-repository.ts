import type Database from 'better-sqlite3'

import { parseEntityId } from '@main/foundation/entity-id'
import type { EntityId } from '@main/foundation/entity-id'
import { parseUtcTimestamp } from '@main/foundation/utc-clock'

import { RepositoryDataIntegrityError, RepositoryReadError } from '../repository-errors'
import type {
  ScreeningSessionSummaryRecord,
  ScreeningSessionSummaryRepository
} from './screening-session-summary-types'
import {
  parseScreeningSessionDate,
  parseScreeningSessionStatus
} from './screening-session-validation'

const recordedDataSql = `
  EXISTS (SELECT 1 FROM screening_vitals_drafts d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM lifestyle_drafts d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM food_drafts d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM otc_drafts d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM blood_pressure_readings d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM lifestyle_logs d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM food_logs d WHERE d.encounter_id = encounter.id)
  OR EXISTS (SELECT 1 FROM otc_medication_logs d WHERE d.encounter_id = encounter.id)
`

const summarySql = `
SELECT
  session.id, session.session_date, session.status, session.opened_at, session.closed_at,
  location.id AS location_id, location.name AS location_name,
  opened_by.id AS opened_by_id, opened_by.display_name AS opened_by_name,
  closed_by.id AS closed_by_id, closed_by.display_name AS closed_by_name,
  COUNT(DISTINCT encounter.id) AS total_encounters,
  COUNT(DISTINCT CASE WHEN encounter.status = 'DRAFT' AND (${recordedDataSql}) THEN encounter.id END) AS active_drafts,
  COUNT(DISTINCT CASE WHEN encounter.status = 'DRAFT' AND NOT (${recordedDataSql}) THEN encounter.id END) AS empty_drafts,
  COUNT(DISTINCT CASE WHEN encounter.status IN ('COMPLETED', 'AMENDED') THEN encounter.id END) AS finalized_encounters,
  COUNT(DISTINCT CASE WHEN encounter.status = 'VOID' THEN encounter.id END) AS voided_encounters,
  COUNT(DISTINCT CASE WHEN encounter.status IN ('COMPLETED', 'AMENDED') AND encounter.next_action_category = 'ROUTINE' THEN encounter.id END) AS routine_count,
  COUNT(DISTINCT CASE WHEN encounter.status IN ('COMPLETED', 'AMENDED') AND encounter.next_action_category = 'REFER' THEN encounter.id END) AS standard_referral_count,
  COUNT(DISTINCT CASE WHEN encounter.status IN ('COMPLETED', 'AMENDED') AND encounter.next_action_category = 'URGENT_REFERRAL' THEN encounter.id END) AS urgent_referral_count,
  COUNT(DISTINCT CASE WHEN encounter.status IN ('COMPLETED', 'AMENDED') AND referral.status <> 'CLOSED' THEN referral.id END) AS open_referrals,
  COUNT(DISTINCT CASE WHEN encounter.status IN ('COMPLETED', 'AMENDED') AND referral.status = 'CLOSED' THEN referral.id END) AS closed_referrals
FROM screening_sessions session
JOIN locations location ON location.id = session.location_id
JOIN users opened_by ON opened_by.id = session.opened_by
LEFT JOIN users closed_by ON closed_by.id = session.closed_by
LEFT JOIN screening_encounters encounter ON encounter.screening_session_id = session.id
LEFT JOIN referrals referral ON referral.encounter_id = encounter.id
WHERE session.id = ?
GROUP BY session.id, location.id, opened_by.id, closed_by.id
`

export function createScreeningSessionSummaryRepository(
  connection: Database.Database
): ScreeningSessionSummaryRepository {
  return Object.freeze({
    getBySessionId(sessionId: EntityId) {
      const parsedId = parseEntityId(sessionId)
      try {
        const row = connection.prepare(summarySql).get(parsedId) as
          Record<string, unknown> | undefined
        return row === undefined ? null : readSummary(row)
      } catch (error) {
        if (error instanceof RepositoryDataIntegrityError) throw error
        throw new RepositoryReadError()
      }
    }
  })
}

function readSummary(row: Record<string, unknown>): ScreeningSessionSummaryRecord {
  const closedAt = nullableString(row['closed_at'])
  const closedById = nullableString(row['closed_by_id'])
  const closedByName = nullableString(row['closed_by_name'])
  if (
    (closedAt === null) !== (closedById === null) ||
    (closedById === null) !== (closedByName === null)
  )
    throw new RepositoryDataIntegrityError()

  return Object.freeze({
    id: parseEntityId(requiredString(row['id'])),
    sessionDate: parseScreeningSessionDate(requiredString(row['session_date'])),
    status: parseScreeningSessionStatus(requiredString(row['status'])),
    location: Object.freeze({
      id: parseEntityId(requiredString(row['location_id'])),
      name: requiredString(row['location_name'])
    }),
    openedAt: parseUtcTimestamp(requiredString(row['opened_at'])),
    openedBy: Object.freeze({
      id: parseEntityId(requiredString(row['opened_by_id'])),
      displayName: requiredString(row['opened_by_name'])
    }),
    closedAt: closedAt === null ? null : parseUtcTimestamp(closedAt),
    closedBy:
      closedById === null || closedByName === null
        ? null
        : Object.freeze({ id: parseEntityId(closedById), displayName: closedByName }),
    operational: Object.freeze({
      totalEncounters: count(row['total_encounters']),
      activeDrafts: count(row['active_drafts']),
      emptyDrafts: count(row['empty_drafts']),
      finalizedEncounters: count(row['finalized_encounters']),
      voidedEncounters: count(row['voided_encounters'])
    }),
    recommendations: Object.freeze({
      routine: count(row['routine_count']),
      standardReferral: count(row['standard_referral_count']),
      urgentReferral: count(row['urgent_referral_count'])
    }),
    referrals: Object.freeze({
      open: count(row['open_referrals']),
      closed: count(row['closed_referrals'])
    })
  })
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new RepositoryDataIntegrityError()
  return value
}
function nullableString(value: unknown): string | null {
  if (value === null) return null
  return requiredString(value)
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new RepositoryDataIntegrityError()
  return value
}
