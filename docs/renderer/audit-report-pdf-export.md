# Audit report PDF export

Reports → Audit Reports and Administration → Audit share the same read-only workspace. Administrators can open Print preview, save a searchable A4 PDF to a native file destination, or use a connected printer through the native print dialog.

## Scope and content

The report contains only the currently loaded filtered results page (25, 50, or 100 rows). The preview and PDF identify the event range, total matches, results page, page size, applied filters, deployment, generation time, time zone, and reporting administrator. It does not fetch other pages or include unapplied filter edits. All metadata supplied by the existing audit read model remains present; system actors are labeled System. Entity IDs remain useful audit references.

The preview captures the loaded page and filters. A native modal dialog keeps underlying controls inert. Save/Print and Close cannot run concurrently, Escape is blocked while exporting, and closing restores focus to the preview trigger. Cancellation, failed export, retry, and authentication transitions use the existing report-document actions.

## Implementation boundary

- Adds a strict AUDIT variant to the existing report-document request. No patient/session ID, arbitrary path, content, or claimed role is accepted.
- Both save and print check the active administrator role in main, after trusted-sender and session validation.
- Reuses Electron printToPDF and native printing through the existing two IPC channels and preload methods.
- Uses a separate printable document with scoped A4 styles. Table headers repeat; ordinary event blocks stay together, while large metadata blocks can span pages.
- Named page margin boxes carry deployment, page counts, and reporting administrator. Footer values are escaped and wrapped in a constructed stylesheet under the unchanged production CSP.
- No audit writes, database migrations, dependency changes, or sync-engine changes.

## Validation and Windows acceptance

Automated coverage includes authorization for all three roles, strict request scope, preload forwarding, native save destination, both application navigation routes, current-page export, applied versus draft filters, focus restoration, cancellation, failed save/retry, and authentication errors.

Rendered Chromium checks cover a short report, 100 events, and metadata spanning pages under the production style-src policy. Windows printer behavior should also be checked on the installed desktop:

1. Sign in as LOCAL_ADMIN and open either audit entry point.
2. Apply filters and choose a results page, then open Print preview.
3. Confirm the scope, filter summary, metadata, time zone, and administrator.
4. Save PDF to the PC or a mounted external drive; inspect all pages for readable content, repeating table headers, and page footers.
5. Print to an attached printer. Also cancel the Save and Print dialogs and confirm the preview remains usable.
6. Close the preview and confirm focus returns to Print preview.

```bash
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm exec vitest run --maxWorkers=1
corepack pnpm build
corepack pnpm start
```
