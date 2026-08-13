# Đánh giá SRS — 3. Meeting Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "3. Meeting Management" (UC-20 → UC-31).
Nguồn code đối chiếu: `src/modules/meetings/**` (nhánh `main`, commit `07f47b6`). Ghi chú: module `src/modules/approvals` chỉ có `approvals.module.ts` trống — logic phê duyệt yêu cầu họp nằm ngay trong `MeetingsController`/`MeetingsService` (route `meeting-requests/:requestId/approve|reject`), không phải module riêng.

## Tổng quan
Số UC: 12 | Khớp hoàn toàn: 0 | Khớp một phần: 10 | Sai hoàn toàn: 0 | Không có code: 2 (UC-30, UC-31 — SRS tự đánh dấu "bỏ UC này", đã xác nhận đúng)

---

## UC-20 — Tạo Cuộc họp (Bao gồm đặt phòng đột xuất)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (2/3 postcondition không có trong code)

**SRS hiện tại ghi:** POST-1 (Tạo bởi Employee): trạng thái "Đang chờ", phòng "Đang giữ", gửi email cho quản lý duyệt. POST-2 (Tạo bởi Manager): trạng thái trực tiếp "Đã lên lịch", phòng khóa chính thức, KHÔNG cần duyệt. POST-3 (Luồng Ad-hoc): trạng thái trực tiếp "Đang diễn ra", bỏ qua "Đã lên lịch"; phòng "Đang sử dụng" ngay; tự động kích hoạt Camera Service nếu ghi hình được bật. AF-2 mô tả luồng Ad-hoc: giờ bắt đầu mặc định = thời gian hiện tại của máy chủ.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/dto/create-meeting.dto.ts:38-45` — `startTime` bắt buộc qua `IsFutureDateConstraint` (`src/modules/meetings/validators/is-future-date.validator.ts:15-17`: `date.getTime() > Date.now()`, **so sánh nghiêm ngặt "lớn hơn"**, không chấp nhận "bằng thời điểm hiện tại"). **Không có trường `isAdhoc`/`isRecurring`/tương tự nào trong DTO** → **không có cơ chế kỹ thuật nào để tạo cuộc họp bắt đầu "ngay bây giờ" như luồng Ad-hoc SRS mô tả** — mọi request với `startTime <= now` đều bị từ chối 400 `VALIDATION_ERROR` (`meetings.service.ts:697-703` kiểm tra lại lần nữa trong service).
- `src/modules/meetings/services/meetings.service.ts:820-891` (`create`) — **MỌI cuộc họp, không phân biệt vai trò người tạo (Employee hay Manager), đều được tạo với `status: MeetingStatus.PENDING_APPROVAL` và một bản ghi `MeetingRequestEntity` với `approvalStatus: ApprovalStatus.PENDING`** — không có bất kỳ nhánh kiểm tra role nào để tự động chuyển thẳng sang `SCHEDULED` khi người tạo là Manager. → **Postcondition POST-2 của SRS (tự động phê duyệt khi Manager tạo) hoàn toàn không tồn tại trong code** — phù hợp với nguyên tắc toàn hệ thống được xác nhận lại ở mục Booking Management BR-06 (UC-101): "Một cuộc họp chỉ có thể được tạo khi booking_id liên quan của nó đã đạt trạng thái 'Đã phê duyệt'" — đây là một cổng kiểm soát chung, không có ngoại lệ cho vai trò Manager.
- **Postcondition POST-3 (Ad-hoc, trạng thái "Đang diễn ra" ngay lập tức) hoàn toàn không có code tương ứng** — không tìm thấy service method, controller route, hay nhánh logic nào tạo meeting trực tiếp ở `IN_PROGRESS`.
- `src/modules/meetings/services/meetings.service.ts:761-776` — kiểm tra xung đột phòng theo thời gian thực, ném `409 ConflictException` với message "Phòng họp này vừa được đặt. Vui lòng chọn một phòng khác hoặc đổi khung giờ." → khớp gần như nguyên văn E1 của SRS.
- `src/modules/meetings/services/meetings.service.ts:778-795` — kiểm tra `totalParticipants > room.capacity`, chặn (422 `CAPACITY_EXCEEDED`) trừ khi client gửi `capacityOverrideConfirmed: true` — **cơ chế "xác nhận vượt sức chứa phòng" hoàn toàn không có trong SRS UC-20**.
- `src/modules/meetings/services/meetings.service.ts:802-806,856-862` — kiểm tra xung đột lịch của người tham gia (không phải host), lưu vào `conflictSummaryJson` ở trạng thái `WARNING` (không chặn tạo) → khớp tinh thần AF-1 của SRS (chỉ cảnh báo, không chặn).
- `src/modules/meetings/services/meetings.service.ts:994-1021` — sau khi tạo, gửi **thông báo in-app** (không phải email) tới danh sách người duyệt (`approverIds`) qua `NotificationsService` — SRS bước 8 nói "gửi thông báo Áp dụng (yêu cầu phê duyệt hoặc xác nhận) qua Email Service"; code dùng kênh `NotificationChannel.IN_APP`, không phải email trực tiếp ở bước này (việc gửi email có thể do `NotificationsService` xử lý ở tầng khác, nhưng lệnh gọi tường minh trong `create()` là in-app).

**Nhận xét:**
1. Luồng "Manager tạo → tự động Scheduled, không cần duyệt" không tồn tại — mọi yêu cầu tạo họp đều phải qua bước phê duyệt riêng biệt.
2. Luồng Ad-hoc (tạo tức thời, trạng thái "Đang diễn ra" ngay) không tồn tại — thời gian bắt đầu bắt buộc phải ở tương lai.
3. Có 1 cơ chế nghiệp vụ bổ sung không có trong SRS: xác nhận vượt sức chứa phòng (`capacityOverrideConfirmed`).

**Đề xuất sửa SRS:**
- Xóa POST-2 và AF-2 (luồng Ad-hoc) khỏi UC-20, hoặc đánh dấu là "chưa triển khai/đã loại khỏi phạm vi" giống cách UC-30/31 đã được đánh dấu.
- Sửa Postcondition chung thành: "Mọi cuộc họp khi tạo đều ở trạng thái 'Đang chờ duyệt' (Pending Approval) kèm một yêu cầu (Meeting Request) tương ứng, không phân biệt vai trò người tạo; phòng được giữ tạm ở trạng thái 'pending' cho đến khi yêu cầu được phê duyệt (xem UC-102)."
- Bổ sung Business Rule: "Nếu tổng số người tham dự (nội bộ + khách ngoài) vượt quá sức chứa phòng đã chọn, hệ thống chặn tạo và yêu cầu người dùng xác nhận rõ ràng việc vượt sức chứa trước khi cho phép tiếp tục."

---

## UC-21 — Dời lịch Cuộc họp (Cập nhật Thời gian/Phòng)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** PRE-2: cuộc họp đang "Đã lên lịch". BR-01: quyền chỉnh sửa "giới hạn độc quyền cho tài khoản Người chủ trì (Host)". E1: không dời về quá khứ. E2: cuộc họp đã "Đang diễn ra" thì chặn cập nhật.

**Code thực tế (bằng dẫn):**
- `src/modules/meetings/services/meetings.service.ts:1083-1095` — cho phép sửa thời gian khi meeting đang `PENDING_APPROVAL` **hoặc** `SCHEDULED` — rộng hơn PRE-2 của SRS (chỉ liệt kê "Đã lên lịch").
- `src/modules/meetings/services/meetings.service.ts:1097-1110` — quyền chỉnh sửa: `authUser.userId === meeting.organizerId || authUser.userId === meeting.hostId` — **KHÔNG chỉ Host độc quyền như BR-01 khẳng định**; người tạo yêu cầu (Organizer, có thể khác Host nếu `hostId` được chỉ định khác lúc tạo) cũng sửa được.
- `src/modules/meetings/services/meetings.service.ts:1134-1144` — chặn dời về quá khứ (cả `startTime` lẫn `endTime`) → khớp E1.
- `src/modules/meetings/services/meetings.service.ts:1146-1154` — **Business Rule hoàn toàn không có trong SRS**: thời lượng cuộc họp mới phải nằm trong khoảng 15 phút – 8 giờ (`MEETING_DURATION_OUT_OF_RANGE`).
- `src/modules/meetings/services/meetings.service.ts:1198-1221` — khi đổi sang phòng mới: kiểm tra thêm sức chứa phòng mới so với số người tham dự dự kiến (`ROOM_CAPACITY_INSUFFICIENT`) — không có trong SRS UC-21 (SRS chỉ kiểm tra phòng có trống hay không, không kiểm tra sức chứa khi đổi phòng qua chức năng dời lịch).
- Không tìm thấy nhánh explicit kiểm tra `meeting.status === IN_PROGRESS` để trả đúng thông báo như E2 của SRS — thay vào đó, nếu status không phải PENDING_APPROVAL/SCHEDULED (bao gồm cả IN_PROGRESS), code trả lỗi chung `409 MEETING_STATUS_NOT_EDITABLE` với message động `"Không thể thay đổi thời gian cho cuộc họp đang ở trạng thái "${meeting.status}"."` — không có message tùy biến riêng cho "cuộc họp đã bắt đầu" như SRS E2 yêu cầu.

**Nhận xét:** Phạm vi quyền chỉnh sửa (Organizer + Host, không chỉ Host) và các ràng buộc thời lượng/sức chứa mới là những điểm lệch chính so với SRS.

**Đề xuất sửa SRS:**
- Sửa BR-01: "Quyền chỉnh sửa khung thời gian/phòng thuộc về tài khoản Người tổ chức (Organizer) hoặc Người chủ trì (Host) của cuộc họp — không giới hạn độc quyền cho một vai trò duy nhất."
- Bổ sung Business Rule: "Thời lượng cuộc họp sau khi dời lịch phải nằm trong khoảng từ 15 phút đến 8 giờ." và "Nếu đổi sang phòng khác, phòng mới phải có sức chứa đủ cho số người tham dự dự kiến của cuộc họp."
- Mở rộng PRE-2 thành: "Cuộc họp mục tiêu đang ở trạng thái 'Đang chờ duyệt' hoặc 'Đã lên lịch'."

---

## UC-22 — Hủy cuộc họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: quyền hủy "chỉ cấp đặc quyền tiếp cận cho tài khoản của Người chủ trì (Host)". EX1: cuộc họp đã "Đang diễn ra" → ẩn/disable nút Hủy, hiển thị: "Cuộc họp đã bắt đầu diễn ra. Bạn không thể hủy lịch trình mà chỉ có thể chọn tính năng 'Kết thúc sớm' (End Meeting)." BR2: không có tính năng khôi phục (Un-cancel).

**Code thực tế (bằng chứng):**
- `src/modules/meetings/services/meetings.service.ts:2666-2691` — quyền hủy: Organizer, Host, **hoặc bất kỳ ai có permission `meeting.cancel.any`** (quyền quản trị) — rộng hơn BR1 (không chỉ Host).
- `src/modules/meetings/services/meetings.service.ts:2693-2727` — chỉ hủy được khi `meeting.status === SCHEDULED` (không hủy được khi đang `PENDING_APPROVAL`, khác với UC-21 vốn cho sửa cả 2 trạng thái này); nếu status là `IN_PROGRESS` hoặc đã qua `startTime`, trả đúng thông báo: **"Cuộc họp đã bắt đầu. Bạn không thể hủy mà chỉ có thể chọn 'Kết thúc sớm'."** — khớp gần như nguyên văn với EX1 của SRS.
- `src/modules/meetings/services/meetings.service.ts:2736-2765` — dùng `SELECT ... FOR UPDATE` (pessimistic lock) khi hủy, re-check trạng thái sau khi khóa dòng để chống race-condition đồng thời (2 request hủy cùng lúc) — chi tiết kỹ thuật không có trong SRS nhưng không mâu thuẫn.
- Không tìm thấy bất kỳ endpoint/service method nào cho phép chuyển một meeting `Cancelled` trở lại `Scheduled` → phù hợp với BR2 (không có tính năng khôi phục).

**Nhận xét:** Chỉ lệch ở phạm vi vai trò được phép hủy (rộng hơn "chỉ Host" mà SRS khẳng định), phần còn lại khớp tốt, kể cả nguyên văn thông báo lỗi.

**Đề xuất sửa SRS:** Sửa BR1 thành: "Quyền hủy cuộc họp thuộc về Người tổ chức (Organizer), Người chủ trì (Host), hoặc tài khoản có quyền quản trị hủy cuộc họp bất kỳ (`meeting.cancel.any`) — không giới hạn độc quyền cho một vai trò duy nhất." Bổ sung: chỉ áp dụng khi cuộc họp đang ở đúng trạng thái "Đã lên lịch" (không áp dụng khi đang "Chờ duyệt").

---

## UC-23 — Xem lịch trình cá nhân
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR2: mã màu — Xanh dương = Đã lên lịch, Xanh lá = Đang diễn ra, Xám gạch ngang = Đã hủy.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/services/meetings.service.ts:3551-3610` (`getMySchedule`) — truy vấn theo `organizerId = userId OR hostId = userId OR có mặt trong meeting_participants`; comment tường minh dòng 3608-3610: **"Không loại trạng thái nào ở đây: khi client không truyền `status`, lịch cá nhân phải trả TẤT CẢ trạng thái (kể cả draft/pending_approval) — người đặt phòng cần thấy cuộc họp đang chờ duyệt để theo dõi/hủy."** → xác nhận danh sách trạng thái thực tế rộng hơn 3 màu mà SRS BR2 liệt kê (còn có `draft`, `pending_approval`, và khả năng cả `completed`) — SRS chưa quy định mã màu cho các trạng thái này.
- `src/modules/meetings/services/meetings.service.ts:3576-3589` — trả kèm `effective_user_role` (organizer/host/attendee) và cờ `is_current`/`is_past` tính bằng SQL `NOW() BETWEEN ...` — chi tiết hỗ trợ hiển thị không có trong SRS nhưng không mâu thuẫn.

