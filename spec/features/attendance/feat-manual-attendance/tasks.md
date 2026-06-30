# Tasks: Điểm danh thủ công (Manual Attendance) — UC-B21

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Tạo tasks cho UC-B21: DTO → util(+test) → service(+test) → controller(+test) → wiring → seed permission → cổng chất lượng. Truy vết AC-001…AC-014. Phương án A, không migration/cột mới. | Toàn bộ file |
| 2026-06-30 | Vòng revise: khóa T-07 theo RBAC thật — role chủ-trì-họp = `INTERNAL_USER`/`MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN` (xác minh seed `meeting.session.start`); invalidate chỉ `SYSTEM_ADMIN`. 2 chỉnh test: (a) test guard/RBAC KHÔNG phụ thuộc seed thủ công (mock/test-setup tự seed); (b) invalidate test theo từng bậc 404→409→403→400→409 (mỗi bậc ≥1 case riêng). | T-04b, T-05b, T-07, T-08, §Traceability |

> Spec khóa: [spec.md](./spec.md) · Plan khóa: [plan.md](./plan.md). Tasks KHÔNG mở lại quyết định đã chốt. **TASK-ONLY — chưa code.**
> Thứ tự build: **DTO → util(+test) → service(+test) → controller(+test) → wiring → seed permission → cổng chất lượng.**

---

## Danh sách Task

### T-01 — DTO ×4 (input) — *plan §2.1, spec §5*
- **Mục tiêu**: 4 DTO input cho 4 endpoint, validate bằng `class-validator` (mirror style DTO hiện có trong `attendance/dto`).
- **File tạo mới**:
  - `src/modules/attendance/dto/create-manual-attendance.dto.ts` — `userId` (`@IsUUID`, bắt buộc), `checkInTime?` (`@IsISO8601`, default `now` xử ở service), `note?` (`@IsString @MaxLength`).
  - `src/modules/attendance/dto/update-attendance-status.dto.ts` — `attendanceStatus` (`@IsIn` các giá trị **trừ** `invalidated`), `reason?` (`@IsString`).
  - `src/modules/attendance/dto/update-attendance-profile.dto.ts` — `checkInTime?`/`checkOutTime?` (`@IsISO8601`), `note?` (`@IsString`); ràng buộc **≥1 field** (custom validator hoặc kiểm ở service).
  - `src/modules/attendance/dto/invalidate-attendance.dto.ts` — `reason` (`@IsString @IsNotEmpty`, **bắt buộc**).
- **Việc cần làm**: khai báo field + decorator validate theo spec §5; KHÔNG nhận field ngoài (`whitelist`).
- **DoD**: 4 file biên dịch; `attendanceStatus` DTO loại `invalidated`; `invalidate` DTO `reason` bắt buộc.
- **Phụ thuộc**: —.

### T-02 — Response mapper riêng — *plan §2.1 (đã chốt: mapper riêng), spec §5*
- **Mục tiêu**: chuẩn hóa output đúng field spec §5, KHÔNG ép tái dùng `attendance-item.dto.ts`, KHÔNG sửa read-side.
- **File tạo mới**: `src/modules/attendance/dto/manual-attendance-response.dto.ts` — `toManualAttendanceResponse(entity)` trả: `id`, `meetingId`, `userId`, `participantId`, `checkInMethod`, `attendanceSource`, `checkInTime`, `checkOutTime`, `isLate`, `lateMinutes`, `leftEarly`, `attendanceStatus`, `verifiedBy`, `verifiedAt`, `note`, `createdAt`, `updatedAt`.
- **DoD**: mapper trả đúng tập field §5; KHÔNG lộ field ngoài schema.
- **Phụ thuộc**: —.

### T-03 — Util `computeLateFlags` (thuần) — *plan §5 (đã chốt: util mới, no-grace)*
- **Mục tiêu**: tính `isLate`/`lateMinutes` từ `(checkInTime, meeting.start_time)` và `leftEarly` từ `(checkOutTime, meeting.end_time)`, quy tắc **no-grace** đã verify ([attendance.service.ts:284-286](../../../../src/modules/attendance/services/attendance.service.ts)).
- **File tạo mới**: `src/modules/attendance/utils/compute-late-flags.util.ts` — hàm thuần (KHÔNG phụ thuộc Nest), dùng chung cho `createManual` + `updateProfile`.
- **Việc cần làm**: `isLate = checkInTime > startTime`; `lateMinutes = Math.max(1, Math.ceil(diffMs/60000))` khi late, ngược lại 0; `leftEarly = checkOutTime != null && end_time != null && checkOutTime < end_time` (end_time null → `leftEarly=false`). **KHÔNG** sửa `attendance.service.ts`.
- **DoD**: util export hàm thuần; biên dịch; logic khớp plan §5.
- **Phụ thuộc**: —.

