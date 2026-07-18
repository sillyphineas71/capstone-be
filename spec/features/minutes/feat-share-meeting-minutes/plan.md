# Implementation Plan: Share Meeting Minutes

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-17 | Khởi tạo plan cho feat-share-meeting-minutes | Toàn bộ file |

## 1. Feature Summary
Thêm 3 endpoint (`POST`/`GET`/`DELETE` `/meeting-minutes/:id/shares`) cho phép `preparedBy`, `meeting.hostId` hiện tại, hoặc Business Admin/System Admin của 1 biên bản `published` cấp/xem/thu hồi quyền xem cho user nội bộ bất kỳ, dùng 1 bảng mới nhỏ `meeting_minutes_shares` (ACL đơn giản). Mở rộng duy nhất hàm `canAccessMinutes()` để cộng thêm nhánh kiểm tra bảng mới — không sửa 2 call-site (`findMinutesDetail`, `loadMinutesForReadCheck`) vì cả 2 đã gọi qua hàm dùng chung này.

## 2. Technical Context

### 2.1 Tech Stack
NestJS + TypeORM + PostgreSQL. 1 migration schema mới (`CREATE TABLE meeting_minutes_shares`) + 1 migration seed permission (3 permission mới). Không dependency npm mới, không queue/async — thao tác đồng bộ đơn giản.

### 2.2 Existing Codebase Analysis

| Thành phần | Vị trí | Vai trò trong feature này |
| :--- | :--- | :--- |
| `canAccessMinutes()` | `minutes.service.ts:910-929` | **Điểm chạm chính** — thêm nhánh `isSharedWithUser` vào OR logic hiện có |
| `findMinutesDetail()` | `minutes.service.ts:931+` | Gọi `canAccessMinutes()` — KHÔNG cần sửa trực tiếp |
| `loadMinutesForReadCheck()` | `minutes.service.ts:510-562` | Gọi `canAccessMinutes()` (dùng cho attachment list/detail) — KHÔNG cần sửa trực tiếp, tự động hưởng lợi |
| Ownership-check pattern (`preparedBy OR meeting.hostId OR Admin`) | `minutes.service.ts` (method `issueMinutes`) | Tái dùng logic tương tự cho grant/revoke/list-quản-lý |
| `UserEntity` | `accounts/entities/user.entity.ts` | Đọc `accountStatus`, `fullName`, `email` cho validate + response |
| `AuthzReadRepository.getEffectiveRolesAndPermissions` | `auth/repositories/authz-read.repository.ts` | Xác định `isAdmin` |
| `AuditLogsService` / `AuditLogEntity` | `administration/` | Ghi audit khi grant/revoke |
| Migration mẫu seed 3 permission | `20260702020000-SeedMeetingMinutesAttachmentPermissions.ts` | Copy pattern cho `meeting.minutes.share.{create,read,delete}` |
| Migration mẫu CREATE TABLE | (tìm 1 migration schema gần đây bất kỳ trong `src/database/migrations/`, ví dụ migration tạo `meeting_agendas` hoặc bảng tương tự nếu tồn tại) | Copy pattern UUID PK + timestamptz + FK + index |

### 2.3 Patterns to Follow
- Controller trả `{ success, message, data }`.
- Guard: `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('meeting.minutes.share.create' | '.read' | '.delete')` theo từng route.
- Ownership-or-admin check tái dùng logic của `issueMinutes` (không factor ra helper chung bắt buộc, nhưng khuyến khích nếu code thật đã có sẵn dạng tách rời khi implement).
- KHÔNG dùng transaction phức tạp/lock — grant/revoke là thao tác đơn giản, dựa vào `UNIQUE constraint` ở DB để chống race condition thay vì pessimistic lock (khác hẳn `replaceAgendas`/`updateAgendaItem` vốn cần lock vì có nhiều bước phối hợp).

## 3. Scope Confirmation

