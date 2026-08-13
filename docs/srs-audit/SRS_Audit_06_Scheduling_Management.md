# Đánh giá SRS — 6. Scheduling Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "6. Scheduling Management" (UC-41 → UC-42).
Nguồn code đối chiếu: `src/modules/scheduling/**` (nhánh `main`, commit `07f47b6`). Ghi chú: code tự đánh số nội bộ UC-SM-01/02/04 và UC-50/53, lệch với số hiệu UC-41/42 của SRS — đã đối chiếu theo nội dung nghiệp vụ.

## Tổng quan
Số UC: 2 | Khớp hoàn toàn: 0 | Khớp một phần: 2 | Sai hoàn toàn: 0 | Không có code: 0

Đây là mục có mức độ khớp SRS tốt nhất trong số các mục đã rà soát — phần lớn sai lệch là code CÓ THÊM chi tiết/quy tắc chặt chẽ hơn, không phải mâu thuẫn hay thiếu chức năng.

---

## UC-41 — Đề xuất Phòng Khả dụng & Khung giờ Tối ưu
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Luồng đề xuất phòng: nhập số người dự kiến, tùy chọn phần cứng yêu cầu → hệ thống trả danh sách phòng phù hợp. Luồng đề xuất khung giờ: chốt danh sách người tham gia, chọn khoảng ngày + thời lượng → hệ thống trả khung giờ rảnh chung. BR-01: sức chứa phòng đề xuất ≥ số người tham dự. BR-02: không đề xuất phòng có phần cứng yêu cầu đang "Bảo trì/Lỗi". BR-03: xung đột đặt phòng đồng thời áp dụng "ai đến trước được trước". BR-04: thuật toán chỉ trả "Rảnh"/"Bận", không tiết lộ nội dung sự kiện riêng tư.

**Code thực tế (bằng chứng):**
- `src/modules/scheduling/services/scheduling.service.ts:75-82` (`getRoomSuggestions`) — lọc `room.capacity >= attendeeCount`, loại phòng có `current_status IN ('maintenance', 'inactive')` → khớp BR-01; BR-02 được hiện thực ở **cấp độ toàn bộ phòng** (loại phòng nếu chính phòng đó đang bảo trì/ngừng hoạt động), **không lọc theo từng loại phần cứng cụ thể** (ví dụ: phòng có `hasCamera=true` nhưng chính chiếc camera đó đang lỗi thì entity phòng vẫn `current_status = available` bình thường vì `equipments` là bảng riêng — code không join sang bảng `equipments`/`healthStatus` khi lọc theo phần cứng yêu cầu) → **BR-02 chỉ được đáp ứng một phần**: chặn được phòng NGỪNG HOẠT ĐỘNG hoàn toàn, nhưng không chặn được trường hợp phòng vẫn hoạt động bình thường nhưng riêng 1 thiết bị (ví dụ máy chiếu) đang ở trạng thái lỗi (xem mục Equipment Management, UC-37).
- `src/modules/scheduling/services/scheduling.service.ts:106-122` — loại trừ phòng có booking chồng lấp thời gian; comment dòng 108-113 xác nhận: **chỉ tính xung đột với booking `approved`/`active`, KHÔNG loại phòng khỏi danh sách gợi ý chỉ vì có booking `pending` của yêu cầu khác** — nghĩa là 2 người có thể cùng thấy 1 phòng "khả dụng" trong lúc tra cứu gợi ý, và ai được Quản lý PHÊ DUYỆT trước mới thực sự giữ được phòng (không phải "ai bấm tạo yêu cầu trước" theo đúng nghĩa đen của BR-03, mà là "yêu cầu nào được duyệt trước"). Đây là cách diễn giải khác một chút so với câu chữ BR-03 của SRS ("ai đến trước được trước" ngụ ý xử lý ngay tại thời điểm request), nhưng tinh thần chống double-book cuối cùng (tại bước tạo meeting, xem Mục 3 UC-20) vẫn đúng — chỉ có 1 request được confirm ROOM_CONFLICT nếu đụng độ thật.
- `src/modules/scheduling/services/scheduling.service.ts:114-116` — **Business Rule hoàn toàn không có trong SRS**: có một khoảng đệm tối thiểu (`bufferMinutes`, cấu hình được) giữa 2 lượt đặt phòng liền kề đã duyệt/active cùng phòng — 2 cuộc họp sát giờ nhau kiểu "back-to-back" (kết thúc lúc X, bắt đầu lại đúng lúc X) **không còn được coi là hợp lệ**, phải cách nhau tối thiểu `bufferMinutes` phút.
- `src/modules/scheduling/dto/suggest-time-slot.dto.ts:20-37` — phân biệt `requiredParticipantUserIds` (bắt buộc, là hard-filter — chỉ đề xuất khung giờ mà TẤT CẢ đều rảnh) và `optionalParticipantUserIds` (chỉ ảnh hưởng xếp hạng, không loại khung giờ) — **mô hình phân loại người tham gia bắt buộc/tùy chọn này không có trong SRS** (SRS chỉ nói "chốt danh sách người tham gia" như một khối đồng nhất).
- `src/modules/scheduling/dto/suggest-time-slot.dto.ts:57-62` — `durationMinutes` giới hạn 15-480 phút — khớp con số đã thấy ở Mục 3 (UC-21, giới hạn thời lượng cuộc họp), không có trong SRS UC-41.
- Rà soát `participant-conflict.service.ts` và `participant-conflict-item.dto.ts` (dùng chung cho cả luồng đề xuất giờ và luồng kiểm tra xung đột UC-42): **không có bất kỳ trường nào chứa tiêu đề/nội dung sự kiện** (`grep "title|subject"` không ra kết quả) — chỉ có `status: 'free' | 'busy' | 'unknown'`, `busySlots` (khoảng thời gian), `warningMessage` → khớp chính xác và triệt để BR-04.

