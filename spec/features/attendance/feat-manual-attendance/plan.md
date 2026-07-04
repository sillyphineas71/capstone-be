# Implementation Plan: Điểm danh thủ công (Manual Attendance)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Tạo plan cho UC-B21 (Phương án A: tách controller/service ghi). Ánh xạ 4 endpoint → component; wiring module; ownership-check Host ở service; reuse late-flag từ attendance.service; audit non-blocking. KHÔNG đổi API surface, KHÔNG migration. | Toàn bộ file |
| 2026-06-30 | Vòng revise (xác minh code thật): role_code thật UPPERCASE `SYSTEM_ADMIN`/`BUSINESS_ADMIN` (sửa OQ-1 dùng đúng tên qua `AuthzReadRepository.getEffectiveRolesAndPermissions`); xác nhận AuditLogsService (logAction/logEntityChange + fail-safe) + forFeature đủ entity + late-flag (no grace). Chốt OQ-2 (invalidate: 404 record trước → gate trạng thái sau). §11 hết câu mở. | §3, §4, §4.4, §4.5, §5, §6, §10, §11 |

> Spec đã khóa: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt. Plan-only — chưa tasks/code.

---

## 1. Tổng quan kỹ thuật & cách tiếp cận

UC-B21 bổ sung phần **ghi** (create/update/invalidate) cho module `attendance` vốn chỉ có phần **đọc** (`AttendanceController` GET list + `CheckInAlertController`). Theo **Phương án A** (mặc định, không lệch AGENTS §6.1/§7): **tách controller + service mới cho thao tác ghi**, giữ nguyên file đọc.

Ánh xạ 4 endpoint (spec §5) → component:

| Endpoint (spec) | Controller method | Service method | DTO | Guard + permission |
|---|---|---|---|---|
| `POST …/attendance` (tạo) | `ManualAttendanceController.create` | `ManualAttendanceService.createManual` | `CreateManualAttendanceDto` | `JwtAuthGuard`+`PermissionsGuard` `@RequirePermissions('attendance.manual.create')` |
| `PATCH …/{recordId}/status` | `…updateStatus` | `…updateStatus` | `UpdateAttendanceStatusDto` | `@RequirePermissions('attendance.manual.update')` |
| `PATCH …/{recordId}` (chỉnh hồ sơ) | `…updateProfile` | `…updateProfile` | `UpdateAttendanceProfileDto` | `@RequirePermissions('attendance.manual.update')` |
| `POST …/{recordId}/invalidate` | `…invalidate` | `…invalidate` | `InvalidateAttendanceDto` | `@RequirePermissions('attendance.invalidate')` |

Controller: thin (nhận DTO + `@CurrentUser`, gọi service, trả envelope). Service: business rule + ownership + audit + transaction nếu cần. Bám AGENTS §15.

---

## 2. Danh sách file đụng tới

### 2.1 Tạo mới
| Đường dẫn | Vai trò |
|---|---|
| `src/modules/attendance/controllers/manual-attendance.controller.ts` | Controller ghi: 4 route, prefix `meetings/:meetingId/attendance` (mirror controller đọc), guard + `@RequirePermissions`, `@CurrentUser`, `ParseUUIDPipe` cho `meetingId`/`recordId`, envelope `{success,message,data}`. |
| `src/modules/attendance/services/manual-attendance.service.ts` | Service ghi: `createManual` / `updateStatus` / `updateProfile` / `invalidate` + helper ownership + gọi audit. Inject repo + meeting/participant access + `AuditLogsService` + `AuthzReadRepository`. |
| `src/modules/attendance/dto/create-manual-attendance.dto.ts` | `userId`(IsUUID, bắt buộc), `checkInTime?`(IsISO8601, default `now` ở service), `note?`(IsString,maxLength). |
| `src/modules/attendance/dto/update-attendance-status.dto.ts` | `attendanceStatus`(IsIn các giá trị **trừ** `invalidated`), `reason?`(IsString). |
| `src/modules/attendance/dto/update-attendance-profile.dto.ts` | `checkInTime?`/`checkOutTime?`(IsISO8601), `note?` — ràng buộc ≥1 field (custom validate / service). |
| `src/modules/attendance/dto/invalidate-attendance.dto.ts` | `reason`(IsString, **bắt buộc**, không rỗng). |
| (tuỳ chọn) `src/modules/attendance/dto/manual-attendance-response.dto.ts` | Mapper `toManualAttendanceResponse(entity)` — field công khai (§5 output). Có thể tái dùng `attendance-item.dto.ts` nếu khớp; chốt ở tasks. |

