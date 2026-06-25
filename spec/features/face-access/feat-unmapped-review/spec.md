# UMR-001 — Xử lý person verify không khớp mapping (unmapped review)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo spec UMR-001 (Face-access #50): admin xem verify không-khớp-mapping (GET) + map thủ công (POST). Tái dùng iot_device_events + device_user_mappings, KHÔNG migration, KHÔNG đổi onVerify. | Toàn bộ |
| 2026-06-18 | Hoà giải constraint: phát hiện 2 partial-unique (device,user)/(device,person) WHERE deleted_at IS NULL → map() đổi sang REVIVE/REPOINT (không INSERT trùng) + 409 cross-user. Flag B cùng lỗ hổng + deprovision không set deleted_at (§8). | §3.2, §5, §6, §8 |

## 1. Mục tiêu
Khi cam gửi verify một person mà **không resolve được mapping còn sống**, C (FAT-001) chỉ `logger.warn` + return (không ghi điểm danh, **không deny** — NC-1). Verify đó **vẫn được lưu raw** trong `iot_device_events` (`event_type='face_verify'`, `payload_json` có `info.PersonID/Name`). UMR-001 cho **admin**:
1. **Xem danh sách** các verify gần đây không khớp mapping (để biết "ai quét cửa mà hệ thống chưa nhận").
2. **Map thủ công** person đó → user cho một cuộc họp, để verify **sau** resolve được → điểm danh.

**DATA-01: KHÔNG bảng/cột mới** — tái dùng `iot_device_events` (nguồn anomaly) + `device_user_mappings` (đích map). **KHÔNG đổi hành vi `onVerify`** (vẫn warn+return, không deny; tùy chọn log gọn hơn).

## 2. RECON (đã kiểm chứng)
- **`iot_device_events`** ([iot-device-event.entity.ts](../../../../src/modules/iot/entities/iot-device-event.entity.ts)): `id`, `device_id` (uuid NOT NULL), `room_id`/`meeting_id` (nullable), `event_type` (varchar 60), `event_time` (timestamptz), `payload_json` (jsonb), `created_at` (timestamptz, server-received). Verify lưu `event_type='face_verify'`.
- **Đường dẫn person trong payload**: `payload_json->'extracted_fields'->>'person_id'` (= `String(info.PersonID)`, đã normalize) + `...->>'person_name'` (= `info.Name`). SanpPic (base64) **đã bị strip** lúc lưu (FAT-001) → response an toàn.
- **`device_user_mappings`**: `device_id`, `user_id`, `device_person_id` (= uid/PersonID cam), `device_person_code` (= uname trên cam), `sync_status` (constraint: pending/synced/failed/deleted), `deleted_at`, `metadata_json` (`bookingId`...). Mapping **còn sống** = `sync_status='synced' AND deleted_at IS NULL` (đúng guard `resolveMapping` của C).
- **Khớp verify ↔ mapping**: `info.PersonID === device_user_mappings.device_person_id` (C resolve theo cột này; fallback `device_person_code = info.Name`).

## 3. Functional Requirements (EARS)

### 3.1. GET danh sách unmapped (admin)
- **FR-UMR-001-001**: Endpoint `GET /api/v1/face-access/unmapped-verifies` — **admin-only** (`JwtAuthGuard` + `@Permissions('face.unmapped.read')`, SEC-02). Trả các verify gần đây mà `person_id` **KHÔNG có mapping còn sống**.
- **FR-UMR-001-002**: Nguồn = `iot_device_events` `event_type='face_verify'`, trong cửa sổ `created_at >= now() - WINDOW`, có `person_id` (loại NULL). Điều kiện unmapped = `NOT EXISTS` mapping `(device_id, device_person_id=person_id, sync_status='synced', deleted_at IS NULL)`.
- **FR-UMR-001-003**: **Dedupe theo `(device_id, person_id)`** — mỗi cặp 1 dòng: `last_seen = MAX(created_at)`, `hit_count = COUNT(*)`, kèm `person_name` + `room_id` của lần mới nhất (sample). Sắp xếp `last_seen DESC`, phân trang (`page`/`limit`, max 100).
- **FR-UMR-001-004** (SEC-02): response **KHÔNG** chứa SanpPic/base64/token; chỉ `deviceId, personId, personName, roomId, lastSeen, hitCount`.

