# PWL-001 — UC-125 (Alerts / SAVP): Watchlist người

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec PWL-001 (UC-125): CRUD `person_control_list` (mirror UC-113 `vehicle_control_list`) + `checkPersonWatchlist(userId)` expose cho Hải gọi khi có event nhận diện. Chữ ký hàm CHỈ nhận `userId` (chốt qua AskUserQuestion — xem §1 câu 3), hệ quả thu hẹp phạm vi: người watchlist chỉ có `face_profile_id`/`display_name` (không có `user_id`) KHÔNG được đối chiếu tự động ở đợt này. | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Phụ thuộc `../uc123-alert-center/` (`recordAlert()`) + `../uc122-alert-rules-crud/` (`findEffectiveRule()`). Độc lập với 3d/UC-124 (có thể code song song sau khi UC-122+123 xong). Đây là cụm CUỐI trong 5 cụm Bước 3.
>
> **STOP.** Chờ Thiếu Chủ duyệt toàn bộ 15 file Bước 3 trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Entity đã tồn tại, schema-only ([person-control-list.entity.ts](../../../../src/modules/alerts/entities/person-control-list.entity.ts))
`PersonControlListEntity`: `userId`/`faceProfileId` (cả 2 nullable, độc lập), `displayName` (NOT NULL), `photoMediaFileId` (nullable — chỉ đối chiếu thủ công, KHÔNG enroll), `listType` (default `'watchlist'`), `reason`, `priority` (default `'medium'` — **giá trị dùng được thẳng làm `severity` khi ghi alert**, cùng vocabulary `low/medium/high/critical`), `active` (default `true`), soft-delete.

### 0.2. Index thật đã tạo (migration `20260722000008-CreatePersonControlListTable.ts`, đã áp RDS)
- `UQ_person_control_user_type_active (user_id, list_type) WHERE deleted_at IS NULL AND user_id IS NOT NULL`.
- `UQ_person_control_face_type_active (face_profile_id, list_type) WHERE deleted_at IS NULL AND face_profile_id IS NOT NULL` — **TÁCH 2 index** (mirror bẫy NULL != NULL của `alert_rules`/`security_alerts`).
- `IDX_person_control_lookup_user (user_id) WHERE deleted_at IS NULL AND active = true` — hot path cho `checkPersonWatchlist(userId)`.
- `IDX_person_control_lookup_face (face_profile_id) WHERE deleted_at IS NULL AND active = true` — tồn tại sẵn nhưng UC-125 đợt này KHÔNG dùng (chữ ký hàm chỉ nhận `userId`, xem §1 câu 3) — residual §7.

### 0.3. Mirror CRUD tham chiếu ([vehicle-control-list.service.ts](../../../../src/modules/anpr/services/vehicle-control-list.service.ts) + [vehicle-control-alert.service.ts](../../../../src/modules/anpr/services/vehicle-control-alert.service.ts))
UC-125 mirror ĐÚNG 2 tầng đã có cho xe: `PersonControlListService` (CRUD thuần, pre-check + 23505 → 409) tách biệt `PersonWatchlistCheckService` (throttle + `recordAlert` + notification) — giữ đúng nguyên tắc tách biệt "lookup thuần" khỏi "đích cảnh báo" đã áp dụng nhất quán trong repo (`checkControlList` vs `VehicleControlAlertService`).

### 0.4. `NotificationType` enum hiện tại ([notification.entity.ts](../../../../src/modules/notifications/entities/notification.entity.ts))
Đã có tiền lệ thêm 1 giá trị cho UC9 (`VEHICLE_CONTROL_LIST_MATCH`). UC-125 thêm tương tự `PERSON_WATCHLIST_MATCH` — sửa 1 dòng enum, KHÔNG đổi cấu trúc bảng `notifications`.

### 0.5. Migration mới nhất sau UC-124 (0 migration) vẫn `20260723000006`. UC-125 dùng **`20260723000007`**.

---

