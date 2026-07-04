# Implementation Plan: Issue Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-issue-meeting-minutes (UC-MKM-09) | Toàn bộ file |

## 1. Feature Summary
Thêm 1 endpoint `POST /api/v1/meeting-minutes/:id/issue` cho phép người tạo biên bản (`preparedBy`), Host hiện tại của meeting (`meeting.hostId`), hoặc Business Admin/System Admin chuyển 1 `meeting_minutes` đang `draft` (với điều kiện `meeting.status = completed`) sang `published`. Ghi `issued_by`/`issued_at`, ghi audit log, và gửi notification `minutes_distribution` cho toàn bộ participant (trừ actor). Không thêm bảng/cột/enum mới (khác `feat-delete-draft-meeting-minutes` — enum `MINUTES_DISTRIBUTION` đã có sẵn từ trước).

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL. Không migration bảng mới (chỉ seed 1 permission mới).

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/services/minutes.service.ts`: thêm method mới `issueMinutes(minutesId, authUser)`. Kế thừa rủi ro đã ghi ở các plan trước: cần đọc lại file thật trước khi chèn code (xác nhận cấu trúc `updateDraft`/`deleteDraft` đã tồn tại đúng cách nếu đã implement).
- `src/modules/minutes/entities/meeting-minutes.entity.ts`: đã có đủ cột cần dùng (`status`, `issuedBy`, `issuedAt`). Không cần sửa entity.
- `src/modules/meetings/entities/meeting.entity.ts` (`MeetingEntity`): dùng `MeetingStatus.COMPLETED` để so sánh `meeting.status`.
- `src/modules/notifications/entities/notification.entity.ts`: `NotificationType.MINUTES_DISTRIBUTION` **đã tồn tại sẵn** (không cần sửa file này — khác `feat-delete-draft-meeting-minutes` phải thêm `MINUTES_DELETED_BY_ADMIN`).
- `src/modules/administration/services/audit-logs.service.ts`: dùng `logEntityChange` (before/after status), theo pattern đã dùng ở `updateDraft`/`deleteDraft`.
- `src/modules/auth/repositories/authz-read.repository.ts`: `getEffectiveRolesAndPermissions` để xác định `isAdmin`.
- `src/database/migrations/20260702010000-SeedMeetingMinutesReadPermission.ts`: pattern migration seed permission chuẩn — copy cho `meeting.minutes.issue`.
- **Route ordering**: nếu `feat-view-meeting-minutes-detail` (`GET :id`) và `feat-search-minutes-by-person` (`GET search-by-person`) đã được implement trước, route `POST :id/issue` (method `POST`, không phải `GET`) KHÔNG xung đột thứ tự với các route `GET` đó — HTTP method khác nhau nên NestJS route matching không bị nhầm lẫn. Chỉ cần lưu ý nếu sau này có thêm route `POST :id/...` khác (ví dụ `POST :id/archive`), phải tự phân biệt qua segment cuối (`/issue` vs `/archive`), không có rủi ro ordering giống trường hợp `GET :id` vs `GET search-by-person`.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.issue')`.
- Transaction: `this.dataSource.transaction(async (manager) => {...})`, lock `meeting_minutes` bằng `pessimistic_write` (giống `updateDraft`/`deleteDraft`).
- Notification tạo NGOÀI transaction, best-effort (không throw nếu lỗi) — nhất quán `feat-delete-draft-meeting-minutes` mục 9.3.

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `POST /api/v1/meeting-minutes/:id/issue`.
- Ownership rule mở rộng (`preparedBy` OR `meeting.hostId`) + Admin bypass hoàn toàn.
- Điều kiện `meeting.status = completed`.
- Notification `minutes_distribution` cho participant (trừ actor).
- 1 permission mới (seed qua migration).
- Unit test cho service (happy path + toàn bộ nhánh lỗi) và controller.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership-or-admin check |
| SEC-03 (input validation) | PASS — chỉ path param UUID |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity đã có qua injection sẵn có |
| ARCH-02 (async cho >2s) | PASS — thao tác đồng bộ |
| ARCH-03 (idempotency) | PASS — publish lại bản đã published trả 409 thay vì 200 lặp |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng |
| ENG-03 (error không lộ stack trace) | PASS |

