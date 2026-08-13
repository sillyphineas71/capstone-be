# Đánh giá SRS — 5. Equipment Management

Nguồn SRS đối chiếu: `SRS tiếng Việt.md`, mục "5. Equipment Management" (UC-36 → UC-40).
Nguồn code đối chiếu: `src/modules/equipment/**` (nhánh `main`, commit `07f47b6`). Ghi chú: code tự đánh số nội bộ UC-61→UC-65, lệch với số hiệu UC-36→40 của SRS — đã đối chiếu theo đúng nội dung nghiệp vụ, không theo số hiệu.

## Tổng quan
Số UC: 5 | Khớp hoàn toàn: 0 | Khớp một phần: 4 | Sai hoàn toàn: 1 | Không có code: 0

---

## UC-36 — Đăng ký thiết bị mới (thủ công)
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Form nhập "Tên thiết bị, Loại thiết bị, Mã tài sản, và Mô tả thêm (nếu có)". BR2: "Mọi thiết bị mới khi đưa lên hệ thống thông qua luồng này đều được ngầm định ở trạng thái ban đầu là 'Đang hoạt động tốt'. Trạng thái hỏng hóc hoặc bảo trì chỉ được ghi nhận thông qua một quy trình cập nhật trạng thái riêng."

**Code thực tế (bằng chứng):**
- `src/modules/equipment/dto/create-equipment.dto.ts:21-75` (`CreateEquipmentDto`) — các trường thực tế: `equipmentName`, `equipmentType` (enum bắt buộc: camera/microphone/display/speaker/capture_agent/sensor/other), `equipmentCode` (bắt buộc, định dạng `A-Z0-9-`, khớp vai trò "Mã tài sản" của SRS), **`serialNumber`** (tùy chọn, **duy nhất riêng biệt với equipmentCode**), `brand`, `model`, `purchaseDate` (không được ở tương lai), `specification` (JSON object có cấu trúc) — **5 trường (serialNumber/brand/model/purchaseDate/specification) hoàn toàn không có trong form SRS**, và ngược lại **không có trường "Mô tả thêm" dạng văn bản tự do** như SRS mô tả (chỉ có `specification` dạng object có cấu trúc).
- `src/modules/equipment/entities/equipment.entity.ts:32-38` — `HealthStatus` có 5 giá trị: `healthy, warning, faulty, offline, unknown`.
- `src/modules/equipment/dto/create-equipment.dto.ts:69-74` — **`healthStatus` là trường CÓ THỂ gửi từ client khi tạo** (`@IsOptional`, cho phép bất kỳ giá trị nào trong 5 giá trị trên, kể cả `faulty`/`offline`).
- `src/modules/equipment/services/equipment.service.ts:144` — `healthStatus: dto.healthStatus ?? HealthStatus.UNKNOWN` → **giá trị mặc định khi không truyền là `UNKNOWN` ("không xác định"), KHÔNG PHẢI `HEALTHY` ("Đang hoạt động tốt") như BR2 khẳng định** — đây là mâu thuẫn trực tiếp cả về (a) giá trị mặc định sai theo BR2, lẫn (b) khả năng client có thể tự đặt trạng thái khác "hoạt động tốt" ngay từ lúc tạo, trong khi BR2 khẳng định trạng thái hỏng hóc "chỉ được ghi nhận thông qua một quy trình cập nhật trạng thái riêng" (tức là không được set ngay tại bước tạo).
- `src/modules/equipment/services/equipment.service.ts:143` — `assetStatus: AssetStatus.AVAILABLE` set cứng, không nhận từ client — điểm này khớp đúng tinh thần "trạng thái sẵn sàng mặc định" (dù SRS dùng nhãn "Đang hoạt động tốt" lẫn lộn giữa 2 khái niệm `assetStatus`/`healthStatus` khác nhau trong code).
- `src/modules/equipment/services/equipment.service.ts:124-129` — kiểm tra trùng cả `equipmentCode` lẫn `serialNumber` (nếu có) — khớp tinh thần BR1 (định danh duy nhất) nhưng SRS chỉ nhắc tới 1 trường "Mã tài sản", không biết có `serialNumber` riêng.

