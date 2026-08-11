---
name: feat-view-room-detail-plan
description: Ke hoach ROOM-VIEW-DETAIL-001 — RoomsService.getRoomDetail() compose RoomStatusService, controller GET :roomId moi, migration seed permission room.detail.read.
category: rooms
---

# Implementation Plan: View Room Detail (ROOM-VIEW-DETAIL-001)

- **Feature ID**: ROOM-VIEW-DETAIL-001 · **Module**: rooms · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-08-11 | Khởi tạo plan.md (RoomsService.getRoomDetail, controller GET :roomId, DTO, migration permission). | Toàn bộ file |

---

## 1. Technical Context (verified)

- `RoomStatusService.getRoomStatus(roomId)` đã tồn tại và implement đầy đủ (`noShowStatus` đã có giá trị thật, không còn là stub null như spec RMS-001 gốc) — [room-status.service.ts:133-150](../../../../src/modules/rooms/services/room-status.service.ts). Tái sử dụng NGUYÊN XI, không viết lại SQL.
- `RoomsModule` đã có sẵn `RoomsService`, `RoomStatusService` làm provider trong cùng module — không cần thêm import module ([rooms.module.ts](../../../../src/modules/rooms/rooms.module.ts)).
- `RoomsController` đã có `search` (literal, :60) và `realtime-status` (literal, :238) khai TRƯỚC mọi route `:roomId/...`. Route mới `GET :roomId` (bare) phải khai SAU 2 route literal đó (route param 1-segment không được đăng ký trước literal 1-segment).
- Envelope manual `{success, message, data}` — không có global interceptor, đúng pattern toàn bộ `rooms.controller.ts`.
- Permission mới cần seed qua migration (mirror `20260721000001-SeedRoomBookingReadPermission.ts`), KHÔNG dùng `src/database/seeds/` (không có runner — đã bị bug 15+ lần trong repo này).

## 2. Danh sách thay đổi

| Loại | File |
|---|---|
| Sửa | `rooms/services/rooms.service.ts` (+ method `getRoomDetail(roomId)`) |
| Mới | `rooms/dto/room-detail-response.dto.ts` |
| Sửa | `rooms/controllers/rooms.controller.ts` (+ `GET :roomId`, khai sau `search`/`realtime-status`) |
| Mới | `src/database/migrations/20260811000003-SeedRoomDetailReadPermission.ts` |
| Sửa (test) | `rooms/tests/rooms.service.spec.ts` (thêm describe `getRoomDetail`) |
| Sửa (test) | `rooms/controllers/rooms.controller.spec.ts` (+ test route mới) |
| Sửa (test, nếu tồn tại) | `rooms/controllers/rooms.controller.rbac.spec.ts` — mirror `no-show.rbac.spec.ts` cho `room.detail.read` |

> KHÔNG migration đổi schema — chỉ 1 migration seed permission (bảng `permissions`/`role_permissions` đã tồn tại, INSERT thuần).

## 3. RoomsService.getRoomDetail()

```text
async getRoomDetail(roomId: string): Promise<RoomDetailResponseDto> {
  const room = await this.roomRepo.findOne({
    where: { id: roomId, deletedAt: IsNull() },
    relations: ['createdByUser', 'updatedByUser'],
  });
  if (!room) {
    throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' });
  }

  const occupancyStatus = await this.roomStatusService.getRoomStatus(roomId);
  // an toàn: room đã confirm tồn tại ở bước trên, gọi lại chỉ để lấy phần realtime,
  // KHÔNG viết lại LATERAL SQL của RoomStatusService (BR-1).

  const upcomingBookings = await this.dataSource.manager.query(
    `SELECT b.id AS booking_id, b.meeting_id, m.title,
            u.full_name AS host_name, b.reserved_start_time, b.reserved_end_time
     FROM room_bookings b
     JOIN meetings m ON m.id = b.meeting_id
     LEFT JOIN users u ON u.id = COALESCE(m.host_id, m.organizer_id)
     WHERE b.room_id = $1
       AND b.reserved_start_time > now()
       AND b.status IN ('approved','active')
     ORDER BY b.reserved_start_time ASC
     LIMIT 5`,
    [roomId],
  );

  return this.toDetailDto(room, occupancyStatus, upcomingBookings);
}

private toDetailDto(room, occupancyStatus, upcomingRows): RoomDetailResponseDto {
  return {
    roomId: room.id,
    roomCode: room.roomCode,
    roomName: room.roomName,
    siteName: room.siteName,
    areaName: room.areaName,
    locationDescription: room.locationDescription,
    capacity: room.capacity,
    roomType: room.roomType,
    administrativeStatus: room.currentStatus,       // BR-3: KHÔNG đổi tên trùng occupancyStatus
    hasCamera: room.hasCamera,
    hasMicrophone: room.hasMicrophone,
    hasDisplay: room.hasDisplay,
    allowRecording: room.allowRecording,
    layoutJson: room.layoutJson,
    isActive: room.isActive,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    createdBy: room.createdByUser
      ? { userId: room.createdByUser.id, fullName: room.createdByUser.fullName }
      : null,                                        // BR-6
    updatedBy: room.updatedByUser
      ? { userId: room.updatedByUser.id, fullName: room.updatedByUser.fullName }
      : null,
    occupancyStatus: {
      currentBooking: occupancyStatus.currentBooking,
      occupancyCount: occupancyStatus.occupancyCount,
      lastPresenceAt: occupancyStatus.lastPresenceAt,
      noShowStatus: occupancyStatus.noShowStatus,     // BR-5: chỉ string rút gọn
    },
    upcomingBookings: upcomingRows.map((r) => ({
      bookingId: r.booking_id,
      meetingId: r.meeting_id,
      title: r.title,
      hostName: r.host_name,
      reservedStartTime: r.reserved_start_time,
      reservedEndTime: r.reserved_end_time,
    })),                                              // BR-4: rỗng → []
  };
}
```

