# ARL-001 — UC-122 (Alerts / SAVP): CRUD `alert_rules`

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo spec ARL-001 (UC-122): CRUD `alert_rules` — ngưỡng/kênh/bật-tắt theo `alert_type`, override theo zone, cấu hình cho UC-124. RECON code thật (entity `AlertRuleEntity` schema-only, 2 partial unique zone_id NULL-safe, module `AlertsModule` hiện chỉ đăng ký entity). 4 câu hỏi nghiệp vụ chốt qua AskUserQuestion cho cả cụm Bước 3 (phạm vi 5 cụm, role trung tâm cảnh báo, chữ ký `checkPersonWatchlist`, nguồn UC-124) trước khi viết 5 spec — xem §1. | Toàn bộ |
| 2026-07-23 | Bổ sung §2.8 (fail-open khi chưa cấu hình rule) + method `findEffectiveRule` (§4) + R10 (§5) — phát hiện khi viết spec 3d rằng `findActiveRule` không đủ để phân biệt "chưa cấu hình" vs "đã tắt tường minh", cần thiết để AF1/BR1 (tắt rule = ngừng sinh cảnh báo) thực sự có hiệu lực mà không làm câm các cảnh báo chưa kịp cấu hình rule. | §2 (mục 8 mới), §4, §5 (R10 mới) |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Bước 3 lộ trình SAVP của Tài (`../../../../../LO_TRINH_SAVP_TAI.md`) gồm 5 cụm viết **cùng lượt** (quyết định Thiếu Chủ qua AskUserQuestion): **UC-122 (file này)**, UC-123 (`../uc123-alert-center/`), 3d hợp nhất nguồn cũ (`../legacy-alert-source-migration/`), UC-124 (`../uc124-restricted-zone-intrusion/`), UC-125 (`../uc125-person-watchlist/`). UC-122 làm trước vì UC-123 (evaluate/acknowledge), UC-124 (đọc `restricted_hours_json`/`allowed_person_ids_json`) đều phụ thuộc bảng `alert_rules` đã có cấu hình.
>
> **STOP.** Spec+Plan+Tasks của cả 5 cụm viết cùng lượt (OQ nghiệp vụ đã chốt trực tiếp với Thiếu Chủ trước khi viết — xem §1). Chờ Thiếu Chủ duyệt toàn bộ 15 file trước khi cho phép code bất kỳ cụm nào.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Entity đã tồn tại, schema-only ([alert-rule.entity.ts](../../../../src/modules/alerts/entities/alert-rule.entity.ts))
`AlertRuleEntity` (bảng `alert_rules`): `alertType` (varchar 40), `zoneId` (FK zones, SET NULL, nullable — NULL = rule mặc định toàn khuôn viên), `threshold` (nullable), `channels` (jsonb, default `["in_app"]`), `enabled` (boolean, default true), `restrictedHoursJson`/`allowedPersonIdsJson` (jsonb, nullable — dành cho UC-124), `createdBy`/`updatedBy`, soft-delete `deletedAt`. Comment entity xác nhận: "Schema-only: KHÔNG logic nghiệp vụ (CRUD, validate ngưỡng, đánh giá rule = UC-122 sau)" → UC-122 chính là UC đó.

### 0.2. Index thật đã tạo (migration `20260722000006-CreateAlertRulesTable.ts`, đã áp RDS)
- `UQ_alert_rules_type_zone_active (alert_type, zone_id) WHERE deleted_at IS NULL AND zone_id IS NOT NULL` — mỗi (loại, zone) chỉ 1 rule sống.
- `UQ_alert_rules_type_global_active (alert_type) WHERE deleted_at IS NULL AND zone_id IS NULL` — mỗi loại chỉ 1 rule mặc định toàn khuôn viên sống. **TÁCH 2 index vì SQL coi NULL != NULL** (đã chốt với Hải — xem `PHAN_HOI_DUYET_3_BANG_ALERT_CENTER.md` §1.1) → tầng service PHẢI bắt `23505` chuyển 409, KHÔNG chỉ dựa pre-check.
- `IDX_alert_rules_lookup (alert_type) WHERE deleted_at IS NULL AND enabled = true` — hot path cho UC-123/124/125 đánh giá rule đang bật.

### 0.3. `AlertsModule` hiện tại ([alerts.module.ts](../../../../src/modules/alerts/alerts.module.ts))
Chỉ `TypeOrmModule.forFeature([AlertRuleEntity, SecurityAlertEntity, PersonControlListEntity])`, `exports: [TypeOrmModule]`. KHÔNG controller/service/DTO. Comment ghi rõ ràng buộc kiến trúc MỘT CHIỀU: `alerts` KHÔNG import ngược `face-access`/`anpr`, cấm `forwardRef` — module gọi (khi cần) import `AlertsModule`/`AlertsService` và truyền dữ liệu qua tham số.

