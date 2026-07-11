# Tasks: Cập nhật thông tin phòng họp (UC-ROOM-02)

**Feature**: ROOM-UPDATE-ROOM-INFO-001 — Update Room Info
**Module**: rooms
**Branch**: `029-update-room-info`
**Date**: 2026-07-09

**Input documents**:
- spec.md, plan.md

**Path Conventions**:
- Source files: `src/modules/rooms/` (module đã tồn tại — chỉ thêm file mới + sửa `rooms.controller.ts`/`rooms.service.ts` hiện có)
- Seed file: `src/database/seeds/`
- Tái dùng: `WebsocketService.broadcast()` (đã có), pattern transaction + audit-ngoài-transaction của `RoomsService.create()`

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/rooms/dto/update-room.dto.ts`
- [ ] T002 [P] Tạo `src/modules/rooms/dto/update-room-response.dto.ts`
- [ ] T003 [P] Tạo/mở rộng file test `src/modules/rooms/tests/rooms.service.update.spec.ts`

---

## Phase 2: Foundational

- [ ] T004 [FR-017, FR-018, FR-019, FR-020] [P] Implement `UpdateRoomDto` trong `update-room.dto.ts`
  - `@IsString() @IsNotEmpty() @MaxLength(255) roomName: string` (required, giống `CreateRoomDto`)
  - `@IsString() @IsNotEmpty() @MaxLength(255) areaName: string` (**required** — khác create, §0.2 spec.md)
  - `@IsOptional() @IsString() @MaxLength(255) siteName?: string`
  - `@IsOptional() @IsString() locationDescription?: string`
  - `@IsInt() @Min(1) @Max(1000) capacity: number` (required, giống create)
  - `@IsOptional() @IsEnum(RoomType) roomType?: RoomType`
  - `@IsOptional() @IsBoolean() hasCamera?: boolean`
  - `@IsOptional() @IsBoolean() hasMicrophone?: boolean`
  - `@IsOptional() @IsBoolean() hasDisplay?: boolean`
  - `@IsOptional() @IsBoolean() allowRecording?: boolean`
  - **KHÔNG** khai báo `roomCode` (bị whitelist loại nếu client gửi)

- [ ] T005 [FR-010, FR-026] [P] Implement `UpdateRoomResponseDto` trong `update-room-response.dto.ts`
  - `id, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording, isActive, updatedAt`

- [ ] T006 [FR-004] Thêm handler `PATCH /:roomId` (shell) trong `rooms.controller.ts`
  - `@Patch(':roomId')`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('room.update')`
  - `@Param('roomId', ParseUUIDPipe) roomId: string`
  - `@Body(new ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true})) dto: UpdateRoomDto`
  - `@CurrentUser()`, `@Ip()` (mirror `create()`)

- [ ] T007 [FR-001] Thêm method `update()` (shell) trong `rooms.service.ts`
  - Signature: `update(roomId: string, dto: UpdateRoomDto, userId: string, ipAddress?: string): Promise<UpdateRoomResponseDto>`
  - Inject thêm `WebsocketService` vào constructor `RoomsService`
  - Throw `NotImplementedException` tạm

---

## Phase 3: Business Logic

- [ ] T008 [FR-006, FR-021, FR-024, FR-027, FR-DATA-001] Sửa `checkDuplicateRoomName` trong `rooms.service.ts`
  - Thêm tham số optional `excludeRoomId?: string`
  - Nếu có `excludeRoomId`, thêm `.andWhere('room.id != :excludeRoomId', { excludeRoomId })` vào query builder hiện có
  - `create()` gọi KHÔNG truyền (giữ nguyên hành vi cũ) — verify không phá test cũ của `create()`

- [ ] T009 [FR-005, FR-016, ERR-008] Implement check tồn tại phòng trong `update()`
  - `roomRepo.findOne({ where: { id: roomId }, withDeleted: false })` (mặc định loại soft-delete) → không có → `NotFoundException({code:'ROOM_NOT_FOUND'})`

- [ ] T010 [FR-007, FR-002, FR-011, FR-012, FR-013] Implement merge + save trong transaction
  - Trong `dataSource.transaction()`: load room hiện tại (từ T009), gán field từ `dto` CHỈ khi `dto.field !== undefined` (tránh ghi đè field optional không gửi)
  - `room.roomName = dto.roomName.trim()`, `room.areaName = dto.areaName.trim()`, `room.capacity = dto.capacity`
  - `room.siteName = dto.siteName !== undefined ? dto.siteName : room.siteName` (tương tự cho `locationDescription`, `roomType`, `hasCamera`, `hasMicrophone`, `hasDisplay`, `allowRecording`)
  - `room.updatedBy = userId`
  - Giữ nguyên `roomCode`, `currentStatus`, `isActive`, `createdBy`, `createdAt` (không gán lại)
  - `em.save(RoomEntity, room)`

- [ ] T011 [FR-008, FR-025] Implement audit log (ngoài transaction) trong `update()`
  - Lưu snapshot `oldValueJson` TRƯỚC khi save (từ record load ở T009), `newValueJson` SAU khi save (T010)
  - `actionType='update'`, `entityType='room'`, `entityId=roomId`, `ipAddress`, `severity=INFO`
  - Try/catch — fail chỉ log, KHÔNG throw (đúng pattern `create()`)

- [ ] T012 [FR-009, FR-026] Implement WebSocket broadcast trong `update()`
  - Sau khi transaction + audit hoàn tất (thành công): `this.websocketService.broadcast('room.updated', { roomId, roomName, siteName, areaName, locationDescription, capacity, roomType, hasCamera, hasMicrophone, hasDisplay, allowRecording, updatedAt: saved.updatedAt })`

