import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import Database from 'better-sqlite3'

import {
  createSyncHttpClient,
  createSyncSnapshotPreparationService,
  createSyncTransportFoundationService,
  createSyncWorkerService,
  type SyncCredentialProtector,
  type SyncHttpClient,
  type SyncWorkerService
} from '@main/application/sync-transport'
import {
  createDatabaseTransactionExecutor,
  createProductionDatabaseMigrationRunner,
  createSyncSnapshotRepository,
  createSyncTransportBatchRepository,
  createSyncWorkerRepository,
  type DatabaseTransactionExecutor
} from '@main/database'
import { createEntityIdGenerator } from '@main/foundation/entity-id'
import { createUtcClock, parseUtcTimestamp, type UtcTimestamp } from '@main/foundation/utc-clock'

const capturedAt = parseUtcTimestamp('2026-09-03T12:00:00.000Z')
const installationId = '20000000-0000-4000-8000-000000000001'
const sourceLocationId = '30000000-0000-4000-8000-000000000001'
const centralOrganizationId = '31000000-0000-4000-8000-000000000001'
const centralLocationId = '32000000-0000-4000-8000-000000000001'
const actorId = '10000000-0000-4000-8000-000000000001'
const patientId = '40000000-0000-4000-8000-000000000001'
const sessionId = '50000000-0000-4000-8000-000000000001'
const encounterId = '60000000-0000-4000-8000-000000000001'
const vitalsId = '70000000-0000-4000-8000-000000000001'
const lifestyleId = '80000000-0000-4000-8000-000000000001'
const installationToken = `chs_inst_v1_${'A'.repeat(43)}`
const operationsIssuer = 'https://identity.example.test/'
const operationsSubject = 'release-1-acceptance-operator'
const operationsToken = 'synthetic-operations-token'
const operationsUserId = '91000000-0000-4000-8000-000000000001'
const desktopSchemaVersion = 21

const outboxIds = {
  patientCreated: '90000000-0000-4000-8000-000000000001',
  patientAcknowledged: '90000000-0000-4000-8000-000000000002',
  session: '90000000-0000-4000-8000-000000000003',
  encounterStarted: '90000000-0000-4000-8000-000000000004',
  encounterCompleted: '90000000-0000-4000-8000-000000000005',
  vitals: '90000000-0000-4000-8000-000000000006',
  lifestyle: '90000000-0000-4000-8000-000000000007',
  excluded: '90000000-0000-4000-8000-000000000008',
  revokedRevision: '90000000-0000-4000-8000-000000000009'
} as const

interface WebQueryResult {
  readonly rows: readonly Record<string, unknown>[]
}

interface WebClient {
  query(statement: string, parameters?: readonly unknown[]): Promise<WebQueryResult>
  release(): void
}

interface WebPool {
  query(statement: string, parameters?: readonly unknown[]): Promise<WebQueryResult>
  connect(): Promise<WebClient>
}

interface WebDatabase {
  readonly pool: WebPool
  check(): Promise<void>
  close(): Promise<void>
}

interface WebApp {
  readonly server: { address(): string | { port: number } | null }
  listen(options: { host: string; port: number }): Promise<string>
  close(): Promise<void>
}

interface WebConfig {
  readonly nodeEnv: 'test'
  readonly host: string
  readonly port: number
  readonly logLevel: string
  readonly databaseUrl: string
  readonly databasePoolMax: number
  readonly http: Readonly<{
    bodyLimitBytes: number
    requestTimeoutMs: number
    connectionTimeoutMs: number
    keepAliveTimeoutMs: number
  }>
  readonly buildCommit: string
  readonly buildTime: string
  readonly trustedProxyCidrs: readonly string[]
  readonly operationsOidc: null
}

interface CanonicalCounts {
  readonly persons: number
  readonly sessions: number
  readonly encounters: number
  readonly vitalSets: number
  readonly readings: number
  readonly lifestyleAssessments: number
  readonly batches: number
}

interface WebModules {
  readonly createDatabase: (config: WebConfig) => WebDatabase
  readonly buildApp: (dependencies: {
    config: WebConfig
    database: WebDatabase
    operationsTokenVerifier: {
      verify(header: string | undefined): Promise<{
        issuer: string
        subject: string
        sessionId: string
        authorizedParty: string
      }>
    }
  }) => Promise<WebApp>
  readonly migrateWithClient: (input: {
    client: WebClient
    logger: { info(): void }
  }) => Promise<unknown>
  readonly provisionScreeningContext: (
    database: WebPool,
    input: Record<string, unknown>,
    dependencies: { now: Date; randomId: () => string }
  ) => Promise<{ organizationId: string; locationId: string }>
  readonly enrollDesktopInstallation: (
    database: WebPool,
    input: Record<string, unknown>,
    dependencies: { now: Date; randomId: () => string; generateToken: () => string }
  ) => Promise<{ credentialId: string; installationToken: string }>
  readonly revokeInstallationCredential: (
    database: WebPool,
    input: Record<string, unknown>,
    dependencies: { now: Date; randomId: () => string }
  ) => Promise<{ kind: string }>
}