### 3.1 In Scope
- 3 endpoint: `POST/GET/DELETE /meeting-minutes/:id/shares[/​:userId]`.
- Ownership rule (`preparedBy` OR `meeting.hostId`) + Admin bypass cho quản lý share.
- Điều kiện `meeting_minutes.status = published` tại thời điểm grant/revoke.
- Mở rộng `canAccessMinutes()` — share đã cấp vẫn hiệu lực kể cả khi biên bản sau đó `archived`.
- 1 bảng mới `meeting_minutes_shares` + 3 permission mới.
- Unit test cho service (3 method) + controller (3 route) + `canAccessMinutes()` (nhánh mới).

### 3.2 Out of Scope
Xem spec.md mục 8.

### 3.3 Constitution Gate Check
| Rule | Kết quả |
| :--- | :--- |
| SEC-01 (no plaintext secret) | PASS |
| SEC-02 (auth bắt buộc) | PASS — JwtAuthGuard + PermissionsGuard + ownership-or-admin check cho 3 endpoint |
| SEC-03 (input validation) | PASS — DTO validate `userId` UUID, path param UUID |
| DATA-01 (soft-delete cho business-critical entity) | **Deviation có chủ đích, có tiền lệ trong baseline** — `meeting_minutes_shares` hard-delete khi revoke, mirror đúng pattern đã tồn tại sẵn ở bảng lõi `role_permissions` (revoke quyền = DELETE thẳng, không `deleted_at`) và `meeting_participants` (UC-MM-08). Đây là bảng ACL/grant thuần túy, không phải business record — `audit_logs` đã đủ audit trail. Xem research.md mục 4 để đối chiếu chi tiết. |
| ARCH-01 (service boundary) | PASS — chỉ dùng entity/service đã có qua injection |
| ARCH-02 (async cho >2s) | PASS — thao tác đồng bộ, đơn giản, không cần queue |
| ARCH-03 (idempotency) | PASS — grant trùng trả lỗi rõ ràng (`409`) thay vì no-op ẩn; revoke không tồn tại trả `404` rõ ràng thay vì fake `200` — cả 2 đều là "natural idempotency design" theo đúng tinh thần rule (client luôn biết chính xác trạng thái cuối) |
| ENG-01 (test coverage) | Áp dụng — xem mục 10 |
| ENG-02 (OpenAPI doc) | Áp dụng |
| ENG-03 (error không lộ stack trace) | PASS — lỗi UNIQUE constraint từ DB được catch và map sang `409 ALREADY_SHARED`, không lộ nguyên văn lỗi Postgres |

### 3.4 Complexity Tracking
Độ phức tạp thấp hơn `feat-issue-meeting-minutes`/`feat-export-meeting-minutes` (không async, không worker, không file rendering) nhưng có 1 điểm mới: đây là feature đầu tiên của module `minutes` cần **CREATE TABLE** (không chỉ seed permission) — cần cẩn trọng hơn ở bước migration schema. Không cần ADR riêng vì đây là bảng ACL đơn giản 2 FK, không có thiết kế phức tạp.

## 4. Data Model Impact
Tóm tắt: **1 bảng mới** (`meeting_minutes_shares`), 0 cột mới trên bảng hiện có, 0 giá trị enum mới, 3 permission mới (migration).

### 4.1 Bảng mới: `meeting_minutes_shares`
```sql
CREATE TABLE meeting_minutes_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  minutes_id UUID NOT NULL REFERENCES meeting_minutes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by UUID NOT NULL REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_meeting_minutes_shares_minutes_user UNIQUE (minutes_id, user_id)
);
CREATE INDEX idx_meeting_minutes_shares_minutes_id ON meeting_minutes_shares(minutes_id);
CREATE INDEX idx_meeting_minutes_shares_user_id ON meeting_minutes_shares(user_id);
```
`ON DELETE CASCADE` cho `minutes_id`/`user_id`: nếu biên bản hoặc user bị xóa cứng ở đâu đó (ngoài phạm vi hệ thống hiện tại vốn dùng soft-delete cho cả 2 bảng đó), share liên quan tự dọn theo — an toàn, không để orphan row.

### 4.2 Bảng bị ảnh hưởng (đọc, không ghi)
`meeting_minutes` (đọc `status`, `preparedBy`), `meetings` (đọc `host_id`), `users` (đọc `account_status`, `full_name`, `email`).

