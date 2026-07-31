# Forced Password Change

HSD-020 adds the main-process forced password-change application service for a
local user who authenticated with a temporary password and still has
`mustChangePassword=true`. It composes the existing installation, local-user,
password credential, transaction, and audit boundaries without adding sessions,
IPC handlers, preload APIs, renderer UI, migrations, password reset, voluntary
password change, or clinical workflow.

HSD-021 owns the local authenticated session handoff. It injects the trusted
temporary-password user ID from a restricted password-change context and
promotes that same user to an active in-memory session only after this service
returns `PASSWORD_CHANGED`.

## Result Contract

`changePassword(input: unknown)` validates hostile input before reading
installation or user state. It returns frozen credential-free results:

- `PASSWORD_CHANGED` with the post-persistence `LocalUserRecord`.
- `REJECTED` with one of:
  `CURRENT_PASSWORD_INVALID`, `ACCOUNT_INACTIVE`, `ACCOUNT_LOCKED`,
  `PASSWORD_CHANGE_NOT_REQUIRED`, `NEW_PASSWORD_REUSES_CURRENT_PASSWORD`, or
  `NEW_PASSWORD_CONFIRMATION_MISMATCH`.

Rejected results contain no username, display name, role, credential, audit
data, failed-attempt details, or lockout counters. `retryAt` is non-null only
for `ACCOUNT_LOCKED`.

## Validation

The command must be an ordinary object with `Object.prototype` or a null
prototype and exactly four own string-keyed data properties: `userId`,
`currentPassword`, `newPassword`, and `confirmNewPassword`. Arrays, functions,
class instances, inherited values, symbol keys, accessors, extra keys, and
hostile proxy failures are rejected as
`LocalForcedPasswordChangeValidationError`.

`userId` uses the main-process entity-id parser. Password fields use the
HSD-010 plaintext-password parser and preserve the exact password strings. The
service does not trim, normalize, lowercase, log, serialize, or persist
plaintext passwords.

`NEW_PASSWORD_CONFIRMATION_MISMATCH` is returned immediately after validation
when `newPassword` and `confirmNewPassword` differ. That path opens no
transaction, reads no repository state, performs no password verification or
hashing, and writes no audit event.

## Decision Flow

The user ID is a trusted main-process boundary only after the service resolves
the local user by ID, then resolves the credential-bearing authentication
projection by the canonical username from that user. Both records must refer to
the same user ID. Missing installation, missing trusted user state, or missing
credential-bearing state makes the service unavailable; mismatched records fail
closed as concurrency or integrity errors.

The service evaluates the HSD-018 local-login policy before password
verification. An active lock returns `ACCOUNT_LOCKED`, skips password
verification and hashing, does not extend the lock, and audits the locked
attempt. Expired locks are treated by the HSD-018 policy as retryable state and
may be cleared by a later authenticated success path.

When no active lock exists, the service verifies `currentPassword` outside the
SQLite transaction. Invalid current passwords for active users persist the
HSD-017 failed-attempt transition and audit the finalized result. Invalid
current passwords for inactive users audit the invalid-current outcome without
mutating authentication state.

Only after the current password is proven does the service reveal
`ACCOUNT_INACTIVE`, `PASSWORD_CHANGE_NOT_REQUIRED`, or
`NEW_PASSWORD_REUSES_CURRENT_PASSWORD`. Reuse detection verifies `newPassword`
against the current stored credential. A reused password is rejected before any
replacement hash is created.

## Transaction Flow

Replacement credential hashing completes before
`DatabaseTransactionExecutor.run()` opens the synchronous SQLite transaction.
The service then validates the replacement credential through
`PasswordCredentialService.validateCredential()` before exact hash/salt
comparison, before verifying `newPassword` against the replacement, and before
verifying `currentPassword` against the replacement. Malformed, noncanonical, or
semantically inconsistent replacement credentials fail as
`LocalForcedPasswordChangeHashingError` and open no transaction.
Inside the callback, the service revalidates the installation, user identity,
ordinary user fields, credential hash, credential salt, forced-change flag,
failed-login count, lock timestamp, last-login timestamp, and `updatedAt`
against the pre-verification observation.

The successful transaction writes in this order:

- HSD-017 `updateAuthenticationState()` resets `failedLoginCount=0`, clears
  `lockedUntil`, preserves `lastLoginAt`, and sets `updatedAt` to the
  transaction time.
- HSD-019 `updateCredentialState()` replaces the stored credential, changes
  `mustChangePassword` from `true` to `false`, and keeps the same transaction
  timestamp as the row version.
- HSD-013 `insert()` appends the success audit event.

If any compare-and-set predicate, policy invariant, credential invariant, or
audit insert fails, the transaction rolls back and the service returns no
partially applied password-change result.

## Audit Events

Each finalized outcome writes exactly one audit event in the same transaction
as any state mutation:

| Outcome             | Action                                                    | userId  | entityType   | entityId |
| ------------------- | --------------------------------------------------------- | ------- | ------------ | -------- |
| Password changed    | `LOCAL_PASSWORD_CHANGE_SUCCEEDED`                         | user ID | `LOCAL_USER` | user ID  |
| Invalid current     | `LOCAL_PASSWORD_CHANGE_REJECTED_INVALID_CURRENT_PASSWORD` | `null`  | `LOCAL_USER` | user ID  |
| Account locked      | `LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_LOCKED`           | `null`  | `LOCAL_USER` | user ID  |
| Account inactive    | `LOCAL_PASSWORD_CHANGE_REJECTED_ACCOUNT_INACTIVE`         | `null`  | `LOCAL_USER` | user ID  |
| Change not required | `LOCAL_PASSWORD_CHANGE_REJECTED_NOT_REQUIRED`             | user ID | `LOCAL_USER` | user ID  |
| Reused password     | `LOCAL_PASSWORD_CHANGE_REJECTED_REUSED_PASSWORD`          | user ID | `LOCAL_USER` | user ID  |

Audit metadata is limited to safe lowercase snake-case keys:

- `outcome`
- `forced_change_completed`, present as `true` only on success
- `failed_login_count`
- `lock_applied`
- `retry_at`
- `role`

Metadata never includes usernames, display names, plaintext passwords, password
hashes, salts, raw commands, SQL, database paths, device data, or exception
text.

## Errors

HSD-020 exposes controlled errors with fixed messages, stable codes, sanitized
`errorType`, and no stack:

- `LocalForcedPasswordChangeValidationError`
- `LocalForcedPasswordChangeUnavailableError`
- `LocalForcedPasswordChangeStateIntegrityError`
- `LocalForcedPasswordChangeConcurrencyError`
- `LocalForcedPasswordChangeVerificationError`
- `LocalForcedPasswordChangeHashingError`
- `LocalForcedPasswordChangePersistenceError`
- `LocalForcedPasswordChangeCompositionError`

Expected password-change rejections are returned as results, not thrown errors.
Thrown errors represent malformed input, unavailable setup, inconsistent state,
stale observations, password verification failure, password hashing failure,
persistence failure, or production composition failure.
