# Feature Specification: Cập nhật thông tin phòng họp

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-09 | Tạo spec lần đầu cho UC-ROOM-02. Đã chốt 3 điểm mơ hồ (field "Vị trí", phạm vi "thiết bị tiện ích", roomCode có sửa được không) cùng người dùng trước khi viết — xem §0. | Toàn bộ file |

---

- **Feature ID**: ROOM-UPDATE-ROOM-INFO-001
- **Feature Name**: Cập nhật thông tin phòng họp (Update Room Info)
- **Use Case**: UC-ROOM-02
- **Module / Domain**: rooms
- **Created Date**: 2026-07-09
- **Status**: Draft
- **Source Documents**:
  - Đặc tả UC-ROOM-02 do người dùng cung cấp.
  - `src/modules/rooms/services/rooms.service.ts`, `src/modules/rooms/dto/create-room.dto.ts`, `src/modules/rooms/controllers/rooms.controller.ts` — pattern tạo phòng đã có, tái dùng tối đa.
  - `src/modules/rooms/entities/room.entity.ts` — schema thật.
  - `src/modules/websocket/websocket.service.ts` — hạ tầng broadcast realtime đã có.
  - `spec/features/rooms/feat-room-realtime-status/spec.md` — tiền lệ sự kiện `room.status.updated`.
  - `CLAUDE.md` (root backend).

---

## 0. RECON — Đối chiếu nguồn + quyết định đã chốt cùng người dùng

### 0.1. Endpoint chưa tồn tại — code mới hoàn toàn

[`rooms.controller.ts`](../../../../src/modules/rooms/controllers/rooms.controller.ts) hiện chỉ có `POST /rooms` (tạo) và 2 endpoint `GET` (trạng thái realtime). **Không có `PATCH /rooms/:id`**. Đây là feature bổ sung mới, không phải mở rộng logic có sẵn — nhưng có thể tái dùng gần như toàn bộ pattern từ `RoomsService.create()`: transaction, audit log ghi ngoài transaction (fail không rollback), check trùng tên (`checkDuplicateRoomName`).

### 0.2. Field "Vị trí" bắt buộc (EX1) — đã chốt: `areaName`

`RoomEntity` có 3 field vị trí (`siteName`, `areaName`, `locationDescription`), cả 3 đều optional ở `CreateRoomDto`. **Quyết định đã duyệt cùng người dùng**: field "Vị trí" trong UC-ROOM-02 map vào `areaName` (khớp ví dụ trong Trigger UC gốc: "thay đổi vị trí tầng làm việc"). `areaName` trở thành **bắt buộc riêng cho update** (khác với create, nơi field này vẫn optional) — đây là chủ ý, không phải lỗi thiết kế, ghi rõ để tránh nhầm lẫn khi đối chiếu 2 luồng. `siteName`/`locationDescription` vẫn optional.

### 0.3. "Danh mục thiết bị tiện ích" — đã chốt: 4 cờ boolean trên `rooms`

Có 2 khả năng: (A) 4 cờ boolean có sẵn trên `RoomEntity` (`hasCamera`, `hasMicrophone`, `hasDisplay`, `allowRecording`); (B) gán/gỡ thiết bị vật lý thật qua bảng `equipments` (`current_room_id`, module `equipment` riêng theo `CLAUDE.md` §4.2). **Quyết định đã duyệt**: chọn (A) — giữ tính năng gọn trong module `rooms`, không đụng module `equipment` (đúng nguyên tắc "không tự ý mở rộng scope"). Nếu sau này cần (B), tách thành feature riêng ở module `equipment`.

### 0.4. `roomCode` — đã chốt: bất biến, không cho sửa qua endpoint này

UC gốc không nhắc `roomCode` trong Normal Flow (chỉ Tên/Vị trí/Sức chứa/Thiết bị). **Quyết định đã duyệt**: `roomCode` không nằm trong `UpdateRoomDto` — nếu FE lỡ gửi field này trong body, `ValidationPipe({whitelist:true})` sẽ tự động loại bỏ (không lỗi, không áp dụng) theo đúng convention `CLAUDE.md` §13.2 đã dùng cho toàn bộ DTO khác.

### 0.5. Realtime sync (POST-2) — tái dùng hạ tầng WebSocket có sẵn

