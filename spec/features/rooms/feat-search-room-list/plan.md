# Implementation Plan: Xem & Tìm kiếm Danh sách Phòng (UC-ROOM-04)

**Branch**: `031-search-room-list` | **Date**: 2026-07-09
**Spec**: spec/features/rooms/feat-search-room-list/spec.md

## Summary

Bổ sung 1 endpoint mới `GET /api/v1/rooms/search` trong module `rooms`, mở cho mọi user đã đăng nhập (không permission riêng), cho phép lọc theo sức chứa (khoảng), vị trí (`areaName`), và trạng thái trống hiện tại (`onlyAvailable`). Tái dùng pattern LATERAL JOIN tính `current_status` từ `RoomStatusService` (RMS-001), nhưng KHÔNG lộ field vận hành nội bộ (`occupancyCount`, `lastPresenceAt`, `noShowStatus`) — response chỉ gồm thông tin catalog phù hợp browse chung. Read-only tuyệt đối, không thêm bảng/cột/permission.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT
**Storage**: PostgreSQL (raw parameterized SQL, tái dùng phần tính `current_status`)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 1s (catalog quy mô nhỏ)
**Constraints**: Read-only tuyệt đối; không permission riêng (chỉ `JwtAuthGuard`); không lộ field vận hành nội bộ; không thêm date/time picker

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột |
| **Security Gate** | PASS | `JwtAuthGuard` (không permission riêng — quyết định đã duyệt, §0.1 spec.md); parameterized query |
| **Scope Gate** | PASS | 1 endpoint mới; KHÔNG sửa `GET /rooms/realtime-status` (RMS-001) hay `GET /rooms/available`; không thêm filter thiết bị/siteName/date-time ngoài UC gốc |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/rooms/`; không import chéo module khác |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint mới hoàn toàn — cần task đồng bộ tài liệu |
| **Auth Gate** | PASS | `JwtAuthGuard`; không cần `CurrentUser()` vì không có scope theo user |
| **Test Gate** | PASS | Unit test cho từng filter, kết hợp AND, empty state, validation |

## Project Structure

### Documentation (this feature)

```text
spec/features/rooms/feat-search-room-list/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/rooms/
├── rooms.module.ts                      # Update: đăng ký controller/service/repository mới (nếu tách riêng)
├── controllers/
│   └── rooms.controller.ts              # Update: thêm GET /search (khai TRƯỚC ':roomId/status' nếu path conflict — theo đúng comment pattern đã dùng cho realtime-status)
├── services/
│   └── room-search.service.ts           # NEW: query engine (tái dùng LATERAL JOIN pattern từ RoomStatusService, không copy nguyên hàm)
├── dto/
│   ├── search-rooms-query.dto.ts        # NEW: capacityMin/capacityMax/areaName/onlyAvailable/page/limit
│   └── room-search-item.dto.ts          # NEW: response shape (không có field vận hành nội bộ)
└── tests/
    └── room-search.service.spec.ts      # NEW
```

**Structure Decision**: Tạo `RoomSearchService` riêng (không nhét vào `RoomStatusService` hiện có) vì response shape và audience khác hẳn (public browse vs admin monitoring) — tránh 1 service phải gánh 2 concern khác nhau về data-sensitivity. Có thể trích phần SQL tính `current_status` thành hàm dùng chung nếu cần, nhưng ưu tiên giữ đơn giản: viết lại 1 câu SELECT gọn hơn (không cần toàn bộ LATERAL JOIN của RMS-001, chỉ cần cột `current_status` có sẵn trực tiếp trên `rooms`, không cần join `room_events`/`room_bookings` để tính `occupancyCount`/`currentBooking` vì các field đó đã bị loại khỏi response — §0.1 FR-018).

## Complexity Tracking

Không có điểm phức tạp đáng kể — filter đơn giản trên 1 bảng `rooms` (không cần LATERAL JOIN phức tạp như RMS-001 vì không cần trả `occupancyCount`/`currentBooking`). Điểm cần chú ý: đảm bảo tất cả filter kết hợp đúng logic AND (FR-010).

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/search-rooms-query.dto.ts`, `dto/room-search-item.dto.ts`, `services/room-search.service.ts`, `tests/room-search.service.spec.ts` trong `src/modules/rooms/`.

### Phase 2: Foundational

#### T-A: DTO

- `search-rooms-query.dto.ts`: `capacityMin?: number (IsInt, Min(1))`, `capacityMax?: number (IsInt, Min(1))`, `areaName?: string`, `onlyAvailable?: boolean`, `page?: number (Min(1))`, `limit?: number (Min(1), Max(100))`.
- `room-search-item.dto.ts`: `roomId, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording`.

#### T-B: Controller shell