- Cần inject thêm `DataSource` vào `RoomsService` nếu chưa có (kiểm tra constructor hiện tại trước khi sửa — nếu đã dùng repository pattern thuần thì thêm `@InjectDataSource()` hoặc dùng `roomRepo.manager` có sẵn, KHÔNG cần thêm provider mới vào module).
- `roomRepo` (Repository<RoomEntity>) giả định đã tồn tại trong `RoomsService` (dùng chung với `create/update/deleteRoom`) — verify tên field thực tế trước khi patch, không đoán.

## 4. Controller (route mới)

```text
@Get(':roomId')   // ROOM-VIEW-DETAIL-001 — khai SAU 'search' và 'realtime-status' (FR-009)
@HttpCode(HttpStatus.OK)
@UseGuards(PermissionsGuard)
@RequirePermissions('room.detail.read')
@ApiOperation({ summary: 'Xem chi tiet 1 phong hop (admin)' })
@ApiResponse({ status: 200, description: 'Chi tiet phong duoc truy xuat thanh cong' })
@ApiResponse({ status: 401, description: 'Chua xac thuc' })
@ApiResponse({ status: 403, description: 'Khong co quyen room.detail.read' })
@ApiResponse({ status: 404, description: 'Khong tim thay phong' })
async getDetail(
  @Param('roomId', ParseUUIDPipe) roomId: string,
): Promise<{ success: boolean; message: string; data: RoomDetailResponseDto }> {
  const data = await this.roomsService.getRoomDetail(roomId);
  return { success: true, message: 'Room detail retrieved', data };
}
```

- Đặt method này **ngay sau** `search()` (dòng ~82) hoặc **ngay trước** `realtimeStatus()` — miễn đứng sau cả 2 route literal `search`/`realtime-status` trong thứ tự khai báo class (Nest đăng ký route theo thứ tự method trong class).
- Không cần `@UsePipes(ValidationPipe)` riêng vì không có body/query DTO — chỉ `ParseUUIDPipe` cho param.

## 5. DTO

`rooms/dto/room-detail-response.dto.ts`:
```text
class RoomDetailUserRefDto { userId: string; fullName: string; }
class RoomDetailBookingRefDto { bookingId; meetingId; title; hostName; reservedStartTime; reservedEndTime; }
class RoomDetailOccupancyStatusDto {
  currentBooking: RoomDetailBookingRefDto | null;
  occupancyCount: number | null;
  lastPresenceAt: Date | string | null;
  noShowStatus: string | null;
}
class RoomDetailResponseDto {
  roomId; roomCode; roomName; siteName; areaName; locationDescription; capacity; roomType;
  administrativeStatus; hasCamera; hasMicrophone; hasDisplay; allowRecording; layoutJson; isActive;
  createdAt; updatedAt;
  createdBy: RoomDetailUserRefDto | null;
  updatedBy: RoomDetailUserRefDto | null;
  occupancyStatus: RoomDetailOccupancyStatusDto;
  upcomingBookings: RoomDetailBookingRefDto[];
}
```
Đây là response DTO thuần (không @IsX validation — không phải input DTO).

## 6. Migration permission (mirror pattern có sẵn)

`src/database/migrations/20260811000003-SeedRoomDetailReadPermission.ts` — copy cấu trúc [20260721000001-SeedRoomBookingReadPermission.ts](../../../../src/database/migrations/20260721000001-SeedRoomBookingReadPermission.ts), đổi:
- `permission_code = 'room.detail.read'`
- `permission_name = 'Xem chi tiet phong hop (day du)'`
- `module_code = 'rooms'`, `action_code = 'read'`
- `description = 'Xem thong tin chi tiet 1 phong hop (info tinh + realtime + no-show status), chi danh cho vai tro quan tri'`
- `roleCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` (KHÔNG MANAGER — khác bản gốc room.booking.read)

`down()`: xóa `role_permissions` rồi `permissions` theo `permission_code = 'room.detail.read'` (mirror y hệt).

## 7. Tests (mock repository/dataSource, ≥80%)

- `rooms.service.spec`: `getRoomDetail` — found (map đầy đủ field, administrativeStatus tách occupancyStatus), not-found (throw sớm, KHÔNG gọi roomStatusService — assert `toHaveBeenCalledTimes(0)`), createdBy/updatedBy null-safe, upcomingBookings limit 5 + rỗng.
- `rooms.controller.spec`: route mới passthrough envelope, 404 propagate.
- `rooms.controller.rbac.spec` (nếu file dạng này đã tồn tại cho controller khác trong module — mirror `no-show.rbac.spec.ts`): assert `@RequirePermissions('room.detail.read')` metadata trên method.

## 8. DoD

```
[ ] RoomsService.getRoomDetail() — compose RoomStatusService (BR-1), soft-delete 404, null-safe
    createdBy/updatedBy, upcomingBookings query parameterized
[ ] Controller GET :roomId — đúng vị trí sau search/realtime-status, guard + permission đúng
[ ] DTO RoomDetailResponseDto đầy đủ field theo spec §4.1
[ ] Migration seed room.detail.read — CHỈ SYSTEM_ADMIN + BUSINESS_ADMIN, idempotent, có down()
[ ] Tests ≥80%; build/lint/jest xanh; boot smoke (route mapped + 0 DI lỗi); KHÔNG migration đổi schema
```

> Trạng thái: CHỜ REVIEW sau implement (STOP ở code-review gate). Chưa commit.
