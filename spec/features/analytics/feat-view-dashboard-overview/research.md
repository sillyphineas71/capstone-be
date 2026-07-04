# Research: UC-AA-01 / UC-148 — Xem dashboard tổng quan hệ thống

**Created**: 2026-07-02

## Codebase Analysis

### Analytics module
- `analytics.module.ts` hiện là `@Module({})` rỗng, nhưng đã được import trong `app.module.ts` — không cần đăng ký module mới trong `AppModule`.
- `MODULE_CODE_ALLOWLIST` (`src/modules/accounts/constants/permission-module-allowlist.constant.ts`) đã có sẵn `'analytics'` — permission `analytics.overview.read` có thể tạo qua `CreatePermissionDto` hiện có, không cần sửa allowlist.
- Chưa có permission nào seed cho module `analytics` (grep toàn repo không ra seed file nào chứa `analytics.*`).

### Meetings module — precedent phân quyền theo phòng ban
- `meetings.service.ts:4670-4685` đã có sẵn logic scope Manager dùng cho danh sách `meeting_requests`:
  ```sql
  requester.direct_manager_id = :userId
  OR requester.department_id IN (SELECT d.id FROM departments d WHERE d.manager_user_id = :userId)
  ```
  và check admin qua `roles.some(r => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN')` từ `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)`.
- Dashboard **không** dùng nhánh `direct_manager_id` (khác nhu cầu — approval routing cá nhân vs. dashboard theo phòng ban), chỉ dùng nhánh `departments.manager_user_id`.

### Auth/permission infra
- `AuthzReadRepository.getEffectiveRolesAndPermissions(userId)` trả `{ roles: string[], permissions: string[] }` — dùng để lấy cả role_code lẫn permission_code trong 1 query.
- `RequirePermissions(...)` decorator (`src/modules/auth/decorators/require-permissions.decorator.ts`) + `PermissionsGuard` (`src/modules/auth/guards/permissions.guard.ts`) đã có sẵn, ném `ForbiddenException` chuẩn envelope `{success:false, message, error:{code:'FORBIDDEN', details:{}}}`.
- `CurrentUser` decorator trả `{ userId: string }` (không có `role` sẵn trong payload) — muốn biết role/scope phải gọi `AuthzReadRepository` riêng trong service.

### Entities xác nhận field thật (camelCase TypeORM, không suy đoán)
- `MeetingEntity`: `organizerId`, `hostId`, `roomId`, `status` (enum `MeetingStatus`), `startTime`, `endTime`, `deletedAt`.
- `RoomBookingEntity`: `meetingId`, `roomId`, `reservedStartTime`, `reservedEndTime`, `status` (enum `RoomBookingStatus`: pending/approved/active/completed/cancelled/released).
- `RoomBookingUsageEntity`: `bookingId`, `meetingId`, `roomId`, `reservedStartTime/reservedEndTime`, `actualStartTime/actualEndTime`, `firstPresenceAt/lastPresenceAt`, `usageStatus`.
- `NoShowCaseEntity`: `bookingId`, `meetingId`, `roomId`, `detectionStatus` (enum: risk/confirmed/warning_sent/released/dismissed/resolved).
- `AttendanceRecordEntity`: `meetingId`, `userId`, `isPresent`, `isLate`, `attendanceStatus`.
- `RecordingSessionEntity`: `meetingId`, `startedAt`.
- `DepartmentEntity`: `managerUserId`, `parentDepartmentId` (không dùng cho feature này — không rollup).
- `UserEntity`: `departmentId`, `directManagerId` (không dùng cho feature này).

### system_configs precedence pattern (tái dùng)
- `no-show-detection.service.ts:readThreshold()` đã implement pattern `system_configs[key] → env → default` cho `no_show.threshold_minutes`. Feature này tái dùng đúng pattern cho `analytics.dashboard_max_range_days` (key mới, không phải bảng mới).
- `SystemConfigEntity` cột: `config_key`, `config_value`, `config_json`, `value_type`, `config_group` (NOT NULL), `version_no`, `is_active`, `updated_by`, `updated_at`.