### 0.4. Pattern CRUD + conflict 23505 tham chiếu ([vehicle-control-list.service.ts](../../../../src/modules/anpr/services/vehicle-control-list.service.ts))
`VehicleControlListService` (UC8, đang chạy) là mirror gần nhất: pre-check trùng `(plate, list_type)` còn sống → 409 `ConflictException`, kèm safety-net bắt `23505` (`isUniqueViolation(e)`, đọc `e.driverError.code === '23505'`) chuyển đúng nhánh 409 thay vì để lỗi DB phọt ra client. UC-122 áp dụng NGUYÊN mẫu này cho cặp `(alert_type, zone_id)`, nhưng phải xử lý **2 nhánh** (zone_id có giá trị / zone_id NULL) tương ứng 2 index tách ở §0.2 — pre-check cũng phải tách 2 câu query, KHÔNG gộp 1 `WHERE alert_type = X AND zone_id = Y` (sẽ sai khi Y NULL, vì SQL `= NULL` luôn false).

### 0.5. Permission seed pattern tham chiếu ([20260722000001-SeedVehicleControlListPermissions.ts](../../../../src/database/migrations/20260722000001-SeedVehicleControlListPermissions.ts))
Idempotent qua `WHERE NOT EXISTS`/`NOT EXISTS` (KHÔNG có unique constraint trên `permission_code` để dùng `ON CONFLICT`), seed cả `permissions` lẫn `role_permissions` trong 1 migration, `module_code` = tên module (`'anpr'`), `action_code` = create/read/update/delete. UC-122 mirror y hệt, `module_code = 'alerts'`.

### 0.6. Migration mới nhất trong repo: `20260723000003` (`SeedGateAccessStatsReadPermission`, Bước 2). UC-122 dùng timestamp bắt đầu **`20260723000005`**.