### 2.2 Sửa
| Đường dẫn | Sửa gì |
|---|---|
| `src/modules/attendance/attendance.module.ts` | Đăng ký `ManualAttendanceController` (controllers) + `ManualAttendanceService` (providers). KHÔNG cần import `AdministrationModule` (đã `@Global` → `AuditLogsService` inject sẵn). Repo cần đã có trong `forFeature` (attendance/meeting/participant/user). |
| `src/modules/attendance/services/attendance.service.ts` | **Chỉ nếu** chọn extract late-flag thành method/util dùng chung (§5). Nếu tách util riêng thì KHÔNG sửa file này. Chốt ở tasks. |

> KHÔNG thêm cột entity, KHÔNG migration (bám AC-013). KHÔNG đụng `attendance.controller.ts`/`checkin-alert.*` (read-side).

---

## 3. Wiring module
- `attendance.module.ts`:
  - `controllers: [AttendanceController, CheckInAlertController, ManualAttendanceController]`.
  - `providers: [AttendanceService, CheckInAlertService, ManualAttendanceService]`.
- Phụ thuộc inject vào `ManualAttendanceService`:
  - `@InjectRepository(AttendanceRecordEntity)` — CRUD bản ghi (đã forFeature).
  - Truy cập `meetings` + `meeting_participants` để verify meeting tồn tại/trạng thái, participant, ownership — qua repo đã forFeature (`MeetingEntity`/`MeetingParticipantEntity`) hoặc `DataSource` raw bind (mirror style hiện có).
  - `AuditLogsService` (global) — ghi audit.
  - `AuthzReadRepository` (export bởi `AuthModule` đã import) — `getEffectiveRolesAndPermissions(userId): { roles: string[]; permissions: string[] }` (roles = list `role_code`) để phân biệt Host vs Business/System Admin cho ownership-check (§4.5). Bằng chứng: [authz-read.repository.ts:13](../../../../src/modules/auth/repositories/authz-read.repository.ts).
- `PermissionsGuard` lấy từ `AuthModule` (đã import) — dùng ở controller như UC khác (vd ANPR admin route).

---

## 4. Luồng xử lý từng endpoint (thiết kế, KHÔNG code)

**Chung (mọi endpoint)**: `JwtAuthGuard` (authn) → `PermissionsGuard` (`@RequirePermissions`) → vào service:
1. Validate `meetingId` UUID; load meeting → không có/`deleted_at` → **404 `MEETING_NOT_FOUND`**.
2. **Gate trạng thái meeting** (§1.4-8): nếu `now < start_time` (họp tương lai) → **409 `ATTENDANCE_NOT_OPEN_YET`**.
3. **Ownership-check (Host)** — xem §4.5.

### 4.1 createManual (POST)
1–3 chung. → 4. Validate DTO; `checkInTime` default `now` nếu thiếu. → 5. Kiểm `user` ∈ internal participants (`meeting_participants`, `invitation_status` ≠ `declined`) → không → **422 `USER_NOT_PARTICIPANT`**. → 6. **Pre-check chống trùng**: tồn tại bản ghi `(meetingId,userId)` bất kỳ nguồn → **409 `ATTENDANCE_RECORD_EXISTS`**. → 7. Tính late flags + suy `attendanceStatus` (§5 reuse). → 8. Tạo bản ghi: `checkInMethod=MANUAL`, `attendanceSource=MANUAL`, `participantId`(nếu có), `verifiedBy=actor`, `verifiedAt=now`, `note`. → 9. Audit `create_manual_attendance` (non-blocking). → 10. **201** + bản ghi.

