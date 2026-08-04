# Task List: Attach Meeting Agenda Document

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-04 | Khởi tạo tasks + implement ngay trong cùng phiên (spec → plan → tasks → code, theo yêu cầu tuân thủ quy trình Speckit của AGENTS.md) | Toàn bộ file |

## Checklist
- [x] T001 [US1][US2] Constants (giới hạn size/count, allowlist mimetype) → `src/modules/meetings/constants/agenda-attachment.constants.ts`
- [x] T002 [US1][US2][US3] DTO (`AgendaAttachmentDto`, `AgendaAttachmentUploadResponseDto`, `DeleteAgendaAttachmentResponseDto`) → `src/modules/meetings/dto/agenda-attachment.dto.ts`
- [x] T003 [US3] Mở rộng `AgendaItemResponseDto` thêm field `attachments` → `src/modules/meetings/dto/agenda-response.dto.ts`
- [x] T004 [US1] Service logic upload (`addAgendaAttachment`) → `src/modules/meetings/services/meetings.service.ts`
- [x] T005 [US2] Service logic xóa (`removeAgendaAttachment`) → `src/modules/meetings/services/meetings.service.ts`
- [x] T006 [US3] Sửa `getAgendas` load kèm attachments gộp (1 query, không N+1) → `src/modules/meetings/services/meetings.service.ts`
- [x] T007 [US1][US2] Wire `ConfigService`/`StorageService` vào constructor `MeetingsService` (cả 2 module đã `@Global()`, không cần sửa `meetings.module.ts`) → `src/modules/meetings/services/meetings.service.ts`
- [x] T008 [US1][US2] Controller endpoints (POST upload, DELETE) → `src/modules/meetings/controllers/meetings.controller.ts`
- [x] T009 [US1][US2][US3] Unit test service → `src/modules/meetings/tests/agenda-attachment.service.spec.ts`
- [x] T010 [US1][US2] Unit test controller → `src/modules/meetings/tests/agenda-attachment.controller.spec.ts`
- [x] T011 Lint/build/test toàn repo — đối chiếu baseline pre-existing fail đã biết (xem memory `project_capstone_be_dev_test_baseline`)

## Phase 1: Preparation

### Task T001 [US1][US2] — Constants
**File**: `src/modules/meetings/constants/agenda-attachment.constants.ts`
**Action**: `AGENDA_ATTACHMENT_MAX_BYTES_DEFAULT` (20MB), `AGENDA_ATTACHMENT_MAX_COUNT_DEFAULT` (5), `AGENDA_ATTACHMENT_ALLOWED_MIME_TYPES` (pdf/doc/docx/ppt/pptx/xls/xlsx), `AGENDA_ATTACHMENT_MIME_TO_EXTENSIONS` map.
**Verification**: Compile OK.

### Task T002 [US1][US2][US3] — DTO
**File**: `src/modules/meetings/dto/agenda-attachment.dto.ts`
**Action**: `AgendaAttachmentDto` (id, fileName, mimeType, fileSizeBytes, fileUrl, uploadedBy, uploadedAt), `AgendaAttachmentUploadResponseDto` (thêm agendaId/meetingId), `DeleteAgendaAttachmentResponseDto` (fileId, agendaId, deletedAt).
**Verification**: Type-check pass.

### Task T003 [US3] — Mở rộng AgendaItemResponseDto
**File**: `src/modules/meetings/dto/agenda-response.dto.ts`
**Action**: Thêm field `attachments: AgendaAttachmentDto[]` vào `AgendaItemResponseDto`.
**Verification**: Không phá vỡ constructor hiện có ở `replaceAgendas`/`updateAgendaItem` (field optional-at-runtime qua `Object.assign`).

## Phase 2: Service Logic

### Task T004 [US1] — `MeetingsService.addAgendaAttachment`
**File**: `src/modules/meetings/services/meetings.service.ts`
**Action**: Validate file (required/size/mimetype/extension) trước, sau đó load meeting + `checkAgendaWritePermission` + `validateMeetingStatusForAgendaWrite` + load agenda item, `storageService.saveFile()`, rồi transaction có lock `pessimistic_write` trên `meetings` để re-validate + đếm + insert `media_files` + `audit_logs`. Cleanup storage best-effort nếu transaction fail.
**Verification**: Unit test T009 pass toàn bộ nhánh upload.

### Task T005 [US2] — `MeetingsService.removeAgendaAttachment`
**File**: `src/modules/meetings/services/meetings.service.ts`
**Action**: Transaction lock `meetings`, check ownership + status + agenda item tồn tại, tìm `media_files` theo `(fileId, relatedEntityType='meeting_agenda', relatedEntityId=agendaId)`, soft-delete + audit log. Sau commit, best-effort xóa file vật lý.
**Verification**: Unit test T009 pass các case xóa.

### Task T006 [US3] — Mở rộng `getAgendas`
**File**: `src/modules/meetings/services/meetings.service.ts`
**Action**: Sau khi load `agendas`, gộp 1 query `media_files` theo `relatedEntityType='meeting_agenda' AND relatedEntityId IN (agendaIds)`, group theo `relatedEntityId` trong bộ nhớ, gán vào từng `AgendaItemResponseDto.attachments`.
**Verification**: Unit test T009 xác nhận không N+1 (1 query duy nhất cho attachments bất kể số lượng agenda item).

