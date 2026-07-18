# Task List: Share Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo tasks cho feat-share-meeting-minutes — chưa implement, chờ lệnh triển khai | Toàn bộ file |
| 2026-07-17 | Implement xong T001-T016 (entity, migration CREATE TABLE, DTOs, canAccessMinutes async + 2 call-site await, 3 service method, 3 route, seed permission, 23 test — pass; regression 224 minutes test pass). Đánh dấu hoàn thành. | Checkbox `[x]`, Phase 1-5 |

## Checklist
- [x] T001 [US1] Đọc lại `minutes.service.ts` (đặc biệt hàm `canAccessMinutes`, `findMinutesDetail`, `loadMinutesForReadCheck`) + `minutes-list.controller.ts` thật kỹ trước khi sửa
- [x] T002 [US1] Entity mới → `src/modules/minutes/entities/meeting-minutes-share.entity.ts`
- [x] T003 [US1] Migration CREATE TABLE → `src/database/migrations/<timestamp>-CreateMeetingMinutesSharesTable.ts`
- [x] T004 [US1] DTO request → `src/modules/minutes/dto/create-minutes-share.dto.ts`
- [x] T005 [US1] DTO response → `src/modules/minutes/dto/minutes-share-response.dto.ts` (grant), `minutes-share-list-response.dto.ts` (list)
- [x] T006 [US1] Sửa `canAccessMinutes()` thành `async`, thêm nhánh share → `src/modules/minutes/services/minutes.service.ts`
- [x] T007 [US1] Cập nhật 2 call-site (`findMinutesDetail`, `loadMinutesForReadCheck`) thêm `await` → cùng file
- [x] T008 [US1] Service logic `shareMinutes()` → cùng file
- [x] T009 [US1] Service logic `unshareMinutes()` → cùng file
- [x] T010 [US1] Service logic `listMinutesShares()` → cùng file
- [x] T011 [US1] 3 route controller (`POST/GET/DELETE .../shares[/:userId]`) → `src/modules/minutes/controllers/minutes-list.controller.ts`
- [x] T012 [US1] Migration seed 3 permission → `src/database/migrations/<timestamp>-SeedMeetingMinutesSharePermissions.ts`
- [x] T013 [US1] Unit test `canAccessMinutes()` (nhánh mới + regression) → `minutes.service.spec.ts`
- [x] T014 [US1] Unit test `shareMinutes`/`unshareMinutes`/`listMinutesShares` → `minutes.service.spec.ts`
- [x] T015 [US1] Unit test controller (3 route) → controller test tương ứng
- [x] T016 [US1] Lint/build/test toàn repo + regression check module `minutes` (issue/update/delete/attach/link-resources/view-detail)

## Phase 0: Xác minh code hiện tại

