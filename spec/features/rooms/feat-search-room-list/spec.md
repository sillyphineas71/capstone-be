# Feature Specification: Xem & Tìm kiếm Danh sách Phòng

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-07-09 | Tạo spec lần đầu cho UC-ROOM-04. Đã chốt 2 điểm mơ hồ (endpoint mới vs mở rộng RMS-001, ngữ nghĩa "Trống") cùng người dùng trước khi viết — xem §0. | Toàn bộ file |

---

- **Feature ID**: ROOM-SEARCH-LIST-001
- **Feature Name**: Xem & Tìm kiếm Danh sách Phòng (Search & List Rooms)
- **Use Case**: UC-ROOM-04 (đổi tên từ UC-RM-04, định hình lại thành List/Read use case theo "Other Information")
- **Module / Domain**: rooms
- **Created Date**: 2026-07-09
- **Status**: Draft
- **Source Documents**:
  - Đặc tả UC-ROOM-04 do người dùng cung cấp.
  - `src/modules/rooms/services/room-status.service.ts` (RMS-001/UC-36 — engine tính `current_status` real-time, tái dùng query pattern).
  - `src/modules/meetings/controllers/meetings.controller.ts:458` (`GET /rooms/available` — tiền lệ permission mở cho mọi user đã đăng nhập, khác mục đích: time-range availability cho việc đặt phòng, không phải browse catalog).
  - `src/modules/rooms/entities/room.entity.ts`.
  - `CLAUDE.md` (root backend).

---

## 0. RECON — Đối chiếu nguồn + quyết định đã chốt cùng người dùng

### 0.1. Đã có 2 endpoint liên quan — không cái nào khớp hẳn

- [`RoomStatusService.getRealtimeStatus()`](../../../../src/modules/rooms/services/room-status.service.ts:96) (RMS-001/UC-36, `GET /rooms/realtime-status`) — đã tính sẵn `current_status` real-time đúng nhu cầu BR-01, filter `siteName`/`areaName`. Nhưng: permission `room.utilization.read` chỉ cho `SYSTEM_ADMIN/MANAGER/BUSINESS_ADMIN` (không có Employee); không có filter sức chứa; response có field vận hành nội bộ (`occupancyCount`, `lastPresenceAt`, `noShowStatus`) không phù hợp lộ ra toàn bộ nhân viên.
- `GET /rooms/available` (nằm trong `meetings.controller.ts`, không phải `rooms.controller.ts`) — chỉ `JwtAuthGuard`, mở cho mọi user đã đăng nhập, nhưng bắt buộc `startTime`+`endTime` (kiểm tra trống cho 1 khung giờ cụ thể, phục vụ tạo cuộc họp), không có filter vị trí, không có khái niệm "trạng thái hiện tại".

**Quyết định đã duyệt cùng người dùng**: tạo **endpoint mới** `GET /api/v1/rooms/search`, tái dùng query/lateral-join pattern của `RoomStatusService` (tính `current_status`) nhưng: (a) chỉ `JwtAuthGuard`, không permission riêng — mở cho mọi Employee đã đăng nhập (nhất quán tiền lệ `rooms/available`); (b) thêm filter sức chứa (khoảng); (c) response CHỈ trả field catalog phù hợp browse chung, KHÔNG trả `occupancyCount`/`lastPresenceAt`/`noShowStatus` (dữ liệu vận hành nội bộ, theo nguyên tắc `CLAUDE.md` §20.2 "dữ liệu nhạy cảm cần kiểm tra quyền kỹ hơn").

### 0.2. Ngữ nghĩa "Trạng thái: Trống" — đã chốt: trạng thái hiện tại, không có date/time picker

Sản phẩm thực tế (Robin) thường gắn "trống" với 1 khung giờ người dùng chọn. Nhưng văn bản UC-ROOM-04 **không nhắc tiêu chí ngày/giờ** trong Normal Flow, và BR-01 nhấn mạnh rõ "chính xác **tại thời điểm người dùng thực hiện tìm kiếm**". **Quyết định đã duyệt**: "Trống" = `rooms.current_status = 'available'` tại thời điểm gọi API — KHÔNG thêm date/time picker. Khi người dùng thực sự muốn đặt phòng cho 1 khung giờ cụ thể, họ chuyển sang luồng đã có sẵn (`GET /rooms/available`, cần `startTime`/`endTime`) — màn hình UC-ROOM-04 chỉ là bước duyệt/preview nhẹ trước đó, không thay thế luồng đặt phòng.

