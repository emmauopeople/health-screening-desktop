# Local User Credential State

HSD-019 adds a main-process-only local-user credential-state mutation boundary
over the existing schema-v1 `users` table. It does not add plaintext password
handling, password hashing, password verification, password policy, forced
password-change orchestration, sessions, IPC, preload APIs, renderer UI, audit
events, migrations, or HSD-020 behavior.

## Snapshot

Credential state is represented as:

- `credential`: a canonical HSD-010 `StoredPasswordCredential`.
- `mustChangePassword`: the persisted forced-change flag.
- `updatedAt`: the row version timestamp.

The repository validates both expected and next snapshots before SQL. Mutation
input and nested snapshots must be exact ordinary data objects. Credentials are
validated through the internal password persistence validator, which returns
only canonical hash and salt strings and clears decoded buffers.

`next.updatedAt` must not be earlier than `expected.updatedAt`.

## Temporal Invariant

Credential rotation advances the shared `users.updated_at` row version while
preserving `failed_login_count`, `locked_until`, and `last_login_at`. To keep
the HSD-018 local-login state contract valid, a preserved non-null
`locked_until` must remain later than `next.updatedAt`.

`updateCredentialState()` reads the authoritative lockout value for the exact
expected credential state inside the caller-owned transaction. If that value is
non-null and `locked_until <= next.updatedAt`, the repository rejects the
rotation with `LocalUserCredentialStateConflictError` and does not modify the
credential, forced-change flag, timestamp, authentication state, or audit log.
Callers that need to rotate after an expired lock must first clear the lock
through HSD-017 `updateAuthenticationState()` in the same transaction or in a
previous committed transaction.

## Mutation

`updateCredentialState(connection, input)` requires an authentic active HSD-008
`DatabaseTransactionConnection` as its first executable check. The repository
does not open, commit, roll back, retry, or nest transactions.

The mutation performs one compare-and-set `UPDATE` and may change only:

- `password_hash`
- `password_salt`
- `must_change_password`
- `updated_at`

The predicate compares the user ID plus the expected hash, salt,
`mustChangePassword`, and `updatedAt`. A successful mutation must affect exactly
one row and returns the ordinary credential-free `LocalUserRecord`.

## Conflicts

Zero changed rows are classified inside the same transaction:

- Missing user: `LocalUserNotFoundError`.
- Existing user with stale credential state or an unsafe preserved lockout
  timestamp: `LocalUserCredentialStateConflictError`.

More than one changed row is `RepositoryDataIntegrityError`. Driver write
failures and post-update readback failures are `RepositoryWriteError`. Malformed
ordinary row fields observed during readback fail closed as
`RepositoryDataIntegrityError`.

## Scope

This repository boundary accepts only pre-derived credentials. HSD-020 is the
expected next reviewed task for the forced password-change application service
and audited credential rotation workflow.
