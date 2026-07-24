# ASC-001 — UC-123 (Alerts / SAVP): Trung tâm cảnh báo an ninh (engine ghi + API xem/xử lý)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ASC-001 (UC-123): core `recordAlert()` (dedup UNIQUE partial + bắt 23505 + severity mapping tĩnh) dùng chung cho mọi nguồn cảnh báo (3d/UC-124/UC-125, và UC-121 crowd ở Bước 4 sau) + API list/detail/acknowledge/resolve/bulk-acknowledge. RECON code thật (entity `SecurityAlertEntity` schema-only, 2 partial unique open-alert NULL-safe). 4 câu hỏi Bước 3 đã chốt qua AskUserQuestion — xem §1. | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Bước 3 gồm 5 cụm viết cùng lượt — xem `../uc122-alert-rules-crud/spec.md` đầu file cho danh sách đủ. UC-123 (file này) là **hạt nhân** của cả cụm: mọi nguồn cảnh báo (3d, UC-124, UC-125) đều gọi `AlertsService.recordAlert()` được định nghĩa ở đây, KHÔNG tự viết logic dedup/INSERT riêng.
>
> **STOP.** Chờ Thiếu Chủ duyệt toàn bộ 15 file (5 cụm × 3 file) Bước 3 trước khi cho phép code bất kỳ cụm nào.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Entity đã tồn tại, schema-only ([security-alert.entity.ts](../../../../src/modules/alerts/entities/security-alert.entity.ts))
`SecurityAlertEntity` (bảng `security_alerts`): `alertType`, `severity` (default `'medium'`), `zoneId` (nullable), `status` (default `'new'`), `triggeredAt`, `lastSeenAt` (nullable), `occurrenceCount` (default 1), `sourceEventId` (FK `iot_device_events`, nullable), `ruleId` (FK `alert_rules`, nullable), `payloadJson`, `acknowledgedBy`/`acknowledgedAt`, `resolvedBy`/`resolvedAt`, `resolutionNote`. **KHÔNG soft-delete** (audit trail). Comment entity xác nhận dedup PHẢI qua unique partial + bắt `23505`, KHÔNG dựa pre-check (đã ghi rất rõ trong comment, xem nguyên văn file).

### 0.2. Index thật đã tạo (migration `20260722000007-CreateSecurityAlertsTable.ts`, đã áp RDS)
- `IDX_security_alerts_status_time (status, triggered_at DESC)` — màn Trung tâm cảnh báo (list mặc định).
- `IDX_security_alerts_zone_time (zone_id, triggered_at DESC)`, `IDX_security_alerts_type_time (alert_type, triggered_at DESC)`.
- `UQ_security_alerts_open_type_zone (alert_type, zone_id) WHERE status <> 'resolved' AND zone_id IS NOT NULL` — dedup alert đang mở, riêng zone.
- `UQ_security_alerts_open_type_global (alert_type) WHERE status <> 'resolved' AND zone_id IS NULL` — dedup alert đang mở, KHÔNG gắn zone. **TÁCH 2 index vì SQL coi NULL != NULL** (mirror bẫy `alert_rules`).

### 0.3. `iot_device_events` — nguồn `sourceEvent` cho detail view ([iot-device-event.entity.ts](../../../../src/modules/iot/entities/iot-device-event.entity.ts))
Có `payloadJson` (jsonb, raw event) — theo `StrangerAlertService` comment "Metadata-only (KHÔNG base64)", payload KHÔNG chứa ảnh nhị phân, chỉ metadata/URL nếu nguồn cung cấp. UC-123 detail view trả nguyên `sourceEvent.payloadJson` làm "bằng chứng" — KHÔNG đảm bảo luôn có ảnh xem được, tuỳ nguồn ghi gì (residual §7).

