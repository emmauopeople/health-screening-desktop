# Audit Report IPC

HSD-066A exposes two fixed, validated methods through `window.healthScreening.auditReports`:

| Method            | Channel                                      | Purpose                                        |
| ----------------- | -------------------------------------------- | ---------------------------------------------- |
| `getContext()`    | `health-screening:audit-reports:get-context` | Load deployment and filter options.            |
| `search(request)` | `health-screening:audit-reports:search`      | Load one stable page of filtered audit events. |

Both methods use exact request and response schemas. Extra authority fields, malformed UUIDs,
invalid action/entity codes, reversed UTC ranges, unsupported page sizes, unsafe metadata, and
unexpected result fields fail closed. The preload exposes no arbitrary channel name, `invoke`,
listener, Electron object, database handle, or repository object.

The production lifecycle registers and disposes both channels with ownership protection and
partial-registration rollback. HSD-066B consumes this fixed boundary through the administrator-only
Audit Reports workspace and its print preview.
