# Health Screening Offline Desktop Application
## UX Design Specification

**Status:** Planned / In Progress  
**Primary context:** Babungo community, Cameroon  
**Scope:** Offline Windows desktop application only  
**Design direction:** Epic-inspired enterprise clinical workspace; not a replica of any proprietary product

## 1. Purpose

This specification converts the approved offline desktop functional plan into a concrete user-experience design. It preserves the existing architecture, roles, clinical boundaries, SQLite workflow, referral lifecycle, and sync-ready design. It adds a consistent clinical desktop shell, a contextual command panel below the top menu, a four-patient tab workspace, split-screen clinical workflows, paginated worklists, professional data visualization, keyboard behavior, and reusable UI components.

The application continues to support screening, protocol-defined next actions, referral, and follow-up. It does not diagnose hypertension or prescribe treatment.

## 2. UX Goals

1. Let a trained screener find or register a patient quickly without losing the current patient workspace.
2. Let the user open up to four patient records as tabs and switch safely between them.
3. Keep historical context visible while current data is collected.
4. Make protocol next actions unmistakable without using diagnostic language.
5. Minimize typing through structured controls, previous-value suggestions, and searchable catalogs.
6. Remain clear on low-cost laptop displays and during intermittent connectivity.
7. Provide dense, professional clinical information without visual clutter.
8. Make every critical action keyboard accessible and auditable.

## 3. Design Language

The visual language uses a calm enterprise clinical layout:

- Deep navy top navigation and neutral white/gray work surfaces.
- Compact but readable information density.
- Clear hierarchy: application navigation, contextual commands, patient tabs, then workspace.
- Split views for worklists and clinical data collection.
- Consistent status badges and action banners.
- Large field controls for screening-site use.
- Color always accompanied by a text label and icon.

### 3.1 Status colors

| Status | Color role | Required wording |
|---|---|---|
| Routine / completed | Green | Routine screening or Completed |
| Repeat measurement | Amber | Repeat required |
| Referral | Orange | Referral required |
| Urgent referral | Red | Urgent referral |
| Sync / technical state | Purple or blue | Pending, Failed, Sent, Offline ready |

No color may be used alone to communicate a clinical or technical state.

## 4. Global Application Shell

The application shell has four fixed horizontal layers:

1. **Primary top bar** - application title, primary menus, connectivity, active user.
2. **Contextual command panel** - secondary commands for the selected primary menu.
3. **Patient tab bar** - displayed whenever at least one patient is open.
4. **Workspace** - dashboard, patient workflow, worklist, report, or administration screen.

### 4.1 Primary top menus

- Home
- Patients
- Screening
- Referrals
- Reports
- Administration

### 4.2 Contextual command panels

**Home:** Dashboard, Today's Session, Quick Patient Search, Open Referrals, Sync Center.  
**Patients:** Patient Search, Register New Patient, Recent Patients, Possible Duplicates.  
**Screening:** Today's Session, New Screening, Draft Encounters, Session Summary.  
**Referrals:** Referral Worklist, Follow-up Due, Closed Referrals, Print Queue.  
**Reports:** Patient Reports, Session Reports, Referral Reports, Audit Reports, Export / Print.  
**Administration:** Users, Locations, Protocols, Sync Center, Backup / Restore, Audit.

### 4.3 Command-panel behavior

- Clicking a primary menu opens its command panel directly below the top bar.
- Only one command panel is open at a time.
- Clicking the active primary menu toggles its panel.
- Escape closes the command panel and returns focus to the active primary menu.
- Selecting a command closes the panel after navigation.
- F6 cycles focus through top bar, command panel, patient tabs, and workspace.

## 5. Multi-Patient Tab Workspace

### 5.1 Tab capacity

- Maximum of four open patient tabs.
- Each tab shows local patient code plus a minimally identifying patient name.
- Active tab is visually dominant.
- Unsaved changes display an amber dot and text in the patient-tab manager.
- Referral or follow-up attention can appear as a small icon with accessible text.

### 5.2 Opening a patient

