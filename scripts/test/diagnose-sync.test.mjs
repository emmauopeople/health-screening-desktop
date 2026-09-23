/* eslint @typescript-eslint/explicit-function-return-type: "off" -- Plain JavaScript tests run directly with node --test. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { summarizeSync } from '../diagnose-sync.mjs'

function seed(db) {
  db.exec(`PRAGMA user_version = 22;
    CREATE TABLE installation (singleton_id INTEGER, timezone TEXT, id TEXT);
    INSERT INTO installation VALUES (1, 'Africa/Douala', '20000000-0000-4000-8000-000000000001');
    CREATE TABLE patients (id TEXT PRIMARY KEY);
    CREATE TABLE screening_sessions (id TEXT PRIMARY KEY);
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

test('traces five encounters and one vitals retry to a shared patient review, then reflects recovery', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    db.exec(`INSERT INTO patients VALUES ('private-review-patient');
      INSERT INTO sync_outbox VALUES ('PATIENT_CREATED', 'SENT', 'PATIENT', 'private-review-patient', NULL)`)
    const patient = {
      recordId: 'private-patient-record',
      resourceType: 'PATIENT',
      localResourceId: 'private-review-patient',
      payload: { displayName: 'private patient name' }
    }
    const encounters = Array.from({ length: 5 }, (_, i) => ({
      recordId: `private-encounter-${i}`,
      resourceType: 'SCREENING_ENCOUNTER',
      localResourceId: `private-encounter-${i}`,
      payload: { localPatientId: patient.localResourceId }
    }))
    const vitals = {
      recordId: 'private-vitals',
      resourceType: 'VITALS',
      localResourceId: 'private-vitals',
      payload: { localEncounterId: encounters[0].localResourceId }
    }
    const records = [patient, ...encounters, vitals]
    const outcomes = records.map((record) => ({
      recordId: record.recordId,
      resourceType: record.resourceType,
      status: record === patient ? 'REVIEW_REQUIRED' : 'RETRY',
      errors: [
        {
          code: record === patient ? 'POSSIBLE_DUPLICATE' : 'DEPENDENCY_NOT_AVAILABLE',
          path:
            record === patient
              ? '/payload'
              : record === vitals
                ? '/payload/localEncounterId'
                : '/payload/localPatientId'
        }
      ]
    }))
    for (const encounter of encounters) {
      db.prepare('INSERT INTO screening_encounters VALUES (?, ?, ?)').run(
        encounter.localResourceId,
        patient.localResourceId,
        'COMPLETED'
      )
    }
    db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
      'private-retry-batch',
      '2026-09-19',
      JSON.stringify({ records }),
      JSON.stringify({ outcomes })
    )
    const summary = summarizeSync(db)
    assert.equal(summary.dependencyFailures.length, 2)
    const blockedEncounters = summary.dependencyFailures.find(
      (group) => group.resourceType === 'SCREENING_ENCOUNTER'
    )
    const blockedVitals = summary.dependencyFailures.find(
      (group) => group.resourceType === 'VITALS'
    )
    assert.equal(blockedEncounters.records, 5)
    assert.equal(blockedEncounters.distinctParents, 1)
    assert.equal(blockedEncounters.rootDependency.latestOutcome, 'REVIEW_REQUIRED')
    assert.deepEqual(blockedEncounters.rootDependency.errorCodes, ['POSSIBLE_DUPLICATE'])
    assert.equal(blockedEncounters.rootDependency.signals.SENT, 1)
    assert.equal(blockedEncounters.rootDependency.identityLink, 'ABSENT')
    assert.equal(blockedVitals.records, 1)
    assert.equal(blockedVitals.waitingFor.latestOutcome, 'RETRY')
    assert.equal(blockedVitals.rootDependency.latestOutcome, 'REVIEW_REQUIRED')
    assert.equal(blockedVitals.rootDependency.resourceType, 'PATIENT')
    assert.equal(blockedVitals.chainComplete, true)
    assert.equal(JSON.stringify(summary).includes('private'), false)

    outcomes[0] = {
      ...outcomes[0],
      status: 'REJECTED',
      errors: [{ code: 'LOCAL_PATIENT_CODE_CONFLICT' }]
    }
    db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
      'private-rejected-parent',
      '2026-09-20',
      JSON.stringify({ records: [patient] }),
      JSON.stringify({ outcomes: [outcomes[0]] })
    )
    assert.deepEqual(summarizeSync(db).dependencyFailures[0].rootDependency.errorCodes, [
      'LOCAL_PATIENT_CODE_CONFLICT'
    ])

    db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
      'private-recovered',
      '2026-09-21',
      JSON.stringify({ records }),
      JSON.stringify({
        outcomes: outcomes.map((outcome) => ({ ...outcome, status: 'ACCEPTED', errors: [] }))
      })
    )
    assert.deepEqual(summarizeSync(db).dependencyFailures, [])
  } finally {
    db.close()
  }
})

test('distinguishes a parent with no saved outcome from one with an unknown error and counts unsupported paths', () => {
  const db = new DatabaseSync(':memory:')
  try {
    seed(db)
    const records = [
      {
        recordId: 'private-missing',
        resourceType: 'SCREENING_ENCOUNTER',
        localResourceId: 'private-missing',
        payload: { localPatientId: 'private-unsent-patient' }
      },
      {
        recordId: 'private-session-child',
        resourceType: 'SCREENING_ENCOUNTER',
        localResourceId: 'private-session-child',
        payload: { localScreeningSessionId: 'private-session' }
      },
      {
        recordId: 'private-session',
        resourceType: 'SCREENING_SESSION',
        localResourceId: 'private-session',
        payload: {}
      },
      {
        recordId: 'private-unknown',
        resourceType: 'SCREENING_ENCOUNTER',
        localResourceId: 'private-unknown',
        payload: {}
      }
    ]
    const outcomes = records.map((record, i) => ({
      recordId: record.recordId,
      resourceType: record.resourceType,
      status: i === 2 ? 'REJECTED' : 'RETRY',
      errors: [
        {
          code: i === 2 ? 'private-sensitive-error' : 'DEPENDENCY_NOT_AVAILABLE',
          path: [
            '/payload/localPatientId',
            '/payload/localScreeningSessionId',
            '',
            '/private-sensitive-path'
          ][i]
        }
      ]
    }))
    db.exec(`INSERT INTO patients VALUES ('private-unsent-patient');
      INSERT INTO screening_sessions VALUES ('private-session');
      INSERT INTO sync_outbox VALUES ('PATIENT_CREATED', 'PENDING', 'PATIENT', 'private-unsent-patient', NULL)`)
    db.prepare('INSERT INTO sync_transport_batches VALUES (?, ?, ?, ?)').run(
      'private-batch-2',
      '2026-09-20',
      JSON.stringify({ records }),
      JSON.stringify({ outcomes })
    )
    const summary = summarizeSync(db)
    assert.equal(summary.unclassifiedDependencyRetries, 1)
    assert.equal(summary.dependencyFailures[0].rootDependency.latestOutcome, 'NOT_OBSERVED')
    assert.equal(summary.dependencyFailures[0].rootDependency.existsLocally, true)
    assert.equal(summary.dependencyFailures[0].rootDependency.signals.PENDING, 1)
    assert.deepEqual(summary.dependencyFailures[1].rootDependency.errorCodes, ['OTHER'])
    assert.equal(JSON.stringify(summary).includes('private'), false)
  } finally {
    db.close()
  }
})

test('CLI finds the installed database, verifies installation, and refuses ambiguous copies', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chs-diagnostic-locations-'))
  const installation = '20000000-0000-4000-8000-000000000001'
  const script = fileURLToPath(new URL('../diagnose-sync.mjs', import.meta.url))
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      env: { ...process.env, APPDATA: directory }
    })
  function create(name, id) {
    const folder = join(directory, name, 'data')
    mkdirSync(folder, { recursive: true })
    const path = join(folder, 'health-screening.sqlite3')
    const db = new DatabaseSync(path)
    seed(db)
    db.prepare('UPDATE installation SET id = ?').run(id)
    db.close()
    return path
  }
  try {
    const missing = run('--installation-id', installation)
    assert.equal(JSON.parse(missing.stderr).diagnosticStatus, 'NO_MATCHING_DATABASE')
    const installedPath = create('Health Screening Offline Desktop', installation)
    const before = readFileSync(installedPath)
    const installed = run('--installation-id', installation)
    assert.equal(installed.status, 0, installed.stderr)
    assert.deepEqual(JSON.parse(installed.stdout).databaseChecks, [
      { candidate: 'DEVELOPMENT', result: 'NOT_FOUND' },
      { candidate: 'INSTALLED', result: 'MATCH' }
    ])
    create('health-screening-desktop', '20000000-0000-4000-8000-000000000002')
    const matched = run('--installation-id', installation)
    assert.equal(matched.status, 0, matched.stderr)
    assert.equal(JSON.parse(matched.stdout).databaseChecks[0].result, 'DIFFERENT_INSTALLATION')
    const ambiguous = run()
    assert.equal(JSON.parse(ambiguous.stderr).diagnosticStatus, 'MULTIPLE_MATCHING_DATABASES')
    const explicit = run('--db', installedPath, '--installation-id', installation)
    assert.equal(explicit.status, 0, explicit.stderr)
    const mismatch = run(
      '--db',
      installedPath,
      '--installation-id',
      '20000000-0000-4000-8000-000000000099'
    )
    assert.equal(mismatch.status, 1)
    assert.equal(JSON.parse(mismatch.stderr).databaseChecks[0].result, 'DIFFERENT_INSTALLATION')
    const invalid = run('--installation-id', 'private-invalid-id')
    assert.equal(JSON.parse(invalid.stderr).stage, 'ARGUMENTS')
    assert.deepEqual(readFileSync(installedPath), before)
    for (const output of [missing, installed, matched, ambiguous, explicit, mismatch, invalid]) {
      assert.equal((output.stdout + output.stderr).includes(directory), false)
      assert.equal((output.stdout + output.stderr).includes('private'), false)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('CLI distinguishes an incompatible schema from corrupt saved JSON without leaking exceptions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'chs-diagnostic-errors-'))
  const script = fileURLToPath(new URL('../diagnose-sync.mjs', import.meta.url))
  try {
    for (const kind of ['SQLITE_READ_FAILED', 'STORED_JSON_INVALID']) {
      const path = join(directory, `${kind}.sqlite3`)
      const db = new DatabaseSync(path)
      seed(db)
      if (kind === 'SQLITE_READ_FAILED') db.exec('DROP TABLE sync_outbox')
      else
        db.prepare('UPDATE sync_transport_batches SET response_json = ?').run(
          'private malformed clinical data'
        )
      db.close()
      const before = readFileSync(path)
      const output = spawnSync(process.execPath, [script, '--db', path], { encoding: 'utf8' })
      assert.equal(output.status, 1)
      assert.equal(output.stdout, '')
      assert.equal(JSON.parse(output.stderr).stage, 'SUMMARY')
      assert.equal(JSON.parse(output.stderr).errorKind, kind)
      assert.equal(output.stderr.includes(directory), false)
      assert.equal(output.stderr.includes('private'), false)
      assert.deepEqual(readFileSync(path), before)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
