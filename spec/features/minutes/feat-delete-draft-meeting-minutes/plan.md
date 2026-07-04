# Implementation Plan: Delete Draft Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-02 | Khởi tạo plan cho feat-delete-draft-meeting-minutes (UC-MKM-05 / UC-133) | Toàn bộ file |

## 1. Feature Summary
Thêm 1 endpoint `DELETE /api/v1/meeting-minutes/:id` cho phép người tạo biên bản (`preparedBy`), Host hiện tại của meeting (`meeting.hostId`), hoặc Business Admin/System Admin soft-delete một `meeting_minutes` đang `draft`. Cascade soft-delete các `media_files` đính kèm liên quan trong cùng transaction. Gửi notification cho `preparedBy` khi Admin xóa hộ. Không thêm bảng/cột mới; cần thêm 1 giá trị enum `NotificationType` mới.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL, theo đúng baseline CLAUDE.md. Không dùng Prisma, không migration bảng mới (chỉ seed 1 permission mới qua migration).

### 2.2 Existing Codebase Analysis
- `src/modules/minutes/services/minutes.service.ts`: sẽ thêm method mới `deleteDraft(minutesId, authUser)`. Lưu ý (kế thừa từ `feat-update-draft-meeting-minutes/plan.md`): cần Codex tự đọc lại file thật để xác nhận cấu trúc method trước khi chèn code, tránh lặp lại rủi ro đã ghi chú ở feature update.
- `src/modules/minutes/entities/meeting-minutes.entity.ts`: đã có `status` (enum có sẵn `DELETED = 'deleted'`) và `deletedAt` (`@DeleteDateColumn`). Không cần sửa entity.
- `src/modules/recording/entities/media-file.entity.ts`: đã có `relatedEntityType`/`relatedEntityId`/`deletedAt` — dùng bulk update `UPDATE media_files SET deleted_at = now() WHERE related_entity_type='meeting_minutes' AND related_entity_id=:minutesId AND deleted_at IS NULL`.
- `src/modules/notifications/entities/notification.entity.ts`: enum `NotificationType` — **cần thêm** giá trị mới `MINUTES_DELETED_BY_ADMIN = 'minutes_deleted_by_admin'`. Cột `notification_type` là `varchar(60)` không CHECK constraint ở DB nên không cần migration ALTER TABLE, chỉ sửa file TypeScript.
- `src/modules/notifications/notifications.service.ts`: kiểm tra lại API tạo notification thực tế (constructor/method insert) trước khi gọi — plan này giả định insert trực tiếp qua repository nếu `NotificationsService` không có method tiện lợi cho single-recipient in-app notification đơn giản (xem Risk mục 12).
- `src/modules/administration/services/audit-logs.service.ts`: dùng `logEntityChange` (giống `feat-update-draft-meeting-minutes`) vì có before-snapshot rõ ràng.
- `src/database/migrations/20260702010000-SeedMeetingMinutesReadPermission.ts`: pattern migration seed permission chuẩn — copy để tạo migration mới cho `meeting.minutes.delete`.
- `src/modules/administration/repositories/authz-read.repository.ts` (dùng ở `findMinutesList`): có sẵn `getEffectiveRolesAndPermissions(userId)` để xác định `isAdmin` (`SYSTEM_ADMIN`/`BUSINESS_ADMIN`) — tái sử dụng pattern này cho ownership-or-admin check.

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.delete')`.
- Transaction: `this.dataSource.transaction(async (manager) => {...})`, lock `meeting_minutes` bằng `pessimistic_write`.
- Notification tạo NGOÀI transaction, best-effort (không throw nếu lỗi) — nhất quán cách `AuditLogsService` xử lý fail-safe (xem CLAUDE.md mục 18, "Notification convention").

## 3. Scope Confirmation

### 3.1 In Scope
- 1 endpoint `DELETE /api/v1/meeting-minutes/:id`.
- Ownership rule mở rộng (`preparedBy` OR `meeting.hostId`) + Admin bypass hoàn toàn.
- Cascade soft-delete `media_files` liên quan (DB only).
- Notification có điều kiện khi Admin xóa hộ.
- 1 permission mới (seed qua migration) + 1 giá trị enum `NotificationType` mới.
- Unit test cho service (happy path + toàn bộ nhánh lỗi) và controller.

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership-or-admin check |
| SEC-03 (input validation) | PASS — chỉ path param UUID, `ParseUUIDPipe` |
| DATA-01 (soft-delete) | PASS — đúng trọng tâm feature này, cascade cũng soft-delete |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity đã có qua injection sẵn có trong module `minutes` |
| ARCH-02 (async cho >2s) | PASS — thao tác đồng bộ, không cần `background_jobs` |
| ARCH-03 (idempotency) | PASS — gọi lại DELETE cho bản đã xóa trả 404 thay vì 200 lặp |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng |
| ENG-03 (error không lộ stack trace) | PASS |

