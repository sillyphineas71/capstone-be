# Tasks: View Room Detail (ROOM-VIEW-DETAIL-001)

- **Feature ID**: ROOM-VIEW-DETAIL-001 · **Module**: rooms
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> GET /rooms/:roomId (bare) — admin only (BUSINESS_ADMIN + SYSTEM_ADMIN). Compose
> RoomStatusService.getRoomStatus() cho phần realtime, KHÔNG viết lại SQL. Migration seed permission
> mới `room.detail.read`, KHÔNG đổi schema. Test mock repository/dataSource.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo tasks.md (DTO + service + controller + migration permission + tests). | Toàn bộ file |

---

## 0. Trước khi code

- [ ] Đọc lại `rooms/services/rooms.service.ts` hiện tại để xác nhận tên field `roomRepo` thật (hoặc
  tên tương đương) trước khi thêm method `getRoomDetail` — plan.md §3 chỉ là phác thảo, không đoán
  tên biến.
- [ ] Xác nhận với PO điểm D-3 trong spec.md §1.5 (có seed permission cho SYSTEM_ADMIN hay không) —
  nếu PO muốn loại trừ cả SYSTEM_ADMIN, sửa `roleCodes` ở migration (mục 4 dưới) trước khi chạy.

## 1. DTO

**File**: `rooms/dto/room-detail-response.dto.ts` (mới)
- [ ] `RoomDetailUserRefDto { userId, fullName }`. **Ref**: FR-006.
- [ ] `RoomDetailBookingRefDto { bookingId, meetingId, title, hostName, reservedStartTime, reservedEndTime }`. **Ref**: FR-004/005.
- [ ] `RoomDetailOccupancyStatusDto { currentBooking, occupancyCount, lastPresenceAt, noShowStatus }`. **Ref**: FR-004.
- [ ] `RoomDetailResponseDto` — đầy đủ field theo spec §4.1 (info tĩnh + occupancyStatus + upcomingBookings). **Ref**: FR-003/004/005/006.

## 2. Service

**File**: `rooms/services/rooms.service.ts` (sửa — thêm method, KHÔNG đổi method hiện có)
- [ ] `getRoomDetail(roomId)`: `roomRepo.findOne({where:{id, deletedAt: IsNull()}, relations:['createdByUser','updatedByUser']})` → null → 404 ROOM_NOT_FOUND (ném NGAY, không gọi service khác). **Ref**: FR-001/002, BR-2.
- [ ] Gọi `this.roomStatusService.getRoomStatus(roomId)` — TÁI SỬ DỤNG, không viết lại SQL. **Ref**: FR-004, BR-1.
- [ ] Query `upcomingBookings` (raw SQL parameterized, LIMIT 5, `reserved_start_time > now()`, status IN approved/active, ORDER ASC). **Ref**: FR-005, BR-4.
- [ ] Map `createdBy`/`updatedBy` null-safe (`{userId, fullName}` hoặc `null`). **Ref**: FR-006, BR-6.
- [ ] Map `administrativeStatus = room.currentStatus` — field riêng, KHÔNG merge vào `occupancyStatus`. **Ref**: BR-3.

## 3. Controller

**File**: `rooms/controllers/rooms.controller.ts` (sửa)
- [ ] Thêm `@Get(':roomId')` — đặt SAU method `search()` và `realtimeStatus()` trong thứ tự khai báo class (route literal phải đăng ký trước route param cùng số segment). **Ref**: FR-009.
- [ ] Guard `PermissionsGuard` + `@RequirePermissions('room.detail.read')`; `ParseUUIDPipe` cho `roomId`. **Ref**: FR-007.
- [ ] Envelope `{success:true, message:'Room detail retrieved', data}`. **Ref**: spec §4.1.

## 4. Migration permission

**File**: `src/database/migrations/20260811000003-SeedRoomDetailReadPermission.ts` (mới, mirror `20260721000001-SeedRoomBookingReadPermission.ts`)
- [ ] INSERT `permissions` idempotent (`WHERE NOT EXISTS`) — `permission_code='room.detail.read'`, `module_code='rooms'`, `action_code='read'`. **Ref**: FR-008.
- [ ] Loop INSERT `role_permissions` cho `roleCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (xem task 0 — xác nhận PO trước khi chạy trên DB thật). **Ref**: FR-008, BR-7.
- [ ] `down()`: xóa `role_permissions` rồi `permissions` theo `permission_code`. **Ref**: convention repo.
- [ ] KHÔNG đặt file trong `src/database/seeds/` (không có runner — bug đã biết trong repo).

## 5. Tests (mock, ≥80%)

- [ ] `rooms.service.spec` — `getRoomDetail`: found (map đầy đủ field + administrativeStatus tách biệt occupancyStatus) / not-found (throw sớm, `roomStatusService.getRoomStatus` KHÔNG được gọi) / createdBy-updatedBy null-safe / upcomingBookings limit 5 + rỗng + SQL chứa `reserved_start_time > now()` và `LIMIT 5`.
- [ ] `rooms.controller.spec` — route mới passthrough envelope; 404 propagate từ service.
- [ ] `rooms.controller.rbac.spec` (nếu pattern này tồn tại trong module, mirror `no-show.rbac.spec.ts`) — BUSINESS_ADMIN/SYSTEM_ADMIN → có `@RequirePermissions('room.detail.read')`; xác nhận role EMPLOYEE/MANAGER không có permission này trong seed → 403 (integration/manual verify DB nếu không mock được ở unit test).

## 6. Verify

- [ ] `npm run build` · `npm run lint` (file mới/sửa) · `npm run test` (rooms module) + coverage · boot smoke (route `GET /rooms/:roomId` mapped, 0 lỗi DI).
- [ ] Chạy migration trên DB test → `SELECT r.role_code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE p.permission_code='room.detail.read'` → đúng 2 dòng (SYSTEM_ADMIN, BUSINESS_ADMIN), không có MANAGER/EMPLOYEE.
- [ ] STOP ở code-review gate — chưa commit tới khi review xong.

---
> Trạng thái: CHỜ REVIEW sau implement.