### T-03b — Unit test util `computeLateFlags` — *plan §8*
- **File tạo mới**: `src/modules/attendance/utils/compute-late-flags.util.spec.ts`.
- **Mốc kiểm chứng**:
  - đúng giờ (`checkInTime <= startTime`) → `isLate=false`, `lateMinutes=0`.
  - trễ **1 giây** → `isLate=true`, `lateMinutes=1`.
  - trễ **90 giây** → `lateMinutes=2`.
  - `checkOutTime < end_time` → `leftEarly=true`; `checkOutTime >= end_time` → `leftEarly=false`.
  - `end_time = null` → `leftEarly=false` (dù có `checkOutTime`).
- **DoD**: test xanh, phủ 5 mốc trên.
- **Phụ thuộc**: T-03.

### T-04 — `ManualAttendanceService` (4 method + ownership + audit) — *plan §3, §4, §4.5, §7*
- **Mục tiêu**: business logic ghi (create/updateStatus/updateProfile/invalidate) đúng luồng + thứ tự lỗi spec/plan.
- **File tạo mới**: `src/modules/attendance/services/manual-attendance.service.ts`.
- **Inject**: `@InjectRepository(AttendanceRecordEntity)`; truy cập `meetings`/`meeting_participants` (repo `MeetingEntity`/`MeetingParticipantEntity` đã forFeature **hoặc** `DataSource` raw bind); `AuditLogsService` (global); `AuthzReadRepository` (AuthModule).
- **Việc cần làm** (mô tả, KHÔNG code):
  - **Chung** (create/update): load meeting → **404 `MEETING_NOT_FOUND`** → gate trạng thái (`now<start_time` → **409 `ATTENDANCE_NOT_OPEN_YET`**) → ownership-check (§4.5).
  - **Ownership-check (§4.5)**: lấy roles qua `AuthzReadRepository.getEffectiveRolesAndPermissions(actor.userId)`; nếu chứa `SYSTEM_ADMIN`/`BUSINESS_ADMIN` (UPPERCASE) → bypass; ngược lại Host → `meeting.host_id === actor.userId` else **403 `PERMISSION_DENIED`**.
  - **createManual**: default `checkInTime=now`; kiểm participant (**422 `USER_NOT_PARTICIPANT`**); pre-check trùng `(meetingId,userId)` mọi nguồn (**409 `ATTENDANCE_RECORD_EXISTS`**); set `checkInMethod=MANUAL`/`attendanceSource=MANUAL`/`participantId`/`verifiedBy=actor`/`verifiedAt=now`; tính flags qua `computeLateFlags` + suy `attendanceStatus`; audit `create_manual_attendance`.
  - **updateStatus**: load record (404 `ATTENDANCE_RECORD_NOT_FOUND`); chặn `invalidated` (**400**); set status; audit `update_attendance_status` (from→to, reason?).
  - **updateProfile**: load record (404); validate `checkOutTime >= checkInTime` (**422 `INVALID_TIME_RANGE`**); set field; **tính lại** flags qua `computeLateFlags`; **KHÔNG** đổi `attendanceStatus` (§1.4-9, desync chủ ý); audit `update_attendance_record` (changedFields, reason?).
  - **invalidate** (thứ tự §4.4): **(1)** load record+meeting → 404 → **(2)** gate trạng thái → 409 → **(3)** actor không `SYSTEM_ADMIN` (`attendance.invalidate`) → 403 → **(4)** thiếu `reason` → 400 → **(5)** đã `INVALIDATED` → 409 `ALREADY_INVALIDATED` → **(6)** set `INVALIDATED` (giữ row); audit `invalidate_attendance`.
  - **Audit non-blocking**: bọc try/catch quanh mỗi lời gọi `AuditLogsService` (lỗi audit chỉ log internal, KHÔNG fail request) — spec §6/AC-012.