### 0.3. Giới hạn kế thừa: `current_status` có thể lag

Đã ghi nhận sẵn trong changelog RMS-001: `current_status` có thể lag (phòng vừa trống nhưng hệ thống occupancy chưa kịp cập nhật). Đây là giới hạn hệ thống **đã biết từ trước**, không phải vấn đề phát sinh mới cần giải quyết trong feature này — chỉ kế thừa nguyên trạng.

### 0.4. "Vị trí (dropdown tầng)" — chỉ filter theo `areaName`, không thêm `siteName`

UC chỉ nhắc "Vị trí (chọn từ dropdown tầng)" — map đúng 1 field `areaName` (tầng/khu vực), KHÔNG mở rộng thêm `siteName` (tòa nhà) dù `RoomEntity` có sẵn field này — giữ đúng phạm vi UC, tránh tự ý mở rộng. Dropdown giá trị tầng: FE tự suy ra từ tập kết quả trả về (danh sách `areaName` distinct), KHÔNG cần thêm endpoint riêng liệt kê tầng (catalog phòng họp quy mô nhỏ, không cần tối ưu riêng).

### 0.5. Field/entity xác nhận tồn tại thật

- `RoomEntity`: `id, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording, isActive, deletedAt` — đủ cho response catalog.
- `RoomStatusService` LATERAL JOIN pattern (occupancy/booking hiện tại) — tái dùng phần tính `currentStatus`, KHÔNG tái dùng phần trả `occupancyCount`/`lastPresenceAt`/`currentBooking` chi tiết (out of scope, §0.1).
- **Không có bảng/cột nào cần thêm** — không permission mới (chỉ cần đăng nhập), không migration.

---

## 1. Context & Goal

### 1.1 Bối cảnh

Tính năng thuộc module `rooms`, phục vụ TOÀN BỘ nhân viên (không riêng admin) duyệt/tìm phòng phù hợp trước khi đặt. Đây là bước "khám phá" (discovery), khác với bước "đặt phòng thật" (đã có ở `meetings`/`scheduling`). Read-only tuyệt đối.

### 1.2 Mục tiêu

Cho phép Employee/Business Admin lọc danh sách phòng theo sức chứa (khoảng), vị trí (tầng), và trạng thái trống hiện tại, hiển thị kết quả khớp tất cả điều kiện đã chọn, có thể xóa bộ lọc để xem lại toàn bộ danh mục.

### 1.3 Giá trị mang lại

- Nhân viên tự tìm phòng phù hợp nhanh chóng thay vì dò thủ công qua danh sách dài.
- Giảm tải cho admin (không cần hỏi/tư vấn phòng nào còn trống).

### 1.4 Giả định

- "Trống" = trạng thái hiện tại (`current_status='available'`), không gắn khung giờ tương lai (§0.2).
- Chỉ liệt kê phòng `isActive=true` và chưa soft-delete (`deletedAt IS NULL`) — phòng đã xóa (UC-ROOM-03) hoặc đã vô hiệu hóa không xuất hiện trong catalog duyệt/đặt.
- Không phân trang phức tạp — catalog phòng họp quy mô công ty thường nhỏ (hàng chục đến ~100), áp dụng pagination nhẹ theo convention chung (`CLAUDE.md` §8.4) chỉ để nhất quán, không phải nhu cầu thực tế bắt buộc.
- Không cần filter theo thiết bị tiện ích (camera/mic/display) — UC không nhắc, không tự ý thêm.

### 1.5 Clarifications Resolved

Tổng hợp tại §0.1, §0.2 (đã chốt qua trao đổi trực tiếp với người dùng trước khi viết spec này).

---

## 2. Actor & Roles

### 2.1 Danh sách actor

| Actor | Vai trò trong tính năng | Quyền / Trách nhiệm chính |
|---|---|---|
| Employee | Nhân viên | Xem/lọc toàn bộ danh mục phòng, như mọi actor khác (không giới hạn scope) |
| Business Admin | Quản trị viên doanh nghiệp | Tương đương Employee ở tính năng này (không có dữ liệu/quyền đặc biệt thêm) |

### 2.2 Role & Permission Rules

- Không yêu cầu permission riêng — chỉ cần `JwtAuthGuard` (đã đăng nhập), nhất quán tiền lệ `GET /rooms/available` (§0.1).
- Không có khái niệm scope theo phòng ban — phòng họp là tài nguyên dùng chung toàn công ty (nhất quán các feature `rooms`/`analytics` trước đó).

