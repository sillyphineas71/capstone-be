# Tasks: Realtime Room Status (RMS-001)

- **Feature ID**: RMS-001 · **Module**: rooms (+ patch #29)
- **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Status**: Draft

> Read-only UC-36 list + UC-38 detail. LATERAL anti-N+1. Manual envelope. Soft-delete. Patch #29 conditional emit. KHÔNG migration. Test MOCK dataSource.

---

## CHANGELOG
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-16 | Khởi tạo tasks.md RMS-001 (service/controller/dto/module + #29 patch + tests). | Toàn bộ file |

---

## 1. DTO
- [ ] `rooms/dto/realtime-status-query.dto.ts`: siteName? @IsOptional @IsString; areaName? @IsOptional @IsString. **Ref**: FR-001.

## 2. Service
**File**: `rooms/services/room-status.service.ts` (mới)
- [ ] getRealtimeStatus(q): LATERAL query (occupancy/lastPresence/currentBooking) + soft-delete + filter bind; map field UC-36. **Ref**: FR-001/004/005/006/008.
- [ ] getRoomStatus(roomId): 404 ROOM_NOT_FOUND; map field UC-38 (KHÔNG roomName); noShowCase null, releaseHistory []. **Ref**: FR-002/003/007.

## 3. Controller + Module
**File**: `rooms/controllers/rooms.controller.ts` + `rooms.module.ts`
- [ ] `@Get('rooms/realtime-status')` TRƯỚC `@Get('rooms/:roomId/status')`; guard mock + @Permissions('room.utilization.read'); ParseUUIDPipe; manual envelope {success,message,data}. **Ref**: FR-009/011/012, NFR-006.
- [ ] module: +RoomsController +RoomStatusService +AuthModule/JwtModule/CacheModule.

## 4. Patch #29
**File**: `presence/services/occupancy-ingest.service.ts` (sửa)
- [ ] UPDATE rooms `IS DISTINCT FROM 'occupied' RETURNING id` → statusChangedToOccupied; emit room.status.updated best-effort CHỈ KHI đổi. **Ref**: FR-010, AC-012.

## 5. Tests (mock, ≥80%)
- [ ] room-status.service.spec: list (field/deleted/filter/occupancy null) + detail (found/404/null/booking present-absent).
- [ ] rooms.controller.spec: list/detail passthrough + 404.
- [ ] #29 spec: emit on transition / no-emit on repeat / WS lỗi → 202; **17 test xanh**.

## 6. Verify
- [ ] build · lint per-file · jest (rooms + presence) + coverage · boot smoke (2 route mapped + 0 DI). STOP code-review gate.

---
> Trạng thái: CHỜ REVIEW sau implement.