**Nhận xét:** Các quy tắc bảo vệ quyền riêng tư (BR-04) và sức chứa (BR-01) được thực thi rất nghiêm túc, thậm chí chặt hơn SRS ở nhiều điểm (buffer time, phân loại required/optional). Điểm hở duy nhất đáng chú ý: BR-02 chưa lọc được xuống cấp độ từng thiết bị cụ thể trong phòng, chỉ lọc theo trạng thái toàn phòng.

**Đề xuất sửa SRS:**
- Làm rõ BR-02: "Hệ thống chỉ loại các phòng đang ở trạng thái ngừng hoạt động/bảo trì toàn phòng; hiện tại KHÔNG kiểm tra tình trạng lỗi của từng thiết bị riêng lẻ bên trong phòng khi lọc theo yêu cầu phần cứng — nếu phòng vẫn hoạt động nhưng thiết bị yêu cầu (ví dụ máy chiếu) đang lỗi, phòng đó vẫn có thể được đề xuất."
- Làm rõ BR-03: "Việc xử lý xung đột đặt phòng đồng thời thực chất dựa trên thứ tự PHÊ DUYỆT (không phải thứ tự gửi yêu cầu) — nhiều yêu cầu có thể cùng nhắm vào 1 phòng/khung giờ ở trạng thái chờ duyệt; hệ thống chỉ chặn cứng (409 xung đột) khi có va chạm giữa các đặt phòng đã được duyệt hoặc đang active."
- Bổ sung: "Danh sách người tham gia khi đề xuất khung giờ được chia thành 'Bắt buộc' (ảnh hưởng trực tiếp tới việc loại khung giờ) và 'Tùy chọn' (chỉ ảnh hưởng thứ hạng đề xuất, không loại trừ khung giờ)." và "Giữa hai lượt đặt phòng liền kề (đã duyệt) tại cùng một phòng, hệ thống yêu cầu một khoảng đệm tối thiểu — không chấp nhận đặt lịch sát giờ tuyệt đối (back-to-back)."

---

## UC-42 — Tự động Phát hiện Xung đột Lập lịch (Phòng & Người tham dự)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Xung đột phòng: chặn cứng (không cho lưu) khi 2 người cùng đặt trùng phòng/giờ; giữ nguyên dữ liệu form khi bị chặn. Xung đột người tham gia: cảnh báo mềm, không chặn lưu. E1: khách mời bên ngoài không quản lý trên hệ thống nội bộ → hiển thị "Không rõ lịch trình" (nhãn xám), không phải đỏ/xanh. BR-02: thuật toán chỉ trả "Rảnh"/"Bận" + khoảng thời gian xung đột, không tiết lộ chi tiết sự kiện khác.

