import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { createProductionReferralService } from '@main/application'
import type { LocalAuthenticationSessionService } from '@main/application/authentication/session'
import type { InstallationLocationService } from '@main/application/installation-location'
import { createProductionDatabaseMigrationRunner } from '@main/database'
import { createUtcClock, type UtcTimestamp } from '@main/foundation/utc-clock'

const now = '2026-08-27T12:00:00.000Z' as UtcTimestamp
const ids = {
  installation: '62000000-0000-4000-8000-000000000001',
  user: '62000000-0000-4000-8000-000000000002',
  location: '62000000-0000-4000-8000-000000000003',
  patient: '62000000-0000-4000-8000-000000000004',
  session: '62000000-0000-4000-8000-000000000005',
  encounter: '62000000-0000-4000-8000-000000000006',
  referral: '62000000-0000-4000-8000-000000000007',
  history: '62000000-0000-4000-8000-000000000008'
} as const

describe('referral service', () => {
  it('searches local referrals and loads status history and follow-ups', async () => {
    await withService((service) => {
      const search = service.search({
        query: 'test',
        statuses: ['OPEN'],
        urgency: null,
        dueFrom: null,
        dueTo: null,
        page: 1,
        pageSize: 25
      })
      expect(search).toMatchObject({ status: 'LOADED', total: 1, items: [{ id: ids.referral }] })
      expect(
        service.search({
          query: '',
          statuses: [],
          urgency: null,
          dueFrom: null,
          dueTo: null,
          screeningSessionId: ids.session,
          page: 1,
          pageSize: 25
        })
      ).toMatchObject({ status: 'LOADED', total: 1 })
      expect(
        service.search({
          query: '',
          statuses: [],
          urgency: null,
          dueFrom: null,
          dueTo: null,
          screeningSessionId: '62000000-0000-4000-8000-000000000099',
          page: 1,
          pageSize: 25
        })
      ).toMatchObject({ status: 'LOADED', total: 0 })
      const detail = service.getDetail({ referralId: ids.referral })
      expect(detail).toMatchObject({
        status: 'LOADED',
        detail: {
          status: 'OPEN',
          recordVersion: 1,
          triggeringBloodPressure: { systolic: 178, diastolic: 112 }
        }
      })
    })
  })

  it('updates status with history, audit, and outbox in one transaction and rejects stale versions', async () => {
    await withService((service, connection) => {
      const updated = service.updateStatus({
        referralId: ids.referral,
        expectedVersion: 1,
        status: 'CONTACTED',
        reason: 'Reached patient'
      })
      expect(updated).toMatchObject({
        status: 'UPDATED',
        detail: { status: 'CONTACTED', recordVersion: 2 }
      })
      expect(
        service.updateStatus({
          referralId: ids.referral,
          expectedVersion: 1,
          status: 'SEEN',
          reason: null
        })
      ).toEqual({ status: 'VERSION_CONFLICT' })
      expect(readCount(connection, 'referral_status_history')).toBe(2)
      expect(readCount(connection, 'audit_log')).toBe(1)
      expect(
        connection
          .prepare('SELECT operation FROM sync_outbox ORDER BY created_at DESC LIMIT 1')
          .get()
      ).toEqual({ operation: 'REFERRAL_STATUS_UPDATED' })
    })
  })

  it('records an append-only follow-up and requires a closure reason', async () => {
    await withService((service, connection) => {
      const base = {
        referralId: ids.referral,
        expectedVersion: 1,
        contactDate: '2026-08-27',
        contactMethod: 'PHONE',
        informationSource: 'PATIENT',
        providerSeen: false,
        facilityName: null,
        dateSeen: null,
        reportedOutcome: null,
        reportedMedicationsOrAdvice: null,
        nextAction: 'Call next week',
        nextFollowupDate: '2026-09-03',
        sourceType: 'LOCAL',
        treatmentActions: [],
        medicationChanges: [],
        newStatus: 'CLOSED' as const,
        statusReason: null
      }
      expect(service.recordFollowup(base)).toEqual({ status: 'VALIDATION_FAILED' })
      const result = service.recordFollowup({
        ...base,
        providerSeen: true,
        treatmentActions: ['TREATMENT_INITIATED', 'TREATMENT_MODIFIED', 'NEW_MEDICATION'],
        medicationChanges: [
          {
            changeType: 'NEW_MEDICATION',
            medicationName: 'Amlodipine',
            dosage: '5 mg',
            frequency: 'Once daily'
          },
          {
            changeType: 'TREATMENT_MODIFIED',
            medicationName: 'Hydrochlorothiazide',
            dosage: '25 mg',
            frequency: null
          }
        ],
        newStatus: 'CONTACTED',
        statusReason: 'Reached patient'
      })
      expect(result).toMatchObject({
        status: 'UPDATED',
        detail: {
          status: 'CONTACTED',
          recordVersion: 2,
          followups: [
            {
              treatmentActions: ['TREATMENT_INITIATED', 'TREATMENT_MODIFIED', 'NEW_MEDICATION'],
              medicationChanges: [
                { changeType: 'NEW_MEDICATION', medicationName: 'Amlodipine' },
                { changeType: 'TREATMENT_MODIFIED', medicationName: 'Hydrochlorothiazide' }
              ]
            }
          ]
        }
      })
      expect(readCount(connection, 'followups')).toBe(1)
      expect(readCount(connection, 'referral_followup_actions')).toBe(3)
      expect(readCount(connection, 'referral_followup_medication_changes')).toBe(2)
      expect(readCount(connection, 'audit_log')).toBe(1)
      const outbox = connection
        .prepare(
          'SELECT operation, payload_schema_version, payload_json FROM sync_outbox ORDER BY created_at DESC LIMIT 1'
        )
        .get() as { operation: string; payload_schema_version: string; payload_json: string }
      expect(outbox).toMatchObject({
        operation: 'REFERRAL_FOLLOWUP_RECORDED',
        payload_schema_version: 'referral.followup-recorded.v2'
      })
      expect(JSON.parse(outbox.payload_json)).toMatchObject({
        treatment_action_count: 3,
        medication_change_count: 2
      })
      expect(outbox.payload_json).not.toContain('Amlodipine')
      expect(outbox.payload_json).not.toContain('Hydrochlorothiazide')
      expect(outbox.payload_json).not.toContain('5 mg')
    })
  })

  it('rolls back referral, history, audit, and outbox when the final event write fails', async () => {
    await withService((service, connection) => {
      connection.exec(`CREATE TRIGGER fail_referral_outbox BEFORE INSERT ON sync_outbox
        WHEN NEW.operation = 'REFERRAL_STATUS_UPDATED'
        BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`)
      expect(
        service.updateStatus({
          referralId: ids.referral,
          expectedVersion: 1,
          status: 'CONTACTED',
          reason: 'Reached patient'
        })
      ).toEqual({ status: 'UNAVAILABLE' })
      expect(
        connection
          .prepare('SELECT status, record_version FROM referrals WHERE id = ?')
          .get(ids.referral)
      ).toEqual({ status: 'OPEN', record_version: 1 })
      expect(readCount(connection, 'referral_status_history')).toBe(1)
      expect(readCount(connection, 'audit_log')).toBe(0)
      expect(readCount(connection, 'sync_outbox')).toBe(0)
    })
  })

  it('rolls back the follow-up and structured actions when its outbox write fails', async () => {
    await withService((service, connection) => {
      connection.exec(`CREATE TRIGGER fail_followup_outbox BEFORE INSERT ON sync_outbox
        WHEN NEW.operation = 'REFERRAL_FOLLOWUP_RECORDED'
        BEGIN SELECT RAISE(ABORT, 'injected failure'); END;`)
      expect(
        service.recordFollowup({
          referralId: ids.referral,
          expectedVersion: 1,
          contactDate: '2026-08-27',
          contactMethod: 'PHONE',
          informationSource: 'PATIENT',
          providerSeen: true,
          facilityName: null,
          dateSeen: null,
          reportedOutcome: null,
          reportedMedicationsOrAdvice: null,
          nextAction: null,
          nextFollowupDate: null,
          sourceType: 'LOCAL',
          treatmentActions: ['NEW_MEDICATION'],
          medicationChanges: [
            {
              changeType: 'NEW_MEDICATION',
              medicationName: 'Amlodipine',
              dosage: null,
              frequency: null
            }
          ],
          newStatus: 'CONTACTED',
          statusReason: null
        })
      ).toEqual({ status: 'UNAVAILABLE' })
      expect(readCount(connection, 'followups')).toBe(0)
      expect(readCount(connection, 'referral_followup_actions')).toBe(0)
      expect(readCount(connection, 'referral_followup_medication_changes')).toBe(0)
      expect(readCount(connection, 'audit_log')).toBe(0)
      expect(readCount(connection, 'sync_outbox')).toBe(0)
      expect(
        connection
          .prepare('SELECT status, record_version FROM referrals WHERE id = ?')
          .get(ids.referral)
      ).toEqual({ status: 'OPEN', record_version: 1 })
    })
  })
})

