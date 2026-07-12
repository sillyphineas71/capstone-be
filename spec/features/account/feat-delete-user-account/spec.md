# Feature Specification: Xóa tài khoản người dùng (Delete user account)

- **Feature ID**: UC-10
- **Feature Name**: Xóa tài khoản người dùng
- **Module / Domain**: accounts
- **Created Date**: 2026-07-12
- **Status**: Draft
- **Related UC**: UC-12 (Khóa tài khoản), UC-08 (đổi vai trò), UC-09 (cập nhật thông tin)
- **Source Documents**:
  - Use Case: UC-10 Xóa tài khoản người dùng
  - Database v3.2 Compact (39 tables)
  - CLAUDE.md / AGENTS.md
  - spec/global/constitution.md (LOCKED v1.0.0) — **DATA-01 (soft-delete)**
  - Khảo sát code hiện trạng `src/modules/accounts`, `src/modules/auth`

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Vị trí thay đổi |
| :--- | :--- | :--- |
| 2026-07-12 | Tạo mới spec cho UC-10. Xác định **Missing**; chốt hướng **SOFT-DELETE** theo DATA-01, nêu mâu thuẫn với chữ "gỡ khỏi DB". | Toàn bộ file |

---

## 0. Trạng thái khảo sát hiện trạng (BẮT BUỘC ĐỌC TRƯỚC)

> Kết luận nhanh: **[Missing]** — chưa có endpoint/service xóa tài khoản.