**Code thực tế (bằng chứng):**
- `src/modules/scheduling/scheduling.controller.ts:84-124` (`POST scheduling/participant-conflicts/check`) — đây là **một endpoint tra cứu độc lập, chủ động (client tự gọi để kiểm tra)**, không phải một cơ chế "chạy ngầm tự động" gắn liền vào đúng thời điểm submit form tạo/sửa cuộc họp như SRS mô tả (SRS: "Hệ thống ngay lập tức thực hiện kiểm tra thời gian thực trạng thái của phòng mục tiêu... Khi mỗi người tham gia được thêm vào, hệ thống ngay lập tức đối chiếu danh tính người đó với lịch trình cá nhân"). Việc kiểm tra xung đột PHÒNG thực tế được thực hiện tại chính thời điểm tạo/sửa cuộc họp (xem Mục 3, UC-20 `meetings.service.ts:761-776`, UC-21 tương tự) — đúng đây mới là nơi thực thi "chặn cứng khi lưu" như SRS mô tả; còn xung đột NGƯỜI THAM GIA cũng được tính lại ngay trong `create()`/`addInternalParticipant()` (Mục 3) — endpoint `scheduling/participant-conflicts/check` là một API TRA CỨU BỔ SUNG, dùng để FE gọi trước khi submit (ví dụ ngay khi thêm từng người vào danh sách trên form) — về hành vi cuối cùng, kết quả tương đương SRS mô tả, chỉ khác ở việc đây là 2 lệnh gọi API riêng biệt (tra cứu trước + kiểm tra lại khi lưu) thay vì một cơ chế "ngầm" duy nhất.
- `src/modules/scheduling/dto/check-participant-conflict.dto.ts:51-57` — có trường `externalParticipantEmails` (tùy chọn) dành riêng cho khách mời ngoài công ty → khớp đúng ý E1 của SRS.
- `src/modules/scheduling/dto/participant-conflict-item.dto.ts:19-20` — `status: 'free' | 'busy' | 'unknown'` — giá trị `unknown` áp dụng cho khách ngoài (không tra được lịch) → khớp chính xác E1 (nhãn "Không rõ lịch trình"); lưu ý SRS gọi đây là kết quả "nhị phân" (BR-04 của UC-41) nhưng thực chất có 3 trạng thái (free/busy/unknown) — SRS dùng từ chưa chính xác.
- `src/modules/scheduling/dto/participant-conflict-item.dto.ts:22-29` — chỉ trả `busySlots` (khoảng thời gian bận) và `warningMessage`, không có trường nào chứa tiêu đề/nội dung sự kiện → khớp chính xác BR-02 (không tiết lộ chi tiết sự kiện riêng tư của người khác).
- `src/modules/scheduling/dto/check-participant-conflict.dto.ts:47-49` — `excludeMeetingId` (tùy chọn) — dùng khi kiểm tra xung đột lúc SỬA một cuộc họp đã tồn tại (loại trừ chính cuộc họp đang sửa khỏi phép tính xung đột) — chi tiết kỹ thuật hợp lý, không có trong SRS nhưng cần thiết cho UC-21 (Mục 3).

**Nhận xét:** Về bản chất nghiệp vụ (chặn cứng khi phòng trùng, chỉ cảnh báo khi người tham gia trùng, ẩn chi tiết sự kiện riêng tư, xử lý khách ngoài bằng trạng thái trung lập), code khớp đầy đủ — chỉ khác về kiến trúc kỹ thuật: SRS mô tả như 1 cơ chế "chạy ngầm" tích hợp trực tiếp trong form tạo họp, còn code tách thành 1 API tra cứu độc lập (`scheduling` module) + phần kiểm tra lại chính thức khi thực sự lưu (nằm trong `meetings` module, Mục 3).

**Đề xuất sửa SRS:** Ghi chú kỹ thuật: "Việc kiểm tra xung đột người tham gia được cung cấp qua một API tra cứu độc lập (`POST /scheduling/participant-conflicts/check`) mà giao diện có thể gọi tại bất kỳ thời điểm nào khi người dùng thêm người tham gia (không nhất thiết đồng bộ 'ngầm' theo từng thao tác); việc kiểm tra xung đột phòng và tái xác nhận xung đột người tham gia một lần cuối luôn được thực hiện lại ở chính thời điểm lưu cuộc họp (API tạo/sửa cuộc họp), đảm bảo dữ liệu không bị lệch dù người dùng tra cứu trước đó bao lâu."

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Khoảng đệm tối thiểu (buffer) giữa 2 lượt đặt phòng liền kề** (`scheduling.service.ts:114-116`) — không cho đặt phòng sát giờ tuyệt đối (back-to-back), cấu hình được qua `getRoomBookingBufferMs()` — hoàn toàn không có trong SRS.
2. **Phân loại người tham gia Bắt buộc/Tùy chọn khi đề xuất khung giờ** (`suggest-time-slot.dto.ts`) — ảnh hưởng khác nhau tới thuật toán (hard-filter vs chỉ xếp hạng) — SRS coi danh sách người tham gia là một khối đồng nhất.
3. **Giới hạn `maxSuggestions` (1-10) và `participantUserIds` tối đa 50 phần tử** — các giới hạn kỹ thuật không có trong SRS.
