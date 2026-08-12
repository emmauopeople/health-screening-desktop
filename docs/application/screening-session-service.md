# Screening Session Application Service

HSD-027C adds the main-process application-service boundary for screening-session lifecycle work. It composes the version-4 screening-session repositories with installation, location, protocol-version, audit-event, transaction, and sync-outbox boundaries.

## Operations

The service exposes:

- `create`
- `ensureCurrentScreeningSession`
- `findCurrentScreeningSession`
- `close`
- `reopen`
- `getById`
- `list`

It does not expose generic session updates. Screening encounters, measurements,
protocol calculation, reports, sync transport, and network behavior remain
outside this service boundary.

## Authorization

`LOCAL_ADMIN` and `NURSE` may create, close, reopen, get, and list screening sessions.

`TRAINED_SCREENER` may create, close, get, and list screening sessions. A trained screener may not reopen a closed session.

The actor is a trusted main-process service input containing only `userId` and `role`. The service rejects malformed actor objects, extra properties, accessors, symbol keys, custom prototypes, and proxy inspection failures with controlled sanitized errors.

`ensureCurrentScreeningSession()` resolves authentication from the trusted
main-process local-authentication session. `LOCAL_ADMIN`, `NURSE`, and
`TRAINED_SCREENER` may ensure the current daily session because those are the
approved roles for operating the Screening workflow. The renderer cannot supply
identity, role, token, actor, timestamp, or audit metadata.

## Current Daily Session Policy

`ensureCurrentScreeningSession()` is the trusted zero-argument operation used
when the Screening workflow is entered. It accepts no request object and no
caller-controlled location, date, session, actor, role, status, force, bypass,
patient, encounter, or clinical fields.

The service resolves all operational authority inside the main process:

1. authenticate and authorize the current local session;
2. call the HSD-029C-P0 `resolveConfiguredInstallationLocation()` resolver;
3. read the installation timezone and transaction UTC timestamp;
4. derive the operational local calendar date from the stored IANA timezone;
5. look up the canonical session by configured `location_id` and
   `session_date`;
6. return an existing `OPEN` session as `RESOLVED`;
7. return `SESSION_CLOSED` when today's canonical session is closed;
8. create one `OPEN` session only when no canonical session exists.

The configured-location resolver outcomes map directly to sanitized service
statuses: `LOCATION_NOT_CONFIGURED`, `LOCATION_NOT_FOUND`,
`LOCATION_INACTIVE`, and `UNAVAILABLE`. The service never selects the first
active location, reads renderer memory, uses browser storage, reads an
environment-variable override, silently assigns a location, or calls the P0
admin recovery/reconfiguration operations.

Creating a missing daily session also requires one active protocol version,
because `screening_sessions.protocol_version_id` is required and retained for
encounter attribution. HSD-029C-P4 adds migration version 7 to provision one
deterministic baseline active protocol only for databases with no protocol
versions. Databases that already contain protocol rows are left unchanged; if
they have no active protocol, the service continues to return the sanitized
`NO_ACTIVE_PROTOCOL` result rather than choosing or rewriting protocol state.

The database uniqueness invariant remains
`ux_screening_sessions_location_date(location_id, session_date)`. Creation runs
inside the existing transaction executor with session state, lifecycle history,
audit, and outbox writes in one transaction. If another transaction creates the
same canonical row first, only `ScreeningSessionAlreadyExistsError` from that
specific uniqueness constraint is treated as an identity race; the service then
queries the canonical row by the trusted configured location and authoritative
date and returns it. Other database failures are returned only as
`UNAVAILABLE`.

The success result is sanitized and contains only:

- `RESOLVED` or `CREATED`;
- the `OPEN` session fields needed by the renderer workflow;
- the configured location display fields needed for the header.

`findCurrentScreeningSession()` uses the same trusted authentication,
configured-location, installation-timezone, transaction-clock, and
deployment-local-date authority, but is strictly read-only. It returns
`FOUND` for an existing canonical open session or `SESSION_NOT_FOUND` when
today's session does not exist. It never creates, updates, closes, reopens, or
audits a session; daily-session creation remains exclusively under
`ensureCurrentScreeningSession()` and the established Screening entry flow.

Notes are not exposed through this boundary. Closed sessions are never reopened
or replaced by this operation. Existing sessions are not mutated merely because
they are resolved. Entering Screening does not create a patient encounter,
clinical record, recommendation, referral, report, sync transport action, or
FHIR mapping.

## Create Policy

Create requests contain only:

- `locationId`
- `sessionDate`
- `notes`

