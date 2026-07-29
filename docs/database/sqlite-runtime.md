# SQLite Runtime

HSD-006 provides the local SQLite runtime foundation. HSD-007 adds the numbered
migration boundary that upgrades the local database to schema version 1 before
the runtime is marked ready. The file-backed database is stored at:

`<app.getPath('userData')>/data/health-screening.sqlite3`

The path is resolved in the main process after Electron is ready. It is not
renderer-controlled, is not returned through IPC, and is never written to
operational logs. Tests inject temporary userData directories and never use the
real AppData directory.

## Startup

The primary instance initializes one connection before IPC handlers or the main
window are started. It verifies `foreign_keys=ON`, `journal_mode=WAL`,
`synchronous=NORMAL`, `busy_timeout=5000`, and `trusted_schema=OFF`. The
HSD-007 production migration runner then verifies or applies bundled numbered
SQL migrations. Only after migration success does the runtime run `SELECT 1`,
store the live connection, report database `ready`, register application IPC, or
create the renderer window.

Initialization failure closes any partial handle, logs only fixed phases and
exception types, and exits before renderer load. There is no in-memory or
alternate fallback.

The runtime reports `ready` only while a live health query succeeds. `close()`
is idempotent and transitions the runtime to `unavailable`. The renderer sees
only the typed `app.getHealth()` database state: `ready` or `unavailable`.

## Boundary And Scope

Only `src/main/database` imports `better-sqlite3`. No SQL, migration checksum,
schema detail, query, execute, prepare, pragma, path, handle, or native object is
exposed through preload, shared contracts, or the renderer. HSD-007 creates the
empty schema only. It does not add repositories, patient workflows,
authentication, audit writing, outbox processing, backup/restore, or
synchronization. Those concerns remain later reviewed tasks.

The main build externalizes the native dependency. electron-builder unpacks
the `.node` binary while keeping ASAR enabled. `electron-builder install-app-deps`
must be used for Electron ABI compatibility before development and unpacked
Windows smoke tests.

## Testing

The integration suite opens real temporary file-backed databases and verifies
file creation, startup pragmas, schema version 1 migration, idempotent restarts,
history mismatch refusal, rollback behavior, schema constraints, health
transitions, partial-failure cleanup, and safe logging. The repository must
remain free of SQLite, WAL, and SHM artifacts.
