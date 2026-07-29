# ADR-004: Numbered SQL Migrations

## Status

Accepted for HSD-007.

## Context

HSD-006 created a hardened, file-backed SQLite runtime, but it intentionally left
the database at `user_version=0` with no application tables. HSD-007 needs a
package-safe way to upgrade fresh and existing HSD-006 databases to schema
version 1 before IPC handlers or the renderer can start.

The migration mechanism must work in development, preview, and packaged Windows
execution without reading repository-relative files or a writable installation
directory. It also needs to detect historical edits to released migrations.

## Decision

The main process owns an explicit numbered SQL migration manifest. Each entry is
listed in source order, imported as a Vite raw asset, and validated before any
transaction starts. HSD-007 ships exactly one production migration:

- `0001-initial-schema.sql` as version `1`, name `initial-schema`

Migration text is canonicalized by removing at most one UTF-8 BOM and
normalizing CRLF or CR to LF before SHA-256 hashing. The repository enforces LF
for `*.sql` through `.gitattributes`.

The runner coordinates `PRAGMA user_version` with a strict
`schema_migrations` ledger. Each pending migration runs in its own
`BEGIN IMMEDIATE` transaction. The SQL body, ledger insert, and `user_version`
update commit together or roll back together.

## Consequences

Released migrations are immutable. A future schema change must add
`0002-*.sql`, append one manifest entry, and keep version numbers positive,
unique, ordered, and contiguous.

Startup refuses incompatible history, checksum or name mismatches, malformed
metadata, and databases newer than the bundled manifest. The application does
not downgrade, reset, delete, or repair production databases automatically.

The renderer and preload boundary remains unchanged. SQL text, checksums,
database paths, schema details, connection objects, and raw SQLite errors stay
inside the trusted main process.

## Rejected Alternatives

- ORM-managed schema changes: rejected because generated SQL, implicit metadata,
  and dependency behavior would add review surface before repositories exist.
- Runtime directory scanning: rejected because file enumeration order and ASAR
  packaging are fragile compared with an explicit bundled manifest.
- Code-first startup mutation without a ledger: rejected because
  `user_version` alone cannot prove historical source immutability.
- Destructive recreation or automatic repair: rejected because local clinical
  data safety requires refusing unsafe states rather than guessing.
- Synchronization-driven schema creation: rejected because HSD-007 has no
  central service, transport, or sync worker.