interface DesktopHarness {
  readonly connection: Database.Database
  readonly clock: { value: UtcTimestamp }
  readonly foundation: ReturnType<typeof createSyncTransportFoundationService>
  readonly transactionExecutor: DatabaseTransactionExecutor
}

describe('HSW-018A Release 1 cross-repository acceptance', () => {
  it('proves offline durability, exact recovery, operations viewing, and revocation', async () => {
    const databaseTestUrl = requiredEnvironment('DATABASE_TEST_URL')
    const chsWebRepository = await resolveChsWebRepository()
    const web = await loadWebModules(chsWebRepository)
    const schema = `chs_release_1_acceptance_${randomUUID().replaceAll('-', '')}`
    const desktopDirectory = await mkdtemp(join(tmpdir(), 'hsw-018a-release-1-'))
    const desktopDatabasePath = join(desktopDirectory, 'health-screening.sqlite3')
    const administrationDatabase = web.createDatabase(webConfig(databaseTestUrl))
    let serviceDatabase: WebDatabase | null = null
    let app: WebApp | null = null
    let desktop: Database.Database | null = null

    try {
      await createIsolatedSchema(administrationDatabase, schema, web)
      serviceDatabase = web.createDatabase(webConfig(withSearchPath(databaseTestUrl, schema)))
      const enrollment = await seedCentralContext(serviceDatabase.pool, web)
      await seedOperationsAccess(serviceDatabase.pool)

      app = await web.buildApp({
        config: webConfig(withSearchPath(databaseTestUrl, schema)),
        database: serviceDatabase,
        operationsTokenVerifier: {
          async verify(header) {
            if (header !== `Bearer ${operationsToken}`) {
              throw new Error('Synthetic operations authentication failed')
            }
            return {
              issuer: operationsIssuer,
              subject: operationsSubject,
              sessionId: 'release-1-acceptance-session',
              authorizedParty: 'operations-web'
            }
          }
        }
      })
      await app.listen({ host: '127.0.0.1', port: 0 })
      const apiBaseUrl = loopbackAddress(app)

      desktop = openDesktopDatabase(desktopDatabasePath)
      seedCompleteOfflineGraph(desktop)
      expect(readCount(desktop, 'sync_outbox')).toBe(8)
      desktop.close()
      desktop = null

      desktop = openDesktopDatabase(desktopDatabasePath)
      expect(readCount(desktop, 'patients')).toBe(1)
      expect(readCount(desktop, 'screening_encounters')).toBe(1)
      expect(readCount(desktop, 'sync_outbox')).toBe(8)
      let harness = createDesktopHarness(desktop, '2026-09-03T12:00:02.000Z')
      expect(
        harness.foundation.configure({
          apiBaseUrl,
          installationToken: enrollment.installationToken
        })
      ).toMatchObject({ status: 'CONFIGURED' })

      let offlineRequest = ''
      const offlineFetch: typeof fetch = async (_input, init) => {
        offlineRequest = requestBody(init)
        throw new TypeError('Synthetic offline boundary')
      }
      const offlineResult = await createWorker(
        harness,
        createSyncHttpClient({ fetch: offlineFetch, timeoutMs: 10_000 })
      ).runOnce()
      expect(offlineResult).toMatchObject({
        status: 'RETRY_SCHEDULED',
        errorCode: 'NETWORK_ERROR'
      })
      const immutableRequest = readStoredRequest(desktop)
      expect(offlineRequest).toBe(immutableRequest)
      desktop.close()
      desktop = null

      desktop = openDesktopDatabase(desktopDatabasePath)
      harness = createDesktopHarness(desktop, '2026-09-03T12:00:08.000Z')
      makeRetryDue(desktop, harness.clock.value)
      let committedRequestWithLostResponse = ''
      const loseCommittedResponse: typeof fetch = async (input, init) => {
        const url = requestUrl(input)
        if (init?.method === 'POST' && url.pathname === '/api/v1/sync/batches') {
          committedRequestWithLostResponse = requestBody(init)
          const response = await fetch(input, init)
          await response.arrayBuffer()
          throw new TypeError('Synthetic response loss after central commit')
        }
        return fetch(input, init)
      }
      const lostResponseResult = await createWorker(
        harness,
        createSyncHttpClient({ fetch: loseCommittedResponse, timeoutMs: 10_000 })
      ).runOnce()
      expect(lostResponseResult).toMatchObject({
        status: 'RETRY_SCHEDULED',
        errorCode: 'NETWORK_ERROR'
      })
      expect(committedRequestWithLostResponse).toBe(immutableRequest)
      expect(await readCanonicalCounts(serviceDatabase.pool)).toEqual({
        persons: 1,
        sessions: 1,
        encounters: 1,
        vitalSets: 1,
        readings: 1,
        lifestyleAssessments: 1,
        batches: 1
      })
      desktop.close()
      desktop = null

      desktop = openDesktopDatabase(desktopDatabasePath)
      harness = createDesktopHarness(desktop, '2026-09-03T12:00:14.000Z')
      makeRetryDue(desktop, harness.clock.value)
      const recovered = await createWorker(
        harness,
        createSyncHttpClient({ timeoutMs: 10_000 })
      ).runOnce()
      expect(recovered).toMatchObject({ status: 'SYNCED', recordCount: 5 })
      expect(readLocalIdentity(desktop)).toMatchObject({
        patient_id: patientId,
        central_person_id: expect.any(String),
        chs_medical_id: expect.stringMatching(/^CHS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
      })
      expect(readActiveMedicalId(desktop)).toMatchObject({
        patient_id: patientId,
        identifier_type: 'CHS_MEDICAL_ID',
        status: 'ACTIVE'
      })
      expect(readOutboxStatuses(desktop)).toEqual([
        ...Array.from({ length: 7 }, () => 'SENT'),
        'PENDING'
      ])

      const storedResponse = readStoredResponse(desktop)
      const replay = await fetch(`${apiBaseUrl}/api/v1/sync/batches`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${installationToken}`,
          'content-type': 'application/json'
        },
        body: immutableRequest
      })
      expect(replay.status).toBe(200)
      expect(JSON.parse(await replay.text())).toEqual(JSON.parse(storedResponse))
      const countsAfterReplay = await readCanonicalCounts(serviceDatabase.pool)
      expect(countsAfterReplay).toEqual({
        persons: 1,
        sessions: 1,
        encounters: 1,
        vitalSets: 1,
        readings: 1,
        lifestyleAssessments: 1,
        batches: 1
      })

      const operationsSummary = await viewThroughOperations(apiBaseUrl)
      expect(operationsSummary).toEqual({
        acknowledgmentStatus: 'ACKNOWLEDGED',
        patientCount: 1,
        screeningCount: 1,
        sourceCount: 1,
        hasVitals: true,
        hasLifestyle: true
      })

      const revoked = await web.revokeInstallationCredential(
        serviceDatabase.pool,
        {
          installationId,
          credentialId: enrollment.credentialId,
          operatorIdentifier: 'release-1-acceptance',
          reasonCode: 'RELEASE_ACCEPTANCE',
          confirmation: 'REVOKE_INSTALLATION_CREDENTIAL'
        },
        { now: new Date('2026-09-03T12:00:20.000Z'), randomId: randomUUID }
      )
      expect(revoked.kind).toBe('REVOKED')

      seedPostRevocationRevision(desktop)
      harness = createDesktopHarness(desktop, '2026-09-03T12:00:21.000Z')
      const rejected = await createWorker(
        harness,
        createSyncHttpClient({ timeoutMs: 10_000 })
      ).runOnce()
      expect(rejected).toMatchObject({
        status: 'RETRY_SCHEDULED',
        errorCode: 'INVALID_INSTALLATION_TOKEN'
      })
      expect(await readCanonicalCounts(serviceDatabase.pool)).toEqual(countsAfterReplay)

      await writeEvidence({
        offlineRestartDurable: true,
        exactStoredBytesRetried: true,
        unknownOutcomeRecovered: true,
        medicalIdPersistedLocally: true,
        exactReplayDeduplicated: true,
        operationsViewingPassed: true,
        revokedCredentialRejected: true,
        canonicalCounts: countsAfterReplay
      })
    } finally {
      desktop?.close()
      if (app) {
        await app.close()
        serviceDatabase = null
      } else if (serviceDatabase) {
        await serviceDatabase.close()
      }
      await administrationDatabase.pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await administrationDatabase.close()
      await rm(desktopDirectory, { recursive: true, force: true })
    }
  })
})

async function resolveChsWebRepository(): Promise<string> {
  const configured = process.env.CHS_WEB_REPOSITORY?.trim()
  const repository = configured
    ? isAbsolute(configured)
      ? configured
      : resolve(process.cwd(), configured)
    : resolve(process.cwd(), '..', 'CHS-web')
  await access(join(repository, 'package.json'))
  return repository
}

async function loadWebModules(repository: string): Promise<WebModules> {
  const paths = {
    app: join(repository, 'apps/api/dist/app.js'),
    database: join(repository, 'apps/api/dist/database.js'),
    provisioning: join(
      repository,
      'apps/api/dist/administration/screening-context-provisioning.js'
    ),
    enrollment: join(repository, 'apps/api/dist/administration/installation-enrollment.js'),
    lifecycle: join(
      repository,
      'apps/api/dist/administration/installation-credential-lifecycle.js'
    ),
    migrations: join(repository, 'packages/database/src/migration-runner.mjs')
  }
  try {
    await Promise.all(Object.values(paths).map((path) => access(path)))
  } catch {
    throw new Error(
      `CHS-web API build is required. Run: corepack pnpm --dir "${repository}" --filter @chs/api build`
    )
  }
  const [app, database, provisioning, enrollment, lifecycle, migrations] = await Promise.all([
    import(pathToFileURL(paths.app).href),
    import(pathToFileURL(paths.database).href),
    import(pathToFileURL(paths.provisioning).href),
    import(pathToFileURL(paths.enrollment).href),
    import(pathToFileURL(paths.lifecycle).href),
    import(pathToFileURL(paths.migrations).href)
  ])
  return {
    buildApp: app.buildApp,
    createDatabase: database.createDatabase,
    provisionScreeningContext: provisioning.provisionScreeningContext,
    enrollDesktopInstallation: enrollment.enrollDesktopInstallation,
    revokeInstallationCredential: lifecycle.revokeInstallationCredential,
    migrateWithClient: migrations.migrateWithClient
  } as WebModules
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the Release 1 acceptance run`)
  return value
}

function webConfig(databaseUrl: string): WebConfig {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    databaseUrl,
    databasePoolMax: 4,
    http: {
      bodyLimitBytes: 1_048_576,
      requestTimeoutMs: 120_000,
      connectionTimeoutMs: 30_000,
      keepAliveTimeoutMs: 5_000
    },
    buildCommit: 'hsw-018a-acceptance',
    buildTime: capturedAt,
    trustedProxyCidrs: [],
    operationsOidc: null
  }
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)
  const existing = url.searchParams.get('options')?.trim()
  url.searchParams.set(
    'options',
    [existing, `-c search_path=${schema}`]
      .filter((value): value is string => Boolean(value))
      .join(' ')
  )
  return url.toString()
}

async function createIsolatedSchema(
  administrationDatabase: WebDatabase,
  schema: string,
  web: WebModules
): Promise<void> {
  const client = await administrationDatabase.pool.connect()
  try {
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}"`)
    await web.migrateWithClient({ client, logger: { info: () => undefined } })
  } finally {
    client.release()
  }
}

async function seedCentralContext(
  pool: WebPool,
  web: WebModules
): Promise<{ credentialId: string; installationToken: string }> {
  const contextIds = [
    centralOrganizationId,
    centralLocationId,
    '33000000-0000-4000-8000-000000000001',
    '34000000-0000-4000-8000-000000000001'
  ]
  const context = await web.provisionScreeningContext(
    pool,
    {
      organizationIdentifierSystem: 'urn:chs:acceptance:organization',
      organizationIdentifierValue: 'HSW-018A-ORG',
      organizationName: 'Synthetic Release Acceptance Program',
      organizationTypeCode: 'PROGRAM',
      locationIdentifierSystem: 'urn:chs:acceptance:location',
      locationIdentifierValue: 'HSW-018A-LOCATION',
      locationName: 'Synthetic Release Acceptance Clinic',
      locationTypeCode: 'SCREENING_SITE',
      physicalTypeCode: null,
      village: null,
      subdivision: null,
      region: null,
      directions: null,
      operatorIdentifier: 'release-1-acceptance',
      reasonCode: 'RELEASE_ACCEPTANCE'
    },
    {
      now: new Date(capturedAt),
      randomId: () => requiredNextId(contextIds)
    }
  )
  expect(context).toMatchObject({
    organizationId: centralOrganizationId,
    locationId: centralLocationId
  })

  const enrollmentIds = [
    '35000000-0000-4000-8000-000000000001',
    '36000000-0000-4000-8000-000000000001',
    '37000000-0000-4000-8000-000000000001',
    '38000000-0000-4000-8000-000000000001'
  ]
  return web.enrollDesktopInstallation(
    pool,
    {
      installationId,
      organizationId: context.organizationId,
      configuredLocationId: context.locationId,
      sourceLocationId,
      deploymentName: 'Synthetic Release Acceptance Desktop',
      timezone: 'Africa/Douala',
      credentialLabel: 'HSW-018A temporary credential',
      credentialExpiresAt: null,
      operatorIdentifier: 'release-1-acceptance',
      reasonCode: 'RELEASE_ACCEPTANCE'
    },
    {
      now: new Date(capturedAt),
      randomId: () => requiredNextId(enrollmentIds),
      generateToken: () => installationToken
    }
  )
}

function requiredNextId(ids: string[]): string {
  const value = ids.shift()
  if (!value) throw new Error('Synthetic identifier sequence was exhausted')
  return value
}

async function seedOperationsAccess(pool: WebPool): Promise<void> {
  await pool.query(
    `INSERT INTO operations_users (
       id, oidc_issuer, oidc_subject, display_name, status, created_at, updated_at
     ) VALUES ($1, $2, $3, 'Release Acceptance Operator', 'ACTIVE', $4, $4)`,
    [operationsUserId, operationsIssuer, operationsSubject, capturedAt]
  )
  await pool.query(
    `INSERT INTO operations_access_grants (
       id, operations_user_id, permission_code, scope_kind, organization_id,
       active, granted_at, created_at, updated_at
     ) VALUES ($1, $2, 'PATIENT_READ', 'ORGANIZATION', $3, true, $4, $4, $4)`,
    ['92000000-0000-4000-8000-000000000001', operationsUserId, centralOrganizationId, capturedAt]
  )
}

function loopbackAddress(app: WebApp): string {
  const address = app.server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('CHS-web API did not expose a loopback TCP address')
  }
  return `http://127.0.0.1:${address.port}`
}

function openDesktopDatabase(databasePath: string): Database.Database {
  const connection = new Database(databasePath)
  connection.pragma('foreign_keys = ON')
  connection.pragma('journal_mode = WAL')
  connection.pragma('synchronous = NORMAL')
  connection.pragma('busy_timeout = 5000')
  connection.pragma('trusted_schema = OFF')
  createProductionDatabaseMigrationRunner({
    applicationVersion: '1.0.0',
    logger: { info: () => undefined, error: () => undefined },
    clock: { now: () => capturedAt }
  })(connection)
  return connection
}

function createDesktopHarness(connection: Database.Database, now: string): DesktopHarness {
  const clock = { value: parseUtcTimestamp(now) }
  const transactionExecutor = createDatabaseTransactionExecutor({
    connection,
    idGenerator: createEntityIdGenerator(randomUUID),
    clock: createUtcClock(() => clock.value),
    logger: { error: () => undefined }
  })
  return {
    connection,
    clock,
    transactionExecutor,
    foundation: createSyncTransportFoundationService({
      repository: createSyncTransportBatchRepository(connection),
      transactionExecutor,
      credentialProtector: acceptanceCredentialProtector()
    })
  }
}

function createWorker(harness: DesktopHarness, httpClient: SyncHttpClient): SyncWorkerService {
  return createSyncWorkerService({
    foundation: harness.foundation,
    preparation: createSyncSnapshotPreparationService({
      snapshotRepository: createSyncSnapshotRepository(harness.connection),
      batchRepository: createSyncTransportBatchRepository(harness.connection),
      transactionExecutor: harness.transactionExecutor,
      desktopApplicationVersion: '1.0.0',
      desktopSchemaVersion
    }),
    httpClient,
    repository: createSyncWorkerRepository(harness.connection),
    transactionExecutor: harness.transactionExecutor,
    random: () => 0.5
  })
}

function acceptanceCredentialProtector(): SyncCredentialProtector {
  return {
    isAvailable: () => true,
    protect: (value) => Buffer.from(`hsw-018a:${value}`),
    unprotect: (value) =>
      Buffer.from(value)
        .toString()
        .replace(/^hsw-018a:/, '')
  }
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== 'string') throw new Error('Expected a string synchronization body')
  return init.body
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input)
  if (input instanceof URL) return input
  return new URL(input.url)
}