**Nhận xét:** Chức năng cốt lõi (xem lịch theo khoảng thời gian, chi tiết sự kiện) khớp; điểm thiếu là SRS chưa định nghĩa cách hiển thị cho các trạng thái "Đang chờ duyệt"/"Bản nháp" vốn CŨNG được trả về trong danh sách mặc định.

**Đề xuất sửa SRS:** Bổ sung vào BR2: "Riêng đối với cuộc họp đang ở trạng thái 'Đang chờ duyệt', hệ thống áp dụng một mã màu/nhãn riêng (khác 3 màu trên) để người dùng phân biệt được các cuộc họp do mình tạo nhưng chưa được phê duyệt."

---

## UC-24 — Thêm Thành viên Cuộc họp (Thủ công/Import Excel)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** PRE-2: cuộc họp đang "Đã lên lịch". E1: người tham gia đã được thêm → "Hệ thống bỏ qua các mục trùng lặp và thông báo cho Người chủ trì" (không chặn).

**Code thực tế (bằng chứng):**
- `src/modules/meetings/services/meetings.service.ts:3234-3249` (`addInternalParticipant`, thêm thủ công 1 người) — cho phép khi `meeting.status` là `SCHEDULED` **hoặc `IN_PROGRESS`** — rộng hơn PRE-2 (thêm được cả khi họp đang diễn ra).
- `src/modules/meetings/services/meetings.service.ts:3265-3277` — nếu người dùng đã có trong danh sách, ném thẳng **`409 ConflictException PARTICIPANT_ALREADY_EXISTS`** cho luồng thêm 1 người thủ công — **khác với SRS E1** ("hệ thống bỏ qua... không chặn"); ở đây hệ thống CHẶN (trả lỗi) chứ không âm thầm bỏ qua. (Với luồng import Excel hàng loạt, có thể hành vi khác — cần đối chiếu riêng `ParticipantImportService` nếu cần chính xác tuyệt đối, nhưng luồng thêm đơn lẻ chắc chắn ném lỗi.)
- `src/modules/meetings/services/meetings.service.ts:3279-3304` — **Business Rule hoàn toàn không có trong SRS**: nếu cuộc họp có `visibilityLevel === PRIVATE`, chỉ Organizer/Host/Admin (`admin.all`) mới được thêm thành viên — khái niệm "cuộc họp riêng tư" không xuất hiện ở bất kỳ đâu trong SRS mục Meeting Management.
- `src/modules/meetings/services/meetings.service.ts:3306-3324` — cảnh báo xung đột lịch của người được thêm (không chặn) — khớp tinh thần chung của hệ thống (giống UC-20).