The patient search result includes **Open tab**. If fewer than four tabs are open, the patient opens immediately. If four tabs are already open, the application asks which tab to close or replace.

### 5.3 Closing a patient tab

When unsaved changes exist, the user must choose:

- Save draft and close
- Discard uncommitted edits and close
- Cancel

Completed clinical records are never discarded through tab closure.

### 5.4 Switching tabs

- Current step and scroll position are preserved per patient.
- Moving to another patient creates a draft checkpoint when the current form is valid enough to persist.
- The active patient code and name remain visible in the workspace heading.

## 6. Dashboard UX

The dashboard shows the local operating state, not a large analytics dashboard.

### 6.1 Summary cards

- Participants screened today
- Draft encounters
- Open referrals
- Pending synchronization
- Last successful backup

### 6.2 Quick actions

- Find or open patient
- Start new screening
- Record referral follow-up
- Print session summary

### 6.3 Today worklist

A paginated table displays patient code, name, age/sex, last screening, current workflow status, and action. Search remains available above the table.

## 7. Patient Search and Registration UX

### 7.1 Search-first layout

The patient search bar is always prominent. Search accepts patient code, name, phone, date of birth, approximate age, village, or quarter.

Results show:

- Patient code
- Name
- Age or date of birth
- Sex
- Village / quarter
- Last screening date
- Active referral or follow-up indicator
- Open tab action

### 7.2 Duplicate prevention

Possible matches appear before registration. The comparison area shows the fields needed for human review. The application never merges patients automatically.

### 7.3 Registration

Registration uses a two-column form with clear sections:

- Identity
- Demographics
- Residence and contact
- Participation / data-use acknowledgment
- Duplicate review

The final action is **Create patient and open tab**.

## 8. Core Screening Workspace

The screening workspace is the primary UX and uses a 38/62 split.

### 8.1 Left pane - longitudinal patient context

The left pane remains visible throughout the encounter and contains:

- Patient identity and local code
- Age, sex, village, and contact preference
- Open referral or follow-up indicator
- Last three screening encounters
- Paired systolic / diastolic trend chart
- Thirty-day monthly average BP summary
- Weight trend
- Last pulse and recent pulse trend when space permits
- Current or recently reported OTC use summary
- Upcoming or overdue follow-up
- Screening visit count and last screening date

The left pane is read-only during data collection. A patient profile command opens full history in a separate workspace state.

### 8.2 Right pane - current data collection

The right pane contains a stepper:

1. Vitals
2. Lifestyle
3. Food
4. OTC medications
5. Review

The stepper is not a wizard that hides all context. The patient context remains visible on the left.

### 8.3 Vitals step

The vitals grid captures multiple readings:

- Sequence number
- Systolic
- Diastolic
- Pulse
- Arm
- Position
- Cuff / device metadata when required
- Measurement time
- Discard action with reason

Additional current measurements:

- Weight in kilograms
- Waist circumference when governance approves it
- Optional non-diagnostic notes

**Important schema impact:** weight trend is a new functional requirement. Add a `weight_readings` table or an approved general measurement table linked to the encounter. Store measured value, unit, timestamp, source, and recorder. Height may be stored as a patient baseline only if BMI display is approved.

### 8.4 Lifestyle step

Use grouped selectable controls rather than large text areas. Show the prior week's confirmed responses as suggestions, but require confirmation for the current encounter.

### 8.5 Food step

- Searchable local food catalog
- Recent foods as quick chips
- Frequency choices
- Preparation or portion notes
- Free-text option when catalog item is unavailable

### 8.6 OTC step

- Product name
- Reason taken
- Dose text when known
- Frequency and duration
- Source of medication
- Currently taking
- Information source / provenance

Previous items may be copied into the current week only after explicit confirmation.

### 8.7 Review step

Show:

- All raw readings
- Any discarded reading and reason
- Protocol version
- Summary values used by the protocol
- Weekly context summary
- Missing fields
- Referral requirement
- Patient-facing instruction template

## 9. Protocol Next-Action Panel

The protocol panel appears in the lower portion of the right pane once sufficient data is available.

