# Feature Specification: Điểm danh thủ công (Manual Attendance)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-06-30 | Tạo spec lần đầu cho UC-B21 Điểm danh thủ công (tạo / cập nhật trạng thái / chỉnh hồ sơ / hủy hiệu lực). Tái dùng entity attendance_records + enum sẵn có; quyết định đã chốt đưa thẳng vào spec; audit qua audit_logs (không thêm cột). | Toàn bộ file |
| 2026-06-30 | Vòng revise: chốt OQ-1 (trạng thái meeting cho phép + chặn họp tương lai, không khóa-theo-thời-gian v1), OQ-2 (PATCH hồ sơ tính lại flags nhưng KHÔNG tự đổi status — chủ ý desync), OQ-3 (checkInTime default now). Vá thứ tự kiểm tra §4.4 invalidate (404→403→400→409). Thêm AC-014 (họp tương lai→409). §10 hết câu mở. | §1.4, §3, §4.3, §4.4, §5.3, §8, §9, §10 |

---

- **Feature ID**: APM-MANUAL-ATTENDANCE-001
- **Feature Name**: Điểm danh thủ công (Manual Attendance)
- **Use Case**: UC-B21 Điểm danh thủ công
- **Module / Domain**: attendance / attendance-management
- **Created Date**: 2026-06-30
- **Status**: Draft
- **Source Documents**:
  - AGENTS.md / CLAUDE.md - Backend Agent Guide v1.1 (§9 Auth/RBAC, §11.20 Spec Kit, §14 TypeORM, §15 service layer)
  - spec/global/constitution.md, security.md, data-governance.md, coding-standards.md
  - Database v3.2 Compact (bảng `attendance_records`)
  - spec/features/attendance/feat-view-meeting-attendance-list (mirror văn phong)

---

## 1. Context & Goal

### 1.1 Bối cảnh
Hệ thống điểm danh chủ yếu ghi nhận tự động qua camera AI / Door Face Attendance Terminal / presence. Tuy nhiên có trường hợp camera **không nhận diện được** hoặc **sai lệch** (người tham dự có mặt nhưng không được ghi nhận, hoặc ghi nhận sai). Khi đó Host / Business Admin cần **can thiệp thủ công**: tạo bản ghi điểm danh, cập nhật trạng thái, chỉnh sửa thời gian; và System Admin cần **hủy hiệu lực** một bản ghi sai (giữ lịch sử để truy vết).

Module `attendance` đã có entity `attendance_records` với đủ enum/field cần thiết (`CheckInMethod.MANUAL`, `AttendanceSource.MANUAL`, `AttendanceRecordStatus.INVALIDATED`, `verifiedBy`/`verifiedAt`/`note`), nhưng controller hiện chỉ có GET danh sách + late-checkin-alert — **thiếu toàn bộ thao tác thủ công**. UC này đặc tả phần còn thiếu.

### 1.2 Mục tiêu
Cho phép Host / Business Admin tạo và chỉnh sửa bản ghi điểm danh thủ công cho người tham dự nội bộ của một cuộc họp, và cho phép System Admin hủy hiệu lực bản ghi điểm danh (kể cả bản ghi nguồn camera), bảo đảm dữ liệu điểm danh chính xác, có kiểm soát quyền và có lưu vết audit đầy đủ.

### 1.3 Giá trị mang lại
- Host/Business Admin: sửa sai sót của điểm danh tự động, đảm bảo dữ liệu phản ánh đúng thực tế.
- System Admin: vô hiệu hóa bản ghi sai mà vẫn giữ lịch sử để truy vết/đối soát.
- Dữ liệu & báo cáo: nguồn attendance đáng tin cậy cho analytics; mọi can thiệp thủ công đều được ghi audit.