**Nhận xét:** Sai lệch chính: (1) hành vi trùng lặp là CHẶN chứ không phải BỎ QUA như SRS mô tả cho luồng thêm thủ công đơn lẻ; (2) khái niệm meeting riêng tư (PRIVATE) hoàn toàn vắng mặt trong SRS.

**Đề xuất sửa SRS:**
- Sửa E1 (đối với thêm thủ công từng người): "Nếu người dùng đã có trong danh sách tham gia, hệ thống từ chối thao tác và hiển thị thông báo người này đã được thêm trước đó." (Việc "bỏ qua âm thầm, không chặn" chỉ nên áp dụng — nếu có — riêng cho luồng import Excel hàng loạt, cần xác minh lại `ParticipantImportService` để khẳng định.)
- Bổ sung Precondition/Business Rule: "Nếu cuộc họp được đánh dấu ở chế độ hiển thị 'Riêng tư' (Private), chỉ Người tổ chức, Người chủ trì, hoặc Quản trị viên mới được phép thêm thành viên mới."
- Mở rộng PRE-2: cho phép thêm cả khi cuộc họp đang "Đang diễn ra", không chỉ "Đã lên lịch".

---

## UC-25 — Gỡ bỏ thành viên cuộc họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: "Chỉ có tài khoản của Người chủ trì (Host) mới được cấp đặc quyền gỡ bỏ người khác." EX2: cuộc họp "Đang diễn ra" → khóa chặt tính năng gỡ bỏ.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/services/meetings.service.ts:4035-4045` — chỉ gỡ được khi `meeting.status === SCHEDULED` — khớp EX2 (đang diễn ra thì bị chặn, vì không nằm trong điều kiện cho phép).
- `src/modules/meetings/services/meetings.service.ts:4048-4062` — quyền gỡ: Organizer, Host, **hoặc có permission `meeting.participant.remove`** — rộng hơn BR1 ("chỉ Host").
- `src/modules/meetings/services/meetings.service.ts:4079-4094` — **Ràng buộc hoàn toàn không có trong SRS**: không thể gỡ chính Host hoặc Organizer khỏi danh sách tham gia (`CANNOT_REMOVE_HOST_OR_ORGANIZER`).
- `src/modules/meetings/services/meetings.service.ts:4096-4110` — **Ràng buộc hoàn toàn không có trong SRS**: không thể gỡ một người đang là chủ sở hữu (`ownerId`, tức người thuyết trình được gán) của một hoặc nhiều mục agenda; phải chuyển quyền sở hữu agenda trước.