- **DoD**: 4 method đúng thứ tự lỗi; chỉ set field/enum sẵn có (AC-013); KHÔNG sửa `attendance.service.ts`/read-side.
- **Phụ thuộc**: T-01, T-02, T-03.

### T-04b — Unit test `ManualAttendanceService` — *plan §8, spec §8*
- **File tạo mới**: `src/modules/attendance/tests/manual-attendance.service.spec.ts` (mirror nơi đặt `attendance.service.spec.ts`).
- **Việc cần làm**: mock repo + `AuditLogsService` + `AuthzReadRepository` + truy cập meeting/participant. Phủ AC theo bảng truy vết §Traceability (create happy / trùng / không-participant / updateStatus / chặn-invalidated / updateProfile-tính-lại / time-range / invalidate happy giữ row / thiếu reason / already-invalidated / ownership 403 + admin bypass / audit non-blocking / không-cột-mới / họp-tương-lai).
- **Invalidate test theo TỪNG BẬC (bắt buộc)**: assert đúng từng tầng riêng biệt theo thứ tự **404 → 409(gate trạng thái) → 403 → 400(reason) → 409(already)** — **mỗi tầng tối thiểu 1 case riêng, KHÔNG gộp nhiều tầng vào 1 test**. (Mock dữ liệu để chạm đúng từng bậc: record-null→404; record OK + meeting tương lai→409; record OK + actor không `SYSTEM_ADMIN`→403; record OK + admin + thiếu reason→400; record đã INVALIDATED→409.)
- **KHÔNG phụ thuộc seed thủ công**: role của actor cấp qua **mock `AuthzReadRepository`** (trả `roles: ['SYSTEM_ADMIN']` / `['MANAGER']`…) — test KHÔNG đọc DB/seed thật, KHÔNG đỏ vì "chưa ai seed".
- **DoD**: test xanh; mỗi bậc invalidate có case riêng; coverage service ≥ ngưỡng dự án.
- **Phụ thuộc**: T-04.

### T-05 — `ManualAttendanceController` (4 route + guard) — *plan §1, §3, spec §5*
- **Mục tiêu**: 4 route HTTP đúng method/path/role, thin controller.
- **File tạo mới**: `src/modules/attendance/controllers/manual-attendance.controller.ts`.
- **Việc cần làm**: `@Controller('meetings/:meetingId/attendance')` (mirror read controller); mỗi route `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions(...)` (create→`attendance.manual.create`; updateStatus+updateProfile→`attendance.manual.update`; invalidate→`attendance.invalidate`); `@CurrentUser` truyền actor; `ParseUUIDPipe` cho `meetingId`/`recordId`; envelope `{success,message,data}`; HTTP 201 (create) / 200 (còn lại); gọi service + mapper T-02.
- **DoD**: 4 route đúng method/path; guard + `@RequirePermissions` đúng; envelope/HTTP code đúng. KHÔNG đụng `attendance.controller.ts`/`checkin-alert.*`.
- **Phụ thuộc**: T-04 (, T-02).

### T-05b — Unit test controller — *plan §8*
- **File tạo mới**: `src/modules/attendance/tests/manual-attendance.controller.spec.ts`.
- **Việc cần làm**: mock service + **mock guard** (override `PermissionsGuard`); assert mỗi route gọi đúng service method với `@CurrentUser`/params; metadata `@RequirePermissions` đúng từng route (đặc biệt invalidate = `attendance.invalidate`); envelope + HTTP code (201/200).
- **KHÔNG phụ thuộc seed thủ công**: test ở tầng controller kiểm **metadata `@RequirePermissions`** + mock guard (KHÔNG resolve permission thật từ DB) → AC-010 (invalidate cần `attendance.invalidate`) chứng minh qua metadata + mock, KHÔNG cần ai chạy seed.
- **DoD**: test xanh; phủ guard-metadata (AC-010 ở tầng controller) độc lập DB/seed.
- **Phụ thuộc**: T-05.

