# Đánh giá SRS — Minutes & Knowledge Management

## Tổng quan

Số UC: 9 | Khớp hoàn toàn: 3 | Khớp 1 phần: 6 | Sai hoàn toàn: 0 | Không có code: 0

Đây là module có độ khớp cao nhất trong toàn bộ audit tính đến thời điểm này — kiến trúc code (`src/modules/minutes/`) bám khá sát tinh thần SRS, với các comment nội bộ gắn nhãn tường minh từng UC (`UC-MKM-01` → `UC-MKM-09`). Điểm lệch chủ yếu nằm ở các chi tiết vận hành cụ thể (kênh gửi thông báo, đồng bộ/bất đồng bộ, một vài Business Rule phụ), không phải sai lệch kiến trúc lớn như các Mục trước.

---

## UC-85 — Tạo biên bản họp nháp

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Form soạn thảo hiển thị "các template có sẵn (Tóm tắt, Quyết định, Hành động)".

**Code thực tế (bằng chứng):**
- Route: `POST meetings/:meetingId/minutes`, permission `meeting.minutes.create` — `src/modules/minutes/controllers/minutes.controller.ts:35-83`.
- `createDraft()` (`src/modules/minutes/services/minutes.service.ts:141-293`): kiểm tra đúng thứ tự — meeting tồn tại (149-162), meeting có `hostId` (164-175), **chỉ Host mới được tạo** (177-185, khớp SRS PRE-2), meeting phải `IN_PROGRESS` hoặc `COMPLETED` — hằng số `MEETING_STATUSES_ALLOWED_FOR_MINUTES = [IN_PROGRESS, COMPLETED]` (dòng 98-101, khớp chính xác PRE-1 "đã diễn ra hoặc đang diễn ra"), tối đa 1 minutes active/meeting (209-225, `MINUTES_ALREADY_EXISTS`), snapshot danh sách tham dự tại thời điểm tạo (227-239).
- Nội dung mặc định: `DEFAULT_MINUTES_CONTENT = '1. Thành phần tham dự\n2. Nội dung cuộc họp\n3. Kết luận\n4. Đầu việc (Action items)'` (dòng 95-96) — **4 mục, tên khác** với "template" mà SRS nêu ("Tóm tắt, Quyết định, Hành động" — 3 mục).

**Nhận xét:**
Toàn bộ business rule (actor, precondition, 1:1 constraint, snapshot tham dự) khớp chính xác. Chỉ riêng nội dung mẫu mặc định có tên mục khác với SRS mô tả — chi tiết nhỏ, không ảnh hưởng luồng nghiệp vụ.

**Đề xuất sửa SRS:**
> Nội dung nháp mặc định gồm 4 mục: "Thành phần tham dự", "Nội dung cuộc họp", "Kết luận", "Đầu việc (Action items)" — không phải 3 template "Tóm tắt/Quyết định/Hành động" như mô tả hiện tại.

---

## UC-86 — Xem danh sách biên bản họp

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Host/Creator thấy cả DRAFT và OFFICIAL; Participant thường chỉ thấy OFFICIAL đã ban hành.

**Code thực tế (bằng chứng):**
- Route: `GET meeting-minutes`, permission `meeting.minutes.read` — `src/modules/minutes/controllers/minutes-list.controller.ts:63-132`.
- `findMinutesList()` (`minutes.service.ts:295-...`, scope non-admin tại dòng 341-370): người không phải Admin chỉ thấy (a) minutes `status=draft` do chính mình `preparedBy`, HOẶC (b) minutes `status IN (published, archived)` mà mình là `meeting.hostId` hoặc có mặt trong `meeting_participants` — khớp chính xác tinh thần SRS (đổi tên OFFICIAL→published, có thêm archived).

**Nhận xét:** Không phát hiện sai lệch. Tên trạng thái thực tế là `published`/`archived` thay vì "OFFICIAL" — xem ghi chú chung ở UC-91 về mô hình 4 trạng thái.

