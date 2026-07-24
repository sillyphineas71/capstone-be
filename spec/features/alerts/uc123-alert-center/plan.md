# ASC-001 — plan.md (UC-123 Alerts / SAVP: Trung tâm cảnh báo — engine + API)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan ASC-001 cùng lượt với spec. `recordAlert()` là hạt nhân dùng chung — module `alerts` thêm service/controller/DTO, KHÔNG DDL bảng mới. | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `SecurityAlertEntity` đã `TypeOrmModule.forFeature` sẵn trong `AlertsModule` — KHÔNG cần forFeature lại.
- `AlertRulesService` (UC-122, cùng module) đã export — `AlertsController`/`AlertsService` KHÔNG cần đọc `alert_rules` trực tiếp ở UC-123 (chỉ join hiển thị `rule` trong detail qua `ruleId` có sẵn trên chính `SecurityAlertEntity`, KHÔNG gọi `AlertRulesService`).
- Migration mới nhất sau UC-122 là `20260723000005`. UC-123 dùng timestamp `20260723000006`.
- `TypeORM QueryFailedError` — xác nhận cách đọc `driverError.code` giống hệt `VehicleControlListService.isUniqueViolation` (copy nguyên, KHÔNG refactor shared util — mirror quyết định UC-122 plan §0).
- Conditional UPDATE trả `affected` rows: TypeORM `Repository.update(criteria, partial)` trả `UpdateResult` có field `affected` — dùng để phát hiện race (R6/R8 EX1) mà KHÔNG cần transaction lock thủ công.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §1 (áp dụng câu 1/2 của 4 câu Bước 3) + §2 (7 quyết định suy luận: tách acknowledge/resolve, severity mapping tĩnh, giữ severity/triggeredAt khi gia hạn, list không lọc status mặc định, history dùng IS NOT DISTINCT FROM, bulk giới hạn 50). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
`SecurityAlertEntity` giữ nguyên 100%.

## 3. DTO mới (module alerts)

Đường dẫn:
- src/modules/alerts/dto/record-alert.input.ts (KHÔNG phải HTTP DTO — internal interface cho recordAlert(), dùng bởi module khác qua AlertsService, KHÔNG qua class-validator vì không đi qua HTTP boundary)
- src/modules/alerts/dto/query-security-alerts.dto.ts (page/limit/sortBy/sortOrder + filter alertType/zoneId/status/from/to)
- src/modules/alerts/dto/resolve-security-alert.dto.ts (resolutionNote: IsString, IsNotEmpty, MaxLength 1000)
- src/modules/alerts/dto/bulk-acknowledge-security-alerts.dto.ts (ids: IsArray, ArrayMinSize 1, ArrayMaxSize 50, IsUUID mỗi phần tử)

`QuerySecurityAlertsDto`: `alertType`/`zoneId`/`status` optional string, `from`/`to` optional ISO date string (IsDateString), `sortBy` allowlist (`triggeredAt`|`severity`|`status`, default `triggeredAt`), `sortOrder` (`asc`|`desc`, default `desc`).

## 4. Service — AlertsService (file mới: src/modules/alerts/services/alerts.service.ts)

- Constructor: inject Repository<SecurityAlertEntity>, DataSource (cho conditional update trực tiếp qua QueryBuilder nếu cần `affected`).
- `DEFAULT_SEVERITY_BY_TYPE`: static readonly Record<string, Severity> đúng bảng spec §2.2, `resolveSeverity(alertType, override?)` trả override nếu có, else map, else 'medium'.
- `recordAlert(input)`:
  1. `const severity = this.resolveSeverity(input.alertType, input.severity);`
  2. `try { const alert = await this.repo.save(this.repo.create({ alertType: input.alertType, zoneId: input.zoneId ?? null, severity, status: 'new', triggeredAt: input.triggeredAt ?? new Date(), occurrenceCount: 1, sourceEventId: input.sourceEventId ?? null, ruleId: input.ruleId ?? null, payloadJson: input.payloadJson ?? null })); return { alert, isNew: true }; }`
  3. `catch (e) { if (!this.isUniqueViolation(e)) throw e; }` — rơi xuống bước 4.
  4. Query lại alert đang mở cùng `(alertType, zoneId)` (2 nhánh null/not-null, mirror index) → nếu KHÔNG thấy (race hiếm: alert vừa resolved giữa lúc INSERT fail và SELECT lại) → retry INSERT 1 lần (guard vòng lặp vô hạn: chỉ retry đúng 1 lần, lần 2 vẫn lỗi thì throw thẳng).
  5. Thấy → `dataSource.createQueryBuilder().update(SecurityAlertEntity).set({lastSeenAt: () => 'NOW()', occurrenceCount: () => '"occurrence_count" + 1'}).where('id = :id', {id: found.id}).execute()`; reload row; trả `{alert: reloaded, isNew: false}`.
- `list(query)`: where động (`alertType`/`zoneId`/`status`/`triggeredAt Between from,to`), `order` theo `sortBy`/`sortOrder` (default `triggeredAt DESC`), phân trang chuẩn.
- `findOne(id)`: kèm `relations: ['zone', 'sourceEvent', 'rule']` — sau load thêm `history` riêng (query 2, KHÔNG relation TypeORM vì điều kiện `IS NOT DISTINCT FROM` không map thẳng qua `relations`).
  - `history(alertType, zoneId, excludeId)`: raw QueryBuilder `WHERE alert_type = :alertType AND zone_id IS NOT DISTINCT FROM :zoneId AND id != :excludeId ORDER BY triggered_at DESC LIMIT 20`.