### 1.4 Quyết định đã chốt (đưa thẳng vào spec, không hỏi lại)
1. **Tạo (POST) chỉ tạo mới.** Nếu đã tồn tại bản ghi cho cùng `(meetingId, userId)` — kể cả nguồn camera — trả **409 Conflict**, KHÔNG upsert/override. Muốn đổi phải dùng PATCH. Chống trùng bằng pre-check ở service layer.
2. **Hai endpoint PATCH riêng**: `PATCH …/{recordId}/status` (đổi `attendanceStatus`) và `PATCH …/{recordId}` (chỉnh hồ sơ: `checkInTime`, `checkOutTime`, `note`). Khi sửa thời gian → tự tính lại `isLate`/`lateMinutes`/`leftEarly` từ `meeting.start_time` / giờ kết thúc.
3. **Hủy hiệu lực (invalidate) = soft, giữ row**: đặt `attendanceStatus = INVALIDATED`, KHÔNG xóa row, KHÔNG dùng TypeORM soft-delete (entity không có `deleted_at`), KHÔNG migration.
4. **RBAC**: tạo/sửa thủ công = **Host / Business Admin**; invalidate = **chỉ System Admin**, được phép invalidate cả bản ghi nguồn camera lẫn thủ công.
5. **Đối tượng**: chỉ điểm danh thủ công cho `user` ∈ participants của meeting (v1 chưa hỗ trợ khách vãng lai). Link `participantId` nếu có.
6. **Lý do**: **bắt buộc** lý do khi invalidate; **khuyến nghị** khi update.
7. **Lưu vết (không migration)**: `verifiedBy`/`verifiedAt` = người **tạo** bản ghi thủ công. Lý do + actor của **update/invalidate** ghi vào `audit_logs` (qua `AuditLogsService`) — KHÔNG thêm cột mới vào `attendance_records`.
8. **Trạng thái meeting cho phép thao tác** (chốt OQ-1): cho phép mọi thao tác (tạo/cập nhật/chỉnh/invalidate) khi meeting ở `in_progress`, `completed`, hoặc `scheduled` && `now >= start_time`. Họp **tương lai** (`now < start_time`) → chặn **409 `ATTENDANCE_NOT_OPEN_YET`** (ERR-012). **Không** khóa-theo-thời-gian sau `end_time` ở v1 (cho phép sửa/invalidate hồi tố không giới hạn; khóa-theo-thời-gian = future/owed, §9).
9. **Chỉnh hồ sơ KHÔNG tự đổi trạng thái** (chốt OQ-2): endpoint #3 (`PATCH …/{recordId}`) tính lại `isLate`/`lateMinutes`/`leftEarly`, **KHÔNG** tự đổi `attendanceStatus`. Sau khi chỉnh giờ, late flags và `attendanceStatus` **có thể không đồng bộ — đây là chủ ý**; muốn đổi trạng thái phải dùng endpoint #2 (tránh side-effect ẩn).
10. **`checkInTime` mặc định khi tạo** (chốt OQ-3): `checkInTime` optional, default = `now` (server-side); cho phép client gửi để điểm danh **hồi tố** đúng thời điểm thực.

---

## 2. Actor & Roles

### 2.1 Danh sách actor
| Actor | Vai trò | Quyền trong UC |
|---|---|---|
| Host | Người chủ trì (`meetings.host_id` hoặc `meeting_participants.participant_role = 'host'`) | Tạo / cập nhật trạng thái / chỉnh hồ sơ điểm danh thủ công cho participant của meeting mình chủ trì |
| Business Admin | Quản trị viên doanh nghiệp | Tạo / cập nhật trạng thái / chỉnh hồ sơ trong phạm vi được cấp quyền |
| System Admin | Quản trị viên hệ thống | **Hủy hiệu lực** (invalidate) bản ghi — cả nguồn camera lẫn thủ công. (Cũng có toàn quyền các thao tác trên.) |
| Internal Participant | Người tham dự nội bộ | KHÔNG có quyền thao tác thủ công (chỉ là đối tượng được điểm danh; xem trạng thái thuộc UC-APM-02) |