### 4.3 Seed / Migration
2 migration mới:
1. `CreateMeetingMinutesSharesTable` — CREATE TABLE theo mục 4.1.
2. `SeedMeetingMinutesSharePermissions` — copy pattern từ `20260702020000-SeedMeetingMinutesAttachmentPermissions.ts`, seed 3 permission `meeting.minutes.share.{create,read,delete}`, module_code=`minutes`, roles=`INTERNAL_USER, MANAGER, BUSINESS_ADMIN, SYSTEM_ADMIN`.

## 5. API / Contract Plan

### 5.1 Endpoints
- `POST /api/v1/meeting-minutes/:id/shares` — grant, trả `201`.
- `GET /api/v1/meeting-minutes/:id/shares` — list, trả `200`.
- `DELETE /api/v1/meeting-minutes/:id/shares/:userId` — revoke, trả `200`.

Đặt cả 3 route ngay sau nhóm route `POST :id/issue`/`PATCH :id/link-resources` đã có trong `MeetingMinutesListController`, theo đúng prefix `meeting-minutes` (nhất quán convention của module, giống quyết định đã áp dụng ở `feat-export-meeting-minutes`).

### 5.2 Request / Response
Xem spec.md mục 5.2/5.3.

### 5.3 Error Responses
`400`, `401`, `403 FORBIDDEN/NOT_MINUTES_OWNER`, `404 MINUTES_NOT_FOUND/USER_NOT_FOUND/SHARE_NOT_FOUND`, `409 MINUTES_NOT_PUBLISHED/ALREADY_SHARED`, `422 USER_INACTIVE`.

## 6. Authorization Plan

### 6.1 Permission Design
`meeting.minutes.share.create`, `meeting.minutes.share.read`, `meeting.minutes.share.delete` — module_code=`minutes`.

### 6.2 Authorization Flow (áp dụng cho cả 3 endpoint)
1. `JwtAuthGuard` xác thực token.
2. `PermissionsGuard` + `@RequirePermissions(...)` theo route.
3. Service tính `isAdmin` qua `AuthzReadRepository`, hoặc `isOwner = minutes.preparedBy === userId || meeting.hostId === userId`.
4. Cho phép thao tác NẾU `isAdmin OR isOwner`; ngược lại `403 NOT_MINUTES_OWNER`.

## 7. Business Logic Plan

### 7.1 Flow — Grant (`shareMinutes`)
```text
1. SELECT meeting_minutes + meetings (join) WHERE minutes.id = :minutesId
2. Validate: tồn tại + chưa xóa mềm -> 404 MINUTES_NOT_FOUND
3. { roles } = authzRepo.getEffectiveRolesAndPermissions(authUser.userId)
   isAdmin = roles includes SYSTEM_ADMIN or BUSINESS_ADMIN
   isOwner = minutes.preparedBy === authUser.userId OR meeting?.hostId === authUser.userId
   IF NOT (isAdmin OR isOwner) -> 403 NOT_MINUTES_OWNER
4. Validate: minutes.status === 'published' -> 409 MINUTES_NOT_PUBLISHED
5. SELECT users WHERE id = :targetUserId
   IF không tồn tại/đã xóa mềm -> 404 USER_NOT_FOUND
   IF accountStatus !== 'active' -> 422 USER_INACTIVE
6. TRY: INSERT INTO meeting_minutes_shares (minutes_id, user_id, granted_by) VALUES (...)
   CATCH unique_violation -> 409 ALREADY_SHARED
7. auditLogsService.logAction({ actionType: 'meeting_minutes_shared', entityType: 'meeting_minutes',
     entityId: minutesId, metadataJson: { targetUserId, grantedBy: authUser.userId } })
8. Trả 201 { id, minutesId, userId: targetUserId, userFullName, grantedBy, grantedAt }
```

### 7.2 Flow — Revoke (`unshareMinutes`)
```text
1-4. Giống bước 1-4 của Grant (load minutes, ownership-or-admin, status published)
5. DELETE FROM meeting_minutes_shares WHERE minutes_id = :minutesId AND user_id = :targetUserId
   Kiểm tra affected rows = 0 -> 404 SHARE_NOT_FOUND
6. auditLogsService.logAction({ actionType: 'meeting_minutes_unshared', ... })
7. Trả 200 { minutesId, userId: targetUserId, revoked: true }
```

