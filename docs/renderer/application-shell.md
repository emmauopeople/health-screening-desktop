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
`firstRun.getState()` again. It does not infer active location, screening
session, device, installation, organization, or user IDs. When location or
session context is needed, it displays "No active location selected" and "No
screening session open."

## Navigation Catalog

`src/renderer/src/app/shell/application-navigation-catalog.ts` owns the frozen
renderer display catalog. The catalog is a usability contract only; main-process
authorization remains authoritative for future protected operations.

| Role               | Visible primary menus                                         |
| ------------------ | ------------------------------------------------------------- |
| `LOCAL_ADMIN`      | Home, Patients, Screening, Referrals, Reports, Administration |
| `NURSE`            | Home, Patients, Screening, Referrals, Reports                 |
| `TRAINED_SCREENER` | Home, Patients, Screening, Referrals                          |

`HOME_DASHBOARD` is the only available command in HSD-024. Every other command
routes to a transparent planned-module workspace with the command label, "Not
available in this build.", and the owning future work package.

## Dashboard

The dashboard is an honest empty operational surface. It renders deployment and
time-zone context, five noninteractive summary cards, role-filtered quick
actions, and an accessible worklist table with one empty-state row. It must not
render sample patients, counts, dates, site names, session names, sync totals,
or backup timestamps.

## Keyboard Model

Primary menu buttons use one roving tab stop. Left and Right move through the
visible menu set, Home and End jump to the first or last visible menu, Enter and
Space toggle the contextual panel, and Escape closes the panel and restores
focus to the active primary menu.

F6 cycles major focus zones in order: top bar, contextual command panel when
open, workspace, then top bar. Shift+F6 cycles in reverse. HSD-024 deliberately
skips the absent patient-tab region and does not render an empty focus target.

## HSD-025 Boundary

HSD-025 owns patient search, patient registration, duplicate review,
four-patient tabs, and unsaved-change guards. HSD-024 may label those planned
workspaces but must not implement forms, patient tabs, patient records, or
clinical state.
