# Đánh giá SRS — 4. Room Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "4. Room Management" (UC-32 → UC-35).
Nguồn code đối chiếu: `src/modules/rooms/**` (nhánh `main`, commit `07f47b6`).

## Tổng quan
Số UC: 4 | Khớp hoàn toàn: 1 | Khớp một phần: 3 | Sai hoàn toàn: 0 | Không có code: 0

---

## UC-32 — Tạo phòng họp mới (thủ công)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Form nhập "Tên phòng họp, Vị trí (Tầng/Tòa nhà), Sức chứa tối đa, và tích chọn các trang thiết bị tiện ích có sẵn tại phòng". BR1: Tên phòng họp phải duy nhất toàn hệ thống. BR2: mọi phòng mới tạo mặc định trạng thái "Khả dụng". EX2: nhập chữ cái/số âm vào Sức chứa → báo lỗi định dạng.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/dto/create-room.dto.ts:17-25` — **`roomCode` (Mã phòng) là trường BẮT BUỘC** (`@IsNotEmpty`, định dạng bắt buộc `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`, 3-80 ký tự viết hoa) — **hoàn toàn không có trong form SRS UC-32** (SRS chỉ liệt kê Tên phòng, Vị trí, Sức chứa, thiết bị).
- `src/modules/rooms/services/rooms.service.ts:69-84` (`checkDuplicateRoomCode`) — kiểm tra trùng mã phòng **kể cả với các phòng đã bị soft-delete trước đó** (`withDeleted: true`) → một mã phòng đã dùng (dù phòng đó đã bị "xóa") vẫn không thể tái sử dụng, chi tiết nghiêm ngặt hơn không có trong SRS.
- `src/modules/rooms/services/rooms.service.ts:92-104` (`checkDuplicateRoomName`) — so khớp `LOWER(TRIM(...))`, không phân biệt hoa/thường và khoảng trắng thừa → khớp đúng tinh thần BR1 (thậm chí kỹ hơn).
- `src/modules/rooms/dto/create-room.dto.ts:46-49` — `capacity`: `@IsInt`, `@Min(1)`, **và `@Max(1000)`** (giới hạn trên không có trong SRS) → khớp EX2 (chặn số âm/không nguyên) và bổ sung thêm trần 1000.
- `src/modules/rooms/services/rooms.service.ts:152-153` — `currentStatus: RoomStatus.AVAILABLE, isActive: true` mặc định khi tạo → khớp chính xác BR2.
- `src/modules/rooms/dto/create-room.dto.ts:51-72` — các trường thiết bị là boolean rời (`hasCamera`, `hasMicrophone`, `hasDisplay`, `allowRecording`) chứ không phải một danh sách "tích chọn nhiều thiết bị" tùy ý như SRS gợi ý (SRS: "tích chọn các trang thiết bị tiện ích có sẵn tại phòng (ví dụ: Máy chiếu, TV, …)") — code giới hạn cứng 4 loại thiết bị cụ thể, không có "Máy chiếu"/"TV" như ví dụ SRS nêu, và không cho thêm loại thiết bị tùy ý (quản lý danh mục thiết bị đầy đủ nằm ở module Equipment, mục 5).

**Nhận xét:** Sai lệch chính là trường `roomCode` bắt buộc hoàn toàn vắng mặt trong SRS, và mô hình "thiết bị tiện ích" của phòng là 4 cờ boolean cố định (camera/mic/display/recording), không phải danh sách tùy chọn tự do như SRS mô tả.

**Đề xuất sửa SRS:**
- Bổ sung vào form bước 2: "Mã phòng họp (bắt buộc, định danh duy nhất, chỉ gồm chữ hoa/số/dấu gạch ngang)."
- Sửa mô tả thiết bị tiện ích thành: "Đánh dấu các cờ tiện ích cố định: Có camera, Có micro, Có màn hình hiển thị, Cho phép ghi hình — không phải danh sách thiết bị tự do (danh mục thiết bị chi tiết được quản lý riêng ở mục Equipment Management)."
- Bổ sung giới hạn: "Sức chứa tối đa cho phép nhập là 1000."

---

