# Schema Version 4: Screening Session Lifecycle Foundation

Schema version 4 prepares screening sessions for lifecycle-aware repository and
application-service work. It does not implement screening encounters,
measurements, protocol evaluation, referrals, IPC, preload APIs, or renderer UI.

## Current State and History

`screening_sessions` remains the current-state table for one dated session at
one location. Version 4 rebuilds the table with lifecycle-ready columns:

- `notes`
- `opened_by`
- `updated_by`
- `row_version`

It also enforces the current status shape:

- `OPEN` sessions do not have close metadata.
- `CLOSED` sessions must have `closed_by` and `closed_at`.
- `row_version` is a positive integer.

`screening_session_lifecycle_history` is the append-only lifecycle history
table. It records `CREATED`, `CLOSED`, and `REOPENED` transitions with the
actor, timestamp, prior row version, resulting row version, and optional
transition reason. Reopen reasons are represented in lifecycle history rather
than on the current-state row.

## Legacy Mapping

Existing valid `OPEN` rows migrate as:

- `opened_by = created_by`
- `notes = NULL`
- `closed_by = NULL`
- `closed_at = NULL`
- `updated_by = created_by`
- `row_version = 1`
- one `CREATED` lifecycle-history row with `resulting_row_version = 1`

Existing valid `CLOSED` rows migrate as:

- `opened_by = created_by`
- `notes = NULL`
- `closed_by` and `closed_at` are preserved
- `updated_by = closed_by`
- `row_version = 2`
- one `CREATED` lifecycle-history row with `resulting_row_version = 1`
- one `CLOSED` lifecycle-history row with prior/resulting versions `1 -> 2`

Migrated lifecycle-history rows receive migration-generated canonical lowercase
UUID v4 identifiers. The migration does not use patient/session values inside
free-form ID prefixes.

Malformed legacy rows fail the migration atomically instead of being coerced
into misleading lifecycle state.

## Session Uniqueness

Version 4 preserves the existing one-session-per-location/date rule through
`ux_screening_sessions_location_date`.

It does not add a global one-open-session constraint. Multiple locations may
have `OPEN` sessions concurrently.

## Scope

This schema checkpoint only adds database structure and compatibility checks.
Repository methods, application services, authorization, audit writes, outbox
writes, IPC channels, preload methods, and renderer state remain future
checkpoints.
