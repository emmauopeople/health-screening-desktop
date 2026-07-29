# Database Repository Boundary

HSD-009 adds the first main-process-only repository boundary: the typed
installation repository. It reads and creates the schema-version-1 installation
singleton without changing the schema, adding startup writes, or exposing SQLite
through IPC.

## Ownership

Repositories live under `src/main/database/repositories`. They own exact SQL,
strict row decoding, and controlled repository errors. Application services own
workflow sequencing, authorization, audit decisions, and transaction boundaries.
Preload, renderer, and shared IPC code must not import repository modules.

The installation repository retains the already-open `better-sqlite3`
connection only for read-only queries. Writes require the HSD-008
`DatabaseTransactionConnection` from a transaction callback. The repository does
not run `BEGIN`, `COMMIT`, `ROLLBACK`, savepoints, `transaction()`, retries,
updates, deletes, repairs, or schema mutations.

## Installation State

`get()` returns a frozen installation record or `null`. `getState()` returns a
fresh frozen state on every call:

- `UNINITIALIZED`: the singleton row with `singleton_id = 1` is absent.
- `INITIALIZED`: the singleton row exists and every field decodes through the
  trusted domain parsers.

Absence is not a first-run workflow and does not imply anything about users,
locations, protocol rows, settings, audit rows, or clinical data. A malformed
installation row is a data-integrity failure, not `UNINITIALIZED`, and is never
repaired automatically.

## Row Mapping

The repository uses explicit column lists only. It does not use `SELECT *`.
Installation rows are decoded from unknown SQLite values:

- `id` uses the HSD-008 UUID v4 `EntityId` parser.
- `deployment_name` normalizes with NFKC, trims, collapses Unicode whitespace to
  ASCII space, rejects controls and invalid surrogate pairs, and preserves
  display case.
- `timezone` is validated with built-in `Intl.DateTimeFormat` and stored as the
  runtime canonical IANA timezone.
- `created_at` and `updated_at` use the HSD-008 UTC timestamp parser.

Create input is revalidated at runtime. `createdAt` and `updatedAt` must be the
same timestamp; the future first-run service will obtain one transaction time
and reuse it.

## Errors

Repository errors have fixed codes and messages:

- `RepositoryValidationError`
- `RepositoryReadError`
- `RepositoryWriteError`
- `RepositoryDataIntegrityError`
- `InstallationAlreadyExistsError`

They do not retain causes, stacks, SQL, paths, UUIDs, timestamps, deployment
names, timezone values, or SQLite messages. Repository code does not log. Later
services may log only fixed event names, phases, safe codes, and reviewed
technical error types.

## Prohibited Behaviors

Repositories must not log SQL or values, expose raw SQLite errors, use
reflection-based mappers, cache first-run state, auto-repair persisted data,
perform startup writes, mutate schema version 1, or create user, authentication,
clinical, sync, backup, restore, printing, renderer, preload, or IPC behavior
without a later reviewed task.