### Task T007 [US1][US2] — Wire DI
**File**: `src/modules/meetings/services/meetings.service.ts`
**Action**: Thêm `ConfigService` (từ `@nestjs/config`) và `StorageService` (từ `../../storage/storage.service.js`) vào constructor `MeetingsService`. Cả `ConfigModule` và `StorageModule` đều `@Global()`/`isGlobal: true` nên KHÔNG cần sửa `meetings.module.ts`.
**Verification**: `npm run build` pass (DI resolve đúng).

## Phase 3: Controller Endpoints

### Task T008 [US1][US2] — Route mới
**File**: `src/modules/meetings/controllers/meetings.controller.ts`
**Action**:
- `POST meetings/:meetingId/agendas/:agendaId/attachments` — `@UseInterceptors(FileInterceptor('file'))`, `@UseGuards(JwtAuthGuard)` (KHÔNG thêm `PermissionsGuard`, đồng bộ 4 route agenda anh em), `@ApiConsumes('multipart/form-data')`, KHÔNG set `limits.fileSize` ở Multer.
- `DELETE meetings/:meetingId/agendas/:agendaId/attachments/:fileId` — `@UseGuards(JwtAuthGuard)`.
Cả 2 dùng `@CurrentUser()`, `ParseUUIDPipe` cho path param, đặt trong khối "Agenda endpoints (UC-MM-09)" hiện có, viết đầy đủ path bắt đầu bằng `meetings` (bắt buộc theo quy ước BE-06 ghi ở comment đầu class).
**Verification**: Test T010.

## Phase 4: Tests

### Task T009 — Unit test service
**File**: `src/modules/meetings/tests/agenda-attachment.service.spec.ts`
**Action**: Mock `DataSource`/`EntityManager`/`ConfigService`/`StorageService`, test các case ở plan.md mục 10.1.
**Verification**: `npm run test` pass.

### Task T010 — Unit test controller
**File**: `src/modules/meetings/tests/agenda-attachment.controller.spec.ts`
**Action**: Test controller gọi đúng service method với đúng tham số (file buffer từ `@UploadedFile()`), trả đúng response shape/status.
**Verification**: `npm run test` pass.

### Task T011 — Lint/build/test toàn repo
**Action**: `npm run lint`, `npm run build`, `npm run test`. Đối chiếu với baseline pre-existing fail đã biết (memory `project_capstone_be_dev_test_baseline` — ~96 test fail do env/mock, không phải regression).

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-002, FR-003 | T004 |
| FR-004, FR-011, FR-013, FR-014, FR-015, FR-016, FR-018 | T001, T004, T009 |
| FR-005 | T004 (cleanup storage khi DB fail) |
| FR-006, FR-017 | T005, T009 |
| FR-007 | T006, T009 |
| FR-008 | T004, T005, T009 |
| FR-009, FR-020 | T004, T009 (concurrency case) |
| FR-010 | T001, T004 |
| FR-012 | T006, T009 |
| FR-019 | T004, T005 (transaction) |
| FR-021 | Không có task riêng — không sửa entity |
| FR-022 | T005 |
| FR-023, FR-024 | T004, T005, T009 |
| FR-025 | T004 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001 | T004, T009 |
| AC-002 | T006, T009 |
| AC-003 | T005, T009 |
| AC-004, AC-005 | T004, T005, T008, T009, T010 |
| AC-006 | T004, T005, T009 |
| AC-007, AC-015 | T004, T009 |
| AC-008, AC-009, AC-010 | T001, T004, T009 |
| AC-011 | T005, T009 |
| AC-012 | T004, T005, T009 |
| AC-013, AC-014 | T004, T005, T009 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| AGENDA_ATTACHMENT_FILE_REQUIRED | 400 | T004, T009 |
| AGENDA_ATTACHMENT_FILE_TOO_LARGE | 400 | T001, T004, T009 |
| AGENDA_ATTACHMENT_FILE_TYPE_INVALID | 400 | T001, T004, T009 |
| AGENDA_WRITE_FORBIDDEN | 403 | T004, T005, T009 |
| AGENDA_READ_FORBIDDEN | 403 | T006, T009 |
| MEETING_NOT_FOUND | 404 | T004, T005, T009 |
| AGENDA_ITEM_NOT_FOUND | 404 | T004, T005, T009 |
| AGENDA_ATTACHMENT_NOT_FOUND | 404 | T005, T009 |
| AGENDA_MEETING_STATUS_BLOCKED | 409 | T004, T005, T009 |
| AGENDA_ATTACHMENT_LIMIT_EXCEEDED | 409 | T001, T004, T009 |
| AGENDA_ATTACHMENT_STORAGE_FAILED | 502 | T004, T009 |

## Dependencies Graph
```text
T001 ─┐
T002 ─┼─> T004 ─┐
T003 ─┤         ├─> T008 ─> T009, T010 ──> T011
      └─> T005 ─┤
      └─> T006 ─┘
T007 (DI wiring, song song T004/T005)
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002, T003 | 1 | Constants + DTO + mở rộng response DTO |
| 2 | T004, T005, T006, T007 | 2 | Service (upload/xóa/list gộp + DI wiring) |
| 3 | T008 | 3 | Controller |
| 4 | T009, T010 | 4 | Tests |
| 5 | T011 | 4 | Lint/build/test toàn repo |
