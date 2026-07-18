# Task List: View Minutes Attachment Detail

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo tasks — retro-documentation, toàn bộ đã implement + test pass trước khi viết file này | Toàn bộ file |

## Checklist
- [x] T001 [US1] Thêm `downloadUrl` vào `MediaFilesService.detail()` (`buildSignedDownloadUrl`) → `src/modules/recording/services/media-files.service.ts`
- [x] T002 [US1] Inject `StorageService` vào `MediaFilesService` (trước đây chưa có) → `src/modules/recording/services/media-files.service.ts`
- [x] T003 [US2] Đổi `MinutesService.listAttachments` sang `loadMinutesForReadCheck` (quyền đọc rộng hơn, dùng chung `canAccessMinutes`) → `src/modules/minutes/services/minutes.service.ts`
- [x] T004 [US3] Thêm `meetingId` filter vào `MinutesQueryDto` + `findMinutesList` → `src/modules/minutes/dto/minutes-query.dto.ts`, `src/modules/minutes/services/minutes.service.ts`
- [x] T005 [US3] Thêm `@ApiQuery` cho `meetingId` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T006 [US4] Migration vá permission `EMPLOYEE` (role `INTERNAL_USER` không tồn tại) → `src/database/migrations/20260717000001-FixMinutesAttachmentEmployeeRole.ts`
- [x] T007 [US5] Migration vá permission `recording.files.read` cho `BUSINESS_ADMIN` → `src/database/migrations/20260717000002-SeedRecordingFilesReadBusinessAdmin.ts`
- [x] T008 [US1] Unit test `MediaFilesService.detail()` — 3 case mới (local/cloud_provider/lỗi sinh token) → `src/modules/recording/services/media-files.service.spec.ts`
- [x] T009 [US2] Unit test `loadMinutesForReadCheck` — 5 case mới (published+participant, published+outsider, draft+non-preparer, admin bypass, not-found) → `src/modules/minutes/services/minutes.service.spec.ts`
- [x] T010 Chạy 2 migration thật trên DB dev (`npm run migration:run:tsx`) + verify qua JWT login response (permissions xuất hiện đúng cho role `EMPLOYEE`/`BUSINESS_ADMIN`) + gọi API thật (`GET /meeting-minutes?meetingId=`, `GET /meeting-minutes/:id/attachments`, `GET /media-files/:fileId`) không còn 403.
- [x] T011 Lint/build/test toàn repo — `npx jest` module `minutes` + `recording`: 179/179 pass; full suite: 2485/2608 pass (123 fail pre-existing không liên quan, đối chiếu memory `project_capstone_be_dev_test_baseline`).
- [x] T012 Cập nhật lại `feat-attach-minutes-document/spec.md`, `plan.md`, `tasks.md` (changelog + mục liên quan) để không còn mâu thuẫn với hành vi mới của `listAttachments`.

## Phase 1: Service Logic

### Task T001/T002 [US1] — `MediaFilesService.buildSignedDownloadUrl`
**File**: `src/modules/recording/services/media-files.service.ts`
**Action**: Inject `StorageService` vào constructor. Thêm method private `buildSignedDownloadUrl(m: MediaFileEntity): string | null` theo pseudo-code plan.md mục 7.1. Gọi trong `detail()`, gán vào field `downloadUrl` của object trả về.
**Outcome**: Response `GET /media-files/:fileId` có thêm `downloadUrl`, không đổi field nào khác.
**Verification**: Unit test T008 pass; `npx jest src/modules/recording/services/media-files.service.spec.ts` 17/17 pass.

### Task T003 [US2] — `MinutesService.loadMinutesForReadCheck`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Thêm method private mới `loadMinutesForReadCheck(minutesId, authUserId)` — load `meeting_minutes` kèm `meeting` (query builder + `leftJoinAndSelect`), lấy effective roles qua `authzRepo`, nếu không phải `SYSTEM_ADMIN`/`BUSINESS_ADMIN` thì đếm participant rồi gọi `canAccessMinutes` (method đã có, dùng chung với `findMinutesDetail`). Đổi `listAttachments` gọi method này thay vì `loadMinutesForOwnerCheck`. `addAttachment`/`removeAttachment` **không đổi** (vẫn `loadMinutesForOwnerCheck`).
**Outcome**: `GET /meeting-minutes/:minutesId/attachments` cho Host/Participant (khi published/archived) và Admin (mọi trạng thái) xem được, không chỉ `preparedBy`.
**Verification**: Unit test T009 pass.

