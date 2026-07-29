# Local User Repository

HSD-011 adds a main-process-only typed repository over the schema-v1 `users`
table. It does not add login, first-run setup, sessions, account administration,
IPC, renderer UI, startup writes, or clinical workflow behavior.

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

## Credential Handling

The repository accepts only an HSD-010 `StoredPasswordCredential`. It never
accepts plaintext, hashes passwords, verifies passwords, compares credentials,
or exposes decoded key material.

Before writing or returning an authentication projection, the repository uses
the internal password persistence validator to prove credential text is
canonical. That helper returns only canonical strings and clears decoded salt
and derived-key buffers before it returns or throws.

## Errors

Rows and inputs are decoded from `unknown` and fail closed through controlled
errors. Repository errors use fixed messages and omit stacks, causes, SQL,
paths, usernames, display names, UUIDs, timestamps, hashes, salts, row values,
constraint names, and raw driver messages.

Malformed ordinary row fields produce `RepositoryDataIntegrityError`. Malformed
credential fields in the authentication projection also produce
`RepositoryDataIntegrityError`; ordinary credential-free reads may still succeed
when only credential columns are corrupt.

## Deferred Behavior

HSD-011 deliberately defers first-run orchestration, user administration, login,
lockout, failed-login counters, last-login updates, password changes, sessions,
authorization, audit writes, sync writes, IPC, preload, renderer routes, and UI.
