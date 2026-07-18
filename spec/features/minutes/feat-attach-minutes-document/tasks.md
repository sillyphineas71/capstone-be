# Task List: Attach Minutes Document

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo tasks cho feat-attach-minutes-document (chưa implement — chỉ lên spec/plan/tasks theo yêu cầu) | Toàn bộ file |
| 2026-07-02 | QA review + fix 4 lỗi sau khi implement: (1) minutes.module.ts thiếu StorageModule/MediaFileEntity/ConfigModule, (2) migration SQL thiếu placeholder $1/$2/..., (3) minutes.service.spec.ts thiếu import ConflictException/BadRequestException, (4) spec file describe blocks nằm sai scope gây Jest worker crash. Build pass, 52 tests pass. | minutes.module.ts, 20260702020000-SeedMeetingMinutesAttachmentPermissions.ts, minutes.service.spec.ts |
| 2026-07-17 | Gap fix khi build `feat-view-minutes-attachment-detail` (UC-140): (1) role `INTERNAL_USER` seed ở T008 không tồn tại trong DB thật → thêm migration `20260717000001-FixMinutesAttachmentEmployeeRole.ts` cấp lại cho `EMPLOYEE`; (2) `listAttachments` đổi từ `loadMinutesForOwnerCheck` sang `loadMinutesForReadCheck` (quyền đọc rộng hơn theo UC-139) — thêm 5 unit test mới; Upload/Delete không đổi. Full suite: 179/179 test pass module minutes+recording, không regression. | minutes.service.ts, minutes.service.spec.ts, migration mới |

## Checklist
- [x] T001 [US1] Constants (giới hạn size/count, allowlist mimetype) → `src/modules/minutes/constants/minutes-attachment.constants.ts`
- [x] T002 [US1][US2] Response DTO → `src/modules/minutes/dto/minutes-attachment-response.dto.ts`
- [x] T003 [US1] Service logic upload → `src/modules/minutes/services/minutes.service.ts`
- [x] T004 [US2] Service logic list → `src/modules/minutes/services/minutes.service.ts`
- [x] T005 [US3] Service logic delete → `src/modules/minutes/services/minutes.service.ts`
- [x] T006 [US1][US2][US3] Controller endpoints → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T007 [US1][US2][US3] Wire module (import `StorageModule`, `ConfigModule`, `MediaFileEntity`) → `src/modules/minutes/minutes.module.ts`
- [x] T008 [US1][US2][US3] Migration seed 3 permission mới → `src/database/migrations/20260702020000-SeedMeetingMinutesAttachmentPermissions.ts`
- [x] T009 [US1][US2][US3] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts`
- [x] T010 [US1][US2][US3] Unit test controller → `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
- [x] T011 Lint/build/test toàn repo — `npm run build` pass, 52 tests (4 suites) trong module minutes pass

> **Lưu ý**: Toàn bộ task dưới đây là bản kế hoạch (planning) — CHƯA implement. Người dùng sẽ tự thực hiện code sau, theo đúng yêu cầu khi tạo tài liệu này.

## Phase 1: Preparation

### Task T001 [US1] — Tạo constants
**File**: `src/modules/minutes/constants/minutes-attachment.constants.ts`
**Action**: Định nghĩa:
```ts
export const MINUTES_ATTACHMENT_MAX_BYTES_DEFAULT = 20 * 1024 * 1024; // 20MB, override qua ConfigService key MINUTES_ATTACHMENT_MAX_BYTES
export const MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT = 10; // override qua ConfigService key MINUTES_ATTACHMENT_MAX_COUNT
export const MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
];
```
**Outcome**: Constants dùng chung cho service + test, dễ đổi qua env mà không sửa logic (spec.md mục 1.5, [NEEDS CLARIFICATION] — dùng default cho tới khi Product Owner xác nhận).
**Verification**: Compile OK.