async function withService(
  test: (
    service: ReturnType<typeof createProductionReferralService>,
    connection: Database.Database
  ) => void
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'hsd057b-referral-service-'))
  const connection = new Database(join(directory, 'health-screening.sqlite3'))
  try {
    connection.pragma('foreign_keys = ON')
    createProductionDatabaseMigrationRunner({
      applicationVersion: '1.0.0',
      logger: { info: () => {}, error: () => {} },
      clock: createUtcClock(() => now)
    })(connection)
    seed(connection)
    const authenticationSessionService = {
      requireAnyRole: () => ({ user: { id: ids.user } })
    } as unknown as LocalAuthenticationSessionService
    const installationLocationService = {
      resolveConfiguredInstallationLocation: () => ({
        status: 'RESOLVED',
        location: { id: ids.location, displayName: 'Test Location' }
      })
    } as unknown as InstallationLocationService
    test(
      createProductionReferralService({
        connection,
        authenticationSessionService,
        installationLocationService
      }),
      connection
    )
  } finally {
    if (connection.open) connection.close()
    await rm(directory, { recursive: true, force: true })
  }
}

function seed(connection: Database.Database): void {
  connection
    .prepare(
      'INSERT INTO installation (singleton_id,id,deployment_name,timezone,created_at,updated_at) VALUES (1,?,?,?,?,?)'
    )
    .run(ids.installation, 'test', 'UTC', now, now)
  connection
    .prepare(
      'INSERT INTO users (id,username,username_normalized,display_name,password_hash,password_salt,role,is_active,must_change_password,failed_login_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,0,0,?,?)'
    )
    .run(ids.user, 'admin', 'admin', 'Admin User', 'hash', 'salt', 'LOCAL_ADMIN', now, now)
  connection
    .prepare(
      'INSERT INTO locations (id,name,name_normalized,location_type,is_active,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,? ,1,?,?,?,?)'
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
  const protocol = (
    connection.prepare("SELECT id FROM protocol_versions WHERE status='ACTIVE' LIMIT 1").get() as {
      id: string
    }
  ).id
  connection
    .prepare(
      'INSERT INTO patients (id,patient_code,display_name,name_normalized,status,created_by,created_at,updated_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(
      ids.patient,
      'TEST-1',
      'Test Patient',
      'test patient',
      'ACTIVE',
      ids.user,
      now,
      ids.user,
      now
    )
  connection
    .prepare(
      'INSERT INTO screening_sessions (id,location_id,protocol_version_id,session_date,status,opened_by,opened_at,created_by,created_at,updated_by,updated_at,row_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)'
    )
    .run(
      ids.session,
      ids.location,
      protocol,
      '2026-08-27',
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
      "INSERT INTO screening_encounters (id,patient_id,screening_session_id,location_id,protocol_version_id,status,started_at,completed_at,summary_systolic,summary_diastolic,source_type,recorded_by,record_version,created_at,updated_at) VALUES (?,?,?,?,?,'COMPLETED',?,?,? ,?,'LOCAL',?,1,?,?)"
    )
    .run(
      ids.encounter,
      ids.patient,
      ids.session,
      ids.location,
      protocol,
      now,
      now,
      178,
      112,
      ids.user,
      now,
      now
    )
  connection
    .prepare(
      "INSERT INTO referrals (id,patient_id,encounter_id,protocol_version_id,reason_codes_json,urgency,due_date,status,created_by,created_at,record_version,updated_at) VALUES (?,?,?,?,?,'STANDARD','2026-09-10','OPEN',?,?,1,?)"
    )
    .run(
      ids.referral,
      ids.patient,
      ids.encounter,
      protocol,
      JSON.stringify(['BP_SCREENING_REFERRAL']),
      ids.user,
      now,
      now
    )
  connection
    .prepare(
      "INSERT INTO referral_status_history (id,referral_id,from_status,to_status,change_reason,changed_by,changed_at) VALUES (?,?,NULL,'OPEN','AUTOMATIC_SCREENING_REFERRAL',?,?)"
    )
    .run(ids.history, ids.referral, ids.user, now)
}

function readCount(connection: Database.Database, table: string): number {
  return (connection.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}
