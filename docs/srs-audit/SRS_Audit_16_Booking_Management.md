# Đánh giá SRS — Booking Management

## Tổng quan

Số UC: 3 | Khớp hoàn toàn: 0 | Khớp 1 phần: 3 | Sai hoàn toàn: 0 | Không có code: 0

Ghi chú tổng quan: Cả 3 UC của Mục này đều xoay quanh 1 giả định trung tâm — **có tồn tại một nhánh "tự động phê duyệt" dành riêng cho Manager/cấp cao hơn khi họ tự đặt phòng** (UC-101 POST-2, UC-102 BR-01). Đây chính là phát hiện đã được ghi nhận từ **Mục 3 (Meeting Management)**: kiểm tra trực tiếp luồng tạo yêu cầu (`meetings.service.ts:853`) cho thấy `approvalMode` được gán **cứng** là `ApprovalMode.MANUAL` cho **mọi** người gửi, không có bất kỳ nhánh điều kiện nào theo role. Phát hiện này được xác nhận lại và áp dụng cụ thể vào bối cảnh "đặt phòng" của Mục 16 dưới đây.

---

## UC-101 — Gửi Yêu cầu Đặt Phòng họp

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** POST-2: "Nếu được gửi bởi Employee, yêu cầu tạo với trạng thái 'Đang chờ' và phòng được tạm giữ; **nếu được gửi bởi Manager hoặc cấp cao hơn, yêu cầu có thể được tự động phê duyệt** theo BR-01 của UC-BOK-02."

**Code thực tế (bằng chứng):**
- `create()` (`src/modules/meetings/services/meetings.service.ts:817-869`): trong 1 transaction, tạo đồng thời `MeetingEntity` (`status: PENDING_APPROVAL`, dòng 832), `MeetingRequestEntity` (`approvalMode: ApprovalMode.MANUAL` — **hardcode, không điều kiện theo role**, dòng 853; `approvalStatus: ApprovalStatus.PENDING`, dòng 854), và `RoomBookingEntity` (giữ khung giờ ở trạng thái pending) — **giống hệt nhau cho MỌI role gửi yêu cầu**, kể cả Manager/System Admin.
- `ApprovalMode` enum (`src/modules/meetings/entities/meeting-request.entity.ts:21-25`) có sẵn giá trị `AUTO`, nhưng grep toàn repo cho thấy `ApprovalMode.AUTO` **chỉ được dùng đúng 1 nơi** — `live-meeting.service.ts:948`, thuộc luồng **yêu cầu gia hạn cuộc họp** (Mục 8), không liên quan gì tới việc đặt phòng ban đầu.
- Room availability check tại thời điểm gửi (E1) khớp: transaction có kiểm tra xung đột trước khi tạo `RoomBookingEntity`.

**Nhận xét:**
Phần "gửi yêu cầu, giữ chỗ tạm thời" (POST-1, PRE-1/2, Normal Flow bước 1-4, E1) khớp đúng thực tế. Nhưng vế thứ hai của POST-2 — "Manager có thể tự động phê duyệt" — hoàn toàn không tồn tại: mọi request, không phân biệt role người gửi, đều dừng ở `PENDING` và bắt buộc một hành động phê duyệt thủ công riêng biệt (UC-102) từ một người khác (không được tự duyệt yêu cầu của chính mình — xem UC-102).

**Đề xuất sửa SRS:**
> POST-2: Mọi yêu cầu đặt phòng — không phân biệt vai trò người gửi (Employee, Manager, hay cao hơn) — đều được tạo với trạng thái "Đang chờ phê duyệt" (`approvalStatus: PENDING`, `approvalMode: MANUAL`) và phòng được giữ tạm. **Không có nhánh tự động phê duyệt theo role người gửi.** Cờ `AUTO` có tồn tại trong hệ thống dữ liệu nhưng hiện chỉ được dùng cho luồng gia hạn cuộc họp đang diễn ra (Mục 8), không áp dụng cho việc gửi yêu cầu đặt phòng ban đầu.

