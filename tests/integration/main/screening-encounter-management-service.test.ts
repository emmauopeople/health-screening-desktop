import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import {
  createScreeningEncounterManagementService,
  type LocalAuthenticationSessionService
} from '@main/application'
import type { InstallationLocationService } from '@main/application/installation-location'
import {
  createAuditEventRepository,
  createDatabaseTransactionExecutor,
  createInstallationRepository,
  createProductionDatabaseMigrationRunner,
  createScreeningEncounterManagementRepository,
  createScreeningEncounterOutboxRepository,
  createScreeningEncounterRepository,
  parseLocationName,
  parseUserDisplayName,
  parseUsername,
  type LocalUserRecord
} from '@main/database'
import { createEntityIdGenerator, parseEntityId } from '@main/foundation/entity-id'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-20T12:00:00.000Z' as UtcTimestamp
const later = '2026-08-20T13:00:00.000Z' as UtcTimestamp
const ids = Object.freeze({
  installation: '52000000-0000-4000-8000-000000000001',
  user: '52000000-0000-4000-8000-000000000002',
  location: '52000000-0000-4000-8000-000000000003',
  patient: '52000000-0000-4000-8000-000000000004',
  draftPatient: '52000000-0000-4000-8000-000000000020',
  session: '52000000-0000-4000-8000-000000000005',
  encounter: '52000000-0000-4000-8000-000000000006',
  draftEncounter: '52000000-0000-4000-8000-000000000007',
  vital: '52000000-0000-4000-8000-000000000008',
  lifestyle: '52000000-0000-4000-8000-000000000009',
  food: '52000000-0000-4000-8000-000000000010',
  otc: '52000000-0000-4000-8000-000000000011',
  addendum: '52000000-0000-4000-8000-000000000012',
  addAudit: '52000000-0000-4000-8000-000000000013',
  addOutbox: '52000000-0000-4000-8000-000000000014',
  flag: '52000000-0000-4000-8000-000000000015',
  flagAudit: '52000000-0000-4000-8000-000000000016',
  flagOutbox: '52000000-0000-4000-8000-000000000017',
  resolveAudit: '52000000-0000-4000-8000-000000000018',
  resolveOutbox: '52000000-0000-4000-8000-000000000019',
  draftVitals: '52000000-0000-4000-8000-000000000021',
  voidAudit: '52000000-0000-4000-8000-000000000022',
  voidOutbox: '52000000-0000-4000-8000-000000000023',
  unavailablePatient: '52000000-0000-4000-8000-000000000024',
  unavailableSession: '52000000-0000-4000-8000-000000000025',
  unavailableEncounter: '52000000-0000-4000-8000-000000000026',
  cancelledPatient: '52000000-0000-4000-8000-000000000027',
  cancelledEncounter: '52000000-0000-4000-8000-000000000028',
  cancelledVitals: '52000000-0000-4000-8000-000000000029',
  cancelAudit: '52000000-0000-4000-8000-000000000030',
  cancelOutbox: '52000000-0000-4000-8000-000000000031'
})

