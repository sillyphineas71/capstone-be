---
name: feat-view-room-detail
description: Xem chi tiet 1 phong hop (info tinh + trang thai realtime + no-show status + booking sap toi), chi danh cho BUSINESS_ADMIN (+ SYSTEM_ADMIN). Module rooms.
category: rooms
---

# Feature Specification: Xem chi tiết phòng họp (View Room Detail)

- **Feature ID**: ROOM-VIEW-DETAIL-001
- **Feature Name**: Xem chi tiết 1 phòng họp (View Room Detail — admin only)
- **Module / Domain**: rooms
- **Created Date**: 2026-08-11
- **Status**: Draft (RECON xong, quyết định đã LOCK qua thảo luận với PO — chờ review trước khi code)
- **Source Documents**:
  - `CLAUDE.md` (§8 response convention; §9.2 permission naming; §22.6 rooms endpoint group)
  - `spec/features/rooms/feat-room-realtime-status/spec.md` (RMS-001 — nguồn tái sử dụng RoomStatusService)
  - `spec/features/rooms/feat-no-show-cases/spec.md` (nguồn `no_show_cases`, permission `room.noshow.*`)
  - `spec/features/rooms/feat-search-room-list/spec.md` (RoomSearchItemDto — precedent field style)
  - `src/modules/rooms/entities/room.entity.ts`, `no-show-case.entity.ts`, `room-booking.entity.ts`
  - `src/modules/rooms/controllers/rooms.controller.ts`, `services/room-status.service.ts`, `services/rooms.service.ts`
  - `src/database/migrations/20260721000001-SeedRoomBookingReadPermission.ts` (mirror pattern seed permission mới)

---

## CHANGELOG & REVISION HISTORY

| Ngày cập nhật | Tóm tắt thay đổi | Vị trí / Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo spec ROOM-VIEW-DETAIL-001. Nguồn gốc: người dùng hỏi "backend đã có view room detail chưa" → RECON xác nhận **chưa có** (chỉ có `search` list, `:roomId/status` realtime, và `/analytics/rooms/:roomId/detail` thống kê — không mảnh nào đủ). Thảo luận 9 điểm mơ hồ → chốt lại sau khi PO yêu cầu **giới hạn tính năng chỉ cho role BUSINESS_ADMIN** (đổi từ "mọi user" ban đầu). Xem mục 1.5 "Quyết định đã chốt". | Toàn bộ file (bản đầu tiên) |

---

## 1. Giới thiệu

### 1.1 Bối cảnh

Hệ thống hiện có 3 nguồn dữ liệu rời rạc liên quan đến "phòng":
1. `GET /rooms/search` — danh sách/tìm kiếm phòng, field tĩnh cơ bản, mở cho mọi user đã login.
2. `GET /rooms/:roomId/status` — trạng thái realtime 1 phòng (booking hiện tại, occupancy, no-show status rút gọn), permission `room.utilization.read`.
3. `GET /analytics/rooms/:roomId/detail` — thống kê sử dụng phòng (utilization rate, heatmap), permission `analytics.room.read`.

Không có endpoint nào đóng vai trò "trang hồ sơ chi tiết 1 phòng" đúng nghĩa — nơi admin xem đầy đủ thông tin tĩnh (địa điểm, sức chứa, thiết bị, sơ đồ chỗ ngồi) **kết hợp** ngữ cảnh vận hành hiện tại (đang có ai họp không, có case no-show đang mở không, sắp có booking nào) trong 1 lần gọi.

### 1.2 Mục tiêu

- `GET /api/v1/rooms/:roomId` — chi tiết đầy đủ 1 phòng, gộp: info tĩnh (entity `rooms`) + trạng thái realtime (tái dùng `RoomStatusService`) + tối đa 5 booking sắp tới.
- Endpoint dành **riêng cho vai trò quản trị** (`BUSINESS_ADMIN`, + `SYSTEM_ADMIN` theo convention seed permission hiện có — xem 1.5), không mở cho `MANAGER`/`EMPLOYEE`.
- KHÔNG migration schema (mọi field đã có sẵn trong `rooms`, `room_bookings`, `no_show_cases`).

### 1.3 Giá trị mang lại