**Nhận xét:** Mâu thuẫn rõ ràng nhất là giá trị mặc định của `healthStatus` (UNKNOWN thay vì HEALTHY) và khả năng client tự đặt trạng thái sức khỏe ngay lúc tạo — cả hai đều trái với câu chữ BR2 của SRS.

**Đề xuất sửa SRS:**
- Bổ sung các trường "Số sê-ri (Serial Number, tùy chọn, duy nhất), Hãng sản xuất, Model, Ngày mua (không được ở tương lai)" vào form; thay "Mô tả thêm" bằng "Thông số kỹ thuật (dạng object có cấu trúc)".
- Sửa BR2 thành: "Mặc định, thiết bị mới được tạo với `healthStatus = UNKNOWN` (chưa xác định) trừ khi người tạo chủ động chỉ định một giá trị khác ngay tại bước tạo (healthy/warning/faulty/offline/unknown); trạng thái tài sản (`assetStatus`) luôn được hệ thống set cứng là 'Khả dụng' (Available), không nhận từ input."

---

## UC-37 — Cập nhật trạng thái lỗi thiết bị
**Trạng thái:** ❌ SAI HOÀN TOÀN (mô hình 2 tầng "User báo cáo → Manager xác nhận" không tồn tại)

**SRS hiện tại ghi:** 2 luồng phân theo vai trò người thao tác — Hướng A (User): báo cáo sự cố → hệ thống chuyển thiết bị sang trạng thái **"Chờ kiểm tra"** (vẫn hiển thị trong phòng, chỉ gắn nhãn cảnh báo) + gửi thông báo nội bộ cho Quản lý. Hướng B (Manager): cập nhật trạng thái CHÍNH THỨC, chỉ chọn giữa 2 giá trị "Bảo trì/Hư hỏng" hoặc "Đang hoạt động tốt"; chỉ khi Manager chọn "Bảo trì/Hư hỏng" thì thiết bị mới bị ẩn khỏi tiện ích phòng. BR1: trạng thái "Chờ kiểm tra" (do User báo) không làm thiết bị biến mất khỏi bộ lọc phòng họp.

**Code thực tế (bằng chứng):**
- `src/modules/equipment/entities/equipment.entity.ts:24-38` — rà soát toàn bộ 2 enum liên quan (`AssetStatus`: available/assigned/retired/lost/maintenance; `HealthStatus`: healthy/warning/faulty/offline/unknown) — **KHÔNG CÓ bất kỳ giá trị nào tương đương "Chờ kiểm tra" (pending review/pending inspection)** ở cả 2 enum.
- `src/modules/equipment/controllers/equipment.controller.ts:93-96,151` — chỉ có **1 endpoint duy nhất** `PATCH /equipments/:id/fault`, bảo vệ bởi **1 permission duy nhất** `equipment.report_fault` — không có 2 endpoint/2 permission tách biệt cho "User báo cáo" và "Manager xác nhận chính thức" như SRS mô tả.
- `src/modules/equipment/services/equipment.service.ts:209-222` (`resolveAssetAction`) — client gửi `assetStatus` dưới dạng 1 trong 3 giá trị hành động: `active` (→ AVAILABLE hoặc ASSIGNED tùy có đang gán phòng), `retired` (→ RETIRED, **"thanh lý" — hoàn toàn không có trong SRS**), `maintenance` (→ MAINTENANCE) — chỉ có 3 lựa chọn hành động, không phải nhị phân "Bảo trì/Hư hỏng hoặc Hoạt động tốt" như SRS Hướng B mô tả.
- `src/modules/equipment/services/equipment.service.ts:268-283` — nếu thiết bị đang `RETIRED` hoặc **`LOST`** (một trạng thái tài sản nữa hoàn toàn không có trong SRS), việc báo lỗi bị chặn hẳn (409 `EQUIPMENT_NOT_REPORTABLE`).
- `src/modules/equipment/services/equipment.service.ts:291-306` — bất kỳ ai có permission `equipment.report_fault` đều **trực tiếp ghi đè `healthStatus` và/hoặc `assetStatus` CHÍNH THỨC ngay lập tức** trong 1 lệnh gọi duy nhất — không có bước trung gian "chờ Manager xác nhận".

