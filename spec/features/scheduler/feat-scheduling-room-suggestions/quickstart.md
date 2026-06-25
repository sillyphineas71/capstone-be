# 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-16 | Tạo mới quickstart.md cho UC-SM-01 | Toàn bộ file |

---

# Quickstart: UC-SM-01 — Xem danh sách phòng họp đề xuất

> Danh sách kịch bản test chính và verification notes.

## Test Scenarios

### S1: Happy Path — Có phòng phù hợp
**Input**: `startTime=2026-06-10T09:00:00+07:00`, `endTime=2026-06-10T11:00:00+07:00`, `attendeeCount=5`
**Expected**: HTTP 200, data array có ít nhất 1 phòng, `score > 0`, `available = true`, `matchedFeatures = []`
**Verify**:
- [ ] Tất cả room trả về có `capacity >= 5`
- [ ] Tất cả room có `is_active = true`
- [ ] Tất cả room không có booking overlap
- [ ] Kết quả sorted theo `capacity - attendeeCount` ASC

### S2: Happy Path — Có filter thiết bị
**Input**: ... + `hasCamera=true&hasMicrophone=true`
**Expected**: HTTP 200, data array chỉ gồm phòng có ít nhất 1 camera healthy + 1 microphone healthy
**Verify**:
- [ ] `matchedFeatures` chứa `["camera", "microphone"]`
- [ ] Phòng không có camera bị loại

### S3: Validation — Thiếu startTime
**Input**: `/api/v1/scheduling/room-suggestions?endTime=...&attendeeCount=5`
**Expected**: HTTP 422, `VALIDATION_ERROR`

### S4: Validation — endTime <= startTime
**Input**: `startTime=2026-06-10T11:00:00+07:00&endTime=2026-06-10T09:00:00+07:00`
**Expected**: HTTP 422, `SCHEDULING_DURATION_TOO_LONG`

### S5: Validation — Khoảng thời gian > 24h
**Input**: `startTime=2026-06-10T09:00:00+07:00&endTime=2026-06-11T10:00:00+07:00`
**Expected**: HTTP 422, `SCHEDULING_DURATION_TOO_LONG`

### S6: Validation — startTime trong quá khứ
**Input**: `startTime=2020-01-01T09:00:00+07:00`
**Expected**: HTTP 422, `VALIDATION_ERROR`

### S7: Validation — attendeeCount <= 0
**Input**: `attendeeCount=0` hoặc `attendeeCount=-5`
**Expected**: HTTP 422, `VALIDATION_ERROR`

### S8: Auth — Chưa đăng nhập
**Input**: Gọi API không có `Authorization` header
**Expected**: HTTP 401

### S9: Auth — Không đủ quyền
**Input**: Gọi API với user không có permission `scheduling.suggest.rooms`
**Expected**: HTTP 403

### S10: Business Rule — Phòng maintenance/inactive
**Input**: Bất kỳ input hợp lệ
**Verify**:
- [ ] Phòng có `current_status = maintenance` hoặc `inactive` không xuất hiện trong kết quả

### S11: Business Rule — Booking overlap
**Input**: `startTime=2026-06-10T09:00:00+07:00&endTime=2026-06-10T11:00:00+07:00`
Với room đang có booking `reserved_start=09:30, reserved_end=10:30, status=pending`
**Verify**:
- [ ] Phòng đó không xuất hiện trong kết quả

### S12: Business Rule — Capacity không đủ
**Input**: `attendeeCount=50` (capacity max = 30)
**Expected**: HTTP 200, data = []

### S13: Business Rule — Sort priority
**Input**: `attendeeCount=5`
Với 3 rooms: capacity 6, 10, 8
**Verify**:
- [ ] Thứ tự: capacity 6 (diff=1) → 8 (diff=3) → 10 (diff=5)
- [ ] Nếu diff bằng nhau: sort theo room_name ASC → room_code ASC

### S14: Business Rule — Equipment EXISTS logic
**Input**: `hasCamera=true`
Với room có 1 camera healthy + 1 camera faulty
**Verify**:
- [ ] Room vẫn được đề xuất
- [ ] `matchedFeatures` chỉ chứa `"camera"` (không duplicate)

### S15: Business Rule — Không filter khi false
**Input**: `allowRecording=false&hasCamera=false`
**Verify**:
- [ ] Phòng có `allow_recording=false` vẫn được đề xuất
- [ ] Phòng không có camera vẫn được đề xuất

### S16: Empty result
**Input**: Thời gian từ 1 năm sau với attendeeCount rất lớn
**Expected**: HTTP 200, data = [], message khớp spec

### S17: Business Rule — Back-to-back booking
**Input**: `startTime=2026-06-10T11:00:00+07:00&endTime=2026-06-10T12:00:00+07:00`
Với room có booking `reserved_end=11:00` (kết thúc đúng lúc)
**Verify**:
- [ ] Room vẫn được đề xuất (back-to-back, không buffer time)

### S18: Business Rule — Limit 20 rooms
**Input**: Bất kỳ input cho ra > 20 phòng đáp ứng
**Verify**:
- [ ] Kết quả chỉ có 20 items
- [ ] `meta.totalRoomsFound` = tổng số phòng đáp ứng
- [ ] `meta.resultLimit` = 20

## Verification Notes

- [ ] Response format đúng convention: `{ success, message, data, meta }`
- [ ] Field names dùng camelCase (API convention)
- [ ] `matchedFeatures` chỉ liệt kê equipment type đã được yêu cầu và thực sự có
- [ ] `warnings` chỉ xuất hiện nếu thiết bị yêu cầu nhưng không có
- [ ] Không có pagination (không dùng page/limit query params)
- [ ] Audit log không bắt buộc cho read-only action (optional)
- [ ] Unit test coverage: DTO validation, service logic, controller
