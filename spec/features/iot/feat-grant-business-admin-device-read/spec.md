# IOT-GAP-01 — (Không có UC gốc mới — khắc phục gap RBAC) Bổ sung quyền BUSINESS_ADMIN cho `iot.device.read`

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-29 | Tạo spec. Nguồn gốc: `Plan.md` (root repo) mục 1 — audit RBAC campus-dashboard/zones/security-alerts phát hiện `iot.device.read` là permission DUY NHẤT trong nhóm "mở RBAC cho BUSINESS_ADMIN" còn thiếu thật (các permission khác đã seed sẵn từ đợt UC-119/120/123/126). Đã hỏi lại qua AskUserQuestion để xác nhận phạm vi trước khi viết spec (không tự suy đoán). | Toàn bộ |

> Nguồn gốc: `Plan.md` (root, ngoài `capstone-be`) mục 1, dòng "Việc cần làm cụ thể — chỉ còn 1 mục". Không có UC gốc riêng trong SRS cho việc này — đây là gap-fix RBAC, mirror cách đặt tên feature "no UC gốc" của `feat-notification-inbox`. Route/permission liên quan đã có spec riêng: [IOT-013 — feat-list-iot-devices](../feat-list-iot-devices/spec.md) (spec đó KHÔNG cần sửa, route/logic giữ nguyên — chỉ mở rộng role được phép gọi).
>
> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.

---

## 0. RECON findings (đã đọc CODE THẬT)

### 0.1. Permission `iot.device.read` hiện tại — thiếu BUSINESS_ADMIN, không chỉ riêng lẻ
Migration `20260720000005-BackfillRolePermissions.ts` (873 dòng, backfill 119 permission_code cùng lúc cho 4 role lõi) dòng 334-339: `iot.device.read` → `roles: ['MANAGER', 'SYSTEM_ADMIN']`. **Toàn bộ nhóm `iot.device.*`** (check_availability, disable, enable, probe, read, update — dòng 311-345) đều CHỈ có 2 role này, nhất quán — không phải lỗi đánh máy 1 dòng.

### 0.2. KHÔNG có comment/lý do nghiệp vụ nào giải thích việc loại BUSINESS_ADMIN
Migration backfill (dòng 4-23) chỉ giải thích 2 việc: alias role cũ (`ADMIN→SYSTEM_ADMIN`, `INTERNAL_USER→EMPLOYEE`) và bỏ `ROOM_ADMIN` — KHÔNG đề cập lý do phân quyền `iot`. Dữ liệu là "trích xuất cơ học từ seed cũ" — không kết luận được đây là chủ ý hay thiếu sót. **Đã hỏi lại qua AskUserQuestion (§1) thay vì tự suy đoán.**

### 0.3. Route thật dùng permission này
`src/modules/iot/controllers/iot-devices.controller.ts`:
- `GET /api/v1/iot-devices` (method `list`, dòng 36-41) — `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@RequirePermissions('iot.device.read')` (dòng 39).
- Cùng permission còn dùng cho `GET status-summary` (dòng 54-56) và `GET :id` (dòng 68-70) — cả 3 route đều được mở theo cùng 1 permission-code, không tách riêng.
- Query (`ListIotDevicesQueryDto`): `page`, `limit` (max 100), `status`, `device_type`, `room_id`, `search` (ILIKE `device_name`/`device_code`).

### 0.4. `iot.device.disable/.enable/.probe/.update` — KHÔNG đụng ở feature này
Xem §1 (quyết định đã chốt) — chỉ mở `.read`.

---

## 1. Quyết định nghiệp vụ đã chốt (AskUserQuestion, phiên 2026-07-29)

1. **Chỉ thêm `iot.device.read` cho BUSINESS_ADMIN** — KHÔNG mở rộng `iot.device.disable/enable/probe/update`. Lý do: BUSINESS_ADMIN chỉ cần xem danh sách/trạng thái thiết bị (read-only) để đối chiếu với `campus-dashboard`, không cần quyền thao tác vận hành thiết bị — các permission thao tác giữ nguyên chỉ `MANAGER, SYSTEM_ADMIN` như hiện tại.