### 9.1 States

- Green: Routine screening
- Amber: Repeat measurement required
- Orange: Referral required
- Red: Urgent referral required

### 9.2 Required content

- Status icon and text
- Protocol next action
- Reason or evidence used
- Protocol version
- Clear statement: “This is a screening action, not a diagnosis.”
- Required action button

The banner must not use wording such as “patient has hypertension.”

## 10. Patient Profile and Timeline

The patient profile uses internal tabs:

- Overview
- Screening history
- Referrals and follow-ups
- Lifestyle / food / OTC
- Identifiers and consent

The overview presents summary cards and charts. Detailed tables are paginated. Clicking an encounter opens a detail drawer or split panel rather than navigating away from the patient tab.

## 11. Referral Worklist

Use a split-screen master-detail layout.

### 11.1 Left side

Paginated referral table with filters:

- Status
- Urgency
- Location
- Due date
- Date created
- Patient

Columns: due date, patient, urgency, status, last contact, action.

### 11.2 Right side

Selected referral details:

- Patient identity
- Referral reason and readings
- Current status
- Status history timeline
- Next action
- Reprint referral slip
- Record follow-up
- Open patient tab

## 12. Follow-Up Workspace

Use a stable two-pane form:

- Left: referral summary, due date, prior contacts, provenance explanation.
- Right: contact details, provider seen, facility, date seen, reported outcome, reported medications/advice, new status, next action, next follow-up date.

Save is disabled until the status transition and required explanation are valid.

## 13. Reports UX

Use a filter rail on the left and a report preview on the right.

### 13.1 Patient report

- Screening count
- Thirty-day average BP
- Paired monthly average systolic/diastolic chart
- Weight change
- Open referral count
- BP and pulse history
- Lifestyle / food / OTC context
- Referral and follow-up history
- Provenance labels

### 13.2 Session report

- Participants screened
- Completed and draft encounters
- Referrals by urgency
- Missing context or incomplete records
- User activity and print/export actions

## 14. Administration and Sync UX

Administration uses contextual submenu commands and split-list detail patterns.

### 14.1 Sync Center

Cards:

- Connectivity
- Pending
- Failed
- Last successful sync

The outbox table is paginated. Selecting a failed item shows sanitized error details, retry action, support ID, and diagnostic export. Clinical payloads are never shown in diagnostic exports.

### 14.2 Users, locations, protocols, audit

Each uses a paginated table on the left and a view/edit panel on the right. Destructive actions require confirmation and display the consequences.

## 15. Pagination and Table Standards

- Default page size: 25 rows.
- Optional page sizes: 25, 50, 100.
- No infinite scrolling for clinical or audit data.
- Preserve filters, sort order, page, and selected record when returning from detail.
- Display “Showing X-Y of Z.”
- Tables support keyboard row navigation.
- Sticky headers for long tables.
- Empty states explain the next action.
- Loading indicators use skeleton rows for local queries longer than 250 ms.

## 16. Form and Validation Standards

- Labels remain visible above controls.
- Units appear inside or adjacent to numeric fields.
- Numeric fields accept only plausible format; authoritative range checks remain in the domain service.
- Validation message appears next to the field and in a summary when completion is blocked.
- Required fields are identified by text, not color alone.
- Save Draft, Previous, Continue, Review, and Complete appear in consistent positions.
- Encounter completion always requires a review confirmation.

## 17. Offline and Sync Indicators

The top bar shows one of:

- Offline ready
- Server reachable
- Sync in progress
- Sync attention required

The application remains fully usable in every state. The indicator is informational and never blocks screening.

## 18. Accessibility and Keyboard Behavior

- F6 cycles major application regions.
- Ctrl+K opens patient search.
- Ctrl+S saves the current draft.
- Alt+1 through Alt+4 activate patient tabs.
- Escape closes command panels, drawers, and dialogs when safe.
- All controls have visible focus.
- Primary field controls have at least a 44 px interaction height.
- Charts include textual summaries and accessible labels.
- Status uses icon, text, and color.
- Tab order follows clinical workflow.

