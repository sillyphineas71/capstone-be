# ARL-001 — plan.md (UC-122 Alerts / SAVP: CRUD alert_rules)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ARL-001 cùng lượt với spec (OQ đã chốt trước, xem spec §1). Module `alerts` đã tồn tại schema-only — thêm service/controller/DTO, KHÔNG DDL bảng mới. | Toàn bộ |
| 2026-07-23 | Bổ sung implementation sketch `findEffectiveRule` (đồng bộ spec §2.8/§4/R10). | §4 |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `AlertRuleEntity` đã `TypeOrmModule.forFeature` sẵn trong `AlertsModule` (`src/modules/alerts/alerts.module.ts`) — KHÔNG cần forFeature lại, chỉ thêm `providers`/`controllers`.
- `RequirePermissions` decorator: `src/modules/auth/decorators/require-permissions.decorator.ts` — dùng như `@RequirePermissions('alert_rules.create')`, guard thật là `PermissionsGuard` + `JwtAuthGuard` (mirror `VehicleControlListController`).
- `isUniqueViolation` hiện là private method lặp lại ở từng service (`VehicleControlListService`, tương tự các service khác) — KHÔNG có helper dùng chung ở `common/`. UC-122 tiếp tục lặp lại pattern này (đúng ghi chú trong code cũ "chấp nhận trùng nhỏ giữa 2 service để tránh động code UC1 đang chạy") — KHÔNG refactor ra shared util ở feature này (out of scope, tránh đụng code đang chạy).
- Migration mới nhất trong repo: 20260723000003. UC-122 dùng timestamp 20260723000005.
- `@CurrentUser()` decorator có sẵn (xác nhận đường dẫn thật ở T0) để lấy `actorUserId` cho `createdBy`/`updatedBy`.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §1 (4 câu hỏi Bước 3) + §2 (7 quyết định suy luận: threshold nullable, allowlist 7 alert_type, channels 2 giá trị, role CRUD mirror vehicle_control, enabled xử lý ở tầng đọc, format restricted_hours_json/allowed_person_ids_json). Constitution đầy đủ ở spec §6. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
`AlertRuleEntity` giữ nguyên 100%. KHÔNG thêm cột, KHÔNG migration DDL.

## 3. DTO mới (module alerts)

Đường dẫn:
- src/modules/alerts/dto/create-alert-rule.dto.ts
- src/modules/alerts/dto/update-alert-rule.dto.ts (PartialType(CreateAlertRuleDto))
- src/modules/alerts/dto/query-alert-rules.dto.ts (page/limit/sortBy/sortOrder + filter alertType/zoneId/enabled)

`CreateAlertRuleDto`: `alertType` (IsIn 7 giá trị), `zoneId` (IsUUID, IsOptional), `threshold` (IsInt, Min 1, IsOptional), `channels` (IsArray, ArrayNotEmpty, IsIn(['in_app','email']) mỗi phần tử), `enabled` (IsBoolean, IsOptional, default true), `restrictedHoursJson` (nested DTO optional, allowFrom/allowTo regex HH:mm), `allowedPersonIdsJson` (IsArray, IsUUID mỗi phần tử, IsOptional).

## 4. Service — AlertRulesService (file mới: src/modules/alerts/services/alert-rules.service.ts)

- Constructor: inject Repository<AlertRuleEntity>.
- `create(dto, actorUserId)`:
  1. Pre-check: nếu dto.zoneId có giá trị thì kiểm tồn tại {alertType, zoneId, deletedAt IS NULL}; nếu zoneId NULL thì kiểm {alertType, zoneId IS NULL, deletedAt IS NULL}.
  2. Có → throw ConflictException 409 (message rõ alertType+zoneId).
  3. Không → save() trong try/catch, bắt lỗi driver code 23505 (isUniqueViolation) → 409 (safety-net race).
- `list(query)`: where động theo alertType/zoneId/enabled, luôn deletedAt IS NULL, skip/take theo page/limit, order theo sortBy (allowlist createdAt/alertType) — mirror VehicleControlListService.list.
- `findOne(id)`: không thấy → NotFoundException.
- `update(id, dto, actorUserId)`: nếu dto.alertType/dto.zoneId đổi khác giá trị cũ → re-run pre-check (loại trừ chính id hiện tại); merge field còn lại; save() trong try/catch bắt 23505.
- `remove(id, actorUserId)`: softDelete(id).
- `findActiveRule(alertType, zoneId?)` (method public mới, dùng bởi UC-123/124/125/3d sau): nếu zoneId có giá trị, tìm rule riêng zone enabled=true trước; không thấy (hoặc zoneId không truyền) → fallback rule mặc định (zoneId IS NULL, enabled=true). Trả null nếu không có rule nào bật.
- `private isUniqueViolation(e: unknown): boolean` — copy y hệt VehicleControlListService (đọc driverError.code === '23505').