## 2. Quyết định thiết kế bổ sung

1. **Migration KHÔNG tạo permission mới** (permission `iot.device.read` đã tồn tại từ trước) — chỉ INSERT 1 dòng `role_permissions` cho `BUSINESS_ADMIN`. Mirror pattern `20260727000006-GrantManagerAvatarReviewPermission.ts` (JOIN trực tiếp `roles r, permissions p WHERE r.role_code=$1 AND p.permission_code=$2`, KHÔNG cần bước SELECT permission id riêng như `Seed...` — pattern đó dùng khi phải TẠO permission mới, không áp dụng ở đây), **KHÔNG mirror** `SeedCampusDashboardOverviewPermission.ts` (pattern đó dành cho permission mới hoàn toàn).
2. **Không sửa code controller/service/DTO** của `iot-devices.controller.ts` — route, guard, query giữ nguyên 100%; đây thuần túy là thay đổi dữ liệu `role_permissions`.

---

## 3. Scope

### TRONG scope
1. 1 migration mới: seed `role_permissions (BUSINESS_ADMIN, iot.device.read)`.

### NGOÀI scope (KHÔNG làm ở đây)
- Sửa `iot.device.disable/enable/probe/update` cho BUSINESS_ADMIN — chưa có yêu cầu, giữ nguyên `MANAGER, SYSTEM_ADMIN`.
- Sửa route/DTO/logic filter theo zone của `GET /iot-devices` — ngoài phạm vi, route hiện tại không tự-scope theo zone/team, giữ nguyên hành vi (trả toàn bộ danh sách thiết bị cho ai có permission).
- Bất kỳ thay đổi nào trong `spec/features/iot/feat-list-iot-devices/` — spec đó không cần sửa.

---

## 4. Requirements (EARS)

- **R1**: **WHEN** user có role BUSINESS_ADMIN gọi `GET /api/v1/iot-devices` (hoặc `status-summary`, `:id`) **→** hệ thống trả `200` (sau khi migration được áp), thay vì `403` như trước.
- **R2**: **WHEN** user có role BUSINESS_ADMIN gọi `PATCH .../disable`, `.../enable`, `.../probe`, `.../update` **→** hệ thống VẪN trả `403` (không thay đổi hành vi các permission khác).
- **R3**: **WHEN** migration chạy trên môi trường đã có sẵn dòng `role_permissions (BUSINESS_ADMIN, iot.device.read)` (idempotent-check) **→** hệ thống KHÔNG lỗi, KHÔNG tạo dòng trùng (`ON CONFLICT DO NOTHING`).

## 5. Constitution

- **DATA-01**: Migration CHỈ ghi `role_permissions` — KHÔNG đổi schema, KHÔNG đụng bảng `permissions`/`roles`.
- **SEC-01**: Không hạ thấp bảo mật — chỉ MỞ THÊM 1 role cho 1 permission read-only đã tồn tại, không tạo permission mới lỏng lẻo.
- **NO-SCOPE-01**: KHÔNG sửa `iot-devices.controller.ts`/service/DTO, KHÔNG mở rộng sang `iot.device.disable/enable/probe/update`.

## 6. Residuals / known-gaps

- **Lý do gốc BUSINESS_ADMIN bị loại khỏi `iot.device.*` từ đầu vẫn không rõ** — nếu sau này phát hiện có lý do bảo mật/nghiệp vụ cụ thể (ví dụ tài liệu SRS gốc mà agent chưa đọc tới), cần rà soát lại quyết định này. Ở thời điểm viết spec, user đã xác nhận qua AskUserQuestion là chấp nhận rủi ro này và đồng ý mở `.read`.

---

> **STOP.** Chờ Thiếu Chủ duyệt spec.md + plan.md + tasks.md trước khi cho phép code.
