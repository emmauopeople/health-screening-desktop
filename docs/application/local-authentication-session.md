# Local Authentication Session

HSD-021 adds a main-process-only, single-user, in-memory local authentication
session service. It composes HSD-018 login and HSD-020 forced password change,
keeps only credential-free user identity in memory, and provides the trusted
authorization gate.

HSD-022 exposes that service through reviewed authenticated IPC, preload, and
renderer route-state contracts. The service still creates no renderer-visible
token, cookie, session ID, persisted current user, session table, migration,
background timer, BrowserWindow wiring, or new audit action.

## State Model

The service starts `SIGNED_OUT` every time it is constructed. Application
restart, crash, database close/reopen, or service recreation never restores an
authenticated user.

The in-memory states are:

- `SIGNED_OUT`, with no user or authentication timestamp.
- `PASSWORD_CHANGE_REQUIRED`, with an active credential-free user whose
  `mustChangePassword=true`.
- `ACTIVE`, with an active credential-free user whose
  `mustChangePassword=false`.
- `LOCKED`, with the active user identity, absolute expiry, and lock reason
  `MANUAL` or `IDLE_TIMEOUT`.

Every snapshot and nested user record is copied and frozen before it is
returned. Snapshots contain no password text, stored credential, password hash,
password salt, database handle, repository object, audit metadata, token, or
trusted renderer authority. `revision` is informational only and is not a
bearer token.

## Time Policy

Timeout values are fixed in `local-session-policy.ts` and are exported for
tests and future UI messaging:

- Active idle timeout: `15` minutes.
- Active absolute lifetime: `12` hours.
- Password-change context lifetime: `15` minutes.

There is no background timer. Each public method lazily evaluates deadlines
with the injected `UtcClock` before acting. `ACTIVE` becomes `LOCKED` at
`currentTime >= idleExpiresAt`; `ACTIVE` or `LOCKED` becomes `SIGNED_OUT` at
`currentTime >= absoluteExpiresAt`; `PASSWORD_CHANGE_REQUIRED` becomes
`SIGNED_OUT` at `currentTime >= expiresAt`.

Activity can extend only the idle deadline. It never changes
`authenticatedAt`, never extends the absolute deadline, and cannot revive a
session at or after an expiry boundary.

Clock values must be canonical UTC timestamps. A time earlier than the last
accepted session transition fails closed: any existing session is cleared to
`SIGNED_OUT` and the service raises `LocalSessionStateIntegrityError`.

## Login Handoff

`login(input: unknown)` passes the unknown command unchanged to HSD-018. The
session service does not duplicate username or password parsing and does not
perform password verification itself.

A rejected HSD-018 login leaves the service `SIGNED_OUT` and returns the safe
rejection reason. An authenticated active user with
`mustChangePassword=true` becomes `PASSWORD_CHANGE_REQUIRED`. An authenticated
active user with `mustChangePassword=false` becomes `ACTIVE`.

Login cannot replace an existing `ACTIVE`, `LOCKED`, or
`PASSWORD_CHANGE_REQUIRED` context. Callers must explicitly `logout()` first.

## Forced Password Change Handoff

`changeRequiredPassword(input: unknown)` accepts exactly
`currentPassword`, `newPassword`, and `confirmNewPassword`. It rejects
caller-supplied `userId`. The service injects the trusted user ID from the
current `PASSWORD_CHANGE_REQUIRED` context when calling HSD-020.

On `PASSWORD_CHANGED`, the returned user must be the same user, active, and no
longer require password change before the session promotes to `ACTIVE`.
Expected HSD-020 rejections for invalid current password, account lock, reused
replacement password, or confirmation mismatch keep the original provisional
context until its fixed expiry. Account inactive or password-change-not-required
outcomes clear the session to `SIGNED_OUT`. HSD-020 concurrency or
state-integrity failures also fail closed.

## Lock, Unlock, Logout, And Authorization

`recordActivity()` works only in `ACTIVE` state and is rejected while a
login/change/unlock operation is pending. `lock()` turns `ACTIVE` into
`LOCKED` with reason `MANUAL`; calling it while already locked is idempotent for
the lock timestamp and reason. `logout()` is synchronous, idempotent, returns a
frozen `SIGNED_OUT` snapshot, and invalidates pending authentication-changing
operations.

`unlock(input: unknown)` accepts exactly one `password` field. It uses the
locked user's canonical username when calling HSD-018, so callers cannot supply
a username or user ID. Rejected authentication leaves the session locked. A
successful proof must identify the same user, active, with
`mustChangePassword=false`; otherwise the service clears to `SIGNED_OUT` and
raises a controlled concurrency/state error. A valid unlock establishes a fresh
`ACTIVE` lifetime.

`requireActiveSession()` returns a frozen credential-free context only for
`ACTIVE`. `SIGNED_OUT`, `LOCKED`, and `PASSWORD_CHANGE_REQUIRED` raise fixed
controlled errors. `requireAnyRole(roles)` then validates a non-empty exact
array of unique `LocalUserRole` values and authorizes only against the active
session user's role. Authorization errors do not reveal allowed roles or the
current role.

## Concurrency

Only one authentication-changing operation may be pending: login, required
password change, or unlock. The service records an internal operation ID,
revision, state kind, and trusted user identity where applicable. After every
await, it reevaluates deadlines and verifies that the operation and revision
are still current. Logout, lock, expiry, or another invalidation prevents stale
async results from recreating or replacing session state.

## Errors

HSD-021 exposes controlled errors with fixed messages, stable codes, sanitized
`errorType`, and no stack:

- `LocalSessionValidationError`
- `LocalSessionStateIntegrityError`
- `LocalSessionOperationInProgressError`
- `LocalSessionConcurrencyError`
- `LocalSessionUnauthenticatedError`
- `LocalSessionLockedError`
- `LocalSessionPasswordChangeRequiredError`
- `LocalSessionAuthorizationError`
- `LocalSessionAuthenticationError`
- `LocalSessionCompositionError`

Expected credential rejections from HSD-018 and HSD-020 remain result unions.
Thrown session errors represent malformed session commands, unsafe dependency
results, stale async results, protected operations in the wrong state,
authorization denial, operational authentication failure, or composition
failure.

## Transport Boundary

HSD-022 maps internal session snapshots to a new minimized public session before
data crosses the main/preload boundary. The public shape contains only
`username`, `displayName`, `role`, UI deadlines, lock reason, status, and
revision. It omits user IDs, persistence timestamps, failed-login counters,
credentials, hashes, salts, audit data, database data, and internal contexts.

The HSD-021 service remains the authority for login handoff, forced password
change, lock, unlock, activity, logout, deadlines, stale-result cancellation,
and role authorization. IPC, preload, and renderer code must not reproduce that
policy.

HSD-023 is the next bounded task for the complete login, required password
change, unlock, and authenticated shell UI.