### 4.2 updateStatus (PATCH …/{recordId}/status)
1–3 chung. → 4. Load record theo `recordId`+`meetingId` → **404 `ATTENDANCE_RECORD_NOT_FOUND`**. → 5. Validate `attendanceStatus` ∈ {present,absent,late,left_early,pending_review} (loại `invalidated`) → nếu `invalidated` → **400** (§FR-005). → 6. Set status; audit `update_attendance_status` (fromStatus→toStatus, reason?, actor) non-blocking. → 7. **200** + bản ghi.

### 4.3 updateProfile (PATCH …/{recordId})
1–3 chung. → 4. Load record → 404. → 5. Validate ≥1 field; `checkOutTime` ≥ `checkInTime` → sai → **422 `INVALID_TIME_RANGE`**. → 6. Set field; **tính lại** `isLate`/`lateMinutes`/`leftEarly` từ `meeting.start_time`/end (§5 reuse). **KHÔNG** tự đổi `attendanceStatus` (§1.4-9 — desync chủ ý). → 7. Audit `update_attendance_record` (changedFields, reason?, actor) non-blocking. → 8. **200** + bản ghi.

### 4.4 invalidate (POST …/{recordId}/invalidate) — thứ tự nghiêm ngặt (chốt OQ-2)
authn → **(1)** load record `recordId`+`meetingId` (load meeting kèm theo) → **404 `ATTENDANCE_RECORD_NOT_FOUND`** nếu không có → **(2)** **gate trạng thái-meeting**: `now < start_time` → **409 `ATTENDANCE_NOT_OPEN_YET`** → **(3) 403 `PERMISSION_DENIED`** nếu actor không phải System Admin (`attendance.invalidate`) → **(4) 400 `REASON_REQUIRED`** nếu thiếu `reason` → **(5) 409 `ALREADY_INVALIDATED`** nếu đã `INVALIDATED` → **(6)** set `attendanceStatus=INVALIDATED` (giữ row) → audit `invalidate_attendance` (previousStatus, attendanceSource, reason, actor) non-blocking → **200** + bản ghi.
> Chốt OQ-2: với invalidate, **record-load 404 trước**, rồi gate trạng thái-meeting (409) đặt **sau** record-load nhưng **trước** set INVALIDATED; phần còn lại giữ 403→400→409 như spec §4.4. (Khác create/update: gate trạng thái đặt sớm — §4 chung bước 2.)

### 4.5 Ownership-check cho Host (chốt OQ-1 — ở service, dùng ROLE-NAME)
- Sau khi load meeting (và trước khi mutate): lấy `roles` của actor qua `AuthzReadRepository.getEffectiveRolesAndPermissions(actor.userId)` → `roles: string[]` (list `role_code`).
  - Nếu `roles` chứa **`SYSTEM_ADMIN`** HOẶC **`BUSINESS_ADMIN`** (role_code thật, UPPERCASE — xác minh từ seed `src/database/seeds/`) → **bỏ qua** ownership-check (scope tổ chức/toàn hệ thống).
  - Ngược lại (Host) → verify `meeting.host_id === actor.userId` (hoặc participant của meeting có `participant_role='host'` = actor — theo cách spec mô tả host) → không khớp → **403 `PERMISSION_DENIED`**.