### T-06 — Wiring `attendance.module.ts` — *plan §3*
- **Mục tiêu**: đăng ký controller + service mới.
- **File sửa**: `src/modules/attendance/attendance.module.ts`.
- **Việc cần làm**: thêm `ManualAttendanceController` vào `controllers`; `ManualAttendanceService` vào `providers`. Xác nhận `forFeature` đã đủ (`AttendanceRecordEntity`/`MeetingEntity`/`MeetingParticipantEntity`/`UserEntity` — đã có); `AuditLogsService` global (KHÔNG import AdministrationModule); `AuthzReadRepository` từ AuthModule (đã import). KHÔNG thêm import thừa.
- **DoD**: AppModule compile; DI resolve `ManualAttendanceService` (0 circular/UnknownDependencies).
- **Phụ thuộc**: T-04, T-05.

### T-07 — Seed 3 permission + gán role — *plan §6 (điều kiện guard không 403)*
- **Mục tiêu**: seed `attendance.manual.create`, `attendance.manual.update`, `attendance.invalidate` vào `permissions` + gán `role_permissions`. **Thiếu seed → guard 403 mọi actor** → điều kiện để guard chạy đúng trên DB thật.
- **File tạo mới**: `src/database/seeds/<timestamp>-SeedManualAttendancePermissions.ts` (mirror pattern seed host-op hiện có, vd [20260616000001-SeedMeetingSessionStartPermission.ts](../../../../src/database/seeds/20260616000001-SeedMeetingSessionStartPermission.ts) — `INSERT ... ON CONFLICT DO NOTHING`, lookup `roles WHERE role_code=$1`, INSERT `role_permissions`).
- **Danh sách gán role (XÁC MINH từ RBAC thật — đề xuất, cần người duyệt trước khi chạy seed)**:
  - `attendance.manual.create` + `attendance.manual.update` → **`INTERNAL_USER`, `MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`** — đúng tập role "được chủ trì họp" của các host-level in-meeting op (`meeting.session.start`/`meeting.end`/`meeting.note` đều gán tập này; bằng chứng `SeedMeetingSessionStartPermission.ts:33-34`). KHÔNG mở rộng/thu hẹp ngoài tập "được chủ trì họp".
  - `attendance.invalidate` → **chỉ `SYSTEM_ADMIN`**.
  - `role_code` UPPERCASE đúng seed thật (`SELECT id FROM roles WHERE role_code = $1 AND is_active = true`).
- ⚠ **Quan trọng**: việc role có permission **chỉ mở cửa cho role nền vào tới service** — KHÔNG đảm bảo "đúng host của đúng meeting". Ràng buộc "đúng host" do **ownership-check tầng service (plan §4.5)** quyết (`meeting.host_id === actor.userId`); `BUSINESS_ADMIN`/`SYSTEM_ADMIN` bypass. Permission ≠ ownership.
- **DoD**: seed file theo pattern dự án; 3 permission + gán đúng danh sách role trên; **idempotent** (`ON CONFLICT DO NOTHING` cho cả permission lẫn role_permissions); danh sách role đã được người duyệt.
- **Phụ thuộc**: — (độc lập code). Owed vận hành: chạy seed khi deploy. **KHÔNG để test guard phụ thuộc thao tác chạy seed thủ công** (xem T-04b/T-05b/T-08).

### T-08 — Cổng chất lượng (KHÔNG commit) — *plan §9*
- **Mục tiêu**: xác nhận build/lint/test/coverage/DI sạch trước khi chờ duyệt.
- **Việc cần làm** (lệnh kiểm tra — **không chạy ở pha task này**, chạy ở pha implement):
  - build: `npx tsc -p tsconfig.build.json --noEmit` = 0.
  - eslint per-file các file mới/đụng = 0 (baseline-proof nếu chạm file có sẵn).
  - jest: `npx jest src/modules/attendance` xanh (mới + read-side KHÔNG hồi quy). **Test guard/RBAC chạy bằng mock (T-04b/T-05b) — KHÔNG phụ thuộc seed thủ công**; nếu có e2e trên DB thật thì pipeline phải chạy seed (gồm T-07) hoặc test-setup tự seed 3 permission programmatically (đảm bảo AC-010 không đỏ vì thiếu seed).
  - coverage ≥ ngưỡng dự án (≥80%) cho `manual-attendance.service.ts` + `compute-late-flags.util.ts`.
  - DI-proof: compile AppModule (Redis ECONNREFUSED infra-OK, 0 circular/UnknownDependencies).
- **DoD**: tất cả pass; **STOP, KHÔNG commit**, chờ duyệt.
- **Phụ thuộc**: T-01…T-07.