### 2.3 Actor Constraints

- Người dùng phải đăng nhập.

---

## 3. Functional Requirements

### 3.1 Ubiquitous Requirements

FR-001: THE system SHALL trả về dữ liệu dưới dạng read-only tuyệt đối — không tạo/sửa/xóa bất kỳ bản ghi nào.

FR-002: THE system SHALL chỉ liệt kê phòng có `isActive = true` và `deletedAt IS NULL`.

FR-003: THE system SHALL tính `currentStatus` on-demand tại mỗi lần gọi API (đọc trực tiếp `rooms.current_status`, không cache) — đáp ứng BR-01.

### 3.2 Event-driven Requirements

FR-004: WHEN người dùng gửi `GET /api/v1/rooms/search` không kèm bất kỳ query param nào, THE system SHALL trả về toàn bộ danh mục phòng đang active (AF-1, "Xóa Bộ lọc").

FR-005: WHEN người dùng truyền `capacityMin`, THE system SHALL chỉ trả phòng có `capacity >= capacityMin`.

FR-006: WHEN người dùng truyền `capacityMax`, THE system SHALL chỉ trả phòng có `capacity <= capacityMax`.

FR-007: WHEN người dùng truyền cả `capacityMin` và `capacityMax`, THE system SHALL áp dụng đồng thời cả 2 điều kiện (AND).

FR-008: WHEN người dùng truyền `areaName`, THE system SHALL chỉ trả phòng có `areaName` khớp chính xác giá trị đó.

FR-009: WHEN người dùng truyền `onlyAvailable=true`, THE system SHALL chỉ trả phòng có `currentStatus = 'available'` tại thời điểm gọi API.

FR-010: WHEN người dùng truyền nhiều tiêu chí cùng lúc, THE system SHALL áp dụng tất cả tiêu chí đồng thời (AND) — đúng Normal Flow bước 5 ("thỏa mãn TẤT CẢ điều kiện").

### 3.3 State-driven Requirements

FR-011: WHILE không có phòng nào thỏa toàn bộ điều kiện lọc, THE system SHALL trả về danh sách rỗng kèm `message`: "Không có phòng họp nào khớp với các tiêu chí hiện tại. Vui lòng điều chỉnh bộ lọc của bạn." (E1) — không phải lỗi HTTP.

### 3.4 Optional Feature Requirements

FR-012: WHERE `page`/`limit` được cung cấp, THE system SHALL phân trang kết quả theo đúng tham số đó (mặc định `page=1`, `limit=50`, tối đa `limit=100`, theo `CLAUDE.md` §8.4).

### 3.5 Unwanted Behavior Requirements

FR-013: IF người dùng chưa đăng nhập, THEN THE system SHALL trả về 401.

FR-014: IF `capacityMin`/`capacityMax` không phải số nguyên dương, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-015: IF `capacityMin > capacityMax` (khi cả 2 đều được truyền), THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

FR-016: IF `page < 1` hoặc `limit < 1` hoặc `limit > 100`, THEN THE system SHALL trả về 400, error code `VALIDATION_ERROR`.

### 3.6 Authorization Requirements

FR-017: WHEN người dùng gọi endpoint tìm kiếm phòng, THE system SHALL verify authentication (đăng nhập) trước khi xử lý — KHÔNG yêu cầu permission/role cụ thể nào khác (§0.1, §2.2).

### 3.7 Data & State Requirements

FR-018: WHEN trả về mỗi phòng trong kết quả, THE system SHALL gồm tối thiểu: `roomId, roomCode, roomName, siteName, areaName, locationDescription, capacity, roomType, currentStatus, hasCamera, hasMicrophone, hasDisplay, allowRecording` — KHÔNG gồm `occupancyCount`, `lastPresenceAt`, `noShowStatus`, `currentBooking` chi tiết (dữ liệu vận hành nội bộ, §0.1).

FR-019: WHEN sắp xếp kết quả, THE system SHALL mặc định sort theo `roomCode ASC` (nhất quán convention `RoomStatusService`).

### 3.8 Complex / Combined Requirements

FR-020: WHILE người dùng đã áp dụng bộ lọc, THE system SHALL trả về đúng tập tiêu chí đang áp dụng trong response (`meta.appliedFilters`) để FE hiển thị rõ ràng bộ lọc đang hoạt động (POST-2).