### Task T001 [US1] — Đọc lại code trước khi sửa
**File**: `src/modules/minutes/services/minutes.service.ts`, `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Xác nhận số dòng chính xác của `canAccessMinutes()`, `findMinutesDetail()`, `loadMinutesForReadCheck()` sau các feature trước (có thể đã dịch chuyển số dòng nếu `feat-export-meeting-minutes` đã implement trước). Xác nhận danh sách route hiện có để biết vị trí chèn 3 route mới an toàn.
**Outcome**: Biết chính xác vị trí sửa, tránh conflict merge/context mismatch (theo Markdown/code Editing Safety Rules của CLAUDE.md — "Prefer editing small, clearly bounded sections").
**Verification**: `npm run build` pass trước khi thêm code của feature này.

## Phase 1: Data Model

### Task T002 [US1] — Entity mới
**File**: `src/modules/minutes/entities/meeting-minutes-share.entity.ts`
**Action**: Định nghĩa `MeetingMinutesShareEntity` theo data-model.md mục 1 (id, minutesId, userId, grantedBy, grantedAt + 3 relation `ManyToOne`).
**Outcome**: Entity TypeORM sẵn sàng dùng trong repository.
**Verification**: Type-check pass, entity register đúng trong `minutes.module.ts` (`TypeOrmModule.forFeature([...])`).

### Task T003 [US1] — Migration CREATE TABLE
**File**: `src/database/migrations/<timestamp>-CreateMeetingMinutesSharesTable.ts`
**Action**: `CREATE TABLE meeting_minutes_shares` theo data-model.md mục 1 (UUID PK, 2 FK CASCADE, `UNIQUE(minutes_id, user_id)`, 2 index). Viết `down()` đầy đủ (`DROP TABLE`).
**Outcome**: Bảng tồn tại trong DB sau `migration:run`.
**Verification**: `npm run migration:run`, `\d meeting_minutes_shares` trong psql xác nhận đúng cấu trúc; `npm run migration:revert` rollback sạch.

## Phase 2: DTO

### Task T004 [US1] — DTO request
**File**: `src/modules/minutes/dto/create-minutes-share.dto.ts`
**Action**: `userId: string` (`@IsUUID('4')`, bắt buộc).
**Outcome**: DTO validate đúng theo spec.md mục 6.1.

### Task T005 [US1] — DTO response
**File**: `src/modules/minutes/dto/minutes-share-response.dto.ts`, `src/modules/minutes/dto/minutes-share-list-response.dto.ts`
**Action**: Định nghĩa theo data-model.md mục 4 (`MinutesShareData`, `MinutesShareListData`).
**Outcome**: Type dùng cho response controller.

## Phase 3: Service Logic

### Task T006 [US1] — Sửa `canAccessMinutes()` thành async
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Đổi signature `private canAccessMinutes(...): boolean` → `private async canAccessMinutes(...): Promise<boolean>`. Thêm nhánh mới: sau khi check `isHost || isParticipant` (trả `true` ngay nếu đúng, giữ nguyên early-return để tránh query DB thừa), thêm query `meeting_minutes_shares` (dùng `MeetingMinutesShareEntity`) cho nhánh `published`/`archived`. Xem plan.md mục 7.4 cho code mẫu đầy đủ.
**Outcome**: Hàm mở rộng đúng, KHÔNG phá vỡ nhánh `draft`/`isAdmin` hiện có.
**Verification**: T013.

### Task T007 [US1] — Cập nhật 2 call-site thêm `await`
**File**: `src/modules/minutes/services/minutes.service.ts` (trong `findMinutesDetail()` và `loadMinutesForReadCheck()`)
**Action**: **CỰC KỲ QUAN TRỌNG** (xem research.md mục 5) — thêm `await` trước MỌI lời gọi `this.canAccessMinutes(...)`. Sau khi sửa, chạy `grep -n "canAccessMinutes(" src/modules/minutes/services/minutes.service.ts` để liệt kê TẤT CẢ lời gọi, đối chiếu thủ công từng dòng xác nhận có `await`.
**Outcome**: Không có lời gọi nào thiếu `await` — nếu thiếu, `!this.canAccessMinutes(...)` (Promise luôn truthy) sẽ vô hiệu hóa hoàn toàn guard, làm lộ TOÀN BỘ biên bản `draft` cho mọi user.
**Verification**: T013 test #19 (bắt buộc chạy trước, coi là gate — không merge nếu test này fail hoặc bị bỏ qua).

### Task T008 [US1] — `shareMinutes()`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo plan.md mục 7.1: load minutes+meeting → ownership-or-admin → status published → validate target user (tồn tại + active) → INSERT (catch unique_violation → 409) → audit log → trả response.
**Outcome**: Method hoàn chỉnh, throw đúng exception/code cho từng nhánh lỗi ở spec.md mục 6.
**Verification**: T014.

### Task T009 [US1] — `unshareMinutes()`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo plan.md mục 7.2: load minutes+meeting → ownership-or-admin → status published → DELETE (0 affected rows → 404) → audit log → trả response.
**Outcome**: Method hoàn chỉnh.
**Verification**: T014.

### Task T010 [US1] — `listMinutesShares()`
**File**: `src/modules/minutes/services/minutes.service.ts`
**Action**: Implement theo plan.md mục 7.3: load minutes+meeting → ownership-or-admin (KHÔNG check status) → query `meeting_minutes_shares` JOIN `users` (2 lần: target + grantedBy) → trả danh sách sort theo `granted_at DESC`.
**Outcome**: Method hoàn chỉnh.
**Verification**: T014.

## Phase 4: Controller

### Task T011 [US1] — 3 route controller
**File**: `src/modules/minutes/controllers/minutes-list.controller.ts`
**Action**: Thêm `POST :id/shares` (`@HttpCode(201)`, `@RequirePermissions('meeting.minutes.share.create')`), `GET :id/shares` (`@RequirePermissions('meeting.minutes.share.read')`), `DELETE :id/shares/:userId` (`@RequirePermissions('meeting.minutes.share.delete')`) — cả 3 dùng `JwtAuthGuard, PermissionsGuard`, `ParseUUIDPipe` cho path param, `@CurrentUser()`. Đặt ngay sau nhóm route `POST :id/issue`.
**Outcome**: 3 endpoint hoạt động end-to-end.
**Verification**: T015.

## Phase 5: Seed & Tests

### Task T012 [US1] — Migration seed permission
**File**: `src/database/migrations/<timestamp>-SeedMeetingMinutesSharePermissions.ts`
**Action**: Copy pattern từ `20260702020000-SeedMeetingMinutesAttachmentPermissions.ts`, đổi 3 permission thành `meeting.minutes.share.create/read/delete`, `roles: ['INTERNAL_USER', 'MANAGER', 'BUSINESS_ADMIN', 'SYSTEM_ADMIN']`.
**Outcome**: 3 permission tồn tại trong DB, gán đúng role.
**Verification**: `npm run migration:run`, query `permissions`/`role_permissions` xác nhận.

### Task T013 [US1] — Unit test `canAccessMinutes()`
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Test theo plan.md mục 10.2 + quickstart.md mục "Regression Cases" (#19-21 BẮT BUỘC, coi là gate của toàn bộ feature): user được share xem được `published`; vẫn xem được sau khi `archived`; user KHÔNG được share (và không phải participant/host/admin) vẫn bị từ chối (regression — test quan trọng nhất); revoke rồi thì mất quyền; draft vẫn tuyệt đối riêng tư (regression); attachment list vẫn hoạt động đúng qua `loadMinutesForReadCheck`.
**Outcome**: Coverage đầy đủ cho điểm rủi ro cao nhất của feature.

### Task T014 [US1] — Unit test service (grant/revoke/list)
**File**: `src/modules/minutes/services/minutes.service.spec.ts`
**Action**: Test theo plan.md mục 10.1 — happy path (preparer/host/BusinessAdmin/SystemAdmin), not-owner-not-admin (403), status không published cho CẢ grant lẫn revoke (409), target user không tồn tại (404)/không active (422), grant trùng (409), revoke không tồn tại (404), list không bị chặn bởi status (kể cả archived), audit log đúng action_type.
**Outcome**: Service coverage.

### Task T015 [US1] — Unit test controller
**File**: Controller test tương ứng (`minutes-list.controller.spec.ts` hoặc file riêng)
**Action**: 3 route trả đúng format + HTTP status (201/200/200), propagate lỗi 403/404/409/422 từ service.
**Outcome**: Controller coverage.

### Task T016 [US1] — Lint/build/test + regression
**Action**: `npm run lint`, `npm run build`, `npm run test`. Regression check riêng, BẮT BUỘC chạy lại toàn bộ test suite hiện có của `feat-issue-meeting-minutes`, `feat-view-meeting-minutes-detail`, `feat-attach-minutes-document` (và `feat-export-meeting-minutes` nếu đã implement) — vì feature này sửa 1 hàm dùng chung (`canAccessMinutes`), rủi ro phá vỡ chức năng khác cao hơn bình thường.
**Outcome**: Không có regression nào lọt qua.

---

## Requirements Coverage

| Task ID | FR liên quan | AC liên quan |
| :--- | :--- | :--- |
| T002, T003 | FR-002, FR-022, FR-024 | AC-001 |
| T004, T005 | FR-020 | AC-015, AC-016 |
| T006, T007 | FR-009, FR-011 | AC-002, AC-005, AC-014, AC-019 (regression) |
| T008 | FR-001, FR-005, FR-006, FR-010, FR-013-018, FR-025 | AC-001, AC-006, AC-009-013 |
| T009 | FR-003, FR-007, FR-008, FR-010, FR-013, FR-014, FR-019 | AC-004, AC-018, AC-020 |
| T010 | FR-004 | AC-003 |
| T011 | FR-001, FR-003, FR-004, FR-015 | AC-008 |
| T012 | FR-023 | AC-008 |
| T013 | FR-009, FR-011 | AC-002, AC-005, AC-014, AC-019-21 (quickstart) |
| T014 | Tất cả FR nhánh service | AC-001, AC-004, AC-006, AC-007, AC-009-013, AC-018-020 |
| T015 | — | Format response |

## Implementation Strategy

1. **MVP scope**: T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 (core logic + endpoint, theo đúng thứ tự — T006/T007 PHẢI xong và test kỹ trước khi coi phase này hoàn tất, vì mọi endpoint đọc khác của module `minutes` phụ thuộc vào hàm này không bị hỏng)
2. **Testing**: T013 (gate quan trọng nhất — chạy TRƯỚC T014/T015 nếu muốn phát hiện lỗi async/await sớm) → T014 → T015 → T016
3. **Không cần** async/queue/worker — toàn bộ đồng bộ, đơn giản.
4. **Đây là feature đầu tiên của module `minutes` cần migration CREATE TABLE** — review migration T003 kỹ hơn bình thường trước khi chạy trên môi trường chia sẻ (staging/dev chung).
5. **Rủi ro lớn nhất cần verify sớm nhất**: T007 (thêm `await`) — nên viết test T013#19 NGAY sau khi hoàn thành T006/T007, trước khi tiếp tục các task khác, để không "mang theo" 1 lỗ hổng bảo mật qua nhiều commit.
