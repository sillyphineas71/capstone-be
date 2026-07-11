# Implementation Plan: Cập nhật thông tin phòng họp (UC-ROOM-02)

**Branch**: `029-update-room-info` | **Date**: 2026-07-09
**Spec**: spec/features/rooms/feat-update-room-info/spec.md

## Summary

Bổ sung `PATCH /api/v1/rooms/:roomId` trong module `rooms` (chưa tồn tại), cho phép Business Admin/System Admin sửa `roomName, siteName, areaName (bắt buộc), locationDescription, capacity, roomType, hasCamera, hasMicrophone, hasDisplay, allowRecording` của 1 phòng. Tái dùng tối đa pattern đã có ở `RoomsService.create()` (check trùng tên, transaction + audit log ngoài transaction). Thêm 1 permission mới `room.update` (SYSTEM_ADMIN + BUSINESS_ADMIN) và 1 WebSocket event mới `room.updated` (broadcast toàn cục) để đáp ứng POST-2. Không thêm bảng/cột DB, không đụng module `equipment`.

## Technical Context

**Language/Version**: TypeScript (NestJS 11)
**Primary Dependencies**: NestJS, TypeORM, class-validator, JWT, Socket.io (qua `WebsocketService` có sẵn)
**Storage**: PostgreSQL (single-row update trong transaction)
**Testing**: Jest
**Target Platform**: Node.js LTS server
**Project Type**: Web API (modular monolith)
**Performance Goals**: < 1s (thao tác đơn giản, 1 bản ghi)
**Constraints**: `roomCode`/`currentStatus`/`isActive` bất biến qua endpoint này; check trùng tên phải loại trừ chính bản ghi đang sửa; audit log fail không rollback update

## Constitution Check

| Gate | Status | Notes |
|---|---|---|
| **DB Gate** | PASS | Không thêm bảng/cột |
| **Security Gate** | PASS | `JwtAuthGuard` + `RequirePermissions('room.update')` (permission mới, seed SYSTEM_ADMIN + BUSINESS_ADMIN) |
| **Scope Gate** | PASS | Chỉ 1 endpoint của UC-ROOM-02; không đụng module `equipment`; không đổi `roomCode`/`currentStatus`/`isActive` |
| **Module Gate** | PASS | Toàn bộ code trong `src/modules/rooms/`; dùng `WebsocketService` có sẵn qua injection, không tự viết gateway mới |
| **API Gate** | PASS | Response `{success,message,data,meta}`; endpoint mới hoàn toàn (chưa có trong API_CONTRACT gốc) — cần task đồng bộ tài liệu |
| **Auth Gate** | PASS | `JwtAuthGuard`; `userId` từ `CurrentUser()` |
| **Test Gate** | PASS | Unit test cho check trùng tên loại trừ chính nó, validation, permission, WS broadcast |

## Project Structure

### Documentation (this feature)

```text
spec/features/rooms/feat-update-room-info/
├── spec.md
├── plan.md              # File này
└── tasks.md
```

### Source Code (repository root)

```text
src/modules/rooms/
├── rooms.module.ts                      # Update: không cần thêm provider mới, chỉ đảm bảo WebsocketService đã import
├── controllers/
│   └── rooms.controller.ts              # Update: thêm handler PATCH /:roomId
├── services/
│   └── rooms.service.ts                 # Update: thêm method update(), sửa checkDuplicateRoomName thêm param excludeRoomId
├── dto/
│   ├── update-room.dto.ts               # NEW: roomName/areaName/capacity required, còn lại optional
│   └── update-room-response.dto.ts      # NEW: response shape đầy đủ field phòng
└── tests/
    └── rooms.service.update.spec.ts     # NEW (hoặc thêm vào rooms.service.spec.ts có sẵn)

src/database/seeds/
└── <timestamp>-SeedRoomUpdatePermission.ts   # NEW: seed permission room.update (SYSTEM_ADMIN, BUSINESS_ADMIN)
```

