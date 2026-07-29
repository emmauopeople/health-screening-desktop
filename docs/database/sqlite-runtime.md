# SQLite Runtime

HSD-006 provides the local SQLite runtime foundation only. It creates one empty
file-backed database at:

`<app.getPath('userData')>/data/health-screening.sqlite3`

The path is resolved in the main process after Electron is ready. It is not
renderer-controlled, is not returned through IPC, and is never written to
operational logs. Tests inject temporary userData directories and never use the
real AppData directory.

## Startup

The primary instance initializes one connection before IPC handlers or the main
window are started. It verifies `foreign_keys=ON`, `journal_mode=WAL`,
`synchronous=NORMAL`, `busy_timeout=5000`, `trusted_schema=OFF`, and
`user_version=0`, followed by `SELECT 1`. Initialization failure closes any
partial handle, logs only a fixed phase and exception type, and exits before
renderer load. There is no in-memory or alternate fallback.

The runtime reports `ready` only while a live health query succeeds. `close()`
is idempotent and transitions the runtime to `unavailable`. The renderer sees
only the typed `app.getHealth()` database state: `ready` or `unavailable`.

## Boundary And Scope

Only `src/main/database` imports `better-sqlite3`. No SQL, query, execute,
prepare, pragma, path, handle, or native object is exposed through preload,
shared contracts, or the renderer. HSD-006 intentionally creates no migrations,
application tables, repositories, patient data, authentication, audit records,
outbox records, backup/restore, or synchronization. Those concerns begin in
later reviewed tasks.

The main build externalizes the native dependency. electron-builder unpacks
the `.node` binary while keeping ASAR enabled. `electron-builder install-app-deps`
must be used for Electron ABI compatibility before development and unpacked
Windows smoke tests.

## Testing

The integration suite opens a real temporary file-backed database and verifies
file creation, all startup pragmas, health transitions, idempotent ownership,
partial-failure cleanup, and safe logging. The repository must remain free of
SQLite, WAL, and SHM artifacts.