- Admin có 1 trang duy nhất để ra quyết định vận hành phòng: xem info + trạng thái + tín hiệu no-show, từ đó điều hướng sang các action liên quan (`PATCH /rooms/:roomId` để sửa, `POST /no-show-cases/:id/release` để giải phóng thủ công — case id lấy qua `GET /no-show-cases?roomId=`).

### 1.4 Out-of-scope (defer — KHÔNG implement ở feature này)

- Ảnh/gallery phòng (chưa có entity/storage — cần feature riêng nếu được yêu cầu).
- Danh sách thiết bị chi tiết qua `iot-devices` (giữ nguyên 4 flag boolean có sẵn trên entity `rooms`; join IoT là quyết định sản phẩm riêng, chưa có yêu cầu rõ ràng).
- Object `no_show_cases` đầy đủ (case id, evidence, warning timeline) — chỉ trả `noShowStatus` rút gọn (tái dùng từ RoomStatusService); xem case đầy đủ vẫn qua `GET /no-show-cases?roomId=` (đã có, đã đúng permission).
- Utilization rate / heatmap 24h — vẫn ở `GET /analytics/rooms/:roomId/detail` (không nhúng vào response này vì là dữ liệu tính toán nặng, khác mối quan tâm).
- Lịch sử booking đầy đủ có phân trang — chỉ nhúng 5 booking sắp tới; lịch sử đầy đủ qua `GET /room-bookings?roomId=` (đã có).
- Query param `includeDeleted` để admin xem phòng đã soft-delete — có thể làm sau nếu cần, MVP trả 404 cho phòng đã xóa mềm.

### 1.5 Quyết định đã chốt (qua thảo luận với PO — 2026-08-11)

```text
D-1 (Phạm vi dữ liệu): Info tĩnh + trạng thái realtime hiện tại + no-show status rút gọn + 5 booking
    sắp tới. KHÔNG nhúng heatmap/utilization rate (tab riêng), KHÔNG nhúng full no-show case object,
    KHÔNG ảnh/gallery.
D-2 (Kiến trúc): Endpoint MỚI, KHÔNG merge/thay thế /rooms/:roomId/status hay
    /analytics/rooms/:roomId/detail (consumer khác vẫn dùng 2 endpoint đó). Compose bằng cách GỌI LẠI
    RoomStatusService.getRoomStatus() nội bộ — KHÔNG viết lại SQL trùng lặp.
D-3 (Quyền truy cập): permission MỚI `room.detail.read`, seed CHỈ cho role `BUSINESS_ADMIN` và
    `SYSTEM_ADMIN`. **Giả định cần xác nhận**: PO yêu cầu "chỉ dành riêng cho Business Admin" —
    hiểu là loại trừ MANAGER/EMPLOYEE. Đã seed thêm SYSTEM_ADMIN theo đúng convention repo (mọi
    permission admin khác trong repo đều seed cho cả 2 role — ví dụ room.booking.read ở
    20260721000001) để tránh SYSTEM_ADMIN bị 403 trên tính năng quản trị. NẾU PO muốn loại trừ cả
    SYSTEM_ADMIN, sửa lại migration ở mục 7 (bỏ 1 dòng role_code) trước khi chạy.
D-4 (Soft-delete): Phòng đã xóa mềm → 404 ROOM_NOT_FOUND, không có cờ includeDeleted ở MVP.
D-5 (administrativeStatus vs occupancyStatus): Response trả 2 field riêng biệt — KHÔNG hợp nhất —
    vì đây là 2 khái niệm khác nhau (field thủ công do admin set qua PATCH, vs trạng thái tính từ
    booking/presence realtime).
```

---

## 2. UC summary

| UC | Scope (≤15 từ) | Actor | In | Out |
|---|---|---|---|---|
| **ROOM-VIEW-DETAIL-001** | Xem chi tiết đầy đủ 1 phòng (info tĩnh + realtime + no-show + booking sắp tới) | User có `room.detail.read` (BUSINESS_ADMIN/SYSTEM_ADMIN) | path `roomId` | 1 room detail object |

---

## 3. System Context (RECON, file:line)

