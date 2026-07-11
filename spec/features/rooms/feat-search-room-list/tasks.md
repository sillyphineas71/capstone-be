# Tasks: Xem & Tìm kiếm Danh sách Phòng (UC-ROOM-04)

**Feature**: ROOM-SEARCH-LIST-001 — Search & List Rooms
**Module**: rooms
**Branch**: `031-search-room-list`
**Date**: 2026-07-09

**Input documents**:
- spec.md, plan.md

**Path Conventions**:
- Source files: `src/modules/rooms/` (module đã tồn tại — chỉ thêm file mới + sửa nhỏ `rooms.controller.ts`)
- **Không** cần seed permission mới (chỉ `JwtAuthGuard`)

---

## Phase 1: Setup

- [ ] T001 [P] Tạo `src/modules/rooms/dto/search-rooms-query.dto.ts`
- [ ] T002 [P] Tạo `src/modules/rooms/dto/room-search-item.dto.ts`
- [ ] T003 [P] Tạo `src/modules/rooms/services/room-search.service.ts`
- [ ] T004 [P] Tạo `src/modules/rooms/tests/room-search.service.spec.ts`

---

## Phase 2: Foundational

- [ ] T005 [FR-013–FR-016] [P] Implement `SearchRoomsQueryDto` trong `search-rooms-query.dto.ts`
  - `@IsOptional() @IsInt() @Min(1) @Type(() => Number) capacityMin?: number`
  - `@IsOptional() @IsInt() @Min(1) @Type(() => Number) capacityMax?: number`
  - `@IsOptional() @IsString() @MaxLength(255) areaName?: string`
  - `@IsOptional() @IsBoolean() @Type(() => Boolean) onlyAvailable?: boolean`
  - `@IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number`
  - `@IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) limit?: number`

- [ ] T006 [FR-018] [P] Implement `RoomSearchItemDto` trong `room-search-item.dto.ts`
  - `roomId, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording`
  - KHÔNG khai báo `occupancyCount`/`lastPresenceAt`/`noShowStatus`/`currentBooking`

- [ ] T007 [FR-017] Thêm handler `GET /search` (shell) vào `rooms.controller.ts`
  - `@Get('search')` — khai TRƯỚC route có path param động nếu có xung đột (kiểm tra thứ tự route hiện tại trong file)
  - Chỉ dùng guard class-level `JwtAuthGuard` đã có sẵn, KHÔNG thêm `PermissionsGuard`/`RequirePermissions`
  - `@Query(new ValidationPipe({whitelist:true, transform:true})) query: SearchRoomsQueryDto`

- [ ] T008 [FR-001] Implement `RoomSearchService` (shell) trong `room-search.service.ts`
  - `search(query: SearchRoomsQueryDto): Promise<{rooms: RoomSearchItemDto[], meta: object}>` — throw `NotImplementedException` tạm

- [ ] T009 [Module] Cập nhật `rooms.module.ts`
  - Đăng ký `RoomSearchService` vào `providers`

---

## Phase 3: Business Logic

- [ ] T010 [FR-015, ERR-002] Implement validate khoảng sức chứa trong `RoomSearchService.search()`
  - Nếu `capacityMin` và `capacityMax` đều có và `capacityMin > capacityMax` → `BadRequestException({code:'VALIDATION_ERROR'})`

- [ ] T011 [FR-002, FR-005–FR-010, FR-019] Implement query chính
  - `SELECT ... FROM rooms WHERE is_active=true AND deleted_at IS NULL AND ($1::int IS NULL OR capacity>=$1) AND ($2::int IS NULL OR capacity<=$2) AND ($3::text IS NULL OR area_name=$3) AND ($4::boolean IS NULL OR $4=false OR current_status='available') ORDER BY room_code ASC LIMIT $5 OFFSET $6`
  - Bind đầy đủ tham số, không nối chuỗi (NFR-003)

- [ ] T012 [FR-012] Implement query đếm tổng
  - `SELECT COUNT(*) FROM rooms WHERE <cùng điều kiện WHERE ở T011, không LIMIT/OFFSET>`

- [ ] T013 [FR-011, FR-020] Implement build response
  - Map rows → `RoomSearchItemDto[]`
  - `meta.appliedFilters` = echo các param đã dùng (loại bỏ field `undefined`)
  - `meta.page/limit/total/totalPages`
  - Nếu `rooms.length===0` → trả kèm cờ/message để controller build đúng E1 message

---

