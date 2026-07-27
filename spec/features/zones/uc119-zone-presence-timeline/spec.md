# ZPT-001 — UC-119 (Zones / SAVP): Timeline & thời gian lưu lại theo khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ZPT-001 (UC-119): endpoint đọc `zone_presence_events` theo khoảng thời gian, dựng timeline + (tùy chọn) tính tổng thời gian lưu lại theo cá nhân qua ghép cặp `enter`/`exit` tại-thời-điểm-đọc (KHÔNG persist, khác cơ chế cron ghép cặp `gate_access_logs` của UC-116). Quyết định qua AskUserQuestion: đưa vào Bước 4 (cùng UC-120/121/126). | Toàn bộ |
| 2026-07-27 | **Đính chính P1 (A.2)**: giá trị `event_type` thật của `zone_presence_events` là `ZONE_PRESENCE_EVENT_TYPES = ['appear','disappear','count']` — KHÔNG có `enter`/`exit` (đó là `gate_access_logs.direction`). Thuật toán ghép cặp enter/exit ở §2 mục 3, §4 R4/R5, §6 residual **không thực thi được** trên dữ liệu thật → thay bằng mô hình "nhật ký bắt gặp" (sighting log): trả `sightingCount` (số lượt `appear`) thay cho `totalDurationSeconds`/`ongoing`. Xem `PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md` §0.5, §2A. | §2 mục 3-4, §3 mục 1, §4 R4/R5, §6 |

