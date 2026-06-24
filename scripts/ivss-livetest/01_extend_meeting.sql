-- Gia hạn meeting IVSS-TEST-001 (tránh end_time quá hạn làm enroll/presence fail).
UPDATE meetings
SET end_time = now() + interval '1 day', status = 'in_progress'
WHERE meeting_code = 'IVSS-TEST-001';
-- kiểm:
SELECT meeting_code, status, start_time, end_time FROM meetings WHERE meeting_code = 'IVSS-TEST-001';
