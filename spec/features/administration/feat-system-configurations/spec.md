# SCFG-001 — BE-09: System Configurations (GET/PATCH /system-configurations)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-27 | Tạo spec BE-09 (PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md §0.2, §4). Code + test xong cùng lượt. | Toàn bộ |

## 1. Bối cảnh

FE `systemAdmin/SystemSettings.jsx` gọi `GET /system-configurations` + `PATCH /system-configurations` (body `{key, value}`) cho **9 key phẳng**: `is_auto_release_enabled`, `no_show_threshold_minutes`, `grace_minutes`, `is_early_release_enabled`, `early_departure_threshold_minutes`, `is_host_warning_enabled`, `recording_retention_days`, `is_recording_consent_required`, `overrun_grace_minutes`. Trước BE-09, **không có controller/service nào phục vụ 2 route này**.

## 2. HAI HỆ TÊN KEY — ranh giới bắt buộc

Bảng `system_configs` đã có sẵn 5 key theo **hệ tên có dấu chấm**, đọc bởi các service nội bộ riêng biệt (KHÔNG qua endpoint này):

| Key (hệ chấm) | Đọc bởi |
| :--- | :--- |
| `no_show.auto_release_enabled` | `no-show-config.service.ts` (module `rooms`) |
| `recording.retention_days_default` | dữ liệu recording nội bộ |
| `org.timezone_default` | cấu hình tổ chức |
| `gate_access.closing_hour_local` | `gate-log-pairing.service.ts` (module `gate-access`) |
| `analytics.dashboard_max_range_days` | `dashboard-overview-config.service.ts` (module `analytics`) |

**BE-09 KHÔNG đụng 5 key này.** Endpoint `/system-configurations` (controller mới) **chỉ** đọc/ghi đúng 9 key phẳng trong `SYSTEM_CONFIG_ALLOWLIST` (`src/modules/administration/constants/system-config-allowlist.ts`) — allowlist là **nguồn sự thật duy nhất**, key ngoài allowlist → `400 CONFIG_KEY_NOT_ALLOWED`.