function makeRetryDue(connection: Database.Database, now: UtcTimestamp): void {
  const result = connection
    .prepare("UPDATE sync_transport_batches SET next_attempt_at = ? WHERE status = 'RETRY_WAIT'")
    .run(now)
  expect(result.changes).toBe(1)
}

function readStoredRequest(connection: Database.Database): string {
  const row = connection.prepare('SELECT request_json FROM sync_transport_batches').get() as {
    request_json: string
  }
  return row.request_json
}

function readStoredResponse(connection: Database.Database): string {
  const row = connection.prepare('SELECT response_json FROM sync_transport_batches').get() as {
    response_json: string
  }
  return row.response_json
}

function readLocalIdentity(connection: Database.Database): Record<string, unknown> {
  return connection
    .prepare(
      'SELECT patient_id, central_person_id, chs_medical_id FROM sync_patient_identity_links'
    )
    .get() as Record<string, unknown>
}

function readActiveMedicalId(connection: Database.Database): Record<string, unknown> {
  return connection
    .prepare(
      `SELECT patient_id, identifier_type, identifier_value, status
       FROM patient_identifiers
       WHERE identifier_type = 'CHS_MEDICAL_ID' AND status = 'ACTIVE'`
    )
    .get() as Record<string, unknown>
}

function readOutboxStatuses(connection: Database.Database): readonly string[] {
  return (
    connection.prepare('SELECT status FROM sync_outbox ORDER BY id').all() as readonly {
      status: string
    }[]
  ).map((row) => row.status)
}

