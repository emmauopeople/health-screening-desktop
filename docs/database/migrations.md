# Database Migrations

HSD-007 introduces a main-process-only SQLite migration runner. The production
catalog is `src/main/database/migrations/migration-manifest.ts`; SQL files live
under `src/main/database/migrations/sql/`.

## Manifest Rules

- List every migration explicitly in ascending order. Do not scan the filesystem
  at runtime.
- Use positive integer versions beginning at `1` with no gaps.
- Use stable lowercase kebab-case names.
- Import SQL with `?raw` so the text is bundled into the Electron main output.
- The current production target is migration version `21`.
- Version `5`, `screening-encounter-identity`, adds the root encounter identity
  constraint `ux_screening_encounters_root_session_patient`.
- Version `6`, `installation-location-configuration`, adds the singleton
  trusted installation-location table and leaves existing installations
  unconfigured until authorized assignment.
- Version `7`, `baseline-active-protocol`, is a data-only compatibility
  migration. It inserts one deterministic baseline `ACTIVE` protocol row only
  when `protocol_versions` is empty, allowing the trusted P1 current-session
  service to create the first daily screening session without manual database
  repair. Existing protocol rows are preserved and are not overwritten,
  reinterpreted, or replaced.
- Version `8`, `screening-vitals-drafts`, adds local offline Vitals draft
  persistence with one draft per encounter and multiple ordered draft readings.
  It preserves all existing data and does not create clinical measurements,
  encounters, sessions, sync transport, or FHIR mappings.
- Version `19`, `sync-transport-foundation`, adds immutable prepared batches,
  batch-item reservations, attempt leases, and protected transport settings.
- Version `20`, `sync-worker-response`, adds immutable response storage,
  reusable retry-history links, and canonical resource mappings.
- Version `21`, `sync-identity-resolution-delivery`, adds central-person links,
  exact durable acknowledgment requests, and immutable reviewer-decision
  delivery evidence.
- Do not export raw SQL through preload, renderer, or shared contracts.

## Checksums

Git enforces LF for `*.sql`. Before hashing, the runner removes at most one
UTF-8 BOM and normalizes CRLF or CR to LF. It does not trim, collapse,
re-indent, minify, or otherwise rewrite migration text for checksum input.

Stored checksums are lowercase 64-character SHA-256 hex strings. Normal logs do
not include SQL text or checksum values.

## Ledger And `user_version`

`PRAGMA user_version` is the fast schema marker. `schema_migrations` is the
auditable history ledger. Both must agree before pending migrations run.

The runner creates `schema_migrations` inside the version-1 migration
transaction:

- `version INTEGER PRIMARY KEY CHECK (version > 0)`
- `name TEXT NOT NULL UNIQUE`
- `checksum TEXT NOT NULL CHECK (length(checksum) = 64)`
- `applied_at TEXT NOT NULL`
- `application_version TEXT NOT NULL`

`application_version` records the app build that applied a migration. It is not
a compatibility key.

## Transaction Sequence

For each pending migration, the runner:

1. Opens `BEGIN IMMEDIATE`.
2. Creates `schema_migrations` when applying version 1 to a version-0 database.
3. Executes the SQL body.
4. Validates the trusted schema contract for that version when one is defined.
5. Inserts the ledger row with injected UTC time and app version.
6. Sets `PRAGMA user_version` to the migration version.
7. Verifies the marker and ledger row.
8. Commits.

If any step fails, the runner attempts one rollback and throws a controlled
migration error. A rollback failure is logged safely and does not replace the
original migration error.

For HSD-007, schema version 1 is validated before migration 1 commits, after
all migrations finish, and on every idempotent current-version startup. The
validator checks the exact non-internal table set, strict mode, exact named
index set, exact table column metadata, `schema_migrations` structure, and
`foreign_keys=ON`.

Version `7` does not change the physical table/index/trigger schema; its
schema validator intentionally delegates to the version-6 structural contract.
Version `8` is the next structural schema contract and adds the Vitals draft
tables and indexes.

## Compatibility Rules

- `user_version=0` with no ledger upgrades to the bundled version.
- Current databases verify the ledger and schema contract and perform no writes.
- Older databases verify existing history before applying pending migrations.
- Databases newer than the bundled manifest are refused.
- `user_version>0` without a ledger is refused.
- `user_version=0` with a ledger is refused.
- Missing, extra, renamed, duplicated, or checksum-mismatched ledger rows are
  refused.

The application never downgrades, deletes, resets, replaces, or auto-repairs an
incompatible production database.

## Adding A Migration

For a future reviewed task:

1. Add one new LF-normalized SQL file under `migrations/sql/`.
2. Append one manifest entry with the next contiguous version.
3. Do not edit earlier SQL files, names, order, or checksums.
4. Add real-file migration tests for fresh, current, prior-version,
   idempotency, rollback, and metadata mismatch behavior.
5. Update schema documentation and acceptance evidence.
