# Đánh giá SRS — 8. In-Meeting Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "8. In-Meeting Management" (UC-48 → UC-54).
Nguồn code đối chiếu: `src/modules/live-meeting/**` (nhánh `main`, commit `07f47b6`). Ghi chú: code tự đánh số nội bộ UC-IMM-02/03/05/08/09/10 và UC-99, lệch với số hiệu UC-48→54 của SRS — đã đối chiếu theo nội dung nghiệp vụ.

## Tổng quan
Số UC: 7 | Khớp hoàn toàn: 0 | Khớp một phần: 6 | Sai hoàn toàn: 1 (UC-50) | Không có code: 0

---

## UC-48 — Bắt đầu phiên họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: chỉ Host/Organizer được bắt đầu. AF1: bắt đầu qua thiết bị Check-in tại phòng, tự động kích hoạt phiên họp.

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/services/live-meeting.service.ts:176-191` (`startMeeting`) — kiểm tra `organizerId === authUser.userId || hostId === authUser.userId` → khớp chính xác BR1.
- `src/modules/live-meeting/services/live-meeting.service.ts:196-207` — cơ chế idempotent: gọi lại API "Start" khi cuộc họp đã bắt đầu trước đó không báo lỗi, trả về `alreadyStarted: true` — chi tiết kỹ thuật hợp lý, không có trong SRS nhưng không mâu thuẫn.
- `src/modules/live-meeting/services/live-meeting.service.ts:260` (`startMeetingFromDeviceCheckIn`) — tồn tại một luồng bắt đầu riêng qua thiết bị Check-in → khớp đúng AF1 của SRS.
- `src/modules/live-meeting/services/live-meeting.service.ts:227-243` — ngay khi bắt đầu, tự động lên lịch "warning job" (cảnh báo thời gian còn lại, liên kết UC-95 ở Mục 14) — chi tiết kỹ thuật hợp lý không có trong SRS nhưng khớp đúng luồng nghiệp vụ tổng thể (cảnh báo hết giờ được kích hoạt ngay từ lúc bắt đầu).

**Nhận xét:** Không có sai lệch nghiêm trọng; các chi tiết bổ sung (idempotent, tự lên lịch cảnh báo) hợp lý và không mâu thuẫn SRS.

**Đề xuất sửa SRS:** Không bắt buộc.

---

## UC-49 — Yêu cầu gia hạn phiên họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (postcondition thực tế khác biệt lớn)

**SRS hiện tại ghi:** POST-1: "Một yêu cầu gia hạn thời gian (Extension Request) được tạo và gửi đến hệ thống để xử lý." Bước 5: "Hệ thống tiếp nhận yêu cầu và tự động chuyển sang luồng xét duyệt (UC-IMT-03)." — ngụ ý MỌI yêu cầu đều đi qua bước xét duyệt UC-50 (System).

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/services/live-meeting.service.ts:689-861` (`requestExtension`) — kiểm tra hàng loạt điều kiện trước: chỉ Host được yêu cầu (`meeting.hostId !== authUser.userId` → 403), cuộc họp phải `IN_PROGRESS`, thời lượng gia hạn phải nằm trong tập giá trị cho phép (`policy.allowedExtensionMinutes`), giới hạn số lần gia hạn (`maxExtensionCountPerMeeting`) và tổng số phút gia hạn (`maxTotalExtensionMinutesPerMeeting`) — **3 loại giới hạn này hoàn toàn không có trong SRS UC-49** (SRS chỉ có 3 mốc cố định +15/+30/+60 phút, không giới hạn số lần/tổng phút).
- `src/modules/live-meeting/services/live-meeting.service.ts:843-869` — **kiểm tra xung đột phòng NGAY TẠI ĐÂY, TRONG CHÍNH API "yêu cầu gia hạn"** (không phải chuyển tiếp sang 1 luồng xét duyệt riêng): nếu KHÔNG có xung đột → rẽ nhánh PATH A (áp dụng ngay, xem code tiếp theo dòng 861+); nếu CÓ xung đột → rẽ nhánh PATH B = `handleConflictPath`.
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:165-168` — message trả về xác nhận rõ 2 nhánh: PATH A → **"Gia hạn phiên họp thành công"** (áp dụng ngay lập tức, không có bước chờ duyệt nào cả); PATH B → "Phòng đã có lịch sau thời gian hiện tại. Yêu cầu gia hạn đã được gửi đến Manager để xử lý."

**Nhận xét:** SRS mô tả UC-49 như một hành động "gửi yêu cầu" luôn cần một bước xử lý riêng biệt sau đó (UC-50); thực tế, quyết định "không xung đột → áp dụng ngay" được thực hiện NGAY TRONG chính lệnh gọi API của UC-49, không tách rời. Chỉ khi có xung đột, hệ thống mới thực sự tạo một "yêu cầu" đang chờ (pending) để xử lý riêng (UC-50) — xem chi tiết mâu thuẫn nghiêm trọng ở UC-50 bên dưới.

**Đề xuất sửa SRS:** Sửa Postcondition POST-2 thành: "Nếu không phát hiện xung đột phòng, giờ kết thúc phiên họp được cập nhật tăng thêm NGAY LẬP TỨC trong cùng lệnh gọi yêu cầu gia hạn (không có bước chờ duyệt trung gian). Chỉ khi phát hiện xung đột phòng, hệ thống mới tạo một yêu cầu ở trạng thái chờ và chuyển cho một Quản lý xử lý thủ công (xem UC-50)." Bổ sung Business Rule về giới hạn số lần gia hạn tối đa và tổng số phút gia hạn tối đa cho mỗi cuộc họp (cấu hình được).

---

## UC-50 — Phê duyệt/Từ chối Yêu cầu Gia hạn Phiên họp
**Trạng thái:** ❌ SAI HOÀN TOÀN (Primary Actor sai — SRS nói "System" tự động, thực tế là con người quyết định)

**SRS hiện tại ghi:** **Primary Actor: System.** Toàn bộ Normal Flow (5 bước) đều mô tả hành động của "Hệ thống" — không có bất kỳ actor con người nào xuất hiện. AF-1: "Hệ thống tự động chuyển tình trạng yêu cầu thành REJECTED" khi phát hiện xung đột — hoàn toàn tự động, không hỏi ý kiến ai.

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:190-256` (`POST live-meetings/:meetingId/extension-requests/:requestId/decide`) — đây là một **endpoint HTTP được gọi thủ công**, ApiOperation ghi rõ: **"Manager/Admin phê duyệt hoặc từ chối yêu cầu gia hạn phiên họp đang pending"** — một con người thực sự phải gọi API này.
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:181-189` — comment xác nhận rõ ràng: quyền quyết định phụ thuộc `ruleSnapshotJson.approverIds` của từng request cụ thể; `LiveMeetingService.decideExtension()` gọi `checkDecidePermission()` để ném `ForbiddenException` nếu người gọi **không** có quyền `meeting.session.extension.override` **hoặc** (có `meeting.session.extension.decide` **và** có mặt trong `approverIds`) — một cơ chế phân quyền cho NGƯỜI DÙNG, không phải logic hệ thống tự động.
- `src/modules/live-meeting/services/live-meeting.service.ts:1115-1128` (`handleConflictPath`, được gọi bên trong `requestExtension` khi có xung đột) — gọi `resolveApprover(authUser.userId)` để **xác định một người phê duyệt cụ thể (con người)**, tạo request với mã kết thúc bằng `-PENDING`, rồi DỪNG LẠI chờ người đó gọi API "decide" — **không hề tự động REJECT như AF-1 của SRS khẳng định.**
- `src/modules/live-meeting/services/live-meeting.service.ts:1549` (`decideExtension`) — hàm xử lý quyết định thật sự nằm ở đây, được kích hoạt bởi HTTP request của con người, không phải một cron job/background worker nào tự chạy.

**Nhận xét:** Đây là sai lệch nghiêm trọng nhất Mục 8: SRS khẳng định dứt khoát Primary Actor là "System" và mô tả toàn bộ quy trình như một thuật toán tự động (tự động APPROVE nếu rảnh, tự động REJECT nếu xung đột, không có con người tham gia) — nhưng thực tế, nhánh "không xung đột → tự động áp dụng" đã được gộp thẳng vào UC-49 (không phải một bước UC-50 riêng), còn nhánh "có xung đột" trong code lại đòi hỏi MỘT CON NGƯỜI (Manager/Admin có quyền `meeting.session.extension.decide` hoặc `.override`) chủ động vào phê duyệt/từ chối qua giao diện quản trị — hoàn toàn trái ngược với AF-1 của SRS ("Hệ thống tự động chuyển tình trạng yêu cầu thành REJECTED").

**Đề xuất sửa SRS:** Viết lại hoàn toàn UC-50 với Primary Actor là "Manager, Business Admin" (không phải System): "Khi yêu cầu gia hạn của Host phát hiện có xung đột lịch phòng, hệ thống tạo một yêu cầu ở trạng thái chờ và xác định (các) người có quyền phê duyệt tương ứng. Người có quyền `meeting.session.extension.decide` (nằm trong danh sách người duyệt của yêu cầu) hoặc `meeting.session.extension.override` (quyền ghi đè không giới hạn) phải chủ động vào hệ thống để Phê duyệt hoặc Từ chối yêu cầu này — quyết định KHÔNG được đưa ra tự động bởi hệ thống."

---

## UC-51 — Kết thúc phiên họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: cuộc họp COMPLETED không thể "Mở lại" dưới bất kỳ hình thức nào. EX1: quên bấm kết thúc → hệ thống tự động kết thúc phiên họp (chuyển UC-RUN-05).

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/services/live-meeting.service.ts:1909-1927` — quyền kết thúc: Host hoặc Organizer, **hoặc** có permission override `meeting.session.end.any` (kiểm tra ở guard tầng controller) — SRS chỉ liệt kê "Employee (Host)" là Primary Actor, không đề cập override cho Admin.
- `src/modules/live-meeting/services/live-meeting.service.ts:1932-1946` — gọi kết thúc khi cuộc họp đã `COMPLETED` trước đó → `409 ConflictException MEETING_ALREADY_COMPLETED` (không cho phép chạy lại) → khớp gián tiếp tinh thần BR1 (không có đường quay lại).
- **Không tìm thấy trong phạm vi rà soát mục này** một cron job/background worker cụ thể chịu trách nhiệm "tự động kết thúc phiên họp" khi quá giờ và cảm biến không còn phát hiện ai trong phòng (EX1 của SRS) — chỉ thấy bằng chứng gián tiếp qua lịch sử commit gần đây ("R9 — tự động dừng ghi hình cuộc họp", Mục 11 Recording) mô tả việc TỰ ĐỘNG DỪNG GHI HÌNH khi meeting kết thúc, chứ chưa xác nhận được liệu có một cơ chế tự động chuyển chính `meeting.status` sang COMPLETED hay không. **Cần xác minh thêm ở Mục 7 (Room Utilization, UC-44/47) hoặc một service riêng chưa được rà soát** — không kết luận chắc chắn ở đây.