### Task T004/T005 [US3] — Filter `meetingId`
**File**: `src/modules/minutes/dto/minutes-query.dto.ts`, `src/modules/minutes/services/minutes.service.ts`, `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm `@IsOptional() @IsUUID('4') meetingId?: string` vào DTO. Thêm `if (queryDto.meetingId) qb.andWhere('meeting.id = :meetingId', ...)` trong `findMinutesList` (đặt cạnh filter `roomId`). Thêm `@ApiQuery({ name: 'meetingId', ... })` vào controller.
**Outcome**: `GET /meeting-minutes?meetingId=X` trả đúng biên bản của cuộc họp `X` (nếu có), theo đúng scope rule theo role đã có (không đổi).
**Verification**: Build pass, dùng thật qua FE (xem `minutesServices.js`).

## Phase 2: Permission Migrations

### Task T006 [US4] — Vá `EMPLOYEE` cho 4 permission minutes
**File**: `src/database/migrations/20260717000001-FixMinutesAttachmentEmployeeRole.ts`
**Action**: Copy khuôn `20260711000001-SeedRecordingUploadTrackEmployeeRole.ts`, lặp qua 4 `permissionCode` (`meeting.minutes.read`, `meeting.minutes.attachment.create/read/delete`), `INSERT INTO role_permissions ... WHERE role_code = 'EMPLOYEE' ON CONFLICT DO NOTHING`. `down()` xóa đối xứng theo cả `permission_code` và `role_code`.
**Outcome**: Role `EMPLOYEE` (Host/Participant thật) có đủ quyền đọc/ghi minutes + attachment mà migration gốc (`20260702010000`, `20260702020000`) định cấp nhưng cấp nhầm role `INTERNAL_USER` không tồn tại.
**Verification**: Chạy `npm run migration:run:tsx` — log xác nhận `INSERT ... PARAMETERS: ["EMPLOYEE", <permissionId>]` cho cả 4 permission, `Applied 2 migration(s)`.

### Task T007 [US5] — Vá `BUSINESS_ADMIN` cho `recording.files.read`
**File**: `src/database/migrations/20260717000002-SeedRecordingFilesReadBusinessAdmin.ts`
**Action**: Cùng khuôn T006, 1 permission (`recording.files.read`), 1 role (`BUSINESS_ADMIN`).
**Outcome**: Business Admin (Primary Actor UC-140) gọi được `GET /media-files/:fileId` (trước đó 403 `FORBIDDEN` dù xem được danh sách qua `meeting.minutes.attachment.read`).
**Verification**: Chạy migration thật, xác nhận qua log.

## Phase 3: Tests & Verification

### Task T008 [US1] — Unit test `MediaFilesService.detail()`
**File**: `src/modules/recording/services/media-files.service.spec.ts`
**Action**: Mock `StorageService.generateSignedDownloadToken`; 3 case: (1) `storageProvider=local` → `downloadUrl` chứa `secure-download?token=`, gọi đúng `(fileId, ttl)`; (2) `storageProvider=cloud_provider` → `downloadUrl = fileUrl`, không gọi `generateSignedDownloadToken`; (3) `generateSignedDownloadToken` throw → `downloadUrl = null`, không throw ra ngoài. Sửa `ConfigService` mock trong `beforeEach` để phân biệt theo key (`API_PUBLIC_BASE_URL`, `MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS`) thay vì trả cùng 1 giá trị cho mọi key.
**Outcome**: 3/3 test pass, không phá vỡ 14 test cũ trong cùng file.
**Verification**: `npx jest src/modules/recording/services/media-files.service.spec.ts` → 17/17 pass.

### Task T009 [US2] — Unit test `loadMinutesForReadCheck`
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: `describe` mới riêng, mock `dataSource.getRepository` phân nhánh theo entity (`MeetingParticipantEntity` → `participantRepo.count`, còn lại → query builder trả `minutesQb`), mock `authzRepo.getEffectiveRolesAndPermissions`. 5 case: published+participant (200), published+outsider (403), draft+non-preparer dù là participant (403), `BUSINESS_ADMIN` bypass participant check, không tồn tại (404). Cũng sửa 2 test cũ của `listAttachments` (đổi stub từ `loadMinutesForOwnerCheck` sang `loadMinutesForReadCheck`).
**Outcome**: 5 test mới + 2 test cũ đã sửa đều pass.
**Verification**: `npx jest src/modules/minutes` → toàn bộ suite `minutes` pass.

### Task T010 — Verify thật trên DB dev
**Action**: Chạy `npm run migration:run:tsx`, login qua API thật với user role `EMPLOYEE`+`BUSINESS_ADMIN` (tài khoản có nhiều role), xác nhận JWT response chứa đủ 4+1 permission mới. Gọi `GET /meeting-minutes/:minutesId/attachments` cho biên bản `published` mà user chỉ là participant (không phải preparedBy) → 200 (trước đây sẽ là 403 `NOT_MINUTES_OWNER`). Gọi `GET /meeting-minutes?meetingId=X` → đúng biên bản.
**Outcome**: Xác nhận hành vi đúng trên môi trường thật, không chỉ unit test.
**Verification**: Log network + response body khớp kỳ vọng.

### Task T011 — Lint/build/test toàn repo
**Action**: `npx jest` toàn repo.
**Outcome**: Module `minutes`+`recording`: 179/179 pass. Toàn repo: 2485/2608 pass — 123 fail thuộc 19 suite khác (`scheduler`, `live-meeting`, `accounts`, `attendance`, `auth-email`, `meetings` dto/controller/service...), xác nhận pre-existing (không đụng tới các module đó), khớp memory `project_capstone_be_dev_test_baseline`.
**Outcome**: Không phát sinh regression.

## Phase 4: Documentation Sync

### Task T012 — Cập nhật spec-kit của `feat-attach-minutes-document`
**Action**: Thêm changelog 2026-07-17, cập nhật mục 1.4/2.1/2.2/2.3/3.5/7.2/8.1 của `spec.md`; mục 6.2/4.3/7.3/9.1 của `plan.md`; changelog + coverage table của `tasks.md` — phản ánh đúng: List (đọc) đã mở rộng quyền, Upload/Delete (ghi) giữ nguyên preparedBy-only.
**Outcome**: 2 feature folder nhất quán với nhau, không còn tài liệu nào mô tả sai hành vi thật của code.
**Verification**: Đọc lại chéo cả 2 folder, không còn câu nào nói "chỉ preparedBy xem được" mà không kèm ghi chú "trước 2026-07-17"/"Upload/Delete only".

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-003 | T001 (không đổi, chỉ thêm field) |
| FR-004, FR-005 | T001, T002, T008 |
| FR-006 | T001, T008 (case lỗi sinh token) |
| FR-007, FR-008, FR-009 | Kế thừa T001 (không đổi) |
| FR-010 | T004, T005 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001 | T001, T008 |
| AC-002 | T001, T008 |
| AC-003, AC-004 | T006, T007, T010 |
| AC-005 | Kế thừa (không đổi) |
| AC-006 | Kế thừa (không đổi) |
| AC-007 | T001, T008 |
| AC-008 | T004, T010 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| MEDIA_FILE_NOT_FOUND | 404 | Kế thừa (không đổi) |
| FORBIDDEN | 403 | T006, T007 (vá role thiếu, không đổi guard) |

## Dependencies Graph
```text
T002 ─┐
      ├─> T001 ─> T008
T004 ─┴─> T005
T003 ─────────> T009
T006 ─┐
T007 ─┴─────────────────> T010 ─> T011 ─> T012
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T002, T001 | 1 | Signed URL trong media-files detail |
| 2 | T003 | 1 | Quyền đọc list attachments |
| 3 | T004, T005 | 1 | Filter meetingId |
| 4 | T006, T007 | 2 | Migration vá permission |
| 5 | T008, T009 | 3 | Unit test |
| 6 | T010 | 3 | Verify thật trên DB dev |
| 7 | T011 | 3 | Lint/build/test toàn repo |
| 8 | T012 | 4 | Đồng bộ tài liệu speckit |
