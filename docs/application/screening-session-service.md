# Screening Session Application Service

HSD-027C adds the main-process application-service boundary for screening-session lifecycle work. It composes the version-4 screening-session repositories with installation, location, protocol-version, audit-event, transaction, and sync-outbox boundaries.

## Operations

The service exposes:

- `create`
- `close`
- `reopen`
- `getById`
- `list`

It does not expose generic session updates. Screening encounters, measurements, protocol calculation, IPC, preload APIs, renderer state, reports, sync transport, and network behavior remain outside this checkpoint.

## Authorization

`LOCAL_ADMIN` and `NURSE` may create, close, reopen, get, and list screening sessions.

`TRAINED_SCREENER` may create, close, get, and list screening sessions. A trained screener may not reopen a closed session.

The actor is a trusted main-process service input containing only `userId` and `role`. The service rejects malformed actor objects, extra properties, accessors, symbol keys, custom prototypes, and proxy inspection failures with controlled sanitized errors.

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

This checkpoint does not implement sync transport, retries, batching, networking, remote APIs, or conflict resolution.

## Atomic Boundary

For successful create, close, and reopen operations, these writes commit or roll back together:

1. screening-session current state;
2. append-only lifecycle-history row;
3. audit event;
4. sync-outbox row.

Repositories do not begin, commit, roll back, or savepoint transactions. The service uses the existing synchronous transaction executor as the only transaction owner.

## Sensitive Data

Controlled service errors do not expose SQL statements, database paths, raw SQLite messages, stack traces, causes, notes, reasons, outbox payloads, or unrelated identifiers.

## Checkpoint D Boundary

Future checkpoints may expose this service through IPC and preload and add renderer workflows. HSD-027C intentionally remains main-process only.