async function readCanonicalCounts(pool: WebPool): Promise<CanonicalCounts> {
  const result = await pool.query(
    `SELECT
       (SELECT count(*)::integer FROM persons) AS persons,
       (SELECT count(*)::integer FROM screening_sessions) AS sessions,
       (SELECT count(*)::integer FROM screening_encounters) AS encounters,
       (SELECT count(*)::integer FROM screening_vital_sets) AS vital_sets,
       (SELECT count(*)::integer FROM vital_readings) AS readings,
       (SELECT count(*)::integer FROM lifestyle_assessments) AS lifestyle_assessments,
       (SELECT count(*)::integer FROM sync_batches) AS batches`
  )
  const row = result.rows[0]
  if (!row) throw new Error('Canonical count query returned no row')
  return {
    persons: numberProperty(row, 'persons'),
    sessions: numberProperty(row, 'sessions'),
    encounters: numberProperty(row, 'encounters'),
    vitalSets: numberProperty(row, 'vital_sets'),
    readings: numberProperty(row, 'readings'),
    lifestyleAssessments: numberProperty(row, 'lifestyle_assessments'),
    batches: numberProperty(row, 'batches')
  }
}

function numberProperty(value: Record<string, unknown>, key: string): number {
  const candidate = value[key]
  if (typeof candidate !== 'number') throw new Error(`Expected numeric ${key}`)
  return candidate
}