## 1. Câu hỏi nghiệp vụ đã chốt (AskUserQuestion, dùng chung cho cả 5 cụm Bước 3)
Câu 3: `checkPersonWatchlist` **CHỈ nhận `userId: string`** — KHÔNG mở rộng nhận `faceProfileId`. Hệ quả: watchlist người ngoài (chỉ có `faceProfileId`/`displayName`, không có `userId`) KHÔNG được đối chiếu tự động qua hàm này ở đợt này (residual §7 — vẫn quản lý được qua CRUD, chỉ thiếu phần auto-match).

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **`priority` dùng trực tiếp làm `severity`** khi gọi `recordAlert()` — KHÔNG cần bảng mapping riêng (khác `vehicle_control_match`/`stranger` phải suy severity từ `listType`/mặc định tĩnh). Lý do: `person_control_list.priority` và `security_alerts.severity` CÙNG vocabulary (`low/medium/high/critical`, cả 2 default `'medium'`) — đúng ý nghĩa cột đã ghi trong entity comment "mức ưu tiên cảnh báo RIÊNG từng hồ sơ (UC-125 BR2)".
2. **Permission role CRUD `person_control_list`**: mirror ĐÚNG `vehicle_control.*` (UC-122 đã áp dụng cùng pattern) — `create/update/delete` → `BUSINESS_ADMIN,SYSTEM_ADMIN`; `read` → thêm `MANAGER`. Lý do: cùng loại nghiệp vụ "quản lý danh sách kiểm soát", không có căn cứ nào tách khác `vehicle_control_list`.
3. **`checkPersonWatchlist` KHÔNG throw lỗi ra ngoài** (NotThrow toàn bộ, mirror `VehicleControlAlertService.evaluate()`) — vì đây là hàm Hải gọi TRỰC TIẾP trong luồng xử lý event nhận diện của `face-access`; lỗi cảnh báo KHÔNG được phép làm hỏng luồng nhận diện chính (đúng nguyên tắc NotThrow đã áp dụng nhất quán toàn repo cho mọi luồng alert).
4. **Throttle in-memory 300s/`userId`** (mirror `VehicleControlAlertService`/`StrangerAlertService`) — KHÔNG dùng cơ chế bền vững hơn (Redis) ở đợt này, chấp nhận reset khi restart/không chia sẻ giữa nhiều instance (đúng hạn chế đã ghi nhận & chấp nhận ở 2 service kia).
5. **`zoneId: null`** khi gọi `recordAlert('person_watchlist_match', ...)` — chữ ký `checkPersonWatchlist(userId)` KHÔNG nhận tham số zone/context nào khác (đúng quyết định câu hỏi 3), nên KHÔNG có zone để gắn. Nếu sau này Hải cần gắn zone (biết thiết bị nhận diện đặt ở đâu), phải đổi CHỮ KÝ HÀM — ngoài phạm vi đợt này.
6. **CRUD pre-check dedup TÁCH 2 NHÁNH ĐỘC LẬP** (khác UC-122 chỉ 2 nhánh loại trừ nhau theo `zoneId`): nếu request có CẢ `userId` VÀ `faceProfileId`, PHẢI kiểm tra CẢ HAI điều kiện dedup riêng (`(userId, listType)` VÀ `(faceProfileId, listType)`) — 1 trong 2 trùng là đủ để 409, vì đây là 2 unique index ĐỘC LẬP (không phải 2 nhánh loại trừ như `alert_rules.zoneId`).
7. **Người chỉ có `displayName`** (cả `userId` VÀ `faceProfileId` đều NULL) — KHÔNG dedup được (đúng comment entity đã ghi "chấp nhận trùng"), CHO PHÉP tạo tự do, KHÔNG pre-check gì thêm cho case này.

---

## 3. Scope (UC-125)

### TRONG scope
1. **`PersonControlListService`** (CRUD, mirror `VehicleControlListService`):
   - `create(dto, actorUserId)`: pre-check 2 nhánh độc lập (§2.6) → 409 nếu trùng → `save()` với safety-net `23505`.
   - `list(query)`: filter `listType`/`active`/`userId`/`faceProfileId`, phân trang chuẩn.
   - `findOne(id)`, `update(id, dto)` (re-check dedup nếu đổi `userId`/`faceProfileId`), `remove(id)` (soft-delete).
2. **`PersonWatchlistCheckService.checkPersonWatchlist(userId: string): Promise<void>`** (method public — điểm vào DUY NHẤT cho `face-access` gọi):
   1. `SELECT` `person_control_list` WHERE `userId = userId AND active = true AND deletedAt IS NULL` (dùng `IDX_person_control_lookup_user`) → KHÔNG thấy → return (no-op).
   2. Throttle in-memory 300s/`userId` → trong window → return.
   3. `findEffectiveRule('person_watchlist_match', null)` → `suppressed` → return.
   4. `recordAlert({alertType: 'person_watchlist_match', zoneId: null, severity: match.priority, ruleId: rule?.id ?? null, payloadJson: {personControlListEntryId: match.id, displayName: match.displayName, listType: match.listType, reason: match.reason, userId}})`.
   5. `resolveRecipients()` (role `MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN`, mirror `VehicleControlAlertService`) → `notificationsService.createNotification({notificationType: PERSON_WATCHLIST_MATCH, ...})`.
   6. Toàn bộ bước 2-5 bọc `try/catch` NotThrow (§2.3).
3. Thêm `NotificationType.PERSON_WATCHLIST_MATCH` vào enum (§0.4).
4. Migration seed 4 permission `person_control_list.create/read/update/delete` (timestamp `20260723000007`, role mapping §2.2).
5. `AlertsModule` bổ sung `PersonControlListService`+`PersonControlListController`+`PersonWatchlistCheckService`, `exports: [..., PersonWatchlistCheckService]` (để `face-access` import gọi `checkPersonWatchlist`).

