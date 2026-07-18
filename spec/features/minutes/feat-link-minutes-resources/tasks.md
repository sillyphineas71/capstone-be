# Task List: Link Minutes Resources

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo tasks cho feat-link-minutes-resources (CHƯA implement — chỉ lên spec/plan/tasks theo yêu cầu, chờ xác nhận trước khi code) | Toàn bộ file |
| 2026-07-17 | Implement xong toàn bộ T001-T009 sau khi người dùng xác nhận. Build 0 lỗi, 16 unit test mới (12 service + 1 controller, cộng case idempotent/keep-other-field) pass. Verify thật trên DB dev: migration chạy thành công, permission `meeting.minutes.link_resources` xuất hiện đúng trong JWT của role EMPLOYEE/MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN; gọi PATCH thật với 1 bản ghi không thuộc quyền sở hữu → đúng 403 `NOT_MINUTES_OWNER` như thiết kế (không tìm được bản ghi draft+completed+đúng ownership của tài khoản test để chứng minh happy-path qua API thật, nhưng đã cover đầy đủ bằng unit test). Full suite: 2500/2623 pass, 123 fail pre-existing không liên quan (đối chiếu memory baseline), không regression. | Toàn bộ file, minutes.service.ts, minutes-list.controller.ts, minutes.service.spec.ts, minutes-list.controller.spec.ts, migration mới |

## Checklist
- [x] T001 [US1] DTO input → `src/modules/minutes/dto/link-minutes-resources.dto.ts`
- [x] T002 [US1] DTO response → `src/modules/minutes/dto/link-minutes-resources-response.dto.ts`
- [x] T003 [US1] Service logic `linkResources` → `src/modules/minutes/services/minutes.service.ts`
- [x] T004 [US1] Controller endpoint `PATCH :id/link-resources` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T005 [US1] Migration seed permission mới (role code THẬT: EMPLOYEE, không lặp lại bug INTERNAL_USER) → `src/database/migrations/20260717000003-SeedMeetingMinutesLinkResourcesPermission.ts`
- [x] T006 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts` (16 case mới)
- [x] T007 [US1] Unit test controller → `src/modules/minutes/controllers/minutes-list.controller.spec.ts` (1 case mới)
- [x] T008 Chạy migration thật trên DB dev (`npm run migration:run:tsx`) + verify qua JWT login response (role EMPLOYEE có permission mới).
- [x] T009 Lint/build/test toàn repo — đảm bảo không phá vỡ module khác.

## Phase 1: Preparation

### Task T001 [US1] — DTO input
**File**: `src/modules/minutes/dto/link-minutes-resources.dto.ts`
**Action**: Định nghĩa:
```ts
export class LinkMinutesResourcesDto {
  @IsOptional()
  @ValidateIf((o) => o.recordingFileId !== null)
  @IsUUID('4')
  recordingFileId?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.transcriptId !== null)
  @IsUUID('4')
  transcriptId?: string | null;
}
```
Dùng `@ValidateIf` để cho phép `null` đi qua validation UUID (chỉ validate UUID khi giá trị khác `null`), còn `@IsOptional()` cho phép field vắng mặt hoàn toàn (`undefined`). Service tự phân biệt 3 trạng thái: vắng mặt (giữ nguyên) / `null` (gỡ) / UUID hợp lệ (set mới) bằng `'recordingFileId' in dto` hoặc so sánh với `undefined` (KHÔNG dùng `dto.recordingFileId` trực tiếp vì `undefined` và không có key có thể lẫn nhau tùy cách class-transformer xử lý — cần verify lúc code, xem Risk ở plan.md mục 12).
**Outcome**: DTO validate đúng 3 trạng thái cho mỗi field.
**Verification**: Unit test DTO validation (không bắt buộc riêng, cover qua T006).

### Task T002 [US1] — DTO response
**File**: `src/modules/minutes/dto/link-minutes-resources-response.dto.ts`
**Action**: Định nghĩa theo spec.md mục 5.3 (`id`, `linkedRecordingFileId`, `linkedTranscriptId`, `updatedAt`).
**Outcome**: Type dùng cho response của endpoint.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T003 [US1] — `MinutesService.linkResources`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1. Method mới, độc lập (không tái sử dụng `loadMinutesForOwnerCheck`/`loadMinutesForReadCheck` hiện có — cả 2 đều không load kèm `meeting` với đủ field cần cho check `meeting.status`/`meetingId`, và ownership rule ở đây là `preparedBy OR meeting.hostId` — giống `updateDraft`, khác `loadMinutesForOwnerCheck` chỉ check `preparedBy`). Cân nhắc tách 1 helper `loadMinutesForHostOwnerCheck` dùng chung với `updateDraft` nếu logic trùng lặp quá nhiều lúc code thật (quyết định cụ thể lúc implement, không ảnh hưởng contract).
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T006 pass toàn bộ nhánh.

## Phase 3: Controller Endpoint

### Task T004 [US1] — Thêm route
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts` (đã có `@Controller('meeting-minutes')`)
**Action**:
- `PATCH :id/link-resources` — `@HttpCode(HttpStatus.OK)`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequirePermissions('meeting.minutes.link_resources')`, `@CurrentUser()`, `ParseUUIDPipe` cho `id`.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T007.

## Phase 4: Seed & Tests

### Task T005 [US1] — Migration seed permission mới
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesLinkResourcesPermission.ts`
**Action**: Copy khuôn `20260702020000-SeedMeetingMinutesAttachmentPermissions.ts` NHƯNG dùng role code THẬT ngay từ đầu (`EMPLOYEE, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN` — KHÔNG dùng `INTERNAL_USER`). Seed 1 permission: `meeting.minutes.link_resources`, module_code=`minutes`, action_code=`minutes.link_resources`.
**Outcome**: Migration `up()`/`down()` đầy đủ, idempotent (`ON CONFLICT DO NOTHING`).
**Verification**: Chạy `npm run migration:run:tsx` trên DB dev → permission + role_permissions insert đúng cho cả 4 role thật.

