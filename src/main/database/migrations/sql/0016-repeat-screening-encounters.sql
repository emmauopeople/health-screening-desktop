DROP INDEX ux_screening_encounters_root_session_patient;

CREATE UNIQUE INDEX ux_screening_encounters_root_session_patient
  ON screening_encounters (screening_session_id, patient_id)
  WHERE amendment_of_encounter_id IS NULL AND status = 'DRAFT';