**Nhận xét:** Chức năng lõi khớp đúng SRS; điểm còn bỏ ngỏ là chưa xác minh được chắc chắn cơ chế tự động kết thúc cuộc họp khi quá giờ (EX1).

**Đề xuất sửa SRS:** Bổ sung: "Quyền kết thúc phiên họp cũng có thể được thực hiện bởi tài khoản có quyền quản trị ghi đè (`meeting.session.end.any`), không giới hạn chỉ ở Host/Organizer." Khuyến nghị đội BE xác nhận lại sự tồn tại (hoặc không) của cơ chế tự động kết thúc phiên họp khi quá giờ trước khi coi EX1 là đã được kiểm chứng.

---

## UC-52 — Xem Hiện diện & Trạng thái Điểm danh Trực tiếp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Hai luồng con: xem hiện diện trực tiếp và xem trạng thái điểm danh, dùng chung 1 màn hình.

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:315-462` (`GET live-meetings/:meetingId/present-attendees`) — hỗ trợ tìm kiếm (`search`, tối đa 100 ký tự), lọc theo `departmentId`, phân trang, sắp xếp theo `full_name/department_name/presence_status/joined_at` — phong phú hơn SRS mô tả (SRS chỉ nói hiển thị danh sách, không đề cập tìm kiếm/lọc/sắp xếp ở luồng hiện diện).
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:464-480` — comment quan trọng: route `live-meetings/:meetingId/attendance` (UC-IMM-08, dùng cho UC-52 tại đây) **khác biệt có chủ đích** với route điểm danh chung `attendance.controller.ts` (dùng cho UC-63 ở Mục 10) — route ở đây gắn ràng buộc trạng thái phiên phải đang `in_progress`/vừa kết thúc, trả `409` nếu không đúng trạng thái; route kia (Mục 10) không có ràng buộc trạng thái phiên. Đây là điểm cần lưu ý khi đối chiếu chéo với Mục 10 (Attendance & Presence Management) để tránh nhầm 2 route là một.