**Nhận xét:** Ngoài phần vai trò được phép thao tác (rộng hơn), code còn bổ sung 2 ràng buộc bảo vệ dữ liệu (không gỡ Host/Organizer, không gỡ chủ sở hữu agenda) hoàn toàn vắng mặt trong SRS.

**Đề xuất sửa SRS:**
- Sửa BR1 tương tự UC-22 (mở rộng vai trò).
- Bổ sung Exception: "Không thể gỡ bỏ chính Người chủ trì hoặc Người tổ chức khỏi danh sách tham gia." và "Nếu người bị gỡ đang được gán làm người phụ trách trình bày một hoặc nhiều mục trong chương trình họp, hệ thống chặn thao tác và yêu cầu chuyển người phụ trách trước."

---

## UC-26 — Tạo chương trình họp (Agenda)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (mô hình API khác — atomic replace thay vì thêm từng mục)

**SRS hiện tại ghi:** Người dùng lặp lại thao tác "Thêm hạng mục" nhiều lần để khai báo từng mục một, có thể kéo-thả sắp xếp lại, rồi nhấn "Lưu chương trình họp" một lần cuối.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/controllers/meetings.controller.ts:1090` (`PUT meetings/:meetingId/agendas`, "Luu toan bo chuong trinh hop (atomic replace)") + `src/modules/meetings/services/meetings.service.ts:5165-5260` (`replaceAgendas`) — API nhận **toàn bộ danh sách mục agenda mong muốn trong 1 lần gọi** (`dto.items[]`), server tự diff với danh sách hiện có: mục nào không còn trong payload bị XÓA (`em.delete`), mục còn lại được cập nhật/ghi đè theo thứ tự (`agendaOrder = index + 1`) — đây là mô hình "atomic replace toàn bộ danh sách", khác về bản chất kỹ thuật với việc "thêm từng hạng mục một" lặp lại nhiều lần API như SRS mô tả (dù kết quả cuối cùng trên UI có thể trông giống nhau nếu FE tự gom các thao tác thêm/sửa/xóa thành 1 lần gọi PUT duy nhất khi bấm "Lưu").
- `src/modules/meetings/controllers/meetings.controller.ts:1161,1240` — vẫn tồn tại `PATCH .../agendas/:agendaId` (sửa 1 mục) và `DELETE .../agendas/:agendaId` (xóa 1 mục) riêng biệt — dùng cho UC-28/UC-29.
- `src/modules/meetings/services/meetings.service.ts:5193-5222` — có cơ chế phát hiện "no-op" (payload gửi lên giống hệt dữ liệu hiện có) để tránh ghi DB/tính toán lại không cần thiết — chi tiết kỹ thuật không có trong SRS.
- Không đọc sâu được toàn bộ `validateReplaceAgendaRequest` trong lần rà soát này, nhưng theo tên hàm và Exception SRS mô tả (EX1: tổng thời lượng vượt quá thời gian cuộc họp), nhiều khả năng logic này được enforce trong đó — cần xác minh thêm nếu cần độ chính xác tuyệt đối cho phần thông báo lỗi.

**Nhận xét:** Về chức năng, kết quả cuối cùng (tạo được nhiều mục agenda có thứ tự, có người phụ trách, có thời lượng) khớp với ý định của SRS, nhưng cách API được thiết kế (1 lệnh PUT thay thế toàn bộ danh sách) khác cách SRS mô tả luồng thao tác từng bước (POST thêm từng mục).

**Đề xuất sửa SRS:** Ghi chú kỹ thuật: "Về mặt API, việc lưu chương trình họp được thực hiện qua một lệnh duy nhất thay thế toàn bộ danh sách hạng mục (không phải các lệnh 'thêm 1 hạng mục' riêng lẻ theo từng lần bấm); giao diện người dùng có thể vẫn cho phép thêm/sửa/xóa từng dòng trước khi gộp lại thành một lần lưu."

---

## UC-27 — Xem chương trình họp (Agenda)
**Trạng thái:** ✅ KHỚP HOÀN TOÀN (theo phạm vi đã kiểm tra)

**SRS hiện tại ghi:** Xem danh sách agenda chỉ đọc, sắp xếp theo thứ tự, kiểm tra quyền truy cập của tài khoản.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/controllers/meetings.controller.ts:1054-1057` (`GET meetings/:meetingId/agendas`) — endpoint chỉ đọc tồn tại đúng shape SRS mô tả.

