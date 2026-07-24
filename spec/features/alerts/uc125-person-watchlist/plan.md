# PWL-001 — plan.md (UC-125 Alerts / SAVP: watchlist người)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo plan PWL-001 cùng lượt với spec. Module `alerts` thêm 2 service (CRUD + check) + controller + DTO, sửa 1 dòng enum `NotificationType`, KHÔNG DDL bảng mới. | Toàn bộ |
| 2026-07-23 | Đánh số lại migration timestamp (phát hiện `LO_TRINH_SAVP_TAI.md` đã cập nhật: `20260723000004` thật đang dùng cho `SeedGateAccessDemoLogsForVerify` của Bước 2 verify, không còn trống như lúc viết spec ban đầu) — UC-122 dời `000004→000005`, UC-123 `000005→000006`, UC-125 `000006→000007`. | Toàn bộ mục tham chiếu timestamp |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2. Code UC-125 SAU KHI UC-122+UC-123 xong.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `PersonControlListEntity` đã `TypeOrmModule.forFeature` sẵn trong `AlertsModule` — KHÔNG cần forFeature lại.
- `NotificationsService.createNotification()` chữ ký tham chiếu y hệt cách `VehicleControlAlertService` gọi (§0.3 spec) — copy đúng shape.
- `NotificationType` enum vị trí sửa: `src/modules/notifications/entities/notification.entity.ts`, thêm dòng `PERSON_WATCHLIST_MATCH = 'person_watchlist_match'` (mirror dòng `VEHICLE_CONTROL_LIST_MATCH` đã có).
- Migration mới nhất sau UC-124 (0 migration) vẫn `20260723000006`. UC-125 dùng `20260723000007`.
- `RequirePermissions`/`isUniqueViolation` — dùng lại pattern y hệt UC-122 (KHÔNG refactor shared util).

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §1 (câu 3: chỉ userId) + §2 (7 quyết định: priority=severity trực tiếp, role mirror vehicle_control, NotThrow, throttle in-memory, zoneId null, dedup 2 nhánh độc lập, displayName-only không dedup). Constitution đầy đủ ở spec §5. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
`PersonControlListEntity` giữ nguyên 100%. **1 file khác được sửa**: `notification.entity.ts` (thêm 1 dòng enum, KHÔNG đổi bảng `notifications`).

## 3. DTO mới (module alerts)

Đường dẫn:
- src/modules/alerts/dto/create-person-control-list.dto.ts
- src/modules/alerts/dto/update-person-control-list.dto.ts (PartialType)
- src/modules/alerts/dto/query-person-control-list.dto.ts (page/limit/sortBy/sortOrder + filter listType/active/userId/faceProfileId)

`CreatePersonControlListDto`: `userId` (IsUUID, IsOptional), `faceProfileId` (IsUUID, IsOptional), `displayName` (IsString, IsNotEmpty, MaxLength 255), `photoMediaFileId` (IsUUID, IsOptional), `listType` (IsIn(['watchlist','blocklist']), IsOptional, default 'watchlist'), `reason` (IsString, IsOptional, MaxLength 255), `priority` (IsIn(['low','medium','high','critical']), IsOptional, default 'medium'), `active` (IsBoolean, IsOptional, default true).

## 4. Service — `PersonControlListService` (file mới: src/modules/alerts/services/person-control-list.service.ts)

- `create(dto, actorUserId)`:
  1. Nếu `dto.userId` có giá trị → pre-check `(userId, listType)` sống → 409 nếu trùng.
  2. Nếu `dto.faceProfileId` có giá trị → pre-check `(faceProfileId, listType)` sống → 409 nếu trùng (ĐỘC LẬP bước 1, KHÔNG else-if).
  3. `save()` trong try/catch bắt `23505` → 409.
- `list(query)`, `findOne(id)`, `update(id, dto)` (re-check dedup nếu đổi userId/faceProfileId — 2 nhánh độc lập như create), `remove(id)` (softDelete) — mirror `AlertRulesService`/`VehicleControlListService`.
- `private isUniqueViolation(e: unknown): boolean` — copy y hệt.

## 5. Service — `PersonWatchlistCheckService` (file mới: src/modules/alerts/services/person-watchlist-check.service.ts)