---

## UC-87 — Xem chi tiết biên bản họp

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** EX1 — cố mở DRAFT không phải của mình (bằng link trực tiếp) → chặn, 403 Forbidden.

**Code thực tế (bằng chứng):**
- Route: `GET meeting-minutes/:id`, permission `meeting.minutes.read` — `minutes-list.controller.ts:177-213`.
- `findMinutesDetail()` (`minutes.service.ts:958-1009`): non-admin phải qua `canAccessMinutes()` (dòng 994-1002), thất bại → `ForbiddenException` code `MEETING_MINUTES_ACCESS_DENIED` (dòng 1003-1008) — khớp chính xác EX1.

**Nhận xét:** Không phát hiện sai lệch.

---

## UC-88 — Cập nhật nội dung biên bản họp

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR1: chỉ biên bản DRAFT mới được Update. EX1: biên bản đã OFFICIAL → ẩn nút, API từ chối lưu.

**Code thực tế (bằng chứng):**
- Route: `PATCH meeting-minutes/:id`, permission `meeting.minutes.update` — `minutes-list.controller.ts:215-261`. Response codes khai báo: `409 MINUTES_NOT_DRAFT / MINUTES_VERSION_CONFLICT` (dòng 233-236).

**Nhận xét:**
BR1/EX1 khớp đúng (`MINUTES_NOT_DRAFT`). Tuy nhiên code có thêm cơ chế `MINUTES_VERSION_CONFLICT` (optimistic concurrency theo `versionNo`) hoàn toàn không được SRS nhắc tới — nghĩa là 2 người cùng sửa 1 bản nháp có thể bị 1 người từ chối lưu dù cả hai đều có quyền Edit hợp lệ.

**Đề xuất sửa SRS:**
> Bổ sung: cập nhật biên bản dùng cơ chế optimistic locking theo `versionNo` — nếu phiên bản client gửi lên không khớp phiên bản mới nhất trên server (đã bị người khác sửa trước đó), hệ thống từ chối lưu với lỗi `MINUTES_VERSION_CONFLICT` (409), yêu cầu người dùng tải lại nội dung mới nhất trước khi sửa tiếp.

---

## UC-89 — Xóa biên bản họp nháp

**Trạng thái:** ✅ KHỚP HOÀN TOÀN

**SRS hiện tại ghi:** Soft-delete DRAFT, Host/Admin, chặn xóa OFFICIAL, cảnh báo "không thể khôi phục".

**Code thực tế (bằng chứng):**
- Route: `DELETE meeting-minutes/:id`, permission `meeting.minutes.delete` — `minutes-list.controller.ts:263-302`.
- `deleteDraft()` (`minutes.service.ts:1576-1702`): owner-or-admin (1606-1619), chặn nếu không phải `draft` → `MINUTES_NOT_DRAFT` (1621-1629, khớp EX1/BR1), set `status=DELETED` + `deletedAt` (1631-1637, đúng soft-delete), cascade xóa mềm toàn bộ attachment liên quan (1638-1646), ghi audit log (1647-1662).

**Nhận xét:** Khớp đầy đủ. Có thêm tính năng tốt hơn SRS: khi Admin xóa hộ, hệ thống gửi in-app notification báo cho người đã tạo bản nháp biết (dòng 1671-1698) — không mâu thuẫn SRS.

---

## UC-90 — Tìm kiếm & Lọc Biên bản (theo Thời gian/Nhân sự)

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi (Other Information):** "Gộp từ UC-MKM-06 (lọc thời gian) và UC-MKM-07 (tìm theo nhân sự) — **cùng một thao tác Đọc trên cùng một danh sách**, chỉ khác tiêu chí lọc." BR-01: Business Admin xem toàn công ty; Manager chỉ xem biên bản trong phạm vi phòng ban mình quản lý.