Truy vấn (tham số hoá — SEC-03):
```sql
SELECT e.device_id,
       e.payload_json->'extracted_fields'->>'person_id'  AS person_id,
       MAX(e.created_at)                                  AS last_seen,
       COUNT(*)::int                                      AS hit_count,
       (array_agg(e.payload_json->'extracted_fields'->>'person_name'
                  ORDER BY e.created_at DESC))[1]         AS person_name,
       (array_agg(e.room_id ORDER BY e.created_at DESC))[1] AS room_id
  FROM iot_device_events e
 WHERE e.event_type = 'face_verify'
   AND e.created_at >= now() - ($1 * interval '1 minute')   -- $1 = WINDOW phút
   AND e.payload_json->'extracted_fields'->>'person_id' IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM device_user_mappings m
      WHERE m.device_id = e.device_id
        AND m.device_person_id = e.payload_json->'extracted_fields'->>'person_id'
        AND m.sync_status = 'synced' AND m.deleted_at IS NULL)
 GROUP BY e.device_id, person_id
 ORDER BY last_seen DESC
 LIMIT $2 OFFSET $3
```

### 3.2. POST map thủ công (admin)
- **FR-UMR-001-005**: Endpoint `POST /api/v1/face-access/unmapped-verifies/map` — admin-only (`@Permissions('face.unmapped.map')`). Body: `{ deviceId, personId, userId, meetingId }`.
- **FR-UMR-001-006** (semantics — CHỐT): ghi **`device_user_mappings`** liên kết `(deviceId, personId)` → `userId`, `metadata_json.bookingId = meetingId`. **Face ĐÃ tồn tại trên cam** (chính vì vậy verify mới gửi `PersonID`) → **KHÔNG upload/addPerson, KHÔNG đẩy lên thiết bị** (khác provisioning B). Mapping chỉ **ghi nhận liên kết** để verify sau resolve được.
  - ⚠ **DB chỉ cho 1 mapping SỐNG (`deleted_at IS NULL`) trên `(device_id, user_id)` và trên `(device_id, device_person_id)`** (2 partial-unique index). Vì vậy thao tác là **REVIVE/REPOINT**, KHÔNG đẻ row mới mỗi meeting (xem FR-008 + §6.1).
- **FR-UMR-001-007**: cột ghi:
  - `device_id=deviceId`, `user_id=userId`, `device_person_id=personId`.
  - `device_person_code`/`device_person_name` = `person_name` mới nhất từ verify (`info.Name`) nếu có (để fallback-by-name của C cũng khớp); null nếu không có.
  - `metadata_json = { bookingId: meetingId, source: 'manual_map', mappedBy: adminId, mappedAt }`.
  - **`sync_status = 'synced'`** (face đã trên thiết bị; chỉ ghi nhận — KHÔNG đẩy), `face_registered = true`, `registered_by = adminId`, `registered_at = now()`, `last_synced_at = now()`.
- **FR-UMR-001-008** (revive/repoint — constraint-aware): reconcile theo 2 partial-unique:
  1. Tìm row SỐNG theo **`(device_id, device_person_id)`** (`deleted_at IS NULL`): **cùng `userId`** → REVIVE row đó (UPDATE: `device_person_id`/`code`, `sync_status='synced'`, `deleted_at=NULL`, `metadata.bookingId`); **khác `userId`** → **409** `PERSON_MAPPED_TO_OTHER_USER` (admin gỡ trước).
  2. Không có → tìm row SỐNG theo **`(device_id, user_id)`** (`deleted_at IS NULL`) → có thì **REPOINT** row đó sang `personId`/meeting mới (UPDATE); không có → **INSERT mới**.
  → Đảm bảo KHÔNG vi phạm `ux_device_user_mappings_device_user` / `ux_device_user_mappings_person_id`. (Row deprovision có `sync_status='deleted'` nhưng `deleted_at` vẫn NULL nên VẪN bị bắt ở bước 1/2 → revive đúng, không INSERT trùng.)
- **FR-UMR-001-009**: validate `deviceId` tồn tại & `device_type='face_server'`; `userId` tồn tại; `meetingId` tồn tại. Lỗi → 404/409 rõ. Ghi **`audit_logs`** (hành động admin nhạy cảm).
- **FR-UMR-001-010**: sau map, verify **mới** cho `(deviceId, personId)` trong meeting đó → `resolveMapping` khớp (theo `device_person_id`) → điểm danh. **KHÔNG hồi tố** verify cũ đã lưu (chỉ tạo record từ verify tương lai).

### 3.3. onVerify — không đổi
- **FR-UMR-001-011**: `onVerify` giữ NGUYÊN (resolveMapping rỗng → `logger.warn` + return, **không deny**). Tùy chọn (không bắt buộc): rút gọn 1 dòng log để dễ truy vết — không phá hành vi.

## 4. Non-Functional / Constraints
- **NFR-DATA-01**: KHÔNG migration — chỉ `iot_device_events` (read) + `device_user_mappings` (write).
- **NFR-SEC-02**: cả 2 endpoint **admin-only** (JwtAuthGuard + permission); response không lộ base64/secret.
- **NFR-SEC-03**: SQL parameterized, raw qua `DataSource`.
- **NFR-CFG**: `FACE_UNMAPPED_WINDOW_MINUTES` (Joi scoped, int default `1440` = 24h) — cửa sổ list. Chỉ chèn dòng Joi scoped, KHÔNG prettier cả file.
- **NFR-ENG-01**: unit test ≥ 80% branch.
- import `.js`; raw query; module `face-access` (controller + service mới).

