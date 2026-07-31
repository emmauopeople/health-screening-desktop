# Authentication Routing

HSD-022 adds a renderer-side route-state boundary after first-run setup is
complete. It consumes only `window.healthScreening.auth` and maps public session
snapshots into safe renderer route states.

## Route States

`src/renderer/src/app/authentication/authentication-route-types.ts` defines:

- `AUTH_LOADING`
- `LOGIN_REQUIRED`
- `PASSWORD_CHANGE_REQUIRED`
- `SESSION_ACTIVE`
- `SESSION_LOCKED`
- `AUTH_UNAVAILABLE`

The route state contains only public session data: public user identity,
deadlines needed for UI, lock reason, and revision. It never stores passwords,
commands, credentials, user IDs, hashes, salts, audit metadata, database data,
tokens, cookies, or internal session snapshots.

## Controller

`createRendererAuthenticationRouteController` calls `auth.getSession()` once per
route-load generation and subscribes to `auth.onSessionChanged()`. It disposes
the subscription when the generation is replaced or the component unmounts.

The controller uses a generation guard so stale load results and stale callbacks
cannot mutate the current route. Within one generation, lower-revision events
are ignored. Revision is not sent back to main and is never treated as a bearer
token.

Load failures map to `AUTH_UNAVAILABLE` with fixed local text. `IPC_FORBIDDEN`
is non-retryable; other failures are retryable metadata for the later UI.

## App Integration

When first-run state is not `SETUP_COMPLETE`, the HSD-016 behavior is unchanged.
After setup completes, `App.tsx` mounts the authentication route controller and
renders `AuthenticationRoutePlaceholder`.

The placeholders are intentionally noninteractive. They provide accessible
status for signed-out, password-change-required, locked, active, loading, and
unavailable states. They do not include credential fields, login buttons,
unlock buttons, password-change forms, clinical navigation, or shell workflows.

HSD-023 will replace these placeholders with the complete authentication UI.

## Renderer Boundary

Authentication renderer files may import only renderer modules and shared IPC
types. They must not import Electron, Node built-ins, `@main`, `@preload`,
database modules, password modules, or repositories.

The route controller must not use `localStorage`, `sessionStorage`, IndexedDB,
cookies, URL state, files, network APIs, dynamic IPC channels, or direct
Electron access.
