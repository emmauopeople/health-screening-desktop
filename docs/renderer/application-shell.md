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
organization, or user IDs. Screening-session location and session context is
loaded only by the HSD-028C screening workspace through the validated preload
API.

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
`SCREENING_TODAYS_SESSION`, and `SCREENING_NEW_SCREENING` are available after
the HSD-028C renderer checkpoint. The Home "Today's Session" shortcut routes to
the same screening-session workspace as the Screening menu. Draft Encounters,
Session Summary, and other unimplemented modules continue routing to the
transparent planned-module workspace with the command label, "Not available in
this build.", and the owning future work package.

## Dashboard

The dashboard is an honest empty operational surface. It renders deployment and
time-zone context, five noninteractive summary cards, role-filtered quick
actions, and an accessible worklist table with one empty-state row. It must not
render sample patients, counts, dates, site names, session names, sync totals,
or backup timestamps.

## Screening Session Workspace

The HSD-028C screening workspace is a renderer-only management surface for the
HSD-027 lifecycle service. It calls only
`window.healthScreening.screeningSessions` and keeps the active location,
active session, selected row, filters, and pagination in memory. It does not
persist those values to browser storage, URLs, files, or SQLite.

On entry the workspace requests trusted context, displays the main-process
deployment-local date, and renders active locations only. One active location
may be selected automatically; multiple active locations require an explicit
choice. The renderer never calculates the authoritative screening date from the
operating system.

The workspace can open today's session for an active location, list sessions
using the approved filters and page sizes, select a session, close an open
session after confirmation, and reopen a closed session when the current role
is `LOCAL_ADMIN` or `NURSE`. `TRAINED_SCREENER` users see the closed-session
state and an explicit role-restricted reopen message, while main-process
authorization remains authoritative.

Version conflicts replace the visible selected session with the authoritative
record returned by the desktop service and require the user to review before
retrying. Lifecycle actions are never shown as successful until the validated
preload result returns. Expected business outcomes use calm user-facing
messages, and protected failures clear in-memory session state through the
same authenticated-shell reconciliation path used by patient workflows.

The workspace follows the approved SVG visual system: deep-navy shell, white
active primary menu, light-blue contextual strip, pale gray workspace
background, white bordered cards, navy headings, teal accents, explicit status
dots plus text, compact tables, and confirmation dialogs. It is designed for
1280x720, 1366x768, and 1920x1080 desktop workspaces without horizontal page
overflow.

It does not implement patient enrollment, screening encounters, measurements,
protocol calculations, recommendations, referrals, reports, dashboard counts,
sync networking, or fake operational records.

## Screening Encounter Workspace

HSD-029C routes `SCREENING_NEW_SCREENING` to the screening encounter workspace.
The workspace uses the approved screening split-workspace SVG and UX design
notes as its visual source: patient context on the left, screening workflow on
the right, navy/teal shell styling, compact white cards, explicit status text
plus icon treatment, and support for 1280x720, 1366x768, and 1920x1080 desktop
workspaces.

Patient lookup uses the existing patient-search preload API. Selecting a
patient opens an in-memory tab labeled with the patient display name only. The
tab strip holds at most four patients, does not persist to browser storage, and
does not expose patient codes, patient IDs, encounter IDs, or session IDs in
tab labels. Opening an already-open patient activates that tab. Opening a fifth
distinct patient shows a controlled message requiring one existing tab to be
closed.

The workspace renders the intended patient-context regions from the approved
design: identity summary, follow-up/referral area, last three screenings,
30-day average blood pressure, blood-pressure graph, weight graph, recent
pulse, OTC medication use, follow-up date, and screening count. Regions without
an approved preload contract show honest empty states. Empty graphs keep their
axes and layout but do not contain fabricated clinical points.

The right panel establishes the five screening steps: Vitals, Lifestyle, Food,
OTC Medications, and Review. Vitals follows the approved table structure for BP
and related measurements. Clinical fields are disabled with unavailable states
until persistence contracts exist. The clinical-action panel remains neutral
with "Awaiting completed screening data" and the permanent safety wording,
"Screening action, not a diagnosis."

Encounter start is the only operational encounter mutation. The renderer calls
`window.healthScreening.screeningEncounters.start()` with exactly `patientId`
and `screeningSessionId` after the user intentionally begins or resumes
screening. `STARTED` and `ALREADY_EXISTS` open the canonical draft workspace;
controlled failures map to concise local messages and never expose raw errors,
SQL, database paths, stack traces, actor IDs, audit data, outbox payloads, or
clinical details. The renderer does not optimistically create encounters.

The workspace uses semantic tab and tabpanel roles, keyboard tab navigation,
accessible close controls, visible focus states, live status messages for
controlled failures, and deterministic focus restoration when tabs close.

HSD-029C does not implement vital-sign persistence, lifestyle persistence, food
persistence, OTC medication persistence, review completion, recommendation
calculation, referral creation, synchronization, FHIR mapping, or clinical
threshold logic.

## Keyboard Model

Primary menu buttons use one roving tab stop. Left and Right move through the
visible menu set, Home and End jump to the first or last visible menu, Enter and
Space toggle the contextual panel, and Escape closes the panel and restores
focus to the active primary menu.

F6 cycles major focus zones in order: top bar, contextual command panel when
open, workspace, then top bar. Shift+F6 cycles in reverse. HSD-024 deliberately
skips the absent patient-tab region and does not render an empty focus target.

## Future Clinical Boundary

Future clinical checkpoints may add measurement persistence, screening review,
recommendations, referrals, reports, sync transport, or FHIR mapping. That work
must continue to use reviewed preload boundaries and must not bypass the
lifecycle service, encounter start service, audit event, or transactional outbox
behavior.