### 3.4 Complexity Tracking
Điểm phức tạp: ownership-or-admin check (3 nhánh: preparedBy, hostId, isAdmin) + cascade bulk update + notification có điều kiện. Không cần ADR riêng — độ phức tạp tương đương `feat-attach-minutes-document`.

## 4. Data Model Impact
Tóm tắt: 0 bảng mới, 0 cột mới, 1 permission mới (migration), 1 giá trị enum `NotificationType` mới (chỉ code, không migration).

### 4.1 Bảng bị ảnh hưởng
`meeting_minutes` (UPDATE `status`, `deleted_at`), `media_files` (bulk UPDATE `deleted_at` cho các bản ghi liên quan), `meetings` (chỉ đọc `host_id`, không ghi).

### 4.2 Bảng được INSERT
`audit_logs` (1 dòng/lần xóa thành công), `notifications` (0 hoặc 1 dòng, có điều kiện — xem FR-006/FR-007), `permissions` + `role_permissions` (qua migration).

### 4.3 Seed / Migration
1 migration mới: `SeedMeetingMinutesDeletePermission` (copy pattern từ `20260702010000-SeedMeetingMinutesReadPermission.ts`), seed permission `meeting.minutes.delete`, module_code=`minutes`, action_code=`minutes.delete`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

## 5. API / Contract Plan

### 5.1 Endpoint
- `DELETE /api/v1/meeting-minutes/:id`

### 5.2 Request / Response
Không có request body. Xem spec.md mục 5.3 cho response.

### 5.3 Success Response
`200 OK`.

### 5.4 Error Responses
`400` (UUID không hợp lệ), `401 Unauthorized`, `403 FORBIDDEN / NOT_MINUTES_OWNER`, `404 MINUTES_NOT_FOUND`, `409 MINUTES_NOT_DRAFT`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.delete`, module_code=`minutes`.

### 6.2 Authorization Flow
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions('meeting.minutes.delete')`.
3. Service tính `isAdmin` qua `AuthzReadRepository.getEffectiveRolesAndPermissions` (roles gồm `SYSTEM_ADMIN`/`BUSINESS_ADMIN` → bypass), hoặc `isOwner = minutes.preparedBy === userId || meeting.hostId === userId`.
4. Cho phép xóa NẾU `isAdmin OR isOwner`; ngược lại `403 NOT_MINUTES_OWNER`.

### 6.3 Error
Thiếu permission → `403 FORBIDDEN` (guard). Có permission nhưng không phải Admin/Owner → `403 NOT_MINUTES_OWNER` (service).

## 7. Business Logic Plan

### 7.1 Transaction Boundary — Delete
```text
1. BEGIN TX
2. SELECT meeting_minutes FOR UPDATE WHERE id = :minutesId (lock, pessimistic_write)
3. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
4. SELECT meetings WHERE id = minutes.meetingId (đọc hostId, không lock)
5. { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
   isAdmin = roles includes SYSTEM_ADMIN or BUSINESS_ADMIN
   isOwner = minutes.preparedBy === authUser.userId OR meeting?.hostId === authUser.userId
   IF NOT (isAdmin OR isOwner) -> 403 NOT_MINUTES_OWNER
6. Validate: minutes.status === 'draft' -> 409 MINUTES_NOT_DRAFT
7. UPDATE meeting_minutes SET status = 'deleted', deleted_at = now() WHERE id = :minutesId
8. cascadedCount = UPDATE media_files SET deleted_at = now()
     WHERE related_entity_type = 'meeting_minutes' AND related_entity_id = :minutesId AND deleted_at IS NULL
     (dùng manager.getRepository(MediaFileEntity).createQueryBuilder().update()... hoặc .update({...}, {...}) với where tương ứng, lấy affected count)
9. auditLogsService... (chuẩn bị payload, xem bước 11 - gọi ngoài transaction theo pattern createDraft)
COMMIT
10. isAdminDeletingOnBehalf = isAdmin AND NOT isOwner
11. (ngoài transaction, best-effort)
    auditLogsService.logEntityChange({
      userId: authUser.userId, actionType: 'meeting_minutes_deleted', entityType: 'meeting_minutes',
      entityId: minutesId,
      oldValueJson: { title: minutes.title, versionNo: minutes.versionNo, meetingId: minutes.meetingId, preparedBy: minutes.preparedBy },
      newValueJson: null,
    })
    // metadataJson {deletedByRole, cascadedAttachmentCount} - nếu logEntityChange không nhận metadataJson,
    // cân nhắc dùng logAction thay thế hoặc gộp vào oldValueJson - quyết định cụ thể lúc code, không đổi ý nghĩa audit
12. IF isAdminDeletingOnBehalf AND minutes.preparedBy IS NOT NULL:
      (best-effort, catch lỗi không raise)
      tạo 1 NotificationEntity: notificationType=MINUTES_DELETED_BY_ADMIN, channel=IN_APP,
        recipientScope='user_list', recipientUserIdsJson=[minutes.preparedBy],
        content='Bien ban hop "<title>" da bi xoa boi quan tri vien', relatedEntityType='meeting_minutes',
        relatedEntityId=minutesId, createdBy=authUser.userId
13. Trả về { deleted: true, minutesId, deletedAt, cascadedAttachmentCount }
```
Lưu ý bước 9/11: giống rủi ro đã ghi ở `feat-update-draft-meeting-minutes/plan.md` mục 7.1 — audit log chạy trong hay ngoài transaction phụ thuộc khả năng của `AuditLogsService` nhận `EntityManager` tùy biến; mặc định theo pattern `createDraft` (audit ngoài transaction, best-effort).

