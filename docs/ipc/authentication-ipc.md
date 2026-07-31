# Authentication IPC Boundary

HSD-022 exposes the HSD-021 local authentication session service through fixed
shared contracts, main-process handlers, preload methods, and one
main-to-renderer session-change event. It does not implement the complete login,
password-change, unlock, or application-shell UI; HSD-023 owns that visible
authentication experience.

## Channels

The channel catalog lives in `src/shared/ipc/channels.ts`.

| Operation                              | Channel                                          | Request                                                | Success data                                                  |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| `auth.getSession()`                    | `health-screening:auth:get-session`              | `{}` strict empty object                               | Public session                                                |
| `auth.login(command)`                  | `health-screening:auth:login`                    | `{ username, password }`                               | `ACTIVE`, `PASSWORD_CHANGE_REQUIRED`, or safe `REJECTED` data |
| `auth.changeRequiredPassword(command)` | `health-screening:auth:change-required-password` | `{ currentPassword, newPassword, confirmNewPassword }` | `ACTIVE` or safe `REJECTED` data                              |
| `auth.unlock(command)`                 | `health-screening:auth:unlock`                   | `{ password }`                                         | `ACTIVE` or safe `REJECTED` data                              |
| `auth.lock()`                          | `health-screening:auth:lock`                     | `{}` strict empty object                               | Public session                                                |
| `auth.logout()`                        | `health-screening:auth:logout`                   | `{}` strict empty object                               | `SIGNED_OUT` public session                                   |
| `auth.recordActivity()`                | `health-screening:auth:record-activity`          | `{}` strict empty object                               | `ACTIVE` public session                                       |
| `auth.onSessionChanged(listener)`      | `health-screening:auth:session-changed`          | Main-to-renderer event only                            | Public session                                                |

Renderer callers never provide channel strings. There is no generic invoke,
generic send, wildcard subscription, renderer-selected user ID, renderer-selected
role list, token, cookie, or browser storage.

## Public Session

Renderer-visible session data is intentionally minimized:

- `SIGNED_OUT`: `status`, `revision`.
- `PASSWORD_CHANGE_REQUIRED`: `status`, public user, `expiresAt`, `revision`.
- `ACTIVE`: `status`, public user, `idleExpiresAt`, `absoluteExpiresAt`, `revision`.
- `LOCKED`: `status`, public user, `reason`, `absoluteExpiresAt`, `revision`.

The public user contains only `username`, `displayName`, and `role`.

Public sessions never include local-user IDs, failed-login counters, lockout
persistence fields, login timestamps, row timestamps, `authenticatedAt`,
`lastActivityAt`, `lockedAt`, credentials, password hashes, salts, audit data,
database data, repository objects, or internal session contexts.

`revision` is ordering metadata only. It is never accepted in a request and is
not authentication authority.

## Validation And Mapping

All auth IPC schemas live in `src/shared/ipc/authentication-contracts.ts` and
are safe to import from main, preload, renderer, and tests. Shared code does not
import Electron, Node built-ins, database modules, main services, or password
modules.

Main handlers validate sender frame and URL before request parsing or service
access. Hostile payloads from forbidden senders are not inspected. Requests are
strict own-property objects; symbol keys, accessors, arrays, functions, class
instances, malformed prototypes, hostile proxies, extra fields, and
renderer-supplied authority fields are rejected.

The IPC layer delegates policy to HSD-021. It does not recreate login, password
change, lock, unlock, deadline, stale-result, or role logic.

Expected credential rejections remain successful typed data. Controlled session
exceptions map to fixed auth IPC failure codes such as `AUTH_LOCKED`,
`AUTH_UNAUTHENTICATED`, `AUTH_PASSWORD_CHANGE_REQUIRED`, `AUTH_CONCURRENCY`,
`AUTHORIZATION_FAILED`, or `AUTHENTICATION_UNAVAILABLE`.

Operational logs may include only fixed event text, channel, safe code, and
allowlisted technical error type. They must not include usernames, display
names, passwords, roles, deadlines, revisions, IDs, SQL, database paths, audit
metadata, stacks, causes, raw messages, or request serialization.

## Session Events

`authentication-session-publisher.ts` publishes only validated public sessions
to the configured main window WebContents. It drops missing, destroyed, or
navigation-policy-forbidden targets and never broadcasts to arbitrary windows or
frames.

Preload validates every event payload again and invokes renderer listeners with
only the public session object. The Electron event object is never exposed.
Malformed event payloads are dropped. The returned unsubscribe function is
idempotent.

## Production Composition

Startup creates one production local authentication session service after the
database runtime is initialized. The same instance is reused for every auth IPC
call. Recreating the service per request would reset state to `SIGNED_OUT` and
destroy session authority.

Application IPC handlers are registered before renderer loading. Handler
disposal removes only the application-owned auth channels and publisher
resources.

## Authorization Adapter

`authenticated-handler-authorization.ts` is main-process-only. Future protected
business handlers can combine sender validation with HSD-021 active-session or
role checks. Allowed roles are supplied by main code as compile-time constants;
the renderer never sends allowed roles or a claimed role.