- Constructor: `@InjectRepository(PersonControlListEntity)`, `private readonly alertRulesService: AlertRulesService`, `private readonly alertsService: AlertsService`, `private readonly notificationsService: NotificationsService`, `private readonly dataSource: DataSource`.
- `private readonly lastAlertAt = new Map<string, number>();` (throttle in-memory, mirror `VehicleControlAlertService`).
- `async checkPersonWatchlist(userId: string): Promise<void>`:
```ts
try {
  const match = await this.repo.findOne({ where: { userId, active: true, deletedAt: IsNull() } });
  if (!match) return;

  const now = Date.now();
  const last = this.lastAlertAt.get(userId);
  if (last !== undefined && now - last < THROTTLE_MS) return;
  this.lastAlertAt.set(userId, now);

  const { suppressed, rule } = await this.alertRulesService.findEffectiveRule('person_watchlist_match', null);
  if (suppressed) return;

  await this.alertsService.recordAlert({
    alertType: 'person_watchlist_match',
    zoneId: null,
    severity: match.priority as Severity,
    ruleId: rule?.id ?? null,
    payloadJson: { personControlListEntryId: match.id, displayName: match.displayName, listType: match.listType, reason: match.reason, userId },
  });

  const recipients = await this.resolveRecipients(); // copy y hệt VehicleControlAlertService.resolveRecipients()
  if (recipients.length === 0) { this.logger.warn(...); return; }
  await this.notificationsService.createNotification({
    notificationType: NotificationType.PERSON_WATCHLIST_MATCH,
    channel: NotificationChannel.IN_APP,
    subject: 'Cảnh báo: người trong danh sách theo dõi',
    content: `${match.displayName} (${match.listType}) vừa được nhận diện.${match.reason ? ` Lý do: ${match.reason}.` : ''}`,
    priority: match.priority === 'critical' || match.priority === 'high' ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
    recipientScope: 'user_list',
    recipientUserIds: recipients,
    payloadJson: { userId, displayName: match.displayName, listType: match.listType, priority: match.priority },
  });
} catch (e) {
  this.logger.error(`checkPersonWatchlist failed (userId=${userId}): ${e instanceof Error ? e.message : 'unknown'}`);
  // NotThrow — spec R7.
}
```
- `private async resolveRecipients(): Promise<string[]>` — copy y hệt `VehicleControlAlertService.resolveRecipients()` (role `MANAGER,BUSINESS_ADMIN,SYSTEM_ADMIN`).

## 6. Controller — `PersonControlListController` (file mới: src/modules/alerts/controllers/person-control-list.controller.ts)

- 5 route mirror `VehicleControlListController`: `POST/GET /api/v1/person-control-list`, `GET/PATCH/DELETE /api/v1/person-control-list/:id` — `@RequirePermissions('person_control_list.<action>')`.

## 7. Sửa `NotificationType` enum (modified)
```
src/modules/notifications/entities/notification.entity.ts
```
- Thêm `PERSON_WATCHLIST_MATCH = 'person_watchlist_match',` vào enum `NotificationType` (mirror dòng `VEHICLE_CONTROL_LIST_MATCH`).

## 8. Migration seed permission (mới, cùng commit)
```
src/database/migrations/20260723000007-SeedPersonControlListPermissions.ts
```
- Mirror y hệt `20260722000001-SeedVehicleControlListPermissions.ts`: `module_code='alerts'`, 4 entry `person_control_list.create/read/update/delete`, role mapping spec §2.2.

## 9. Wiring `AlertsModule` (modified)
```
src/modules/alerts/alerts.module.ts
```
- Thêm `providers: [PersonControlListService, PersonWatchlistCheckService]`, `controllers: [PersonControlListController]`, `exports: [..., PersonWatchlistCheckService]`.

## 10. File list
### Net-new (7 file)
- src/modules/alerts/dto/create-person-control-list.dto.ts
- src/modules/alerts/dto/update-person-control-list.dto.ts
- src/modules/alerts/dto/query-person-control-list.dto.ts
- src/modules/alerts/services/person-control-list.service.ts (+ .spec.ts)
- src/modules/alerts/services/person-watchlist-check.service.ts (+ .spec.ts)
- src/modules/alerts/controllers/person-control-list.controller.ts (+ .spec.ts)
- src/database/migrations/20260723000007-SeedPersonControlListPermissions.ts

### Modified (2 file)
- src/modules/alerts/alerts.module.ts
- src/modules/notifications/entities/notification.entity.ts (1 dòng enum)

> Tổng **7 net-new + 2 modified**. 0 thay đổi entity/DDL bảng nghiệp vụ (chỉ 1 migration seed permission + 1 dòng enum notification).

## 11. Test (mock repo — KHÔNG DB)

- `PersonControlListService`: dedup 2 nhánh độc lập (userId trùng nhưng faceProfileId khác nhau vẫn 409 vì userId trùng; ngược lại tương tự); displayName-only tạo tự do; 23505 safety-net.
- `PersonWatchlistCheckService.checkPersonWatchlist`: no match → no-op (assert KHÔNG gọi recordAlert/notification); match + trong throttle window → skip; match + suppressed → skip cả 2; match hợp lệ → `recordAlert` với `severity` ĐÚNG bằng `match.priority`; lỗi bất kỳ bước → NotThrow (assert không throw ra ngoài).
- Coverage **≥80%** file mới.

## 12. Gate (STOP, KHÔNG commit)
- build=0; eslint 0 warning mới; `npx jest src/modules/alerts src/modules/notifications` xanh (KHÔNG hồi quy test enum cũ); coverage ≥80%; DI-proof `AppModule`. KHÔNG live, KHÔNG DB thật.
- **Owed**: đối chiếu theo `faceProfileId` · `zoneId` null cố định · wiring face-access (thuộc Hải).

## 13. Kỷ luật
- **SAFETY-01**: `checkPersonWatchlist` NotThrow toàn bộ.
- **ARCH-02**: `AlertsModule` KHÔNG import `FaceAccessModule`.
- KHÔNG wiring face-access ở đây.

> **STOP.** Plan-only. Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md (SAU khi UC-122+UC-123 xong). KHÔNG tự code.
