# Database Transaction Boundary

HSD-008 adds a main-process-only transaction executor for future repository
writes. It does not add repositories or production data writes by itself.

## API

`src/main/database/transaction` exports `createDatabaseTransactionExecutor`.
The executor is created with a live HSD-007 SQLite connection after production
migrations have completed, plus injected main-process `EntityIdGenerator` and
`UtcClock` providers.

Each callback receives a frozen context:

- `connection`: a transaction-scoped guarded SQLite capability for synchronous
  SQL.
- `newEntityId()`: returns a validated canonical lowercase UUID v4 `EntityId`.
- `nowUtc()`: returns a validated `YYYY-MM-DDTHH:mm:ss.sssZ` timestamp.

## Rules

- Every write transaction uses one `BEGIN IMMEDIATE` and one `COMMIT`.
- Work must be synchronous. Returning a `Promise` or thenable is refused and
  rolled back.
- The scoped connection, prepared statements, `newEntityId()`, and `nowUtc()`
  become inactive when callback execution returns. Captured capabilities cannot
  continue database work from an asynchronous continuation after rollback.
- Callback code cannot issue transaction-control SQL through the scoped
  capability. `BEGIN IMMEDIATE`, `COMMIT`, and any `ROLLBACK` remain owned by
  the executor.
- Nested or re-entrant transaction attempts are refused before callback work
  starts.
- Pre-existing open transactions are refused before callback work starts.
- Savepoints, retry loops, background work, and async callback continuation are
  not part of the HSD-008 boundary.
- Any failure after `BEGIN IMMEDIATE` attempts one rollback if SQLite still
  reports an open transaction.

The executor returns a callback result only after `COMMIT` completes and the
connection is no longer in a transaction.

## Error And Log Safety

Transaction failures throw controlled errors:

- `DatabaseTransactionStateError`
- `DatabaseTransactionAsyncWorkError`
- `DatabaseTransactionExecutionError`

Foundation provider failures may surface as `EntityIdGenerationError` or
`UtcClockError`. Controlled errors do not retain raw causes, stack traces,
database paths, SQL, row values, or native driver messages.

Logs use only fixed event text, phase, and sanitized exception type:

- `Database transaction failed; phase=<begin|work|commit|state>; errorType=<type>`
- `Database transaction rollback failed; phase=rollback; errorType=<type>`

Do not log SQL, bind values, entity contents, checksums, database paths, or raw
SQLite messages from transaction code.

## Scope

HSD-008 does not create schema version 2 and does not mutate the version-1
production schema. It adds no seed data, authentication, repositories, clinical
workflow, sync worker, backup feature, IPC channel, preload method, renderer
surface, FHIR integration, portal integration, or AI feature.

Future repositories must use this executor as their write boundary instead of
opening ad hoc transactions or exposing an unguarded SQLite connection outside
the main process.