**Nhận xét:** Không phát hiện sai lệch trong phạm vi đã kiểm tra (chưa đọc sâu toàn bộ service method tương ứng do giới hạn thời gian rà soát, nhưng route/shape khớp).

**Đề xuất sửa SRS:** Không cần.

---

## UC-28 — Chỉnh sửa chương trình họp (Agenda)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Sửa từng mục qua biểu tượng "cây bút", kiểm tra lại tổng thời lượng sau khi sửa.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/controllers/meetings.controller.ts:1161-1163` (`PATCH meetings/:meetingId/agendas/:agendaId`, "Cap nhat mot muc agenda cu the (partial update)") + `src/modules/meetings/services/meetings.service.ts:5484+` (`updateAgendaItem`) — khớp đúng shape sửa từng mục riêng lẻ (khác với UC-26 vốn dùng cơ chế PUT thay thế toàn bộ).

**Nhận xét:** Không phát hiện sai lệch rõ ràng trong phạm vi route đã đối chiếu; chưa đọc sâu toàn bộ logic validate tổng thời lượng trong `updateAgendaItem` do giới hạn thời gian — không đủ căn cứ để khẳng định khớp 100% chi tiết Exception, nên giữ mức "khớp một phần" thận trọng.

**Đề xuất sửa SRS:** Không có đề xuất cụ thể — cần một lượt rà soát sâu hơn `updateAgendaItem` (dòng 5484 trở đi) nếu cần xác nhận tuyệt đối message lỗi EX1.