- Thêm `@Get('search')` vào `RoomsController` — khai TRƯỚC `:roomId/status`/`:roomId/deletion-impact` nếu có (tránh route param nuốt path tĩnh, đúng comment pattern đã có sẵn trong file).
- `@UseGuards(JwtAuthGuard)` (đã có ở class-level) — KHÔNG thêm `PermissionsGuard`/`RequirePermissions`.

#### T-C: Service shell

- `RoomSearchService.search(query: SearchRoomsQueryDto): Promise<{rooms: RoomSearchItemDto[], meta}>` — throw `NotImplementedException` tạm.

### Phase 3: Business Logic

#### T-D: Validate khoảng sức chứa

- Nếu `capacityMin` và `capacityMax` đều có và `capacityMin > capacityMax` → `BadRequestException({code:'VALIDATION_ERROR'})`.

#### T-E: Query chính

- `SELECT id, room_code, room_name, site_name, area_name, location_description, capacity, room_type, current_status, has_camera, has_microphone, has_display, allow_recording FROM rooms WHERE is_active = true AND deleted_at IS NULL AND ($1::int IS NULL OR capacity >= $1) AND ($2::int IS NULL OR capacity <= $2) AND ($3::text IS NULL OR area_name = $3) AND ($4::boolean IS NULL OR $4 = false OR current_status = 'available') ORDER BY room_code ASC LIMIT $5 OFFSET $6`
- Tham số bind đầy đủ, không nối chuỗi.

#### T-F: Đếm tổng (cho `meta.total`/`totalPages`)

- Query `COUNT(*)` cùng điều kiện WHERE (không `LIMIT/OFFSET`) — dùng cho phân trang.

#### T-G: Build response

- Map rows → `RoomSearchItemDto[]`.
- `meta.appliedFilters` = echo lại đúng query params đã dùng (FR-020).
- Nếu `rooms.length === 0` → `message` theo đúng E1; ngược lại message mặc định.

### Phase 4: Controller Wiring & Error Handling

#### T-H: Wire handler

- Thứ tự: validate DTO (T-A, T-D) → query (T-E, T-F) → build response (T-G).
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 5: Testing

#### T-I: Unit test từng filter riêng lẻ

- `capacityMin` only, `capacityMax` only, cả 2, `areaName`, `onlyAvailable=true`.

#### T-J: Unit test kết hợp AND (FR-010)

- Nhiều filter cùng lúc → chỉ trả phòng khớp TẤT CẢ.

#### T-K: Unit test empty state (E1)

- Không filter nào khớp → `rooms=[]` + message đúng nội dung E1.

#### T-L: Unit test AF-1 (xóa bộ lọc)

- Không truyền param nào → trả toàn bộ phòng active.

#### T-M: Unit test validation

- `capacityMin > capacityMax` → `VALIDATION_ERROR`.
- `page`/`limit` sai → `VALIDATION_ERROR`.

#### T-N: Unit test response không lộ field nội bộ

- Verify response KHÔNG có `occupancyCount`/`lastPresenceAt`/`noShowStatus`/`currentBooking` (FR-018, NFR-004).

#### T-O: Unit test authentication

- Không có JWT → 401. Có JWT hợp lệ, bất kỳ role nào (kể cả Employee thường) → 200 (không cần permission).

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T-E, T-G | Unit: không filter → toàn bộ, sort đúng |
| AC-002 | T-E, T-J | Unit: kết hợp nhiều filter đúng AND |
| AC-003 | T-L | Unit: AF-1 |
| AC-004 | T-K | Unit: empty state E1 |
| AC-005 | T-D | Unit: capacityMin > capacityMax |
| AC-006 | T-O | Unit: 401 |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Vô tình lộ field vận hành nội bộ nếu copy-paste nguyên `RoomStatusService` | Rò rỉ dữ liệu nhạy cảm (occupancy/no-show) cho toàn bộ nhân viên | Viết `RoomSearchService`/DTO riêng, KHÔNG import/mở rộng response của `RoomStatusService`; test T-N xác nhận |
| `current_status` lag (giới hạn kế thừa, §0.3 spec.md) gây kỳ vọng sai | Người dùng thấy phòng "trống" nhưng thực ra vừa có người vào | Đã ghi nhận là giới hạn hệ thống có sẵn, không thuộc phạm vi sửa của feature này — chỉ cần tài liệu hóa rõ (không code fix) |

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001–FR-003 | T-E | Read-only, filter active, on-demand status |
| FR-004 | T-E, T-L | Không filter → toàn bộ |
| FR-005–FR-010 | T-E, T-D | Filter + kết hợp AND |
| FR-011 | T-G | Empty state E1 |
| FR-012 | T-A, T-E, T-F | Pagination |
| FR-013–FR-016 | T-A, T-D | Validation |
| FR-017 | T-B | AuthN only, không permission |
| FR-018, FR-019 | T-A, T-E | Response shape, sort |
| FR-020 | T-G | appliedFilters |
