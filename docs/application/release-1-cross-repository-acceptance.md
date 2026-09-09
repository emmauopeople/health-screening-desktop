# HSW-018A Release 1 cross-repository acceptance

Status: Implemented

## Purpose

HSW-018A provides the final application-level Release 1 proof across the real
desktop synchronization worker and the CHS-web API. It uses synthetic data,
an on-disk SQLite database, a loopback Fastify listener, and an isolated
PostgreSQL schema. It does not contact a deployed service or exercise desktop
reporting.

The acceptance run proves:

- offline records and outbox signals remain durable across a SQLite restart;
- reconnect processing preserves the exact stored batch bytes;
- an unknown outcome after central commit is recovered through the stored
  response without creating duplicate canonical rows;
- the CHS Medical ID returned by the API is persisted in the desktop identity
  link and active patient identifier;
- an authorized operations request can view the synchronized patient, vitals,
  Lifestyle assessment, acknowledgment state, and source provenance;
- an exact POST replay returns the stored response without duplicating
  canonical data; and
- central credential revocation blocks a later desktop revision with the
  stable `INVALID_INSTALLATION_TOKEN` result.

## Safety boundary

The runner requires two adjacent clean checkouts by default:

```text
health-app/
  CHS-web/
  health-screening-desktop/
```

Set `CHS_WEB_REPOSITORY` to an absolute or relative checkout path when the
repositories are not siblings. `DATABASE_TEST_URL` must identify a disposable
PostgreSQL test database. The runner creates a unique schema, applies the
CHS-web migrations inside it, and drops only that schema during cleanup. Never
point this command at production or a database containing real patient data.

The CHS-web API build is an explicit prerequisite so the desktop repository
does not compile or vendor code owned by the supporting repository. From the
desktop checkout, run:

```bash
corepack pnpm --dir ../CHS-web --filter @chs/api build
DATABASE_TEST_URL=postgresql://chs:chs-local-only@localhost:5432/chs \
  corepack pnpm test:acceptance:release-1
```

On PowerShell:

```powershell
corepack pnpm --dir ..\CHS-web --filter @chs/api build
$env:DATABASE_TEST_URL = 'postgresql://chs:chs-local-only@localhost:5432/chs'
corepack pnpm test:acceptance:release-1
```

The successful run writes `artifacts/release-1-acceptance.json`. The artifact
contains only boolean checks, aggregate row counts, contract/schema versions,
and runtime information. It contains no clinical values, identifiers,
credentials, connection details, raw requests, or raw responses and is ignored
by Git.

## Scope boundary

HSW-018A adds release evidence only. It changes no synchronization contract,
SQLite or PostgreSQL schema, clinical workflow, renderer, preload boundary,
report implementation, production deployment, or FHIR behavior. Food, OTC,
referral, addendum, and review-flag transport remain outside the Release 1
contract.
