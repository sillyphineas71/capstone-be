# Tasks: Import thành viên cuộc họp bằng Excel

- **Feature ID**: MEET-IMPORT-PARTICIPANT-001
- **Created**: 2026-07-10
- **Based on**: spec.md, plan.md, research.md, data-model.md, contracts/import-participants-api.md, quickstart.md

---

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-10 | Khởi tạo tasks cho tính năng import Excel | Toàn bộ file |

---

## Phase 1: Foundation

### 1.1 Seed Permission
- [ ] **T001** Tạo seed `src/database/seeds/2026071000000X-SeedImportParticipantsPermission.ts`
  - Permission `meeting.participant.import` (`module_code='meetings'`, `action_code='participant_import'`)
  - Gán role: ADMIN, MANAGER, EMPLOYEE
  - Pattern: giống `20260610000001-SeedAddParticipantPermissions.ts`
  - Đăng ký seed vào runner nếu dự án có danh sách seed tập trung
  - Outcome: permission record + role_permissions mapping

### 1.2 DTO & Response
- [ ] **T002** [P] Tạo `src/modules/meetings/dto/import-participants.dto.ts`
  - Field `forceAddWithWarnings?: boolean` — `@IsOptional()`, `@Transform(({value}) => value === 'true' || value === true)`, `@IsBoolean()`
  - Lưu ý: giá trị đến từ multipart nên là string → cần transform
  - Outcome: DTO ready

- [ ] **T003** [P] Tạo `src/modules/meetings/dto/import-participants-response.dto.ts`
  - Interface/class `ImportRowResult { row, type, identifier, status, reason?, participantId? }`
  - Class `ImportReportDto { totalRows, successCount, failedCount, warningCount, results }` (constructor `Object.assign`)
  - Outcome: Response DTO ready

### 1.3 Constants
- [ ] **T004** [P] Tạo `src/modules/meetings/constants/import-participants.constants.ts`
  - `MAX_IMPORT_ROWS = 200`
  - `MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024`
  - `IMPORT_TEMPLATE_HEADERS = ['type','email','employee_code','full_name','organization_name','phone_number']`
  - `XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'`
  - Enum mã lỗi dòng/request (INVALID_ROW_TYPE, MISSING_IDENTIFIER, USER_NOT_FOUND, INVALID_EXTERNAL_ROW, DUPLICATE_IN_FILE, PARTICIPANT_ALREADY_EXISTS, SCHEDULE_CONFLICT, ROOM_CAPACITY_WARNING, ROOM_CAPACITY_EXCEEDED, ...)
  - Outcome: constants tập trung

---

## Phase 2: Refactor Extract (nhạy cảm — làm cẩn thận)

- [ ] **T005** [US1] Extract lõi persist trong `src/modules/meetings/services/meetings.service.ts`
  - Tạo private method `persistInternalParticipant(em: EntityManager, meetingId, userId, authUser, clientContext): Promise<string>`
    - Nội dung: re-check duplicate trong lock, `em.create/save(MeetingParticipantEntity, {...defaults})`, ghi `AuditLogEntity 'ADD_PARTICIPANT'`; return participantId
    - **KHÔNG** chứa notification
  - Tạo private method `persistExternalParticipant(em, meetingId, rowData, authUser, clientContext): Promise<string>`
    - Nội dung: re-check duplicate email, insert `MeetingExternalParticipantEntity`, `MeetingEventEntity`, `AuditLogEntity`
  - Sửa `addInternalParticipant`/`addExternalParticipant` để gọi lõi mới trong transaction, **giữ nguyên** phần notification hiện có
  - **Điều kiện**: hành vi API đơn lẻ không đổi (verify bằng T012)
  - Outcome: lõi dùng chung cho import

---

## Phase 3: Import Service

- [ ] **T006** [US1] Excel parser trong `src/modules/meetings/services/participant-import.service.ts`
  - Method `parseWorkbook(buffer): ParsedRow[]`
    - `exceljs` load buffer, đọc sheet đầu, validate header khớp `IMPORT_TEMPLATE_HEADERS` (thứ tự/tên) → throw `INVALID_TEMPLATE`
    - Map từng row → `ParsedRow { row, type, email?, employeeCode?, fullName?, org?, phone? }`, trim + lowercase định danh
    - File rỗng → `INVALID_TEMPLATE`; > `MAX_IMPORT_ROWS` → `IMPORT_ROW_LIMIT_EXCEEDED`
  - Method `generateTemplate(): Promise<Buffer>` (header + 2 dòng ví dụ + sheet hướng dẫn)
  - Outcome: parser + template generator

- [ ] **T007** [US1] Identity resolver + duplicate detection (cùng service)
  - `resolveInternalUsers(rows): Map<row, userId | errorCode>`: 1 query batch `users` theo email/employee_code + `account_status='active'`
  - Duplicate-in-file: static check trên `ParsedRow[]`
  - Duplicate-in-DB: query `meeting_participants` (internal) + `meeting_external_participants` (external)
  - Static per-row validation: type, missing identifier, external required fields
  - Outcome: mỗi dòng có phân loại sơ bộ valid/error