### 0.4. Conflict-409 pattern tham chiếu ([vehicle-control-list.service.ts](../../../../src/modules/anpr/services/vehicle-control-list.service.ts))
`isUniqueViolation(e)` đọc `e.driverError?.code === '23505'` — UC-123 dùng đúng pattern này cho `recordAlert()`, nhưng khác UC-122/UC-125 (chuyển 409 cho người dùng): ở đây `23505` là tín hiệu **HỢP LỆ** báo "alert đang mở đã tồn tại" → chuyển nhánh UPDATE tăng `occurrenceCount`, KHÔNG throw ra ngoài (đây không phải lỗi client, là race condition bình thường giữa nhiều event cùng lúc — UC-121 EX1 gốc).

### 0.5. Permission role (chốt qua AskUserQuestion — xem §1 câu 2)
`MANAGER` + `BUSINESS_ADMIN` + `SYSTEM_ADMIN` cho toàn bộ thao tác Trung tâm cảnh báo — KHÔNG `EMPLOYEE`.

### 0.6. Migration mới nhất sau khi UC-122 dùng `20260723000005` → UC-123 dùng **`20260723000006`**.

---

## 1. Câu hỏi nghiệp vụ đã chốt (AskUserQuestion, dùng chung cho cả 5 cụm Bước 3)
Xem `../uc122-alert-rules-crud/spec.md` §1 (4 câu). Riêng UC-123 áp dụng trực tiếp câu 1 (phạm vi) + câu 2 (role).

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **Tách `acknowledge` và `resolve` thành 2 action riêng** (KHÔNG gộp làm 1 bước "acknowledge + ghi chú" như câu chữ SRS bước 4 gợi ý đọc lướt). Lý do: schema đã duyệt/áp RDS có **2 cặp cột audit riêng biệt** (`acknowledged_by/acknowledged_at` và `resolved_by/resolved_at/resolution_note`) — nếu gộp 1 action thì 1 trong 2 cặp cột sẽ luôn rỗng, phí thiết kế đã duyệt. Vòng đời đúng nghĩa cột: `new` → (`POST /:id/acknowledge`, không cần note, chỉ "nhận xử lý") → `acknowledged` → (`POST /:id/resolve {note}`, bắt buộc note) → `resolved`. Đúng khớp "status: new → acknowledged → resolved" đã ghi trong entity/migration comment.
2. **Severity mapping tĩnh theo `alert_type`** (schema `alert_rules` KHÔNG có cột severity — đã xác nhận ở review Hải, không đổi schema). `recordAlert()` nhận `severity` **optional** từ caller; nếu caller KHÔNG truyền, áp dụng bảng mặc định cứng trong `AlertsService`:
   | alert_type | severity mặc định |
   |---|---|
   | `intrusion` | `critical` |
   | `crowd` | `high` |
   | `vehicle_control_match` | `medium` |
   | `person_watchlist_match` | `medium` |
   | `stranger` | `medium` |
   | `unknown_vehicle` | `medium` |
   | `device_error` | `low` |
   | *(khác, không có trong bảng)* | `medium` (fallback an toàn) |

   Caller có ngữ cảnh chi tiết hơn (vd 3d biết `listType='blocklist'` nên nghiêm trọng hơn `watchlist`; UC-125 biết `person_control_list.priority` của từng hồ sơ) **PHẢI tự tính rồi truyền `severity` tường minh**, KHÔNG nhét `listType`/`priority` vào tham số `recordAlert()` — giữ đúng kiến trúc một chiều: `alerts` không cần hiểu vocabulary của `anpr`/`face-access`.