### Task T002 [US1][US2] — Tạo response DTO
**File**: `src/modules/minutes/dto/minutes-attachment-response.dto.ts`
**Action**: Định nghĩa class/interface `MinutesAttachmentResponseDto` theo spec.md mục 5.3 (id, fileName, fileType, mimeType, fileSizeBytes, fileUrl, uploadedBy, uploadedAt).
**Outcome**: Type dùng cho response của cả 3 endpoint (upload trả 1 object, list trả mảng).
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T003 [US1] — `MinutesService.addAttachment`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1. Cần inject thêm `StorageService` vào constructor. Dùng `manager.getRepository(MeetingMinutesEntity).createQueryBuilder(...).setLock('pessimistic_write')...` (giống `createDraft`) để lock trước khi đếm + insert `media_files`. Validate file (required/size/mimetype) bằng helper riêng trước khi chạm transaction, để fail sớm không cần lock DB nếu input rõ ràng sai (400 series không cần transaction).
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T009 pass toàn bộ nhánh liên quan upload.

### Task T004 [US2] — `MinutesService.listAttachments`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Query `MediaFileEntity` theo `relatedEntityType='meeting_minutes' AND relatedEntityId=:minutesId AND deletedAt IS NULL`, `ORDER BY uploadedAt DESC`. Trước đó check tồn tại + quyền đọc của `meeting_minutes` (không cần lock, chỉ đọc). **Cập nhật 2026-07-17**: quyền đọc đổi từ `loadMinutesForOwnerCheck` (preparedBy-only) sang `loadMinutesForReadCheck` (`canAccessMinutes` — Host/Participant khi published/archived, Admin luôn qua) — xem plan.md mục 6.2/7.3.
**Outcome**: Trả về `{ items, total, maxCount }`.
**Verification**: Unit test T009 pass các case list (rỗng, có dữ liệu, not-owner cũ + 5 case quyền đọc mới 2026-07-17).

### Task T005 [US3] — `MinutesService.removeAttachment`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.2. Dùng `manager.getRepository(MediaFileEntity).softDelete(fileId)` trong transaction cùng `AuditLogsService.logAction` (theo đúng cách `createDraft` đang gọi audit log — xem ghi chú tasks.md của `feat-create-draft-meeting-minutes` T003: dùng `AuditLogsService.logAction` có sẵn, KHÔNG insert `AuditLogEntity` thủ công qua transaction manager). Sau khi transaction commit thành công, gọi `storageService.deleteFile(storageKey)` best-effort (try/catch, log warn khi lỗi, không throw).
**Outcome**: Method hoàn chỉnh, đúng nhánh lỗi.
**Verification**: Unit test T009 pass các case delete (happy path, not-found, not-owner, not-draft, storage-delete-fail-không-raise).

## Phase 3: Controller Endpoints

### Task T006 [US1][US2][US3] — Thêm 3 route
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts` (đã có `@Controller('meeting-minutes')`; cân nhắc lúc code liệu có nên tách controller riêng `minutes-attachment.controller.ts` cùng prefix nếu class trở nên dài — quyết định không ảnh hưởng contract)
**Action**:
- `POST :minutesId/attachments` — `@UseInterceptors(FileInterceptor('file'))`, `@RequirePermissions('meeting.minutes.attachment.create')`, `@ApiConsumes('multipart/form-data')`, KHÔNG set `limits.fileSize` ở Multer (theo ghi chú `avatar.controller.ts`).
- `GET :minutesId/attachments` — `@RequirePermissions('meeting.minutes.attachment.read')`.
- `DELETE :minutesId/attachments/:fileId` — `@RequirePermissions('meeting.minutes.attachment.delete')`.
Tất cả dùng `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@CurrentUser()`, `ParseUUIDPipe` cho path param.
**Outcome**: 3 endpoint hoạt động end-to-end.
**Verification**: Test T010.

### Task T007 [US1][US2][US3] — Wire module
**File**: `src/modules/minutes/minutes.module.ts`
**Action**: Import `StorageModule` (cho `StorageService`), đảm bảo `TypeOrmModule.forFeature([MediaFileEntity])` đã có sẵn (module `recording` export hay cần import trực tiếp — kiểm tra lúc code theo cách `avatar-submission.service.ts`/`accounts.module.ts` đã làm với `MediaFileEntity`).
**Outcome**: Module compile, DI hoạt động.
**Verification**: `npm run build` pass.

## Phase 4: Seed & Tests

### Task T008 [US1][US2][US3] — Migration seed permission mới
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesAttachmentPermissions.ts`
**Action**: Copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`, seed 3 permission: `meeting.minutes.attachment.create` (action_code=`minutes.attachment.create`), `meeting.minutes.attachment.read` (action_code=`minutes.attachment.read`), `meeting.minutes.attachment.delete` (action_code=`minutes.attachment.delete`), module_code=`minutes`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` cho cả 3.
**Outcome**: Migration `up()`/`down()` đầy đủ, idempotent (`ON CONFLICT DO NOTHING`).
**Verification**: Chạy thử (nếu có DB local) → 3 permission + role_permissions insert đúng.