### 3.9 Traceability

| Requirement ID | EARS Pattern | Nguồn / Use Case liên quan |
|---|---|---|
| FR-001–FR-003 | Ubiquitous | UC-ROOM-04 POST-1, BR-01 |
| FR-004–FR-010 | Event-driven | UC-ROOM-04 Normal Flow bước 2-5, AF-1 |
| FR-011 | State-driven | UC-ROOM-04 E1 |
| FR-012 | Optional Feature | `CLAUDE.md` §8.4 |
| FR-013–FR-016 | Unwanted Behavior | Validation |
| FR-017 | Authorization | PRE-1 |
| FR-018, FR-019 | Data & State | Response shape |
| FR-020 | Complex | UC-ROOM-04 POST-2 |

---

## 4. Non-functional Requirements

### 4.1 Performance

NFR-001: THE system SHALL trả về kết quả trong vòng dưới 1 giây trong điều kiện tải bình thường (catalog phòng quy mô nhỏ).

### 4.2 Security

NFR-002: THE system SHALL yêu cầu authentication cho mọi request.
NFR-003: THE system SHALL dùng parameterized query cho mọi filter (không nối chuỗi `areaName` vào SQL).
NFR-004: THE system SHALL KHÔNG lộ dữ liệu vận hành nội bộ (occupancy/no-show/presence chi tiết) qua endpoint này (FR-018).

### 4.3 Reliability & Consistency

NFR-005: THE system SHALL đảm bảo `currentStatus` trả về là giá trị `rooms.current_status` tại đúng thời điểm gọi API (không cache) — chấp nhận giới hạn lag đã biết (§0.3).

### 4.4 Usability

NFR-006: THE system SHALL trả về clear error messages theo từng field lọc sai định dạng.

---

## 5. Data Model

### 5.1 Entity liên quan

| Entity / Table | Vai trò | Ghi chú |
|---|---|---|
| `rooms` | Nguồn dữ liệu chính | `current_status` đã có sẵn, cập nhật bởi pipeline occupancy khác (ngoài phạm vi feature này) |

### 5.2 Dữ liệu đầu vào

`GET /api/v1/rooms/search`

| Field | Type | Bắt buộc | Mô tả | Validation |
|---|---:|---:|---|---|
| capacityMin | number | Không | Sức chứa tối thiểu | Số nguyên dương |
| capacityMax | number | Không | Sức chứa tối đa | Số nguyên dương, ≥ capacityMin nếu cả 2 có |
| areaName | string | Không | Lọc theo tầng/khu vực | Khớp chính xác |
| onlyAvailable | boolean | Không | Chỉ hiện phòng đang trống | true/false |
| page | number | Không | Mặc định 1 | min 1 |
| limit | number | Không | Mặc định 50 | min 1, max 100 |

### 5.3 Dữ liệu đầu ra

| Field | Type | Mô tả |
|---|---:|---|
| rooms[].roomId/roomCode/roomName | | |
| rooms[].siteName/areaName/locationDescription | | |
| rooms[].capacity | number | |
| rooms[].roomType | enum | |
| rooms[].currentStatus | enum | FR-003, FR-009 |
| rooms[].hasCamera/hasMicrophone/hasDisplay/allowRecording | boolean | |
| meta.appliedFilters | object | FR-020 |
| meta.page/limit/total/totalPages | number | FR-012 |

### 5.4 Data Constraints

- Không ghi/sửa bảng nào.
- Không thêm bảng/cột — không migration.

### 5.5 Cần làm rõ

- **CL-1**: Nếu công ty có nhiều tòa nhà (`siteName` khác nhau), lọc chỉ theo `areaName` (tầng) có thể trùng tên tầng giữa các tòa (vd "Tầng 3" ở cả tòa A và B). UC gốc không nhắc `siteName` — giữ đúng phạm vi (§0.4), nhưng nếu nghiệp vụ cần phân biệt theo tòa, cần bổ sung `siteName` filter ở phiên bản sau.
- **CL-2**: `onlyAvailable` mặc định là filter dạng boolean (checkbox "chỉ hiện phòng trống") thay vì multi-value enum trạng thái (available/occupied/reserved/...) — vì UC chỉ nhắc đúng 1 giá trị "Trống" trong ví dụ, không liệt kê các trạng thái khác như tiêu chí lọc.

---

## 6. Error Handling

### 6.1 Validation Errors