### 3.4 Complexity Tracking
Độ phức tạp tương đương `feat-delete-draft-meeting-minutes` (ownership-or-admin check 3 nhánh + notification có điều kiện), cộng thêm điều kiện `meeting.status`. Không cần ADR riêng.

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 0 giá trị enum mới (đã có sẵn), 1 permission mới (migration).

### 4.1 Bảng bị ảnh hưởng
`meeting_minutes` (UPDATE `status`, `issued_by`, `issued_at`), `meetings` (chỉ đọc `host_id`/`status`, không ghi), `meeting_participants` (chỉ đọc để lấy danh sách notify).

### 4.2 Bảng được INSERT
`audit_logs` (1 dòng/lần publish thành công), `notifications` (0 hoặc 1 dòng, có điều kiện — xem FR-017), `permissions` + `role_permissions` (qua migration).

### 4.3 Seed / Migration
1 migration mới: `SeedMeetingMinutesIssuePermission` (copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`), seed permission `meeting.minutes.issue`, module_code=`minutes`, action_code=`minutes.issue`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

## 5. API / Contract Plan

### 5.1 Endpoint
- `POST /api/v1/meeting-minutes/:id/issue`

### 5.2 Request / Response
Không có request body. Xem spec.md mục 5.3 cho response.

### 5.3 Success Response
`200 OK`.

### 5.4 Error Responses
`400` (UUID không hợp lệ), `401 Unauthorized`, `403 FORBIDDEN / NOT_MINUTES_OWNER`, `404 MINUTES_NOT_FOUND`, `409 MINUTES_NOT_DRAFT / MEETING_NOT_COMPLETED`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.issue`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.issue')`.
3. Service tính `isAdmin` qua `AuthzReadRepository`, hoặc `isOwner = minutes.preparedBy === userId || meeting.hostId === userId`.
4. Cho phép publish NẾU `isAdmin OR isOwner`; ngược lại `403 NOT_MINUTES_OWNER`.

### 6.3 Error
Thiếu permission → `403 FORBIDDEN` (guard). Có permission nhưng không phải Admin/Owner → `403 NOT_MINUTES_OWNER` (service).

## 7. Business Logic Plan

### 7.1 Transaction Boundary — Issue
```text
1. BEGIN TX
2. SELECT meeting_minutes FOR UPDATE WHERE id = :minutesId (lock, pessimistic_write)
3. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
4. SELECT meetings WHERE id = minutes.meetingId (đọc hostId + status, không lock)
5. { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
   isAdmin = roles includes SYSTEM_ADMIN or BUSINESS_ADMIN
   isOwner = minutes.preparedBy === authUser.userId OR meeting?.hostId === authUser.userId
   IF NOT (isAdmin OR isOwner) -> 403 NOT_MINUTES_OWNER
6. Validate: minutes.status === 'draft' -> 409 MINUTES_NOT_DRAFT
7. Validate: meeting.status === 'completed' -> 409 MEETING_NOT_COMPLETED
8. UPDATE meeting_minutes SET status = 'published', issued_by = :userId, issued_at = now() WHERE id = :minutesId
COMMIT
9. (ngoài transaction, best-effort)
   auditLogsService.logEntityChange({
     userId: authUser.userId, actionType: 'meeting_minutes_issued', entityType: 'meeting_minutes',
     entityId: minutesId,
     oldValueJson: { status: 'draft' },
     newValueJson: { status: 'published', issuedBy: authUser.userId, issuedAt },
   })
10. participants = SELECT DISTINCT user_id FROM meeting_participants WHERE meeting_id = minutes.meetingId
    recipientUserIds = participants.filter(userId => userId !== authUser.userId)
11. IF recipientUserIds.length > 0:
      (best-effort, catch lỗi không raise)
      tạo 1 NotificationEntity: notificationType=MINUTES_DISTRIBUTION, channel=IN_APP,
        recipientScope='user_list', recipientUserIdsJson=recipientUserIds,
        content='Bien ban hop "<title>" da duoc ban hanh chinh thuc', relatedEntityType='meeting_minutes',
        relatedEntityId=minutesId, createdBy=authUser.userId
12. Trả về { id, meetingId, title, status: 'published', versionNo, issuedBy, issuedAt, updatedAt, notifiedParticipantCount: recipientUserIds.length }
```
Lưu ý bước 9: giống rủi ro đã ghi ở các plan trước — audit log chạy trong hay ngoài transaction phụ thuộc khả năng của `AuditLogsService`; mặc định theo pattern `createDraft`/`deleteDraft` (audit ngoài transaction, best-effort).

### 7.2 Key Business Rules Implemented
Chỉ `preparedBy`/`meeting.hostId`/Admin thao tác được, chỉ khi `status=draft` AND `meeting.status=completed`, notification loại trừ actor, không tạo notification nếu danh sách rỗng.

## 8. Validation Plan

### 8.1 Input Validation
- `id` (path param): `ParseUUIDPipe`.
- Không có request body.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: tồn tại → ownership-or-admin → status draft → meeting completed → thực thi publish.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Status không phải draft | `ConflictException` | `MINUTES_NOT_DRAFT` |
| Meeting chưa completed | `ConflictException` | `MEETING_NOT_COMPLETED` |

### 9.2 Transaction Error Handling
Lỗi nghiệp vụ throw trong transaction DB tự động rollback. Notification lỗi (bước 11, ngoài transaction) không ảnh hưởng transaction đã commit, chỉ log warn.

### 9.3 Notification Error (Non-blocking)
Nếu tạo `NotificationEntity` lỗi, catch và log warn, KHÔNG raise lỗi lên response (feature đã publish thành công ở tầng DB, không nên fail toàn bộ response chỉ vì notification lỗi) — nhất quán `feat-delete-draft-meeting-minutes` mục 9.3.

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới cho `issueMinutes`): happy path tự publish (preparedBy), happy path host-thay-thế publish, happy path Business Admin publish hộ, happy path System Admin, not-owner-not-admin (403), status không phải draft kể cả Admin (409), meeting chưa completed kể cả Admin (409), biên bản không tồn tại/đã xóa (404), notification chứa đúng danh sách participant trừ actor, không tạo notification khi participant rỗng, audit log ghi đúng `action_type`, `approved_by`/`visibility_level` không đổi sau publish.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test DB thật: publish 1 minutes có 3 participant, assert đúng 1 notification với 3 (hoặc ít hơn nếu actor cũng là participant) recipient; assert `PATCH`/`DELETE` sau đó đều trả 409.

