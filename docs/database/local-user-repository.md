# Local User Repository

HSD-011 adds a main-process-only typed repository over the schema-v1 `users`
table. HSD-017 extends that repository with a narrow transaction-scoped
authentication-state mutation. HSD-019 adds a narrow transaction-scoped
credential-state mutation. It does not add login, password verification,
password hashing, password policy, lockout policy, audited credential rotation,
sessions, account administration, IPC, renderer UI, startup writes, or clinical
workflow behavior.

## Table Mapping

The repository owns explicit SQL for the existing `users` table and does not
change migrations or schema contracts. Ordinary user records map these columns:

- `id`
- `username`
- `username_normalized`
- `display_name`
- `role`
- `is_active`
- `must_change_password`
- `failed_login_count`
- `locked_until`
- `last_login_at`
- `created_at`
- `updated_at`

Ordinary `hasAny`, `getById`, and `getByUsername` operations do not select
`password_hash` or `password_salt`. `getAuthenticationByUsername` is the only
credential-bearing projection and remains in the trusted main process.

## Username Identity

Usernames are parsed from unknown input by applying Unicode NFKC, trimming, and
then enforcing a reviewed ASCII identifier rule. A canonical username must be 3
through 64 characters, contain only ASCII letters, digits, period, underscore,
or hyphen, and start and end with an ASCII letter or digit.

The normalized uniqueness key is always derived from the canonical username by
ASCII lowercasing. Callers never provide `username_normalized` directly. Row
decoding recomputes the normalized key and rejects persisted rows whose stored
key differs.

## Display Names

Display names are separate from login identity. They are normalized with NFKC,
trimmed, and have internal Unicode whitespace runs collapsed to one ASCII space.
They must be 1 through 120 Unicode code points and must not contain controls,
line separators, paragraph separators, null bytes, or unpaired surrogate units.

## Inserts

`insert()` requires an authentic active HSD-008
`DatabaseTransactionConnection` as its first executable check. The repository
does not open, commit, roll back, retry, or nest transactions.

New rows explicitly set:

- `is_active = 1`
- `failed_login_count = 0`
- `locked_until = NULL`
- `last_login_at = NULL`

The caller supplies the already validated entity ID, canonical username,
display name, pre-derived credential, role, `mustChangePassword`, and matching
`createdAt`/`updatedAt` timestamps. Duplicate IDs or normalized usernames fail
with `LocalUserAlreadyExistsError`.

## Authentication State Mutation

`updateAuthenticationState()` requires an authentic active HSD-008
`DatabaseTransactionConnection` as its first executable check. The caller
supplies a user ID, an expected authentication-state snapshot, and a requested
next snapshot.

The mutation performs one compare-and-set `UPDATE` and may change only:

- `failed_login_count`
- `locked_until`
- `last_login_at`
- `updated_at`

All expected fields participate in stale-state detection, including null-safe
matching for `locked_until` and `last_login_at`. A missing user fails with
`LocalUserNotFoundError`; an existing user whose authentication state no longer
matches fails with `LocalUserAuthenticationStateConflictError`.

The next state must use a non-negative safe integer failed-login count,
canonical UTC timestamps, a nondecreasing `updatedAt`, a nondecreasing
`lastLoginAt`, and a non-null `lockedUntil` later than `updatedAt`. The
repository validates those persistence invariants only; later application
services decide password verification, thresholds, lock durations, and audit
events.

## Credential State Mutation

`updateCredentialState()` requires an authentic active HSD-008
`DatabaseTransactionConnection` as its first executable check. The caller
supplies a user ID, an expected credential-state snapshot, and a requested next
snapshot.

The mutation performs one compare-and-set `UPDATE` and may change only:

- `password_hash`
- `password_salt`
- `must_change_password`
- `updated_at`

The compare-and-set predicate matches the user ID plus the expected hash, salt,
`mustChangePassword`, and `updatedAt`. A missing user fails with
`LocalUserNotFoundError`; an existing user whose credential state no longer
matches fails with `LocalUserCredentialStateConflictError`.

The next state must contain a canonical pre-derived HSD-010 credential, a
boolean forced-change flag, and a canonical UTC `updatedAt` that is not earlier
than the expected row version. Because this mutation preserves authentication
state, any preserved non-null `locked_until` must remain later than
`next.updatedAt`. If the authoritative row has `locked_until <= next.updatedAt`,
the repository rejects the rotation with `LocalUserCredentialStateConflictError`
without modifying credentials, the forced-change flag, timestamps,
authentication state, or audit rows. Callers must clear an expired lock through
HSD-017 before rotating credentials. The repository validates those persistence
invariants only; HSD-020 is expected to add the application service that hashes
new passwords before the transaction, composes audit events, and drives the
forced password-change workflow.

## Credential Handling

The repository accepts only an HSD-010 `StoredPasswordCredential`. It never
accepts plaintext, hashes passwords, verifies passwords, compares credentials,
or exposes decoded key material.

Before writing or returning an authentication projection, the repository uses
the internal password persistence validator to prove credential text is
canonical. That helper returns only canonical strings and clears decoded salt
and derived-key buffers before it returns or throws.

Authentication-state updates do not select, update, return, or serialize
`password_hash` or `password_salt`. They return the ordinary credential-free
`LocalUserRecord`.

Credential-state updates write `password_hash` and `password_salt` only from a
validated stored credential and return the ordinary credential-free
`LocalUserRecord`. The post-update readback uses the ordinary credential-free
column list.

## Errors

Rows and inputs are decoded from `unknown` and fail closed through controlled
errors. Repository errors use fixed messages and omit stacks, causes, SQL,
paths, usernames, display names, UUIDs, timestamps, hashes, salts, row values,
constraint names, and raw driver messages.

Malformed ordinary row fields produce `RepositoryDataIntegrityError`. Malformed
credential fields in the authentication projection also produce
`RepositoryDataIntegrityError`; ordinary credential-free reads may still succeed
when only credential columns are corrupt. Stale authentication-state writes are
reported separately from missing users so later services can make safe policy
decisions without inspecting SQL results. Stale credential-state writes are
likewise reported separately from missing users.

## Deferred Behavior

HSD-019 still deliberately defers plaintext password handling, password
hashing, password verification, password policy, forced password-change
application service behavior, audited credential rotation, sessions,
authorization, user administration, sync writes, IPC, preload, renderer routes,
and UI. HSD-020 is the likely next reviewed task for forced password change and
audited credential rotation.
