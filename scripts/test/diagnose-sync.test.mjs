/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Plain JavaScript tests run directly with node --test. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { summarizeSync } from '../diagnose-sync.mjs'

function seed(db) {
  db.exec(`PRAGMA user_version = 22;
    CREATE TABLE installation (singleton_id INTEGER, timezone TEXT);
    INSERT INTO installation VALUES (1, 'Africa/Douala');
    CREATE TABLE sync_transport_batches (id TEXT, created_at TEXT, request_json TEXT, response_json TEXT);
    CREATE TABLE sync_outbox (operation TEXT, status TEXT, aggregate_type TEXT, aggregate_id TEXT, last_error_code TEXT);
    CREATE TABLE screening_encounters (id TEXT PRIMARY KEY, patient_id TEXT, status TEXT);
    CREATE TABLE lifestyle_drafts (encounter_id TEXT UNIQUE, status TEXT);
    CREATE TABLE sync_patient_identity_links (patient_id TEXT PRIMARY KEY);
    INSERT INTO sync_outbox (operation, status) VALUES ('SCREENING_FOOD_FINALIZED', 'PENDING'), ('SCREENING_OTC_FINALIZED', 'PENDING');`)
  const encounter = {
    recordId: 'private-record',
    resourceType: 'SCREENING_ENCOUNTER',
    localResourceId: 'private-encounter',
    payload: {
      status: 'COMPLETED',
      startedAt: '2026-09-14T11:05:37.123Z',
      completedAt: '2026-09-14T12:00:00Z',
      notes: 'private clinical text'
    }
  }
  const records = [encounter]
  const outcomes = [
    {
      recordId: encounter.recordId,
      resourceType: encounter.resourceType,
      status: 'ACCEPTED',
      errors: []
    }
  ]
  for (const time of ['12:05', '06:05', '13:01']) {
    const record = {
      recordId: `private-${time}`,
      localResourceId: `private-${time}`,
      resourceType: 'VITALS',
      payload: {
        localEncounterId: encounter.localResourceId,
        readings: [
          {
            measurementLocalDate: '2026-09-14',
            measurementLocalTime: time,
            measurementTimezone: 'Africa/Douala'
          }
        ]
      }
    }
    records.push(record)
    outcomes.push({
      recordId: record.recordId,
      resourceType: 'VITALS',
      status: 'REJECTED',
      errors: [{ code: 'MEASUREMENT_PERIOD_INVALID', path: '/payload/readings/0' }]
    })
  }
  db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
    'private-batch',
    '2026-09-14',
    JSON.stringify({ records }),
    JSON.stringify({ outcomes })
  )
}

test('distinguishes minute precision from multi-hour offsets and preserves privacy', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    const summary = summarizeSync(db)
    assert.deepEqual(summary.vitalsPeriodFailureCounts, {
      SAME_START_MINUTE_PRECISION: 1,
      BEFORE_START_MINUTE: 1,
      AFTER_COMPLETION_MINUTE: 1
    })
    assert.deepEqual(summary.minutesBeforeEncounterStart, { 360: 1 })
    assert.deepEqual(summary.pendingFinalizedIntake, { FOOD: 1, OTC: 1 })
    assert.deepEqual(summary.latestSnapshotOutcomes, {
      'SCREENING_ENCOUNTER/ACCEPTED': 1,
      'VITALS/REJECTED': 3
    })
    assert.equal(JSON.stringify(summary).includes('private'), false)
    assert.equal(JSON.stringify(summary).includes('2026-09-14'), false)
  } finally {
    db.close()
  }
})

