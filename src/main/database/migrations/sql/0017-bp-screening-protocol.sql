UPDATE protocol_versions
SET configuration_json = '{"bpScreening":{"rulesetKey":"community-bp-screening","rulesetVersion":"1","initialRestMinutes":5,"repeatIntervalMinutes":1,"repeatSystolicThreshold":140,"repeatDiastolicThreshold":90,"urgentSystolicThreshold":180,"urgentDiastolicThreshold":120,"summaryMethod":"MEAN_OF_LAST_TWO"}}',
    checksum = 'cc290a8e3776f963352e256f59c4ce24e15aed807371f4e913f61f5d51abd01d'
WHERE protocol_key = 'health-screening-baseline'
  AND version_label = '1'
  AND configuration_json = '{}'
  AND checksum = '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';