## UC-33 — Cập nhật thông tin phòng họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Sửa Tên phòng họp, Vị trí, Sức chứa tối đa, hoặc cập nhật danh mục thiết bị. BR1: Tên phòng sau khi sửa vẫn phải duy nhất.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/services/rooms.service.ts:199-201` — comment xác nhận rõ: "roomCode/currentStatus/isActive bất biến qua endpoint này" → `roomCode` không sửa được (hợp lý, không mâu thuẫn SRS vì SRS cũng không nhắc đến việc sửa mã phòng), và **`currentStatus` (trạng thái Khả dụng/Đang dùng/...) cũng không sửa được qua endpoint này** — việc đổi trạng thái vận hành thuộc phạm vi khác (Room Utilization Management, mục 7).
- `src/modules/rooms/services/rooms.service.ts:227-229` — chỉ kiểm tra trùng tên khi client THỰC SỰ gửi `roomName` khác (partial update, comment ghi chú "BUG-007") — khớp hợp lý với BR1, không kiểm tra thừa khi không đổi tên.
- `src/modules/rooms/services/rooms.service.ts:295-308` — sau khi cập nhật, phát sự kiện WebSocket `room.updated` broadcast realtime tới mọi client đang kết nối — khớp đúng tinh thần Postcondition POST-2 của SRS ("Giao diện lưới lịch phòng họp của toàn bộ người dùng đang đăng nhập được làm mới và hiển thị thông tin thay đổi ngay lập tức theo thời gian thực mà không cần tải lại trang").

**Nhận xét:** Về cơ bản khớp SRS; điểm cần lưu ý là danh sách trường được phép sửa của code hẹp hơn 1 chút so với ấn tượng "mọi thông tin phòng" mà SRS ngụ ý — không sửa được mã phòng và trạng thái vận hành qua endpoint này.

**Đề xuất sửa SRS:** Bổ sung ghi chú: "Mã phòng họp và trạng thái vận hành hiện tại (Khả dụng/Đang sử dụng/...) không thể chỉnh sửa qua chức năng này."

---

## UC-34 — Xóa phòng họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (khớp rất sát, chỉ khác về bản chất kỹ thuật "xóa mềm")

