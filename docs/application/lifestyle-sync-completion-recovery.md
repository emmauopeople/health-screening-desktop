# Lifestyle upload completion and recovery

A completed Lifestyle section can exist while the overall screening encounter is
still a draft. The desktop previously uploaded that section too early, and the
API returned a permanent `LIFESTYLE_ENCOUNTER_STATE_INVALID` rejection. Completing
the encounter later did not create another Lifestyle delivery.

The desktop now waits for a completed, local, original encounter before reserving
Lifestyle signals. Draft signals remain pending and become eligible when the
encounter completes. Voided, amended and imported encounters remain ineligible.
Patient, session and location context must agree with the Lifestyle snapshot.

For one Lifestyle source revision, later signals reuse the original record
envelope only when all content and provenance match. A changed snapshot at the
same revision fails closed. No clinical version, timestamp or field is rewritten.

An earlier state rejection is eligible for one automatic recovery signal when:

- its only error is the non-retryable `LIFESTYLE_ENCOUNTER_STATE_INVALID` at
  `/payload/localEncounterId`;
- the current encounter is eligible and the current completed Lifestyle record
  is identical to the original source revision and record envelope;
- no later saved outcome supersedes that rejection and no recovery signal for
  that Lifestyle revision already exists.

Recovery uses a new batch with the unchanged record. Existing batch requests,
responses and clinical records remain untouched. The new signal participates in
normal acknowledgment and dependency retry handling. Once attempted, a permanent
rejection does not create repeated new recovery signals.

## Deployment and verification

Update and restart the coordinated CHS-web API fix **before** starting this
desktop version. The API treats a draft encounter as a retryable dependency and
can reconsider the exact legacy state rejection. All context, provenance,
period, immutable-baseline and duplicate checks remain in force.

No database migration or data reset is required. On Windows:

1. With the API running, finish a normal synthetic screening. Pause after
   completing Lifestyle before completing the encounter: Lifestyle must remain
   queued during that pause.
2. Complete the encounter. Allow the scheduled sync to upload the encounter and
   Lifestyle, then verify the completed Lifestyle data in Patient Viewer.
3. For an unchanged completed Lifestyle previously rejected by this state rule,
   verify a later accepted/unchanged outcome without duplicate history.
4. Run another sync cycle and confirm no additional canonical Lifestyle row is
   created. Historical rejected batches remain historical evidence.

Voided encounters, other rejection codes and changed/obsolete snapshots are not
automatically repaired. They require separate investigation. If an older API
receives the one recovery attempt, update the API and investigate the remaining
rejection rather than clearing the queue or editing clinical records.