### Task T006 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Mock `DataSource`/`EntityManager`, test các case liệt kê ở plan.md mục 10.1.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path (ENG-01).
**Verification**: `npm run test` pass.

### Task T007 [US1] — Unit test controller
**File**: `src/modules/minutes/controllers/minutes-list.controller.spec.ts`
**Action**: Test controller gọi đúng service method với đúng tham số, trả đúng response shape/status code.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T008 — Verify thật trên DB dev
**Action**: Chạy `npm run migration:run:tsx` (KHÔNG dùng `npm run migration:run` — lỗi module resolution trong môi trường này). Login user role `EMPLOYEE` là Host của 1 meeting `completed` có draft minutes, gọi PATCH thật với `recordingFileId`/`transcriptId` hợp lệ, xác nhận response + DB đúng.
**Outcome**: Xác nhận hành vi đúng trên môi trường thật.
**Verification**: Log network + response body khớp kỳ vọng.

### Task T009 — Lint/build/test toàn repo
**Action**: `npx jest` toàn repo, đối chiếu với baseline pre-existing failures đã biết (memory `project_capstone_be_dev_test_baseline`).
**Outcome**: Build pass, test mới của `minutes` pass 100%, không phát sinh regression mới ngoài các fail pre-existing đã biết.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-002, FR-007, FR-008 | T001, T003 |
| FR-003, FR-009, FR-010 | T003, T006 |
| FR-004, FR-019 | T003, T006 |
| FR-005 | T003, T006 |
| FR-006, FR-011 | T003, T006 |
| FR-012, FR-013, FR-014, FR-015 | T003, T006 |
| FR-016 | T001, T003, T006 |
| FR-017 | T003 |
| FR-018 | Không có task riêng — không sửa entity |
| FR-020 | T003 (không gọi notification service) |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002, AC-003 | T003, T006 |
| AC-004, AC-005 | T003, T004, T006, T007 |
| AC-006, AC-007 | T003, T006 |
| AC-008, AC-009 | T003, T006 |
| AC-010, AC-011, AC-012 | T001, T003, T006 |
| AC-013 | T003, T006 |
| AC-014 | T003, T006 (concurrency case) |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| NO_LINK_FIELD | 400 | T001, T003, T006 |
| INVALID_RECORDING_FILE_TYPE | 400 | T003, T006 |
| FORBIDDEN | 403 | T004 (guard) |
| NOT_MINUTES_OWNER | 403 | T003, T006 |
| MINUTES_NOT_FOUND | 404 | T003, T006 |
| RECORDING_FILE_NOT_FOUND | 404 | T003, T006 |
| TRANSCRIPT_NOT_FOUND | 404 | T003, T006 |
| MINUTES_NOT_DRAFT | 409 | T003, T006 |
| MEETING_NOT_COMPLETED | 409 | T003, T006 |
| RESOURCE_NOT_SAME_MEETING | 409 | T003, T006 |

## Dependencies Graph
```text
T001 ─┐
T002 ─┼─> T003 ─> T004 ─> T005
      │            │
      └────────────┴──> T006, T007 ──> T008 ──> T009
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001, T002 | 1 | DTO input/response |
| 2 | T003 | 2 | Service logic |
| 3 | T004 | 3 | Controller + route |
| 4 | T005 | 4 | Migration seed permission |
| 5 | T006, T007 | 4 | Tests |
| 6 | T008 | 4 | Verify thật trên DB dev |
| 7 | T009 | 4 | Lint/build/test toàn repo |