- [ ] **T008** [US1] Orchestration `importParticipants(meetingId, file, options, authUser, clientContext)` (cùng service)
  - Step 0: file/meeting/status/private validation (throw request-level)
  - Step 1-3: parse → static validate → resolve/duplicate (T006/T007)
  - Step 4: warning — `checkParticipantConflicts` + capacity lũy kế (đọc `meeting.capacity_policy`, override permission)
  - Step 5: two-step gate — có warning + `force!=true` → `422 WARNING_CONFIRMATION_REQUIRED` + preview, không ghi DB
  - Step 6: commit per-row transaction gọi lõi `persistInternal/ExternalParticipant`
  - Step 7: notification — internal 1 in-app gom (không email); external enqueueEmail riêng từng khách (best-effort)
  - Step 8: audit `IMPORT_PARTICIPANTS` + return `ImportReport`
  - Outcome: import hoàn chỉnh

---

## Phase 4: Controller & Module

- [ ] **T009** [US1] Endpoint trong `src/modules/meetings/controllers/meetings.controller.ts`
  - `POST meetings/:meetingId/participants/import`
    - `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('meeting.participant.import')`
    - `@UseInterceptors(FileInterceptor('file'))`, `@UploadedFile() file`, `@Body() dto: ImportParticipantsDto`
    - `@ApiConsumes('multipart/form-data')` + `@ApiBody` schema
    - Trả `{ success, message, data: ImportReport }` (200) hoặc để service throw 422
  - `GET meetings/:meetingId/participants/import/template`
    - Guard + permission như trên
    - Set header `Content-Type` xlsx + `Content-Disposition attachment`; trả buffer từ `generateTemplate()`
  - Outcome: 2 endpoint hoạt động

- [ ] **T010** Wire module `src/modules/meetings/meetings.module.ts`
  - Add `ParticipantImportService` vào `providers`
  - Kiểm tra `NotificationsModule`, `AccountsModule`, `AdministrationModule`, `RoomsModule` (entity), `AuthModule` đã import đủ
  - Outcome: DI resolved

---

## Phase 5: Testing

- [ ] **T011** [P] Unit tests `src/modules/meetings/services/participant-import.service.spec.ts`
  - Parser: header sai → INVALID_TEMPLATE; rỗng; > MAX rows
  - Resolver: email khớp; fallback employee_code; missing identifier; user not found/inactive
  - Duplicate-in-file; duplicate-in-DB (internal + external)
  - Warning: conflict → warning; capacity block → error; capacity warning + no override → error
  - Two-step: warning + force=false → 422 không ghi DB; force=true → commit
  - Partial success: mix valid/error
  - Private → 403
  - Notification: ≥1 internal → đúng 1 createNotification in-app, 0 email internal; external → enqueueEmail đúng số khách
  - Audit tổng ghi đúng số liệu
  - Outcome: coverage > 90%

- [ ] **T012** [P] Regression tests `src/modules/meetings/services/meetings.service.spec.ts`
  - Đảm bảo `addInternalParticipant` vẫn gửi in-app + email; `addExternalParticipant` vẫn không gửi email — sau refactor extract
  - Outcome: hành vi cũ không đổi

- [ ] **T013** [P] Controller tests `src/modules/meetings/controllers/meetings.controller.spec.ts`
  - 200 report format; 422 preview format; guard integration; template trả xlsx content-type
  - Outcome: controller spec pass

---

## Phase 6: Verification

- [ ] **T014** [P] `npm run build` — fix compile errors
- [ ] **T015** [P] `npm run lint` — fix lint errors

---

## Requirements Coverage

| FR | Task |
|---|---|
| FR-001, FR-004 template/limit | T004, T006, T008 |
| FR-002, FR-003, FR-005 parsing | T006 |
| FR-006..FR-011 row validation/resolve | T007 |
| FR-012 private | T008 |
| FR-013, FR-014, FR-015 warning/capacity | T008 |
| FR-016, FR-017, FR-018 two-step | T008 |
| FR-019, FR-020, FR-021 persistence/partial | T005, T008 |
| FR-022, FR-023, FR-024 notification | T008 |
| FR-025 audit | T008 |
| NFR-001..004 | T006, T008 |

| AC | Task |
|---|---|
| AC-001..004 | T006, T008 |
| AC-005..008 | T007 |
| AC-009..011 | T008 |
| AC-012 | T008 |
| AC-013..015 | T008 |
| AC-016 | T008 |

---

## Dependency Graph
```
Phase 1            Phase 2        Phase 3                 Phase 4            Phase 5              Phase 6
T001 (seed) ─┐
T002 (dto) ──┤
T003 (resp) ─┼─→ T005 (extract) ─→ T006 (parse) ─→ T007 (resolve) ─→ T008 (orchestrate) ─→ T009 (controller) ─→ T011/T012/T013 ─→ T014 → T015
T004 (const)─┘                                                                              T010 (module)
```

## Parallel Execution Opportunities
| Task | Song song với | Lý do |
|---|---|---|
| T002 | T003, T004 | File độc lập |
| T011 | T012, T013 | Khác file test |
| T014 | T015 | Build/lint độc lập |

## Implementation Strategy (MVP)
- **Wave 1** (Foundation): T001 → (T002 + T003 + T004)
- **Wave 2** (Extract): T005 (làm trước, có regression)
- **Wave 3** (Service): T006 → T007 → T008
- **Wave 4** (Controller): T009 + T010
- **Wave 5** (Test): T011 + T012 + T013
- **Wave 6** (Verify): T014 → T015

Lưu ý: T005 (refactor extract) là điểm rủi ro cao nhất — hoàn thành T012 (regression) ngay sau để chốt an toàn trước khi build phần import.
