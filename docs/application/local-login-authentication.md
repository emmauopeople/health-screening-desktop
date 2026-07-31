# Local Login Authentication

HSD-018 adds the main-process local login decision boundary. It authenticates a
username and password against the local user authentication projection, applies
the reviewed lockout policy, persists any authentication-state outcome through
the HSD-017 compare-and-set repository method, and writes one security audit
event in the same SQLite transaction.

This service does not create sessions, authorization context, IPC handlers,
preload APIs, renderer login UI, password reset behavior, role administration,
schema migrations, synchronization, or clinical workflow. HSD-020 owns the
separate forced password-change flow for authenticated temporary-password users.

## Result Contract

`authenticate(input: unknown)` validates hostile input before reading
installation or user state. It returns frozen credential-free results:

- `AUTHENTICATED` with the post-persistence `LocalUserRecord`.
- `REJECTED` with `INVALID_CREDENTIALS`, `ACCOUNT_INACTIVE`, or
  `ACCOUNT_LOCKED`.

Rejected results contain no user ID, username, display name, role,
failed-attempt count, credential, or audit data. `retryAt` is non-null only for
an active lock or the fifth failed attempt that applies a new lock.

Unknown usernames and incorrect passwords both return `INVALID_CREDENTIALS`.
A correct password for an inactive account returns `ACCOUNT_INACTIVE`. Attempts
against an active lock return `ACCOUNT_LOCKED` without password verification.
An active account that authenticates with `mustChangePassword=true` still
returns `AUTHENTICATED`; the returned credential-free `LocalUserRecord` carries
that flag so HSD-021 can establish a restricted password-change context and
coordinate HSD-020 without accepting a renderer-selected user ID.

## Validation

The command must be an ordinary object with `Object.prototype` or a null
prototype and exactly two own string-keyed data properties: `username` and
`password`. Arrays, functions, class instances, inherited values, symbol keys,
accessors, extra keys, and hostile proxy failures are rejected as
`LocalLoginValidationError`.

Username parsing uses the existing canonical local-user username parser.
Password parsing uses the HSD-010 plaintext-password parser and preserves the
exact password string; the service does not trim, normalize, lowercase, log,
serialize, or persist the plaintext password.

## Lockout Policy

The policy is deterministic:

- Maximum consecutive failed attempts: `5`.
- Lock duration: `15` minutes.
- Valid counters: `0` through `5`.
- Counts `0` through `4` must have `lockedUntil=null`.
- Count `5` must have a non-null `lockedUntil`, active or expired.
- An active lock is `lockedUntil > current UTC time`.
- An expired lock is `lockedUntil <= current UTC time`.
- `lastLoginAt`, when present, must be equal to or earlier than `updatedAt`.
- `lockedUntil`, when present, must be later than `updatedAt`.
- Policy evaluation time must be equal to or later than the persisted
  `updatedAt`.

Wrong passwords increment the effective failed count. If an expired lock is
observed, the effective prior count is `0`. The fifth wrong password sets
`failedLoginCount=5` and `lockedUntil=transactionTime + 15 minutes`.

Successful active-user login resets `failedLoginCount=0`, clears
`lockedUntil`, and sets `lastLoginAt=updatedAt=transactionTime`.

Attempts during an active lock preserve `failedLoginCount`, `lockedUntil`, and
`lastLoginAt`, set only `updatedAt=transactionTime`, and never extend the lock.
Invalid persisted policy combinations or timestamp orderings fail closed with
`LocalLoginStateIntegrityError`; the service does not silently repair them or
defer them to repository validation.

## Transaction Flow

Password verification is asynchronous and always occurs before
`DatabaseTransactionExecutor.run()`. Unknown usernames verify against a
composition-time private dummy credential to reduce timing differences, and the
boolean result is discarded.

The synchronous transaction callback then re-reads and revalidates the
installation and authentication record before any write. It compares the
pre-verification observation with the transaction-time record for installation
ID, resolved/missing user status, user ID, canonical username, password hash,
password salt, activation state, failed-login count, lock timestamp,
last-login timestamp, and `updatedAt`.

If those values changed, the service throws `LocalLoginConcurrencyError`, writes
no audit event, and mutates no authentication state. The HSD-017
`updateAuthenticationState()` compare-and-set predicate remains mandatory for
every authentication-state mutation.

## Audit Events

Each finalized attempt writes exactly one audit event in the same transaction
as any state mutation:

| Outcome                               | Action                                     | userId  | entityType       | entityId |
| ------------------------------------- | ------------------------------------------ | ------- | ---------------- | -------- |
| Authenticated                         | `LOCAL_LOGIN_SUCCEEDED`                    | user ID | `LOCAL_USER`     | user ID  |
| Invalid credentials, resolved user    | `LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS` | `null`  | `LOCAL_USER`     | user ID  |
| Invalid credentials, unknown username | `LOCAL_LOGIN_REJECTED_INVALID_CREDENTIALS` | `null`  | `AUTHENTICATION` | `null`   |
| Inactive account                      | `LOCAL_LOGIN_REJECTED_ACCOUNT_INACTIVE`    | `null`  | `LOCAL_USER`     | user ID  |
| Account locked                        | `LOCAL_LOGIN_REJECTED_ACCOUNT_LOCKED`      | `null`  | `LOCAL_USER`     | user ID  |

Audit metadata is limited to lowercase snake-case keys:

- `outcome`
- `user_resolved` for invalid-credential events
- `failed_login_count` for resolved failed or locked outcomes
- `lock_applied` for locked outcomes
- `retry_at` for locked outcomes
- `must_change_password` and `role` for successful outcomes

Metadata never includes usernames, display names, plaintext passwords, password
hashes, salts, raw commands, SQL, database paths, device data, or exception
text.

## Errors

HSD-018 exposes controlled errors with fixed messages, stable codes, sanitized
`errorType`, and no stack:

- `LocalLoginValidationError`
- `LocalLoginUnavailableError`
- `LocalLoginStateIntegrityError`
- `LocalLoginConcurrencyError`
- `LocalLoginVerificationError`
- `LocalLoginPersistenceError`
- `LocalLoginCompositionError`

Expected login rejections are returned as results, not thrown errors. Thrown
errors represent malformed input, unavailable setup, corrupted state, stale
observations, operational password-verification failure, persistence failure,
or production composition failure.

## Deferred Work

HSD-021 consumes this service to create in-memory main-process session state.
Refresh tokens, IPC exposure, preload methods, renderer login UI, voluntary
password change, password reset, user administration, multi-factor
authentication, synchronization, backup, restore, and clinical workflow remain
deferred to later reviewed tasks.