**Structure Decision**: Mở rộng module `rooms` đã có. Sửa `checkDuplicateRoomName` hiện tại (private method trong `RoomsService`) để nhận thêm tham số `excludeRoomId?: string` — dùng chung cho cả `create()` (không truyền, giữ hành vi cũ) và `update()` (truyền `roomId` đang sửa), tránh trùng lặp logic.

## Complexity Tracking

Không có điểm phức tạp đáng kể — đây là update CRUD đơn giản trên 1 bản ghi. Điểm cần cẩn thận duy nhất: đảm bảo `checkDuplicateRoomName` loại trừ đúng bản ghi đang sửa (nếu quên, user không thể lưu nếu không đổi tên — false positive dễ bị bỏ sót khi test thủ công vì hay test bằng cách đổi tên khác đi).

## Implementation Phases

### Phase 1: Setup

- Tạo `dto/update-room.dto.ts`, `dto/update-room-response.dto.ts`, `tests/rooms.service.update.spec.ts` (hoặc bổ sung file test hiện có) trong `src/modules/rooms/`.

### Phase 2: Foundational

#### T-A: DTO

- `update-room.dto.ts`: `roomName: string` (required, giống `CreateRoomDto`), `areaName: string` (required — khác create, §0.2 spec.md), `siteName?/locationDescription?/roomType?/hasCamera?/hasMicrophone?/hasDisplay?/allowRecording?` (optional, giống create). **KHÔNG có** `roomCode`.
- `update-room-response.dto.ts`: đầy đủ field phòng sau update (mirror `CreateRoomResponseDto` nhưng thêm `siteName, areaName, locationDescription, roomType, hasCamera, hasMicrophone, hasDisplay, allowRecording, updatedAt`).

#### T-B: Controller shell

- Thêm `@Patch(':roomId')` vào `RoomsController`, `@UseGuards(PermissionsGuard)`, `@RequirePermissions('room.update')`, `ParseUUIDPipe` cho `roomId`, `ValidationPipe({whitelist:true, forbidNonWhitelisted:true, transform:true})`.

#### T-C: Service shell

- Thêm method `update(roomId, dto, userId, ipAddress)` vào `RoomsService` — throw `NotImplementedException` tạm.

### Phase 3: Business Logic

#### T-D: Sửa `checkDuplicateRoomName` để hỗ trợ loại trừ

- Thêm tham số optional `excludeRoomId?: string`; nếu có, thêm `.andWhere('room.id != :excludeRoomId', {excludeRoomId})` vào query builder hiện có. `create()` gọi không truyền (giữ hành vi cũ), `update()` truyền `roomId` đang sửa.

#### T-E: Check tồn tại phòng

- Query `RoomEntity` theo `roomId`, `deletedAt IS NULL` → không có → `NotFoundException({code:'ROOM_NOT_FOUND'})`.

#### T-F: Update trong transaction

- Load room hiện tại → merge field từ DTO (chỉ field có trong request — dùng `dto.field !== undefined` check thay vì destructure toàn bộ, để tránh ghi đè field không gửi thành `undefined`/`null`) → `updatedBy = userId` → `em.save()`.
- Giữ nguyên `roomCode`, `currentStatus`, `isActive`, `createdBy`, `createdAt` không đổi.

#### T-G: Audit log (ngoài transaction)

- Mirror pattern `create()`: `actionType='update'`, `entityType='room'`, `entityId=roomId`, `oldValueJson`/`newValueJson` (so sánh field trước/sau), fail không rollback.

#### T-H: WebSocket broadcast

- Sau khi lưu + audit thành công, gọi `websocketService.broadcast('room.updated', { roomId, roomName, siteName, areaName, locationDescription, capacity, roomType, hasCamera, hasMicrophone, hasDisplay, allowRecording, updatedAt })`.

### Phase 4: Controller Wiring & Error Handling

#### T-I: Wire handler

- Thứ tự: `ParseUUIDPipe` (roomId) → `ValidationPipe` (DTO) → `service.update()` (check tồn tại T-E → check trùng tên T-D → save T-F → audit T-G → broadcast T-H) → response 200.
- Catch lỗi không lường trước → `InternalServerErrorException({code:'INTERNAL_ERROR'})`.

### Phase 5: Testing