## 5. Acceptance Criteria
- **AC-001**: GET trả person có verify gần đây + KHÔNG có mapping synced/alive; dedupe (device,person) 1 dòng + last_seen + hit_count + person_name sample.
- **AC-002**: person ĐÃ có mapping synced/alive → KHÔNG xuất hiện trong list.
- **AC-003**: verify ngoài WINDOW → KHÔNG xuất hiện.
- **AC-004**: `person_id` NULL trong payload → bỏ qua.
- **AC-005**: GET không có quyền admin → 401/403 (guard).
- **AC-006**: POST map (chưa có slot sống) → INSERT `device_user_mappings` `sync_status='synced'`, `metadata.bookingId=meetingId`, **KHÔNG gọi factory/đẩy thiết bị**; ghi audit.
- **AC-007a** (revive): có row sống `(device, personId)` **cùng user** (kể cả vừa deprovision `sync_status='deleted'`, `deleted_at` NULL) → **UPDATE** (revive, `deleted_at=NULL`), KHÔNG INSERT.
- **AC-007b** (repoint): user đã có row sống `(device, user)` cho person khác → **UPDATE** row đó (constraint `(device,user)`), KHÔNG INSERT.
- **AC-007c** (conflict): `(device, personId)` sống thuộc **user khác** → **409** `PERSON_MAPPED_TO_OTHER_USER`, không ghi.
- **AC-008**: POST map device/user/meeting không tồn tại → 404/409.
- **AC-009**: sau map, person đó **biến mất** khỏi GET list (đã có mapping synced).

## 6. Edge cases (phải có test)
- **personId trùng nhiều user**: 1 `personId` (uid) = 1 face trên cam = 1 người. DB partial-unique `(device, personId)` chặn map sang user khác khi đang sống → **409** (AC-007c). Hiển thị `person_name` để admin đối chiếu.
- **mapping vừa bị deprovision** (`sync_status='deleted'`, `deleted_at` NULL): verify sau → unmapped (list lọc `synced`) → hiện list. Admin map lại → **REVIVE row cũ** (UPDATE `sync_status='synced'`, `deleted_at=NULL`) — KHÔNG INSERT (tránh vi phạm partial-unique vì row cũ vẫn `deleted_at IS NULL`).
- **verify cũ** (ngoài WINDOW): không hiện; map không hồi tố điểm danh cho verify cũ.
- **device không còn / room null**: vẫn list được (person_id + device_id từ event); validate ở POST.

### 6.1. Hệ quả constraint (one live slot)
DB cho **1 mapping sống / (device,user)** → một user ở một cửa chỉ có **1 face-link đang hiệu lực** tại một thời điểm (KHÔNG phải nhiều mapping song song theo từng meeting). `metadata.bookingId` chỉ ghi meeting hiện tại. Map cho meeting khác cùng user/cùng face = **repoint cùng 1 row** (không tạo thêm).

## 7. Out of scope
- "Ignore/dismiss" anomaly **không** làm v1: cần cờ review-state nhưng `processed_status` của `iot_device_events` mang nghĩa khác (không overload) và `sync_status` constraint không có giá trị 'dismissed' → cần migration → defer. Thay thế: anomaly tự rụng khỏi list khi (a) đã map (có mapping synced), hoặc (b) trôi khỏi WINDOW.
- Hồi tố tạo điểm danh cho verify cũ trước khi map (defer).
- Tự động gợi ý user (face matching) — backend không chạy model (CLAUDE §11.12).
- Đẩy face lên thiết bị khi map (face đã có sẵn trên cam → không cần).

## 8. ⚠ Phát hiện cần xử lý RIÊNG (ngoài UMR-001)
- **B (`face-provisioning.upsertMapping`) có cùng lỗ hổng constraint**: existing-check keyed `(user_id, device_id, bookingId)` **không** khớp partial-unique `(device_id, user_id)`. Nếu cùng user được provision cho **2 meeting** trên **cùng cam** → INSERT row thứ 2 (`deleted_at` NULL) → **vi phạm `ux_device_user_mappings_device_user`** (mock test không bắt). → Cần ticket sửa B (reconcile theo `(device,user)` như UMR map()).
- **Deprovision đặt `sync_status='deleted'` nhưng KHÔNG set `deleted_at`** → row "deleted" vẫn chiếm slot partial-unique (`deleted_at IS NULL`). Giải pháp gốc: deprovision set `deleted_at=now()` (soft-delete thật) để giải phóng slot — nhưng đổi semantics `resolveMapping`/reconcile → cân nhắc ở ticket riêng. UMR map() đã né bằng revive (an toàn không cần đổi deprovision).
