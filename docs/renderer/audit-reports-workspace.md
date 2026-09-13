# Audit Reports Workspace

HSD-066B activates **Reports > Audit Reports** only for the `LOCAL_ADMIN` role. The renderer uses
the HSD-066A read-only preload API and does not import Electron, database, repository, or main-process
code.

## Workspace

The workspace loads deployment, actor, action, and entity options before querying audit events. It
defaults to the last 30 deployment-local calendar days and supports Today, Last 7 days, Last 30
days, All time, and an explicit custom range. Local start and inclusive-through dates are converted
to inclusive-start/exclusive-end UTC timestamps before IPC.

Additional filters cover system or exact user actor, exact action, exact entity type and ID, bounded
free text, and page sizes of 25, 50, or 100. Applying filters returns to page one. Results retain the
repository's deterministic newest-first ordering.

The result table and selected-event detail panel scroll independently. The detail panel shows the
event identity, actor, action, entity, deployment, and complete bounded metadata. It contains no
write action.

## Print Preview

Print Preview produces a document view for the current bounded result page. The document identifies
the deployment, administrator, generation time, time zone, applied filters, visible result range,
and complete metadata for every displayed event. The CHS mark and screening disclaimer appear only
inside preview and print output, not in the browser workspace.

The preview's Print button invokes the desktop print dialog, where the operator can select a PDF
printer. Print CSS preserves table colors, prevents event rows from splitting where possible, and
adds the deployment, page count, and reporting administrator to the footer.

## Failure Handling

Authentication-required and forbidden service states return to the existing protected-workspace
routing boundary. Invalid filters remain in the workspace with a controlled message. IPC,
unavailable, or malformed-result failures display only controlled retryable copy and never expose
raw exceptions, SQL, filesystem paths, or audit-row internals.

## Administration → Audit (HSD-070)

The Administration Audit command now opens the same protected audit viewer under the Administration menu, with the heading “Audit”. Reports → Audit Reports remains available. Both entry points require LOCAL_ADMIN and use the existing read-only service; there are no audit edit, delete, or clear actions.

Refresh reloads filter options (including newly recorded actors/actions) and the current result page using the applied filters. Unsaved filter drafts remain separate. Initial context failures offer a retry. Starting a new page request clears the old result/detail and closes print preview, so stale events cannot be printed under different filters. Switching between the two menu entry points starts a fresh viewer.

This completes the Administration tab using the existing date, actor/system, action, entity, search, pagination, detail and bounded-page print-preview features. It adds no database, IPC, audit-writer or synchronization changes.
