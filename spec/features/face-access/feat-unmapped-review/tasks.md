# UMR-001 — TASKS

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-06-18 | Tạo tasks UMR-001. | Toàn bộ |
| 2026-06-18 | map() → revive/repoint theo partial-unique (device,user)/(device,person); test checklist đổi: revive/repoint/conflict 409 thay cho "2 mapping per-meeting". | service.map |

## Implementation
- [ ] **T1** — DTO: `list-unmapped.query.dto.ts` (page/limit max 100, windowMinutes optional) + `map-unmapped.dto.ts` (`deviceId/userId/meetingId` `@IsUUID`, `personId` `@IsString`).
- [ ] **T2** — `unmapped-review.service.ts`:
  - `list(query)`: SQL §3.1 (NOT EXISTS live mapping, dedupe `(device_id,person_id)`, window từ env, LIMIT/OFFSET). Map sang response (SEC-02).
  - `map(dto, adminId)`: validate device(face_server)/user/meeting; lấy person_name sample; UPSERT `device_user_mappings` `sync_status='synced'` (KHÔNG factory/đẩy thiết bị); ghi `audit_logs`.
- [ ] **T3** — `unmapped-review.controller.ts`: `GET /face-access/unmapped-verifies` + `POST /face-access/unmapped-verifies/map`; `JwtAuthGuard` + Mock PermissionsGuard + `@Permissions('face.unmapped.read'/'.map')`; `@CurrentUser`/req.user → adminId.
- [ ] **T4** — `face-access.module.ts`: +controller, +`UnmappedReviewService` provider.
- [ ] **T5** — env: `FACE_UNMAPPED_WINDOW_MINUTES` (Joi scoped int default 1440) + `.env.example`. KHÔNG prettier cả file.
- [ ] **T6** — Test (mock dataSource/config) ≥80% branch — xem checklist.
- [ ] **T7** — build + lint per-file + jest; STOP code-review gate, KHÔNG commit, KHÔNG migration.

## Test checklist (≥80% branch)
### service.list
- [ ] trả person có verify trong window + NOT EXISTS mapping synced/alive (dedupe, last_seen, hit_count, person_name).
- [ ] person có mapping synced/alive → loại (NOT EXISTS).
- [ ] verify ngoài window → loại (assert SQL có `created_at >= now() - ($1...)`).
- [ ] person_id NULL → loại (assert SQL có `IS NOT NULL`).
- [ ] phân trang: page/limit → LIMIT/OFFSET đúng; limit > 100 bị chặn (DTO).
- [ ] response KHÔNG chứa SanpPic/base64 (chỉ field cho phép).

### service.map (constraint-aware revive/repoint)
- [ ] happy (chưa có slot sống) → INSERT `sync_status='synced'`, `metadata.bookingId`, `source='manual_map'`; **factory KHÔNG gọi** (service không có factory) + ghi audit_logs.
- [ ] **revive**: row sống `(device,personId)` cùng user (kể cả vừa deprovision `sync_status='deleted'`, `deleted_at` NULL) → UPDATE (`sync_status='synced'`, `deleted_at=NULL`), KHÔNG INSERT.
- [ ] **repoint**: user đã có row sống `(device,user)` cho person khác → UPDATE row đó, KHÔNG INSERT.
- [ ] **conflict**: `(device,personId)` sống thuộc user KHÁC → 409 `PERSON_MAPPED_TO_OTHER_USER`, không INSERT/UPDATE.
- [ ] device không tồn tại → 404; `device_type<>'face_server'` → 409; user/meeting không tồn tại → 404.

### controller
- [ ] GET/POST gắn `JwtAuthGuard` + permission (guard pattern).
- [ ] POST lấy adminId từ req.user.

## Ràng buộc
- DATA-01 KHÔNG migration; SEC-02 admin-only; SEC-03 parameterized; import `.js`.
- KHÔNG đổi `onVerify` (ngoài tùy chọn log gọn); KHÔNG deny; KHÔNG đẩy face lên thiết bị khi map.
- Module `face-access` (controller+service mới); STOP code-review gate, chưa commit.
