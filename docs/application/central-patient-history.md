# HSW-019E: desktop central patient history

Patients → select a patient → **Central History** provides an explicit, reason-gated
read of canonical history. Active nurses and local administrators can refresh
from the central server, view a saved snapshot offline, filter by history type,
and page through it. Clinical details and source references are expandable.
Close history clears the displayed records; Back to top returns keyboard focus
to the heading. Local Screening History continues to show locally authored work.

The server prerequisite is CHS-web HSW-019D (PR #56, merged at `d461cf8e`), including
migration 0016 and `POST /api/v1/sync/patients/history`. This increment does not
change server contracts, upload behavior, audit reports, or FHIR support.

## Identity and authorization

- The main process derives the requester from the active local session, checks
  the current user's active status, role, and password-change state, and obtains
  the protected installation credential through the existing sync foundation.
- A confirmed `sync_patient_identity_links` row and matching active CHS identifier
  are required. The accepted revision must equal the local patient revision.
  A Medical ID entered by the renderer cannot authorize a download.
- The renderer supplies only a local patient ID, a controlled access reason,
  dates, and local display pagination/filter parameters. Canonical identity,
  requester, organization scope, credentials, and server cursors are not inputs
  from the renderer. Every remote page remains subject to the server's current
  identity, actor, organization, and installation access checks.
- Cache bindings include the local user and role, account identity, accepted
  patient identity/revision, installation/location configuration, server origin,
  and credential fingerprint/configuration time. Another user, changed identity,
  or changed configuration cannot read the previous binding.
- Async responses are rechecked against current authentication and binding before
  saving. Patient changes, lock/logout, and panel closure invalidate renderer
  requests and clear displayed data.
- A known server denial (401/403/404 or identity-review conflict) clears the
  installation's cached snapshots conservatively. An offline read cannot discover
  a new remote revocation until the next server contact. It still requires an
  active authorized local session and a matching binding. Saved snapshots become
  unavailable after 30 days and must be refreshed.

## Durable cache and limits

Schema 26 adds `central_history_snapshots` and `central_history_items`. Cached
records never enter local encounters, referrals, drafts, or the sync outbox.
They retain central references, source revision, source organization/location/
installation, author, occurrence time, and current void/amendment state. Patient
demographics returned centrally are shown separately from the local patient.

Each refresh downloads one server page per IPC request. The UI can continue
automatically or pause between pages. A DOWNLOADING snapshot stores the opaque
cursor, stable patient profile/retrieval time, query, and validated ordered items.
Restarting the app can resume the same download with **Continue download**. A
cursor older than 14 minutes is restarted; stale server cursors produce a clear
restart message. **Refresh from central** explicitly starts over.

The READY snapshot is replaced only in the transaction saving the last page and
its audit event. Failed network requests, malformed pages, duplicate/reordered
records, mixed profiles/ranges/retrieval times, and stale cursors never replace
the previous complete history. Unique item keys prevent duplicate replay. Local
pagination is bound to a snapshot ID to detect replacement between pages.

Limits are 366 inclusive UTC days per request, 50 remote items / 512 KiB per page,
a 30-second request timeout, and 5,000 records / 16 MiB / 200 pages per traversal.
Local pages contain at most 25 items and 512 KiB. The total cache is bounded at
128 MiB by evicting the oldest other snapshots, preserving the selected patient's
previous complete copy until replacement. These are replaceable caches; the
canonical records remain on the server. The cache is stored in the same protected
local SQLite file as other clinical data and is included in normal backups.

Local audit actions are `CENTRAL_HISTORY_READ` and `CENTRAL_HISTORY_REFRESH`.
They record the local patient/user, purpose, outcome, and counts without clinical
payloads or credentials. A failed audit write prevents disclosure or promotion. Explicit server denials
commit cache removal separately so audit failure cannot restore revoked access.
The server also audits each retrieved page. Audit-report presentation code is
outside this change.

## Contract provenance

`src/shared/central-history/contract.mjs` and `contract.d.mts` vendor the closed
v1 history contract from CHS-web `d461cf8e`,
`packages/contracts/src/patient-history.*`. Only formatting, provenance comments,
and a JavaScript lint annotation differ. Keep it aligned with the upstream
contract when adding history domains. The shared synthetic page fixture comes
from that same revision; integration coverage includes all eleven resource types.

## Windows verification

Start the updated CHS-web API. In this desktop branch run:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm verify
corepack pnpm build
corepack pnpm dev
```

1. Sign in as a nurse or local administrator. Select a patient whose central
   identity has been accepted by sync. Open **Central History** and choose an
   access reason. Use a UTC date range containing known screenings and follow-ups.
2. Select **Refresh from central**. Verify vitals, Lifestyle, Food/OTC, referrals,
   follow-ups, addenda, and review history where available. Expand Clinical
   details. Confirm source location, author, retrieved time, and void/amendment
   labels. No edit controls should appear on central records.
3. Stop the API, close and restart the desktop, sign in as the same user, and
   select **View saved history**. The completed snapshot should remain available.
   An attempted refresh should retain the saved records and show a connection
   message. Restart the API afterward.
4. With more than 50 history records, pause a download, restart the desktop, and
   continue it with the same reason and dates. The prior complete snapshot should
   remain visible until the replacement finishes. Check local paging, filtering,
   Close history, and Back to top.
5. Record a later follow-up/addendum locally, allow upload, and refresh central
   history. Confirm it appears once, and that the download created no additional
   local encounter or upload signals.
6. In a separate synthetic test installation, check denied/revoked access and a
   conflicting identity. An explicit central denial must remove saved access.
   A trained screener must not retrieve or view cached central history.

Cross-installation sharing and combined release acceptance remain HSW-019F.