### 2.2 Role & Permission Rules
- Bám CLAUDE.md §9: mọi route bảo vệ bằng `JwtAuthGuard` (authn) + `PermissionsGuard` + `@RequirePermissions(...)` (authz). Backend enforce quyền — KHÔNG dựa frontend.
- Quyền đề xuất (theo convention `attendance.*`), cần seed vào `permissions`/`role_permissions` (việc seed nằm ngoài phạm vi spec-only, ghi ở Audit/Owed):
  - `attendance.manual.create` — tạo bản ghi thủ công (Host, Business Admin, System Admin).
  - `attendance.manual.update` — cập nhật trạng thái + chỉnh hồ sơ (Host, Business Admin, System Admin).
  - `attendance.invalidate` — hủy hiệu lực (**chỉ** System Admin).
- Host scope giới hạn theo meeting mình chủ trì; Business Admin theo phạm vi tổ chức được cấp; System Admin toàn hệ thống.
- Người thiếu quyền tương ứng → từ chối với `PERMISSION_DENIED` (403).

---

## 3. Tiền điều kiện
- Người dùng đã đăng nhập (authenticated), token hợp lệ.
- Meeting tồn tại, `deleted_at IS NULL`.
- Với thao tác **tạo**: `user` đích là internal participant của meeting (`meeting_participants.user_id`, `invitation_status` ≠ `declined`).
- Với **cập nhật/chỉnh/invalidate**: bản ghi `attendance_records` tồn tại và thuộc đúng `meetingId` trên path.
- Meeting ở trạng thái cho phép can thiệp điểm danh: `in_progress`, `completed`, hoặc `scheduled` với `now >= start_time` (chốt §1.4-8). Họp tương lai (`now < start_time`) → 409 `ATTENDANCE_NOT_OPEN_YET` (ERR-012). Không khóa-theo-thời-gian sau `end_time` ở v1.

---

## 4. Luồng nghiệp vụ

### 4.1 Tạo bản ghi điểm danh thủ công (Host / Business Admin)
1. Xác thực + kiểm quyền `attendance.manual.create` + scope meeting.
2. Validate input: `userId` bắt buộc; `checkInTime` (optional, default `now`); `note` (optional — lý do).
3. Kiểm `user` ∈ participants nội bộ của meeting → nếu không → 422 `USER_NOT_PARTICIPANT`.
4. **Pre-check chống trùng**: tồn tại bản ghi `(meetingId, userId)` bất kỳ nguồn (kể cả camera) chưa bị xóa → **409 `ATTENDANCE_RECORD_EXISTS`** (không upsert).
5. Tạo bản ghi: `checkInMethod = MANUAL`, `attendanceSource = MANUAL`, `participantId` (link nếu có), `checkInTime`, tính `isLate`/`lateMinutes`/`leftEarly` từ `meeting.start_time` (xem §5.3), suy ra `attendanceStatus` (`present`/`late`/`left_early`), `verifiedBy = actor`, `verifiedAt = now`, `note`.
6. Ghi audit `create_manual_attendance` (§6).
7. Trả 201 + bản ghi vừa tạo.

### 4.2 Cập nhật trạng thái (PATCH …/{recordId}/status)
1. Xác thực + quyền `attendance.manual.update` + scope.
2. Load bản ghi theo `recordId` + `meetingId` → không có → 404 `ATTENDANCE_RECORD_NOT_FOUND`.
3. Validate `attendanceStatus` ∈ {`present`,`absent`,`late`,`left_early`,`pending_review`} (KHÔNG cho đặt `invalidated` qua endpoint này — invalidate dùng §4.4). `reason` khuyến nghị.
4. Cập nhật `attendanceStatus`; ghi audit `update_attendance_status` (kèm from→to, reason, actor).
5. Trả 200 + bản ghi.

### 4.3 Chỉnh hồ sơ (PATCH …/{recordId})
1. Xác thực + quyền `attendance.manual.update` + scope.
2. Load bản ghi → 404 nếu không có.
3. Validate field cho sửa: `checkInTime?`, `checkOutTime?`, `note?` (≥1 field). `checkOutTime` (nếu có) ≥ `checkInTime`.
4. Cập nhật field; **tự tính lại** `isLate`/`lateMinutes`/`leftEarly` từ `meeting.start_time` / giờ kết thúc (§5.3). **KHÔNG** tự đổi `attendanceStatus` (chốt §1.4-9). ⚠ Sau khi chỉnh giờ, late flags và `attendanceStatus` có thể KHÔNG đồng bộ — đây là chủ ý; muốn đổi trạng thái phải dùng endpoint #2.
5. Ghi audit `update_attendance_record` (kèm changedFields, reason?, actor).
6. Trả 200 + bản ghi.