describe('screening encounter management service integration', () => {
  it('keeps finalized clinical data immutable while appending notes and review flags', async () => {
    await withService(({ connection, service }) => {
      const search = service.search({ query: 'test patient', status: 'ALL', page: 1, pageSize: 25 })
      expect(search).toMatchObject({
        status: 'LOADED',
        result: { total: 1, items: [{ patientDisplayName: 'Test Patient' }] }
      })

      const before = service.getDetail(parseEntityId(ids.encounter))
      expect(before.status).toBe('LOADED')
      if (before.status !== 'LOADED') return
      const clinicalBefore = {
        vitals: before.detail.vitals,
        lifestyle: before.detail.lifestyle,
        foods: before.detail.foods,
        otcMedications: before.detail.otcMedications
      }

      expect(
        service.addAddendum(parseEntityId(ids.encounter), 'Source record needs review.')
      ).toMatchObject({
        status: 'ADDED',
        addendum: { id: ids.addendum, noteText: 'Source record needs review.' }
      })
      const opened = service.openFlag(
        parseEntityId(ids.encounter),
        'POSSIBLE_DATA_ERROR',
        'Possible transcription issue.'
      )
      expect(opened).toMatchObject({ status: 'OPENED', flag: { id: ids.flag, status: 'OPEN' } })
      expect(
        service.resolveFlag(
          parseEntityId(ids.encounter),
          parseEntityId(ids.flag),
          'RESOLVED',
          'Compared with the source record.'
        )
      ).toMatchObject({ status: 'UPDATED', flag: { id: ids.flag, status: 'RESOLVED' } })

      const after = service.getDetail(parseEntityId(ids.encounter))
      expect(after.status).toBe('LOADED')
      if (after.status !== 'LOADED') return
      expect({
        vitals: after.detail.vitals,
        lifestyle: after.detail.lifestyle,
        foods: after.detail.foods,
        otcMedications: after.detail.otcMedications
      }).toEqual(clinicalBefore)
      expect(after.detail.addenda).toHaveLength(1)
      expect(after.detail.flags).toMatchObject([{ status: 'RESOLVED' }])
      expect(readCount(connection, 'audit_log')).toBe(3)
      expect(readCount(connection, 'sync_outbox')).toBe(3)

      const operationalMetadata = JSON.stringify({
        audit: connection
          .prepare('SELECT metadata_json FROM audit_log ORDER BY occurred_at, id')
          .all(),
        outbox: connection
          .prepare('SELECT payload_json FROM sync_outbox ORDER BY created_at, id')
          .all()
      })
      for (const prohibited of [
        'Source record needs review',
        'Possible transcription issue',
        'Compared with the source record',
        'Leafy greens',
        'Pain reliever'
      ]) {
        expect(operationalMetadata).not.toContain(prohibited)
      }

      const sideEffectsBefore = [
        readCount(connection, 'screening_encounter_addenda'),
        readCount(connection, 'audit_log'),
        readCount(connection, 'sync_outbox')
      ]
      expect(
        service.addAddendum(parseEntityId(ids.draftEncounter), 'This must not be added.')
      ).toEqual({ status: 'ENCOUNTER_NOT_MANAGEABLE' })
      expect([
        readCount(connection, 'screening_encounter_addenda'),
        readCount(connection, 'audit_log'),
        readCount(connection, 'sync_outbox')
      ]).toEqual(sideEffectsBefore)

      const draftSearch = service.search({ query: 'draft', status: 'DRAFT', page: 1, pageSize: 25 })
      expect(draftSearch).toMatchObject({
        status: 'LOADED',
        result: {
          items: [
            {
              id: ids.draftEncounter,
              screeningSessionId: ids.session,
              recordVersion: 1,
              hasRecordedData: false
            }
          ]
        }
      })
      expect(
        service.search({ query: 'unavailable', status: 'DRAFT', page: 1, pageSize: 25 })
      ).toMatchObject({ status: 'LOADED', result: { total: 0, items: [] } })
      expect(service.getDetail(parseEntityId(ids.unavailableEncounter))).toEqual({
        status: 'ENCOUNTER_NOT_FOUND'
      })

      connection
        .prepare(
          `INSERT INTO screening_vitals_drafts
             (id, encounter_id, status, weight_kg, waist_cm, notes, created_by, created_at,
              updated_by, updated_at, row_version)
           VALUES (?, ?, 'DRAFT', NULL, NULL, NULL, ?, ?, ?, ?, 1)`
        )
        .run(ids.draftVitals, ids.draftEncounter, ids.user, now, ids.user, now)
      expect(
        service.voidEmptyDraft(parseEntityId(ids.draftEncounter), 1, 'Created in error.')
      ).toEqual({ status: 'ENCOUNTER_NOT_EMPTY' })
      expect(readCount(connection, 'audit_log')).toBe(3)
      expect(readCount(connection, 'sync_outbox')).toBe(3)

      connection.prepare('DELETE FROM screening_vitals_drafts WHERE id = ?').run(ids.draftVitals)
      expect(
        service.voidEmptyDraft(parseEntityId(ids.draftEncounter), 1, 'Created in error.')
      ).toEqual({ status: 'VOIDED', recordVersion: 2 })
      expect(
        connection
          .prepare(
            'SELECT status, void_reason, record_version FROM screening_encounters WHERE id = ?'
          )
          .get(ids.draftEncounter)
      ).toEqual({ status: 'VOID', void_reason: 'Created in error.', record_version: 2 })
      expect(readCount(connection, 'audit_log')).toBe(4)
      expect(readCount(connection, 'sync_outbox')).toBe(4)
      const voidMetadata = JSON.stringify({
        audit: connection
          .prepare('SELECT metadata_json FROM audit_log WHERE action = ?')
          .get('SCREENING_ENCOUNTER_VOIDED'),
        outbox: connection
          .prepare('SELECT payload_json FROM sync_outbox WHERE operation = ?')
          .get('SCREENING_ENCOUNTER_VOIDED')
      })
      expect(voidMetadata).not.toContain('Created in error')

      expect(
        service.search({ query: 'draft', status: 'ALL', page: 1, pageSize: 25 })
      ).toMatchObject({
        status: 'LOADED',
        result: { total: 0, items: [] }
      })
      expect(
        service.search({ query: 'draft', status: 'VOID', page: 1, pageSize: 25 })
      ).toMatchObject({
        status: 'LOADED',
        result: { total: 1, items: [{ id: ids.draftEncounter, status: 'VOID' }] }
      })

      expect(
        service.cancelDraft(
          parseEntityId(ids.cancelledEncounter),
          1,
          'PATIENT_CHOSE_NOT_TO_CONTINUE',
          null
        )
      ).toEqual({ status: 'VOIDED', recordVersion: 2 })
      expect(
        connection
          .prepare(
            'SELECT status, void_reason, record_version FROM screening_encounters WHERE id = ?'
          )
          .get(ids.cancelledEncounter)
      ).toEqual({
        status: 'VOID',
        void_reason: 'Patient chose not to continue',
        record_version: 2
      })
      expect(
        connection
          .prepare('SELECT notes FROM screening_vitals_drafts WHERE encounter_id = ?')
          .get(ids.cancelledEncounter)
      ).toEqual({ notes: 'Saved before cancellation' })
      const cancellationMetadata = JSON.stringify({
        audit: connection
          .prepare('SELECT metadata_json FROM audit_log WHERE id = ?')
          .get(ids.cancelAudit),
        outbox: connection
          .prepare('SELECT payload_json FROM sync_outbox WHERE id = ?')
          .get(ids.cancelOutbox)
      })
      expect(cancellationMetadata).toContain('PATIENT_CHOSE_NOT_TO_CONTINUE')
      expect(cancellationMetadata).not.toContain('Saved before cancellation')
    })
  })
})