[`WebsocketService.broadcast(event, data)`](../../../../src/modules/websocket/websocket.service.ts:50) đã có sẵn, dùng cho admin broadcast toàn cục. Tiền lệ: `room.status.updated` ([feat-room-realtime-status](../feat-room-realtime-status/spec.md)) phát khi `current_status` đổi. **Quyết định**: bổ sung sự kiện mới `room.updated` (không trùng `room.status.updated` — sự kiện đó dành riêng cho thay đổi trạng thái occupied/available, không phải thay đổi thông tin tĩnh), phát qua `broadcast()` toàn cục (không giới hạn theo room-channel cụ thể) vì "lưới lịch phòng họp" là view tổng quan nhiều phòng cùng lúc, mọi client cần nhận được.

### 0.6. Permission mới: `room.update`

Không có permission `room.update` trong seed hiện tại (chỉ có `room.create`, `room.noshow.*`, `room.early_vacancy.configure`, `room.utilization.read`). **Quyết định**: seed permission mới `room.update`, `moduleCode: 'rooms'`, `actionCode: 'update'`, `roles: ['SYSTEM_ADMIN', 'BUSINESS_ADMIN']` — khớp chính xác Primary Actor "Business Admin" của UC-ROOM-02 và nhất quán với `room.create` (cùng role set).

### 0.7. BR2 (không ảnh hưởng booking đã đặt) — xác nhận tự động thỏa mãn

`RoomBookingEntity` chỉ có FK `roomId`, **không denormalize** `roomName`/`capacity`/thiết bị của phòng. Do đó update thông tin phòng (không đổi `id`, không xóa/soft-delete phòng) **không cần logic cascade nào** — BR2 tự động thỏa mãn bởi thiết kế schema hiện tại. Ghi rõ ở đây để không ai hiểu nhầm là cần thêm bước đồng bộ.

### 0.8. Ngữ nghĩa "form đầy đủ" thay vì "patch từng phần"

Normal Flow UC-ROOM-02 mô tả: hệ thống hiển thị **biểu mẫu chứa sẵn toàn bộ thông tin hiện hành**, người dùng sửa rồi nhấn "Lưu thay đổi" — đây là hành vi **gửi lại toàn bộ form** (như create), không phải PATCH thưa từng field lẻ tẻ kiểu REST partial-update. **Quyết định**: `UpdateRoomDto` yêu cầu `roomName`, `areaName`, `capacity` là **bắt buộc** (giống mức độ bắt buộc ở `CreateRoomDto`, chỉ thêm `areaName` từ optional thành required — §0.2); các field còn lại (`siteName`, `locationDescription`, `roomType`, `hasCamera`, `hasMicrophone`, `hasDisplay`, `allowRecording`) vẫn optional — nếu không gửi thì giữ nguyên giá trị cũ (an toàn cho client cũ/thiếu field).

### 0.9. Field/entity xác nhận tồn tại thật

- `RoomEntity`: `id, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording, isActive, createdBy, updatedBy, createdAt, updatedAt, deletedAt` ([room.entity.ts](../../../../src/modules/rooms/entities/room.entity.ts)).
- `AuditLogEntity` — tái dùng pattern ghi audit của `RoomsService.create()` (ngoài transaction, fail không rollback).
- **Không có bảng/cột nào cần thêm** — chỉ thêm 1 permission mới (`room.update`) và 1 WebSocket event mới (`room.updated`, không phải DB).

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `rooms`, bổ sung thao tác Update còn thiếu bên cạnh Create đã có. Read-modify-write đơn giản trên 1 bản ghi `rooms`, không phát sinh side-effect nghiệp vụ phức tạp (không đụng booking, không đụng meeting).

### 1.2 Mục tiêu

Cho phép Business Admin (và System Admin) chỉnh sửa tên, vị trí, sức chứa, 4 cờ tiện ích của 1 phòng họp đã tồn tại, đảm bảo tên phòng luôn duy nhất toàn hệ thống, và toàn bộ client đang mở giao diện lưới lịch phòng thấy thay đổi ngay lập tức qua WebSocket.

### 1.3 Giá trị mang lại

- Giữ dữ liệu phòng họp khớp với thực tế vận hành (đổi tên, đổi sức chứa khi thêm/bớt ghế, đổi vị trí).
- Tránh nhầm lẫn đặt phòng do tên trùng lặp (BR1).
- Không làm gián đoạn các cuộc họp đã lên lịch tại phòng đó (BR2).

