---
name: feat-room-realtime-status-plan
description: Kế hoạch RMS-001 — rooms controller/service read-only (UC-36 list + UC-38 detail) + patch #29 room.status.updated.
category: rooms
---

# Implementation Plan: Realtime Room Status (RMS-001)

- **Feature ID**: RMS-001 · **Module**: rooms (+ patch presence #29) · **Status**: Draft
- **Spec**: [spec.md](./spec.md)

---

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo plan.md RMS-001 (RoomStatusService list/detail LATERAL, RoomsController 2 GET, DTO query, patch #29 conditional emit). Review fixes A-G baked. | Toàn bộ file |

---

## 1. Technical Context (verified)
- (A) KHÔNG global interceptor → controller manual envelope `{success,message,data}`; service raw.
- (C) site_name/area_name = cột varchar → filter trực tiếp `r.site_name=$1`/`r.area_name=$2`.
- rooms.module có entity forFeature nhưng chưa controller/service; cần import AuthModule+JwtModule+CacheModule cho JwtAuthGuard (mirror recording.module).
- #30 raw SQL trên dataSource.manager (nhất quán #29/recording), parameterized (SEC-03), soft-delete filter (DATA-01), KHÔNG migration.
- #29 patch: UPDATE rooms có điều kiện RETURNING → emit room.status.updated chỉ khi đổi.

## 2. Danh sách thay đổi
| Loại | File |
|---|---|
| Mới | `rooms/services/room-status.service.ts` (getRealtimeStatus, getRoomStatus) |
| Mới | `rooms/controllers/rooms.controller.ts` (2 GET) |
| Mới | `rooms/dto/realtime-status-query.dto.ts` |
| Sửa | `rooms/rooms.module.ts` (+controller +service +AuthModule/Jwt/Cache) |
| Sửa (patch #29) | `presence/services/occupancy-ingest.service.ts` (UPDATE rooms RETURNING + emit room.status.updated conditional) |
| Mới (test) | `rooms/services/room-status.service.spec.ts`, `rooms/controllers/rooms.controller.spec.ts` |
| Sửa (test) | `presence/services/occupancy-ingest.service.spec.ts` (UPDATE rooms returns row; +2 emit tests) |

## 3. RoomStatusService
```text
getRealtimeStatus({siteName?, areaName?}): Promise<RoomStatusListItem[]>
  - 1 query LATERAL (spec §5.1): rooms r LEFT JOIN LATERAL (occupancy) (lastPresence) (currentBooking)
    WHERE r.deleted_at IS NULL AND ($1::text IS NULL OR r.site_name=$1) AND ($2::text IS NULL OR r.area_name=$2)
    ORDER BY r.room_code.
  - map mỗi row → { roomId, roomCode, roomName, currentStatus,
      currentBooking: booking_id? null : {meetingId, meetingTitle, hostName, reservedEndTime},
      occupancyCount: occupancy_count ?? null, noShowStatus: null, lastPresenceAt: last_presence_at ?? null }.
getRoomStatus(roomId): Promise<RoomStatusDetail>
  - SELECT room WHERE id=$1 AND deleted_at IS NULL; rỗng → 404 ROOM_NOT_FOUND.
  - 3 sub-query (occupancy, lastPresence, currentBooking) theo §5 (hoặc 1 LATERAL như list, lấy [0]).
  - map → { roomId, roomCode, currentStatus,
      currentBooking: {bookingId, meetingId, title, hostName, reservedStartTime, reservedEndTime} | null,
      noShowCase: null, releaseHistory: [], lastPresenceAt, occupancyCount }.
  - KHÔNG roomName ở detail (G). occupancyCount null nếu không event (C/NC-C).
```
- SEC-03: bind tham số; soft-delete filter. Read-only (NFR-005).

## 4. Controller (manual envelope, route order)
```text
@Controller() RoomsController:
@Get('rooms/realtime-status')  // TRƯỚC :roomId
  @HttpCode(200) @UseGuards(JwtAuthGuard, MockPermissionsGuard) @Permissions('room.utilization.read')
  @UsePipes(new ValidationPipe({whitelist:true, transform:true}))
  list(@Query() q: RealtimeStatusQueryDto) → {success, message:'Room realtime status retrieved', data: items}
@Get('rooms/:roomId/status')
  @HttpCode(200) guard + @Permissions('room.utilization.read')
  detail(@Param('roomId', ParseUUIDPipe) roomId) → {success, message:'Room status retrieved', data}
```
- MockPermissionsGuard + @Permissions decorator local (pattern recording). Chấp nhận ~4-8 mock-guard lint warning.

## 5. Module
rooms.module: +AuthModule, +JwtModule.register({}), +CacheModule.register() (cho JwtAuthGuard); controllers:[RoomsController]; providers:[RoomStatusService]. (forFeature giữ nguyên; service dùng dataSource raw.)

## 6. DTO
`RealtimeStatusQueryDto { siteName? @IsOptional @IsString; areaName? @IsOptional @IsString }`.

## 7. Patch #29 (occupancy-ingest.service.ts)
```diff
- if (occupancyCount > 0) {
-   await queryRunner.query(`UPDATE rooms SET current_status='occupied' WHERE id=$1 AND current_status <> 'occupied'`, [roomId]);
- }
+ let statusChangedToOccupied = false;
+ if (occupancyCount > 0) {
+   const updated = (await queryRunner.query(
+     `UPDATE rooms SET current_status='occupied'
+      WHERE id=$1 AND current_status IS DISTINCT FROM 'occupied' RETURNING id`, [roomId])) as Array<{id:string}>;
+   statusChangedToOccupied = (updated?.length ?? 0) > 0;
+ }
...
// WS block (sau commit):
  this.websocketService.emitToRoom(`room:${roomId}`, 'room.occupancy.updated', {...});
+ if (statusChangedToOccupied) {
+   this.websocketService.emitToRoom(`room:${roomId}`, 'room.status.updated',
+     { roomId, status: 'occupied', timestamp: eventTime.toISOString() });
+ }
```
- statusChangedToOccupied khai trước transaction; emit trong try/catch WS best-effort. Toàn bộ 17 test #29 xanh.

## 8. Tests (mock dataSource, ≥80%)
- room-status.service.spec: list (đúng field, loại deleted, filter bind, occupancyCount null khi không event) / detail (found, 404, occupancyCount/lastPresence null, currentBooking present/absent) / assert SQL chứa 'deleted_at IS NULL'.
- rooms.controller.spec: list/detail passthrough envelope + 404.
- #29 spec: UPDATE rooms trả [{id}] → emit room.status.updated; trả [] (đã occupied) → KHÔNG emit; WS lỗi → vẫn 202; 17 test xanh.

## 9. DoD
```
[ ] service list/detail (LATERAL, soft-delete, null rules, currentBooking, 404)
[ ] controller 2 GET manual envelope, route order, perm guard, ParseUUIDPipe
[ ] module wiring (Auth/Jwt/Cache)
[ ] #29 patch conditional emit + 17 test xanh
[ ] tests ≥80%; build/lint/jest/boot (2 route mapped, 0 DI) xanh; KHÔNG migration
```

> Trạng thái: CHỜ REVIEW sau implement (STOP ở code-review gate). Chưa commit.