**Tồn tại song song 2 hệ tên trên CÙNG 1 bảng `system_configs`** — điều này là quyết định có chủ đích (xem PLAN §1 quyết định #2: "Seed đúng 9 key FE + dùng làm allowlist"), không phải lỗi thiết kế. Người sau đọc code KHÔNG được nhầm 2 hệ tên hoặc cố "hợp nhất" chúng nếu chưa có yêu cầu team.

## 3. Vấn đề nền phát hiện khi RECON (đã xử lý)

1. **`config_key` KHÔNG có unique index trên RDS thật** (chỉ PK trên `id`) — dù file migration `.sql` cũ có ghi `ux_system_configs_key`, cột đó KHÔNG tồn tại thật (đã kiểm `pg_constraint`/`pg_indexes` trực tiếp, xem `20260723000001-SeedGateAccessClosingHourConfig.ts:10-14`). → `upsert()` **KHÔNG dùng `ON CONFLICT (config_key)`** (sẽ lỗi `42P10`). Thay vào đó: `SELECT ... FOR UPDATE` (transaction, pessimistic lock) → có dòng thì UPDATE, không thì INSERT. Nếu phát hiện >1 dòng cùng key (dữ liệu rác có sẵn) → log cảnh báo + cập nhật dòng có `updated_at` mới nhất, KHÔNG tạo thêm dòng.
2. **Cột nhạy cảm.** `system_configs.is_sensitive` → GET mask giá trị (`value: null`) khi `true`. Không có key nào trong 9 key hiện tại đánh dấu sensitive, nhưng cơ chế phải sẵn sàng cho tương lai. `version_no` tăng mỗi lần PATCH; `updated_by` ghi user thực hiện.
3. **Shape response `{id, key, value, ...}`** (không phải `configKey`/`configValue`) — khớp đúng `SystemSettings.jsx:52-58` đọc `item.key`/`item.value`.

## 4. Scope

### Trong scope
- `GET /api/v1/system-configurations` — trả 9 key (hoặc ít hơn nếu chưa seed), field `key`/`value` (không phải `configKey`/`configValue`).
- `PATCH /api/v1/system-configurations` — body `{key, value}` (value luôn string, kể cả boolean/number) — khớp `SystemSettings.jsx:177`.
- Validate theo allowlist: kiểu (`boolean`: `'true'`/`'false'`; `number`: parse + kiểm `min`/`max`).
- Permission `admin.manage_config` — chỉ `SYSTEM_ADMIN` (màn `systemAdmin/SystemSettings.jsx` chỉ dành cho System Admin).
- Audit log mọi lần PATCH thành công (`system_config_update`).
- 2 migration: seed permission, seed 9 giá trị mặc định (idempotent, không `ON CONFLICT`).

### Ngoài scope
- Sửa/xóa 5 key hệ chấm sẵn có.
- Thêm unique index cho `config_key` (đụng bảng chung của cả team, cần qua Hải nếu muốn).
- UI/FE — đã có sẵn, không đổi.

## 5. Requirements (EARS)

- **R1**: **WHEN** gọi `GET /system-configurations` **→** hệ thống trả các dòng trong allowlist đang `is_active=true`, field `key`/`value`.
- **R2**: **WHEN** `key` PATCH KHÔNG nằm trong allowlist **→** `400 CONFIG_KEY_NOT_ALLOWED`.
- **R3**: **WHEN** `value` sai kiểu (không phải `'true'`/`'false'` cho key boolean, không parse được số cho key number) **→** `400 INVALID_CONFIG_VALUE`.
- **R4**: **WHEN** `value` (number) ngoài `[min, max]` của allowlist **→** `400 INVALID_CONFIG_VALUE`.
- **R5**: **WHEN** key CHƯA có dòng trong `system_configs` **→** INSERT mới, `version_no=1`.
- **R6**: **WHEN** key ĐÃ có dòng **→** UPDATE, `version_no` tăng 1, `updated_by` ghi user hiện tại.
- **R7 (crux)**: **WHEN** upsert chạy **→** hệ thống KHÔNG dùng `ON CONFLICT`, dùng `SELECT ... FOR UPDATE` trong transaction.
- **R8**: **WHEN** `is_sensitive=true` **→** GET trả `value: null` (masked).
- **R9**: **WHERE** người dùng KHÔNG có permission `admin.manage_config` **→** `403`.

## 6. Constitution

- **ARCH-01**: Logic nằm trong `SystemConfigService`, module `administration` (đã có sẵn `AuditLogsService`/`BackgroundJobsService` cùng module).
- **DATA-01**: KHÔNG `ON CONFLICT`, KHÔNG thêm unique index — dùng `SELECT FOR UPDATE` trong transaction.
- **SEC-01**: `@RequirePermissions('admin.manage_config')`, `forbidNonWhitelisted: true`.
- **SEC-02**: Mask `is_sensitive` ở GET.
- **AUDIT-01**: Ghi `audit_logs` mọi lần PATCH.

## 7. Residuals / known-gaps

- **Không thêm unique index cho `config_key`** — chấp nhận, vì đây là bảng chung của cả team; nếu 1 request khác chèn trùng key song song với PATCH (ngoài giao dịch này), `SELECT FOR UPDATE` chỉ khóa các dòng ĐÃ tồn tại tại thời điểm SELECT — 2 INSERT đồng thời (cả 2 đều thấy 0 dòng) vẫn có thể tạo ra 2 dòng trùng key. Rủi ro thấp trong thực tế (PATCH config hiếm khi có 2 request đồng thời cho CÙNG 1 key mới), nhưng ghi nhận residual thay vì giả vờ đã giải quyết triệt để.
- **Không validate cross-field** (vd. `grace_minutes` không được lớn hơn `no_show_threshold_minutes`, FE đã validate phía client) — BE chỉ validate từng key độc lập theo allowlist, không có rule liên-key.
