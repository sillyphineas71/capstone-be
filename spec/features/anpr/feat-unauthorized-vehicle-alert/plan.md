# Implementation Plan: Cảnh báo xe không có quyền

**Branch**: `017-unauthorized-vehicle-alert` | **Date**: 2026-07-25 | **Spec**: spec.md

## 1. Feature Summary

Xây dựng cơ chế tự động phát hiện 4 tình huống xe không có quyền qua cổng và tạo cảnh báo:
- (B) Xe trong vehicle_control_list loại blocklist — severity=high
- (C) Xe trong vehicle_control_list loại watchlist — severity=medium
- (A) Xe lạ (không có vehicle_registrations) — severity=medium
- (D) Xe có registrations pending/rejected — severity=low

Priority chain: B > C > A > D (chỉ tạo 1 alert cho tình huống có ưu tiên cao nhất).

Kênh: IN-APP ONLY. Không WebSocket, không Email.

## 2. Technical Context

| Item | Value |
|---|---|
| Framework | NestJS + TypeORM |
| Database | PostgreSQL |
| Module | anpr + alerts |
| Existing service | VehicleControlAlertService.evaluate() (xử lý B, C) |
| Existing service | VehicleResolveService.onVehicleEvent() (trigger) |
| New service needed | Mở rộng evaluate() xử lý A, D + priority chain |
| Dependencies | alerts module, notifications module, zones module |

## 3. Scope Confirmation

**IN SCOPE:**
- Mở rộng evaluate() xử lý 4 tình huống + priority chain
- Resolve zone_id từ channelId (FR-020)
- Thêm permission vehicle_alert.read + seed migration
- Cập nhật alert_rules check cho cả 3 alert_type
- INSERT iot_device_events trước evaluate() (FR-008b)

**OUT OF SCOPE:** (xem spec.md mục 8)
- FE dashboard, WebSocket push, Email notification
- CRUD vehicle_control_list (UC-113) và vehicle_registrations
- Security Alert Center (UC-122/123)

## 4. Data Model Impact

**No new tables.** Tận dụng entities đã có:
- security_alerts: alert_type bổ sung 'unknown_vehicle', 'vehicle_unauthorized'
- notifications: notification_type bổ sung tương ứng
- alert_rules: cần seed rule cho 3 alert_type

**Cần migration:**
- Seed permission vehicle_alert.read (migration riêng)
- Seed alert_rules mặc định cho 3 alert_type (nếu chưa có)
- Áp dụng security_alerts + alert_rules tables lên RDS (nếu chưa)

## 5. API / Contract Plan

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | /api/v1/anpr/unknown-vehicles | JWT | vehicle_alert.read | Danh sách xe lạ |
| POST | /api/v1/anpr/webhook/vehicle | Internal token | - | IVSS webhook (UC-112) |

Internal API (không public):
- VehicleControlAlertService.evaluate(plateNumber, context, eventId)
- VehicleResolveService.onVehicleEvent(evt)

## 6. Authorization Plan

- Permission vehicle_alert.read: seed bằng migration riêng
- Gán cho role: MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN
- API unknown-vehicles: JwtAuthGuard + PermissionGuard(vehicle_alert.read)
- Internal webhook: AnprInternalTokenGuard (internal token)

## 7. Business Logic Plan

### evaluate() mở rộng (core logic)

1. **Throttle check**: plateNumber key, 5 phút, bỏ qua toàn bộ evaluate() nếu trong window
2. **Resolve zone_id**: query iot_devices.zone_id từ channelId (FR-020)
3. **Priority chain**:
   a. Check vehicle_control_list (blocklist > watchlist)
   b. Nếu không match control-list, check vehicle_registrations
   c. Nếu không có registration active -> unknown_vehicle
   d. Nếu có registration pending/rejected -> vehicle_unauthorized
4. **Check alert_rules**: tìm rule cho alert_type tương ứng, nếu suppressed -> skip
5. **recordAlert()**: ghi security_alerts với severity + payload
6. **createNotification()**: in-app notification cho MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN

Tất cả lỗi trong evaluate() đều NotThrow (riêng try/catch cho từng bước).

## 8. Validation Plan

- plateNumber: string(16), không empty, đã normalize (UC-112)
- channelId: integer, nullable -> warning + zone_id=null
- direction: string, fallback 'seen' nếu invalid
- Pagination: page >= 1, limit 1-100, sortBy allowlist

## 9. Error Handling Plan

| Error | Handler | Response |
|---|---|---|
| plateNumber empty | Reject event, log error | NotThrow (skip evaluate) |
| vehicle_registrations DB error | Log warning, skip alert | NotThrow (no false positive) |
| recordAlert fails | Log error, continue notification | NotThrow riêng |
| createNotification fails | Log error | NotThrow (alert vẫn ghi) |
| zone_id not resolved | Log warning, zone_id=null | Không block alert |
| Unauthorized API access | 403 Forbidden | JwtAuthGuard + PermissionGuard |
| IVSS-BRIDGE device chưa seed | Log warning, skip ingest | NotThrow |

## 10. Testing Strategy

- Unit test: evaluate() cho từng tình huống (A, B, C, D)
- Unit test: priority chain (blocklist + active registration -> blocklist wins)
- Unit test: throttle (cùng plate trong 5 phút -> bỏ qua)
- Unit test: NotThrow (DB error, recordAlert fail)
- Unit test: zone_id resolution từ channelId
- Unit test: alert_rules suppressed check cho cả 3 alert_type
- Controller test: GET /unknown-vehicles (auth, pagination, response shape)
- Integration test: full flow webhook -> evaluate -> alert -> notification

## 11. Implementation Phases

### Phase 1: Core Logic (extend evaluate)
- Task 1: Mở rộng evaluate() với priority chain (B>C>A>D)
- Task 2: Thêm check vehicle_registrations cho tình huống A và D
- Task 3: Thêm resolve zone_id từ channelId (FR-020)

### Phase 2: Integration & Permissions
- Task 4: Cập nhật alert_rules check cho cả 3 alert_type
- Task 5: Seed permission vehicle_alert.read (migration)
- Task 6: Thêm guard vehicle_alert.read cho controller

### Phase 3: Error Handling & Edge Cases
- Task 7: INSERT iot_device_events trước evaluate() (FR-008b)
- Task 8: Throttle plateNumber (nếu chưa implement cho A, D)
- Task 9: ERR-006 (DB error skip, không false positive)

### Phase 4: Testing & Documentation
- Task 10: Unit tests cho tất cả tình huống + edge cases
- Task 11: Controller tests + integration test
- Task 12: Update CHANGELOG, commit

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Throttle in-memory reset khi restart | Trùng alert sau restart | Chấp nhận cho capstone scope |
| zone_id null do UC-90-94 chưa hoàn thiện | Alert không gắn zone | Fallback null, log warning |
| vehicle_registrations nhiều biển cho 1 user | Query chậm | Index plate_number, status, deleted_at |
| Permission vehicle_alert.read chưa seed | 403 khi gọi API | Migration seed riêng, test coverage |
| alert_rules chưa seed | Safe default enabled=true | FR-011 rule: không tìm thấy rule -> enabled |

## 13. Acceptance Criteria Traceability

| AC ID | Phase | Test Type | Status |
|---|---|---|---|
| AC-001 Blocklist | Phase 1 | Unit | Planned |
| AC-002 Watchlist | Phase 1 | Unit | Planned |
| AC-003 Unknown vehicle | Phase 1 | Unit | Planned |
| AC-004 Pending/rejected | Phase 1 | Unit | Planned |
| AC-005 Throttle | Phase 3 | Unit | Planned |
| AC-006 NotThrow DB error | Phase 3 | Unit | Planned |
| AC-007 NotThrow notification error | Phase 3 | Unit | Planned |
| AC-008 Suppressed rule | Phase 2 | Unit | Planned |
| AC-009 No recipient | Phase 1 | Unit | Planned |
| AC-010 Zone ID null | Phase 1 | Unit | Planned |
