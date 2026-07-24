# ZTH-001 — UC-120 (Zones / SAVP): Phân tích lưu lượng + heatmap khu vực

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ZTH-001 (UC-120): endpoint tổng hợp `zone_presence_events` (`event_type='count'`) theo zone + khung giờ, trả số liệu trung bình/đỉnh cho biểu đồ VÀ mật độ tương đối zone-level cho heatmap (KHÔNG pixel-level, đúng BR1 SRS). Quyết định qua AskUserQuestion: đưa vào Bước 4 (cùng UC-119/121/126); tọa độ zone BLOCKED giống UC-126 (§2.1 kế thừa quyết định UC-126). | Toàn bộ |

> Phụ thuộc module `campus-dashboard` đã scaffold ở [../uc126-campus-dashboard/](../uc126-campus-dashboard/) (dùng chung `CampusDashboardRepository`) — code UC-126 TRƯỚC. Độc lập với UC-119/UC-121.
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. `ZonePresenceEventEntity` + `IDX_zpe_count` — đã dùng ở UC-121/UC-126, tái sử dụng NGUYÊN VẸN cho UC-120 (cùng nguồn dữ liệu `event_type='count'`, khác cách tổng hợp: UC-121 so ngưỡng tức thời, UC-126 lấy giá trị MỚI NHẤT, UC-120 tổng hợp TOÀN BỘ event trong khoảng thời gian để tính trung bình/đỉnh theo khung giờ).

### 0.2. `ZoneEntity` — KHÔNG có cột tọa độ (RECON đã ghi đầy đủ ở [../uc126-campus-dashboard/spec.md](../uc126-campus-dashboard/spec.md) §0.1) — kế thừa NGUYÊN quyết định đã chốt ở UC-126 §2.1 (đề nghị Hải, KHÔNG dùng `metadata_json` tạm), KHÔNG hỏi lại.

### 0.3. SRS gộp 2 đề xuất ban đầu ("thống kê lưu lượng" + "heatmap khu vực") thành 1 UC vì DÙNG CHUNG NGUỒN DỮ LIỆU (ghi rõ trong SRS "Other Information" của UC-120) — xác nhận thiết kế 1 endpoint duy nhất trả CẢ 2 hình thức (time-series cho biểu đồ + summary cho heatmap), KHÔNG tách 2 API.

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên Bước 4)
UC-120 nằm trong phạm vi Bước 4 của Tài (cùng UC-119/121/126). Tọa độ zone: kế thừa quyết định UC-126 (đề nghị Hải, BLOCKED).

## 2. Quyết định thiết kế suy luận thêm

1. **1 endpoint trả 2 hình thức dữ liệu** (đúng RECON §0.3): `GET /api/v1/campus-dashboard/zones/traffic?from&to&building?&floor?` trả:
   - `series`: mảng time-series (mỗi phần tử: `{zoneId, hourBucket (ISO, làm tròn xuống giờ), avgOccupancy, peakOccupancy}`) — cho FE vẽ biểu đồ cột/đường theo SRS Normal Flow bước 4(a).
   - `heatmap`: mảng summary theo zone trong TOÀN BỘ khoảng đã chọn (`{zoneId, zoneName, building, floor, avgOccupancy, peakOccupancy, peakAt, relativeDensity, coordinates: null}`) — cho FE tô màu sơ đồ mặt bằng theo SRS Normal Flow bước 4(b).
2. **`relativeDensity` (0.0–1.0)**: `zone.peakOccupancy / max(peakOccupancy của MỌI zone trong tập kết quả)` — chuẩn hóa tương đối GIỮA CÁC ZONE đang xem (KHÔNG so với sức chứa tuyệt đối/threshold — SRS không có khái niệm "sức chứa tối đa" riêng ngoài `alert_rules.threshold` của UC-121, và dùng threshold đó cho mục đích khác (cảnh báo) sẽ trộn 2 khái niệm — heatmap chỉ so sánh TƯƠNG ĐỐI giữa các zone như đúng nghĩa BR1 "mật độ tương đối"). Nếu tất cả zone có `peakOccupancy=0` → `relativeDensity=0` cho tất cả (tránh chia cho 0).
3. **`hourBucket`**: gom theo GIỜ tròn (`date_trunc('hour', event_time)` — Postgres), lấy `AVG(occupancy_count)`/`MAX(occupancy_count)` mỗi bucket. Chọn granularity GIỜ (không phải phút/ngày) — cân bằng giữa "đủ chi tiết để thấy biến động trong ngày" và "không trả quá nhiều điểm dữ liệu cho range dài" — suy luận riêng, SRS không quy định cụ thể.
4. **Tọa độ = `null`** (kế thừa UC-126 §2.1) — `heatmap[].coordinates` LUÔN `null` cho tới khi Hải thêm cột thật.
5. **EX1 (zone chưa có layout/tọa độ)**: KHÔNG cần logic riêng ở BE — vì MỌI zone hiện đều `coordinates=null` (chưa ai có cột thật), quyết định "có hiển thị heatmap trực quan hay không" hoàn toàn do FE (Nam) tự xử lý dựa trên `coordinates === null`. BE chỉ đảm bảo LUÔN trả đủ `series`+`heatmap` dạng số liệu bất kể zone có tọa độ hay chưa (R6).
6. **Giới hạn khoảng thời gian**: mirror UC-119, MAX 31 ngày — tránh `GROUP BY hour` trên quá nhiều dữ liệu.
7. **Filter `building`/`floor`**: tái sử dụng `CampusDashboardRepository.loadZoneHierarchy` (đã có ở UC-126) để lấy tập `zoneId` trong phạm vi trước khi query `zone_presence_events` — tránh phải JOIN lại `zones` mỗi lần.

