# UMR-001 — PLAN

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo plan UMR-001 — controller+service face-access, GET list (NOT EXISTS live mapping) + POST manual map (synced, no device push). | Toàn bộ |

## Kiến trúc (tái dùng, không module mới, không migration)
```
Admin
  GET  /api/v1/face-access/unmapped-verifies        → UnmappedReviewService.list()
         → raw query iot_device_events  ⟂(NOT EXISTS)  device_user_mappings(synced,alive)
         → dedupe (device_id, person_id) → [{deviceId, personId, personName, roomId, lastSeen, hitCount}]
  POST /api/v1/face-access/unmapped-verifies/map     → UnmappedReviewService.map()
         → validate device(face_server)/user/meeting
         → UPSERT device_user_mappings (sync_status='synced', metadata.bookingId, source='manual_map')
         → audit_logs ; KHÔNG factory.create / KHÔNG upload/addPerson
```
- `onVerify` KHÔNG đổi.

## Files
| File | Hành động |
| :--- | :--- |
| `src/modules/face-access/controllers/unmapped-review.controller.ts` | NEW — GET list + POST map; `JwtAuthGuard` + Mock PermissionsGuard (nhất quán iot/recording); `@Permissions('face.unmapped.read'/'face.unmapped.map')`. |
| `src/modules/face-access/services/unmapped-review.service.ts` | NEW — `list(query)` + `map(dto, adminId)`. Raw SQL parameterized qua `DataSource`. |
| `src/modules/face-access/dto/list-unmapped.query.dto.ts` | NEW — page/limit (max 100), windowMinutes optional (default env). |
| `src/modules/face-access/dto/map-unmapped.dto.ts` | NEW — `{ deviceId, personId, userId, meetingId }` (`@IsUUID` cho id; personId `@IsString`). |
| `src/modules/face-access/face-access.module.ts` | EDIT — `controllers: [UnmappedReviewController]`, `providers: [..., UnmappedReviewService]` (đã có DataSource/ConfigModule). |
| `src/config/env.validation.ts` | EDIT — `FACE_UNMAPPED_WINDOW_MINUTES` (Joi scoped, int default 1440). KHÔNG prettier cả file. |
| `.env.example` | EDIT — `FACE_UNMAPPED_WINDOW_MINUTES=1440`. |
| `*.spec.ts` (controller + service) | NEW — test ≥80% branch. |

## list(query)
- `window = query.windowMinutes ?? config.get('FACE_UNMAPPED_WINDOW_MINUTES', 1440)`.
- chạy SQL §3.1 (LIMIT/OFFSET từ page/limit). Map row → response (SEC-02: chỉ field cho phép).
- (tùy chọn) query COUNT cho `meta.total`.

## map(dto, adminId)
1. validate: `SELECT id,device_type FROM iot_devices WHERE id=$1` → 404 nếu thiếu, 409 nếu `device_type<>'face_server'`. `users` tồn tại → 404. `meetings` tồn tại → 404.
2. lấy `person_name` mới nhất cho `(deviceId, personId)` từ `iot_device_events` (sample) để set `device_person_code/name`.
3. UPSERT `device_user_mappings` theo `(user_id, device_id, metadata_json->>'bookingId')`:
   - INSERT/UPDATE: `device_person_id=personId`, `device_person_code/name=person_name`, `face_registered=true`, `sync_status='synced'`, `last_synced_at=now()`, `registered_at=COALESCE(...,now())`, `registered_by=adminId`, `metadata_json={bookingId, source:'manual_map', mappedBy:adminId, mappedAt}`.
   - **KHÔNG** gọi `FaceDeviceProviderFactory` / upload / addPerson (face đã trên cam).
4. ghi `audit_logs` (actor=adminId, action='face.unmapped.map', target=mapping id).
5. trả `{ mappingId, deviceId, personId, userId, meetingId, syncStatus:'synced' }`.

## Quyết định (CHỐT)
- **Manual map = tạo device_user_mapping (per-meeting), `sync_status='synced'`, KHÔNG đẩy thiết bị** — face đã sẵn trên cam; chỉ ghi nhận liên kết để verify SAU resolve.
- **KHÔNG "ignore/dismiss"** ở v1 (thiếu cờ review-state, tránh overload `processed_status`/`sync_status`) — anomaly tự rụng khi đã map hoặc trôi WINDOW (spec §7).
- onVerify giữ nguyên (không deny, không hồi tố verify cũ).
- DATA-01 no migration; SEC-02 admin-only; SEC-03 parameterized.
