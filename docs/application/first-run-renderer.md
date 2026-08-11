# First-Run Renderer Flow

HSD-016 adds the first visible setup workflow in the React renderer. The
renderer consumes only the fixed HSD-015 preload bridge on
`window.healthScreening`; it does not import Electron, preload modules,
main-process code, repositories, SQLite, Node APIs, or dynamic IPC channels.

## Startup Gate

Each startup load attempt calls these preload methods once, in parallel:

- `app.getInfo()`
- `app.getHealth()`
- `firstRun.getState()`

The renderer maps those fallible result envelopes into exactly one visible
state:

- `LOADING`: local application status is still loading.
- `SETUP_REQUIRED`: shell info, shell health, and first-run state all loaded,
  the database is ready, and first-run state is `REQUIRED`.
- `SETUP_COMPLETE`: first-run state is `INITIALIZED`; HSD-023 hands off to the
  renderer authentication experience instead of showing setup controls.
- `INCONSISTENT`: first-run state is `INCONSISTENT`; setup is blocked and the
  reviewed inconsistency code is shown only as a support reference.
- `UNAVAILABLE`: app info, health, first-run state, or database readiness is
  unavailable. Retry is offered only when the failure is safe to retry.

Startup never calls `firstRun.initialize()`, never polls, never writes local
data, and never infers setup state from shell health or local browser state.
The startup controller uses a generation guard so obsolete retry or unmount
results cannot update the visible state.

## Setup Form

The setup form captures only the HSD-015 initialize command fields plus a
renderer-only password confirmation field:

- Installation: deployment name and time zone.
- Administrator: username, display name, and temporary password.
- Configured screening location: name, location type, village, subdivision,
  region, and directions.

The submitted location fields are setup input only. After successful bootstrap,
the main process persists the created active location as the installation's
configured screening location. The renderer does not become the ongoing
location authority and does not claim that protocol, login session, dashboard,
or clinical workflow exists.

Optional location text uses blank-to-null conversion. Empty or whitespace-only
values become `null`; nonblank values are submitted exactly as entered. Required
values are not trimmed, normalized, lowercased, uppercased, or otherwise
rewritten before submission. The main-process HSD-014 service remains
authoritative for validation, canonicalization, uniqueness, transactions, and
audit creation.

## Password Minimization

Password fields are uncontrolled browser inputs. The renderer compares the
temporary password and confirmation during submit, but it does not store
password values in React state, persistent browser storage, URLs, logs, error
messages, setup-complete state, or snapshots. The confirmation value is never
included in the HSD-015 initialize command.

On successful initialization, the form is reset before it is unmounted. The
success view trusts the canonical public result from main and displays only
deployment name and time zone.

## Submission Behavior

The submission controller prevents duplicate initialize calls while one request
is in flight. It uses native form validity before constructing the command and
does not retry initialization automatically.

Initialize failures map to fixed renderer guidance:

- Validation failure keeps the form visible with general correction guidance.
- Already-initialized and integrity failures reload first-run state once and do
  not resubmit.
- Initialization-in-progress and service failures keep the form visible with
  safe fixed messages.
- Forbidden initialization replaces the form with a blocking unavailable
  screen.

The renderer never displays raw error objects, exception names, stacks, SQL,
paths, request fields, IDs, timestamps, audit records, or credential material.

## Accessibility

The setup screen uses persistent visible labels, associated `htmlFor`/`id`
pairs, fieldsets with legends, required attributes, helper text connected with
`aria-describedby`, an alert summary for failed submission, and visible focus
outlines. Controls and buttons use practical 44 px targets. The layout remains
single-column on narrow viewports and avoids horizontal scrolling at 320 px.

## Deferred Work

HSD-023 now owns the renderer-visible login, required password-change, locked
session, and authenticated shell foundation. User administration, admin
location reconfiguration UI, protocol activation, clinical workflows,
synchronization, backup, restore, printing, and reporting remain deferred to
later reviewed tasks.