---

## 3. Scope (UC-120)

### TRONG scope
1. `ZoneTrafficHeatmapService.getTraffic(from, to, building?, floor?)`:
   1. `const zones = await this.repo.loadZoneHierarchy({building, floor});` (tái dùng UC-126).
   2. Validate range ≤31 ngày (mirror UC-119 `validateRange`).
   3. Query `zone_presence_events` (`zoneId IN (...), eventType='count', eventTime BETWEEN from AND to`), `GROUP BY zoneId, date_trunc('hour', event_time)` → `series`.
   4. `GROUP BY zoneId` (toàn range) → `avgOccupancy`/`peakOccupancy`/`peakAt` mỗi zone → tính `relativeDensity` (§2.2) → `heatmap`.
   5. Trả `{series, heatmap}`.
2. `GET /api/v1/campus-dashboard/zones/traffic` — thêm controller vào module `campus-dashboard` (mirror UC-119).
3. Seed permission `campus_dashboard.traffic.read`.

### NGOÀI scope (KHÔNG làm ở đây)
- Vẽ heatmap/biểu đồ trực quan — FE (Nam).
- Tọa độ thật — BLOCKED chờ Hải (kế thừa UC-126).
- Dashboard tổng quan (UC-126), timeline cá nhân (UC-119), crowd alert (UC-121) — cụm khác.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** người dùng gọi traffic API với `[from, to]` hợp lệ (≤31 ngày) **→** hệ thống trả `series` (time-series theo giờ) VÀ `heatmap` (summary theo zone) trong CÙNG 1 response.
- **R2**: **WHEN** range vượt quá 31 ngày **→** hệ thống trả `400 INVALID_TRAFFIC_RANGE`.
- **R3 (crux)**: **WHEN** tính `relativeDensity` cho 1 zone **→** hệ thống chia `peakOccupancy` của zone đó cho `peakOccupancy` LỚN NHẤT trong TẬP ZONE đang xem (KHÔNG so với ngưỡng cấu hình `alert_rules.threshold`).
- **R4**: **IF** mọi zone trong tập kết quả có `peakOccupancy=0` **→** `relativeDensity=0` cho tất cả (KHÔNG chia cho 0/NaN).
- **R5**: **WHERE** `coordinates` chưa có cột thật **→** hệ thống LUÔN trả `null` trong `heatmap[].coordinates`, KHÔNG lỗi (R6 — mirror UC-126).
- **R6**: **WHEN** người dùng KHÔNG có permission `campus_dashboard.traffic.read` **→** hệ thống trả `403`.

## 5. Constitution

- **ARCH-01**: Business logic nằm trong `ZoneTrafficHeatmapService`, thuộc module `campus-dashboard` — KHÔNG tạo module riêng.
- **DATA-01**: KHÔNG INSERT/UPDATE/DELETE — chỉ ĐỌC `zone_presence_events`/`zones`.
- **PERF-01**: Range tối đa 31 ngày, tận dụng `IDX_zpe_count` (query `WHERE event_type='count'` khớp partial index).
- **SEC-01**: Route PHẢI có `@RequirePermissions('campus_dashboard.traffic.read')`.
- **NO-SCOPE-01**: KHÔNG code UC-119/121/126 ở đây (chỉ thêm vào module đã scaffold).

## 6. Residuals / known-gaps

- **Tọa độ BLOCKED** — kế thừa nguyên residual UC-126 §7 (chờ Hải).
- **`hourBucket` granularity cố định = giờ** — suy luận riêng, không cấu hình được qua API (có thể thêm `groupBy=day|hour` sau nếu team cần, ngoài phạm vi đợt này).
- **`relativeDensity` tương đối GIỮA CÁC ZONE ĐANG XEM** (phụ thuộc filter `building`/`floor`) — cùng 1 zone có thể có `relativeDensity` KHÁC NHAU tùy phạm vi lọc (xem toàn khuôn viên vs xem 1 tòa) — đây là hành vi THIẾT KẾ ĐÚNG Ý (mật độ "tương đối" luôn phụ thuộc tập so sánh), ghi rõ để tránh hiểu nhầm là bug.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