- [ ] T013 [FR-010] Implement build response trong `update()`
  - Trả `new UpdateRoomResponseDto({...saved fields})`

---

## Phase 4: Controller Wiring & Error Handling

- [ ] T014 [FR-004, FR-010] Hoàn thiện `RoomsController` handler `PATCH /:roomId`
  - Gọi `roomsService.update(roomId, dto, userId, ipAddress)`
  - Trả `{ success: true, message: 'Cập nhật thông tin phòng họp thành công', data: result }`
  - Catch lỗi không lường trước → để `HttpException` (từ service) bubble nguyên trạng; lỗi khác → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

- [ ] T015 [Module] Cập nhật `rooms.module.ts`
  - Đảm bảo `WebsocketModule`/`WebsocketService` được import và khả dụng để inject vào `RoomsService`

---

## Phase 5: Testing

- [ ] T016 [Test, AC-003, AC-007] [P] Unit test `checkDuplicateRoomName` với `excludeRoomId`
  - Không đổi tên (tên mới = tên cũ của chính phòng đang sửa) → KHÔNG lỗi trùng
  - Đổi tên trùng phòng KHÁC → lỗi `ROOM_NAME_ALREADY_EXISTS`
  - `create()` không truyền `excludeRoomId` → hành vi cũ không đổi (regression test)

- [ ] T017 [Test, AC-004, AC-005, AC-006] [P] Unit test validation `UpdateRoomDto`
  - `roomName` rỗng → lỗi
  - `areaName` rỗng → lỗi
  - `capacity` ≤ 0 hoặc > 1000 → lỗi
  - Nhiều lỗi cùng lúc → response chứa đủ danh sách lỗi (FR-022)

- [ ] T018 [Test, AC-001] [P] Unit test not-found + permission
  - `roomId` không tồn tại/soft-deleted → `ROOM_NOT_FOUND`
  - Thiếu permission `room.update` → 403 `PERMISSION_DENIED`

- [ ] T019 [Test] [P] Unit test field preservation (FR-002, FR-011, FR-012, FR-013)
  - Update chỉ `capacity` → `roomCode`/`currentStatus`/`isActive`/`createdBy`/`createdAt` không đổi
  - Gửi kèm `roomCode` khác trong body → bị whitelist loại, `roomCode` cũ không đổi
  - Không gửi `siteName` → giữ nguyên giá trị cũ (không bị set về null)

- [ ] T020 [Test, AC-001] [P] Unit test WebSocket broadcast
  - Update thành công → `websocketService.broadcast` gọi đúng 1 lần, đúng event `room.updated`, đúng payload
  - Update thất bại (bất kỳ lỗi nào ở T008/T009/T017/T018) → `broadcast` KHÔNG được gọi

- [ ] T021 [Test] [P] Unit test audit log
  - Audit log ghi đúng `oldValueJson`/`newValueJson`
  - Audit log fail (mock throw) → update vẫn thành công, không rollback (NFR-005)

- [ ] T022 [Test] [P] Unit test seed permission `room.update`
  - Tạo đúng permission, gán đúng `SYSTEM_ADMIN` + `BUSINESS_ADMIN`

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [Polish] Tạo `src/database/seeds/<timestamp>-SeedRoomUpdatePermission.ts` theo đúng pattern seed permission hiện có (moduleCode='rooms', actionCode='update', roles=['SYSTEM_ADMIN','BUSINESS_ADMIN'])
- [ ] T024 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T025 [Polish] Verify mọi query dùng parameter binding (đặc biệt `excludeRoomId` trong query builder)
- [ ] T026 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `ROOM_NOT_FOUND`, `ROOM_NAME_ALREADY_EXISTS`, `PERMISSION_DENIED`, `INTERNAL_ERROR`
- [ ] T027 [Polish] Verify KHÔNG có logic đụng module `equipment`/bảng `equipments` (OOS-003)
- [ ] T028 [Docs] Cập nhật/ghi chú vào tài liệu API contract nội bộ (nếu có) rằng `PATCH /api/v1/rooms/:roomId` là endpoint mới bổ sung cho UC-ROOM-02

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1**: Không phụ thuộc
- **Phase 2**: Phụ thuộc Phase 1
- **Phase 3 (Business Logic)**: Phụ thuộc Phase 2
- **Phase 4 (Wiring)**: Phụ thuộc Phase 3
- **Phase 5 (Testing)**: Phụ thuộc Phase 4
- **Phase 6 (Polish)**: Phụ thuộc Phase 5

### Parallel Opportunities

- Phase 1: T001-T003 song song
- Phase 5: T016-T022 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 — Business logic đầy đủ (check trùng loại trừ chính nó, merge partial-safe, audit, broadcast)
3. Phase 4 — Controller hoàn chỉnh
4. Phase 5 — Unit test toàn bộ nhánh (đặc biệt T016 loại trừ chính nó — dễ bug nhất)
5. Phase 6 — Seed permission, polish

MVP = Phase 1 → Phase 4.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T010 |
| FR-004, FR-014, FR-015 | T006 (guard) |
| FR-005, FR-016 | T009 |
| FR-006, FR-021, FR-024, FR-027 | T008 |
| FR-007 | T010 |
| FR-008, FR-025 | T011 |
| FR-009, FR-026 | T012 |
| FR-010 | T013, T014 |
| FR-011, FR-012, FR-013 | T010 |
| FR-017–FR-022 | T004 |
| FR-023 | T006 |