async function viewThroughOperations(apiBaseUrl: string): Promise<{
  acknowledgmentStatus: string
  patientCount: number
  screeningCount: number
  sourceCount: number
  hasVitals: boolean
  hasLifestyle: boolean
}> {
  const search = await fetch(`${apiBaseUrl}/api/v1/operations/patients/search`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${operationsToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      reasonCode: 'OPERATIONS_SUPPORT',
      search: 'Synthetic',
      page: 1,
      pageSize: 25
    })
  })
  expect(search.status).toBe(200)
  const searchBody = (await search.json()) as {
    totalItems: number
    items: readonly { personId: string }[]
  }
  expect(searchBody.items).toHaveLength(1)
  const personId = searchBody.items[0]?.personId
  if (!personId) throw new Error('Operations search did not return a canonical person')

  const detail = await fetch(`${apiBaseUrl}/api/v1/operations/patients/detail`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${operationsToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      reasonCode: 'OPERATIONS_SUPPORT',
      personId,
      page: 1,
      pageSize: 25
    })
  })
  expect(detail.status).toBe(200)
  const detailBody = (await detail.json()) as {
    identityAssurance: { acknowledgmentStatus: string }
    sourceProvenance: { sourceCount: number }
    screeningHistory: {
      totalItems: number
      items: readonly { vitals: unknown; lifestyle: unknown }[]
    }
  }
  const screening = detailBody.screeningHistory.items[0]
  return {
    acknowledgmentStatus: detailBody.identityAssurance.acknowledgmentStatus,
    patientCount: searchBody.totalItems,
    screeningCount: detailBody.screeningHistory.totalItems,
    sourceCount: detailBody.sourceProvenance.sourceCount,
    hasVitals: screening?.vitals !== null && screening?.vitals !== undefined,
    hasLifestyle: screening?.lifestyle !== null && screening?.lifestyle !== undefined
  }
}