async function withService(
  test: (context: {
    connection: Database.Database
    service: ReturnType<typeof createScreeningEncounterManagementService>
  }) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd051-management-service-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    seedGraph(connection)
    const authenticationSessionService = createAuthenticationSessionService()
    const transactionExecutor = createDatabaseTransactionExecutor({
      connection,
      idGenerator: createEntityIdGenerator(
        createQueuedIdGenerator([
          ids.addendum,
          ids.addAudit,
          ids.addOutbox,
          ids.flag,
          ids.flagAudit,
          ids.flagOutbox,
          ids.resolveAudit,
          ids.resolveOutbox,
          ids.voidAudit,
          ids.voidOutbox,
          ids.cancelAudit,
          ids.cancelOutbox
        ])
      ),
      clock: createUtcClock(() => later)
    })
    const service = createScreeningEncounterManagementService({
      authenticationSessionService,
      installationLocationService: {
        resolveConfiguredInstallationLocation: () => ({
          status: 'RESOLVED',
          location: {
            id: parseEntityId(ids.location),
            displayName: parseLocationName('Test Location')
          }
        })
      } as InstallationLocationService,
      currentScreeningSessionService: {
        findCurrentScreeningSession: () => ({
          status: 'FOUND',
          session: { id: parseEntityId(ids.session) }
        })
      } as never,
      installationRepository: createInstallationRepository(connection),
      screeningEncounterRepository: createScreeningEncounterRepository(connection),
      managementRepository: createScreeningEncounterManagementRepository(connection),
      auditEventRepository: createAuditEventRepository(connection),
      screeningEncounterOutboxRepository: createScreeningEncounterOutboxRepository(connection),
      transactionExecutor
    })
    test({ connection, service })
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function createAuthenticationSessionService(): LocalAuthenticationSessionService {
  const user: LocalUserRecord = {
    id: parseEntityId(ids.user),
    username: parseUsername('admin'),
    displayName: parseUserDisplayName('Admin User'),
    role: 'LOCAL_ADMIN',
    isActive: true,
    mustChangePassword: false,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now
  }
  return { requireAnyRole: vi.fn(() => ({ user })) } as unknown as LocalAuthenticationSessionService
}

function seedGraph(connection: Database.Database): void {
  const protocol = (
    connection.prepare("SELECT id FROM protocol_versions WHERE status = 'ACTIVE'").get() as {
      id: string
    }
  ).id
  connection
    .prepare(
      'INSERT INTO installation (singleton_id, id, deployment_name, timezone, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)'
    )
    .run(ids.installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id, username, username_normalized, display_name, password_hash, password_salt, role, is_active, must_change_password, failed_login_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)'
    )
    .run(ids.user, 'admin', 'admin', 'Admin User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id, name, name_normalized, location_type, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)'
    )
    .run(
      ids.location,
      'Test Location',
      'test location',
      'COMMUNITY_SITE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, date_of_birth, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.patient,
      'TEST-1',
      'Test Patient',
      'test patient',
      '1980-01-02',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.draftPatient,
      'DRAFT-1',
      'Draft Patient',
      'draft patient',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.unavailablePatient,
      'UNAVAILABLE-1',
      'Unavailable Draft',
      'unavailable draft',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO patients (id, patient_code, display_name, name_normalized, status, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.cancelledPatient,
      'CANCELLED-1',
      'Cancelled Patient',
      'cancelled patient',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    )
    .run(
      ids.session,
      ids.location,
      protocol,
      '2026-08-20',
      'OPEN',
      ids.user,
      now,
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_sessions (id, location_id, protocol_version_id, session_date, status, opened_by, opened_at, closed_by, closed_at, created_by, created_at, updated_by, updated_at, row_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2)'
    )
    .run(
      ids.unavailableSession,
      ids.location,
      protocol,
      '2026-08-19',
      'CLOSED',
      ids.user,
      now,
      ids.user,
      now,
      ids.user,
      now,
      ids.user,
      now
    )
  const encounterStatement = connection.prepare(
    'INSERT INTO screening_encounters (id, patient_id, screening_session_id, location_id, protocol_version_id, status, started_at, completed_at, source_type, recorded_by, record_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)'
  )
  encounterStatement.run(
    ids.encounter,
    ids.patient,
    ids.session,
    ids.location,
    protocol,
    'COMPLETED',
    now,
    now,
    'LOCAL',
    ids.user,
    now,
    now
  )
  encounterStatement.run(
    ids.unavailableEncounter,
    ids.unavailablePatient,
    ids.unavailableSession,
    ids.location,
    protocol,
    'DRAFT',
    now,
    null,
    'LOCAL',
    ids.user,
    now,
    now
  )
  encounterStatement.run(
    ids.draftEncounter,
    ids.draftPatient,
    ids.session,
    ids.location,
    protocol,
    'DRAFT',
    now,
    null,
    'LOCAL',
    ids.user,
    now,
    now
  )
  encounterStatement.run(
    ids.cancelledEncounter,
    ids.cancelledPatient,
    ids.session,
    ids.location,
    protocol,
    'DRAFT',
    now,
    null,
    'LOCAL',
    ids.user,
    now,
    now
  )
  connection
    .prepare(
      `INSERT INTO screening_vitals_drafts
         (id, encounter_id, status, weight_kg, waist_cm, notes, created_by, created_at,
          updated_by, updated_at, row_version)
       VALUES (?, ?, 'DRAFT', NULL, NULL, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      ids.cancelledVitals,
      ids.cancelledEncounter,
      'Saved before cancellation',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO blood_pressure_readings (id, encounter_id, sequence_number, systolic, diastolic, pulse, measured_at, status, source_type, recorded_by, recorded_at) VALUES (?, ?, 1, 120, 80, 70, ?, ?, ?, ?, ?)'
    )
    .run(ids.vital, ids.encounter, now, 'ACTIVE', 'PATIENT_REPORTED', ids.user, now)
  connection
    .prepare(
      'INSERT INTO lifestyle_logs (id, encounter_id, question_code, response_code, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(ids.lifestyle, ids.encounter, 'ALCOHOL_WEEKLY', 'NO', 'PATIENT_REPORTED', ids.user, now)
  connection
    .prepare(
      'INSERT INTO food_logs (id, encounter_id, food_name, food_name_normalized, frequency_code, notes, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.food,
      ids.encounter,
      'Leafy greens',
      'leafy greens',
      'EVERY_DAY',
      null,
      'PATIENT_REPORTED',
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO otc_medication_logs (id, encounter_id, product_name, product_name_normalized, reason_for_use, currently_taking, source_type, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      ids.otc,
      ids.encounter,
      'Pain reliever',
      'pain reliever',
      'Headache',
      1,
      'PATIENT_REPORTED',
      ids.user,
      now
    )
}

function createQueuedIdGenerator(initial: readonly string[]): () => string {
  const queue = [...initial]
  return () => queue.shift() ?? '52000000-0000-4000-8000-999999999999'
}

function readCount(connection: Database.Database, tableName: string): number {
  const row = connection.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as {
    count: number
  }
  return row.count
}
