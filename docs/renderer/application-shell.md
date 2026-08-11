# Application Shell

HSD-024 replaces the foundation-only active-session view with a renderer-owned
application shell. It mounts only after the first-run gate returns
`SETUP_COMPLETE` and authentication observes `SESSION_ACTIVE`.

## Startup And Session Inputs

The shell receives only data that has already crossed reviewed boundaries:

- `applicationName` and `applicationVersion` from the existing startup info.
- `deploymentName` and `timeZone` from the existing initialized first-run state.
- Public authenticated user display name and role from the active session route.

The shell does not call `app.getInfo()`, `app.getHealth()`, or
`firstRun.getState()` again. It does not infer device, installation,
organization, or user IDs. Screening location authority is resolved in the main
process from the trusted installation-location configuration. The Screening
renderer receives only the sanitized current daily-session context returned by
the fixed preload API.

## Navigation Catalog

`src/renderer/src/app/shell/application-navigation-catalog.ts` owns the frozen
renderer display catalog. The catalog is a usability contract only; main-process
authorization remains authoritative for future protected operations.

| Role               | Visible primary menus                                         |
| ------------------ | ------------------------------------------------------------- |
| `LOCAL_ADMIN`      | Home, Patients, Screening, Referrals, Reports, Administration |
| `NURSE`            | Home, Patients, Screening, Referrals, Reports                 |
| `TRAINED_SCREENER` | Home, Patients, Screening, Referrals                          |

`HOME_DASHBOARD`, patient registry commands, `HOME_TODAYS_SESSION`,
`SCREENING_TODAYS_SESSION`, and `SCREENING_NEW_SCREENING` are available. The
Home patient-screening shortcut routes to the same Patients-based Screening
workspace as the Screening menu. Draft Encounters, Session Summary, and other
unimplemented modules continue routing to the transparent planned-module
workspace with the command label, "Not available in this build.", and the
owning future work package.

`ADMINISTRATION_LOCATIONS` routes authorized local administrators to the
Screening Location workspace. The renderer catalog controls visibility only;
P0-backed main-process handlers enforce `LOCAL_ADMIN` authorization for reading,
assigning, and reconfiguring the installation location.

## Dashboard

The dashboard is an honest empty operational surface. It renders deployment and
time-zone context, five noninteractive summary cards, role-filtered quick
actions, and an accessible worklist table with one empty-state row. It must not
render sample patients, counts, dates, site names, session names, sync totals,
or backup timestamps.

## Administration Workspace

The Administration Screening Location workspace displays the current configured
location as either the safe location name or `Not configured`. Authorized local
administrators can choose one active eligible location from the approved
location-list boundary, confirm with Save, or Cancel without changing the
assignment.

Initial assignment calls
`window.healthScreening.installationSettings.assignInitialLocation({ locationId })`.
Changing an existing assignment calls
`window.healthScreening.installationSettings.reconfigureLocation({ locationId })`.
The renderer never supplies actor, role, installation identity, active-work
state, audit metadata, `force`, `bypass`, or `override` fields. P0 keeps
validation, authorization, transaction, audit, and active-work protection in the
main process.

The workspace does not create or edit locations, does not open daily sessions,
does not start encounters, and does not rewrite historical session or encounter
attribution.

## Screening Workspace

The HSD-029C Screening workspace is a Patients-based encounter entry surface.
On entry it invokes `window.healthScreening.screeningSessions.ensureCurrent()`
with no request payload. The main process authenticates and authorizes the user,
resolves the P0 configured location, derives the authoritative operational date,
and returns or creates the current open daily screening session. The renderer
does not choose the location, date, status, actor, or session.

Until the P1 operation succeeds, the workspace remains unavailable and shows a
controlled state such as sign-in required, forbidden, location not configured,
configured location missing or inactive, closed daily session, or `Session
unavailable` with a safe retry when appropriate. It never exposes raw database,
IPC, stack, authentication, patient, or session internals.

Each controlled session failure is presented once. For example, an unconfigured
installation shows `Screening location is not configured.` in the unavailable
workspace state without repeating the same message in a second content panel.
The Patients table is not rendered while the daily session is unavailable.

After the daily session is ready, the workspace displays:

- `Patients`
- `Search patients`
- a table with `Name`, `Sex`, `Age`, `Last Screening`, and `Follow-up`

The table uses the existing patient-search preload boundary and a bounded page
size. Patient rows are fully clickable and keyboard-accessible with Enter and
Space. There is no Select button or Action column in this workspace; the
separate Patient Search screen remains unchanged.

Activating a patient row calls the approved HSD-029A/HSD-029B boundary
`window.healthScreening.screeningEncounters.start({ patientId,
screeningSessionId })`. The session id comes only from the sanitized P1 daily
session context. The renderer never passes location, date, actor, role, status,
or audit metadata. A successful `STARTED` or `ALREADY_EXISTS` result opens or
activates one patient-name tab using the stable patient id as internal identity.
Repeated clicks while pending cannot create duplicate tabs or duplicate start
requests.

The workspace enforces four simultaneously open patient tabs. A fifth unique
patient is blocked with `Close one patient to continue`; an already open patient
can still be activated. Closing a tab does not close, complete, cancel, or alter
the encounter.

Patient tab labels use safe formatted patient names. The clinical section labels
are `Vitals`, `Lifestyle`, `Food`, `OTC Medications`, and `Review`, with the
short disclaimer `Screening guidance—not a diagnosis.` Clinical persistence,
recommendations, referrals, printing, reporting, sync, and FHIR behavior remain
outside this renderer checkpoint.

## Keyboard Model

Primary menu buttons use one roving tab stop. Left and Right move through the
visible menu set, Home and End jump to the first or last visible menu, Enter and
Space toggle the contextual panel, and Escape closes the panel and restores
focus to the active primary menu.

F6 cycles major focus zones in order: top bar, contextual command panel when
open, workspace, then top bar. Shift+F6 cycles in reverse. HSD-024 deliberately
skips the absent patient-tab region and does not render an empty focus target.

## HSD-029 Boundary

HSD-029C relies on P0 for installation-location authority, P1 for the current
daily screening-session boundary, and HSD-029A/HSD-029B for encounter start or
resume. The renderer does not create daily sessions directly, does not create
encounters outside the approved boundary, and does not persist operational
authority in browser storage.