### 7.2 Key Business Rules Implemented
Chỉ `preparedBy`/`meeting.hostId`/Admin thao tác được, chỉ khi `status = draft`, cascade soft-delete attachment, notification có điều kiện.

## 8. Validation Plan

### 8.1 Input Validation
- `id` (path param): `ParseUUIDPipe`.
- Không có request body cần validate.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1: tồn tại → ownership-or-admin → status draft → thực thi xóa cascade.

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Status không phải draft | `ConflictException` | `MINUTES_NOT_DRAFT` |

### 9.2 Transaction Error Handling
Lỗi nghiệp vụ throw trong transaction DB tự động rollback. Notification lỗi (bước 12, ngoài transaction) không ảnh hưởng transaction đã commit, chỉ log warn.

### 9.3 Notification Error (Non-blocking)
Nếu tạo `NotificationEntity` lỗi (bước 12), catch và log warn, KHÔNG raise lỗi lên response (feature xóa đã thành công ở tầng DB, không nên fail toàn bộ response chỉ vì notification lỗi).

## 10. Testing Strategy

### 10.1 Unit Tests
`minutes.service.spec.ts` (bổ sung case mới cho `deleteDraft`): happy path tự xóa (preparedBy), happy path host-thay-thế xóa, happy path Business Admin xóa hộ, happy path System Admin xóa hộ, not-owner-not-admin (403), status không phải draft (409, kể cả với Admin), biên bản không tồn tại/đã xóa (404), cascade đúng số lượng attachment, không cascade attachment của biên bản khác, notification được tạo khi Admin xóa hộ, KHÔNG tạo notification khi tự xóa, audit log ghi đúng `action_type`.

### 10.2 Integration Test Ideas
(Không bắt buộc trong phạm vi PR này) — test DB thật: xóa minutes có 2 attachment, assert cả 2 `media_files.deletedAt` được set, file vật lý trên storage vẫn tồn tại (không bị xóa).

## 11. Implementation Phases

### Phase 1: Preparation
Thêm enum `MINUTES_DELETED_BY_ADMIN` vào `NotificationType`. Response type cho delete (`DeleteDraftMinutesResponseDto` hoặc inline type).

### Phase 2: Service Logic
`MinutesService.deleteDraft`.

### Phase 3: Controller Endpoint
Thêm route `DELETE :id` vào `MeetingMinutesListController` (cùng vị trí route `PATCH :id` đã thêm ở `feat-update-draft-meeting-minutes`, giữ nhất quán prefix `meeting-minutes`).

### Phase 4: Seed & Tests
Migration seed permission `meeting.minutes.delete`, unit test service + controller, chạy lint/build/test.

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| Ownership-or-admin check 3 nhánh dễ viết sai (rò rỉ quyền xóa hoặc chặn nhầm Admin) | Unit test riêng cho từng nhánh: owner-only, host-thay-thế, admin-bypass, không-thỏa-nhánh-nào |
| Cascade bulk update `media_files` có thể xóa nhầm attachment của biên bản khác nếu điều kiện WHERE sai | Test riêng: tạo 2 minutes khác nhau, mỗi cái có attachment, xóa 1 cái, assert cái còn lại KHÔNG bị ảnh hưởng |
| `NotificationsService` hiện tại có thể không có method tiện lợi cho single in-app notification đơn giản (cần đọc lại code thật lúc implement) | Nếu không có, insert trực tiếp qua `manager.getRepository(NotificationEntity)` giống cách `AuditLogEntity` được insert trực tiếp ở `addAttachment`, không nhất thiết phải thêm method mới vào `NotificationsService` nếu không cần thiết |
| Quên set 1 trong 2 field (`status`/`deletedAt`) khi xóa, gây lệch với 1 trong 2 kiểu filter đang tồn tại trong code | Checklist rõ trong spec.md FR-002; unit test assert cả 2 field sau khi xóa |
| Notification lỗi làm fail toàn bộ response dù DB đã xóa thành công | Bọc try/catch quanh bước tạo notification, chỉ log warn (xem mục 9.3) |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.8.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`.