function seedPostRevocationRevision(connection: Database.Database): void {
  connection
    .prepare('UPDATE patients SET village = ?, row_version = 3, updated_at = ? WHERE id = ?')
    .run('Synthetic Updated Village', '2026-09-03T12:00:21.000Z', patientId)
  insertOutbox(
    connection,
    outboxIds.revokedRevision,
    'PATIENT',
    patientId,
    'PATIENT_DEMOGRAPHICS_AMENDED',
    '2026-09-03T12:00:21.000Z'
  )
}

async function writeEvidence(input: {
  readonly offlineRestartDurable: boolean
  readonly exactStoredBytesRetried: boolean
  readonly unknownOutcomeRecovered: boolean
  readonly medicalIdPersistedLocally: boolean
  readonly exactReplayDeduplicated: boolean
  readonly operationsViewingPassed: boolean
  readonly revokedCredentialRejected: boolean
  readonly canonicalCounts: CanonicalCounts
}): Promise<void> {
  const path = resolve(process.cwd(), 'artifacts', 'release-1-acceptance.json')
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify(
      {
        task: 'HSW-018A',
        result: 'PASSED',
        generatedAt: new Date().toISOString(),
        runtime: { node: process.version },
        contractVersion: '1.0',
        desktopSchemaVersion,
        checks: input,
        dataClassification: 'SYNTHETIC_AGGREGATES_ONLY'
      },
      null,
      2
    )}\n`,
    { encoding: 'utf8', mode: 0o600 }
  )
}

function readCount(connection: Database.Database, table: string): number {
  const allowed = new Set(['patients', 'screening_encounters', 'sync_outbox'])
  if (!allowed.has(table)) throw new Error('Unexpected acceptance count table')
  return (connection.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
    .count
}

function seedCompleteOfflineGraph(connection: Database.Database): void {
  connection
    .prepare(
      `INSERT INTO users (
         id, username, username_normalized, display_name, password_hash, password_salt,
         role, is_active, must_change_password, failed_login_count, locked_until,
         last_login_at, created_at, updated_at
       ) VALUES (?, 'synthetic', 'synthetic', 'Synthetic Nurse', 'hash', 'salt', 'NURSE',
                 1, 0, 0, NULL, NULL, ?, ?)`
    )
    .run(actorId, capturedAt, capturedAt)
  connection
    .prepare(
      `INSERT INTO installation (
         singleton_id, id, deployment_name, timezone, created_at, updated_at
       ) VALUES (1, ?, 'Synthetic installation', 'Africa/Douala', ?, ?)`
    )
    .run(installationId, capturedAt, capturedAt)
  connection
    .prepare(
      `INSERT INTO locations (
         id, name, name_normalized, location_type, village, subdivision, region,
         directions, is_active, created_by, created_at, updated_by, updated_at
       ) VALUES (?, 'Synthetic clinic', 'synthetic clinic', 'CLINIC', NULL, NULL, NULL,
                 NULL, 1, ?, ?, ?, ?)`
    )
    .run(sourceLocationId, actorId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO installation_location_configuration (
         singleton_id, installation_id, location_id, configured_at, configured_by,
         updated_at, updated_by, row_version
       ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(installationId, sourceLocationId, capturedAt, actorId, capturedAt, actorId)
  connection
    .prepare(
      `INSERT INTO patients (
         id, patient_code, display_name, given_name, family_name, other_names,
         name_normalized, sex, date_of_birth, approximate_age_years, age_as_of_date,
         phone, phone_normalized, alternate_contact_name, alternate_contact_phone,
         village, quarter, residence_notes, status, created_by, created_at, updated_by,
         updated_at, row_version
       ) VALUES (?, 'PT-000001', 'Synthetic Patient', 'Synthetic', 'Patient', NULL,
                 'synthetic patient', 'FEMALE', '1980-01-01', NULL, NULL, NULL, NULL,
                 NULL, NULL, 'Synthetic Village', NULL, NULL, 'ACTIVE', ?, ?, ?, ?, 2)`
    )
    .run(patientId, actorId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO consent_records (
         id, patient_id, consent_type, status, source_type, effective_at, withdrawn_at,
         notes, recorded_by, recorded_at, patient_prior_row_version, patient_resulting_row_version
       ) VALUES (?, ?, 'PATIENT_REGISTRY_ACKNOWLEDGMENT', 'ACKNOWLEDGED', 'LOCAL', ?, NULL,
                 NULL, ?, ?, 1, 2)`
    )
    .run('11000000-0000-4000-8000-000000000001', patientId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO screening_sessions (
         id, location_id, protocol_version_id, session_date, status, notes, opened_by,
         opened_at, closed_by, closed_at, created_by, created_at, updated_by, updated_at,
         row_version
       ) VALUES (?, ?, ?, '2026-09-03', 'CLOSED', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 2)`
    )
    .run(
      sessionId,
      sourceLocationId,
      '00000000-0000-4000-8000-000000000007',
      actorId,
      capturedAt,
      actorId,
      capturedAt,
      actorId,
      capturedAt,
      actorId,
      capturedAt
    )
  connection
    .prepare(
      `INSERT INTO screening_encounters (
         id, patient_id, screening_session_id, location_id, protocol_version_id, status,
         started_at, completed_at, source_type, recorded_by, amendment_of_encounter_id,
         amendment_reason, void_reason, record_version, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, 'LOCAL', ?, NULL, NULL, NULL, 2, ?, ?)`
    )
    .run(
      encounterId,
      patientId,
      sessionId,
      sourceLocationId,
      '00000000-0000-4000-8000-000000000007',
      capturedAt,
      capturedAt,
      actorId,
      capturedAt,
      capturedAt
    )
  connection
    .prepare(
      `INSERT INTO screening_vitals_drafts (
         id, encounter_id, status, weight_kg, waist_cm, notes, created_by, created_at,
         updated_by, updated_at, row_version
       ) VALUES (?, ?, 'VITALS_COMPLETE', 75.5, 90, NULL, ?, ?, ?, ?, 2)`
    )
    .run(vitalsId, encounterId, actorId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO screening_vitals_draft_readings (
         id, vitals_draft_id, sequence_number, systolic, diastolic, pulse,
         measurement_site, patient_position, measurement_time, created_at, updated_at
       ) VALUES (?, ?, 1, 128, 82, 70, 'RIGHT_ARM', 'SITTING', '12:30', ?, ?)`
    )
    .run('71000000-0000-4000-8000-000000000001', vitalsId, capturedAt, capturedAt)
  seedLifestyle(connection)

  insertOutbox(connection, outboxIds.patientCreated, 'PATIENT', patientId, 'PATIENT_CREATED')
  insertOutbox(
    connection,
    outboxIds.patientAcknowledged,
    'PATIENT',
    patientId,
    'PATIENT_ACKNOWLEDGMENT_RECORDED',
    '2026-09-03T12:00:01.000Z'
  )
  insertOutbox(
    connection,
    outboxIds.session,
    'SCREENING_SESSION',
    sessionId,
    'SCREENING_SESSION_CLOSED'
  )
  insertOutbox(
    connection,
    outboxIds.encounterStarted,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_ENCOUNTER_STARTED'
  )
  insertOutbox(
    connection,
    outboxIds.encounterCompleted,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_ENCOUNTER_COMPLETED',
    '2026-09-03T12:00:01.000Z'
  )
  insertOutbox(
    connection,
    outboxIds.vitals,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_VITALS_STEP_COMPLETED'
  )
  insertOutbox(
    connection,
    outboxIds.lifestyle,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_LIFESTYLE_STEP_COMPLETED'
  )
  insertOutbox(
    connection,
    outboxIds.excluded,
    'SCREENING_ENCOUNTER',
    encounterId,
    'SCREENING_FOOD_DRAFT_SAVED'
  )
}

