# Screening Session Repository Boundary

HSD-027 checkpoint B adds focused database repositories for screening-session current state and lifecycle history. The repository boundary does not create application policy; it only validates caller inputs, decodes trusted rows, and performs transaction-scoped writes.

## Current State and Lifecycle History

`screening_sessions` stores the current session state: location, protocol version, session date, status, open/close timestamps, actor columns, notes, and `row_version`.

`screening_session_lifecycle_history` stores append-only lifecycle transitions. Session creation inserts a `CREATED` row with resulting row version `1`. Successful close and reopen writes append `CLOSED` and `REOPENED` rows with consecutive prior/resulting row versions.

The repository exposes no update or delete method for lifecycle history.

## Compare-And-Set Transitions

`close` and `reopen` use compare-and-set updates:

- session ID must match;
- expected row version must match;
- current status must match the allowed transition.

If no row is changed, the repository reads the latest row through the same transaction connection and returns one of:

- `NOT_FOUND`;
- `SESSION_VERSION_CONFLICT`;
- `ALREADY_CLOSED` or `ALREADY_OPEN`.

Only successful transitions append lifecycle history. Repeated close or reopen calls do not append additional history.

## Row Versions

Creation starts at row version `1`. Every successful close or reopen increments the row version exactly once and writes the same resulting version to lifecycle history.

## Location and Date Uniqueness

The database enforces one screening session per location/date through `ux_screening_sessions_location_date`. The repository classifies only that constraint as `ScreeningSessionAlreadyExistsError`.

Multiple locations may have `OPEN` sessions on the same date. There is no global one-open-session uniqueness rule.

## Transaction Ownership

Repository write methods require an active `DatabaseTransactionConnection`. They do not begin, commit, roll back, or create savepoints. `DatabaseTransactionExecutor.run` owns transaction lifetime.

The repository also adds transaction-scoped reference reads for locations and protocol versions so checkpoint C can make application decisions inside one `BEGIN IMMEDIATE` transaction.

## Checkpoint C Boundary

Checkpoint C owns:

- authorization;
- active-location and active-protocol policy;
- deployment-local date policy;
- audit event orchestration;
- sync outbox orchestration;
- user-facing service result mapping.

No IPC, preload, renderer, encounter, measurement, referral, report, or protocol-calculation behavior is implemented by this repository checkpoint.
