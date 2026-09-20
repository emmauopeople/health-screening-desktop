# Read-only sync dependency diagnostics

Run with Node 24 from the desktop repository:

```bash
node scripts/diagnose-sync.mjs --installation-id <installation-UUID-from-Sync-Monitoring>
```

The CLI checks the development and installed application directories beneath
`APPDATA`: `health-screening-desktop` and `Health Screening Offline Desktop`.
It opens existing databases read-only and verifies the installation ID before
producing a summary. It never creates a database, repairs rows, changes sync
signals, or contacts the API. If multiple copies match, it refuses to choose;
use `--db <active-database-path>` explicitly. The application determines its
actual data directory through Electron's `userData` path.

`databaseChecks` reports fixed labels for missing, unreadable, mismatched or
matching candidates. It does not print filesystem paths or installation IDs.
An unavailable summary reports the failing stage and a fixed error category,
without raw exceptions, SQL, clinical data or credentials. Running the CLI on
a different Windows account may not find the application's database.

`dependencyFailures` groups the latest recorded encounter/vitals dependency
retries. It identifies the immediate parent, follows supported dependency links
up to four levels, and reports the root parent's latest saved outcome, safe
error codes, local existence, identity-link presence and delivery signal counts.
Distinct parent counts distinguish five encounters for one patient from five
different patients. Unsupported paths are counted separately; cycles or
unresolved chains are not marked complete.

Interpret the evidence together:

- `REVIEW_REQUIRED` with `POSSIBLE_DUPLICATE` or
  `IDENTITY_VERIFICATION_REQUIRED`: inspect the controlled web Identity Review
  workflow. Do not automatically match or create a person from diagnostics.
- `REJECTED`: investigate the stable error code before attempting recovery.
- `NOT_OBSERVED`: no parent outcome was found in the local saved response
  history. This does not prove it was never uploaded; an interrupted delivery
  may still be pending.
- `SENT` signal counts indicate a terminal response was handled. They do not
  prove canonical acceptance: review-required and non-retryable rejections also
  complete transport delivery.
- `PRESENT` identity links describe local state, not a fresh server check.

This report describes stored evidence. A missing dependency in an older batch
does not prove it remains missing now. Confirm recovery using a subsequent
accepted/unchanged outcome and central history; do not clear the queue to hide
unresolved records.

Validate this standalone support tool with:

```bash
node --test scripts/test/diagnose-sync.test.mjs
```