| Hạng mục | Phát hiện |
|---|---|
| Entity `rooms` (info tĩnh) | [room.entity.ts](../../../../src/modules/rooms/entities/room.entity.ts): `roomCode`(:34), `roomName`(:37), `siteName`?(:40), `areaName`?(:43), `locationDescription`?(:46), `capacity`(:49), `roomType` enum(:57), `currentStatus` enum(:65) — đây là field **thủ công/administrative**, `hasCamera/hasMicrophone/hasDisplay/allowRecording`(:68-77), `layoutJson`?(:80), `isActive`(:83), `createdBy/updatedBy`(:86,89) + relation `createdByUser/updatedByUser`(:101-107), `@DeleteDateColumn deletedAt`(:98). |
| `RoomStatusService.getRoomStatus()` (realtime — TÁI SỬ DỤNG, không viết lại) | [room-status.service.ts:133-150](../../../../src/modules/rooms/services/room-status.service.ts): trả `RoomStatusDetail` gồm `currentBooking{bookingId,meetingId,title,hostName,reservedStartTime,reservedEndTime}\|null`, `noShowStatus` (detection_status của no_show_case mới nhất thuộc booking đang diễn ra, đã implement — KHÔNG còn là stub null như spec RMS-001 gốc mô tả), `lastPresenceAt`, `occupancyCount`. Tự throw `NotFoundException{code:'ROOM_NOT_FOUND'}` nếu room không tồn tại/soft-deleted (:143-148) — dùng lại nguyên xi cho 404 của feature này. |
| `no_show_cases` (tham chiếu, KHÔNG query trực tiếp ở feature này) | [no-show-case.entity.ts:13-27](../../../../src/modules/rooms/entities/no-show-case.entity.ts): enum `detection_status` (risk/confirmed/warning_sent/released/dismissed/resolved) — đây chính là giá trị `noShowStatus` compose từ RoomStatusService. |
| `room_bookings` (5 booking sắp tới) | [room-booking.entity.ts](../../../../src/modules/rooms/entities/room-booking.entity.ts): `meeting_id`(NN), `room_id`(NN), `reserved_start_time`, `reserved_end_time`, `status` enum (active = `approved`/`active`). Query tương tự LATERAL `cb` trong `RoomStatusService` nhưng lấy `reserved_start_time > now()` thay vì đang diễn ra, `ORDER BY reserved_start_time ASC LIMIT 5`. |
| `rooms.controller.ts` (route hiện có) | [rooms.controller.ts:60,238,253](../../../../src/modules/rooms/controllers/rooms.controller.ts): `GET search`(1 segment, literal), `GET realtime-status`(1 segment, literal), `GET :roomId/status`(2 segment). **CHƯA có** `GET :roomId` (bare, 1 segment param) — cần thêm, khai **SAU** `search` và `realtime-status` để 2 route literal đó không bị route param `:roomId` nuốt mất (Express/Nest match theo thứ tự đăng ký cho cùng HTTP method + cùng số segment). Không xung đột với `:roomId/status`/`:roomId/deletion-impact` (khác số segment) hay `PATCH/DELETE :roomId` (khác HTTP method). |
| `rooms.module.ts` | [rooms.module.ts](../../../../src/modules/rooms/rooms.module.ts): `RoomsService`, `RoomStatusService` đã là provider sẵn có trong cùng module — không cần thêm import module mới, không cần thêm entity vào `forFeature` (đã có `RoomEntity`). |
| `RoomsService` hiện tại | [rooms.service.ts](../../../../src/modules/rooms/services/rooms.service.ts): chỉ có `create/update/getDeletionImpact/deleteRoom`. **Chưa có** method đọc chi tiết trả ra ngoài — feature này thêm `getRoomDetail(roomId)`. |
| Permission seed pattern (mirror) | [20260721000001-SeedRoomBookingReadPermission.ts](../../../../src/database/migrations/20260721000001-SeedRoomBookingReadPermission.ts): pattern chuẩn — INSERT `permissions` (idempotent `WHERE NOT EXISTS`) rồi loop INSERT `role_permissions` cho danh sách role_code (ở đó là `SYSTEM_ADMIN, BUSINESS_ADMIN, MANAGER`). Feature này dùng lại pattern y hệt, chỉ đổi role list còn `SYSTEM_ADMIN, BUSINESS_ADMIN` (bỏ MANAGER — xem D-3). |
| Role code xác nhận | [20260720000002-SeedCoreRoles.ts:33-55](../../../../src/database/migrations/20260720000002-SeedCoreRoles.ts): 4 role_code hợp lệ duy nhất ở tầng application: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE`. |

---

## 4. Endpoint

> **Envelope**: manual `{ success, message, data }` — nhất quán toàn bộ `rooms.controller.ts` hiện tại (không có global TransformInterceptor).

### 4.1 `GET /api/v1/rooms/:roomId`

| Field | Value |
|---|---|
| Auth | `JwtAuthGuard` (class-level) + `PermissionsGuard` |
| Permission | `room.detail.read` |
| Param | `roomId` UUID (`ParseUUIDPipe`) |
| 404 | room không tồn tại / `deletedAt IS NOT NULL` → `ROOM_NOT_FOUND` |
| HTTP | 200 |
| Route order | Khai sau `@Get('search')` và `@Get('realtime-status')`; trước hay sau `:roomId/status`/`:roomId/deletion-impact` đều an toàn (khác số segment). |

**Response 200**:
```json
{
  "success": true,
  "message": "Room detail retrieved",
  "data": {
    "roomId": "uuid",
    "roomCode": "R101",
    "roomName": "Phòng họp 101",
    "siteName": "Tòa nhà A",
    "areaName": "Tầng 3",
    "locationDescription": "Cạnh thang máy khu B",
    "capacity": 12,
    "roomType": "meeting_room",
    "administrativeStatus": "available",
    "hasCamera": true,
    "hasMicrophone": true,
    "hasDisplay": true,
    "allowRecording": false,
    "layoutJson": { "seats": 12, "shape": "u-shape" },
    "isActive": true,
    "createdAt": "2026-06-01T02:00:00.000Z",
    "updatedAt": "2026-08-01T09:00:00.000Z",
    "createdBy": { "userId": "uuid", "fullName": "Nguyễn Văn A" },
    "updatedBy": { "userId": "uuid", "fullName": "Trần Thị B" },
    "occupancyStatus": {
      "currentBooking": {
        "bookingId": "uuid",
        "meetingId": "uuid",
        "title": "Họp Sprint",
        "hostName": "Nguyễn Văn A",
        "reservedStartTime": "2026-08-11T09:00:00+07:00",
        "reservedEndTime": "2026-08-11T10:30:00+07:00"
      },
      "occupancyCount": 5,
      "lastPresenceAt": "2026-08-11T09:10:00+07:00",
      "noShowStatus": null
    },
    "upcomingBookings": [
      {
        "bookingId": "uuid",
        "meetingId": "uuid",
        "title": "Họp review Q3",
        "hostName": "Lê Văn C",
        "reservedStartTime": "2026-08-11T14:00:00+07:00",
        "reservedEndTime": "2026-08-11T15:00:00+07:00"
      }
    ]
  }
}
```

- `administrativeStatus` = `rooms.current_status` nguyên trạng (field admin tự set qua `PATCH /rooms/:roomId`) — **KHÔNG** suy diễn lại từ occupancy (D-5).
- `occupancyStatus` = nguyên object trả từ `RoomStatusService.getRoomStatus(roomId)`, bỏ 2 field `roomId`/`roomCode` trùng lặp và `noShowCase` (luôn `null`, đã defer #31 object đầy đủ — chỉ giữ `noShowStatus`), bỏ `releaseHistory` (luôn `[]`, không có giá trị hiển thị ở trang detail này).
- `createdBy`/`updatedBy` = `null` nếu `createdBy`/`updatedBy` (uuid) là null trên entity (phòng tạo tự động/seed không có actor).
- `upcomingBookings` = mảng rỗng `[]` nếu không có booking nào trong tương lai; tối đa 5 phần tử, sắp theo `reservedStartTime ASC`.

---

## 5. Data-source query approach

```text
# Info tĩnh — 1 query repository (TypeORM findOne, KHÔNG raw SQL — khác RoomStatusService vì đây
# là entity CRUD-style, có relation createdByUser/updatedByUser cần load)
  roomRepo.findOne({
    where: { id: roomId, deletedAt: IsNull() },
    relations: ['createdByUser', 'updatedByUser'],
  });
  -- không có → 404 ROOM_NOT_FOUND (ném NGAY, KHÔNG gọi RoomStatusService nếu đã biết room không tồn tại)