### 0.7. Role hệ thống xác nhận qua `20260720000002-SeedCoreRoles.ts`
Chỉ 4 role: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE`. KHÔNG có role "bảo vệ"/"security guard" riêng như SRS mô tả người vận hành Trung tâm cảnh báo — đã hỏi Thiếu Chủ (xem §1 câu 2, áp dụng cho UC-123). Với UC-122 (cấu hình rule — việc của **Admin**, không phải người trực), suy luận riêng: mirror đúng `vehicle_control.create/update/delete` (chỉ `BUSINESS_ADMIN`+`SYSTEM_ADMIN`), `vehicle_control.read` (thêm `MANAGER`) — xem §2.3.

---

## 1. Câu hỏi nghiệp vụ đã chốt (AskUserQuestion, trước khi viết cả 5 spec Bước 3)

1. **Phạm vi viết tài liệu đợt này**: làm trọn cụm 3b→3e (UC-122/123/124/125 + 3d) **cùng lượt**, không tách nhỏ dần từng UC.
2. **Role vận hành Trung tâm cảnh báo (UC-123)**: `MANAGER` + `BUSINESS_ADMIN` + `SYSTEM_ADMIN` — KHÔNG mở cho `EMPLOYEE`.
3. **Chữ ký `checkPersonWatchlist`**: CHỈ nhận `userId: string` (đúng như roadmap đã ghi) — KHÔNG mở rộng nhận thêm `faceProfileId`. Hệ quả: watchlist người ngoài chỉ có `face_profile_id`/`display_name` (không có `user_id`) sẽ KHÔNG được đối chiếu tự động qua hàm này ở đợt này — xem Residuals UC-125 §7.
4. **Nguồn sự kiện UC-124**: đối chiếu **CẢ HAI** `gate_access_logs` VÀ `zone_presence_events`, và thuộc phạm vi Bước 3 (Tài làm ngay, không để dành).

## 2. Quyết định thiết kế suy luận thêm (chưa hỏi riêng — ghi rõ lý do, KHÔNG tự ý đổi khi code)

1. **Threshold validate**: `threshold` chỉ bắt buộc dương (`> 0`) **KHI CÓ GIÁ TRỊ** (không NULL) — KHÔNG bắt buộc mọi `alert_type` phải có threshold. Lý do: theo thiết kế đã duyệt (`BAO_CAO_DE_XUAT...md` §3), chỉ `crowd` cần ngưỡng số người; `stranger`/`intrusion`/`vehicle_control_match`/`device_error`/`person_watchlist_match` không có khái niệm ngưỡng số — DB cột `threshold` vốn đã nullable đúng ý này.
2. **Danh sách `alert_type` hợp lệ**: dùng đúng 7 giá trị đã liệt trong báo cáo đã duyệt: `stranger`, `unknown_vehicle`, `vehicle_control_match`, `crowd`, `intrusion`, `device_error`, `person_watchlist_match`. Validate bằng `class-validator` `@IsIn([...])` ở DTO — KHÔNG ràng buộc CHECK constraint ở DB (cột vẫn `varchar(40)` tự do, đúng comment entity "giữ varchar, không ràng enum ở DB" — mirror `zone_type`).
3. **`channels` validate**: mảng string, mỗi phần tử `@IsIn(['in_app', 'email'])` (2 kênh đã có trong `NotificationChannel` mà `notifications` module hỗ trợ thật — KHÔNG thêm `sms`/`websocket` dù enum `NotificationChannel` có, vì UC-122 SRS chỉ nói "email/in-app"). Rỗng `[]` → 400 (phải có ít nhất 1 kênh, nếu không thì bật rule vô nghĩa).
4. **Permission role cho CRUD `alert_rules`** (RECON §0.7): `alert_rules.create/update/delete` → `BUSINESS_ADMIN`+`SYSTEM_ADMIN`; `alert_rules.read` → thêm `MANAGER`. Mirror đúng `vehicle_control.*` — cấu hình rule là việc Admin, tách biệt với việc "xem/xử lý cảnh báo" (UC-123, đã chốt riêng ở câu hỏi 2 cho phép `MANAGER` full).
5. **`enabled=false` (AF1/BR1)**: xử lý ở TẦNG ĐỌC rule lúc UC-123/124/125/3d đánh giá (`IDX_alert_rules_lookup` đã lọc sẵn `enabled=true`) — UC-122 chỉ cần cho phép PATCH cột `enabled`, KHÔNG có logic riêng nào khác (không xoá, không chặn ghi event gốc — đúng bản chất những UC khác tự đọc event gốc từ nguồn riêng, không qua `alert_rules`).
6. **`restricted_hours_json` format**: `{"allow_from": "HH:mm", "allow_to": "HH:mm"}` (đúng ví dụ trong báo cáo đã duyệt). Validate ở DTO: 2 field optional nhưng nếu có phải khớp regex `^([01]\d|2[0-3]):[0-5]\d$` — KHÔNG validate `allow_from < allow_to` (SRS không cấm khung giờ qua đêm kiểu 22:00→06:00, để UC-124 tự diễn giải khi có ca đêm).
7. **`allowed_person_ids_json` format**: mảng string UUID (`user_id` — KHÔNG validate FK tồn tại thật ở tầng DTO, đúng residual đã ghi nhận trong review Hải §1.4 "không FK, validate tay tầng application" — UC-122 chỉ validate ĐÚNG FORMAT UUID cho từng phần tử, KHÔNG query `users` để xác nhận tồn tại, tránh coupling `alerts → accounts` không cần thiết cho 1 validate không quan trọng bằng an toàn dữ liệu chính).
8. **Fail-open khi CHƯA cấu hình rule (bổ sung sau khi thiết kế `findEffectiveRule` — xem §4)**: nếu một `alert_type` CHƯA TỪNG có rule nào (kể cả disabled) trong `alert_rules`, `findEffectiveRule()` trả `suppressed: false` (KHÔNG chặn cảnh báo). Lý do: trước khi có UC-122, các nguồn cảnh báo cũ (`VehicleControlAlertService`) đã hoạt động KHÔNG qua `alert_rules` — nếu mặc định "chưa cấu hình = im lặng" thì việc bật tính năng CRUD rule vô tình làm CÂM toàn bộ cảnh báo đang chạy cho tới khi Admin kịp tạo đủ rule cho 7 `alert_type`. Đánh đổi có ý thức: để tắt hẳn 1 loại cảnh báo, Admin PHẢI tạo rule tường minh với `enabled=false` (không phải chỉ đơn giản "không tạo rule") — ghi rõ residual này cho UI/hướng dẫn Admin sau (ngoài phạm vi BE).

---

## 3. Scope (UC-122)

### TRONG scope
1. `AlertRulesService`: `create`, `list` (filter theo `alertType`/`zoneId`/`enabled`, phân trang chuẩn `page/limit/sortBy/sortOrder`), `findOne`, `update` (PATCH toàn bộ field cho phép, gồm `enabled`), `remove` (soft-delete).
2. Validate ngưỡng dương khi có giá trị (§2.1), validate `alertType` trong allowlist (§2.2), validate `channels` (§2.3), validate `restrictedHoursJson`/`allowedPersonIdsJson` format (§2.6/§2.7).
3. Conflict `(alert_type, zone_id)` còn sống → pre-check 2 nhánh + safety-net `23505` → 409 (mirror `VehicleControlListService`, xem §0.4).
4. `AlertRulesController`: `GET/POST /api/v1/alert-rules`, `GET/PATCH/DELETE /api/v1/alert-rules/:id` — theo đúng REST convention CLAUDE.md §7.3.
5. Migration seed 4 permission `alert_rules.create/read/update/delete` (timestamp `20260723000005`, mirror §0.5).
6. `AlertsModule` bổ sung `AlertRulesService`+`AlertRulesController`, `exports: [AlertRulesService]` (để UC-123/124/125/3d sau này inject đọc rule qua service, KHÔNG tự query repository ngoài module).

### NGOÀI scope (UC sau — KHÔNG làm ở đây)
- Đánh giá rule để sinh `security_alerts` (UC-123 engine `recordAlert`, UC-124 evaluator, UC-125 watchlist, 3d migration nguồn cũ) — đọc rule qua `AlertRulesService.findActiveRule()` (method mới, xem plan §4) nhưng KHÔNG code logic sinh alert ở feature này.
- API Trung tâm cảnh báo (list/detail/acknowledge) — `../uc123-alert-center/`.
- CRUD `person_control_list` — `../uc125-person-watchlist/`.
- Validate FK thật của `allowed_person_ids_json` với bảng `users` — residual, xem §2.7.
- Đổi schema (thêm cột `severity` vào `alert_rules`) — KHÔNG đụng migration đã duyệt/áp RDS; severity xử lý ở tầng `AlertsService.recordAlert()` (UC-123, static mapping theo `alert_type`), KHÔNG phải ở `alert_rules`.

---

## 4. Service (đề xuất — `AlertRulesService` mới, module `alerts`)

- `create(dto, actorUserId)`: build entity, pre-check conflict (2 nhánh theo `zoneId` null/not-null), `try { save } catch { if 23505 → 409 }`.
- `list(query)`: `where` động theo `alertType`/`zoneId`/`enabled`, luôn `deletedAt IS NULL`, phân trang chuẩn.
- `findOne(id)`: 404 nếu không thấy/đã xoá mềm.
- `update(id, dto, actorUserId)`: đổi `zoneId`/`alertType` phải re-check conflict (2 nhánh) — nếu chỉ đổi `threshold`/`channels`/`enabled`/`restrictedHoursJson`/`allowedPersonIdsJson` thì KHÔNG cần re-check (không đụng cặp unique).
- `remove(id, actorUserId)`: soft-delete (`softDelete`), KHÔNG hard-delete.
- `findActiveRule(alertType, zoneId?)` **(method public mới, dùng bởi UC-123/124/125/3d sau)**: đọc rule riêng zone trước (`alertType + zoneId`, `enabled=true`, `deletedAt IS NULL`), KHÔNG thấy → fallback rule mặc định toàn khuôn viên (`alertType`, `zoneId IS NULL`, `enabled=true`) — đúng BR2 "rule theo zone override rule mặc định". Trả `null` nếu không có rule nào bật (nghĩa là loại sự kiện này chưa cấu hình HOẶC đã tắt — 2 trường hợp KHÔNG phân biệt được qua hàm này, xem `findEffectiveRule` bên dưới để phân biệt).
- `findEffectiveRule(alertType, zoneId?)` **(method public mới — bổ sung §2.8, dùng bởi UC-123/124/125/3d TRƯỚC KHI gọi `recordAlert()`)**: giải quyết đúng khoảng xám AF1/BR1 "tắt = ngừng sinh cảnh báo, KHÔNG xoá rule" — `findActiveRule` không đủ vì trả `null` cho CẢ "chưa từng cấu hình" LẪN "đã tắt tường minh", trong khi 2 case này PHẢI xử lý khác nhau (xem §2.8). Trả `{ rule: AlertRuleEntity | null; suppressed: boolean }`:
  1. Tìm rule ENABLED theo đúng thứ tự ưu tiên của `findActiveRule` (zone trước, global sau) → thấy → `{ rule, suppressed: false }`.
  2. Không thấy rule enabled → tìm tiếp rule DISABLED cùng thứ tự ưu tiên (zone trước, global sau, `enabled=false`, `deletedAt IS NULL`) → thấy → `{ rule: null, suppressed: true }` (Admin đã tắt tường minh).
  3. Không thấy rule nào (kể cả disabled) → `{ rule: null, suppressed: false }` (chưa từng cấu hình — KHÔNG suppress, xem §2.8 lý do fail-open).

## 5. Requirements (EARS)

- **R1**: **WHEN** tạo `alert_rules` mới với `zoneId` khác NULL và đã tồn tại rule sống cùng `(alertType, zoneId)` **→** hệ thống trả 409, KHÔNG tạo bản ghi mới.
- **R2**: **WHEN** tạo `alert_rules` mới với `zoneId` NULL (rule mặc định) và đã tồn tại rule mặc định sống cùng `alertType` **→** hệ thống trả 409.
- **R3 (crux)**: **IF** race condition khiến pre-check pass nhưng INSERT đụng partial unique (`23505`) **→** hệ thống bắt lỗi driver code `23505`, trả 409 sạch (KHÔNG để lỗi DB nguyên văn ra client) — mirror `VehicleControlListService.isUniqueViolation`.
- **R4**: **WHEN** `threshold` được truyền khác NULL và `<= 0` **→** hệ thống trả 400.
- **R5**: **WHEN** `alertType` không thuộc 7 giá trị allowlist (§2.2) **→** hệ thống trả 400.
- **R6**: **WHEN** `channels` rỗng hoặc chứa giá trị ngoài `['in_app','email']` **→** hệ thống trả 400.
- **R7**: **WHERE** `enabled=false` **→** rule vẫn tồn tại trong bảng, `findActiveRule()` KHÔNG trả rule này (AF1/BR1: tắt = ngừng sinh cảnh báo, KHÔNG xoá rule).
- **R8**: **WHEN** `findActiveRule(alertType, zoneId)` được gọi và tồn tại CẢ rule riêng zone lẫn rule mặc định cùng `enabled=true` **→** hệ thống trả rule riêng zone (BR2 override).
- **R9**: **WHEN** DELETE `/alert-rules/:id` **→** hệ thống soft-delete (`deletedAt`), KHÔNG hard-delete, giải phóng lại slot unique cho `(alertType, zoneId)` (rule mới có thể tạo lại sau khi rule cũ bị xoá mềm — đúng ý nghĩa `WHERE deleted_at IS NULL` của partial unique).
- **R10 (crux)**: **WHEN** `findEffectiveRule(alertType, zoneId)` được gọi và KHÔNG có rule enabled nào khớp nhưng CÓ rule disabled khớp (zone trước, global sau) **→** trả `suppressed: true` (caller PHẢI bỏ qua `recordAlert()`). **WHEN** KHÔNG có rule nào khớp (kể cả disabled) **→** trả `suppressed: false` (fail-open, §2.8) — caller vẫn được phép `recordAlert()` với `ruleId: null`.

## 6. Constitution

- **ARCH-01**: Business logic nằm trong `AlertRulesService` (module `alerts`), controller chỉ nhận DTO + gọi service.
- **ARCH-02 (crux)**: `AlertsModule`/`AlertRulesService` TUYỆT ĐỐI KHÔNG import `FaceAccessModule`/`AnprModule` (kiến trúc một chiều đã chốt, §0.3) — kể cả `findActiveRule()` chỉ đọc dữ liệu nội bộ `alert_rules`, KHÔNG tự đi hỏi module khác.
- **DATA-01**: KHÔNG đổi schema 3 bảng đã duyệt/áp RDS — chỉ code CRUD trên schema hiện có.
- **DATA-02 (crux)**: Dedup conflict `(alert_type, zone_id)` PHẢI qua unique index + bắt `23505` — pre-check KHÔNG đủ (race window), mirror `VehicleControlListService`.
- **SEC-01**: Toàn bộ endpoint `alert-rules` yêu cầu `@RequirePermissions('alert_rules.<action>')`, theo bảng role §2.4 — KHÔNG endpoint nào public.
- **NO-SCOPE-01**: KHÔNG code logic sinh `security_alerts` ở feature này — chỉ expose `findActiveRule()` cho UC sau gọi.

## 7. Residuals / known-gaps

- **Validate FK thật `allowed_person_ids_json` với `users`** — chưa làm (chấp nhận theo review Hải §1.4), chỉ validate format UUID.
- **CHECK constraint DB cho `alert_type`** — không làm, chỉ validate tầng application (mirror `zone_type`).
- **Cột `severity` trong `alert_rules`** — không có, severity xử lý tĩnh theo `alert_type` ở `AlertsService.recordAlert()` (UC-123).

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md của cả 5 cụm Bước 3 trước khi cho phép code. KHÔNG tự code khi chưa có xác nhận.