- **KHÔNG** dùng permission `manage_all`; giữ nguyên 3 permission (`attendance.manual.create`/`update`, `attendance.invalidate`).
- Vị trí: trong service, **sau** load meeting (404) + **sau** meeting-status gate, **trước** các check nghiệp vụ khác (participant/trùng/record-load). Với invalidate, ownership không áp dụng (chỉ System Admin) — bước 403 (§4.4) đã phủ.
- ⚠ Lưu ý cho tasks: dùng **đúng** `role_code` đã seed (`SYSTEM_ADMIN`/`BUSINESS_ADMIN`, UPPERCASE). Một số test mock cũ dùng lowercase (`admin`/`sysadmin`) — KHÔNG theo mock, theo seed thực tế.

---

## 5. Reuse vs New (KHÔNG thêm cột, KHÔNG migration — AC-013)
**Tái dùng:**
- Enum: `CheckInMethod.MANUAL`, `AttendanceSource.MANUAL`, `AttendanceRecordStatus.*` (entity hiện có).
- Field `attendance_records`: `verifiedBy`/`verifiedAt`/`note`/`checkInTime`/`checkOutTime`/`isLate`/`lateMinutes`/`leftEarly`/`attendanceStatus`/`participantId`.
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions` (AuthModule).
- Service: `AuditLogsService` (global); `AuthzReadRepository` (AuthModule).
- **Late-flag logic**: đã có ở `attendance.service.ts` (~L240–290, `Math.max(1, Math.ceil(diffMs/60000))`, **không grace** — xác minh [attendance.service.ts:284-286](../../../../src/modules/attendance/services/attendance.service.ts)). ⚠ Helper hiện là **derive-status cho read** (suy `attendanceStatus`/`isLate`/`lateMinutes` từ record; `leftEarly` lấy từ cờ `record.leftEarly`). **Đề xuất** extract phần tính **`isLate`/`lateMinutes`** từ `(checkInTime, meeting.start_time)` thành **util thuần** `computeLateFlags(...)` (đặt `src/modules/attendance/utils/`) để cả create + updateProfile + read-side gọi cùng quy tắc no-grace; phần **`leftEarly` từ `(checkOutTime, meeting.end_time)`** là logic **mới** (cùng quy tắc, chưa có sẵn). Chốt vị trí util ở tasks.

**Mới:** 4 DTO, 1 controller, 1 service (+ tùy chọn util + response mapper). KHÔNG entity/migration.

---

## 6. RBAC & Permission
- Gắn `@RequirePermissions` theo bảng §1: create→`attendance.manual.create`; updateStatus+updateProfile→`attendance.manual.update`; invalidate→`attendance.invalidate`.
- **Seed permission + gán role** (`attendance.manual.create`/`update`, `attendance.invalidate`) = việc của **tasks.md / owed vận hành** — plan chỉ mô tả nơi áp `@RequirePermissions`. Nếu chưa seed → `PermissionsGuard` trả 403 (rủi ro §10).
- Ownership-check Host (§4.5) là tầng **bổ sung** trên PermissionsGuard, nằm ở service (không thay guard) — bypass theo `role_code` `SYSTEM_ADMIN`/`BUSINESS_ADMIN` (chốt §4.5), KHÔNG thêm permission mới.

## 7. Audit logging
- Gọi `AuditLogsService.logAction({ actorUserId, actionType, entityType:'attendance_records', metadataJson })` (hoặc `logEntityChange` cho update) tại **cuối** mỗi thao tác thành công (sau khi mutate DB).
- `actionType`/`metadataJson` theo spec §6 (create_manual_attendance / update_attendance_status / update_attendance_record / invalidate_attendance).
- **Non-blocking (AC-012)**: bọc try/catch quanh lời gọi audit — lỗi audit chỉ log internal (Logger), KHÔNG ném ra / KHÔNG fail request. (AuditLogsService bản thân cũng fail-safe theo `AUDIT_LOG_FAIL_SAFE`, nhưng service vẫn bọc để chắc.)

## 8. Chiến lược test (mức kế hoạch — KHÔNG viết test ở pha này)
Ánh xạ AC → nhóm test (sẽ chi tiết ở tasks):
- **Unit service** (mock repo + AuditLogsService + AuthzReadRepository): AC-001 (create happy), AC-002 (trùng→409), AC-003 (không participant→422), AC-004 (updateStatus), AC-005 (invalidated qua /status→400), AC-006 (updateProfile tính lại late), AC-007 (time-range→422), AC-008 (invalidate happy giữ row), AC-009 (thiếu reason→400), AC-011 (đã invalidated→409), AC-013 (không cột mới — đảm bảo chỉ set field có sẵn), AC-014 (họp tương lai→409).
- **Ownership-check**: Host không sở hữu meeting→403; Business/System Admin bypass (chốt §4.5).
- **Invalidate RBAC** (AC-010): non-SystemAdmin→403 — qua controller guard metadata + service role-check.
- **Audit non-blocking** (AC-012): mock AuditLogsService ném lỗi → thao tác vẫn thành công.
- **Controller**: guard wiring (`@RequirePermissions` metadata đúng cho từng route), envelope/HTTP code (201/200), `@CurrentUser` truyền actor.
- Coverage ≥80% service mới (theo chuẩn dự án).

## 9. Thứ tự thực hiện đề xuất (chi tiết hóa ở tasks.md)
1. DTO ×4 (+ response mapper nếu cần).
2. Util `computeLateFlags` (extract/tái dùng) — nếu chọn tách.
3. `ManualAttendanceService` (4 method + ownership + audit).
4. `ManualAttendanceController` (4 route + guard).
5. Wiring `attendance.module.ts`.
6. Test (unit service + controller) theo §8.
7. Gate (build/eslint/jest/coverage/DI-proof) — không commit, chờ duyệt.
> KHÔNG liệt kê task chi tiết ở plan — đó là việc tasks.md.

## 10. Rủi ro & lưu ý
- **Race-condition tạo trùng**: pre-check service có khe hở 2 request đồng thời → cùng pass pre-check → tạo 2 row. Hardening = unique index DB `(meeting_id,user_id)` (ngoài UC, owed). v1 chấp nhận pre-check.
- **Desync flag/status** (updateProfile): `isLate`/`leftEarly` được tính lại nhưng `attendanceStatus` giữ nguyên → có thể không khớp. **Đây là chủ ý** (§1.4-9); ghi rõ trong code comment + response để FE hiểu.
- **Phụ thuộc seed permission**: chưa seed `attendance.manual.*`/`attendance.invalidate` → guard 403 mọi actor (kể cả đúng vai). Seed = owed vận hành.
- **Phân biệt vai trò actor cho ownership** (đã chốt): dùng `role_code` `SYSTEM_ADMIN`/`BUSINESS_ADMIN` (UPPERCASE) qua `AuthzReadRepository.getEffectiveRolesAndPermissions`. Tasks phải khớp đúng casing role_code đã seed (không theo mock lowercase cũ).
- **Meeting-status gate vs 404 ở invalidate** (đã chốt §4.4): 404 record trước → gate trạng thái sau → 403→400→409.

---

## 11. Open Questions — Cần người chốt
**Không còn câu hỏi mở.** OQ-1 (ownership-bypass theo role_code `SYSTEM_ADMIN`/`BUSINESS_ADMIN` — xác minh từ seed, dùng `AuthzReadRepository.getEffectiveRolesAndPermissions`) và OQ-2 (invalidate: record-load 404 trước → gate trạng thái sau → 403→400→409) đã được chốt và đưa vào §4.4/§4.5 + các mục liên quan ở vòng revise này.

> **STOP.** Plan-only. Đã ghi `spec/features/attendance/feat-manual-attendance/plan.md`. Mọi quyết định đã chốt; §11 hết câu mở. Chờ duyệt trước khi sang tasks.