### 4.4 Hủy hiệu lực — invalidate (chỉ System Admin)
Xác thực (authn) trước; sau đó kiểm tra theo **đúng thứ tự** (không trả lỗi sai bậc):
1. **404** `ATTENDANCE_RECORD_NOT_FOUND` nếu bản ghi không tồn tại / không thuộc `meetingId` trên path. (Cho phép cả bản ghi nguồn camera lẫn thủ công.)
2. **403** `PERMISSION_DENIED` nếu actor KHÔNG phải System Admin (quyền `attendance.invalidate`).
3. **400** `REASON_REQUIRED` nếu thiếu `reason` (bắt buộc).
4. **409** `ALREADY_INVALIDATED` nếu bản ghi đã `INVALIDATED` (idempotent-guard).
5. Đặt `attendanceStatus = INVALIDATED` (giữ row, KHÔNG xóa). Ghi audit `invalidate_attendance` (kèm previousStatus, attendanceSource, reason bắt buộc, actor).
6. Trả 200 + bản ghi (status = invalidated).

> Thứ tự kiểm tra chốt: **404 → 403 → 400 → 409 → set INVALIDATED** (load-resource trước, rồi quyền, rồi validate `reason`, rồi trạng thái) để không trả lỗi sai bậc.

---

## 5. API Surface (mô tả nghiệp vụ — KHÔNG code)
Tất cả nested dưới prefix hiện có `@Controller('meetings/:meetingId/attendance')`, envelope chuẩn `{ success, message, data }`.

| # | Method + Path | Role / Permission | Input (nghiệp vụ) | Output | Mã thành công |
|---|---|---|---|---|---|
| 1 | `POST /api/v1/meetings/{meetingId}/attendance` | Host / Business Admin (`attendance.manual.create`) | `userId` (bắt buộc), `checkInTime?`, `note?` (lý do) | Bản ghi attendance vừa tạo (source=manual) | 201 |
| 2 | `PATCH /api/v1/meetings/{meetingId}/attendance/{recordId}/status` | Host / Business Admin (`attendance.manual.update`) | `attendanceStatus` (enum, KHÔNG gồm invalidated), `reason?` | Bản ghi sau cập nhật | 200 |
| 3 | `PATCH /api/v1/meetings/{meetingId}/attendance/{recordId}` | Host / Business Admin (`attendance.manual.update`) | ≥1 trong `checkInTime?`/`checkOutTime?`/`note?` | Bản ghi sau cập nhật (late flags tính lại) | 200 |
| 4 | `POST /api/v1/meetings/{meetingId}/attendance/{recordId}/invalidate` | System Admin (`attendance.invalidate`) | `reason` (bắt buộc) | Bản ghi với `attendanceStatus = invalidated` | 200 |

- `recordId` validate UUID (`ParseUUIDPipe`). `meetingId` UUID + meeting tồn tại.
- Field trả về (mức nghiệp vụ): `id`, `meetingId`, `userId`, `participantId`, `checkInMethod`, `attendanceSource`, `checkInTime`, `checkOutTime`, `isLate`, `lateMinutes`, `leftEarly`, `attendanceStatus`, `verifiedBy`, `verifiedAt`, `note`, `createdAt`, `updatedAt`. (KHÔNG trả field nhạy cảm ngoài schema.)

