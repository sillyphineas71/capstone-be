# Task List: Issue Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo tasks cho feat-issue-meeting-minutes | Toàn bộ file |

## Checklist
- [x] T001 [US1] Đọc lại `minutes.service.ts` + `minutes-list.controller.ts` thật kỹ trước khi sửa
- [x] T002 [US1] Response type → `src/modules/minutes/dto/issue-minutes-response.dto.ts`
- [x] T003 [US1] Service logic → `MinutesService.issueMinutes` trong `src/modules/minutes/services/minutes.service.ts`
- [x] T004 [US1] Controller endpoint `POST meeting-minutes/:id/issue` → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T005 [US1] Migration seed permission `meeting.minutes.issue` → `src/database/migrations/<timestamp>-SeedMeetingMinutesIssuePermission.ts`
- [x] T006 [US1] Unit test service → `src/modules/minutes/services/minutes.service.spec.ts` (bổ sung case `issueMinutes`)
- [x] T007 [US1] Unit test controller → route mới trong controller test tương ứng
- [x] T008 [US1] Lint/build/test toàn repo

## Phase 0: Xác minh code hiện tại

### Task T001 [US1] — Đọc lại code trước khi sửa
**File**: `src/modules/minutes/services/minutes.service.ts`, `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Xác nhận cấu trúc thật của `minutes.service.ts` sau khi các feature trước (`updateDraft`/`deleteDraft`/`searchMinutesByPerson` nếu đã implement) đã chèn code, và xác nhận danh sách route hiện có trong `minutes-list.controller.ts` (để biết vị trí chèn `POST :id/issue` hợp lý, không xung đột).
**Outcome**: Biết chính xác vị trí chèn code an toàn.
**Verification**: `npm run build` pass trước khi thêm code của feature này.

## Phase 1: Preparation

### Task T002 [US1] — Response type
**File**: `src/modules/minutes/dto/issue-minutes-response.dto.ts`
**Action**: Định nghĩa type theo data-model.md mục 3 (`id, meetingId, title, status, versionNo, issuedBy, issuedAt, updatedAt, notifiedParticipantCount`).
**Outcome**: Type dùng cho response controller.
**Verification**: Type-check pass.

## Phase 2: Service Logic

### Task T003 [US1] — Viết `MinutesService.issueMinutes`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo pseudo-code plan.md mục 7.1: lock row → check tồn tại → check ownership-or-admin (dùng `AuthzReadRepository.getEffectiveRolesAndPermissions`) → check status draft → check `meeting.status === completed` → set `status=published`+`issuedBy`+`issuedAt` → commit → audit log (ngoài transaction, best-effort) → query `meeting_participants` → tạo notification có điều kiện, loại trừ actor (ngoài transaction, best-effort, catch lỗi không raise).
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: Unit test T006 pass toàn bộ các nhánh.

## Phase 3: Controller Endpoint

### Task T004 [US1] — Thêm route `POST :id/issue`
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm method controller `issue` với `@Post(':id/issue')`, guard `JwtAuthGuard, PermissionsGuard`, `@RequirePermissions('meeting.minutes.issue')`, `ParseUUIDPipe` cho `:id`, `@CurrentUser()` lấy user, gọi `minutesService.issueMinutes`, trả `{ success: true, message: 'Ban hanh bien ban cuoc hop thanh cong', data: result }` với `HttpCode(200)`.
**Outcome**: Endpoint hoạt động end-to-end.
**Verification**: Test T007.

## Phase 4: Seed & Tests

### Task T005 [US1] — Seed permission mới
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesIssuePermission.ts`
**Action**: Copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`, đổi permission_code=`meeting.minutes.issue`, module_code=`minutes`, action_code=`minutes.issue`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.
**Outcome**: Migration chạy được, permission + role_permissions insert đúng.
**Verification**: Chạy thử theo quickstart.md mục 2.

### Task T006 [US1] — Unit test service
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Test các case ở plan.md mục 10.1: happy path (owner tự publish, host thay thế, Business Admin, System Admin), not-owner-not-admin (403), status không draft kể cả Admin (409), meeting chưa completed kể cả Admin (409), không tồn tại/đã xóa (404), notification đúng danh sách trừ actor, không tạo notification khi rỗng, audit log, `approved_by`/`visibility_level` không đổi.
**Outcome**: Coverage đầy đủ nhánh lỗi + happy path.
**Verification**: `npm run test` pass.

### Task T007 [US1] — Unit test controller
**File**: controller spec tương ứng
**Action**: Test controller gọi đúng service method, trả đúng response shape, đúng `HttpStatus 200`.
**Outcome**: Test pass.
**Verification**: `npm run test` pass.

### Task T008 [US1] — Lint/build/test
**Action**: Chạy `npm run lint`, `npm run build`, `npm run test` cho toàn repo.
**Outcome**: Build pass, test module `minutes`/`notifications` pass toàn bộ (cũ + mới).
**Verification**: Ghi lại kết quả thực tế trong changelog của file này sau khi hoàn thành.

## Requirements Coverage

### FR Coverage
| FR ID | Task(s) |
| :--- | :--- |
| FR-001, FR-002, FR-003 | T003, T006 |
| FR-004 | T003 |
| FR-005, FR-006, FR-017 | T003, T006 |
| FR-007, FR-008 | T003, T006 |
| FR-009, FR-010, FR-011 | T003, T004, T006 |
| FR-012, FR-013 | T003 |
| FR-014 | T003 (không sửa entity) |
| FR-015 | T003, T006 |
| FR-018 | T003, T006 |

### AC Coverage
| AC ID | Task(s) |
| :--- | :--- |
| AC-001, AC-002, AC-003, AC-007 | T006 |
| AC-004, AC-016 | T003, T006 |
| AC-005 | T006 |
| AC-006 | T004 (guard) |
| AC-008, AC-009, AC-010 | T003, T006 |
| AC-011 | T004 |
| AC-012 | T003, T006 |
| AC-013 | Không cần task riêng (guard có sẵn ở feature update/delete/attach) |
| AC-014 | T003, T006 |
| AC-015 | T003, T006 |
| AC-017 | T003, T006 |

### Error Code Coverage
| Error Code | HTTP Status | Task(s) |
| :--- | :--- | :--- |
| FORBIDDEN | 403 | T004 (guard) |
| NOT_MINUTES_OWNER | 403 | T003, T006 |
| MINUTES_NOT_FOUND | 404 | T003, T006 |
| MINUTES_NOT_DRAFT | 409 | T003, T006 |
| MEETING_NOT_COMPLETED | 409 | T003, T006 |

## Dependencies Graph
```text
T001 ─> T002 ─┐
              ├─> T003 ─> T004 ─> T005
              │
              └──> T006, T007 ──> T008
```

## Implementation Order
| Step | Task(s) | Phase | Description |
| :--- | :--- | :--- | :--- |
| 1 | T001 | 0 | Xác minh code hiện tại |
| 2 | T002 | 1 | Response type |
| 3 | T003 | 2 | Service |
| 4 | T004 | 3 | Controller |
| 5 | T005 | 4 | Seed permission |
| 6 | T006, T007 | 4 | Tests |
| 7 | T008 | 4 | Lint/build/test toàn repo |