# Realtime — TÁI SỬ DỤNG nguyên hàm, KHÔNG viết lại SQL
  const status = await this.roomStatusService.getRoomStatus(roomId);
  -- an toàn gọi lại vì entity đã xác nhận tồn tại ở bước trên; tolerate 1 round-trip trùng
     (room lookup lần 2 bên trong RoomStatusService) — đánh đổi lấy KHÔNG duplicate business logic.

# upcomingBookings (5 booking sắp tới, room đơn lẻ nên KHÔNG có rủi ro N+1)
  SELECT b.id AS booking_id, b.meeting_id, m.title,
         u.full_name AS host_name, b.reserved_start_time, b.reserved_end_time
  FROM room_bookings b
  JOIN meetings m ON m.id = b.meeting_id
  LEFT JOIN users u ON u.id = COALESCE(m.host_id, m.organizer_id)
  WHERE b.room_id = $1
    AND b.reserved_start_time > now()
    AND b.status IN ('approved','active')
  ORDER BY b.reserved_start_time ASC
  LIMIT 5;
```

SEC-03: tất cả tham số bind (`$1`/`roomId`), KHÔNG nối chuỗi.

---

## 6. Business Rules (LOCKED)

```text
BR-1 (composition, D-2): RoomsService.getRoomDetail() PHẢI gọi lại RoomStatusService.getRoomStatus()
  cho phần realtime — KHÔNG viết lại LATERAL SQL đã có.