### 5.1 Enum/field/guard tái sử dụng (KHÔNG thêm cột)
- Enum: `CheckInMethod.MANUAL`, `AttendanceSource.MANUAL`, `AttendanceRecordStatus` (`PRESENT`/`ABSENT`/`LATE`/`LEFT_EARLY`/`PENDING_REVIEW`/`INVALIDATED`).
- Field `attendance_records`: `meetingId`, `participantId`(nullable), `userId`, `checkInMethod`, `attendanceSource`, `checkInTime`, `checkOutTime`, `isLate`, `lateMinutes`, `leftEarly`, `attendanceStatus`, `verifiedBy`, `verifiedAt`, `note`, `createdAt`, `updatedAt`.
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions(...)` (CLAUDE.md §9).
- **KHÔNG đề xuất thêm cột entity.** Lý do/actor của update/invalidate đi vào `audit_logs`.

### 5.2 Functional Requirements (EARS)
- **FR-001 (Ubiquitous)**: THE system SHALL chỉ cho phép thao tác điểm danh thủ công trên internal participant của meeting (có `user_id`), KHÔNG hỗ trợ external/khách vãng lai (v1).
- **FR-002 (Event)**: WHEN tạo bản ghi thủ công mà đã tồn tại bản ghi `(meetingId, userId)` (bất kỳ nguồn), THE system SHALL từ chối với **409** `ATTENDANCE_RECORD_EXISTS` và KHÔNG override.
- **FR-003 (Event)**: WHEN tạo bản ghi thủ công hợp lệ, THE system SHALL đặt `checkInMethod = MANUAL`, `attendanceSource = MANUAL`, `verifiedBy = actor`, `verifiedAt = now`, và tính `attendanceStatus`/`isLate`/`lateMinutes`/`leftEarly` từ `meeting.start_time`.
- **FR-004 (Event)**: WHEN chỉnh `checkInTime`/`checkOutTime`, THE system SHALL tính lại `isLate`/`lateMinutes`/`leftEarly` (§5.3).
- **FR-005 (Unwanted)**: IF cập nhật trạng thái (endpoint #2) cố đặt `attendanceStatus = invalidated`, THEN THE system SHALL từ chối **400** (invalidate phải qua endpoint #4).
- **FR-006 (Unwanted)**: IF invalidate mà thiếu `reason`, THEN THE system SHALL từ chối **400** `REASON_REQUIRED`.
- **FR-007 (Authorization)**: WHEN actor thực hiện invalidate, THE system SHALL verify actor là System Admin (`attendance.invalidate`) trước khi xử lý; thiếu quyền → **403** `PERMISSION_DENIED`.
- **FR-008 (State)**: WHILE bản ghi đã `INVALIDATED`, THE system SHALL coi là bất biến cho invalidate lặp (trả **409** `ALREADY_INVALIDATED`) và giữ nguyên row (không xóa).
- **FR-009 (Audit)**: WHERE thao tác thay đổi dữ liệu điểm danh (tạo/update/invalidate), THE system SHALL ghi `audit_logs` non-blocking (§6).

### 5.3 Quy tắc tính lại late/left-early
- `isLate = checkInTime > meeting.start_time` (so đến giây). `lateMinutes = CEIL((checkInTime - start_time)/60)`, tối thiểu 1 khi late; 0 (hoặc null) khi đúng giờ. (Mirror UC-APM-02, không grace period.)
- `leftEarly = (checkOutTime != null) AND (checkOutTime < meeting.end_time)` nếu `end_time` xác định; nếu meeting chưa có `end_time` → `leftEarly = false`.
- Suy `attendanceStatus` khi tạo: `left_early` nếu leftEarly; ngược lại `late` nếu isLate; ngược lại `present`. Endpoint #3 tính lại flag nhưng KHÔNG tự đổi `attendanceStatus` (§1.4-9).

---

## 6. Audit Log (ghi vào `audit_logs` qua `AuditLogsService`)
Non-blocking (lỗi ghi log KHÔNG làm fail request — chỉ log internal). KHÔNG ghi dữ liệu nhạy cảm dư thừa.

| Thao tác | `actionType` | `entityType` | `metadataJson` tối thiểu |
|---|---|---|---|
| Tạo thủ công | `create_manual_attendance` | `attendance_records` | `meetingId`, `userId`, `recordId`, `actorUserId`, `source='manual'`, `checkInTime` |
| Cập nhật trạng thái | `update_attendance_status` | `attendance_records` | `recordId`, `meetingId`, `fromStatus`, `toStatus`, `reason?`, `actorUserId` |
| Chỉnh hồ sơ | `update_attendance_record` | `attendance_records` | `recordId`, `meetingId`, `changedFields[]`, `reason?`, `actorUserId` |
| Hủy hiệu lực | `invalidate_attendance` | `attendance_records` | `recordId`, `meetingId`, `previousStatus`, `attendanceSource`, `reason` (bắt buộc), `actorUserId` |

- Người **tạo** lưu trực tiếp ở `verifiedBy`/`verifiedAt` (entity). Người + lý do của **update/invalidate** chỉ lưu ở `audit_logs` (KHÔNG cột mới).
- **Owed (ngoài spec-only)**: seed permission `attendance.manual.create`/`attendance.manual.update`/`attendance.invalidate` + gán role; nếu chưa seed → guard 403.

---

## 7. Lỗi & Edge Case
| Mã | Tình huống | HTTP / code |
|---|---|---|
| ERR-001 | Chưa đăng nhập | 401 |
| ERR-002 | Thiếu quyền (create/update/invalidate) | 403 `PERMISSION_DENIED` |
| ERR-003 | `meetingId`/`recordId` không phải UUID | 400 |
| ERR-004 | Meeting không tồn tại / đã soft-delete | 404 `MEETING_NOT_FOUND` |
| ERR-005 | Bản ghi không tồn tại / không thuộc meeting | 404 `ATTENDANCE_RECORD_NOT_FOUND` |
| ERR-006 | `user` không phải participant của meeting | 422 `USER_NOT_PARTICIPANT` |
| ERR-007 | Đã tồn tại bản ghi `(meeting,user)` khi tạo | 409 `ATTENDANCE_RECORD_EXISTS` |
| ERR-008 | invalidate thiếu `reason` | 400 `REASON_REQUIRED` |
| ERR-009 | Đặt status=`invalidated` qua endpoint #2 | 400 |
| ERR-010 | invalidate bản ghi đã `INVALIDATED` | 409 `ALREADY_INVALIDATED` |
| ERR-011 | `checkOutTime` < `checkInTime` | 422 `INVALID_TIME_RANGE` |
| ERR-012 | Meeting ở tương lai (`now < start_time`) khi thao tác | 409 `ATTENDANCE_NOT_OPEN_YET` |
| ERR-013 | Lỗi DB | 500 |

Edge: tạo trùng race-condition → pre-check + (hardening sau) unique index `(meeting_id,user_id)` — ngoài phạm vi UC; chống trùng chính bằng pre-check service.

---

## 8. Acceptance Criteria (kiểm chứng được)

**AC-001 (Tạo happy)**: Given Host đã đăng nhập, meeting `in_progress`, participant X chưa có bản ghi; When Host POST tạo điểm danh thủ công cho X với `checkInTime` trước `start_time`; Then trả 201, bản ghi có `checkInMethod=manual`, `attendanceSource=manual`, `attendanceStatus=present`, `isLate=false`, `verifiedBy=Host`, và có audit `create_manual_attendance`.

**AC-002 (Tạo trùng → 409)**: Given participant X đã có bản ghi (nguồn camera); When Host POST tạo thủ công cho X; Then trả **409 `ATTENDANCE_RECORD_EXISTS`**, KHÔNG tạo bản ghi thứ 2, KHÔNG override bản ghi camera.

**AC-003 (Tạo cho người ngoài DS → 422)**: Given user Y KHÔNG phải participant; When POST tạo cho Y; Then 422 `USER_NOT_PARTICIPANT`.

**AC-004 (Cập nhật trạng thái)**: Given bản ghi tồn tại với status `late`; When Host PATCH `/status` đổi sang `present` kèm `reason`; Then 200, `attendanceStatus=present`, audit `update_attendance_status` ghi `fromStatus=late,toStatus=present,reason`.

**AC-005 (Không cho invalidate qua /status)**: Given bản ghi tồn tại; When PATCH `/status` đặt `attendanceStatus=invalidated`; Then **400**, row không đổi.

**AC-006 (Chỉnh hồ sơ → tính lại late)**: Given bản ghi có `checkInTime` đúng giờ (`present`); When PATCH chỉnh `checkInTime` trễ hơn `start_time` 90 giây; Then 200, `isLate=true`, `lateMinutes=2`, và `leftEarly` tính lại theo `checkOutTime`.

**AC-007 (checkOutTime < checkInTime → 422)**: Given bản ghi; When PATCH đặt `checkOutTime` < `checkInTime`; Then 422 `INVALID_TIME_RANGE`.

**AC-008 (Invalidate happy — System Admin)**: Given bản ghi `present` (nguồn camera); When System Admin POST `/invalidate` kèm `reason`; Then 200, `attendanceStatus=invalidated`, **row vẫn tồn tại** (không xóa), audit `invalidate_attendance` ghi `previousStatus=present,attendanceSource=camera,reason,actorUserId`.

**AC-009 (Invalidate thiếu reason → 400)**: Given bản ghi; When System Admin POST `/invalidate` không có `reason`; Then 400 `REASON_REQUIRED`.

**AC-010 (Invalidate bởi non-SystemAdmin → 403)**: Given Host/Business Admin; When POST `/invalidate`; Then 403 `PERMISSION_DENIED`.

**AC-011 (Invalidate lặp → 409)**: Given bản ghi đã `invalidated`; When invalidate lần nữa; Then 409 `ALREADY_INVALIDATED`, row không đổi.

**AC-012 (Audit non-blocking)**: Given lỗi ghi audit_logs; When thực hiện bất kỳ thao tác create/update/invalidate hợp lệ; Then thao tác vẫn thành công (audit lỗi chỉ log internal, không trả lỗi cho user).

**AC-013 (Không migration / không cột mới)**: Toàn bộ UC chỉ dùng field/enum sẵn có của `attendance_records`; lý do+actor của update/invalidate nằm ở `audit_logs`. Không phát sinh cột entity / migration.

**AC-014 (Họp tương lai → 409)**: Given meeting `scheduled` với `now < start_time`; When Host/Business Admin/System Admin thực hiện BẤT KỲ thao tác create/update/chỉnh-hồ-sơ/invalidate cho participant; Then trả **409 `ATTENDANCE_NOT_OPEN_YET`**, KHÔNG tạo/đổi/invalidate bản ghi (nhất quán ERR-012 và §1.4-8).

---

## 9. Out of Scope
- Khách vãng lai (external/không phải participant) — v1 chỉ internal participant.
- Upsert/override bản ghi camera bằng POST (đã chốt: tạo chỉ tạo mới, đụng trùng → 409).
- TypeORM soft-delete / cột `deleted_at` cho attendance_records (invalidate dùng status).
- Unique index DB `(meeting_id,user_id)` — hardening sau, ngoài UC.
- **Khóa-theo-thời-gian** (chặn sửa/invalidate sau `end_time` X giờ) — future/owed; v1 cho phép sửa/invalidate hồi tố không giới hạn.
- Seed permission/role (owed vận hành).
- Phát WebSocket event attendance.updated (read-side khác lo).
- Phục hồi (un-invalidate) bản ghi đã hủy hiệu lực.
- Bulk/manual hàng loạt; nhập từ file.

---

## 10. Open Questions — Cần người chốt
**Không còn câu hỏi mở.** OQ-1 (trạng thái meeting cho phép + chặn họp tương lai), OQ-2 (chỉnh hồ sơ KHÔNG tự đổi status), OQ-3 (`checkInTime` default `now`) đã được chốt và đưa vào §1.4 (mục 8–10) + các mục liên quan ở vòng revise này.

> **STOP.** Spec-only. Đã ghi `spec/features/attendance/feat-manual-attendance/spec.md`. Mọi quyết định đã chốt; §10 hết câu mở. Chờ duyệt trước khi sang plan/tasks.