3. **Khi alert đang mở được "gia hạn" (tăng `occurrenceCount`)**: KHÔNG ghi đè `severity` cũ bằng severity mới truyền vào (nếu khác) — giữ nguyên severity của lần đầu ghi. Lý do: đơn giản, tránh 1 alert "nhấp nháy" mức độ nghiêm trọng qua lại giữa các lần trùng lặp; nếu cần đổi mức độ, người xử lý tự đánh giá qua `resolution_note` khi đóng.
4. **`triggeredAt` khi gọi `recordAlert()`**: nếu caller không truyền, mặc định `now()`. Khi alert đang mở được gia hạn (update `occurrenceCount`), `triggeredAt` GIỮ NGUYÊN (thời điểm phát sinh lần ĐẦU) — chỉ `lastSeenAt` cập nhật theo lần mới nhất. Đúng ý nghĩa cột (`triggered_at`: "Thời điểm phát sinh"; `last_seen_at`: "Cập nhật khi đang tiếp diễn").
5. **`list` mặc định KHÔNG lọc `status`** (BR1: cảnh báo không tự biến mất — client tự chọn filter nếu muốn ẩn `resolved`). Sort mặc định `triggeredAt DESC` (đúng SRS "sort giảm dần theo thời gian"), `sortBy` allowlist thêm `severity`/`status` cho FE tùy chọn.
6. **"Lịch sử cùng loại tại zone đó" (detail view)**: `WHERE alertType = :current.alertType AND zoneId IS NOT DISTINCT FROM :current.zoneId AND id != :current.id`, `ORDER BY triggeredAt DESC LIMIT 20` — dùng `IS NOT DISTINCT FROM` (không phải `=`) để case `zoneId IS NULL` (cảnh báo không gắn zone) vẫn khớp đúng các alert cùng loại cũng NULL zone, KHÔNG bị loại vì `NULL = NULL` false trong SQL thường.
7. **Bulk acknowledge giới hạn số lượng**: tối đa 50 id/request (`@ArrayMaxSize(50)` DTO) — chưa có con số nào trong SRS, chọn theo pattern `Max limit = 100` của CLAUDE.md §8.4 (pagination) nhưng giảm còn 50 vì đây là hành động ghi (WRITE), không phải đọc.

---

## 3. Scope (UC-123)

### TRONG scope
1. **`AlertsService.recordAlert(input)`** (method public mới, dùng bởi UC-124/125/3d và UC-121 Bước 4 sau):
   ```ts
   interface RecordAlertInput {
     alertType: string;
     zoneId?: string | null;
     severity?: 'low' | 'medium' | 'high' | 'critical';
     triggeredAt?: Date;
     sourceEventId?: string | null;
     ruleId?: string | null;
     payloadJson?: Record<string, unknown> | null;
   }
   recordAlert(input: RecordAlertInput): Promise<{ alert: SecurityAlertEntity; isNew: boolean }>
   ```
   Logic: thử INSERT (`status='new'`, `occurrenceCount=1`, severity theo §2.2) → bắt `23505` → chuyển UPDATE alert đang mở cùng `(alertType, zoneId)` (2 nhánh theo `zoneId` null/not-null, mirror §0.2): `lastSeenAt = now()`, `occurrenceCount = occurrenceCount + 1` — KHÔNG đổi `severity`/`triggeredAt` (§2.3/2.4). Trả `isNew` để caller (nếu cần) quyết định có gửi notification mới hay không.
2. **`AlertsController`** (`security-alerts` route, mirror convention CLAUDE.md §7.3):
   - `GET /api/v1/security-alerts` — list + filter (`alertType`/`zoneId`/`status`/`from`/`to`) + phân trang + sort (§2.5).
   - `GET /api/v1/security-alerts/:id` — detail: alert + `zone` (join, lọc `deletedAt IS NULL`) + `sourceEvent` (join `iot_device_events` nếu có) + `rule` (join `alert_rules` nếu có) + `history` (§2.6).
   - `POST /api/v1/security-alerts/:id/acknowledge` — conditional UPDATE `WHERE status='new'` (EX1 race-safe).
   - `POST /api/v1/security-alerts/:id/resolve` `{resolutionNote}` — conditional UPDATE `WHERE status='acknowledged'`, `resolutionNote` bắt buộc (`@IsString() @IsNotEmpty()`).
   - `POST /api/v1/security-alerts/bulk-acknowledge` `{ids: string[]}` (AF1) — lặp từng id, conditional UPDATE, gom kết quả `{acknowledged: string[], alreadyProcessed: Array<{id, status, by, at}>}`.