- `findEffectiveRule(alertType, zoneId?)` (spec §4/§2.8/R10):
```ts
async findEffectiveRule(alertType: string, zoneId?: string | null): Promise<{ rule: AlertRuleEntity | null; suppressed: boolean }> {
  const enabled = await this.findActiveRule(alertType, zoneId);
  if (enabled) return { rule: enabled, suppressed: false };
  if (zoneId) {
    const zonedDisabled = await this.repo.findOne({ where: { alertType, zoneId, enabled: false, deletedAt: IsNull() } });
    if (zonedDisabled) return { rule: null, suppressed: true };
  }
  const globalDisabled = await this.repo.findOne({ where: { alertType, zoneId: IsNull(), enabled: false, deletedAt: IsNull() } });
  if (globalDisabled) return { rule: null, suppressed: true };
  return { rule: null, suppressed: false }; // chưa từng cấu hình — fail-open (§2.8)
}
```

## 5. Controller — AlertRulesController (file mới: src/modules/alerts/controllers/alert-rules.controller.ts)

- POST /api/v1/alert-rules → RequirePermissions('alert_rules.create').
- GET /api/v1/alert-rules → RequirePermissions('alert_rules.read').
- GET /api/v1/alert-rules/:id → RequirePermissions('alert_rules.read').
- PATCH /api/v1/alert-rules/:id → RequirePermissions('alert_rules.update').
- DELETE /api/v1/alert-rules/:id → RequirePermissions('alert_rules.delete').
- Response format chuẩn CLAUDE.md 8.1 (success/message/data/meta).

## 6. Migration seed permission (mới, cùng commit)

File: src/database/migrations/20260723000005-SeedAlertRulesPermissions.ts — mirror y hệt 20260722000001-SeedVehicleControlListPermissions.ts (spec 0.5): module_code='alerts', 4 entry alert_rules.create/read/update/delete, role mapping đúng spec 2.4 (create/update/delete → BUSINESS_ADMIN,SYSTEM_ADMIN; read → thêm MANAGER).

## 7. Wiring AlertsModule (modified: src/modules/alerts/alerts.module.ts)

Thêm providers: [AlertRulesService], controllers: [AlertRulesController], exports: [AlertRulesService, TypeOrmModule] (export AlertRulesService để UC-123/124/125/3d sau này import AlertsModule và inject dùng findActiveRule, KHÔNG tự query repository).

## 8. File list

Net-new (6 file):
- src/modules/alerts/dto/create-alert-rule.dto.ts
- src/modules/alerts/dto/update-alert-rule.dto.ts
- src/modules/alerts/dto/query-alert-rules.dto.ts
- src/modules/alerts/services/alert-rules.service.ts (+ .spec.ts)
- src/modules/alerts/controllers/alert-rules.controller.ts (+ .spec.ts)
- src/database/migrations/20260723000005-SeedAlertRulesPermissions.ts

Modified (1 file):
- src/modules/alerts/alerts.module.ts: thêm providers/controllers/exports.

Tổng 6 net-new + 1 modified. 0 thay đổi entity/DDL bảng nghiệp vụ (chỉ 1 migration seed permission).

## 9. Test (mock repo — KHÔNG DB)

- create: conflict zone-scoped / conflict global (zoneId NULL) / thành công; 23505 safety-net (mock repo.save throw QueryFailedError code 23505) → 409.
- update: đổi alertType/zoneId → re-check conflict (loại trừ chính id); đổi field khác (threshold/channels/enabled) → KHÔNG re-check.
- findActiveRule: có rule riêng zone + rule mặc định cùng bật → trả rule riêng zone (BR2); chỉ có rule mặc định → trả rule mặc định; rule tồn tại nhưng enabled=false → trả null; không có rule nào → null.
- DTO validate: threshold<=0 → 400; alertType ngoài allowlist → 400; channels rỗng/giá trị lạ → 400; restrictedHoursJson sai regex HH:mm → 400; allowedPersonIdsJson phần tử không phải UUID → 400.
- Controller: 5 route đúng RequirePermissions (assert qua reflect metadata, mirror vehicle-registration.controller.spec.ts).
- Coverage ≥80% file mới.

## 10. Gate (STOP, KHÔNG commit)

- build=0; eslint file mới 0 warning mới; npx jest src/modules/alerts xanh; coverage ≥80% file mới; DI-proof compile AppModule. KHÔNG live, KHÔNG DB thật.
- Owed (ghi, KHÔNG chạy): validate FK thật allowed_person_ids_json với users · CHECK constraint DB cho alert_type.

## 11. Kỷ luật

- DATA-02: dedup conflict luôn qua unique index + bắt 23505, KHÔNG chỉ pre-check.
- ARCH-02: AlertsModule KHÔNG import FaceAccessModule/AnprModule.
- KHÔNG tự code UC-123/124/125/3d ở đây — 4 feature riêng, xem thư mục ngang cấp.

STOP. Plan-only (viết cùng lượt với spec do OQ đã chốt trước). Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
