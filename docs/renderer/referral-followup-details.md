# Referral follow-up visit details

The Record follow-up form in Referral Worklist and Follow-up Due includes three
optional fields:

- **Facility visited** records the clinic or hospital the patient visited. It is
  independent of the installation's configured screening location.
- **Date seen** records the provider visit date, separately from the follow-up
  contact date. It starts blank and is not inferred from the current date.
- **Provider advice** records advice reported during the follow-up, separately
  from structured treatment actions and medication changes.

Facility names are limited to 255 characters and advice to 2,000 characters.
Text is trimmed before submission. Empty or whitespace-only text and an empty
visit date are sent as `null`, preserving unknown values. All three fields can be
left blank, including when a provider visit is confirmed.

The form uses the existing `referrals.recordFollowup` IPC request fields
`facilityName`, `dateSeen`, and `reportedMedicationsOrAdvice`. Main-process
validation, append-only persistence, and synchronization already support these
fields; this change needs no schema migration or sync contract update. Saved
values appear in desktop follow-up history and remain available to reports and
the web Patient Viewer after synchronization. Historical follow-ups are not
changed or filled from installation configuration.

## Manual verification

1. Open an active referral for a development patient and choose Record follow-up.
2. Enter a facility, provider visit date, and advice, then save the follow-up.
3. Reopen the referral and check the saved values in Follow-up history.
4. With the API and desktop running, allow automatic sync to run. Reopen the
   patient in the web Patient Viewer and check the same follow-up under View
   history. The existing web labels are Facility, Date seen, and Reported advice.
5. On another follow-up, leave the three fields blank. Saving must succeed and
   must not copy the previous follow-up's details or the screening location.