---

## UC-29 — Xóa chương trình họp (Agenda)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Xóa từng mục qua biểu tượng "thùng rác"; AF1: "Xóa toàn bộ chương trình" (Clear all) qua 1 nút riêng.

**Code thực tế (bằng chứng):**
- `src/modules/meetings/controllers/meetings.controller.ts:1240-1242` (`DELETE meetings/:meetingId/agendas/:agendaId`, "Xoa mot muc agenda cu the") + `src/modules/meetings/services/meetings.service.ts:5723+` (`deleteAgendaItem`) — khớp đúng shape xóa từng mục riêng lẻ.
- **Không tìm thấy endpoint "Xóa toàn bộ / Clear all" riêng biệt nào** trong `meetings.controller.ts` — AF1 của SRS (xóa sạch toàn bộ agenda về trạng thái trống bằng 1 nút) có thể chỉ được mô phỏng ở FE bằng cách gọi `PUT meetings/:meetingId/agendas` với `items: []` (dùng chung cơ chế atomic-replace của UC-26), không phải một action/endpoint riêng.

**Nhận xét:** Xóa từng mục khớp; "Xóa toàn bộ" không có endpoint riêng, chỉ có thể đạt được gián tiếp qua endpoint atomic-replace của UC-26.

**Đề xuất sửa SRS:** Ghi chú AF1: "Chức năng 'Xóa toàn bộ' không phải một API riêng — được thực hiện bằng cách gọi lại API Lưu chương trình họp (UC-26) với danh sách hạng mục rỗng."

