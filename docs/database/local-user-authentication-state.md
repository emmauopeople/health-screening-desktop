# Local User Authentication State

HSD-017 adds one transaction-scoped persistence boundary for local user
authentication state. It is not a login service and does not verify passwords,
choose lockout policy, write audit events, create sessions, expose IPC, or add
renderer UI.

## State Fields

The mutation is limited to these `users` columns:

- `failed_login_count`
- `locked_until`
- `last_login_at`
- `updated_at`

The repository exposes those fields as `LocalUserAuthenticationStateSnapshot`.
Callers provide one expected snapshot and one requested next snapshot. The
repository validates structure, canonical UUID and UTC timestamp text,
non-negative safe-integer counts, and temporal invariants. It does not generate
IDs or timestamps and does not decide failed-login thresholds, lockout
durations, expired-lock interpretation, or retry policy.

## Compare And Set

`updateAuthenticationState(connection, input)` requires an authentic active
HSD-008 `DatabaseTransactionConnection` before parsing the input. It runs one
`UPDATE` inside the caller-owned transaction and updates only the four
authentication-state columns.

The `WHERE` predicate includes the user ID plus every expected state field.
Nullable timestamp comparison is null-safe:

- expected `lockedUntil = null` matches only persisted `locked_until IS NULL`.
- expected `lockedUntil = <timestamp>` matches only the same persisted text.
- `lastLoginAt` is matched the same way.

Exactly one changed row is success. Zero changed rows are classified inside the
same transaction as either `LocalUserNotFoundError` or
`LocalUserAuthenticationStateConflictError`. More than one changed row is a
controlled data-integrity failure.

## Credential Boundary

The authentication-state mutation never selects credential columns for output,
never changes `password_hash` or `password_salt`, and returns only the ordinary
credential-free `LocalUserRecord`. The separate
`getAuthenticationByUsername()` projection remains the only credential-bearing
local-user repository read.

## Caller Ownership

Later application services own policy and orchestration:

- password verification
- lockout threshold and duration decisions
- timestamps and actor context
- audit event composition
- session creation
- IPC and renderer flows

The repository only persists a caller-approved next state if the caller's
expected snapshot still matches the database.

HSD-018 is the first approved caller of this mutation. The local login
application service verifies passwords before opening the transaction, derives
the next failed-login, lock, and last-login state, revalidates the authoritative
authentication record inside the transaction, and then calls
`updateAuthenticationState()` with the exact expected snapshot. The repository
still does not choose the five-attempt or 15-minute policy and still does not
write audit events.

## Errors

The mutation uses fixed controlled repository errors:

- `RepositoryValidationError` for malformed or hostile input.
- `DatabaseTransactionStateError` for unauthentic, inactive, or expired
  transaction capabilities.
- `LocalUserNotFoundError` for a missing user ID.
- `LocalUserAuthenticationStateConflictError` for stale expected state.
- `RepositoryDataIntegrityError` for malformed persisted rows.
- `RepositoryWriteError` for controlled write or verification-read failures.

Errors omit raw inputs, UUIDs, timestamps, counts, usernames, credential text,
SQL, database paths, row values, and raw driver messages.

## Deferred Work

HSD-017 deliberately leaves login, password verification, lockout policy,
auditing, sessions, forced password change, authorization, administration UI,
IPC, preload, renderer login, sync, backup, restore, printing, and clinical
behavior to later reviewed tasks.
