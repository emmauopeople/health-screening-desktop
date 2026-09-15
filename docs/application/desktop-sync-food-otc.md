# HSW-019A: Finalized Food and OTC synchronization

Status: Implemented on review branch; requires the paired CHS-web update first.

The automatic worker now uploads one immutable `FOOD` and one immutable `OTC`
snapshot for each completed encounter. It reads `food_logs` and
`otc_medication_logs`, retains nullable values, and takes the original response
and reporting period from the retained draft header. Missing legacy metadata
remains null. Incomplete encounters and draft row content are not uploaded.

The local encounter ID is the resource ID, separately namespaced by FOOD/OTC.
Source revision 1 represents original finalized intake and remains stable after
a later encounter status change. Corrections require an explicit future
amendment contract. Authors and completion timestamps are preserved.

Completion enqueues both finalized notifications in its existing transaction,
even for declined/none-reported answers. SQLite migration 0022 preserves current
sync mappings and queues existing completed local encounters once. Existing
migration SQL and previously stored batch bytes remain unchanged.

Each accepted outcome writes its own canonical mapping. Only acceptance retires
that domain's older pending draft-save notifications. A Food success does not
clear retrying OTC work or referral/addendum work. The existing worker provides
exact-byte response recovery and automatic retry. Snapshot selection budgets UTF-8
record bytes below 900 KiB, leaving room for actors and the 1 MiB transport envelope;
remaining records stay queued for a later batch.

## Upgrade and verification

Deploy CHS-web branch `feat/HSW-019A-food-otc-sync` and PostgreSQL migration 0012
before upgrading this desktop. Older APIs do not understand FOOD/OTC resources.
Do not clear queued records or edit stored requests to work around version mismatch.

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Focused coverage is in the sync snapshot/worker, migration runner/catalog, and
screening completion tests. Verify a completed screening with Food/OTC, an
explicit non-reporting answer, restart before delivery, and existing completed
records against the paired PostgreSQL server.

## Next increments

The coordinated sequence in CHS-web `docs/sync/sync-expansion-sequence.md` covers
referrals and their follow-up/treatment histories, addenda and review flags,
then authorized patient-history download and a separate read-only desktop cache.
FHIR remains deferred. Imported history must not become new local outbox work.