---

## UC-102 — Phê duyệt Yêu cầu Đặt Phòng

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR-01: "Tự động phê duyệt CHỈ áp dụng cho các tài khoản Manager/Trưởng phòng hoặc cao hơn — khi nhóm này đặt phòng, trạng thái lịch NGAY LẬP TỨC trở thành 'Đã lên lịch'. Employee luôn tạo yêu cầu 'Đang chờ Phê duyệt'."

**Code thực tế (bằng chứng):**
- Route: `POST meeting-requests/:requestId/approve` — `src/modules/meetings/controllers/meetings.controller.ts:775-818`.
- `approve()` (`src/modules/meetings/services/meeting-request-review.service.ts:136-...`): Normal Flow thực tế khớp rất tốt — chuyển `request.approvalStatus = APPROVED`, `meeting.status = SCHEDULED`, `booking.status = APPROVED`/`ACTIVE`, ghi `approvedBy`/`approvedAt` (dòng 386-387).
- Chặn tự duyệt: nếu `request.requestedBy === authUser.userId || meeting.organizerId === authUser.userId` → `ForbiddenException` code `SELF_APPROVAL_NOT_ALLOWED` (tương tự dòng 931-940 của `reject()`, cùng logic trong `approve()`).
- Thông báo kết quả: `enqueueApprovalNotifications()` (dòng 579+) gửi **CẢ IN_APP (dòng 630) LẪN EMAIL (dòng 657-659)** — khớp đúng POST-3 "Email Service" của SRS (khác với mẫu hình "chỉ IN_APP dù SRS đòi email" đã lặp lại nhiều lần ở các Mục 12/13/14 trước đó — đây là một trường hợp khớp thật).
- **NHƯNG:** BR-01 (auto-approve khi Manager tự đặt phòng cho chính mình) **không tồn tại** — như đã chứng minh ở UC-101, `approvalMode` luôn là `MANUAL` bất kể role người gửi ngay từ bước tạo yêu cầu; `approve()` luôn yêu cầu một lệnh gọi API riêng biệt từ một người khác (không phải chính người gửi) để chuyển trạng thái.

**Nhận xét:**
Cơ chế "một người khác duyệt yêu cầu đang chờ" hoạt động đúng và đầy đủ (kể cả kênh gửi email, thứ mà nhiều module khác trong hệ thống này thường tuyên bố nhưng không làm). Tuy nhiên, chính BR-01 — luật nghiệp vụ trung tâm định nghĩa "khi nào cần UC này" — lại sai hoàn toàn: SRS ngụ ý Manager không cần bước duyệt cho chính lịch của họ, nhưng thực tế Manager đặt phòng cho MÌNH vẫn phải chờ MỘT NGƯỜI KHÁC duyệt giống hệt Employee.

**Đề xuất sửa SRS:**
> BR-01: **Không có auto-approve theo role.** Mọi yêu cầu đặt phòng, bất kể ai gửi, đều ở trạng thái "Đang chờ Phê duyệt" cho tới khi một người khác (không phải người gửi/organizer) thực hiện hành động duyệt qua `POST /meeting-requests/:requestId/approve`. Người duyệt không được trùng với người gửi yêu cầu hoặc organizer của meeting (`SELF_APPROVAL_NOT_ALLOWED`). Sau khi duyệt, hệ thống gửi cả in-app lẫn email cho người yêu cầu.

---

## UC-103 — Từ chối Yêu cầu Đặt Phòng

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR-01/EX1: lý do từ chối bắt buộc. BR-13: phòng giải phóng real-time. BR-14: hệ thống phải tự động rút lại bất kỳ lời mời lịch nào đã gửi tới participant.