> Phụ thuộc module `campus-dashboard` đã scaffold ở [../uc126-campus-dashboard/](../uc126-campus-dashboard/) (dùng chung `CampusDashboardRepository`) — code UC-126 TRƯỚC. Độc lập với UC-120/UC-121 (không phụ thuộc nhau).
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonePresenceEventEntity` — `userId` nullable, CHỈ set khi nguồn có định danh (Face Server) theo comment entity ([zone-presence-event.entity.ts](../../../../src/modules/zones/entities/zone-presence-event.entity.ts) dòng 18-19: "user_id NULL cho event room-level (chỉ biết có người, không định danh); chỉ set khi nguồn có định danh"). Index `IDX_zpe_user_time` (partial `WHERE user_id IS NOT NULL`) đã có sẵn — ĐÚNG cho truy vấn "timeline theo 1 cá nhân" (BR1 SRS).

### 0.2. Pattern ghép cặp tham chiếu ([gate-access-pairing.service.ts](../../../../src/modules/gate-access/services/gate-access-pairing.service.ts)) — FIFO theo `user_id`, ưu tiên khớp gần nhất, KHÔNG tạo synthetic log khi thiếu cặp (trạng thái "Chưa hoàn tất" là DERIVED tại tầng đọc, không lưu cột riêng). UC-119 áp DỤNG CÙNG TRIẾT LÝ nhưng KHÔNG persist (đọc + tính trong 1 request, không cron, không cập nhật `zone_presence_events` — bảng này append-only, UC-119 chỉ ĐỌC).

### 0.3. `CampusDashboardRepository` ([../uc126-campus-dashboard/plan.md](../uc126-campus-dashboard/plan.md) §4) — đã có `loadZoneHierarchy` (xác nhận zone tồn tại/chưa xóa mềm trước khi query timeline).

### 0.4. Pattern empty-state ([dashboard-overview.service.ts](../../../../src/modules/analytics/services/dashboard-overview.service.ts)) — "Empty state short-circuit" khi không có dữ liệu, trả response rỗng có ý nghĩa thay vì lỗi. UC-119 EX1 mirror pattern này.

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên Bước 4)
UC-119 nằm trong phạm vi Bước 4 của Tài (cùng UC-120/121/126).

## 2. Quyết định thiết kế suy luận thêm

1. **Endpoint đọc thô, KHÔNG bucket sẵn phía BE**: `GET /api/v1/campus-dashboard/zones/:zoneId/timeline?from&to&userId?` trả MẢNG event thô (`eventTime, eventType, occupancyCount, userId`) sắp xếp tăng dần theo `eventTime` — FE (Nam) tự dựng biểu đồ timeline từ mảng này (SRS Normal Flow bước 3 nói "Hệ thống dựng dòng thời gian hiển thị biến động số người" — hiểu là NGHIỆP VỤ tổng hợp thuộc BE, nhưng phần TRỰC QUAN HÓA thuộc FE theo đúng phân công đã chốt xuyên suốt Bước 4 — mirror UC-126 "BE trả JSON, FE vẽ").
2. **`userId` filter TÙY CHỌN (BR1)**: nếu KHÔNG truyền `userId` → chỉ trả timeline tổng theo zone (mọi event, không phân biệt người). Nếu CÓ truyền `userId` → lọc `WHERE zoneId=... AND userId=... AND eventTime BETWEEN from AND to`; nếu kết quả rỗng NHƯNG zone đó có event khác `userId=NULL` trong cùng khoảng → trả `personDataAvailable: false` (đúng BR1: "chỉ khả dụng khi hệ thống có dữ liệu ánh xạ danh tính cho khu vực đó").
3. **[ĐÍNH CHÍNH 2026-07-27] Đếm số lượt bắt gặp (theo cá nhân, chỉ khi có `userId`), KHÔNG ghép cặp**: nguồn dữ liệu `zone_presence_events` là NHẬT KÝ BẮT GẶP — camera IVSS bắn event khi *thấy* một người trong khung hình (`event_type ∈ {'appear','disappear','count'}`), KHÔNG bắn event khi người đó rời khung. Vì vậy KHÔNG có `enter`/`exit` để ghép cặp và KHÔNG thể suy ra thời lượng lưu lại từ nguồn này. Response trả `sightingCount` = số event trong tập kết quả đã lọc theo `userId` (thay cho `totalDurationSeconds`/`ongoing` đã bỏ). Thuật toán ghép cặp FIFO mô tả trước đây (bản 2026-07-23) áp dụng nhầm giá trị `enter`/`exit` của `gate_access_logs.direction` — một bảng khác — đã bị loại bỏ.
4. **EX1 (không có dữ liệu)**: `events.length === 0` → trả `{events: [], personDataAvailable: null, sightingCount: null, message: 'Không có dữ liệu hiện diện trong khoảng thời gian này.'}`, HTTP 200 (KHÔNG 404 — mirror UC-126 "empty state" convention, đây là kết quả hợp lệ, không phải lỗi).
5. **Giới hạn khoảng thời gian truy vấn**: MAX 31 ngày (`from` → `to`) để tránh query quá lớn trên bảng append-only — validate ở DTO/service, quá giới hạn → `400 Bad Request` (`INVALID_TIMELINE_RANGE`). Số 31 là suy luận riêng (SRS không quy định), dễ chỉnh.
6. **KHÔNG ghi log/cache kết quả tính toán** — mỗi request tính lại từ đầu (dữ liệu nguồn append-only, không có cron nào invalidate cache — tránh over-engineering cho 1 UC Priority Low, Frequency Low theo SRS).

---

## 3. Scope (UC-119)

### TRONG scope
1. `ZonePresenceTimelineService.getTimeline(zoneId, from, to, userId?)`:
   1. Validate zone tồn tại (`CampusDashboardRepository.loadZoneHierarchy` hoặc query trực tiếp `ZoneEntity` theo id, `deletedAt IS NULL`) → không tồn tại → `404 ZONE_NOT_FOUND`.
   2. Validate range ≤31 ngày (§2.5).
   3. Query `zone_presence_events` (`zoneId`, `eventTime BETWEEN from AND to`, + `userId` nếu có) order `eventTime ASC`.
   4. Nếu rỗng → EX1 (§2.4).
   5. Nếu có `userId` → `sightingCount = events.length` (số lượt bắt gặp trong tập kết quả đã lọc, xem đính chính §2 mục 3).
   6. Nếu KHÔNG có `userId` VÀ toàn bộ event `userId=NULL` → `personDataAvailable: false` trong response (thông tin cho FE biết BR1 không khả dụng cho zone này).
   7. Trả `{events, personDataAvailable, sightingCount}`.
2. `GET /api/v1/campus-dashboard/zones/:zoneId/timeline` — thêm route vào `DashboardOverviewController` HOẶC controller riêng `ZonePresenceTimelineController` trong CÙNG module `campus-dashboard` (quyết định cụ thể ở plan, mirror pattern 1-controller/endpoint của `analytics`).
3. Seed permission `campus_dashboard.timeline.read` (migration mới, cùng nhóm role Admin/Manager).

### NGOÀI scope (KHÔNG làm ở đây)
- Vẽ biểu đồ timeline trực quan — FE (Nam).
- Ghép cặp PERSIST vào DB — bảng `zone_presence_events` append-only, UC-119 chỉ đọc + tính tạm trong request.
- Liên kết `device_user_mappings` để suy luận danh tính khi `userId=NULL` — KHÔNG làm, BR1 đã nói rõ "chỉ khả dụng khi CÓ dữ liệu ánh xạ" (tức `userId` đã set sẵn từ nguồn, không tự suy luận thêm).
- Dashboard tổng quan (UC-126), lưu lượng+heatmap (UC-120), crowd alert (UC-121) — cụm khác.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** người dùng gọi timeline với `zoneId` không tồn tại/đã xóa mềm **→** hệ thống trả `404 ZONE_NOT_FOUND`.
- **R2**: **WHEN** khoảng `[from, to]` vượt quá 31 ngày **→** hệ thống trả `400 INVALID_TIMELINE_RANGE`.
- **R3**: **WHEN** không có event nào trong khoảng đã chọn **→** hệ thống trả danh sách rỗng kèm thông báo rõ ràng, KHÔNG lỗi (EX1).
- **R4 (crux, đính chính 2026-07-27)**: **WHEN** có `userId` VÀ tồn tại event của người đó trong khoảng **→** hệ thống trả `sightingCount` = số lượt bắt gặp (số event) trong TẬP KẾT QUẢ đã lọc. KHÔNG ghép cặp enter/exit — nguồn dữ liệu là nhật ký bắt gặp (`appear`/`disappear`/`count`), không có cặp vào/ra để ghép (xem §2 mục 3).
- **R5**: **WHEN** `userId` không được truyền, hoặc zone chỉ có event `userId=NULL` **→** hệ thống trả `personDataAvailable: false`, `sightingCount: null` (BR1).
- **R6**: **WHERE** người dùng KHÔNG có permission `campus_dashboard.timeline.read` **→** hệ thống trả `403`.

## 5. Constitution

- **ARCH-01**: Business logic (ghép cặp, validate range) nằm trong `ZonePresenceTimelineService`, thuộc module `campus-dashboard` — KHÔNG tạo module riêng.
- **DATA-01**: KHÔNG INSERT/UPDATE/DELETE `zone_presence_events` — chỉ ĐỌC, tính toán TẠM trong request (không persist kết quả ghép cặp).
- **PERF-01**: Range tối đa 31 ngày (§2.5) — tránh query không giới hạn trên bảng append-only.
- **SEC-01**: Route PHẢI có `@RequirePermissions('campus_dashboard.timeline.read')`.
- **NO-SCOPE-01**: KHÔNG persist ghép cặp, KHÔNG dùng `device_user_mappings` suy luận danh tính, KHÔNG code UC-120/121/126 ở đây.

## 6. Residuals / known-gaps

- **[ĐÍNH CHÍNH 2026-07-27] Không đo được thời lượng lưu lại thực tế** — nguồn `zone_presence_events` chỉ ghi lại LÚC BẮT GẶP (`appear`/`disappear`/`count`), không có tín hiệu "rời khung" đáng tin cậy để ghép cặp tính khoảng thời gian. `sightingCount` chỉ phản ánh SỐ LẦN camera thấy người đó trong khoảng, không phải thời lượng họ ở lại. Nếu cần đo thời lượng thật, phải có nguồn dữ liệu khác (vd. camera bắn cả `disappear` đáng tin cậy theo từng người, hoặc `gate_access_logs` nếu khu vực có cổng ra/vào rõ ràng) — ngoài phạm vi đợt này.
- **31 ngày max range** — số suy luận riêng, dễ chỉnh nếu SRS/team có yêu cầu khác.
- **`personDataAvailable` chỉ xác định được SAU KHI đã query** — không có cách nào biết trước (không có cột nào trên `zones` đánh dấu "zone có face mapping") — chấp nhận cách tiếp cận query-rồi-kiểm-tra.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
