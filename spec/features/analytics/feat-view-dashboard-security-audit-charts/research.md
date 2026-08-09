# Research: AA-DASHBOARD-CHARTS-001 — Dashboard Chart APIs (Security Alerts Daily Trend + Audit Activity Hourly)

**Created**: 2026-08-09

## Codebase Analysis

### Analytics module
- Module `analytics/` đã tồn tại với 10 controller/service/repository con (`dashboard-overview`, `meeting-*`, `on-time-rate`, `room-*`...). Feature này thêm 2 controller/service/repository nhỏ gọn tương tự `on-time-rate`/`meeting-count-by-period` nhưng KHÔNG cần scope theo phòng ban (dashboard toàn hệ thống).
- `AnalyticsModule` đã import `AdministrationModule` (dùng `AuditLogsService.logAction()`), không cần import thêm gì để ghi audit log non-blocking.
- Không có repository nào trong `analytics/` đọc trực tiếp `security_alerts` hoặc `audit_logs` — cần thêm import entity/DataSource mới, theo đúng pattern raw SQL đã dùng ở `AuditLogQueryRepository` (`administration/repositories/audit-log-query.repository.ts`), không dùng TypeORM QueryBuilder.

### SecurityAlertEntity (`src/modules/alerts/entities/security-alert.entity.ts`)
- Cột thật: `id, alertType, severity, zoneId, status, triggeredAt, lastSeenAt, occurrenceCount, sourceEventId, ruleId, payloadJson, acknowledgedBy/At, resolvedBy/At/Note, createdAt, updatedAt`.
- KHÔNG soft-delete (append-only audit trail — comment entity dòng 19).
- Dedup logic: alert đang mở tiếp diễn → UPDATE `last_seen_at`/`occurrence_count` trên bản ghi cũ, KHÔNG INSERT mới (comment dòng 23-30). => group theo `triggered_at`, không phải `last_seen_at`/`updated_at`.
- `ALERT_TYPES` (`src/modules/alerts/dto/create-alert-rule.dto.ts`): `stranger | vehicle_control_match | crowd | intrusion` — đúng khớp 4 giá trị ví dụ trong tài liệu FE.

### AuditLogEntity (`src/modules/administration/entities/audit-log.entity.ts`)
- Cột thật: `id, userId, actionType, entityType, entityId, oldValueJson, newValueJson, ipAddress, userAgent, requestId, createdAt, severity, metadataJson`.
- Tài liệu FE xác nhận rõ "không phân loại action" — chỉ COUNT(*) theo giờ, không filter `action_type`/`severity`.
- Đã có `AuditLogQueryRepository` cho UC-AA-11 (list phân trang) — module riêng biệt, KHÔNG tái sử dụng trực tiếp (mục đích khác: list vs aggregate theo giờ). Viết repository mới riêng cho feature này trong `analytics/repositories/`, theo đúng nguyên tắc module boundary (không import chéo giữa `administration/repositories` và `analytics/repositories`).

### Permission convention đã xác nhận
- `analytics.<domain>.read` là convention nhất quán cho mọi endpoint trong `analytics/` (`analytics.meeting.read`, `analytics.attendance.read`, `analytics.room.read`, `analytics.overview.read`) — xem các migration `202607020{5,6,7}0000-SeedAnalytics*ReadPermission.ts`.
- `security_alert.read` (module `alerts`) gán cả `MANAGER` — KHÔNG phù hợp tái dùng cho API 1 (chỉ `SYSTEM_ADMIN, BUSINESS_ADMIN` theo tài liệu FE).
- `audit.system.read` (module `audit`) gán đúng 1 role `SYSTEM_ADMIN` — khớp hành vi mong muốn cho API 2, nhưng để giữ đúng convention `analytics.*` riêng biệt, quyết định tạo permission mới `analytics.audit_activity.read` thay vì tái dùng permission khác module (§0.6 spec.md).

### FE code thật (đối chiếu để xác nhận tài liệu hợp lệ)
- `FE_SmarTracking/src/pages/systemAdmin/dashBoard.jsx`: đúng là trang cần 2 API mới, đã gọi `getBusinessAdminSummary`, `getDevices`, `getSecurityAlerts`, `getAdminVehicleTrafficStats`, `getAuditLogs`, `getZones`, `getVehicleControlList` qua `Promise.allSettled`.
- API client: `FE_SmarTracking/src/utils/request.js` — fetch wrapper, base URL `REACT_APP_API_BASE_URL` (mặc định `https://api.smartracking.io.vn/api/v1`), tự unwrap `{success, data, meta}`.
- 2 chart hiện tại liên quan: `deviceTypeData` (bar chart loại thiết bị — không liên quan), `hourlyLogsData` (SVG line/area, mock 6 mốc giờ "08:00–18:00" — placeholder gần đúng cho API 2 nhưng sai loại chart/số bucket, FE sẽ cần sửa lại UI, không thuộc phạm vi BE).

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` (đã tồn tại) | Không tạo module mới, đúng CLAUDE.md |
| Query style | Raw parameterized SQL qua `DataSource.query()` | Đúng pattern `AuditLogQueryRepository`; GROUP BY + `AT TIME ZONE` không cần TypeORM QueryBuilder phức tạp |
| Timezone | Cố định `Asia/Ho_Chi_Minh` trong SQL (`AT TIME ZONE`) | Đúng §0.7 spec.md, nhất quán các repository analytics khác |
| Zero-fill | Sinh đủ bucket ở tầng service (TypeScript), map kết quả DB vào bucket theo key | Đúng pattern `on-time-rate.service.ts`/`meeting-count-by-period` — không dùng `generate_series` SQL |
| Permission | 2 permission mới `analytics.security_alerts.read`, `analytics.audit_activity.read`, seed qua migration | Đúng convention `analytics.*` + đúng role mapping tài liệu yêu cầu (§0.6) |
| Validation | class-validator + `ValidationPipe({whitelist:true, transform:true})` per-route | Đồng nhất toàn repo |
| Audit logging | Tái dùng `AuditLogsService.logAction()`, non-blocking (try/catch + logger.warn) | Đúng pattern `on-time-rate.service.ts` |
| DB changes | Không — chỉ thêm 2 dòng `permissions` + role mapping | Read-only feature |

## Risks

| Risk | Mitigation |
|---|---|
| Group theo `triggered_at` bỏ sót occurrence lặp lại ở ngày sau (CL-1) | Chấp nhận theo quyết định §0.3; ghi rõ trade-off, có thể nâng cấp sau nếu phát sinh vấn đề thực tế |
| `byType` không nhất quán 100% với ví dụ tài liệu gốc (CL-2) | Diễn giải theo hướng nhất quán nhất (chỉ liệt kê type > 0), ghi rõ trong spec để FE xác nhận khi tích hợp |
| Query audit_logs theo giờ có thể scan nhiều bản ghi nếu hệ thống hoạt động nhiều (nghìn record/ngày) | Giới hạn đúng 1 ngày (`WHERE created_at BETWEEN ...`) để giảm phạm vi quét. Xác nhận `audit_logs`/`security_alerts` **hiện chưa có index riêng** trên `created_at`/`triggered_at` (kiểm tra trực tiếp `db_schema.sql` — bảng chỉ có PK). Chấp nhận rủi ro ở quy mô hiện tại (feature Medium priority); nếu dữ liệu lớn gây chậm, thêm index là việc của migration riêng, ngoài phạm vi feature này (không tự ý đổi schema ngoài yêu cầu — CLAUDE.md mục 5.4). |