function seedLifestyle(connection: Database.Database): void {
  const alcoholBaseline = '81000000-0000-4000-8000-000000000001'
  const tobaccoBaseline = '82000000-0000-4000-8000-000000000001'
  const workBaseline = '83000000-0000-4000-8000-000000000001'
  connection
    .prepare(
      `INSERT INTO lifestyle_alcohol_baseline_versions (
         id, patient_id, installation_id, version, status, ever_consumed,
         consumed_past_12_months, common_beverage_types_json, other_beverage_description,
         created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'NEVER', 'NO', 'NO', '[]', NULL, ?, ?, ?, ?)`
    )
    .run(alcoholBaseline, patientId, installationId, actorId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO lifestyle_tobacco_baseline_versions (
         id, patient_id, installation_id, version, status, ever_regularly_used,
         former_use_approximate_stop_date, current_use_frequency, product_types_json,
         other_product_description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'NEVER', 'NO', NULL, 'NOT_AT_ALL', '[]', NULL, ?, ?, ?, ?)`
    )
    .run(tobaccoBaseline, patientId, installationId, actorId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO lifestyle_work_baseline_versions (
         id, patient_id, installation_id, version, status, occupation_job_title,
         usual_physical_demand, typical_workdays_per_week, typical_hours_per_workday,
         shift_pattern, description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, ?, 1, 'UNEMPLOYED', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?)`
    )
    .run(workBaseline, patientId, installationId, actorId, capturedAt, actorId, capturedAt)
  connection
    .prepare(
      `INSERT INTO lifestyle_drafts (
         id, encounter_id, status, patient_id, screening_session_id, location_id,
         installation_id, period_start, period_end, alcohol_baseline_version_id,
         tobacco_baseline_version_id, work_baseline_version_id, created_by, created_at,
         updated_by, updated_at, row_version, other_activity_response
       ) VALUES (?, ?, 'COMPLETE', ?, ?, ?, ?, '2026-08-28', '2026-09-03', ?, ?, ?,
                 ?, ?, ?, ?, 2, 'NO')`
    )
    .run(
      lifestyleId,
      encounterId,
      patientId,
      sessionId,
      sourceLocationId,
      installationId,
      alcoholBaseline,
      tobaccoBaseline,
      workBaseline,
      actorId,
      capturedAt,
      actorId,
      capturedAt
    )
  connection
    .prepare(
      `INSERT INTO lifestyle_alcohol_weekly_records (
         id, lifestyle_draft_id, weekly_response, drinking_days, total_standardized_drinks,
         largest_one_day_amount, days_at_largest_amount, common_beverage_types_json,
         other_beverage_description, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO', NULL, NULL, NULL, NULL, '[]', NULL, ?, ?, ?, ?)`
    )
    .run(
      '84000000-0000-4000-8000-000000000001',
      lifestyleId,
      actorId,
      capturedAt,
      actorId,
      capturedAt
    )
  connection
    .prepare(
      `INSERT INTO lifestyle_tobacco_weekly_records (
         id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO', ?, ?, ?, ?)`
    )
    .run(
      '85000000-0000-4000-8000-000000000001',
      lifestyleId,
      actorId,
      capturedAt,
      actorId,
      capturedAt
    )
  connection
    .prepare(
      `INSERT INTO lifestyle_physical_activity_weekly_records (
         id, lifestyle_draft_id, weekly_response, sedentary_minutes_per_day,
         created_by, created_at, updated_by, updated_at, sedentary_time_response
       ) VALUES (?, ?, 'NO', 300, ?, ?, ?, ?, 'RECORDED')`
    )
    .run(
      '86000000-0000-4000-8000-000000000001',
      lifestyleId,
      actorId,
      capturedAt,
      actorId,
      capturedAt
    )
  connection
    .prepare(
      `INSERT INTO lifestyle_work_weekly_records (
         id, lifestyle_draft_id, weekly_response, created_by, created_at, updated_by, updated_at
       ) VALUES (?, ?, 'NO_WORK', ?, ?, ?, ?)`
    )
    .run(
      '87000000-0000-4000-8000-000000000001',
      lifestyleId,
      actorId,
      capturedAt,
      actorId,
      capturedAt
    )
}

function insertOutbox(
  connection: Database.Database,
  id: string,
  aggregateType: string,
  aggregateId: string,
  operation: string,
  createdAt: string = capturedAt
): void {
  connection
    .prepare(
      `INSERT INTO sync_outbox (
         id, aggregate_type, aggregate_id, operation, payload_json, payload_schema_version,
         created_at, status, attempt_count, next_attempt_at, last_error_code,
         last_error_message, sent_at
       ) VALUES (?, ?, ?, ?, '{}', 'synthetic.v1', ?, 'PENDING', 0, NULL, NULL, NULL, NULL)`
    )
    .run(id, aggregateType, aggregateId, operation, createdAt)
}
