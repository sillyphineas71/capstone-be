# Implementation Plan: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10
- **Status**: Draft

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo plan cho tính năng import Excel | Toàn bộ file |

---

## 1. Feature Summary
Cho phép Organizer/Host/Manager/Admin import hàng loạt thành viên (internal + external) vào một cuộc họp `scheduled`/`in_progress` từ file `.xlsx`, xử lý đồng bộ (cap 200 dòng), partial-success theo dòng, luồng 2 bước xác nhận cảnh báo bằng cờ `forceAddWithWarnings`. Internal nhận in-app (gom 1 notification), external nhận email riêng từng người.

---

## 2. Technical Context
- **Module**: `meetings` (`src/modules/meetings/`)
- **Framework**: NestJS, TypeORM
- **Excel**: `exceljs` (đã có)
- **Upload**: `FileInterceptor('file')` từ `@nestjs/platform-express` (memoryStorage)
- **Auth**: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('meeting.participant.import')`
- **Database**: PostgreSQL v3.2 Compact — KHÔNG đổi schema
- **Reuse**: `checkParticipantConflicts()`, `getAttendeeCount()`, lõi ghi participant + audit của `addInternalParticipant`/`addExternalParticipant`
- **New**: `ParticipantImportService`, parser Excel, resolver identity batch, cờ batch `forceAddWithWarnings`

---

## 3. Constitution Check
- **DB Gate**: PASS — không thêm/xóa bảng, không đổi cột
- **Security Gate**: PASS — JWT auth, userId từ token, không log secret, validate MIME/size file
- **Scope Gate**: PASS — không async job cho import, không thêm bảng lịch sử, không sửa hành vi email đơn lẻ
- **Module Gate**: PASS — logic trong `meetings`; notification/audit qua module import
- **API Gate**: PASS — response `{ success, message, data, error }`, HTTP codes đúng chuẩn
- **Auth Gate**: PASS — permission mới `meeting.participant.import`
- **Test Gate**: PASS — unit test parser, resolver, warning flow, partial success, notification

**Complexity Justification**:
- Refactor **extract lõi** khỏi `addInternalParticipant`/`addExternalParticipant` là thay đổi nhạy cảm nhất. Lý do bắt buộc: import cần dùng lại pre-check + transaction nhưng KHÁC chiến lược notification (internal chỉ in-app gom, external có email). Alternative "gọi thẳng hàm cũ" không đạt vì hàm internal gửi email (tốn quota) và hàm external không gửi email (thiếu yêu cầu).

---

## 4. Scope Confirmation

### In scope
- Endpoint import (multipart) + endpoint tải template
- Parse `.xlsx`, validate cấu trúc, cap 200 dòng
- Resolve internal theo email (ưu tiên) / employee_code (fallback), batch query
- Duplicate-in-file + duplicate-in-DB detection
- Reuse warning (conflict + capacity lũy kế) + private + capacity policy
- Luồng 2 bước `forceAddWithWarnings` cấp file
- Partial-success per-row transaction
- Internal: 1 in-app gom, không email. External: email riêng từng khách
- Audit tổng phiên import
- Permission mới `meeting.participant.import`

### Out of scope
- Async import qua background_jobs
- Bảng lưu lịch sử import
- Sửa hành vi email của `addExternalParticipant` đơn lẻ
- Sửa worker mail sang BCC/loop
- Import role/attendance tùy biến
- Định dạng `.csv`

---

## 5. Data Model Impact
**Không đổi schema.** Chi tiết `data-model.md`. Ghi vào `meeting_participants`, `meeting_external_participants`, `notifications`, `background_jobs`, `audit_logs`.

---

## 6. API / Contract Plan
Chi tiết `contracts/import-participants-api.md`.

| Endpoint | Method | Permission |
|---|---|---|
| `/meetings/:meetingId/participants/import` | POST (multipart) | `meeting.participant.import` |
| `/meetings/:meetingId/participants/import/template` | GET | `meeting.participant.import` |

### DTO: `ImportParticipantsDto`
```
forceAddWithWarnings?: boolean   // @IsOptional @IsBoolean (transform string->boolean)
```
(File nhận qua `@UploadedFile()`, không qua DTO body.)

---

## 7. Authorization Plan
1. `JwtAuthGuard` → gán `request['user']`.
2. `PermissionsGuard` → check `meeting.participant.import`.
3. Service (per request): resolve meeting → nếu `visibility_level='private'` và actor không phải Organizer/Host/Admin → `403 FORBIDDEN_ACCESS` (chặn cả request).
4. Per-row capacity override: nếu dòng có capacity warning, policy=`warning`, và actor không có `meeting.participant.override_capacity` → dòng chuyển thành lỗi cứng `ROOM_CAPACITY_EXCEEDED`.

### Permission seed
- `meeting.participant.import` — gán ADMIN, MANAGER, EMPLOYEE (khớp tập role của `add.internal`).

---

## 8. Business Logic Plan

### Service mới: `ParticipantImportService`
Constructor inject: `DataSource`, `MeetingsService` (hoặc lõi extract), `NotificationsService`, `AuthzReadRepository`/permission checker, `Logger`.

#### `generateTemplate(): Promise<Buffer>`
- Dùng `exceljs` tạo workbook: sheet "Participants" (header 6 cột + 2 dòng ví dụ), sheet "Huong dan".
- Trả buffer để controller stream.

#### `importParticipants(meetingId, file, options, authUser, clientContext): Promise<ImportReport>`

**Step 0 — Request-level validation**
1. Validate file tồn tại + MIME `.xlsx` → `400 INVALID_FILE_FORMAT`.
2. Validate size ≤ limit → `400 FILE_TOO_LARGE`.
3. Load meeting → `404 MEETING_NOT_FOUND`; status ∈ {scheduled, in_progress} → `400 INVALID_MEETING_STATUS`.
4. Private check → `403 FORBIDDEN_ACCESS`.

**Step 1 — Parse & structural validation**
5. `exceljs` load buffer, đọc sheet đầu, map header. Sai header/rỗng → `400 INVALID_TEMPLATE`.
6. Số dòng > `MAX_IMPORT_ROWS` → `400 IMPORT_ROW_LIMIT_EXCEEDED`.
7. Chuẩn hóa từng dòng thành `ParsedRow { row, type, email?, employeeCode?, fullName?, org?, phone? }`.

**Step 2 — Per-row static validation (không truy vấn)**
8. `type` hợp lệ → nếu sai: `error INVALID_ROW_TYPE`.
9. internal thiếu định danh → `error MISSING_IDENTIFIER`.
10. external thiếu full_name/email → `error INVALID_EXTERNAL_ROW`.
11. Duplicate-in-file (theo email/employee_code chuẩn hóa lowercase) → dòng sau: `error DUPLICATE_IN_FILE`.

**Step 3 — Batch resolve internal**
12. Gom tất cả email + employee_code của dòng internal hợp lệ → 1 query `users` (`WHERE (LOWER(email) IN (...)) OR (employee_code IN (...))` + `account_status='active'`).
13. Map từng dòng → userId. Không khớp/inactive → `error USER_NOT_FOUND`.
14. Duplicate-in-DB internal: query `meeting_participants` theo `meetingId` + tập userId → dòng trùng: `error PARTICIPANT_ALREADY_EXISTS`.
15. Duplicate-in-DB external: query `meeting_external_participants` theo `meetingId` + tập email → trùng: `error PARTICIPANT_ALREADY_EXISTS`.

**Step 4 — Warning evaluation (chỉ dòng còn hợp lệ)**
16. Conflict lịch: gọi `checkParticipantConflicts([userIds], startTime, endTime)`; dòng có conflict → `warning SCHEDULE_CONFLICT`.
17. Capacity lũy kế: `currentCount = getAttendeeCount(meetingId)`; `willAdd = số internal hợp lệ`; nếu `currentCount + willAdd > room.capacity`:
    - policy=`block` → các dòng vượt (từ dòng thứ `capacity-currentCount+1`) → `error ROOM_CAPACITY_EXCEEDED`.
    - policy=`warning` → nếu actor không có `override_capacity` → `error ROOM_CAPACITY_EXCEEDED`; nếu có → `warning ROOM_CAPACITY_WARNING`.

**Step 5 — Two-step gate**
18. Nếu tồn tại dòng `warning` và `options.forceAddWithWarnings !== true`:
    - Trả `422 WARNING_CONFIRMATION_REQUIRED` kèm preview `results[]` (status ∈ valid/warning/error). **Không ghi DB.**

**Step 6 — Commit (per-row transaction)**
19. Với mỗi dòng KHÔNG lỗi cứng (valid + warning đã xác nhận):
    - internal → `persistInternalParticipant(em, meetingId, userId, authUser, ctx)` (lõi extract: insert participant + audit) trong transaction riêng + pessimistic lock + re-check duplicate.
    - external → `persistExternalParticipant(em, meetingId, rowData, authUser, ctx)`.
    - Thành công → `success` + participantId; lỗi runtime (vd race duplicate) → `failed` + reason.
20. Thu thập `addedInternalUserIds[]`, `addedExternalEmails[]`.

**Step 7 — Notifications (best-effort, ngoài transaction)**
21. Nếu `addedInternalUserIds.length > 0` → **1** `createNotification` in-app gom (`recipient_user_ids_json=addedInternalUserIds`). KHÔNG email.
22. Với mỗi email trong `addedExternalEmails` → `enqueueEmailNotification({ toEmails: [email], ... })` (riêng từng khách).

**Step 8 — Audit tổng + return**
23. Ghi `audit_logs` `IMPORT_PARTICIPANTS` với số liệu tổng.
24. Return `ImportReport { totalRows, successCount, failedCount, warningCount, results }`.

### Refactor extract (bắt buộc)
- Tách `persistInternalParticipant(em, ...)` và `persistExternalParticipant(em, ...)` (chỉ insert + audit, KHÔNG notification) từ 2 hàm add hiện có.
- `addInternalParticipant`/`addExternalParticipant` cũ: gọi lõi + giữ nguyên notification hiện tại (test hồi quy).

---

## 9. Validation Plan

### DTO (`ImportParticipantsDto`)
| Field | Rule | Decorator |
|---|---|---|
| `forceAddWithWarnings` | optional boolean (from multipart string) | `@IsOptional()` `@Transform(...)` `@IsBoolean()` |

### File validation (service/interceptor)
| Check | Error |
|---|---|
| MIME `.xlsx` | `400 INVALID_FILE_FORMAT` |
| Size ≤ limit | `400 FILE_TOO_LARGE` |
| Header đúng | `400 INVALID_TEMPLATE` |
| ≤ MAX rows | `400 IMPORT_ROW_LIMIT_EXCEEDED` |

---

## 10. Error Handling Plan
- Lỗi cấp request → throw exception chuẩn (`BadRequest`/`NotFound`/`Forbidden`/`UnprocessableEntity`).
- Lỗi cấp dòng → KHÔNG throw, đưa vào `results[]`.
- Per-row transaction fail → dòng `failed`, không rollback dòng khác.
- Notification fail → log, không ảnh hưởng report.

---

## 11. Testing Strategy

### 11.1 Unit — Parser & Resolver (`participant-import.service.spec.ts`)
- Parse header đúng/sai, file rỗng, quá số dòng.
- Resolve email khớp, fallback employee_code, missing identifier, user not found/inactive.
- Duplicate-in-file, duplicate-in-DB (internal + external).

### 11.2 Unit — Warning & Commit
- Conflict lịch → warning; capacity lũy kế block → error; warning + no override perm → error.
- Two-step: warning + force=false → 422 không ghi DB; force=true → commit.
- Partial success: mix hợp lệ + lỗi.
- Private meeting → 403.

### 11.3 Unit — Notification
- ≥1 internal added → đúng 1 createNotification in-app gom, 0 email internal.
- External added → enqueueEmailNotification gọi đúng số khách (mỗi khách 1 lần).

### 11.4 Regression
- `addInternalParticipant`/`addExternalParticipant` đơn lẻ giữ nguyên hành vi sau refactor extract.

### 11.5 Controller (`meetings.controller.spec.ts` hoặc controller riêng)
- 200 report format, 422 preview format, guard integration, template trả xlsx content-type.

---

## 12. Implementation Phases

### Phase A: Foundation (T001–T004)
- **T001** Seed permission `meeting.participant.import` (ADMIN/MANAGER/EMPLOYEE).
- **T002** DTO `ImportParticipantsDto` (+ transform boolean).
- **T003** Response DTO / interface `ImportReport`, `ImportRowResult`.
- **T004** Constants: `MAX_IMPORT_ROWS`, header columns, error codes, file limits.

### Phase B: Refactor extract (T005)
- **T005** Tách `persistInternalParticipant` / `persistExternalParticipant` khỏi 2 hàm add; giữ hành vi cũ.

### Phase C: Import service (T006–T008)
- **T006** Excel parser + structural validation.
- **T007** Identity resolver batch + duplicate detection.
- **T008** `importParticipants()` orchestration (warning, two-step, commit, notification, audit) + `generateTemplate()`.

### Phase D: Controller & Module (T009–T010)
- **T009** 2 endpoint (import + template) trong controller.
- **T010** Wire `ParticipantImportService` vào `meetings.module.ts` providers.

### Phase E: Testing (T011–T013)
- **T011** Service unit tests (parser/resolver/warning/commit/notification).
- **T012** Regression tests cho add đơn lẻ.
- **T013** Controller tests.

### Phase F: Verification (T014–T015)
- **T014** `npm run build`.
- **T015** `npm run lint`.

---

## 13. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Refactor extract phá hành vi add đơn lẻ | Medium | High | Test hồi quy T012 trước khi merge |
| Capacity lũy kế tính sai thứ tự dòng | Medium | Medium | Xác định rõ dòng nào "vượt" theo thứ tự xuất hiện |
| Gom email external gây lộ địa chỉ | Low | High | Enqueue riêng từng khách (đã chốt) |
| File lớn/nhiều dòng gây chậm | Low | Medium | Cap 200 dòng + size ≤2MB, sync đủ nhanh |
| Quá quota mail free | Medium | Low | Chỉ external tốn mail; log số email enqueue |
| Duplicate race per-row | Low | Low | Pessimistic lock + unique constraint → dòng failed, không 500 |

---

## 14. Acceptance Criteria Traceability
| AC | Task |
|---|---|
| AC-001..004 (parse/template) | T004, T006, T008 |
| AC-005..008 (resolve) | T007 |
| AC-009..011 (two-step/capacity) | T008 |
| AC-012 (partial success) | T008 |
| AC-013..014 (notification) | T008 |
| AC-015 (audit) | T008 |
| AC-016 (private) | T008 |

---

## 15. Files to Create / Modify
| File | Action | Mục đích |
|---|---|---|
| `src/database/seeds/2026071000000X-SeedImportParticipantsPermission.ts` | CREATE | Seed permission |
| `src/modules/meetings/dto/import-participants.dto.ts` | CREATE | DTO forceAddWithWarnings |
| `src/modules/meetings/dto/import-participants-response.dto.ts` | CREATE | ImportReport/RowResult |
| `src/modules/meetings/constants/import-participants.constants.ts` | CREATE | MAX rows, headers, error codes |
| `src/modules/meetings/services/participant-import.service.ts` | CREATE | Parser + orchestration + template |
| `src/modules/meetings/services/meetings.service.ts` | MODIFY | Extract persist core |
| `src/modules/meetings/controllers/meetings.controller.ts` | MODIFY | 2 endpoint mới |
| `src/modules/meetings/meetings.module.ts` | MODIFY | Provider mới |
| `src/modules/meetings/services/participant-import.service.spec.ts` | CREATE | Unit tests |
| `src/modules/meetings/services/meetings.service.spec.ts` | MODIFY | Regression add đơn lẻ |
| `src/modules/meetings/controllers/meetings.controller.spec.ts` | MODIFY | Controller tests |

---

## 16. Dependencies & Integration Points
| Dependency | Integration | Ghi chú |
|---|---|---|
| `exceljs` | Parse + generate template | Đã có |
| `@nestjs/platform-express` | `FileInterceptor` | Đã dùng ở avatar |
| `AccountsModule` | `UserEntity` | Resolve internal |
| `NotificationsModule` | `NotificationsService` | In-app gom + email external |
| `AdministrationModule` | `AuditLogEntity`, `SystemConfigEntity` | Audit + capacity policy |
| `RoomsModule` (entity) | `RoomEntity` | Capacity |
| `AuthModule` | Guards + permission check | Auth + override_capacity |