**SRS hiện tại ghi:** POST-1: gỡ bỏ khỏi tìm kiếm/lưới lịch. POST-2: cuộc họp tương lai bị đánh dấu "Cần đổi phòng". EX1: chặn nếu phòng đang có cuộc họp "Đang diễn ra". BR1: cuộc họp quá khứ vẫn giữ tên phòng cũ. BR2: KHÔNG tự động hủy các cuộc họp tương lai bị ảnh hưởng.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/controllers/rooms.controller.ts:178-203` (`GET /rooms/:roomId/deletion-impact`) — endpoint xem trước tác động (số cuộc họp tương lai bị ảnh hưởng, có đang bị chặn bởi cuộc họp đang diễn ra hay không) → khớp đúng ý "hệ thống thực hiện rà soát... hiển thị hộp thoại xác nhận" của SRS bước 3-4.
- `src/modules/rooms/services/rooms.service.ts:355-374` (`hasBlockingInProgressMeeting`) — chặn xóa nếu `status=IN_PROGRESS` **HOẶC** (`status=SCHEDULED` VÀ thời điểm hiện tại nằm trong khoảng `[startTime, endTime]`) — xử lý cả trường hợp đã đến giờ họp nhưng chưa ai bấm "Bắt đầu" trên live-meeting → khớp đúng và còn chặt chẽ hơn EX1 của SRS.
- `src/modules/rooms/services/rooms.service.ts:402-403,438-439` (`deleteRoom`) — comment xác nhận: **"Xóa phòng họp (soft-delete, UC-ROOM-03). Không hủy meeting (BR2), không đụng dữ liệu quá khứ (BR1)."** — dùng `em.softRemove(RoomEntity, room)` (xóa mềm, đặt `deletedAt`), không xóa cứng khỏi DB.
- `src/modules/rooms/services/rooms.service.ts:432-475` — với từng cuộc họp tương lai bị ảnh hưởng: giải phóng `room_booking` liên quan (`status = RELEASED`), **`meeting.roomId = null` nhưng KHÔNG đổi `meeting.status`** (giữ nguyên "Đã lên lịch") → khớp chính xác BR2 và POST-2 (chỉ xóa trường Địa điểm, meeting vẫn tồn tại nguyên trạng thái).
- `src/modules/rooms/services/rooms.service.ts:461-472` — ghi `MeetingEventEntity` với mô tả "Phòng họp đã bị xóa khỏi hệ thống, cần chọn lại địa điểm." cho từng cuộc họp bị ảnh hưởng — khớp đúng khái niệm "gắn cờ cảnh báo bắt buộc cập nhật" của SRS.
- `src/modules/rooms/services/rooms.service.ts:515-536` — enqueue background job (`ROOM_DELETE_NOTIFY`) xử lý bất đồng bộ (không block response `DELETE`), khớp tinh thần bước 7 (gửi email/thông báo) của SRS; **không xác nhận được** (chưa đọc `RoomDeleteNotificationProcessor`) liệu job này có tự động gợi ý 2-3 phòng thay thế như "Other Information" của SRS đề cập hay không.

**Nhận xét:** Đây là UC khớp sát nhất trong mục 4 — kể cả các chi tiết Business Rule tinh vi (BR1, BR2) đều được code hiện thực đúng, với bổ sung hợp lý (chặn cả trường hợp "đã đến giờ nhưng chưa Start"). Điểm khác biệt về ngôn từ: SRS không nói rõ đây là "xóa mềm" (dữ liệu phòng vẫn còn trong DB, chỉ ẩn đi) — nhưng khác với UC-10 (Account), ở đây bản chất "xóa mềm" này KHÔNG mâu thuẫn với bất kỳ câu chữ nào trong SRS UC-34 (SRS không khẳng định "xóa vĩnh viễn, không thể khôi phục" như đã thấy ở UC-10).

**Đề xuất sửa SRS:** Không bắt buộc; có thể bổ sung ghi chú kỹ thuật: "Phòng họp bị xóa được lưu ở dạng xóa mềm (ẩn khỏi mọi danh sách/tìm kiếm) — dữ liệu vẫn được giữ lại trong hệ thống để phục vụ tra cứu lịch sử/audit."

---

## UC-35 — Xem & Tìm kiếm Danh sách Phòng
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (chưa xác minh được đầy đủ BR-01)

**SRS hiện tại ghi:** Lọc theo Sức chứa (khoảng), Vị trí (dropdown tầng), Trạng thái (Trống). BR-01: trạng thái phòng phải được tính toán và phản ánh theo thời gian thực tại thời điểm tìm kiếm.

**Code thực tế (bằng chứng):**
- `src/modules/rooms/dto/search-rooms-query.dto.ts:16-51` (`SearchRoomsQueryDto`, dùng cho `GET /rooms/search`, mở cho mọi user đã đăng nhập, không cần permission riêng) — có đủ `capacityMin`/`capacityMax` (khoảng sức chứa), `areaName` (vị trí), `onlyAvailable` (boolean lọc theo trạng thái trống) — khớp đúng 3 tiêu chí SRS liệt kê; có thêm `page`/`limit` (tối đa 100) phân trang không có trong SRS.
- `src/modules/rooms/controllers/rooms.controller.ts:71-83` — khi không có kết quả, trả message "Không có phòng họp nào khớp với các tiêu chí hiện tại. Vui lòng điều chỉnh bộ lọc của bạn." — khớp gần nguyên văn E1 của SRS.
- **Chưa xác minh được** (trong phạm vi thời gian rà soát mục này) liệu `onlyAvailable` có thực sự tính theo thời gian thực dựa trên booking hiện tại hay chỉ dựa vào `currentStatus` tĩnh của phòng — cần đọc sâu `RoomSearchService.search()` để khẳng định tuyệt đối BR-01.

**Nhận xét:** Shape API và tiêu chí lọc khớp tốt với SRS; phần "thời gian thực" của BR-01 chưa được xác minh triệt để do giới hạn thời gian rà soát — không kết luận chắc chắn, cần một lượt kiểm tra bổ sung nếu cần độ chính xác tuyệt đối.

**Đề xuất sửa SRS:** Không cần sửa nội dung; khuyến nghị đội BE xác nhận lại `RoomSearchService.search()` có tính real-time chuẩn theo booking hiện tại hay không trước khi coi BR-01 là đã được kiểm chứng đầy đủ.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`roomCode` (Mã phòng) bắt buộc, duy nhất kể cả với bản ghi đã xóa mềm** — hoàn toàn vắng mặt trong form UC-32 của SRS.
2. **`GET /rooms/:roomId/deletion-impact`** — endpoint xem trước tác động tách biệt (không chỉ là 1 bước trong luồng xóa) — SRS mô tả gộp chung vào Normal Flow của UC-34 mà không tách thành 1 API riêng; đáng ghi chú kỹ thuật.
3. **`GET /rooms/realtime-status`** và **`GET /rooms/:roomId/status`** (`rooms.controller.ts:239,254`) — 2 endpoint trạng thái phòng theo thời gian thực, tự gắn nhãn nội bộ "UC-36"/"UC-38" — các mã UC này **không khớp với số thứ tự UC trong SRS mục Room Management** (SRS mục 4 chỉ có UC-32→35); rất có thể đây là phần thuộc mục 7 "Room Utilization Management" (UC-43 trong SRS) — cần đối chiếu lại khi rà soát mục 7 để tránh trùng lặp/bỏ sót.