## Phase 4: Controller Wiring & Error Handling

- [ ] T014 [FR-004, FR-011] Hoàn thiện handler `GET /search`
  - Gọi `roomSearchService.search(query)`
  - Nếu `rooms.length===0` → `message: 'Không có phòng họp nào khớp với các tiêu chí hiện tại. Vui lòng điều chỉnh bộ lọc của bạn.'`
  - Ngược lại → `message: 'Danh sách phòng họp được truy xuất thành công'`
  - Trả `{success:true, message, data: rooms, meta}`
  - Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`

---

## Phase 5: Testing

- [ ] T015 [Test, AC-002] [P] Unit test từng filter riêng lẻ
  - `capacityMin` only, `capacityMax` only, cả 2, `areaName`, `onlyAvailable=true` — mỗi case verify đúng kết quả lọc

- [ ] T016 [Test, AC-002] [P] Unit test kết hợp nhiều filter (AND)
  - Truyền đồng thời `capacityMin`+`capacityMax`+`areaName`+`onlyAvailable` → chỉ trả phòng khớp TẤT CẢ điều kiện

- [ ] T017 [Test, AC-004] [P] Unit test empty state (E1)
  - Filter không khớp phòng nào → `rooms=[]`, message đúng nội dung E1

- [ ] T018 [Test, AC-001, AC-003] [P] Unit test AF-1 (xóa bộ lọc / không filter)
  - Không truyền param nào → trả toàn bộ phòng `isActive=true, deletedAt IS NULL`, sort `roomCode ASC`

- [ ] T019 [Test, AC-005] [P] Unit test validation
  - `capacityMin > capacityMax` → `VALIDATION_ERROR`
  - `page<1`/`limit>100` → `VALIDATION_ERROR`

- [ ] T020 [Test] [P] Unit test response không lộ field nội bộ
  - Verify response object KHÔNG có key `occupancyCount`/`lastPresenceAt`/`noShowStatus`/`currentBooking`

- [ ] T021 [Test, AC-006] [P] Unit test authentication
  - Không có JWT → 401
  - Có JWT hợp lệ (bất kỳ role, kể cả không có permission đặc biệt nào) → 200

- [ ] T022 [Test] [P] Unit test phòng đã soft-delete/inactive không xuất hiện
  - Phòng có `deletedAt` khác null hoặc `isActive=false` → KHÔNG nằm trong kết quả dù khớp mọi filter khác

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T023 [Polish] Verify response format `{success, message, data, meta}`
- [ ] T024 [Polish] Verify mọi query dùng parameter binding, không nối chuỗi
- [ ] T025 [Polish, NFR-004] Verify KHÔNG có field vận hành nội bộ nào lọt vào `RoomSearchItemDto`/response
- [ ] T026 [Polish] Verify consistent error codes: `VALIDATION_ERROR`, `INTERNAL_ERROR`
- [ ] T027 [Polish, OOS-003] Verify KHÔNG có thay đổi nào lên `room-status.service.ts`/`rooms.controller.ts` route `realtime-status` hiện có (chỉ đọc để tham khảo pattern, không sửa)
- [ ] T028 [Docs] Ghi chú vào tài liệu API contract nội bộ rằng `GET /api/v1/rooms/search` là endpoint mới cho UC-ROOM-04

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

- Phase 1: T001-T004 song song
- Phase 5: T015-T022 song song (unit test độc lập)

---

## Implementation Strategy (MVP)

1. Phase 1 + Phase 2 — API tồn tại, trả lỗi tạm
2. Phase 3 — Business logic đầy đủ (filter AND, phân trang, empty state)
3. Phase 4 — Controller hoàn chỉnh
4. Phase 5 — Unit test toàn bộ nhánh (đặc biệt T020 — không lộ field nội bộ, dễ bị bỏ sót nếu copy-paste từ `RoomStatusService`)
5. Phase 6 — Polish, verify không đụng feature RMS-001 có sẵn

MVP = Phase 1 → Phase 4.

## Requirements Coverage

| Requirement ID | Task(s) |
|---|---|
| FR-001–FR-003 | T011 |
| FR-004 | T011, T018 |
| FR-005–FR-010 | T011, T016 |
| FR-011 | T013, T014, T017 |
| FR-012 | T005, T011, T012 |
| FR-013–FR-016 | T005, T010 |
| FR-017 | T007, T021 |
| FR-018, FR-019 | T006, T011, T020 |
| FR-020 | T013 |