**Code thực tế (bằng chứng):** Thực tế là **2 route tách biệt**, không phải 1 thao tác Đọc duy nhất:
1. `GET meeting-minutes` (lọc theo `from`/`to`/`q`, permission `meeting.minutes.read`) — `minutes-list.controller.ts:63-132` — đảm nhiệm phần "lọc theo thời gian".
2. `GET meeting-minutes/search-by-person` (permission RIÊNG `meeting.minutes.search_by_person`, DTO riêng `SearchMinutesByPersonQueryDto`) — `minutes-list.controller.ts:133-175` — đảm nhiệm phần "tìm theo nhân sự".
- `searchMinutesByPerson()` (`minutes.service.ts:2105-2214+`): **CÓ** đúng BR-01 — Manager (không phải Admin) bị giới hạn theo `managedDepartmentIds` lấy từ `DepartmentEntity.managerUserId` (dòng 2137-2158, 2199-2214).
- Ngược lại, `findMinutesList()` (route #1, lọc theo thời gian) **KHÔNG có** logic giới hạn theo phòng ban cho Manager — non-admin chỉ thấy minutes họ tự `preparedBy`/`hostId`/`participant` (đã xem ở UC-86), **không có nhánh nào cấp quyền "Manager xem theo phạm vi phòng ban"** như BR-01 yêu cầu.

**Nhận xét:**
1. SRS khẳng định đây là "cùng một thao tác Đọc trên cùng một danh sách" — sai với thực tế: 2 endpoint riêng, 2 permission riêng, 2 DTO riêng.
2. BR-01 (Manager xem theo phạm vi phòng ban) chỉ được áp dụng cho nhánh "tìm theo nhân sự" (`search-by-person`), **không** được áp dụng cho nhánh "lọc theo thời gian" (`GET meeting-minutes` với `from`/`to`) — một Manager dùng bộ lọc thời gian thông thường sẽ chỉ thấy biên bản họ tự tham gia, không thấy toàn bộ biên bản phòng ban mình quản lý như BR-01 mô tả.

**Đề xuất sửa SRS:**
> Đây là 2 endpoint tách biệt: `GET /meeting-minutes?from=...&to=...&q=...` (lọc thời gian + tìm kiếm chung, phạm vi: `draft` của chính mình + `published/archived` mà mình là Host/participant — **không** có mở rộng theo phòng ban cho Manager) và `GET /meeting-minutes/search-by-person?userId=...` (tra cứu theo 1 nhân sự cụ thể, permission riêng `meeting.minutes.search_by_person` — **có** áp dụng BR-01: Manager chỉ thấy biên bản của phòng ban mình quản lý, Business/System Admin thấy toàn công ty).

---

## UC-91 — Ban hành & Phân phối Biên bản Họp Chính thức

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Secondary Actor: **Email Service**. POST-2: "Một **email** chứa liên kết truy cập hoặc **tệp đính kèm** được gửi thành công đến mọi người". Normal Flow bước 6: "gửi email thông báo... qua Email Service".

**Code thực tế (bằng chứng):**
- Route: `POST meeting-minutes/:id/issue`, permission `meeting.minutes.issue` — `minutes-list.controller.ts:304-341`.
- `issueMinutes()` (`minutes.service.ts:1709-1852`): owner-or-admin (1742-1754), chặn nếu không phải `draft` → `MINUTES_NOT_DRAFT` (1756-1766), **chặn nếu meeting chưa `COMPLETED`** → `MEETING_NOT_COMPLETED` (1768-1781, khớp đúng PRE-3), chuyển `status=PUBLISHED` + `issuedBy`/`issuedAt` (1783-1790).
- Bước "phân phối" (dòng 1809-1839): tạo **duy nhất 1 bản ghi `NotificationEntity`** với `channel: NotificationChannel.IN_APP` (dòng 1821-1831) gửi cho toàn bộ `meeting_participants` (trừ người ban hành) — **không có bất kỳ lệnh gửi email nào**, không tạo/đính kèm file PDF/Word nào tại thời điểm ban hành (việc xuất file là hành động riêng, xem UC-92, chỉ chạy khi người dùng chủ động yêu cầu sau đó).

**Nhận xét:**
1. "Email Service" không được gọi — thông báo ban hành chỉ là **in-app notification**, không phải email như SRS khẳng định là actor phụ và là nội dung POST-2/bước 6.
2. Không có tệp đính kèm (PDF/Word) nào được sinh/gửi kèm tại thời điểm ban hành — xuất file là một hành động on-demand hoàn toàn tách biệt (UC-92).
3. Điểm khớp: BR-02 (gửi mặc định 100% người tham gia, không lọc theo trạng thái) khớp đúng — `recipientUserIds` lấy toàn bộ `meeting_participants` không lọc gì thêm ngoài loại trừ chính người ban hành.

**Đề xuất sửa SRS:**
> Secondary Actor: không có Email Service — phân phối chỉ qua **in-app notification** (`notificationType: MINUTES_DISTRIBUTION`) gửi cho toàn bộ `meeting_participants` (trừ người thực hiện ban hành). Không có tệp đính kèm PDF/Word được gửi kèm lúc ban hành — người nhận phải tự vào xem biên bản trong hệ thống (hoặc tự yêu cầu xuất file riêng qua UC-92 nếu cần). PRE-3 (cuộc họp phải đã kết thúc — `COMPLETED`) được enforce đúng.

---

## UC-92 — Xuất Biên bản Họp (PDF/Word)

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Bước 5: "hệ thống xác thực quyền, **tạo tệp**... và **bắt đầu quá trình tải xuống**" (hàm ý đồng bộ, ngay lập tức). BR-02: mọi tệp xuất phải có **header hiển thị tên công ty/dự án** và **footer đánh số trang tự động ("Trang X / Y")**.

**Code thực tế (bằng chứng):**
- Route: `POST meeting-minutes/:id/exports`, trả **202 Accepted** (bất đồng bộ) — `minutes-list.controller.ts:524-564`, comment dòng 532-536: "bat dong bo... Tra 202 + jobId; poll GET /background-jobs/:jobId roi GET /media-files/:fileId de lay downloadUrl".
- `createExportJob()` (`minutes-export.service.ts:52-...`): thêm điều kiện **chỉ export khi `status=PUBLISHED`** → `MINUTES_NOT_PUBLISHED` nếu không (dòng 94-104) — điều kiện này **không có** trong SRS (SRS chỉ yêu cầu "văn bản biên bản hoặc transcript đã tạo đầy đủ", không giới hạn phải đã ban hành chính thức).
- `renderMeetingMinutesPdf()` (`src/modules/minutes/renderers/meeting-minutes-pdf-renderer.ts:16-50+`): có header nhưng là **tiêu đề tài liệu** ("BIÊN BẢN CUỘC HỌP" + tên cuộc họp + trạng thái + ngày ban hành, dòng 28-48) — **không có tên công ty/dự án**. Grep `header|footer|Trang|pageNumber` trong toàn bộ file renderer: **0 kết quả cho footer/số trang** — không tìm thấy cơ chế đánh số trang tự động "Trang X/Y".

**Nhận xét:**
1. Luồng thực tế là **bất đồng bộ** (202 + job queue + poll + fetch download URL riêng), khác với luồng đồng bộ "tạo tệp → tự động tải xuống ngay" mà SRS mô tả.
2. Chỉ xuất được biên bản đã `PUBLISHED` — biên bản DRAFT không thể xuất (SRS không nói rõ giới hạn này).
3. BR-02 (header tên công ty + footer số trang tự động) **không được implement** — PDF renderer chỉ có tiêu đề tài liệu, không có tên tổ chức, không có số trang.

**Đề xuất sửa SRS:**
> Xuất biên bản là thao tác **bất đồng bộ**: `POST /meeting-minutes/:id/exports` trả về 202 + `jobId` ngay lập tức; client phải tự poll `GET /background-jobs/:jobId` tới khi job hoàn tất, sau đó gọi `GET /media-files/:fileId` để lấy `downloadUrl` thật. Chỉ áp dụng được cho biên bản đã ở trạng thái **published** (`MINUTES_NOT_PUBLISHED` nếu còn draft). File PDF/Word xuất ra có tiêu đề tài liệu (tên cuộc họp, trạng thái, ngày ban hành) nhưng **chưa có** tên công ty/dự án ở header, và **chưa có** footer đánh số trang tự động.

---

## UC-93 — AI Meeting Summarization

**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** BR-01: suy luận bắt buộc trên self-hosted LLM (**Qwen 2.3B**), cấm gửi ra ngoài. BR-02: luôn ở "Nháp", cần người duyệt trước khi công khai. BR-03: chỉ Host/Admin sửa+công khai. E1: dịch vụ AI timeout → thông báo lỗi tức thời, chuyển sang luồng thủ công.

**Code thực tế (bằng chứng):**
- Route: `POST meetings/:meetingId/minutes/ai-draft-jobs`, trả **202 Accepted** (bất đồng bộ) — `src/modules/minutes/controllers/minutes-ai-draft.controller.ts:39-103`. Comment dòng 53-57 xác nhận: "Host cua cuoc hop (hoac System Admin) tao background job sinh ban nhap... bang LLM self-hosted... AI chi tao draft, khong tu publish (FR-001)" — khớp đúng BR-02/BR-03.
- `LlmProviderFactory.resolve()` (`src/modules/minutes/ai/llm-provider.factory.ts:14-34`): provider có thể là `mock` (dev/test) hoặc `self_hosted_llm` → `OllamaLlmProvider`, chọn qua `system_configs` (không hard-code) — khớp đúng BR-01 (self-hosted, cấm public API).
- `ollama-llm.provider.ts:44` — comment "context_length toi da cua qwen2.5:3b/7b-instruct" — model thật là **Qwen2.5 (3B/7B)**, khớp gần đúng "Qwen 2.3B" của SRS (chênh lệch tên phiên bản nhỏ — nhiều khả năng SRS gõ tắt/nhầm "Qwen2.5:3B" thành "Qwen 2.3B").
- `createAiDraftJob` dùng chung ràng buộc 1:1 với minutes thường (`MINUTES_ALREADY_EXISTS`) — nghĩa là AI draft **chính là** bản ghi `meeting_minutes` duy nhất của cuộc họp đó (không phải một entity "tóm tắt" tách biệt) — khớp đúng ý "AI sinh nội dung cho CÙNG 1 biên bản mà người dùng có thể sửa/công khai qua UC-91".
- `forceRerun` trong `CreateAiDraftJobDto` (`src/modules/minutes/dto/create-ai-draft-job.dto.ts:8,34`) — khớp đúng AF-2 (sinh lại/Regenerate).
- Toàn bộ luồng là **bất đồng bộ** (202 + `background_jobs`, theo dõi qua `GET .../ai-draft-jobs`) — khác với văn phong SRS mô tả Normal Flow như một luồng đồng bộ ("Hệ thống gửi yêu cầu... Mô hình AI xử lý và trả về... Hệ thống hiển thị bản tóm tắt").

**Nhận xét:**
1. Nội dung nghiệp vụ cốt lõi (self-hosted LLM, không tự publish, chỉ Host/Admin, có Regenerate) khớp rất tốt với SRS.
2. Model thật là Qwen**2.5** (3B/7B, cấu hình được), không phải cố định "Qwen 2.3B" như SRS ghi — chênh lệch nhỏ, khả năng cao là lỗi đánh máy trong SRS.
3. Luồng xử lý là **bất đồng bộ qua job queue**, không phải luồng đồng bộ chờ-phản-hồi-ngay như Normal Flow SRS mô tả — kéo theo E1 (xử lý timeout) thực tế biểu hiện dưới dạng **job chuyển trạng thái failed** (client phải tự poll để biết), không phải một thông báo lỗi tức thời ngay trên màn hình như SRS ngụ ý.

**Đề xuất sửa SRS:**
> Luồng tạo tóm tắt AI là **bất đồng bộ**: Host bấm "Tạo tóm tắt bằng AI" → hệ thống trả về ngay 1 `jobId` (202 Accepted) và đưa job vào hàng đợi xử lý nền; FE phải tự poll `GET /meetings/:meetingId/minutes/ai-draft-jobs` để biết khi nào job hoàn tất/thất bại. AI-draft chính là bản ghi `meeting_minutes` DUY NHẤT của cuộc họp (không phải một object "tóm tắt" tách biệt) — nếu cuộc họp đã có biên bản (kể cả biên bản tạo thủ công), không tạo được AI-draft mới (`MINUTES_ALREADY_EXISTS`). Model self-hosted thực tế là Qwen2.5 (3B hoặc 7B tùy cấu hình `system_configs`), không cố định "Qwen 2.3B". E1 (lỗi/timeout AI) thể hiện qua trạng thái job `failed` (client tự phát hiện qua polling), không phải một thông báo lỗi đồng bộ tức thời trên màn hình.

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **Chia sẻ biên bản cho 1 user cụ thể** (`POST/GET/DELETE meeting-minutes/:id/shares[/:userId]`, permission `meeting.minutes.share.*`) — Host/Admin cấp quyền xem read-only cho 1 user nội bộ bất kỳ NGOÀI danh sách participant gốc, chỉ áp dụng khi biên bản đã `published` (`minutes-list.controller.ts:399-522`). Hoàn toàn không có trong SRS.
2. **Đính kèm tài liệu vào biên bản** (upload/list/delete, `POST/GET/DELETE meeting-minutes/:minutesId/attachments[/:fileId]`, dòng 566-725) — chỉ khi biên bản còn `draft`, có giới hạn số lượng (`ATTACHMENT_LIMIT_EXCEEDED`) và loại/kích thước file. SRS không hề nhắc tới việc biên bản có thể có file đính kèm riêng (khác với việc xuất chính biên bản ra PDF/Word).
3. **Liên kết/hủy liên kết recording + transcript với biên bản** (`PATCH meeting-minutes/:id/link-resources`, dòng 344-397, gắn nhãn nội bộ "UC-141") — chỉ khi biên bản `draft` và meeting đã `completed`. Không có trong SRS Mục 13.
4. **Endpoint feature-flag AI draft** (`GET meetings/:meetingId/minutes/ai-draft-config`, trả `enabled`/`requireHumanReview` từ `system_configs[ai.minutes_summary]`) — cho phép FE quyết định ẩn/hiện nút "Tạo bằng AI" theo cấu hình admin — không có trong SRS.
5. **Mô hình trạng thái 4 giá trị** `draft/published/archived/deleted` (`meeting-minutes.entity.ts:16-21`) — SRS chỉ mô tả 2 trạng thái nhị phân DRAFT/OFFICIAL, không có khái niệm `archived` (biên bản đã ban hành nhưng được lưu trữ/gác lại) hay `deleted` như một trạng thái tường minh (thay vì xóa hẳn khỏi bảng).
6. **Mô hình phân cấp hiển thị 4 mức** `visibilityLevel: private/participants/department/public_internal` (`meeting-minutes.entity.ts:23-28`, mặc định `PRIVATE` khi tạo draft) — SRS chỉ có mô hình nhị phân "chỉ tác giả xem" (draft) / "toàn bộ danh sách phân phối xem" (official) — mức độ enforce đầy đủ của 4 cấp này trong các luồng đọc chưa được xác minh sâu ở audit này.