| Thành phần | Hiện trạng | Vị trí |
| :--- | :--- | :--- |
| Endpoint `DELETE /users/:userId` | ❌ **Missing** | [users.controller.ts](../../../../src/modules/accounts/controllers/users.controller.ts) chỉ có `POST`/`GET`/`PUT :userId/roles`/`PATCH :userId` |
| Method service xóa user | ❌ **Missing** | [users.service.ts](../../../../src/modules/accounts/services/users.service.ts) không có `deleteUser`/`softDelete` |
| Hạ tầng **soft-delete** | ✅ Có sẵn | `user.entity.ts` có `@DeleteDateColumn deletedAt` ([user.entity.ts:115](../../../../src/modules/accounts/entities/user.entity.ts#L115)); toàn bộ query hiện tại đã filter `deletedAt: IsNull()` |
| Cơ chế **thu hồi token** | ✅ Có sẵn (tái dùng được) | User-level revocation qua Redis key `auth:user:{userId}:invalid_after` ([jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61)), được set bởi change-password / password-reset. Blacklist per-jti ([logout.service.ts:19-35](../../../../src/modules/auth/services/logout.service.ts#L19-L35)) |

---

## 1. Mâu thuẫn UC list ↔ Constitution & hướng giải quyết (QUAN TRỌNG)

| Nguồn | Nội dung | Diễn giải |
| :--- | :--- | :--- |
| UC list — Expected Output | "Tài khoản bị **gỡ khỏi DB** và token bị thu hồi" | Nghe như **HARD delete** |
| UC list — Pre-condition | "Xóa tài khoản **chưa phát sinh dữ liệu** / không có dữ liệu ràng buộc" | Chỉ xóa khi không có FK/dữ liệu liên quan |
| **Constitution DATA-01** | "THE system SHALL dùng **soft-delete** (delete_at) thay vì hard-delete cho mọi entity business-critical. Hard-delete chỉ được phép cho: logs > 90 ngày, temp files." | **Cấm hard-delete** với `users` |
| `user.entity.ts` | có `@DeleteDateColumn deletedAt` | Hạ tầng đã hướng soft-delete |

**Quyết định (ưu tiên luật — CLAUDE.md §1 precedence: Constitution > feature spec):**

> UC-10 triển khai **SOFT-DELETE** (set `users.deleted_at = now()`), **KHÔNG** hard-delete. `users` là entity business-critical (được tham chiếu bởi audit_logs, meetings, bookings…), hard-delete sẽ phá vỡ audit trail và tham chiếu FK lịch sử → vi phạm DATA-01.

- Chữ **"gỡ khỏi DB"** trong UC list được hiểu ở **góc độ ứng dụng**: sau soft-delete, tài khoản không còn xuất hiện trong mọi luồng nghiệp vụ (mọi query đã filter `deletedAt IS NULL`), không đăng nhập được, token bị thu hồi — tương đương "biến mất khỏi hệ thống", nhưng **bản ghi vật lý vẫn còn** để giữ vết.
- ⚠️ **Điểm cần chốt**: nếu team thực sự muốn **hard-delete vật lý** (xóa hẳn row), phải mở RFC riêng và được ký duyệt vì **vi phạm DATA-01 Layer 1** — Agent **không tự quyết**. Spec này mặc định **soft-delete**.

---

## 2. Thông tin Use Case

| Trường | Giá trị |
| :--- | :--- |
| **UC ID** | UC-10 |
| **Use Case Name** | Xóa tài khoản người dùng |
| **Module** | `accounts` |
| **Primary Actor** | **System Admin** |
| **Trigger** | System Admin xóa một tài khoản chưa phát sinh dữ liệu ràng buộc |
| **Pre-condition** | Tài khoản tồn tại, chưa bị soft-delete, và **không có ràng buộc/dữ liệu liên quan active** (xem §5) |
| **Expected Output** | Tài khoản bị **soft-delete** (không còn truy cập được trong hệ thống); **token bị thu hồi**; `user_roles` bị vô hiệu hóa; có bản ghi `audit_logs` |
| **Related** | UC-12 |

---

## 3. Actor & Trigger

- **Primary Actor**: System Admin (duy nhất — xem §6).
- **Trigger**: System Admin thao tác xóa một tài khoản nhân sự trên hệ thống.
- **Secondary Actor**: Redis (token revocation), đồng bộ, không phụ thuộc thiết bị ngoài.

---

## 4. Endpoint liên quan (đề xuất mới — chờ duyệt)

Theo convention CLAUDE.md §22.2 (`DELETE /api/v1/users/:id`):

```text
DELETE /api/v1/users/:userId
```

- Không body. Param `userId` UUID (validate `ParseUUIDPipe`, mirror `getUserDetail`).
- Response: `200` với thông báo, hoặc `204` không body. **Đề xuất `200`** kèm `{ success, message }` để nhất quán format module (CLAUDE.md §8). **Cần chốt 200 vs 204.**

```json
{ "success": true, "message": "Đã xóa tài khoản thành công" }
```

---

## 5. Cơ chế xóa & xử lý quan hệ

### 5.1. Soft-delete tài khoản
- Set `users.deleted_at = now()` (dùng TypeORM `softDelete`/`softRemove` hoặc gán `deletedAt`). Sau đó mọi query `deletedAt: IsNull()` tự loại user này.
- **KHÔNG** hard-delete row.

### 5.2. Thu hồi token (Expected Output "token bị thu hồi") — tái dùng cơ chế có sẵn
- Set Redis key `auth:user:{userId}:invalid_after = Date.now()` (ms). `JwtAuthGuard` sẽ từ chối mọi access token có `iat*1000 < invalid_after` → **thu hồi toàn bộ access token đang hoạt động** của user ([jwt-auth.guard.ts:50-61](../../../../src/modules/auth/guards/jwt-auth.guard.ts#L50-L61)). Đây là cùng cơ chế change-password/password-reset đang dùng.
- ⚠️ **Cần xác minh khi implement**: luồng **refresh token** có honor `invalid_after` không (đọc `token.service.ts`/refresh flow). Nếu refresh không kiểm `invalid_after`, user vẫn có thể refresh ra access token mới → cần bổ sung kiểm tra ở refresh flow (đề xuất, chờ duyệt). TTL của key nên ≥ TTL refresh token để đảm bảo thu hồi triệt để.

### 5.3. Vô hiệu hóa `user_roles`
- Trong cùng transaction: soft-remove các `user_roles` active của user (`is_active=false`, `expired_at=now()`) — nhất quán với UC-08 và với authz query (guard lọc `is_active` + `expired_at`). Đảm bảo quyền hiệu lực bị gỡ ngay cả khi token còn hiệu lực.
- **KHÔNG** hard-delete row `user_roles`.

### 5.4. Các quan hệ khác
| Quan hệ | Xử lý đề xuất | Ghi chú |
| :--- | :--- | :--- |
| `face_profiles` (có `deletedAt`) | Soft-delete kèm (đề xuất, chờ duyệt) | Dữ liệu sinh trắc nhạy cảm (§Security) |
| `device_user_mappings` | Vô hiệu hóa/soft-remove (**cần xác minh** field) | Ngắt liên kết Face Server |
| `audit_logs.user_id` | **GIỮ NGUYÊN** | Audit trail lịch sử; entity dùng `onDelete: SET NULL` cho hard-delete, nhưng soft-delete giữ row nên không đổi |
| `departments.manager_user_id` | **Cần xác minh** — nếu user là trưởng phòng ban đang active | Có thể là ràng buộc chặn (xem §6 BR) |

---

## 6. Ràng buộc tham chiếu (Pre-condition "chưa phát sinh dữ liệu")

Pre-condition yêu cầu **chặn xóa nếu tài khoản còn dữ liệu/ràng buộc active**. Các FK tham chiếu `users` đã xác minh trong schema thật:

| Ràng buộc active (chặn xóa) | Field thật | Trạng thái |
| :--- | :--- | :--- |
| Là **người tổ chức/chủ trì** cuộc họp sắp tới/đang diễn ra | `meetings.organizer_id` (NOT NULL), `meetings.host_id` | ✅ Xác minh ([meeting.entity.ts:64,67](../../../../src/modules/meetings/entities/meeting.entity.ts#L64)) |
| Là **người tham dự** cuộc họp sắp tới | `meeting_participants.user_id` | ✅ Xác minh ([meeting-participant.entity.ts:43](../../../../src/modules/meetings/entities/meeting-participant.entity.ts#L43)) |
| Là **người đặt phòng** booking đang hiệu lực | `room_bookings.booked_by` | ✅ Xác minh ([room-booking.entity.ts:61](../../../../src/modules/rooms/entities/room-booking.entity.ts#L61)) |
| Là **quản lý trực tiếp** của user khác đang active | `users.direct_manager_id` (self-ref) | ✅ Xác minh ([user.entity.ts:67](../../../../src/modules/accounts/entities/user.entity.ts#L67)) |
| Là **trưởng phòng ban** đang active | `departments.manager_user_id` | ✅ Xác minh ([department.entity.ts:36](../../../../src/modules/accounts/entities/department.entity.ts#L36)) |

Các tham chiếu **khác** (34 entity có FK tới `users`) mang tính **lịch sử** (recording `started_by`, `media_files` uploaded_by, `meeting_minutes`, `transcripts`, `attendance_records/events`, `audit_logs`, `*_by`…): **không nên chặn** xóa vì là dữ liệu đã hoàn tất; với soft-delete các tham chiếu này vẫn giữ nguyên (row user còn tồn tại vật lý).

> **Điểm cần chốt (định nghĩa "dữ liệu ràng buộc active")**: chính xác tập ràng buộc chặn xóa. Đề xuất tối thiểu = 5 ràng buộc "active/tương lai" ở bảng trên (meeting sắp tới với vai trò organizer/host/participant; booking active; là direct_manager; là department manager). "Sắp tới/active" cần định nghĩa theo `start_at > now()` và `status` chưa hủy/kết thúc — **giá trị enum status cụ thể cần xác minh khi implement** (đọc `meeting.entity`/`room-booking.entity`). Nếu vi phạm → **409 USER_HAS_DEPENDENCIES** kèm `details` liệt kê loại ràng buộc.

---

## 7. Main Flow (happy path)

1. System Admin gọi `DELETE /api/v1/users/:userId`.
2. `JwtAuthGuard` xác thực (SEC-02). `PermissionsGuard` kiểm `accounts.user.delete`.
3. Load target user (`deleted_at IS NULL`) → không có: `404 USER_NOT_FOUND` (đã soft-delete cũng coi như không tồn tại — §8 BR-03).
4. **BR-01**: nếu `targetUserId === actorId` → `422 CANNOT_DELETE_SELF`.
5. **BR-02** (chờ duyệt): nếu target là SYSTEM_ADMIN cuối cùng còn active → `422 LAST_SYSTEM_ADMIN`.
6. Kiểm ràng buộc tham chiếu (§6) → nếu có ràng buộc active: `409 USER_HAS_DEPENDENCIES`.
7. **Trong 1 transaction** (CLAUDE.md §14.4):
   - Soft-delete `users` (`deleted_at = now()`).
   - Soft-remove `user_roles` active (`is_active=false`, `expired_at=now()`).
   - (tùy chọn/chờ duyệt) soft-delete `face_profiles`, vô hiệu `device_user_mappings`.
   - Ghi `audit_logs` **atomic** (`ACCOUNT_DELETE`, severity `warning`, `old_value_json` = thông tin hồ sơ, không secret).
8. Sau commit: set Redis `auth:user:{userId}:invalid_after = now()` (thu hồi token).
9. (tùy chọn) emit event/notification nếu cần.
10. Trả `200` (hoặc `204`).

> **Thứ tự token revocation**: đặt **sau commit** để tránh thu hồi khi transaction rollback. Việc set Redis không thuộc transaction DB — nếu set Redis fail, cần log cảnh báo (user đã soft-delete, không đăng nhập được qua luồng password vì tài khoản đã ẩn, nhưng token cũ có thể còn hiệu lực tới khi hết hạn) — **cần xác minh/chốt** cơ chế retry.

---

## 8. Business Rules & Validation

| # | Rule | Xử lý khi vi phạm |
| :--- | :--- | :--- |
| BR-01 | **Không tự xóa chính mình** (`targetUserId !== actorId`) | `422 CANNOT_DELETE_SELF` |
| BR-02 | **Không xóa SYSTEM_ADMIN cuối cùng** còn active (chống lockout toàn hệ thống) — *chờ duyệt* | `422 LAST_SYSTEM_ADMIN` |
| BR-03 | Không xóa user đã soft-delete rồi (idempotent) | `404 USER_NOT_FOUND` |
| BR-04 | Chặn xóa nếu còn ràng buộc tham chiếu active (§6) | `409 USER_HAS_DEPENDENCIES` (details liệt kê loại) |
| BR-05 | Chỉ soft-delete, không hard-delete (DATA-01) | — |
| BR-06 | Thu hồi token + vô hiệu `user_roles` phải xảy ra cùng thao tác xóa | — |

---

## 9. Alternative / Exception Flows

| Tình huống | HTTP | error.code |
| :--- | :--- | :--- |
| Thiếu/sai JWT | 401 | `UNAUTHORIZED` |
| Thiếu permission `accounts.user.delete` | 403 | `FORBIDDEN` |
| `userId` sai UUID | 400 | `INVALID_USER_ID` |
| User không tồn tại / đã soft-delete | 404 | `USER_NOT_FOUND` |
| Tự xóa chính mình | 422 | `CANNOT_DELETE_SELF` |
| SYSTEM_ADMIN cuối cùng (nếu BR-02 chốt) | 422 | `LAST_SYSTEM_ADMIN` |
| Còn ràng buộc active | 409 | `USER_HAS_DEPENDENCIES` |
| Lỗi transaction | 500 | (không lộ stack trace — ENG-03) |

Body lỗi theo module: `{ success:false, message, error:{ code, details } }` (+ `timestamp`/`path` nếu qua global filter).

---

## 10. Permission & RBAC

- Permission code (**đề xuất mới, chờ duyệt**): `accounts.user.delete`, `module_code=accounts`, `action_code=delete`.
- Gán **CHỈ `SYSTEM_ADMIN`** (Primary Actor = System Admin; xóa tài khoản là thao tác nhạy cảm/không giới hạn scope). Business Admin **không** được xóa.
- Guard: `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.delete')`.

---

## 11. Audit (bắt buộc)

- CLAUDE.md §17 liệt kê **"Create/update/delete user"** là hành động phải audit. UC-10 là hành động phá hủy → **PHẢI** audit, severity cao.
- Bản ghi (field thật [audit-log.entity.ts](../../../../src/modules/administration/entities/audit-log.entity.ts)):
  - `user_id` = actor (System Admin).
  - `action_type` = **`ACCOUNT_DELETE`** *(đề xuất; đồng bộ `ACCOUNT_CREATE`, `ACCOUNT_UPDATE`, `ACCOUNT_ROLE_UPDATE`)*.
  - `entity_type` = `users`, `entity_id` = targetUserId.
  - `severity` = **`WARNING`** (`AuditLogSeverity.WARNING`).
  - `old_value_json` = thông tin hồ sơ user bị xóa (id, email, fullName, employeeCode, departmentId, roleIds) — **KHÔNG** log `password_hash`/token/secret (SEC-01).
- Ghi audit **atomic trong transaction** với soft-delete (mirror `createUser`/UC-08/UC-09).

---

## 12. Security & Data governance

- **DATA-01**: soft-delete (tuân thủ). Không hard-delete.
- **SEC-01/SEC-02/SEC-03**: auth bắt buộc, không log secret, validate UUID.
- Dữ liệu nhạy cảm (`face_profiles`, `device_user_mappings`): cân nhắc soft-delete kèm để giảm lộ dữ liệu sinh trắc (§5.4) — chờ duyệt.
- Token revocation là phần của "quyền truy cập bị thu hồi" — bắt buộc theo Expected Output.

---

## 13. Giả định & điểm cần chốt

1. **[Cơ chế xóa]** SOFT-DELETE (mặc định theo DATA-01). Hard-delete vật lý = RFC riêng, chờ duyệt.
2. **[Permission]** `accounts.user.delete` (mới) — chỉ SYSTEM_ADMIN; cần seed (không tạo ở bước spec).
3. **[Tập ràng buộc chặn xóa]** Chốt chính xác danh sách + định nghĩa "active/sắp tới" (status enum, mốc thời gian) cho meeting/booking (§6).
4. **[BR-02 last SYSTEM_ADMIN]** Có chặn xóa admin hệ thống cuối cùng không.
5. **[Refresh token]** Refresh flow có honor `invalid_after` không; TTL key revocation; retry nếu set Redis fail (§5.2, §7).
6. **[Quan hệ kèm]** Có soft-delete `face_profiles` / vô hiệu `device_user_mappings` cùng lúc không (§5.4).
7. **[Response]** `200` (có body) vs `204` (no content).
8. **[department manager]** Nếu user là `departments.manager_user_id` active → chặn xóa hay cho phép (gỡ manager)? Chờ chốt.

---

## 14. Trạng thái kết luận

**[Missing]**

- **Chưa có gì cho UC-10**: không endpoint `DELETE /users/:userId`, không service xóa. Hạ tầng soft-delete (`deletedAt`) và token revocation (`invalid_after`) **đã có sẵn** để tái dùng.
- **Cần làm (khi duyệt)**:
  1. Endpoint `DELETE /api/v1/users/:userId` + `JwtAuthGuard` + `PermissionsGuard` + `@RequirePermissions('accounts.user.delete')`.
  2. Service `deleteUser`: BR-01 (self), BR-03 (đã xóa), BR-04 (ràng buộc tham chiếu §6), (BR-02 chờ duyệt); transaction soft-delete `users` + soft-remove `user_roles` + audit atomic `ACCOUNT_DELETE`; sau commit set `auth:user:{id}:invalid_after`.
  3. Permission `accounts.user.delete` + seed chỉ SYSTEM_ADMIN (chờ duyệt).
  4. Unit test: self-delete, đã xóa (404), có ràng buộc (409), happy path (soft-delete + user_roles vô hiệu + token revoke + audit), missing permission (403), (last-admin nếu chốt).
- **Tuân thủ luật**: SOFT-DELETE theo DATA-01 (KHÔNG hard-delete dù UC list ghi "gỡ khỏi DB").
- **Không đụng UC khác**: token revocation dùng lại cơ chế auth có sẵn; không sửa luồng auth ngoài việc set key revocation (và có thể bổ sung kiểm refresh — chờ duyệt).
- **Chặn trước khi code**: chốt 8 điểm §13 (đặc biệt: hard vs soft, tập ràng buộc chặn xóa, refresh-token honor invalid_after, BR-02).