3. Migration seed 3 permission: `security_alert.read`, `security_alert.acknowledge`, `security_alert.resolve` — role `MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN` cho cả 3 (§0.5).
4. `AlertsModule` bổ sung `AlertsService`+`AlertsController`, `exports: [AlertsService]` (để 3d/UC-124/UC-125 import `AlertsModule` inject `AlertsService.recordAlert()`).

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- Wiring nguồn cảnh báo cũ (vehicle control, stranger) gọi `recordAlert()` — `../legacy-alert-source-migration/`.
- Evaluator UC-124 (intrusion), UC-125 (watchlist) — 2 feature riêng, chỉ GỌI `recordAlert()`, KHÔNG code ở đây.
- UC-121 (crowd, Bước 4) — cron riêng ở Bước 4, chỉ cần biết trước là sẽ gọi đúng `recordAlert()` này (không cần đổi API).
- WebSocket push realtime cho FE khi có alert mới — SRS không yêu cầu rõ ở UC-123 (chỉ "list realtime" qua polling/refetch, khác UC-126 dashboard có thể cần WS) — KHÔNG code WS event ở đây, để residual.
- Export báo cáo UC-129 — Bước 5 riêng.

---

## 4. Requirements (EARS)

- **R1 (crux)**: **WHEN** `recordAlert()` được gọi và KHÔNG có alert đang mở cùng `(alertType, zoneId)` **→** hệ thống INSERT dòng mới `status='new'`, `occurrenceCount=1`, `severity` theo §2.2, trả `isNew=true`.
- **R2 (crux)**: **WHEN** `recordAlert()` được gọi và ĐÃ có alert đang mở cùng `(alertType, zoneId)` (bắt qua `23505`, KHÔNG qua pre-check) **→** hệ thống UPDATE `lastSeenAt=now()`, `occurrenceCount+=1` trên dòng đang mở, GIỮ NGUYÊN `severity`/`triggeredAt`, trả `isNew=false`.
- **R3**: **WHEN** GET list KHÔNG truyền `status` **→** hệ thống trả TẤT CẢ trạng thái (BR1: không tự ẩn/biến mất), sort mặc định `triggeredAt DESC`.
- **R4**: **WHEN** GET detail `:id` **→** hệ thống trả kèm `zone` (nếu có, lọc `deletedAt IS NULL`), `sourceEvent` (nếu `sourceEventId` khác NULL), `rule` (nếu `ruleId` khác NULL), `history` tối đa 20 bản ghi cùng loại+zone (§2.6).
- **R5 (crux)**: **WHEN** `POST /:id/acknowledge` và `status` hiện tại là `'new'` **→** hệ thống UPDATE `status='acknowledged'`, `acknowledgedBy`, `acknowledgedAt=now()`, trả 200.
- **R6 (crux, EX1)**: **WHEN** `POST /:id/acknowledge` và `status` hiện tại KHÔNG PHẢI `'new'` (đã bị người khác acknowledge/resolve trước) **→** hệ thống trả 409 kèm thông tin "đã được [acknowledgedByUser] xử lý lúc [acknowledgedAt]" (hoặc `resolvedBy`/`resolvedAt` nếu đã `resolved`), KHÔNG ghi đè.
- **R7**: **WHEN** `POST /:id/resolve` và `status` hiện tại là `'acknowledged'` **→** hệ thống UPDATE `status='resolved'`, `resolvedBy`, `resolvedAt=now()`, `resolutionNote`, trả 200.
- **R8**: **WHEN** `POST /:id/resolve` và `status` hiện tại KHÔNG PHẢI `'acknowledged'` (chưa qua acknowledge, hoặc đã resolved) **→** hệ thống trả 409, KHÔNG cho resolve "nhảy cóc" từ `'new'`.
- **R9 (AF1)**: **WHEN** `POST /bulk-acknowledge` với danh sách id **→** hệ thống xử lý TỪNG id độc lập (conditional update), trả tổng hợp `{acknowledged, alreadyProcessed}` — 1 id lỗi/conflict KHÔNG chặn các id khác trong cùng request.
- **R10**: **WHEN** danh sách `ids` trong bulk-acknowledge rỗng hoặc > 50 phần tử **→** hệ thống trả 400.