test('classifies current Lifestyle states and failed dependencies without exposing private fields', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    db.exec(`
      INSERT INTO screening_encounters VALUES
        ('private-reopened', 'private-review-patient', 'DRAFT'),
        ('private-complete', 'private-linked-patient', 'COMPLETED'),
        ('private-missing-draft', 'private-linked-patient', 'VOID');
      INSERT INTO lifestyle_drafts VALUES
        ('private-reopened', 'IN_PROGRESS'), ('private-complete', 'COMPLETE');
      INSERT INTO sync_patient_identity_links VALUES ('private-linked-patient');
      INSERT INTO sync_outbox VALUES
        ('SCREENING_LIFESTYLE_STEP_COMPLETED', 'PENDING', 'SCREENING_ENCOUNTER', 'private-reopened', NULL),
        ('SCREENING_LIFESTYLE_REOPENED', 'PENDING', 'SCREENING_ENCOUNTER', 'private-reopened', NULL),
        ('SCREENING_LIFESTYLE_DRAFT_SAVED', 'PENDING', 'SCREENING_ENCOUNTER', 'private-reopened', NULL),
        ('SCREENING_LIFESTYLE_STEP_COMPLETED', 'PENDING', 'SCREENING_ENCOUNTER', 'private-complete', NULL),
        ('SCREENING_LIFESTYLE_DRAFT_SAVED', 'PENDING', 'SCREENING_ENCOUNTER', 'private-missing-draft', NULL),
        ('SCREENING_ENCOUNTER_STARTED', 'FAILED', 'SCREENING_ENCOUNTER', 'private-reopened', 'DEPENDENCY_NOT_AVAILABLE'),
        ('SCREENING_ENCOUNTER_VOIDED', 'FAILED', 'SCREENING_ENCOUNTER', 'private-reopened', 'DEPENDENCY_NOT_AVAILABLE'),
        ('SCREENING_VITALS_DRAFT_SAVED', 'FAILED', 'SCREENING_ENCOUNTER', 'private-complete', 'private-error-text'),
        ('private-operation', 'FAILED', 'private-aggregate', 'private-id', 'private-error'),
        ('SCREENING_FOOD_FINALIZED', 'IN_FLIGHT', 'SCREENING_ENCOUNTER', 'private-complete', NULL);
    `)
    const records = [
      {
        recordId: 'private-patient-record',
        resourceType: 'PATIENT',
        localResourceId: 'private-review-patient',
        payload: {}
      },
      {
        recordId: 'private-encounter-record',
        resourceType: 'SCREENING_ENCOUNTER',
        localResourceId: 'private-reopened',
        payload: {}
      }
    ]
    const outcomes = records.map((record) => ({
      recordId: record.recordId,
      resourceType: record.resourceType,
      status: record.resourceType === 'PATIENT' ? 'REVIEW_REQUIRED' : 'RETRY',
      errors: [{ code: 'DEPENDENCY_NOT_AVAILABLE' }]
    }))
    db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
      'private-next-batch',
      '2026-09-15',
      JSON.stringify({ records }),
      JSON.stringify({ outcomes })
    )
    const summary = summarizeSync(db)
    assert.deepEqual(summary.outstandingSignalsByState, { PENDING: 7, FAILED: 4, IN_FLIGHT: 1 })
    assert.equal(summary.outstandingSignalsTotal, 12)
    assert.equal(summary.pendingOrFailedSignals, 11)
    const contexts = summary.pendingLifestyleContexts
    assert.equal(
      contexts.reduce((total, row) => total + row.signalCount, 0),
      5
    )
    assert.ok(contexts.some((row) => row.completionSignal && row.draftStatus === 'IN_PROGRESS'))
    assert.ok(contexts.some((row) => row.completionSignal && row.draftStatus === 'COMPLETE'))
    assert.ok(
      contexts.some((row) => row.draftStatus === 'MISSING' && row.encounterStatus === 'VOID')
    )
    assert.ok(contexts.some((row) => row.signalCount === 2 && row.encounterCount === 1))
    assert.deepEqual(
      summary.failedSignalContexts.find((row) => row.resourceType === 'SCREENING_ENCOUNTER'),
      {
        resourceType: 'SCREENING_ENCOUNTER',
        errorCode: 'DEPENDENCY_NOT_AVAILABLE',
        patientOutcome: 'REVIEW_REQUIRED',
        patientIdentityLink: 'ABSENT',
        encounterOutcome: 'RETRY',
        signalCount: 2,
        encounterCount: 1
      }
    )
    assert.equal(
      summary.failedSignalContexts.find((row) => row.resourceType === 'VITALS').patientIdentityLink,
      'PRESENT'
    )
    assert.equal(
      summary.latestSnapshotErrors['SCREENING_ENCOUNTER/RETRY/DEPENDENCY_NOT_AVAILABLE'],
      1
    )
    assert.equal(JSON.stringify(summary).includes('private'), false)
    assert.equal(JSON.stringify(summary).includes('2026-09-15'), false)
  } finally {
    db.close()
  }
})

test('CLI reads the database without modifying it and never creates a missing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chs-sync-diagnostic-'))
  try {
    const path = join(directory, 'fixture.sqlite3')
    const db = new DatabaseSync(path)
    seed(db)
    db.close()
    const before = readFileSync(path)
    const script = fileURLToPath(new URL('../diagnose-sync.mjs', import.meta.url))
    const output = spawnSync(process.execPath, [script, '--db', path], {
      encoding: 'utf8'
    })
    assert.equal(output.status, 0, output.stderr)
    assert.equal(JSON.parse(output.stdout).completedBatches, 1)
    assert.deepEqual(readFileSync(path), before)
    const missing = join(directory, 'missing.sqlite3')
    const failure = spawnSync(process.execPath, [script, '--db', missing], {
      encoding: 'utf8'
    })
    assert.equal(failure.status, 1)
    assert.equal(existsSync(missing), false)
    assert.equal(failure.stderr.includes(missing), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
