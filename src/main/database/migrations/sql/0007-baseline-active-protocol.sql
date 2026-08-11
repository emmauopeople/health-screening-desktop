INSERT INTO protocol_versions (
  id,
  protocol_key,
  version_label,
  status,
  effective_at,
  configuration_json,
  checksum,
  imported_by,
  imported_at,
  activated_by,
  activated_at,
  created_at
)
SELECT
  '00000000-0000-4000-8000-000000000007',
  'health-screening-baseline',
  '1',
  'ACTIVE',
  '1970-01-01T00:00:00.000Z',
  '{}',
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  NULL,
  '1970-01-01T00:00:00.000Z',
  NULL,
  '1970-01-01T00:00:00.000Z',
  '1970-01-01T00:00:00.000Z'
WHERE NOT EXISTS (
  SELECT 1
  FROM protocol_versions
);
