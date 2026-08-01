# Authentication Experience

HSD-023 completes the renderer-visible local authentication experience after
first-run setup. It consumes only the fixed `window.healthScreening.auth`
preload API and the public session route state from HSD-022.

## Screens

The renderer maps the current authentication route to one concrete screen:

- `AUTH_LOADING` renders a noninteractive loading state.
- `AUTH_UNAVAILABLE` renders fixed local guidance with retry when the failure is
  retryable and an exit action.
- `LOGIN_REQUIRED` renders an uncontrolled username and password form.
- `PASSWORD_CHANGE_REQUIRED` renders the public user summary and required
  password-change form.
- `SESSION_LOCKED` renders the public user summary, lock reason, unlock form,
  and sign-out action.
- `SESSION_ACTIVE` renders the authenticated shell foundation with the public
  user summary, role label, lock action, and sign-out action.

The authenticated shell is intentionally limited to account status and session
controls. It does not add clinical navigation, screening workflows, routing
trees, synchronization, or network behavior.

## Credential Handling

Authentication password inputs are uncontrolled DOM form controls. Submit
handlers read `FormData` only when the user submits, build exact typed preload
requests, and clear password inputs after completed attempts. They do not trim,
normalize, lowercase, compose, store, log, or persist password values.

Renderer form validation covers ordinary required-field and confirmation-match
checks, plus native 12-128 character password length hints. The
HSD-010-compatible transport policy remains owned by shared IPC schemas and
preload/main validation.

Required password-change guidance visibly states that replacement passwords
must use 12-128 characters, avoid control characters, and differ from the
current password.

Expected credential rejections are treated as successful typed result data and
mapped to fixed renderer messages. Controlled failure envelopes are classified
separately from message mapping so forbidden failures hide the current route,
uncertain or state-changing failures reconcile once, and validation or
operation-in-progress failures keep the current screen. Raw errors, stacks,
database details, and credential material are not rendered.

## Session Observation

`RendererAuthenticationRouteController` owns the renderer route state. HSD-023
adds direct session acceptance and reconciliation so successful operations,
session-change events, lazy deadline observations, and wrong-state results all
flow through the same revision guard.

The renderer observes public session deadlines only as advisory UI timing:

- `PASSWORD_CHANGE_REQUIRED` schedules one reconciliation at `expiresAt`.
- `SESSION_ACTIVE` schedules one reconciliation at the earlier of
  `idleExpiresAt` and `absoluteExpiresAt`.
- `SESSION_LOCKED` schedules one reconciliation at `absoluteExpiresAt`.

The runtime also reconciles on window focus and document visibility returning
to visible for deadline-bearing routes. It uses no background interval and does
not decide authoritative expiry; HSD-021 remains the authority.

## Activity Reporting

While the route is `SESSION_ACTIVE`, the renderer listens for `pointerdown`,
`keydown`, `touchstart`, and `wheel` with passive handlers. It intentionally
does not listen to `mousemove`.

The first activity is reported promptly. Later events are throttled to one
`auth.recordActivity()` call per 60 seconds, with a single trailing report
coalesced when activity happens during the throttle window or while a call is
in flight. The reporter stays mounted across ordinary `ACTIVE` revision changes
so a successful `recordActivity()` result cannot reset the throttle. Leaving the
`SESSION_ACTIVE` route disposes it immediately. Only one call is in flight at a
time. Successful active results are accepted through the route controller;
wrong-state or concurrency failures trigger one reconciliation. IPC failures do
not auto-retry.

## Boundaries

The renderer authentication experience must not import Electron, Node built-ins,
`@main`, or `@preload`. It must not use browser persistence, cookies, URL state,
files, network APIs, dynamic IPC channels, direct Electron access, direct
database access, or password modules.