ERR-001: IF `capacityMin`/`capacityMax` không hợp lệ, THEN 400 `VALIDATION_ERROR`.
ERR-002: IF `capacityMin > capacityMax`, THEN 400 `VALIDATION_ERROR`.
ERR-003: IF `page`/`limit` không hợp lệ, THEN 400 `VALIDATION_ERROR`.

### 6.2 Authentication Errors

ERR-004: IF chưa đăng nhập, THEN 401.

### 6.3 System Errors

ERR-005: IF lỗi hệ thống không lường trước, THEN 500 `INTERNAL_ERROR`.

---

## 7. Acceptance Criteria

### 7.1 Happy Path

AC-001:
Given Employee đã đăng nhập,
When gọi `GET /rooms/search` không kèm filter,
Then trả về toàn bộ phòng đang active, sort theo `roomCode ASC`.

AC-002:
Given có phòng "P101" (capacity=10, areaName="Tầng 3", currentStatus="available") và "P102" (capacity=20, areaName="Tầng 5", currentStatus="occupied"),
When gọi với `capacityMin=8&capacityMax=15&areaName=Tầng 3&onlyAvailable=true`,
Then chỉ trả về "P101".

AC-003:
Given người dùng đã áp dụng bộ lọc rồi bấm "Xóa Bộ lọc",
When gọi lại `GET /rooms/search` không kèm param,
Then trả về danh sách đầy đủ (AF-1).

### 7.2 Validation & Exception Cases

AC-004:
Given không có phòng nào khớp `capacityMin=1000`,
When gọi API,
Then trả về `rooms=[]` kèm message đúng nội dung E1, không phải lỗi HTTP.

AC-005:
Given `capacityMin=20&capacityMax=10`,
When gọi API,
Then trả 400 `VALIDATION_ERROR`.

AC-006:
Given người dùng chưa đăng nhập,
When gọi API,
Then trả 401.

### 7.3 Acceptance Criteria Traceability

| AC ID | Requirement ID liên quan |
|---|---|
| AC-001 | FR-004, FR-019 |
| AC-002 | FR-005–FR-010 |
| AC-003 | FR-004 |
| AC-004 | FR-011 |
| AC-005 | FR-015, ERR-002 |
| AC-006 | FR-013, FR-017 |

---

## 8. Out of Scope

### 8.1 Không triển khai trong feature này

- Date/time picker cho "trống theo khung giờ cụ thể" — dùng luồng `rooms/available` đã có (§0.2).
- Filter theo `siteName` (tòa nhà) — chỉ `areaName` (§0.4, CL-1).
- Filter theo thiết bị tiện ích (camera/mic/display).
- Endpoint liệt kê danh sách tầng riêng (`GET /rooms/areas`) — FE tự suy ra từ kết quả trả về (§0.4).
- Sửa/mở rộng `GET /rooms/realtime-status` (RMS-001) — giữ nguyên trạng, không đụng permission/response của nó.

### 8.2 Có thể xem xét ở feature khác

- Filter theo `siteName` nếu công ty mở rộng nhiều tòa nhà.
- Filter/gợi ý theo thiết bị tiện ích.
- Bản đồ tương tác (interactive floor map) như Robin — vượt xa phạm vi UC gốc.

### 8.3 Out-of-scope EARS Guardrails

```text
OOS-001: THE system SHALL NOT require a date/time range parameter for this endpoint.
OOS-002: THE system SHALL NOT expose occupancyCount, lastPresenceAt, or noShowStatus in the response.
OOS-003: THE system SHALL NOT modify the existing GET /rooms/realtime-status endpoint or its permission.
OOS-004: THE system SHALL NOT create new database tables or columns for this feature.
```

---

## Checklist tự kiểm tra trước khi hoàn tất spec

- [x] Spec đã có đủ 8 thành phần chính.
- [x] Functional Requirements viết theo EARS, đủ 5 pattern cơ bản + Complex.
- [x] Mỗi requirement có mã ID rõ ràng, có traceability.
- [x] Error handling bao gồm validation, authentication, system error.
- [x] Acceptance Criteria dùng Given/When/Then.
- [x] Out of Scope có EARS guardrails.
- [x] Không tự ý thêm bảng/cột database mới, không thêm permission mới.
- [x] Các điểm thiếu thông tin đưa vào mục 5.5 "Cần làm rõ".
- [x] 2 điểm mơ hồ chính đã chốt cùng người dùng trước khi viết (§0.1, §0.2).
