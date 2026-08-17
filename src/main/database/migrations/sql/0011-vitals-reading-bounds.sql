CREATE TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_insert
BEFORE INSERT ON screening_vitals_draft_readings
FOR EACH ROW
WHEN NEW.systolic IS NOT NULL AND (
  typeof(NEW.systolic) <> 'integer' OR
  NEW.systolic < 1 OR
  NEW.systolic > 300
)
BEGIN
  SELECT RAISE(ABORT, 'systolic out of range');
END;

CREATE TRIGGER ck_screening_vitals_draft_readings_systolic_bounds_update
BEFORE UPDATE OF systolic ON screening_vitals_draft_readings
FOR EACH ROW
WHEN NEW.systolic IS NOT NULL AND (
  typeof(NEW.systolic) <> 'integer' OR
  NEW.systolic < 1 OR
  NEW.systolic > 300
)
BEGIN
  SELECT RAISE(ABORT, 'systolic out of range');
END;

CREATE TRIGGER ck_screening_vitals_draft_readings_diastolic_bounds_insert
BEFORE INSERT ON screening_vitals_draft_readings
FOR EACH ROW
WHEN NEW.diastolic IS NOT NULL AND (
  typeof(NEW.diastolic) <> 'integer' OR
  NEW.diastolic < 1 OR
  NEW.diastolic > 120
)
BEGIN
  SELECT RAISE(ABORT, 'diastolic out of range');
END;

CREATE TRIGGER ck_screening_vitals_draft_readings_diastolic_bounds_update
BEFORE UPDATE OF diastolic ON screening_vitals_draft_readings
FOR EACH ROW
WHEN NEW.diastolic IS NOT NULL AND (
  typeof(NEW.diastolic) <> 'integer' OR
  NEW.diastolic < 1 OR
  NEW.diastolic > 120
)
BEGIN
  SELECT RAISE(ABORT, 'diastolic out of range');
END;

CREATE TRIGGER ck_screening_vitals_draft_readings_pulse_bounds_insert
BEFORE INSERT ON screening_vitals_draft_readings
FOR EACH ROW
WHEN NEW.pulse IS NOT NULL AND (
  typeof(NEW.pulse) <> 'integer' OR
  NEW.pulse < 1 OR
  NEW.pulse > 300
)
BEGIN
  SELECT RAISE(ABORT, 'pulse out of range');
END;

CREATE TRIGGER ck_screening_vitals_draft_readings_pulse_bounds_update
BEFORE UPDATE OF pulse ON screening_vitals_draft_readings
FOR EACH ROW
WHEN NEW.pulse IS NOT NULL AND (
  typeof(NEW.pulse) <> 'integer' OR
  NEW.pulse < 1 OR
  NEW.pulse > 300
)
BEGIN
  SELECT RAISE(ABORT, 'pulse out of range');
END;