BR-2 (soft-delete, D-4): phòng deletedAt IS NOT NULL → 404 ROOM_NOT_FOUND. KHÔNG có includeDeleted
  ở MVP.
BR-3 (administrativeStatus, D-5): đọc thẳng rooms.current_status, KHÔNG suy diễn lại từ occupancy/
  booking. Đây LÀ field khác occupancyStatus, không merge.
BR-4 (upcomingBookings): chỉ booking status IN ('approved','active') VÀ reserved_start_time > now();
  tối đa 5, sort ASC theo reserved_start_time; không có → [].
BR-5 (no-show, D-1): CHỈ trả noShowStatus (string rút gọn, tái dùng từ RoomStatusService); KHÔNG
  trả object no_show_cases đầy đủ.
BR-6 (createdBy/updatedBy null-safe): nếu entity.createdBy/updatedBy là null → field response tương
  ứng = null (KHÔNG throw, KHÔNG object rỗng {}).
BR-7 (permission, D-3): endpoint gate bằng room.detail.read, seed CHỈ cho BUSINESS_ADMIN + SYSTEM_ADMIN
  (KHÔNG MANAGER, KHÔNG EMPLOYEE).
```

---

## 7. Permission — migration mới

Mirror pattern [20260721000001-SeedRoomBookingReadPermission.ts](../../../../src/database/migrations/20260721000001-SeedRoomBookingReadPermission.ts):

```text
permission_code: room.detail.read
permission_name: Xem chi tiet phong hop (day du)
module_code: rooms
action_code: read
description: Xem thong tin chi tiet 1 phong hop (info tinh + realtime + no-show status), chi danh
  cho vai tro quan tri
role_codes seed: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']   -- KHÔNG MANAGER (khác room.booking.read)
```

File mới: `src/database/migrations/20260811000003-SeedRoomDetailReadPermission.ts` (theo đúng convention repo — migrations/, KHÔNG dùng seeds/ vì folder đó không có runner).

---

## 8. Functional Requirements (EARS)

```text
FR-RVD-001-001: THE system SHALL cung cấp GET /api/v1/rooms/:roomId trả chi tiết đầy đủ 1 phòng.
FR-RVD-001-002: IF roomId không tồn tại hoặc đã soft-deleted THEN THE system SHALL trả 404
  ROOM_NOT_FOUND.