**Nhận xét:** Chức năng lõi khớp; điểm cần làm rõ là quan hệ giữa 2 API điểm danh gần giống nhau (1 gắn với live-session, 1 không) — SRS coi đây là 1 UC duy nhất nhưng thực tế BE có 2 route riêng phục vụ 2 ngữ cảnh khác nhau (Mục 8 vs Mục 10).

**Đề xuất sửa SRS:** Ghi chú: "API xem điểm danh trong ngữ cảnh phiên họp đang diễn ra (đòi hỏi cuộc họp ở trạng thái 'Đang diễn ra') là một endpoint riêng biệt với API xem danh sách điểm danh tổng quát (không ràng buộc trạng thái phiên, xem mục Attendance & Presence Management)."

---

## UC-53 — Thêm ghi chú trong cuộc họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Ghi chú có 2 lựa chọn hiển thị: "Chia sẻ chung" hoặc "Chỉ mình tôi" (Private).

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:651-663` — `noteType` thực tế có **4 giá trị**: `in_meeting, private, host_note, system_note`; `visibility` có **4 mức**: `private, participants, public_internal, department` — mô hình phong phú hơn hẳn 2 lựa chọn nhị phân mà SRS mô tả.
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:602-605` — loại ghi chú `system_note` bị **CẤM** tạo qua API dành cho người dùng (422 "Loai ghi chu system_note khong duoc phep") — ngụ ý hệ thống tự sinh loại ghi chú này ở một luồng khác (rất có thể tự động log các mốc sự kiện quan trọng vào cùng dòng thời gian ghi chú) — hoàn toàn không có trong SRS.
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:593-596` — lỗi `NOTE_HOST_ONLY` (403) tồn tại — gợi ý có ràng buộc chỉ Host mới tạo được 1 số loại ghi chú nhất định (có thể là `host_note`) — chi tiết không có trong SRS.

**Nhận xét:** Mô hình dữ liệu ghi chú của code phức tạp hơn nhiều so với mô hình nhị phân "Chia sẻ chung/Chỉ mình tôi" mà SRS mô tả.

**Đề xuất sửa SRS:** Sửa bước 5 thành: "Người dùng chọn mức độ chia sẻ ghi chú trong 4 mức: Riêng tư (chỉ mình tôi), Người tham gia (participants), Nội bộ công khai (public_internal), hoặc Theo phòng ban (department)." Bổ sung ghi chú: "Hệ thống còn tự động sinh một loại ghi chú đặc biệt (system_note) để ghi lại các mốc sự kiện quan trọng — loại này không thể tạo thủ công qua giao diện người dùng."

---

## UC-54 — Xem & Tìm kiếm Ghi chú trong Cuộc họp
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR-01: Host là người DUY NHẤT được xem tất cả ghi chú (cả riêng tư và chia sẻ); Người tham gia không bao giờ được xem ghi chú riêng tư của Host. BR-03: tìm kiếm không phân biệt hoa/thường, hỗ trợ tiếng Việt không dấu.

**Code thực tế (bằng chứng):**
- `src/modules/live-meeting/controllers/live-meeting.controller.ts:651-663,671-707` (`ViewNotesQueryDto`) — hỗ trợ lọc theo `noteType`, `visibility`, `pinned`, khoảng thời gian (`from`/`to`), `includeSourceEvent` (opt-in enrich), sắp xếp `timeline_asc/desc`, phân trang (tối đa 100/trang) — phong phú hơn hẳn SRS (SRS chỉ nói "tìm kiếm theo từ khóa hoặc chọn bộ lọc (Tag, Tác giả, Thời gian)" — không có `pinned`, không có lọc theo `visibility`/`noteType` như 2 trục dữ liệu đã thấy ở UC-53).
- Với mô hình 4-mức `visibility` (thay vì nhị phân riêng tư/chia sẻ như SRS), quy tắc BR-01 của SRS ("Host xem tất cả, Participant không bao giờ xem note riêng tư") **cần được diễn giải lại theo 4 mức** — **chưa xác minh được trong phạm vi rà soát này** liệu `viewMeetingNotes()` có đúng áp dụng quy tắc "Host luôn thấy hết, các mức khác lọc theo vai trò" hay không (cần đọc sâu `LiveMeetingService.viewMeetingNotes`, chưa thực hiện do giới hạn thời gian).
- Không tìm thấy bằng chứng về "tìm kiếm tiếng Việt không dấu" (BR-03) trong phạm vi các file đã đọc (endpoint không có tham số `search` từ khóa tường minh trong `listNotes`, chỉ có bộ lọc theo `noteType`/`visibility`/`pinned`/khoảng ngày — **không có ô tìm kiếm từ khóa nào được phát hiện**, khác với SRS mô tả "tìm kiếm" như tính năng chính của UC-54).

**Nhận xét:** Cấu trúc lọc phong phú hơn SRS nhưng lại **thiếu đúng chức năng "tìm kiếm từ khóa"** mà chính tên UC-54 nhấn mạnh — chỉ có lọc theo thuộc tính (loại/mức chia sẻ/đã ghim/khoảng thời gian), không thấy tham số tìm từ khóa trong nội dung ghi chú.

**Đề xuất sửa SRS:** Khuyến nghị xác minh lại với đội BE liệu có tham số tìm kiếm từ khóa nội dung ghi chú hay không (có thể nằm trong `ViewNotesQueryDto` nhưng chưa được liệt kê ở `@ApiQuery` trong phạm vi đã đọc); nếu thực sự không có, cần bổ sung hoặc điều chỉnh lại UC-54 để phản ánh đúng: hệ thống hiện chỉ hỗ trợ LỌC theo thuộc tính, chưa hỗ trợ tìm kiếm toàn văn nội dung ghi chú.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Giới hạn số lần gia hạn tối đa và tổng số phút gia hạn tối đa mỗi cuộc họp** (`maxExtensionCountPerMeeting`, `maxTotalExtensionMinutesPerMeeting`, cấu hình được) — hoàn toàn không có trong SRS UC-49.
2. **`GET meetings/:meetingId/timeline`** (`live-meeting.controller.ts:757`, tự gắn nhãn "UC-99") — gộp `meeting_events` + `attendance_events` + `meeting_notes` thành một dòng thời gian tổng hợp — không có UC tương ứng nào trong SRS mục 8 hay bất kỳ mục nào đã rà soát tới nay.
3. **Loại ghi chú `system_note`** (tự động, không tạo được qua UI) — không có trong SRS.
4. **Cơ chế "warning job" tự động lên lịch cảnh báo thời gian còn lại ngay khi bắt đầu cuộc họp** (`startMeeting`, dòng 227-243) — liên kết với UC-95 (Mục 14) nhưng bản thân việc lên lịch nằm ở đây, không được SRS UC-48 nhắc tới.