### 1.4 Giả định

- `roomCode` bất biến qua endpoint này (§0.4).
- "Vị trí" = `areaName`, bắt buộc riêng cho update (§0.2).
- "Thiết bị tiện ích" = 4 cờ boolean có sẵn trên `rooms`, không đụng module `equipment` (§0.3).
- Endpoint không đổi `currentStatus`/`isActive` — đó là 2 khái niệm khác (trạng thái occupied/available theo thời gian thực, và bật/tắt phòng) không thuộc phạm vi UC-ROOM-02 (UC không nhắc "kích hoạt/vô hiệu hóa phòng").
- WebSocket broadcast toàn cục (không phân kênh theo phòng) — đúng với việc "lưới lịch phòng họp" hiển thị nhiều phòng cùng lúc.

### 1.5 Clarifications Resolved

Tổng hợp tại §0.2, §0.3, §0.4 (đã chốt qua trao đổi trực tiếp với người dùng trước khi viết spec này).

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Business Admin | Quản trị viên doanh nghiệp | Sửa thông tin bất kỳ phòng họp nào |
| System Admin | Quản trị viên hệ thống | Tương đương Business Admin ở tính năng này (nhất quán `room.create`) |

### 2.2 Role & Permission Rules

- Permission bắt buộc: `room.update` (mới, §0.6), seed cho `SYSTEM_ADMIN`, `BUSINESS_ADMIN`.
- Không có khái niệm scope theo phòng ban cho tính năng này (phòng họp là tài nguyên dùng chung toàn công ty, không sở hữu theo phòng ban — nhất quán các feature `analytics` đã làm trước đó).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập và có permission `room.update`.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL chỉ cho phép cập nhật các field: `roomName, siteName, areaName, locationDescription, capacity, roomType, hasCamera, hasMicrophone, hasDisplay, allowRecording` qua endpoint này — KHÔNG cho sửa `roomCode`, `currentStatus`, `isActive` (§0.3, §0.4).

FR-002: THE system SHALL giữ nguyên `id`, `roomCode`, `createdBy`, `createdAt`, `currentStatus`, `isActive` không đổi qua thao tác update.

FR-003: THE system SHALL không thực hiện bất kỳ thay đổi nào lên `room_bookings`/`meetings` liên quan đến phòng đó khi update (BR2, §0.7 — tự động thỏa mãn do thiết kế schema, không cần code cascade).

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi `PATCH /api/v1/rooms/:roomId`, THE system SHALL kiểm tra authentication và permission `room.update` trước khi xử lý logic khác.

FR-005: WHEN `roomId` không tồn tại hoặc đã soft-delete (`deletedAt IS NOT NULL`), THE system SHALL trả về 404, error code `ROOM_NOT_FOUND`.

FR-006: WHEN dữ liệu đầu vào hợp lệ, THE system SHALL kiểm tra `roomName` (sau khi sửa) không trùng (case-insensitive, trim) với bất kỳ phòng nào khác chưa soft-delete, **loại trừ chính `roomId` đang sửa** (BR1, §0.9).

FR-007: WHEN mọi kiểm tra hợp lệ, THE system SHALL lưu thay đổi trong 1 transaction, cập nhật `updatedBy = currentUser.id`, `updatedAt = now()`.

FR-008: WHEN lưu thành công, THE system SHALL ghi audit log (ngoài transaction chính, lỗi ghi log KHÔNG rollback update — đúng pattern `RoomsService.create()`) với `oldValueJson`/`newValueJson` đủ để biết field nào đã đổi.

FR-009: WHEN lưu thành công, THE system SHALL phát WebSocket event `room.updated` (broadcast toàn cục) chứa thông tin phòng mới nhất (POST-2, §0.5).

FR-010: WHEN lưu thành công, THE system SHALL trả về response 200 chứa đầy đủ thông tin phòng sau khi cập nhật và `message`: "Cập nhật thông tin phòng họp thành công".

### 3.3 State-driven Requirements

FR-011: WHILE xử lý request, THE system SHALL bỏ qua field `roomCode` nếu client có gửi trong body (không lỗi — bị `ValidationPipe({whitelist:true})` tự loại, §0.4).

### 3.4 Optional Feature Requirements