## 11. Implementation Phases

### Phase 1: Preparation
Response type cho issue (`IssueMinutesResponseDto` hoặc inline type).

### Phase 2: Service Logic
`MinutesService.issueMinutes`.

### Phase 3: Controller Endpoint
Thêm route `POST :id/issue` vào `MeetingMinutesListController` (cùng vị trí đã thêm `PATCH :id`/`DELETE :id`/`GET search-by-person`, giữ nhất quán prefix `meeting-minutes`).

### Phase 4: Seed & Tests
Migration seed permission `meeting.minutes.issue`, unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Ownership-or-admin check 3 nhánh dễ viết sai | Unit test riêng cho từng nhánh (owner-only, host-thay-thế, admin-bypass, không-thỏa-nhánh-nào) — tái sử dụng cấu trúc test đã viết ở `deleteDraft` |
| Quên loại trừ actor khỏi danh sách notification, gây tự thông báo cho chính mình | Test riêng AC-016 |
| Publish khi meeting chưa completed do quên check | Test riêng AC-009/AC-010, đặt check `meeting.status` NGAY SAU check `minutes.status` để không bỏ sót |
| Notification lỗi làm fail toàn bộ response dù DB đã publish thành công | Bọc try/catch quanh bước tạo notification, chỉ log warn (xem mục 9.3) |
| `NotificationsService` không có method tiện lợi cho batch multi-recipient in-app (cần đọc code thật lúc implement) | Insert trực tiếp qua `manager.getRepository(NotificationEntity)`, giống fallback đã ghi ở `feat-delete-draft-meeting-minutes` |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`.
