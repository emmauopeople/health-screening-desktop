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
- HSD-007 production contains only version `1`, `initial-schema`.
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
4. Inserts the ledger row with injected UTC time and app version.
5. Sets `PRAGMA user_version` to the migration version.
6. Verifies the marker and ledger row.
7. Commits.

If any step fails, the runner attempts one rollback and throws a controlled
migration error. A rollback failure is logged safely and does not replace the
original migration error.

## Compatibility Rules

- `user_version=0` with no ledger upgrades to the bundled version.
- Current databases verify the ledger and perform no writes.
- Older databases verify existing history before applying pending migrations.
- Databases newer than the bundled manifest are refused.
- `user_version>0` without a ledger is refused.
- `user_version=0` with a ledger is refused.
- Missing, extra, renamed, duplicated, or checksum-mismatched ledger rows are
  refused.

The application never downgrades, deletes, resets, replaces, or auto-repairs an
incompatible production database.

## Adding `0002`

For a future reviewed task:

1. Add one new LF-normalized SQL file under `migrations/sql/`.
2. Append one manifest entry with the next contiguous version.
3. Do not edit earlier SQL files, names, order, or checksums.
4. Add real-file migration tests for fresh, current, prior-version,
   idempotency, rollback, and metadata mismatch behavior.
5. Update schema documentation and acceptance evidence.