**Nhận xét:** Toàn bộ kiến trúc 2 tầng (báo cáo tạm thời của nhân viên thường → xác nhận chính thức của Quản lý, với trạng thái trung gian "Chờ kiểm tra" không ẩn thiết bị) mà SRS mô tả chi tiết trong Normal Flow, Business Rules không tồn tại trong code. Thực tế chỉ có MỘT hành động cập nhật trạng thái trực tiếp, được gate bởi một permission duy nhất, với 3 lựa chọn hành động (active/maintenance/retired) khác hẳn cấu trúc nhị phân của SRS.

**Đề xuất sửa SRS:** Viết lại hoàn toàn UC-37 theo đúng mô hình thực tế: "Người dùng có quyền `equipment.report_fault` cập nhật trực tiếp một hoặc cả hai trong: (a) Tình trạng sức khỏe thiết bị (healthy/warning/faulty/offline/unknown), (b) Trạng thái tài sản (active → khả dụng/đang gán phòng tùy hiện trạng; maintenance → đang bảo trì; retired → đã thanh lý). Không có bước 'chờ xác nhận' trung gian — thay đổi có hiệu lực ngay khi lưu. Thiết bị đã thanh lý (retired) hoặc đã mất (lost) không thể tiếp tục báo cáo trạng thái."

---

## UC-38 — Xóa thiết bị
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (thiếu hẳn Exception chính của SRS)

**SRS hiện tại ghi:** BR1: "Hành động xóa thiết bị là hành động vĩnh viễn và không thể hoàn tác (Undo)." EX1: nếu thiết bị đang nằm trong phòng có cuộc họp "Đang diễn ra" ở thời điểm hiện tại, hệ thống CHẶN thao tác xóa.

**Code thực tế (bằng chứng):**
- `src/modules/equipment/services/equipment.service.ts:382` — comment tường minh: **"A.2: KHÔNG chặn theo assetStatus (cho xóa thiết bị đang assigned + gỡ tham chiếu)"** → **hoàn toàn không có bất kỳ kiểm tra nào về việc phòng đang chứa thiết bị có cuộc họp 'Đang diễn ra' hay không** — thiết bị luôn xóa được bất kể đang gán ở phòng nào, đang bận hay không. **Mâu thuẫn trực tiếp với EX1 của SRS.**
- `src/modules/equipment/services/equipment.service.ts:397-422` (`deleteEquipment`) — thực hiện đồng thời trong 1 transaction: gỡ toàn bộ tham chiếu phòng (`currentRoomId = null`, `assignedBy/assignedAt/installedAt/assignmentNote = null`), chuyển `assetStatus = RETIRED`, rồi **soft-delete** (`tem.softDelete`) — không phải xóa cứng khỏi DB, nên mâu thuẫn nhẹ với BR1 ("vĩnh viễn") theo đúng mô-típ đã thấy ở UC-10 (Account)/UC-34 (Room), dù ở đây SRS không nhấn mạnh bằng 1 câu cảnh báo hiển thị cho người dùng như UC-10.
- `src/modules/equipment/services/equipment.service.ts:395-396` — khác với UC-36/37 (audit "fail-separate", lỗi audit không rollback), ở đây audit được ghi **ATOMIC cùng transaction** — nếu ghi audit lỗi, toàn bộ thao tác xóa bị rollback (chủ đích, theo comment) — chi tiết kỹ thuật không có trong SRS nhưng không mâu thuẫn.