### NGOÀI scope (KHÔNG làm ở đây)
- Wiring điểm gọi THẬT trong `face-access` (luồng xử lý event nhận diện của Hải) — đúng phân công roadmap "Hải gọi", KHÔNG phải việc Tài. UC-125 chỉ EXPOSE hàm sẵn sàng để import.
- Đối chiếu theo `faceProfileId` (người ngoài không có `userId`) — residual §7, do câu hỏi 3 đã chốt thu hẹp chữ ký hàm.
- Enroll ảnh lên thiết bị nhận diện — quyết định đã chốt với Hải từ trước (chỉ lưu `media_files` đối chiếu thủ công), KHÔNG đụng lại ở UC-125.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** tạo `person_control_list` với `userId` khác NULL và đã tồn tại bản ghi sống cùng `(userId, listType)` **→** hệ thống trả 409.
- **R2**: **WHEN** tạo với `faceProfileId` khác NULL và đã tồn tại bản ghi sống cùng `(faceProfileId, listType)` **→** hệ thống trả 409 (ĐỘC LẬP với R1 — cả 2 điều kiện đều được kiểm nếu request có cả 2 trường, §2.6).
- **R3 (crux)**: **IF** race condition khiến 1 trong 2 pre-check ở R1/R2 pass nhưng INSERT đụng unique (`23505`) **→** hệ thống bắt lỗi, trả 409 sạch.
- **R4**: **WHEN** `checkPersonWatchlist(userId)` được gọi và KHÔNG tìm thấy bản ghi `active=true` khớp `userId` **→** hệ thống return ngay, KHÔNG làm gì thêm (no-op, KHÔNG lỗi).
- **R5**: **WHEN** tìm thấy match VÀ qua throttle VÀ rule `person_watchlist_match` KHÔNG bị suppressed **→** hệ thống gọi `recordAlert()` với `severity = match.priority`, sau đó gửi notification.
- **R6**: **WHEN** rule `person_watchlist_match` bị suppressed (tắt tường minh) **→** hệ thống KHÔNG gọi `recordAlert()`, KHÔNG gửi notification.
- **R7 (crux)**: **IF** `checkPersonWatchlist()` gặp lỗi bất kỳ ở bước lookup/throttle/recordAlert/notification **→** hệ thống bắt lỗi, log, KHÔNG throw ra ngoài (NotThrow — caller là luồng nhận diện chính của `face-access`, không được phép bị chặn bởi lỗi cảnh báo).
- **R8**: **WHEN** DELETE `/person-control-list/:id` **→** hệ thống soft-delete, KHÔNG hard-delete.

## 5. Constitution

- **ARCH-01**: `checkPersonWatchlist()` là điểm vào DUY NHẤT — `face-access` (khi wiring, ngoài phạm vi UC-125) KHÔNG tự query `person_control_list` trực tiếp.
- **ARCH-02 (crux)**: `AlertsModule` KHÔNG import `FaceAccessModule` — `checkPersonWatchlist(userId)` nhận `userId` qua tham số, KHÔNG tự đi hỏi `face-access`/`accounts` thêm thông tin.
- **DATA-01**: KHÔNG đổi schema `person_control_list` đã duyệt/áp RDS.
- **DATA-02**: Dedup CRUD qua unique index + bắt `23505`, mirror UC-122/`VehicleControlListService`.
- **SEC-01**: Toàn bộ endpoint `person-control-list` yêu cầu `@RequirePermissions('person_control_list.<action>')`.
- **SAFETY-01**: `checkPersonWatchlist()` NotThrow toàn bộ (R7).
- **NO-SCOPE-01**: KHÔNG wiring `face-access` gọi hàm này (ngoài phạm vi Tài).

## 6. Test cases trọng yếu
- CRUD: dedup 2 nhánh độc lập (userId/faceProfileId), case `displayName`-only KHÔNG dedup (tạo tự do), `23505` safety-net.
- `checkPersonWatchlist`: không match → no-op; match + throttle window → skip; match + suppressed → skip cả recordAlert lẫn notification; match hợp lệ → `recordAlert` với `severity=match.priority` ĐÚNG, rồi notification; lỗi bất kỳ bước nào → NotThrow (assert không lộ exception ra ngoài).

## 7. Residuals / known-gaps
- **Đối chiếu theo `faceProfileId`** (người ngoài không `userId`) — KHÔNG làm ở đợt này (câu hỏi 3 đã chốt thu hẹp). Nếu cần sau: thêm `checkPersonWatchlistByFaceProfile(faceProfileId)` riêng hoặc mở rộng chữ ký `checkPersonWatchlist` (BREAKING CHANGE cho điểm gọi Hải — cần thống nhất lại).
- **`zoneId: null`** cho mọi alert `person_watchlist_match` — chữ ký hàm không nhận context zone.
- **Wiring điểm gọi thật trong `face-access`** — thuộc Hải, KHÔNG phải Tài.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 5 cụm Bước 3 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