#### T-J: Unit test check trùng tên loại trừ chính nó

- Test: không đổi tên → không lỗi trùng (loại trừ đúng `excludeRoomId`).
- Test: đổi tên trùng phòng KHÁC → lỗi `ROOM_NAME_ALREADY_EXISTS`.
- Test: `create()` vẫn hoạt động đúng như cũ (không truyền `excludeRoomId` không phá hành vi cũ).

#### T-K: Unit test validation

- `roomName`/`areaName` rỗng → `VALIDATION_ERROR`.
- `capacity` ≤ 0 hoặc > 1000 → `VALIDATION_ERROR`.
- Nhiều lỗi cùng lúc → trả đủ danh sách lỗi (FR-022).

#### T-L: Unit test not-found/permission

- `roomId` không tồn tại/soft-deleted → `ROOM_NOT_FOUND`.
- Không có `room.update` → 403 `PERMISSION_DENIED`.

#### T-M: Unit test field preservation

- Update chỉ `capacity` → `roomCode`/`currentStatus`/`isActive`/`createdBy`/`createdAt` không đổi.
- Gửi kèm `roomCode` khác trong body → bị whitelist loại, không áp dụng.

#### T-N: Unit test WebSocket broadcast

- Update thành công → `websocketService.broadcast` được gọi đúng 1 lần với đúng event name + payload.
- Update thất bại (validation/not-found/trùng tên) → `broadcast` KHÔNG được gọi.

#### T-O: Unit test seed permission

- Seed tạo đúng `room.update`, gán đúng `SYSTEM_ADMIN` + `BUSINESS_ADMIN`.

## Acceptance Criteria Traceability

| AC ID | Implementation Tactic | Verification |
|---|---|---|
| AC-001 | T-F, T-G, T-H, T-I | Unit: happy path đầy đủ |
| AC-002 | T-F (không đụng room_bookings) | Unit: booking không đổi sau update |
| AC-003 | T-D | Unit: không đổi tên → không lỗi trùng |
| AC-004 | T-A (DTO validation) | Unit: roomName rỗng |
| AC-005 | T-A (DTO validation) | Unit: areaName rỗng |
| AC-006 | T-A (DTO validation) | Unit: capacity âm |
| AC-007 | T-D | Unit: trùng tên phòng khác |
| AC-008 | T-B (guard) | Unit: thiếu permission |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Quên loại trừ chính bản ghi khi check trùng tên | User không thể lưu nếu không đổi tên — bug dễ lọt qua test thủ công (hay test bằng tên khác) | Unit test T-J riêng cho case "không đổi tên" |
| Merge field partial sai cách (ghi đè field không gửi thành null) | Mất dữ liệu field optional không có trong request | T-F dùng `dto.field !== undefined` check, có unit test T-M xác nhận field không gửi được giữ nguyên |
| WebSocket broadcast toàn cục có thể gây nhiễu nếu tần suất update cao | Không phải rủi ro lớn ở quy mô capstone — ghi nhận, không cần rate-limit ở MVP | Không xử lý thêm, out of scope |

## Requirements Coverage

| Requirement ID | Task(s) | Description |
|---|---|---|
| FR-001–FR-003 | T-F | Field cho phép sửa/giữ nguyên, BR2 |
| FR-004, FR-014, FR-015 | T-B (guard có sẵn) | AuthN/AuthZ |
| FR-005, FR-016 | T-E | ROOM_NOT_FOUND |
| FR-006, FR-021, FR-024, FR-027 | T-D | Check trùng tên loại trừ chính nó |
| FR-007 | T-F | Transaction |
| FR-008, FR-025 | T-G | Audit log |
| FR-009, FR-026 | T-H | WebSocket broadcast |
| FR-010 | T-I | Response envelope |
| FR-011 | T-A (whitelist) | roomCode bị bỏ qua |
| FR-012, FR-013 | T-F | Partial-safe cho field optional |
| FR-017–FR-022 | T-A | Validation |
| FR-023 | T-B | Permission |
| NFR-004, NFR-005 | T-F, T-G | Transaction + audit fail-separate |