---

## Bảng truy vết AC → Task

| AC (spec §8) | Nội dung | Task phủ |
|---|---|---|
| AC-001 | Tạo happy (manual/present/isLate=false/verifiedBy/audit) | T-04b |
| AC-002 | Tạo trùng (kể cả camera) → 409 `ATTENDANCE_RECORD_EXISTS` | T-04b |
| AC-003 | User không participant → 422 `USER_NOT_PARTICIPANT` | T-04b |
| AC-004 | updateStatus late→present + audit from→to | T-04b |
| AC-005 | Đặt `invalidated` qua /status → 400 | T-04b (+ T-01 DTO loại invalidated) |
| AC-006 | updateProfile tính lại late (90s→lateMinutes=2) | T-04b (logic), T-03b (util) |
| AC-007 | `checkOutTime` < `checkInTime` → 422 `INVALID_TIME_RANGE` | T-04b |
| AC-008 | Invalidate happy (System Admin) giữ row + audit | T-04b |
| AC-009 | Invalidate thiếu reason → 400 `REASON_REQUIRED` | T-04b (+ T-01 DTO reason bắt buộc) |
| AC-010 | Invalidate bởi non-SystemAdmin → 403 | T-04b (service role-check) + T-05b (guard metadata) |
| AC-011 | Invalidate lặp → 409 `ALREADY_INVALIDATED` | T-04b |
| AC-012 | Audit non-blocking (audit lỗi → thao tác vẫn OK) | T-04b |
| AC-013 | Không migration / không cột mới (chỉ field sẵn có) | T-04 (chỉ set field sẵn có) + T-04b assert |
| AC-014 | Họp tương lai (`now<start_time`) → 409 `ATTENDANCE_NOT_OPEN_YET` (mọi thao tác) | T-04b |

**Phủ riêng**:
- **Ownership-check Host 403 + admin bypass** (§4.5): T-04b (Host không sở hữu→403; `SYSTEM_ADMIN`/`BUSINESS_ADMIN`→bypass).
- **Invalidate RBAC (AC-010)**: T-04b (service) + T-05b (guard `@RequirePermissions('attendance.invalidate')`).
- **Audit non-blocking (AC-012)**: T-04b (mock AuditLogsService ném lỗi → vẫn thành công).
- **Thứ tự invalidate 404 → 409(gate trạng thái) → 403 → 400 → 409(already)** (plan §4.4): T-04b — **mỗi bậc ≥1 case riêng, KHÔNG gộp** (5 case tối thiểu).
- **Không-migration (AC-013)**: T-04 + T-04b (assert chỉ field/enum sẵn có; không có entity/migration trong toàn UC).

---

## Out-of-task (KHÔNG làm — bám spec §9)
- KHÔNG đụng read-side (`attendance.controller.ts`, `attendance.service.ts`, `checkin-alert.*`).
- KHÔNG migration / KHÔNG thêm cột entity (AC-013).
- KHÔNG unique index DB `(meeting_id,user_id)` (hardening sau, owed).
- KHÔNG un-invalidate (phục hồi bản ghi đã hủy hiệu lực).
- KHÔNG WebSocket event attendance.updated.
- KHÔNG bulk/manual hàng loạt / nhập file.
- KHÔNG thêm endpoint / permission `manage_all` / khách vãng lai.

---

## Open Questions — Cần người chốt
**Không còn câu hỏi mở.** Danh sách role cho seed (T-07) đã được **xác minh từ RBAC thật**: create/update → `INTERNAL_USER`/`MANAGER`/`BUSINESS_ADMIN`/`SYSTEM_ADMIN` (tập "được chủ trì họp" của host-level op `meeting.session.start`/`meeting.end`/`meeting.note`); invalidate → `SYSTEM_ADMIN`. Ràng buộc "đúng host của đúng meeting" do ownership-check tầng service (plan §4.5), KHÔNG do permission.

> Lưu ý vận hành (KHÔNG phải open question): danh sách role ở T-07 là **đề xuất từ RBAC thật, cần người duyệt** trước khi chạy seed — không tự mở rộng ngoài tập "được chủ trì họp".

> **STOP.** Task-only. Đã ghi `spec/features/attendance/feat-manual-attendance/tasks.md`. Chờ duyệt trước khi sang pha implement.