FR-RVD-001-003: THE response SHALL gồm info tĩnh đầy đủ từ entity rooms (roomCode, roomName,
  siteName, areaName, locationDescription, capacity, roomType, administrativeStatus, 4 flag thiết
  bị, layoutJson, isActive, createdAt, updatedAt, createdBy, updatedBy).
FR-RVD-001-004: THE response SHALL gồm occupancyStatus compose từ RoomStatusService.getRoomStatus()
  (currentBooking, occupancyCount, lastPresenceAt, noShowStatus) — KHÔNG viết lại logic SQL.
FR-RVD-001-005: THE response SHALL gồm upcomingBookings — tối đa 5 booking active
  (status approved/active) có reserved_start_time > now(), sort ASC.
FR-RVD-001-006: createdBy/updatedBy SHALL = null nếu entity.createdBy/updatedBy tương ứng là null;
  ngược lại SHALL = { userId, fullName }.
FR-RVD-001-007: Endpoint SHALL gate bằng JwtAuthGuard + @RequirePermissions('room.detail.read').
FR-RVD-001-008: Permission room.detail.read SHALL được seed (migration mới, idempotent) và grant
  CHỈ cho role_code SYSTEM_ADMIN và BUSINESS_ADMIN.
FR-RVD-001-009: Route GET :roomId (bare) SHALL khai sau GET search và GET realtime-status trong
  controller để tránh route param nuốt mất 2 route literal đó.
```

## 9. Non-functional (EARS)

```text
NFR-RVD-001-001 (SEC-02): Endpoint auth-gated (JWT) + permission room.detail.read, không mở public.
NFR-RVD-001-002 (SEC-03): upcomingBookings query dùng parameter binding ($1), KHÔNG nối chuỗi.
NFR-RVD-001-003 (DATA-01): loại phòng soft-deleted; KHÔNG migration schema mới (chỉ migration seed
  permission — không đổi bảng/cột).
NFR-RVD-001-004 (Perf): tối đa 3 round-trip DB (room + createdBy/updatedBy relation qua 1 query
  TypeORM, RoomStatusService 1 query, upcomingBookings 1 query) — chấp nhận được vì đây là trang
  detail 1 phòng, không phải list nhiều phòng (không có rủi ro N+1 lặp theo item).
NFR-RVD-001-005 (Không lộ dữ liệu nhạy cảm): createdBy/updatedBy CHỈ trả {userId, fullName}, KHÔNG
  trả toàn bộ user object (email/phone/password hash).
```

## 10. Acceptance Criteria

```text
AC-RVD-001-001 (found): Given roomId hợp lệ tồn tại; When GET /rooms/:roomId; Then 200, data đúng
  field mục 4.1 (info tĩnh + occupancyStatus + upcomingBookings).
AC-RVD-001-002 (404 not found): Given roomId không tồn tại; Then 404 ROOM_NOT_FOUND.
AC-RVD-001-003 (404 soft-deleted): Given roomId đã soft-delete (deletedAt khác null); Then 404
  ROOM_NOT_FOUND (KHÔNG trả data).
AC-RVD-001-004 (400 invalid uuid): Given roomId không phải UUID hợp lệ; Then 400.
AC-RVD-001-005 (403 no permission): Given user KHÔNG có room.detail.read (vd role EMPLOYEE/MANAGER);
  Then 403.
AC-RVD-001-006 (200 with permission — BUSINESS_ADMIN): Given user role BUSINESS_ADMIN có
  room.detail.read; Then 200.
AC-RVD-001-007 (200 with permission — SYSTEM_ADMIN): Given user role SYSTEM_ADMIN có
  room.detail.read; Then 200.
AC-RVD-001-008 (occupancyStatus present): Given phòng đang có booking active; Then
  occupancyStatus.currentBooking khớp booking đó.
AC-RVD-001-009 (occupancyStatus absent): Given phòng không có booking active; Then
  occupancyStatus.currentBooking = null.
AC-RVD-001-010 (upcomingBookings limit): Given phòng có > 5 booking tương lai active; Then
  upcomingBookings chỉ trả 5, sort ASC theo reservedStartTime.
AC-RVD-001-011 (upcomingBookings empty): Given phòng không có booking tương lai; Then
  upcomingBookings = [].