### Task T009 [US1][US2][US3] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Mock `DataSource`/`EntityManager`/`StorageService`, test các case liệt kê ở plan.md mục 10.1.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path (ENG-01: ≥80% cho business logic mới).
**Verification**: `npm run test` pass.

### Task T010 [US1][US2][US3] — Unit test controller
**File**: `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
**Action**: Test controller gọi đúng service method với đúng tham số (bao gồm file buffer từ `@UploadedFile()`), trả đúng response shape/status code cho từng endpoint.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T011 — Lint/build/test toàn repo
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo, đảm bảo không phá vỡ module khác (đối chiếu với ghi chú T009 của `feat-create-draft-meeting-minutes`: một số test fail pre-existing ở module khác không liên quan `minutes`).
**Outcome**: Build pass, test mới của `minutes` pass 100%, không phát sinh regression mới ngoài các fail pre-existing đã biết.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-002, FR-003 | T003 |
| FR-004, FR-010, FR-011, FR-012, FR-013 | T001, T003, T009 |
| FR-005 | T003 (cleanup storage khi DB fail) |
| FR-006, FR-014 | T005, T009 |
| FR-007 | T003, T005, T009 |
| FR-010b | T004, T009 (gap fix 2026-07-17) |
| FR-008, FR-016 | T003, T009 (concurrency case) |
| FR-015 | T003, T005 (transaction) |
| FR-017 | Không có task riêng — không sửa entity |
| FR-018 | T005 |
| FR-019, FR-020 | T003, T005, T009 |
| FR-021 | T003 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001 | T003, T009 |
| AC-002 | T004, T009 |
| AC-003 | T005, T009 |
| AC-004, AC-005 | T003, T004, T005, T009, T010 |
| AC-004b | T004, T009 (gap fix 2026-07-17) |
| AC-006 | T003, T005, T009 |
| AC-007, AC-014 | T003, T009 |
| AC-008, AC-009, AC-010 | T001, T003, T009 |
| AC-011 | T005, T009 |
| AC-012, AC-013 | T003, T005, T009 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| ATTACHMENT_FILE_REQUIRED | 400 | T003, T009 |
| ATTACHMENT_FILE_TOO_LARGE | 400 | T001, T003, T009 |
| ATTACHMENT_FILE_TYPE_INVALID | 400 | T001, T003, T009 |
| FORBIDDEN | 403 | T006 (guard) |
| NOT_MINUTES_OWNER | 403 | T003, T005, T009 |
| MEETING_MINUTES_ACCESS_DENIED | 403 | T004, T009 (gap fix 2026-07-17, chỉ áp dụng cho List) |
| MINUTES_NOT_FOUND | 404 | T003, T004, T005, T009 |
| ATTACHMENT_NOT_FOUND | 404 | T005, T009 |
| MINUTES_NOT_DRAFT | 409 | T003, T005, T009 |
| ATTACHMENT_LIMIT_EXCEEDED | 409 | T001, T003, T009 |
| ATTACHMENT_STORAGE_FAILED | 502 | T003, T009 |

## Dependencies Graph
```text
T001 ─┐
T002 ─┼─> T003 ─┐
      │         ├─> T006 ─> T007 ─> T008
      ├─> T004 ─┤
      └─> T005 ─┘
                    │
                    └──> T009, T010 ──> T011
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002 | 1 | Constants + DTO |
| 2 | T003, T004, T005 | 2 | Service (upload/list/delete) |
| 3 | T006, T007 | 3 | Controller + wiring |
| 4 | T008 | 4 | Migration seed permission |
| 5 | T009, T010 | 4 | Tests |
| 6 | T011 | 4 | Lint/build/test toàn repo |