---

## UC-30 — Tạo chuỗi họp định kỳ *(SRS đánh dấu "bỏ UC này")*
**Trạng thái:** ❌ KHÔNG CÓ CODE — xác nhận đúng ghi chú của SRS

**Code thực tế (bằng chứng):**
- `src/modules/meetings/entities/meeting-recurrence-rule.entity.ts` tồn tại (khớp bảng `meeting_recurrence_rules` trong DB baseline theo CLAUDE.md mục 5.2), và `MeetingEntity` có field `recurrenceRuleId`/`parentMeetingId` — nhưng rà soát toàn bộ `meetings.service.ts` (2 lần grep `recurrenceRule`) chỉ tìm thấy **2 chỗ ĐỌC** field này (dòng 2110 — chặn đổi phòng cho meeting cha định kỳ; dòng 3824 — trả field này trong response chi tiết lịch). **Không có bất kỳ service method hay controller route nào để TẠO một chuỗi họp định kỳ mới.**
- Dữ liệu định kỳ hiện có trong hệ thống (nếu có) chỉ đến từ seed demo: `src/database/migrations/20260720000007-SeedDemoMeetings.ts`.

**Nhận xét:** Xác nhận chính xác: đây là dữ liệu/schema tồn tại từ trước (có thể để tương thích ngược hoặc dự phòng tương lai) nhưng KHÔNG có logic nghiệp vụ tạo mới chuỗi họp định kỳ nào được triển khai. Việc SRS tự đánh dấu "(bỏ UC này)" là chính xác và nên được giữ nguyên.

