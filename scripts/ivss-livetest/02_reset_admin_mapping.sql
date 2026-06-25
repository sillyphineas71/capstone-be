-- CHỈ xóa mapping nguồn ivss; KHÔNG đụng row door-terminal (FaceGate) của cùng user.
DELETE FROM device_user_mappings
WHERE user_id = '649880a3-f6ef-4b2d-81e0-3b848338f265'
  AND metadata_json->>'source' = 'ivss';
-- kiểm còn lại:
SELECT device_person_id, sync_status, metadata_json->>'source' AS source
FROM device_user_mappings WHERE user_id = '649880a3-f6ef-4b2d-81e0-3b848338f265';
