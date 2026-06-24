SELECT
  payload_json->>'matchState' AS match_state,
  payload_json->>'szUid'      AS event_szuid,
  payload_json->>'userId'     AS user_id,
  payload_json->>'channelId'  AS channel,
  payload_json->>'direction'  AS direction,
  room_id, meeting_id, created_at
FROM iot_device_events
WHERE event_type = 'ivss_face_event'
ORDER BY created_at DESC
LIMIT 10;
