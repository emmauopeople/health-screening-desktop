ALTER TABLE lifestyle_physical_activity_weekly_records
  ADD COLUMN sedentary_time_response TEXT NULL CHECK (
    sedentary_time_response IN (
      'RECORDED',
      'UNKNOWN',
      'UNABLE_TO_ANSWER',
      'DECLINED',
      'PREFER_NOT_TO_ANSWER'
    )
  );

UPDATE lifestyle_physical_activity_weekly_records
SET sedentary_time_response = 'RECORDED'
WHERE sedentary_minutes_per_day IS NOT NULL;

ALTER TABLE lifestyle_drafts
  ADD COLUMN other_activity_response TEXT NULL CHECK (
    other_activity_response IN ('YES', 'NO', 'UNKNOWN', 'DECLINED', 'PREFER_NOT_TO_ANSWER')
  );

UPDATE lifestyle_drafts
SET other_activity_response = 'YES'
WHERE EXISTS (
  SELECT 1
  FROM lifestyle_other_activity_rows
  WHERE lifestyle_other_activity_rows.lifestyle_draft_id = lifestyle_drafts.id
);
