# Screening Lifestyle Application Service

L3A adds the main-process orchestration boundary for the Lifestyle persistence
foundation. It is intentionally not an IPC, preload, renderer, navigation, or
clinical-interpretation feature.

## Operations

`ScreeningLifestyleService` provides:

- `getLifestyleWorkspace`
- `saveAlcoholBaseline`
- `saveTobaccoBaseline`
- `saveWorkBaseline`
- `saveLifestyleDraft`
- `completeLifestyle`

Every operation returns a controlled status. Loads return `LOADED`; draft and
baseline mutations return `SAVED`; completion returns `COMPLETED` only after its
transaction commits.

## Trusted authority

The service requires an active, unlocked authenticated session and one of the
approved screening roles: `LOCAL_ADMIN`, `NURSE`, or `TRAINED_SCREENER`. The
actor is taken from that session. Installation, patient, encounter, session,
location, lifecycle, timestamps, entity identifiers, audit metadata, and
outbox metadata are resolved or generated in the main process.

The encounter must be a canonical editable `DRAFT` encounter in an open
session whose configured active location and historical attribution agree.
No operation creates, reopens, closes, reassigns, or rewrites a session or
encounter.

## Draft and completion behavior

Loading is read-only and never creates a draft. Creating the first Lifestyle
draft requires the encounter to belong to the authoritative current screening
session, resolved through P1 inside the same transaction. An existing editable
draft may be recovered after logout/login, restart, or date rollover without a
current-session requirement; its attribution and stored weekly period remain
fixed.

Save Draft accepts incomplete, noncontradictory data and sets the service-owned
status to `IN_PROGRESS`. Alcohol, Tobacco, and Physical Activity draft parsers
remain permissive where the screener is still entering a `YES` branch. Stable
child identifiers are reconciled transactionally, and unchanged rows retain
their timestamps.

Completion is separate from draft persistence. It requires exact baseline
references, all required weekly records, non-null top-level responses, the
complete Alcohol/Tobacco/Physical Activity validators, and a Work response.
When Former/Never baseline status conflicts with a weekly `YES`, completion
requires an exact confirmation of the referenced baseline version. The
confirmation is validated in the transaction and recorded only in successful
completion audit/outbox metadata; it is not a draft-schema field. It sets
status to `COMPLETE`; it does not navigate or infer a diagnosis.

## Weekly period

For a new draft, `periodEnd` is the authoritative screening-session date and
`periodStart` is six Gregorian calendar days earlier. The period is stored on
the draft and is never recalculated during recovery.

## Baselines and concurrency

Alcohol, Tobacco, and Work baselines are separate immutable version streams.
Each new version is inserted with trusted patient and installation ownership,
an expected current version, actor, and transaction timestamp. The draft keeps
the exact referenced version IDs; later baseline versions do not rewrite older
weekly records.

Draft row versions and baseline expected versions are checked in the
caller-owned transaction. Equivalent draft retries are idempotent and do not
emit another write, audit event, or outbox event. Stale non-equivalent writes
return `VERSION_CONFLICT`. Transport retries may omit generated weekly and
child IDs only when every supplied mutable field matches exactly one persisted
row; ambiguous or changed rows are never silently reused.

Service results are immutable application summaries. They contain stable IDs,
controlled clinical fields, fixed periods, exact baseline references, child
ordering, calculated weekly minutes, versions, and update timestamps, but not
database ownership columns, actor fields, or parent foreign keys.

## Audit and outbox policy

Successful baseline saves, draft saves, and completion write their established
controlled audit and encounter-outbox events in the same transaction as the
Lifestyle changes. Metadata is limited to identifiers, status/version values,
baseline domain/version identifiers, and child-record counts. Clinical answers,
measurements, free text, demographics, credentials, and full requests are not
logged or emitted.

## Deferred work

L3B will add the trusted IPC and preload boundary. Later tasks will add the
Lifestyle renderer, workflow navigation, recovery UI, and accessibility
hardening. Food, OTC medication, recommendations, referrals, reporting,
printing, synchronization, and FHIR mapping remain deferred.