## 5. Constitution

- **ARCH-01**: `recordAlert()` là ĐIỂM VÀO DUY NHẤT để ghi `security_alerts` — 3d/UC-124/UC-125/UC-121(sau) đều gọi qua đây, KHÔNG tự viết INSERT/UPDATE trực tiếp lên bảng này ở module khác.
- **ARCH-02 (crux)**: `AlertsModule`/`AlertsService` TUYỆT ĐỐI KHÔNG import `FaceAccessModule`/`AnprModule` — `recordAlert()` nhận MỌI dữ liệu qua tham số hàm.
- **DATA-01**: KHÔNG đổi schema `security_alerts` đã duyệt/áp RDS.
- **DATA-02 (crux)**: Dedup PHẢI qua unique partial index + bắt `23505` — pre-check `findOne` trước rồi mới `INSERT` KHÔNG đủ an toàn (race window UC-121 EX1 gốc), xem §0.4.
- **DATA-03**: Acknowledge/resolve PHẢI dùng conditional UPDATE (`WHERE status = 'expected_value'`) rồi kiểm `affected` rows — KHÔNG `SELECT` rồi `UPDATE` riêng (race window y hệt DATA-02, EX1 chữ SRS).
- **SEC-01**: Toàn bộ endpoint `security-alerts` yêu cầu `@RequirePermissions('security_alert.<action>')` — KHÔNG endpoint nào public.
- **NO-SCOPE-01**: KHÔNG code WebSocket push, KHÔNG code UC-124/125/3d/UC-129 ở feature này.

## 6. Test cases trọng yếu (tham chiếu khi viết plan/tasks)
- `recordAlert`: INSERT mới (isNew=true) / trùng đang mở → UPDATE occurrenceCount (isNew=false, severity giữ nguyên) / trùng nhưng alert cũ đã `resolved` → cho phép INSERT mới (KHÔNG bị chặn, vì unique chỉ áp `status <> 'resolved'`) / 2 nhánh `zoneId` null/not-null cho cả INSERT lẫn UPDATE.
- `acknowledge`: thành công từ `'new'` / conflict 409 khi đã `'acknowledged'`/`'resolved'` kèm đúng message người+thời điểm.
- `resolve`: thành công từ `'acknowledged'` / conflict 409 khi `'new'` (chưa acknowledge) hoặc đã `'resolved'`.
- `bulk-acknowledge`: mix id hợp lệ + id đã bị xử lý trước → 2 nhóm kết quả đúng, KHÔNG 1 lỗi làm hỏng cả batch.
- `list`: không filter → trả đủ mọi status; filter kết hợp nhiều điều kiện; sort mặc định đúng `triggeredAt DESC`.
- `detail`: history đúng `IS NOT DISTINCT FROM` cho case `zoneId IS NULL`.

## 7. Residuals / known-gaps
- **WebSocket push realtime** khi có alert mới — chưa làm, client polling `GET /security-alerts` (mirror cách UC-114/117 Bước 2 đang làm, KHÔNG có WS).
- **Ảnh trong detail view** phụ thuộc `sourceEvent.payloadJson`/`payload_json` của chính alert có gì — KHÔNG đảm bảo luôn có ảnh xem được (metadata-only theo convention `StrangerAlertService`).
- **`zoneId` NULL cho phần lớn alert xe** — do `VehicleResolveService` chưa ghi `zone_id` vào `iot_device_events` (nợ đã ghi ở roadmap mục phối hợp #6) — ảnh hưởng trực tiếp `recordAlert()` dùng nhánh "global" (`zoneId NULL`) cho `vehicle_control_match` cho tới khi Hải cập nhật.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 5 cụm Bước 3 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
