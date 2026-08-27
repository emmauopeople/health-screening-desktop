CREATE TABLE referral_followup_actions (
  id TEXT PRIMARY KEY,
  followup_id TEXT NOT NULL,
  action_code TEXT NOT NULL CHECK (
    action_code IN ('TREATMENT_INITIATED', 'TREATMENT_MODIFIED', 'NEW_MEDICATION')
  ),
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  CONSTRAINT uq_referral_followup_actions_code UNIQUE (followup_id, action_code),
  CONSTRAINT uq_referral_followup_actions_sequence UNIQUE (followup_id, sequence_number),
  CONSTRAINT fk_referral_followup_actions_followup FOREIGN KEY (followup_id)
    REFERENCES followups (id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE TABLE referral_followup_medication_changes (
  id TEXT PRIMARY KEY,
  followup_id TEXT NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('NEW_MEDICATION', 'TREATMENT_MODIFIED')),
  medication_name TEXT NOT NULL CHECK (
    TRIM(medication_name) != '' AND medication_name = TRIM(medication_name)
    AND length(medication_name) <= 255
  ),
  dosage TEXT NULL CHECK (
    dosage IS NULL OR (TRIM(dosage) != '' AND dosage = TRIM(dosage) AND length(dosage) <= 255)
  ),
  frequency TEXT NULL CHECK (
    frequency IS NULL OR (
      TRIM(frequency) != '' AND frequency = TRIM(frequency) AND length(frequency) <= 255
    )
  ),
  sequence_number INTEGER NOT NULL CHECK (sequence_number >= 1),
  CONSTRAINT uq_referral_followup_medication_changes_sequence
    UNIQUE (followup_id, sequence_number),
  CONSTRAINT fk_referral_followup_medication_changes_followup FOREIGN KEY (followup_id)
    REFERENCES followups (id) ON UPDATE RESTRICT ON DELETE CASCADE
) STRICT;

CREATE INDEX ix_referral_followup_actions_followup
  ON referral_followup_actions (followup_id, sequence_number);

CREATE INDEX ix_referral_followup_medication_changes_followup
  ON referral_followup_medication_changes (followup_id, sequence_number);