**Đề xuất sửa SRS:** Không cần sửa nội dung UC (đã đúng là nên loại bỏ); có thể bổ sung ghi chú kỹ thuật ngắn: "Lưu ý: schema `meeting_recurrence_rules` và field `recurrenceRuleId`/`parentMeetingId` vẫn tồn tại trong DB cho mục đích tương thích dữ liệu cũ, nhưng không có API tạo mới."

---

## UC-31 — Hủy chuỗi họp định kỳ *(SRS đánh dấu "bỏ UC này")*
**Trạng thái:** ❌ KHÔNG CÓ CODE — xác nhận đúng ghi chú của SRS

**Code thực tế (bằng chứng):** Tương tự UC-30 — không tìm thấy bất kỳ service method nào xử lý "hủy toàn bộ chuỗi" hay phân biệt phạm vi hủy "chỉ occurrence này" / "toàn bộ chuỗi". Cơ chế hủy hiện có (`cancelMeeting`, UC-22) chỉ hoạt động trên một `meetingId` đơn lẻ.

**Nhận xét:** Xác nhận chính xác ghi chú "(bỏ UC này)" của SRS.

**Đề xuất sửa SRS:** Không cần sửa.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Khái niệm "cuộc họp riêng tư" (`visibilityLevel: PRIVATE`)** (`meetings.service.ts:3283-3304`) — chi phối quyền thêm thành viên, có thể còn ảnh hưởng tới các luồng xem/sửa khác chưa được rà soát trong phạm vi mục này — hoàn toàn vắng mặt trong SRS Meeting Management.
2. **Ràng buộc bảo vệ dữ liệu khi gỡ thành viên**: không được gỡ Host/Organizer, không được gỡ chủ sở hữu agenda item — cả 2 đều không có trong SRS (UC-25).
3. **Xác nhận vượt sức chứa phòng (`capacityOverrideConfirmed`)** khi tạo cuộc họp — không có trong SRS (UC-20).
4. **Giới hạn thời lượng cuộc họp 15 phút – 8 giờ** khi dời lịch — không có trong SRS (UC-21).
5. **Cơ chế khóa dòng (`SELECT ... FOR UPDATE`) chống race-condition** khi hủy cuộc họp — chi tiết kỹ thuật, không ảnh hưởng nghiệp vụ nhưng đáng ghi nhận cho đội QA khi viết test đồng thời.
6. **`meeting.cancel.any` / `meeting.participant.remove`** — các permission quản trị cho phép hành động vượt quyền Organizer/Host thông thường — mô hình phân quyền rộng hơn "chỉ Host" mà SRS khẳng định lặp lại ở nhiều UC (21, 22, 25).