## 19. Resolution and Responsive Desktop Rules

Primary target: 1366x768 and 1920x1080 Windows laptops.

- Minimum supported workspace: 1280x720.
- Left patient context pane: approximately 38%, minimum 360 px.
- Right data pane: approximately 62%, minimum 640 px.
- At lower widths, charts stack within the left pane; the patient context pane may collapse to a summary drawer only when the user explicitly chooses it.
- Do not convert the desktop application into a narrow mobile layout.

## 20. Reusable React Components

- `AppShell`
- `PrimaryMenuBar`
- `ContextCommandPanel`
- `PatientTabBar`
- `PatientTabManager`
- `OfflineStatusIndicator`
- `SplitWorkspace`
- `PatientContextPane`
- `EncounterStepper`
- `MeasurementGrid`
- `ProtocolActionBanner`
- `StatusBadge`
- `PaginatedDataGrid`
- `FilterRail`
- `MasterDetailLayout`
- `UnsavedChangesGuard`
- `ClinicalChartCard`
- `PrintPreviewDialog`
- `EmptyState`
- `ErrorSummary`

## 21. Recommended UX Tools

Preserve the approved Electron/React/TypeScript stack and add:

- Tailwind CSS for tokens and layout
- Radix UI primitives for accessible dialogs, menus, tabs, tooltips, and popovers
- TanStack Table for sorting, pagination, selection, and accessible data grids
- Recharts for BP and weight charts
- Lucide React for consistent icons
- React Hook Form and Zod for forms and validation
- Zustand for patient-tab and workspace UI state
- Playwright for keyboard, tab, split-view, and workflow tests

## 22. UX State Management

The renderer may hold non-sensitive workspace state:

- active top menu
- command panel state
- open patient tab IDs and active tab
- filters and pagination
- selected worklist row
- form dirty state
- chart display preferences

Clinical data remains authoritative in the main process and SQLite. Switching patient tabs must never rely only on volatile renderer state.

## 23. UX Acceptance Criteria

1. A user can open, switch, and safely close up to four patient tabs.
2. Unsaved work cannot be lost without an explicit decision.
3. Historical context remains visible while current screening data is entered.
4. The protocol panel uses screening/referral language and always shows the protocol basis.
5. Referral and follow-up worklists remain usable with hundreds of rows through pagination and filters.
6. The app is fully operable with the network disabled.
7. All primary workflows can be completed using keyboard navigation.
8. Tables, forms, and charts remain usable at 1366x768.
9. Status is never conveyed by color alone.
10. Weight trend is implemented only after the local data model is updated and migration-tested.

## 24. UX Delivery Work Packages

### UX0 - Design Tokens and Information Architecture
Approve colors, typography, spacing, menu hierarchy, statuses, labels, and keyboard rules.

### UX1 - Application Shell
Build top menu, contextual command panel, connectivity/user area, and protected workspace shell.

### UX2 - Patient Search and Tabs
Build search, duplicate-review panel, four-tab behavior, tab manager, and unsaved-change guard.

### UX3 - Screening Split Workspace
Build patient context pane, current encounter pane, stepper, measurement grid, charts, and protocol panel.

### UX4 - Context Collection
Build lifestyle, food, and OTC workflows with previous-value confirmation and provenance labels.

### UX5 - Referrals and Follow-Up
Build paginated referral master-detail screen and follow-up split form.

### UX6 - Timeline and Reports
Build patient timeline, report filter rail, charts, pagination, print preview, and PDF actions.

### UX7 - Administration and Sync
Build user/location/protocol/audit worklists, sync center, errors, backup/restore, and settings patterns.

### UX8 - Accessibility and Field Validation
Complete keyboard navigation, focus order, resolution testing, contrast review, usability testing, and Playwright evidence.

## 25. Mockup Index

1. Application shell and dashboard
2. Patient search and multi-patient tabs
3. Split screening workspace
4. Referral worklist
5. Follow-up workspace
6. Patient report workspace
7. Synchronization center
8. Clinical desktop design system