### WebSocket — lý do không dùng cho feature này
- `WebsocketService.emitToRoom/emitToUser/emitToAll` đã tồn tại và được dùng bởi `live-meeting`, `rooms` (no-show/early-vacancy), `presence`, `face-access`, `transcription`. Không có module nào hiện emit sự kiện dành riêng cho "dashboard invalidate".
- Để dashboard tự refetch qua WebSocket, cần sửa thêm ở các service của `live-meeting`, `rooms`, `attendance`, `presence` để bắn thêm 1 event mới — vượt module boundary của `analytics`. Quyết định: KHÔNG làm trong feature này (xem spec §8), "real-time" đáp ứng bằng on-demand aggregation (đọc lại DB mỗi request).

### API Contract
- `docs/API_CONTRACT_v1.0_with_system_roles.md` mục 16, UC-148 đã định nghĩa sẵn: `GET /api/v1/analytics/dashboard/overview`, permission `analytics.overview.read`, roles `MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`, query `from/to/departmentId/roomId`, response `period, meetingCount, activeRooms, utilizationRate, noShowRate, recordingCount, trend`.
- Response mẫu **thiếu** `activeUserCount` mà UC-AA-01 (yêu cầu trực tiếp người dùng) đòi hỏi — đã bổ sung field này, xem RECON ở `spec.md` §0.

## Technology Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Module | `analytics/` | Module đã tồn tại (rỗng), đã import ở `app.module.ts` |
| ORM | TypeORM (query builder / raw parameterized SQL cho aggregate phức tạp) | Project constraint — không dùng Prisma, không nối chuỗi SQL |
| Auth | `JwtAuthGuard` + `RequirePermissions('analytics.overview.read')` + `PermissionsGuard` | Convention project |
| Scope resolution | Raw SQL subquery `SELECT id FROM departments WHERE manager_user_id = :userId` | Đúng precedent `meetings.service.ts:4670-4685`, không tạo abstraction mới ngoài yêu cầu |
| Validation | class-validator + `ValidationPipe` per-route | Codebase thực tế KHÔNG bật `ValidationPipe` global trong `main.ts` (khác với CLAUDE.md mục 13.2) — mọi feature khác (`attendance`, `no_show`) đều áp `ValidationPipe` per-route; feature này theo đúng convention thực tế đang áp dụng nhất quán trong repo |
| Config | `system_configs['analytics.dashboard_max_range_days']` → env `ANALYTICS_DASHBOARD_MAX_RANGE_DAYS` → default 366 | Tái dùng pattern `no_show.threshold_minutes` |
| DB changes | None | Read-only, chỉ SELECT/aggregate |

## Risks

| Risk | Mitigation |
|---|---|
| Aggregate query nặng khi range lớn / nhiều phòng ban | FR-021/NFR-003 chặn range vượt ngưỡng tại tầng validate DTO trước khi chạy query |
| Nhiều JOIN (meetings × room_bookings × room_booking_usages × no_show_cases × attendance_records × recording_sessions) có thể chậm nếu thiếu index | NFR-008 dựa trên index sẵn có (`start_time/end_time`, `organizer_id`, `meeting_id`) — không cần migration thêm index nếu index đã tồn tại theo `database_v3_2_compact_39_tables.md` |
| Field-level leak scope Manager qua `roomId` filter (rooms không thuộc phòng ban) | `roomId` chỉ filter thêm SAU khi đã áp scope phòng ban ở tầng query (FR-015 + FR-024) — không bypass scope |
| Định nghĩa `activeUserCount` bổ sung ngoài UC-148 gốc có thể gây lệch với FE nếu FE đã code cứng theo response mẫu cũ | Ghi rõ trong spec + đề xuất đồng bộ `API_CONTRACT` ở task riêng (Out of Scope §8.2) |