FR-012: WHERE `siteName`/`locationDescription`/`roomType`/`hasCamera`/`hasMicrophone`/`hasDisplay`/`allowRecording` được cung cấp trong request, THE system SHALL cập nhật đúng giá trị đó.

FR-013: WHERE các field ở FR-012 KHÔNG có trong body, THE system SHALL giữ nguyên giá trị hiện tại của phòng (không reset về default/null).

### 3.5 Unwanted Behavior Requirements

FR-014: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-015: IF người dùng không có permission `room.update`, THEN THE system SHALL trả về 403, error code `PERMISSION_DENIED`.

FR-016: IF `roomId` không tồn tại/soft-deleted, THEN THE system SHALL trả về 404, error code `ROOM_NOT_FOUND`.

FR-017: IF `roomName` rỗng hoặc chỉ chứa khoảng trắng, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR` (EX1).

FR-018: IF `areaName` rỗng hoặc chỉ chứa khoảng trắng, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR` (EX1, §0.2).

FR-019: IF `capacity` không phải số nguyên dương (≤ 0, không phải số nguyên, hoặc là chữ), THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR` (EX2).

FR-020: IF `capacity` vượt quá 1000 (giữ đúng giới hạn trên đã áp dụng ở `CreateRoomDto`), THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-021: IF `roomName` sau khi sửa trùng (case-insensitive, trim) với 1 phòng KHÁC (không phải chính `roomId` đang sửa) chưa soft-delete, THEN THE system SHALL trả về 409, error code `ROOM_NAME_ALREADY_EXISTS`, message: "Tên phòng họp này đã tồn tại. Vui lòng chọn một tên gọi khác." (EX3).

FR-022: IF request chứa nhiều lỗi validation cùng lúc (vd `roomName` rỗng VÀ `capacity` âm), THEN THE system SHALL trả về toàn bộ danh sách lỗi trong 1 response 400 duy nhất (hành vi mặc định của `class-validator`), không chỉ báo lỗi đầu tiên tìm thấy.

### 3.6 Authorization Requirements

FR-023: WHEN người dùng thực hiện update phòng, THE system SHALL verify authentication và authorization (`room.update`) trước khi thực thi bất kỳ truy vấn/ghi nào.

### 3.7 Data & State Requirements

FR-024: WHEN kiểm tra trùng tên (FR-006), THE system SHALL loại trừ chính `roomId` đang được sửa khỏi tập kết quả so khớp (khác `checkDuplicateRoomName` gốc dùng cho create — cần thêm điều kiện `AND room.id != :roomId`).

FR-025: WHEN ghi audit log (FR-008), THE system SHALL lưu `actionType='update'`, `entityType='room'`, `entityId=roomId`, `oldValueJson` (giá trị trước khi sửa) và `newValueJson` (giá trị sau khi sửa) của các field đã đổi.

### 3.8 Notification / Audit Requirements

FR-026: WHEN update thành công, THE system SHALL emit WebSocket event `room.updated` với payload tối thiểu: `{ roomId, roomName, siteName, areaName, locationDescription, capacity, roomType, hasCamera, hasMicrophone, hasDisplay, allowRecording, updatedAt }`.

### 3.9 Complex / Combined Requirements

FR-027: WHILE `roomName` mới trùng với chính tên hiện tại của phòng đang sửa (người dùng không đổi tên, chỉ đổi field khác), THE system SHALL KHÔNG coi đây là trùng lặp (FR-024 đã loại trừ chính nó) — cho phép lưu bình thường.

### 3.10 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-ROOM-02 POST-1, BR2 |
| FR-004–FR-010 | Event-driven | UC-ROOM-02 Normal Flow bước 1-9 |
| FR-011 | State-driven | §0.4 |
| FR-012, FR-013 | Optional Feature | Normal Flow bước 4 |
| FR-014–FR-022 | Unwanted Behavior | UC-ROOM-02 EX1, EX2, EX3 |
| FR-023 | Authorization | PRE-1 |
| FR-024, FR-025 | Data & State | BR1, audit convention |
| FR-026 | Notification/Audit | POST-2 |
| FR-027 | Complex | BR1 edge case |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL xử lý request update trong vòng dưới 1 giây trong điều kiện tải bình thường (thao tác đơn giản, 1 bản ghi).

### 4.2 Security

NFR-002: THE system SHALL yêu cầu authentication cho mọi request.
NFR-003: THE system SHALL dùng parameterized query cho mọi truy vấn check trùng tên (không nối chuỗi SQL với input người dùng).

### 4.3 Reliability & Consistency

NFR-004: THE system SHALL đảm bảo việc lưu thay đổi phòng là atomic (transaction) — không xảy ra trạng thái nửa cập nhật.
NFR-005: THE system SHALL đảm bảo audit log fail KHÔNG làm rollback thao tác update chính (đúng pattern `RoomsService.create()`).

### 4.4 Usability

NFR-006: THE system SHALL trả về danh sách lỗi validation rõ ràng theo từng field (không chỉ 1 thông báo chung chung), để FE có thể bôi đỏ đúng field lỗi (EX1, EX2).

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `rooms` | Bản ghi được update | Không thêm cột mới |
| `audit_logs` | Ghi log thay đổi | Tái dùng pattern `create()` |

### 5.2 Dữ liệu đầu vào

`PATCH /api/v1/rooms/:roomId`

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| roomId (path param) | UUID | Có | Phòng cần sửa | UUID hợp lệ, tồn tại, chưa soft-delete |
| roomName | string | Có | Tên phòng | Không rỗng, max 255 ký tự |
| siteName | string | Không | Tòa nhà | max 255 ký tự |
| areaName | string | **Có** (§0.2) | Vị trí/khu vực/tầng | Không rỗng, max 255 ký tự |
| locationDescription | string | Không | Mô tả vị trí tự do | Không giới hạn cụ thể (giữ như create) |
| capacity | number | Có | Sức chứa tối đa | Số nguyên, 1 ≤ x ≤ 1000 |
| roomType | enum | Không | Loại phòng | `meeting_room\|training_room\|board_room\|open_space` |
| hasCamera | boolean | Không | Có camera | boolean |
| hasMicrophone | boolean | Không | Có microphone | boolean |
| hasDisplay | boolean | Không | Có màn hình | boolean |
| allowRecording | boolean | Không | Cho phép ghi hình | boolean |

**Không nhận**: `roomCode`, `currentStatus`, `isActive` (bị `ValidationPipe({whitelist:true})` loại nếu client gửi — §0.4, FR-011).

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| id | uuid | |
| roomCode | string | Không đổi |
| roomName | string | Đã cập nhật |
| siteName | string \| null | |
| areaName | string | Đã cập nhật (bắt buộc) |
| locationDescription | string \| null | |
| capacity | number | Đã cập nhật |
| roomType | enum | |
| currentStatus | enum | Không đổi qua endpoint này |
| hasCamera/hasMicrophone/hasDisplay/allowRecording | boolean | Đã cập nhật nếu có gửi |
| isActive | boolean | Không đổi |
| updatedAt | datetime | Thời điểm cập nhật |

### 5.4 Data Constraints

- Không ghi/sửa bảng nào khác ngoài `rooms` (+ `audit_logs`).
- Không thêm bảng/cột — chỉ thêm 1 permission mới (`room.update`, không phải DB schema) và 1 WebSocket event mới (không phải DB).

### 5.5 Data-related EARS Requirements

FR-DATA-001: WHEN kiểm tra trùng tên cho update, THE system SHALL dùng query tương tự `checkDuplicateRoomName` hiện có nhưng thêm điều kiện `AND room.id != :roomId` để loại trừ chính bản ghi đang sửa.

### 5.6 Cần làm rõ

- **CL-1**: `locationDescription` không có giới hạn `MaxLength` rõ ràng ở `CreateRoomDto` hiện tại (chỉ `@IsString()`) — giữ nguyên hành vi này cho update, không tự ý thêm giới hạn mới ngoài yêu cầu.
- **CL-2**: UC không đề cập việc đổi `roomType` — đã đưa vào danh sách field optional có thể sửa (nhất quán với create, vì `roomType` cũng là "thông tin chi tiết phòng họp" theo tinh thần Description UC), nhưng nên xác nhận nếu nghiệp vụ muốn loại trừ field này khỏi update.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `roomName` rỗng/toàn khoảng trắng, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `areaName` rỗng/toàn khoảng trắng, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `capacity` không phải số nguyên dương hoặc vượt 1000, THEN 400 `VALIDATION_ERROR`.
ERR-004: IF `roomType` không thuộc enum hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-005: IF `roomId` không phải UUID hợp lệ, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication / Authorization Errors

ERR-006: IF chưa đăng nhập, THEN 401.
ERR-007: IF không có permission `room.update`, THEN 403 `PERMISSION_DENIED`.

### 6.3 Business Rule Errors

ERR-008: IF `roomId` không tồn tại/soft-deleted, THEN 404 `ROOM_NOT_FOUND`.
ERR-009: IF `roomName` trùng phòng khác, THEN 409 `ROOM_NAME_ALREADY_EXISTS`.

### 6.4 System Errors

ERR-010: IF lỗi hệ thống không lường trước, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Business Admin đã đăng nhập và phòng "P101" tồn tại,
When gửi PATCH với `roomName="Phòng Hội đồng"`, `areaName="Tầng 5"`, `capacity=20`,
Then hệ thống lưu thành công, trả về 200 kèm thông tin mới, phát WebSocket `room.updated`, và message "Cập nhật thông tin phòng họp thành công".

AC-002:
Given phòng "P101" đang có booking đã duyệt trong tương lai,
When Business Admin đổi tên phòng "P101" thành "P101-New",
Then booking đó vẫn giữ nguyên trạng thái, không bị hủy/ảnh hưởng (BR2).

AC-003:
Given người dùng không đổi `roomName` (giữ nguyên tên cũ), chỉ đổi `capacity`,
When gửi PATCH,
Then hệ thống KHÔNG báo lỗi trùng tên (loại trừ chính nó — FR-024/FR-027), lưu thành công.

### 7.2 Validation & Business Rule Cases

AC-004:
Given `roomName` để trống trong request,
When gửi PATCH,
Then hệ thống trả 400 `VALIDATION_ERROR` (EX1), không lưu thay đổi.

AC-005:
Given `areaName` để trống trong request,
When gửi PATCH,
Then hệ thống trả 400 `VALIDATION_ERROR` (EX1).

AC-006:
Given `capacity = -5`,
When gửi PATCH,
Then hệ thống trả 400 `VALIDATION_ERROR` (EX2).

AC-007:
Given tên mới trùng (case-insensitive) với 1 phòng khác đang tồn tại,
When gửi PATCH,
Then hệ thống trả 409 `ROOM_NAME_ALREADY_EXISTS` (EX3), giữ nguyên dữ liệu cũ.

AC-008:
Given người dùng không có permission `room.update`,
When gửi PATCH,
Then hệ thống trả 403 `PERMISSION_DENIED`.

### 7.3 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-004–FR-010, FR-026 |
| AC-002 | FR-003 |
| AC-003 | FR-024, FR-027 |
| AC-004 | FR-017, ERR-001 |
| AC-005 | FR-018, ERR-002 |
| AC-006 | FR-019, ERR-003 |
| AC-007 | FR-021, ERR-009 |
| AC-008 | FR-015, ERR-007 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Gán/gỡ thiết bị vật lý thật (`equipments`, module `equipment`) — chỉ 4 cờ boolean trên `rooms` (§0.3).
- Sửa `roomCode` — bất biến sau khi tạo (§0.4).
- Đổi `currentStatus` (occupied/available/...) hoặc `isActive` (kích hoạt/vô hiệu hóa phòng) — 2 khái niệm khác, không thuộc UC-ROOM-02.
- Xóa phòng (soft-delete) — use case riêng.
- Lịch sử thay đổi hiển thị trên UI (chỉ ghi `audit_logs`, không có endpoint xem lại lịch sử trong phạm vi feature này).

### 8.2 Có thể xem xét ở feature khác

- Feature quản lý gán thiết bị thật cho phòng (module `equipment`).
- Feature bật/tắt phòng (deactivate room).
- Feature xem lịch sử thay đổi phòng (đọc `audit_logs` theo `entityType='room'`).

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT allow editing roomCode via this endpoint.
OOS-002: THE system SHALL NOT allow editing currentStatus or isActive via this endpoint.
OOS-003: THE system SHALL NOT implement equipment asset assignment (equipments table) as part of this feature.
OOS-004: THE system SHALL NOT create new database tables or columns for this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, authorization, business rule, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới (chỉ 1 permission + 1 WS event).
- [x] Các điểm thiếu thông tin đưa vào mục 5.6 "Cần làm rõ".
- [x] 3 điểm mơ hồ chính đã chốt cùng người dùng trước khi viết (§0.2, §0.3, §0.4).