- `acknowledge(id, actorUserId)`: `UpdateResult = await repo.update({id, status: 'new'}, {status: 'acknowledged', acknowledgedBy: actorUserId, acknowledgedAt: new Date()})`; `affected === 0` → reload alert hiện tại → throw `alreadyProcessedConflict(current)` (409, message dùng `acknowledgedByUser`/`acknowledgedAt` HOẶC `resolvedByUser`/`resolvedAt` tùy `current.status`).
- `resolve(id, dto, actorUserId)`: `UpdateResult = await repo.update({id, status: 'acknowledged'}, {status: 'resolved', resolvedBy: actorUserId, resolvedAt: new Date(), resolutionNote: dto.resolutionNote})`; `affected === 0` → reload → throw conflict tương tự (409, phân biệt case "chưa acknowledge" (`status='new'`) vs "đã resolved" (`status='resolved'`)).
- `bulkAcknowledge(ids, actorUserId)`: `for (const id of ids) { try { await this.acknowledge(id, actorUserId); acknowledged.push(id); } catch (e) { if (e instanceof ConflictException) alreadyProcessed.push({id, ...e.getResponse()}); else throw e; } }` — trả `{acknowledged, alreadyProcessed}`.
- `private isUniqueViolation(e: unknown): boolean` — copy y hệt UC-122/`VehicleControlListService`.

## 5. Controller — AlertsController (file mới: src/modules/alerts/controllers/alerts.controller.ts)

- `GET /api/v1/security-alerts` → `RequirePermissions('security_alert.read')`.
- `GET /api/v1/security-alerts/:id` → `RequirePermissions('security_alert.read')`.
- `POST /api/v1/security-alerts/:id/acknowledge` → `RequirePermissions('security_alert.acknowledge')`.
- `POST /api/v1/security-alerts/:id/resolve` → `RequirePermissions('security_alert.resolve')`.
- `POST /api/v1/security-alerts/bulk-acknowledge` → `RequirePermissions('security_alert.acknowledge')` (dùng chung quyền với acknowledge đơn — bulk chỉ là batch của cùng hành động).
- Response format chuẩn CLAUDE.md §8.1.

## 6. Migration seed permission (mới, cùng commit)

File: src/database/migrations/20260723000006-SeedSecurityAlertPermissions.ts — 3 entry `security_alert.read/acknowledge/resolve`, `module_code='alerts'`, role `MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN` cho CẢ 3 (spec §0.5).

## 7. Wiring AlertsModule (modified: src/modules/alerts/alerts.module.ts)

Thêm `providers: [AlertsService]` (bên cạnh `AlertRulesService` từ UC-122), `controllers: [AlertsController]`, `exports: [AlertsService, ...]` (giữ export cũ).

## 8. File list

Net-new (8 file):
- src/modules/alerts/dto/record-alert.input.ts
- src/modules/alerts/dto/query-security-alerts.dto.ts
- src/modules/alerts/dto/resolve-security-alert.dto.ts
- src/modules/alerts/dto/bulk-acknowledge-security-alerts.dto.ts
- src/modules/alerts/services/alerts.service.ts (+ .spec.ts)
- src/modules/alerts/controllers/alerts.controller.ts (+ .spec.ts)
- src/database/migrations/20260723000006-SeedSecurityAlertPermissions.ts

Modified (1 file):
- src/modules/alerts/alerts.module.ts

Tổng 8 net-new + 1 modified (chồng lên modified của UC-122 — 2 cụm cùng sửa 1 file `alerts.module.ts`, PHẢI code UC-122 xong trước UC-123 để tránh merge conflict giữa 2 lượt code, dù spec viết cùng lượt).

## 9. Test (mock repo/dataSource — KHÔNG DB)

- `recordAlert`: INSERT mới thành công; `23505` → UPDATE occurrenceCount đúng cả 2 nhánh zoneId null/not-null; severity giữ nguyên khi gia hạn; retry 1 lần khi race hiếm (không thấy alert đang mở sau 23505) rồi throw nếu retry vẫn fail.
- `resolveSeverity`: có override → dùng override; không override + type có trong map → đúng map; type lạ → fallback 'medium'.
- `acknowledge`/`resolve`: thành công đúng điều kiện status; conflict đúng message theo trạng thái hiện tại (assert cả 2 nhánh acknowledgedBy vs resolvedBy trong message).
- `bulkAcknowledge`: mix thành công + conflict, KHÔNG throw giữa chừng làm hỏng batch.
- `history`: raw query dùng đúng `IS NOT DISTINCT FROM` (assert SQL string hoặc kết quả case zoneId NULL).
- Coverage **≥80%** file mới.

## 10. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/alerts` xanh; coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: WebSocket push realtime · ảnh chưa đảm bảo có trong payload · `zoneId` NULL cho vehicle alert (chờ Hải).

## 11. Kỷ luật
- **DATA-02/03**: dedup và acknowledge/resolve LUÔN qua conditional update + kiểm affected/23505, KHÔNG pre-check rồi update riêng.
- **ARCH-01/02**: `recordAlert()` là điểm ghi DUY NHẤT; `AlertsModule` KHÔNG import ngược.
- KHÔNG tự code 3d/UC-124/UC-125 ở đây.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