AC-RVD-001-012 (createdBy null-safe): Given entity.createdBy = null; Then response.createdBy = null
  (không throw).
AC-RVD-001-013 (administrativeStatus tách biệt occupancyStatus): Given rooms.current_status =
  'maintenance' NHƯNG phòng đang có booking active hợp lệ trong DB (dữ liệu lịch sử/edge-case); Then
  administrativeStatus = 'maintenance' VÀ occupancyStatus.currentBooking vẫn trả đúng booking đó
  (2 field độc lập, không field nào ghi đè field kia).
AC-RVD-001-014 (permission seed): Given migration room.detail.read đã chạy; Then role_permissions
  có đúng 2 dòng cho SYSTEM_ADMIN + BUSINESS_ADMIN, KHÔNG có dòng cho MANAGER/EMPLOYEE.
```

## 11. Error Code Map

| HTTP | Code |
|---|---|
| 200 | (ok) |
| 400 | VALIDATION_ERROR (roomId sai uuid) |
| 401 | UNAUTHORIZED |
| 403 | FORBIDDEN |
| 404 | ROOM_NOT_FOUND |

---

## 12. Constitution / CLAUDE compliance

- **SEC-02**: endpoint auth-gated + permission mới `room.detail.read`, không public. ✅
- **SEC-03**: upcomingBookings raw SQL parameterized ($1); phần info tĩnh dùng TypeORM repository (an toàn theo thiết kế ORM). ✅
- **DATA-01**: soft-delete filter (`deletedAt IS NULL`); KHÔNG thêm bảng/cột mới, chỉ migration seed permission (đã có tiền lệ — không vi phạm "không tự ý đổi database baseline"). ✅
- **ARCH-01**: đọc trong cùng module `rooms`, tái sử dụng `RoomStatusService` nội bộ (không cross-module DB access trái phép). ✅
- **§9.2 CLAUDE.md permission naming**: `room.detail.read` theo đúng convention dot-notation `<module>.<resource>.<action>` đã dùng thực tế trong repo (`room.utilization.read`, `room.noshow.read`, `analytics.room.read`...). ✅

---

## 13. Test Plan (Jest — mock repository/dataSource, KHÔNG DB thật)

```text
rooms.service.spec (method mới getRoomDetail):
- found: mock roomRepo.findOne trả entity đầy đủ + mock roomStatusService.getRoomStatus trả
  RoomStatusDetail → map đúng field response (bao gồm administrativeStatus tách biệt
  occupancyStatus).
- not found: roomRepo.findOne trả null → throw NotFoundException ROOM_NOT_FOUND, KHÔNG gọi
  roomStatusService (assert mock KHÔNG được gọi — tối ưu tránh round-trip thừa).
- createdBy/updatedBy null: entity.createdByUser/updatedByUser = null → response field = null.
- createdBy/updatedBy present: map đúng {userId, fullName}.
- upcomingBookings: mock dataSource.manager.query trả rows → map đúng field; rỗng → [].
- upcomingBookings limit: assert SQL chứa 'LIMIT 5' và 'reserved_start_time > now()'.

rooms.controller.spec (route mới):
- GET :roomId passthrough → envelope {success, message:'Room detail retrieved', data}.
- 404 propagate từ service.
- assert @RequirePermissions('room.detail.read') trên method (rbac spec riêng nếu repo có
  pattern *.rbac.spec.ts giống no-show.rbac.spec.ts).

rooms.controller.rbac.spec (mirror no-show.rbac.spec.ts pattern nếu có):
- role BUSINESS_ADMIN/SYSTEM_ADMIN → 200; role MANAGER/EMPLOYEE → 403.

migration spec/manual verify:
- chạy migration lên test DB → SELECT role_permissions JOIN roles/permissions → đúng 2 role
  (SYSTEM_ADMIN, BUSINESS_ADMIN) cho permission_code = 'room.detail.read'.
```

---

> Trạng thái: **CHỜ REVIEW spec** (quyết định D-1..D-5 đã LOCK qua thảo luận; riêng D-3 có 1 giả định
> cần PO xác nhận — xem mục 1.5). Chưa plan/tasks/code.