### 7.3 Flow — List (`listMinutesShares`)
```text
1. SELECT meeting_minutes + meetings WHERE minutes.id = :minutesId
2. Validate tồn tại -> 404 MINUTES_NOT_FOUND
3. ownership-or-admin check -> 403 NOT_MINUTES_OWNER (giống Grant bước 3)
   LƯU Ý: KHÔNG có điều kiện status=published cho List (chỉ grant/revoke bị chặn — xem lý do
   mục 1.5/FR-011 của spec.md: đọc danh sách share hiện có không nên bị chặn chỉ vì biên bản
   đã archived, chủ yếu để Host còn xem lại lịch sử ai đang được share)
4. SELECT meeting_minutes_shares JOIN users (target) JOIN users (granted_by) WHERE minutes_id = :minutesId
   ORDER BY granted_at DESC
5. Trả 200 { minutesId, shares: [...] }
```

### 7.4 Mở rộng `canAccessMinutes()`
```ts
private async canAccessMinutes(
  minutes: MeetingMinutesEntity,
  meeting: MeetingEntity,
  userId: string,
  isAdmin: boolean,
  isParticipant: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  if (minutes.status === MeetingMinutesStatus.DRAFT) {
    return minutes.preparedBy === userId;
  }
  if (
    minutes.status === MeetingMinutesStatus.PUBLISHED ||
    minutes.status === MeetingMinutesStatus.ARCHIVED
  ) {
    const isHost = meeting.hostId === userId;
    if (isHost || isParticipant) return true;
    // MỚI: nhánh share — áp dụng cho cả published và archived (xem FR-011)
    const shareCount = await this.dataSource
      .getRepository(MeetingMinutesShareEntity)
      .count({ where: { minutesId: minutes.id, userId } });
    return shareCount > 0;
  }
  return false;
}
```
**LƯU Ý QUAN TRỌNG khi implement**: hàm `canAccessMinutes()` hiện tại là **đồng bộ** (`boolean`, không phải `Promise<boolean>`). Thêm truy vấn DB vào trong bắt buộc chuyển hàm này thành `async`, kéo theo phải thêm `await` ở **cả 2 call-site** (`findMinutesDetail`, `loadMinutesForReadCheck`) — đây là điểm rủi ro compile-time cao nhất của feature này (xem mục 12 Risks).

### 7.5 Key Business Rules Implemented
Chỉ `preparedBy`/`meeting.hostId`/Admin quản lý share được, grant/revoke chỉ khi `status=published`, share hiệu lực xuyên suốt `published`→`archived`, duplicate/not-found đều trả lỗi rõ ràng (không fake success).

## 8. Validation Plan

### 8.1 Input Validation (DTO)
- `CreateMinutesShareDto`: `userId: string` — `@IsUUID('4')`, bắt buộc.
- Path params `:id` (minutesId), `:userId` (revoke) — `ParseUUIDPipe`.

### 8.2 Business Validation (Service)
Theo thứ tự ở mục 7.1/7.2: tồn tại → ownership-or-admin → status published → target user hợp lệ → duplicate check (grant) / existence check (revoke).

## 9. Error Handling Plan

### 9.1 Exception Mapping
| Điều kiện | Exception | Code |
| :--- | :--- | :--- |
| Biên bản không tồn tại/đã xóa | `NotFoundException` | `MINUTES_NOT_FOUND` |
| Không phải Owner/Admin | `ForbiddenException` | `NOT_MINUTES_OWNER` |
| Status không phải published | `ConflictException` | `MINUTES_NOT_PUBLISHED` |
| Target user không tồn tại | `NotFoundException` | `USER_NOT_FOUND` |
| Target user không active | `UnprocessableEntityException` | `USER_INACTIVE` |
| Grant trùng (unique violation) | `ConflictException` | `ALREADY_SHARED` |
| Revoke không tồn tại (0 affected rows) | `NotFoundException` | `SHARE_NOT_FOUND` |