**Code thực tế (bằng chứng):**
- Route: `POST meeting-requests/:requestId/reject`, body `RejectMeetingRequestDto` với `rejectionReason` gắn `@IsNotEmpty` (`src/modules/meetings/dto/reject-meeting-request.dto.ts:4-9`) — khớp chính xác BR-01/EX1.
- `reject()` (`meeting-request-review.service.ts:803-1037`): với request loại `CREATE_MEETING` (không phải update time/room) — `meeting.status = CANCELLED` (dòng 960), `booking.status = CANCELLED` (dòng 966) — giải phóng khung giờ ngay trong cùng transaction, khớp BR-13/POST-2/3. Ghi `MeetingEventEntity` + `AuditLogEntity` đầy đủ dấu vết (dòng 971-1018). Gửi thông báo kèm lý do sau transaction (`enqueueRejectionNotifications`, dòng 1040+) — khớp POST-4.
- BR-14 (rút lại lời mời lịch đã gửi): theo phát hiện tại **Mục 14 (UC-94)**, hệ thống **không** tự động gửi lời mời lịch (email invite) cho participant tại thời điểm request còn `PENDING_APPROVAL` — lời mời chỉ được gửi thủ công (UC-143) hoặc tự động cho các sự kiện phái sinh sau khi meeting đã `SCHEDULED`. Vì một request bị từ chối thì meeting **chưa từng** đạt tới trạng thái `SCHEDULED`, nên về logic **chưa từng có lời mời lịch nào được gửi ra để cần "rút lại"** — BR-14 là một yêu cầu không có tình huống nào để áp dụng trong kiến trúc thật (không sai, nhưng vô nghĩa/thừa vì tiền đề của nó — "đã gửi lời mời" — không xảy ra ở giai đoạn PENDING).

**Nhận xét:**
Phần lõi nghiệp vụ (bắt buộc lý do, hủy meeting, giải phóng phòng real-time, thông báo kèm lý do) khớp rất tốt. Riêng BR-14 không sai nhưng đặt sai bối cảnh — nó giả định đã có "lời mời lịch" tồn tại ở giai đoạn PENDING, điều không đúng với kiến trúc thật (xem UC-94, Mục 14).

**Đề xuất sửa SRS:**
> BR-14: Bỏ hoặc điều chỉnh — ở giai đoạn "Đang chờ Phê duyệt", hệ thống **chưa từng gửi lời mời lịch chính thức** nào cho participant (chỉ Host/Admin mới có thể chủ động gửi lời mời thủ công sau khi meeting đã ở trạng thái "Đã lên lịch" — xem UC-94/UC-143), nên không có gì cần "rút lại" khi một yêu cầu còn đang PENDING bị từ chối.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Chặn tự duyệt/tự từ chối yêu cầu của chính mình** (`SELF_APPROVAL_NOT_ALLOWED`, cả trong `approve()` và `reject()`) — một luật quản trị hợp lý nhưng không được SRS UC-102/103 nhắc tới.
2. **Request loại UPDATE_TIME/UPDATE_ROOM dùng chung pipeline duyệt/từ chối** với request tạo mới (`CREATE_MEETING`) nhưng có hành vi hoàn tác khác biệt khi bị từ chối: meeting quay lại `SCHEDULED` với giờ/phòng CŨ thay vì bị hủy hẳn (`reject()`, dòng 951-958) — một chiều sâu nghiệp vụ (đổi giờ/đổi phòng cho meeting đã tồn tại cũng phải qua phê duyệt) hoàn toàn nằm ngoài phạm vi "đặt phòng mới" mà SRS Mục 16 mô tả — đã được ghi nhận sâu hơn ở Mục 3.
3. **`MeetingEventEntity`** — mọi hành động approve/reject đều được ghi vào 1 bảng dòng thời gian sự kiện cuộc họp riêng (`meeting_events`), song song với `AuditLogEntity` — một lớp observability cho riêng từng meeting, tách biệt khỏi audit log hệ thống chung (Mục 15, UC-99) — không có trong SRS.