The caller cannot provide a protocol version, session ID, lifecycle-history ID, actor ID, timestamp, audit ID, outbox ID, status, or row version.

Inside one `DatabaseTransactionExecutor.run` callback, the service:

1. obtains the transaction UTC timestamp;
2. reads the installation timezone;
3. converts the timestamp to the deployment-local calendar date using the stored IANA timezone;
4. requires the requested `sessionDate` to equal that local date;
5. reads the location through the transaction-scoped location boundary;
6. requires the location to exist and be active;
7. resolves the single active protocol version through the transaction-scoped protocol boundary;
8. inserts the `OPEN` session and `CREATED` lifecycle row;
9. appends the audit event;
10. inserts one pending screening-session outbox item.

The service never falls back to the operating-system timezone or UTC when the stored timezone is invalid.

## Close And Reopen

Close requires a session ID, expected row version, and optional reason. Close preserves repository outcomes:

- `CLOSED`
- `NOT_FOUND`
- `SESSION_VERSION_CONFLICT`
- `ALREADY_CLOSED`

Reopen requires a session ID, expected row version, and nonblank reason. Reopen preserves repository outcomes:

- `REOPENED`
- `NOT_FOUND`
- `SESSION_VERSION_CONFLICT`
- `ALREADY_OPEN`
- `FORBIDDEN`

The service does not block reopen because the retained location or protocol version later became inactive.

## Audit

Successful lifecycle mutations write one audit event with entity type `SCREENING_SESSION`.

Action codes:

- `SCREENING_SESSION_CREATED`
- `SCREENING_SESSION_CLOSED`
- `SCREENING_SESSION_REOPENED`

`ensureCurrentScreeningSession()` writes `SCREENING_SESSION_CREATED` only when
it actually creates the missing daily session. Resolving an existing open
session, returning a closed-session conflict, losing a uniqueness race and
recovering the canonical row, authorization failure, location-resolution
failure, and transaction rollback do not create duplicate creation audits.

Audit metadata is bounded and limited to lifecycle traceability fields:

- `session_id`
- `location_id`
- `lifecycle_transition`
- `prior_row_version`
- `resulting_row_version`

Audit metadata excludes notes, close or reopen reasons, clinical data, payloads, SQL, paths, raw exception messages, and stack traces.

## Sync Outbox

Successful lifecycle mutations insert exactly one `PENDING` `sync_outbox` row in the same transaction.

Outbox contract:

- `aggregate_type`: `SCREENING_SESSION`
- `aggregate_id`: screening-session ID
- `operation`: `SCREENING_SESSION_CREATED`, `SCREENING_SESSION_CLOSED`, or `SCREENING_SESSION_REOPENED`
- `payload_schema_version`: `screening-session.lifecycle.v1`

The outbox payload is canonical JSON, bounded, deterministic, and self-contained for lifecycle synchronization. It includes lifecycle identifiers, transition facts, session date, location, retained protocol version, notes, reason when applicable, actor, timestamp, and row-version transition.

`ensureCurrentScreeningSession()` follows the same session-creation outbox
policy as `create`: exactly one `SCREENING_SESSION_CREATED` outbox row is
inserted for a real new daily session, and none is inserted for existing-session
resolution, controlled failures, uniqueness-race recovery, or rollback.

This checkpoint does not implement sync transport, retries, batching, networking, remote APIs, or conflict resolution.

## Atomic Boundary

For successful create, close, and reopen operations, these writes commit or roll back together:

1. screening-session current state;
2. append-only lifecycle-history row;
3. audit event;
4. sync-outbox row.

Repositories do not begin, commit, roll back, or savepoint transactions. The service uses the existing synchronous transaction executor as the only transaction owner.

For `ensureCurrentScreeningSession()`, failed authentication, failed
authorization, invalid configured-location state, a closed canonical session,
and unexpected transaction failure leave session, audit, and outbox counts
unchanged. Retrying after a sanitized `UNAVAILABLE` result is safe because the
operation derives the same configured location and operational date again and
recovers the canonical row after expected uniqueness races.

## Sensitive Data

Controlled service errors do not expose SQL statements, database paths, raw SQLite messages, stack traces, causes, notes, reasons, outbox payloads, or unrelated identifiers.

## Renderer Boundary

HSD-029C-P1 exposes only the fixed IPC/preload method for ensuring the current
daily session and adds a minimal Screening-workflow entry gate. The renderer
does not choose the location or date, does not persist location authority, does
not call administrative recovery or reconfiguration, and does not pass patient
or encounter identifiers to this operation. Existing historical location
attribution is never rewritten.
