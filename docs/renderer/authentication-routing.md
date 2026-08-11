# Authentication Routing

HSD-022 adds a renderer-side route-state boundary after first-run setup is
complete. HSD-023 keeps that boundary and renders the complete local
authentication experience from it. The renderer consumes only
`window.healthScreening.auth` and maps public session snapshots into safe route
states.

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
HSD-023 also exposes `acceptSession(session)` for successful operation results
and `reconcile()` for deadline, focus, visibility, and wrong-state observations.
Forbidden operation failures use the controller to transition to a nonretryable
`AUTH_UNAVAILABLE` route so the previous identity is not left visible.

The controller uses a generation guard so stale load results and stale callbacks
cannot mutate the current route. Within one generation, lower-revision events
are ignored. Revision is not sent back to main and is never treated as a bearer
token.

Load failures map to `AUTH_UNAVAILABLE` with fixed local text. `IPC_FORBIDDEN`
is non-retryable; other failures are retryable metadata for the UI. Reconcile
failures preserve the latest valid route when a valid session was already
observed.

## App Integration

When first-run state is not `SETUP_COMPLETE`, the HSD-016 behavior is unchanged.
After setup completes, `App.tsx` mounts the authentication route controller and
renders `AuthenticationExperience`.
The component defers final controller disposal across the immediate React
development Strict Mode effect replay and cancels that disposal when the same
controller is remounted. A real unmount or API-controller replacement still
disposes the owned subscription. This prevents the startup route from remaining
indefinitely in `AUTH_LOADING` after the first replay cleanup marks the
controller disposed.

`AuthenticationExperience` selects one concrete screen for loading,
unavailable, login, required password change, locked session, or active session.
Login, password-change, and unlock screens use uncontrolled credential fields
and submit exact typed requests through preload. The active route renders only
the authenticated shell foundation with lock and sign-out controls; it does not
add clinical navigation.

## Renderer Boundary

Authentication renderer files may import only renderer modules and shared IPC
types. They must not import Electron, Node built-ins, `@main`, `@preload`,
database modules, password modules, or repositories.

The route controller and HSD-023 renderer screens must not use `localStorage`,
`sessionStorage`, IndexedDB, cookies, URL state, files, network APIs, dynamic
IPC channels, or direct Electron access.

Renderer deadline and activity helpers are advisory. They observe public
deadlines, focus, visibility, and approved user-activity events so they can ask
HSD-021 to re-evaluate the session. They never decide authoritative expiry and
use no background interval. The active-session activity reporter is keyed only
to entering or leaving `SESSION_ACTIVE`, not to active revision changes, so the
60-second throttle survives successful activity refreshes.