**Nhận xét:** Đây là sai lệch nghiêm trọng nhất trong mục Equipment: EX1 — điều kiện chặn xóa chính mà SRS đặt ra — hoàn toàn không được code thực thi, thậm chí code còn có comment xác nhận đây là quyết định CHỦ ĐÍCH ("KHÔNG chặn"), không phải thiếu sót vô tình.

**Đề xuất sửa SRS:**
- Xóa EX1 khỏi UC-38, hoặc nếu đội sản phẩm vẫn muốn giữ yêu cầu này, cần báo cho đội BE bổ sung kiểm tra (hiện code chủ đích không có).
- Sửa BR1 thành: "Hành động xóa thiết bị là xóa mềm (dữ liệu vẫn lưu trong hệ thống để phục vụ tra cứu lịch sử); thiết bị bị xóa sẽ tự động được gỡ khỏi phòng đang gán (nếu có) và chuyển trạng thái tài sản sang 'Đã thanh lý', không phân biệt phòng đó có đang diễn ra cuộc họp hay không."

---

## UC-39 — Phân bổ thiết bị vào phòng
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN (BR2 bị đảo ngược)

**SRS hiện tại ghi:** BR2: "Việc phân bổ một thiết bị đang ở trạng thái lỗi ('Bảo trì/Hư hỏng') vào phòng họp **VẪN ĐƯỢC hệ thống chấp nhận** để quản lý vị trí vật lý. Tuy nhiên, thiết bị đó sẽ không được tính là tiện ích sẵn sàng phục vụ của phòng... cho đến khi trạng thái lỗi được Quản lý gỡ bỏ."

**Code thực tế (bằng chứng):**
- `src/modules/equipment/services/equipment.service.ts:546-562` (`assignToRoom`, bước A.2) — **chặn cứng**: chỉ cho phép gán khi `equipment.assetStatus === AVAILABLE || === ASSIGNED`; nếu đang `MAINTENANCE` (tương đương "Bảo trì/Hư hỏng" của SRS), **RETIRED**, hoặc **LOST**, hệ thống từ chối ngay với `409 ConflictException EQUIPMENT_NOT_ASSIGNABLE`, message "Thiet bi khong o trang thai co the gan (retired/lost/maintenance)". → **Ngược 180° so với BR2 của SRS**: SRS nói thiết bị lỗi VẪN gán được (chỉ không tính là tiện ích sẵn sàng); code thì TỪ CHỐI HẲN việc gán thiết bị đang bảo trì/hỏng vào phòng.
- `src/modules/equipment/services/equipment.service.ts:581-599` (bước A.4) — phòng đích phải `isActive === true` và `currentStatus !== INACTIVE` — khớp EX1 của SRS ("phòng họp được chọn đang ở trạng thái ngừng hoạt động (INACTIVE)... ngăn chặn việc gán").
- `src/modules/equipment/services/equipment.service.ts:607-612` — khi gán thành công: `equipment.currentRoomId = dto.roomId`, `assetStatus = ASSIGNED` — logic này cũng áp dụng cho trường hợp "điều chuyển" (thiết bị đã đang `ASSIGNED` ở phòng khác, nay gán sang phòng mới) do điều kiện A.2 cho phép cả `ASSIGNED` đi qua — khớp tinh thần AF2 (điều chuyển thiết bị giữa các phòng) của SRS, dù không tách thành luồng "AF2" tường minh trong code (chỉ là cùng 1 nhánh xử lý).

**Nhận xét:** BR2 của SRS bị đảo ngược hoàn toàn trong code — đây là điểm mâu thuẫn rõ ràng và dễ kiểm chứng nhất trong UC này.

**Đề xuất sửa SRS:** Sửa BR2 thành: "Chỉ thiết bị đang ở trạng thái 'Khả dụng' (Available) hoặc 'Đã gán' (Assigned, dùng cho điều chuyển sang phòng khác) mới được phép phân bổ vào phòng họp. Thiết bị đang 'Bảo trì/Hư hỏng', 'Đã thanh lý', hoặc 'Đã mất' bị hệ thống từ chối thao tác gán/điều chuyển cho đến khi được đưa trở lại trạng thái khả dụng."