### 9.2 Race Condition Handling
2 request grant cùng lúc cho cùng `(minutesId, userId)`: cả 2 pass qua bước check "chưa tồn tại" (đọc trước khi ghi), nhưng DB `UNIQUE constraint` chỉ cho phép 1 INSERT thành công — request thua catch lỗi `unique_violation` (Postgres code `23505`), map sang `409 ALREADY_SHARED` thay vì lỗi 500 (ENG-03).

## 10. Testing Strategy

### 10.1 Unit Tests — Service
Happy path grant (preparer/host/BusinessAdmin/SystemAdmin), not-owner-not-admin (403), status không phải published (409, cả grant lẫn revoke), target user không tồn tại (404)/không active (422), grant trùng (409), revoke không tồn tại (404), revoke thành công (200 + xóa đúng dòng), list trả đúng dữ liệu + đúng thứ tự, audit log ghi đúng `action_type` cho cả grant/revoke.

### 10.2 Unit Tests — `canAccessMinutes()` (mở rộng)
User được share xem được biên bản `published` dù không phải participant/host; user được share vẫn xem được sau khi biên bản chuyển `archived`; user KHÔNG được share (và không phải participant/host/admin) vẫn bị từ chối như cũ (regression); user đã bị revoke không còn xem được nữa.

### 10.3 Unit Tests — Controller
3 route trả đúng format response + HTTP status; propagate lỗi 403/404/409/422 từ service.

## 11. Implementation Phases

### Phase 1: Data Model
Entity `MeetingMinutesShareEntity` (`src/modules/minutes/entities/meeting-minutes-share.entity.ts`). Migration `CreateMeetingMinutesSharesTable`.

### Phase 2: DTO
`CreateMinutesShareDto`, `MinutesShareResponseDto`, `MinutesShareListResponseDto`.

### Phase 3: Service Logic
`MinutesService.shareMinutes()`, `unshareMinutes()`, `listMinutesShares()`. Mở rộng `canAccessMinutes()` (chuyển `async`, cập nhật 2 call-site).

### Phase 4: Controller Endpoints
3 route mới trong `minutes-list.controller.ts`.

### Phase 5: Seed & Tests
Migration seed 3 permission. Unit test service + controller + `canAccessMinutes()`, chạy lint/build/test toàn repo (regression đặc biệt quan trọng vì sửa hàm dùng chung).

## 12. Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| `canAccessMinutes()` hiện là hàm đồng bộ — chuyển `async` mà quên `await` ở 1 trong 2 call-site sẽ khiến check luôn trả `true` (Promise luôn truthy!) — **lỗ hổng bảo mật nghiêm trọng nếu bỏ sót** | Đọc kỹ cả 2 call-site (`findMinutesDetail` dòng ~967, `loadMinutesForReadCheck` dòng ~544) trước khi sửa, grep toàn bộ `canAccessMinutes(` sau khi sửa để đảm bảo không sót lời gọi nào thiếu `await`; viết test riêng khẳng định user KHÔNG được share vẫn bị từ chối (regression test bắt buộc, không tùy chọn) |
| Race condition grant trùng | `UNIQUE constraint` ở DB + catch `unique_violation` (mục 9.2) |
| Quên thêm điều kiện status=published cho revoke, chỉ check ở grant | Test riêng AC-010 style cho revoke, đối chiếu trực tiếp checklist FR-010 (áp dụng cho CẢ grant VÀ revoke) |
| List vô tình cũng bị chặn bởi status=published (sao chép nhầm logic từ grant) | Ghi rõ trong plan.md mục 7.3 rằng List KHÔNG có điều kiện status, test riêng xác nhận List hoạt động cho biên bản `archived` |
| Đây là bảng mới đầu tiên trong module `minutes` (trước giờ chỉ seed permission, chưa từng CREATE TABLE) — rủi ro sai convention migration schema | Tham khảo 1 migration CREATE TABLE gần đây nhất trong `src/database/migrations/` (module khác) để đúng convention UUID/timestamptz/FK/index trước khi viết |

## 13. Acceptance Criteria Traceability
Xem spec.md mục 7.7.

## Artifacts Produced
`spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`.
