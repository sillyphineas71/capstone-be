# Quickstart: Tạo chương trình họp (UC-MM-09)

## Test scenarios

### Scenario 1: Happy path (AC-001)
1. Seed: Tạo meeting với status `scheduled`, host A, 1 participant B
2. Host A gửi PUT /meetings/{id}/agendas với 2 items hợp lệ
3. Verify: 200, 2 items trong response, `agenda_order = [1,2]`
4. Verify: audit_logs có bản ghi mới

### Scenario 2: Read permission (AC-004)
1. Participant B gửi GET /meetings/{id}/agendas
2. Verify: 200, danh sách items (có thể rỗng)

### Scenario 3: Write permission denied (AC-006)
1. Participant B gửi PUT /meetings/{id}/agendas
2. Verify: 403 AGENDA_WRITE_FORBIDDEN

### Scenario 4: Duration overflow (AC-010)
1. Tạo meeting 60 phút
2. Gửi PUT với tổng plannedDurationMinutes = 75
3. Verify: 422 AGENDA_DURATION_OVERFLOW, overflowMinutes = 15

### Scenario 5: Owner invalid (AC-011)
1. Gửi PUT với ownerId không thuộc meeting_participants
2. Verify: 422 AGENDA_OWNER_NOT_PARTICIPANT

### Scenario 6: Empty clear (AC-003)
1. Tạo meeting có 2 agenda items
2. Gửi PUT với items = []
3. Verify: 200, items = []

### Scenario 7: No-op (AC-018)
1. GET agenda hiện tại
2. Gửi PUT với payload giống hệt
3. Verify: 200, không thay đổi updated_at, không audit log mới

### Scenario 8: Max items (AC-020)
1. Gửi PUT với 51 items
2. Verify: 422 AGENDA_ITEM_LIMIT_EXCEEDED

### Scenario 9: Title too long (AC-026)
1. Gửi PUT với title 256 ký tự
2. Verify: 422 AGENDA_TITLE_TOO_LONG

### Scenario 10: Meeting blocked (AC-017)
1. Tạo meeting với status `pending_approval`
2. Gửi PUT agendas
3. Verify: 409 AGENDA_MEETING_STATUS_BLOCKED

## Verification notes

- Mọi test scenario có thể chạy unit test (service) hoặc e2e
- Audit log verification cần kiểm tra audit_logs table hoặc mock AuditLogService
- Permission test cần mock JWT token với các role khác nhau