---

## UC-40 — Xem, Tìm kiếm & Kiểm tra Khả dụng Thiết bị
**Trạng thái:** ⚠️ KHỚP MỘT PHẦN

**SRS hiện tại ghi:** Lọc theo Loại Thiết bị hoặc Trạng thái; xem chi tiết 1 thiết bị (định danh, trạng thái, phòng đang phân bổ). BR-02: dữ liệu trạng thái phải theo thời gian thực.

**Code thực tế (bằng chứng):**
- `src/modules/equipment/services/equipment.service.ts:431-514` (`listEquipments`) — lọc theo `equipmentType`, `assetStatus`, **và cả `healthStatus`, `currentRoomId`** (2 tiêu chí lọc thêm không có trong SRS); tìm kiếm từ khóa `ILIKE` trên `equipmentCode`/`equipmentName`/`serialNumber` — SRS UC-40 không mô tả có ô tìm kiếm từ khóa (chỉ nói "lọc"), nhưng có nhắc "tìm kiếm thiết bị bằng từ khóa" ở phần Trigger — nhìn chung khớp hợp lý dù chi tiết trường tìm kiếm rộng hơn.
- `src/modules/equipment/services/equipment.service.ts:476-484` — sắp xếp qua allowlist `SORT_MAP` cố định — chi tiết bảo mật không có trong SRS nhưng không mâu thuẫn.
- Dữ liệu trạng thái (`assetStatus`/`healthStatus`) đọc trực tiếp từ cột DB tại thời điểm truy vấn (không cache) và được ghi đồng bộ bởi `reportFault`/`assignToRoom`/`deleteEquipment` → khớp hợp lý với BR-02 (theo thời gian thực).
- Không có endpoint "Xem Chi tiết" (`GET /equipments/:id`) riêng biệt được phát hiện trong controller đã đọc (chỉ có `GET /equipments` danh sách phân trang) — SRS bước 5-6 mô tả một hành động "Xem Chi tiết" riêng dẫn tới "Trang Chi tiết" thiết bị; **cần xác minh thêm** liệu chi tiết được hiển thị từ chính item trong danh sách (EquipmentResponseDto đã đủ trường) hay có endpoint riêng chưa được phát hiện trong phạm vi rà soát này.

**Nhận xét:** Chức năng tìm kiếm/lọc/sắp xếp khớp tốt và còn phong phú hơn SRS; điểm chưa xác minh được là sự tồn tại của một trang "Xem Chi tiết" 1 thiết bị riêng biệt như SRS mô tả (có thể FE tự dựng từ dữ liệu danh sách, không cần endpoint riêng).

**Đề xuất sửa SRS:** Bổ sung ghi chú: "Bộ lọc còn hỗ trợ thêm theo Tình trạng sức khỏe (healthy/warning/faulty/offline/unknown) và theo Phòng đang được phân bổ, ngoài Loại thiết bị và Trạng thái tài sản."

---

## Phát hiện phụ — code có, SRS thiếu hẳn

1. **`AssetStatus.LOST` ("Đã mất")** — một trạng thái tài sản hoàn toàn không có trong SRS, xuất hiện xuyên suốt UC-37/38/39 (chặn báo lỗi, chặn gán phòng).
2. **`AssetStatus.RETIRED` ("Đã thanh lý")** — trạng thái thứ 3 trong luồng cập nhật trạng thái (UC-37), không có trong mô hình nhị phân "Bảo trì/Hư hỏng hoặc Hoạt động tốt" của SRS.
3. **Trường `serialNumber`** — định danh duy nhất thứ 2 (song song với `equipmentCode`), không có trong SRS.
4. **Audit ghi ATOMIC (rollback nếu audit lỗi) cho riêng thao tác xóa (UC-38)**, khác với "fail-separate" (audit lỗi không rollback nghiệp vụ) ở UC-36/37/39 — một quyết định thiết kế có chủ đích, không ảnh hưởng SRS nhưng đáng lưu ý cho đội QA khi viết test.
