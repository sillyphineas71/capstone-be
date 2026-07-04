# Task List: Delete Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo tasks cho feat-delete-draft-meeting-minutes | Toàn bộ file |

## Checklist
- [ ] T001 [US1] Đọc lại `minutes.service.ts` + `notifications.service.ts` thật kỹ trước khi sửa (xem research.md mục 3)
- [ ] T002 [US1] Thêm enum `MINUTES_DELETED_BY_ADMIN` → `src/modules/notifications/entities/notification.entity.ts`
- [ ] T003 [US1] Response type → `src/modules/minutes/dto/delete-draft-minutes-response.dto.ts`
- [ ] T004 [US1] Service logic → `MinutesService.deleteDraft` trong `src/modules/minutes/services/minutes.service.ts`
- [ ] T005 [US1] Controller endpoint `DELETE meeting-minutes/:id` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [ ] T006 [US1] Migration seed permission `meeting.minutes.delete` → `src/database/migrations/<timestamp>-SeedMeetingMinutesDeletePermission.ts`
- [ ] T007 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts` (bổ sung case `deleteDraft`)
- [ ] T008 [US1] Unit test controller → route mới trong controller test tương ứng
- [ ] T009 [US1] Lint/build/test toàn repo

## Phase 0: Xác minh code hiện tại

### Task T001 [US1] — Đọc lại code trước khi sửa
**File**: `src/modules/minutes/services/minutes.service.ts`, `src/modules/notifications/notifications.service.ts`
**Action**: Xác nhận (1) cấu trúc thật của `minutes.service.ts` (đặc biệt nếu `feat-update-draft-meeting-minutes` đã implement trước, kiểm tra `updateDraft` đã được chèn đúng cách chưa), (2) `NotificationsService` có method tiện lợi để tạo 1 notification đơn giản (in-app, 1 recipient) hay cần insert trực tiếp qua repository.
**Outcome**: Biết chính xác cách gọi tạo notification và vị trí chèn `deleteDraft`.
**Verification**: `npm run build` pass trước khi thêm code của feature này.

## Phase 1: Preparation

### Task T002 [US1] — Thêm enum notification mới
**File**: `src/modules/notifications/entities/notification.entity.ts`
**Action**: Thêm `MINUTES_DELETED_BY_ADMIN = 'minutes_deleted_by_admin'` vào enum `NotificationType` (không cần migration, xem research.md mục 3.1).
**Outcome**: Enum sẵn sàng dùng trong service.
**Verification**: Compile OK.

### Task T003 [US1] — Response type
**File**: `src/modules/minutes/dto/delete-draft-minutes-response.dto.ts`
**Action**: Định nghĩa type theo data-model.md mục 3 (`deleted, minutesId, deletedAt, cascadedAttachmentCount`).
**Outcome**: Type dùng cho response controller.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T004 [US1] — Viết `MinutesService.deleteDraft`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1: lock row → check tồn tại → check ownership-or-admin (dùng `AuthzReadRepository.getEffectiveRolesAndPermissions`) → check status draft → set `status=deleted`+`deletedAt` → bulk soft-delete `media_files` liên quan → commit → audit log (ngoài transaction, best-effort) → notification có điều kiện (ngoài transaction, best-effort, catch lỗi không raise).
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T007 pass toàn bộ các nhánh.

## Phase 3: Controller Endpoint

### Task T005 [US1] — Thêm route `DELETE :id`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm method controller `deleteDraft` với `@Delete(':id')`, guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions('meeting.minutes.delete')`, `ParseUUIDPipe` cho `:id`, `@CurrentUser()` lấy user, gọi `minutesService.deleteDraft`, trả `{ success: true, message: 'Da xoa bien ban hop nhap thanh cong', data: result }` với `HttpCode(200)`.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T008.

## Phase 4: Seed & Tests

### Task T006 [US1] — Seed permission mới
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesDeletePermission.ts`
**Action**: Copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`, đổi permission_code=`meeting.minutes.delete`, module_code=`minutes`, action_code=`minutes.delete`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Outcome**: Migration chạy được, permission + role_permissions insert đúng.
**Verification**: Chạy thử theo quickstart.md mục 2.

### Task T007 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Test các case ở plan.md mục 10.1: happy path (owner tự xóa, host thay thế, Business Admin, System Admin), not-owner-not-admin (403), status không draft kể cả Admin (409), không tồn tại/đã xóa (404), cascade đúng số lượng + không ảnh hưởng minutes khác, notification có điều kiện (có/không), audit log.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path.
**Verification**: `npm run test` pass.

### Task T008 [US1] — Unit test controller
**File**: controller spec tương ứng
**Action**: Test controller gọi đúng service method, trả đúng response shape, đúng `HttpStatus 200`.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T009 [US1] — Lint/build/test
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo.
**Outcome**: Build pass, test module `minutes`/`notifications` pass toàn bộ (cũ + mới).
**Verification**: Ghi lại kết quả thực tế trong changelog của file này sau khi hoàn thành.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-002 | T004 |
| FR-003, FR-004 | T004, T007 |
| FR-005 | T004 |
| FR-006, FR-007, FR-015 | T002, T004, T007 |
| FR-008 | T004, T007 |
| FR-009, FR-010, FR-011 | T004, T005, T007 |
| FR-012, FR-013 | T004 |
| FR-016 | T004, T007 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002, AC-003, AC-007 | T007 |
| AC-004 | T004, T007 |
| AC-005 | T007 |
| AC-006 | T005 (guard) |
| AC-008 | T004, T007 |
| AC-009 | T005 |
| AC-010, AC-011 | T004, T007 |
| AC-012, AC-013 | T002, T004, T007 |
| AC-014 | T004, T007 |
| AC-015 | T004, T007 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| FORBIDDEN | 403 | T005 (guard) |
| NOT_MINUTES_OWNER | 403 | T004, T007 |
| MINUTES_NOT_FOUND | 404 | T004, T007 |
| MINUTES_NOT_DRAFT | 409 | T004, T007 |

## Dependencies Graph
```text
T001 ─> T002 ─┐
       T003 ─┼─> T004 ─> T005 ─> T006
                    │
                    └──> T007, T008 ──> T009
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001 | 0 | Xác minh code hiện tại |
| 2 | T002, T003 | 1 | Enum + response type |
| 3 | T004 | 2 | Service |
| 4 | T005 | 3 | Controller |
| 5 | T006 | 4 | Seed permission |
| 6 | T007, T008 | 4 | Tests |
| 7 | T009 | 4 | Lint/build/test toàn repo |
