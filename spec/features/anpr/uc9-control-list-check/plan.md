# VCC-001 — plan.md (UC9 ANPR/SAVP: đối chiếu control-list + cảnh báo)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo plan VCC-001 cùng lượt với spec. 1 method mới (`checkControlList`), 1 service mới (`VehicleControlAlertService`), wiring `VehicleResolveService` + `anpr.module.ts` + `NotificationEntity` enum. Không migration, không endpoint mới. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)
- `VehicleControlListService` hiện có `repo: Repository<VehicleControlListEntity>` sẵn (UC8) — `checkControlList` chỉ thêm method, KHÔNG đổi constructor.
- `VehicleResolveService` constructor hiện: `constructor(private readonly dataSource: DataSource)`. Thêm tham số thứ 2 `vehicleControlAlertService: VehicleControlAlertService` sẽ **breaking cho test hiện có** (`vehicle-resolve.service.spec.ts` khởi tạo trực tiếp `new VehicleResolveService(dsMock as DataSource)` — 12 test) → **PHẢI cập nhật spec file này** thêm mock thứ 2, nếu không toàn bộ 12 test cũ sẽ throw `Cannot read properties of undefined (reading 'evaluate')` ngay tại lời gọi (đồng bộ, TRƯỚC `await`) → nhảy vào catch → INSERT KHÔNG chạy → tất cả assertion cũ về `insert()` sẽ fail. Đây là điểm rủi ro hồi quy lớn nhất của UC9, ghi rõ để T2 không bỏ sót.
- `NotificationsModule` export `NotificationsService`, KHÔNG import `AnprModule` ngược lại ([notifications.module.ts:39-62](../../../../src/modules/notifications/notifications.module.ts)) → import an toàn vào `AnprModule`.
- `ConfigModule.forRoot({isGlobal:true})` ở `app.module.ts:70-71` → `ConfigService` dùng được ngay trong `VehicleControlAlertService` KHÔNG cần import gì thêm ở `anpr.module.ts`.
- `DataSource` đã dùng được trong module `anpr` (VehicleResolveService đã inject trực tiếp, không cần import module riêng) — `TypeOrmModule` export `DataSource` toàn cục qua root `TypeOrmModule.forRoot()`.
- Role mapping cảnh báo dùng ĐÚNG bộ role đã seed quyền `vehicle_control.read` ở UC8 migration `20260722000001` (`MANAGER`, `BUSINESS_ADMIN`, `SYSTEM_ADMIN`) — nhất quán "ai xem được control-list thì cũng là người nhận cảnh báo".

## 1. Quyết định đã chốt (từ trao đổi trước khi viết spec)
Xem spec §1 (Swagger không setup, điểm nối = `VehicleResolveService`, watchlist cũng cảnh báo priority khác, throttle theo plate 300s). Constitution đầy đủ ở spec §8.

## 2. `checkControlList` — thêm vào `VehicleControlListService` (KHÔNG file mới)
```ts
async checkControlList(plateNumber: string): Promise<VehicleControlListEntity | null> {
  // DATA-01: KHÔNG normalize lại — caller (VehicleResolveService) đã normalize (mirror DATA-03 UC5).
  return this.repo.findOne({
    where: { plateNumber, deletedAt: IsNull(), active: true },
    // DATA-02: 'blocklist' < 'watchlist' theo alphabet → ưu tiên blocklist khi cả 2 active cùng match.
    order: { listType: 'ASC' },
  });
}
```

## 3. `VehicleControlAlertService` (file mới)
```
src/modules/anpr/services/vehicle-control-alert.service.ts
```
```ts
@Injectable()
export class VehicleControlAlertService {
  private readonly logger = new Logger(VehicleControlAlertService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    private readonly vehicleControlListService: VehicleControlListService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async evaluate(plateNumber: string, context: { channelId: number; direction: string }): Promise<void> {
    try {
      const match = await this.vehicleControlListService.checkControlList(plateNumber);
      if (!match) return;

      const throttleMs = this.configService.get<number>(
        'VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS',
        VehicleControlAlertService.DEFAULT_THROTTLE_SECONDS,
      ) * 1000;
      const now = Date.now();
      const last = this.lastAlertAt.get(plateNumber);
      if (last !== undefined && now - last < throttleMs) return;
      this.lastAlertAt.set(plateNumber, now);

      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(`control-list match (plate=${plateNumber}) — không resolve được recipient, skip.`);
        return;
      }

      const isBlocklist = match.listType === 'blocklist';
      const subject = isBlocklist ? 'Cảnh báo: xe trong danh sách chặn' : 'Cảnh báo: xe cần theo dõi';
      const content = `Biển số ${match.plateNumber} (${match.listType}) vừa qua cổng (channel ${context.channelId}, direction ${context.direction}).` +
        (match.reason ? ` Lý do: ${match.reason}.` : '');

      await this.notificationsService.createNotification({
        notificationType: NotificationType.VEHICLE_CONTROL_LIST_MATCH,
        channel: NotificationChannel.IN_APP,
        subject,
        content,
        priority: isBlocklist ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: {
          plateNumber: match.plateNumber,
          listType: match.listType,
          reason: match.reason,
          channelId: context.channelId,
          direction: context.direction,
          controlListEntryId: match.id,
        },
      });
    } catch (e) {
      this.logger.error(
        `Control list alert failed (plate=${plateNumber}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  private async resolveRecipients(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code IN ('MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN') AND u.deleted_at IS NULL`,
    );
    return rows.map((r) => r.id);
  }
}
```
- Throttle KHÔNG update `lastAlertAt` khi bị chặn bởi throttle (giữ nguyên mốc gốc — mirror `StrangerAlertService`, tránh window "trôi" liên tục nếu spam liên tục).
- `resolveRecipients` KHÔNG lọc theo email (mirror UC9 quyết định: chỉ IN_APP, không cần email list).

## 4. Wiring `VehicleResolveService` (modified, KHÔNG file mới)
```ts
constructor(
  private readonly dataSource: DataSource,
  private readonly vehicleControlAlertService: VehicleControlAlertService,
) {}
```
Trong `onVehicleEvent`, sau dòng tính `direction`, TRƯỚC block INSERT `iot_device_events`:
```ts
// UC9: đối chiếu control-list — độc lập matchState, tự NotThrow.
await this.vehicleControlAlertService.evaluate(evt.plateNumber, {
  channelId: evt.channelId,
  direction,
});
```

## 5. Notification type mới (modified `notification.entity.ts`)
Thêm 1 dòng vào `enum NotificationType`:
```ts
VEHICLE_CONTROL_LIST_MATCH = 'vehicle_control_list_match',
```
Đặt cạnh `UNKNOWN_FACE_ALERT` (cùng nhóm "security alert từ camera/ANPR"), có comment ngắn ghi UC9.

## 6. Wiring `anpr.module.ts` (modified)
- `imports`: thêm `NotificationsModule`.
- `providers`: thêm `VehicleControlAlertService`.
- `VehicleResolveService` đã là provider sẵn — Nest tự inject `VehicleControlAlertService` mới vào constructor (cùng module, KHÔNG cần khai báo lại `exports` gì thêm vì không export ra ngoài `anpr`).

## 7. File list
### Net-new (2 file)
- `src/modules/anpr/services/vehicle-control-alert.service.ts`
- `src/modules/anpr/services/vehicle-control-alert.service.spec.ts`
### Modified (5 file)
- `src/modules/anpr/services/vehicle-control-list.service.ts` (+ `checkControlList`)
- `src/modules/anpr/services/vehicle-control-list.service.spec.ts` (+ test `checkControlList`)
- `src/modules/anpr/services/vehicle-resolve.service.ts` (+ constructor param + gọi `evaluate`)
- `src/modules/anpr/services/vehicle-resolve.service.spec.ts` (+ mock `vehicleControlAlertService`, + test gọi đúng tham số — **BẮT BUỘC** để 12 test cũ không vỡ, xem RECON §0)
- `src/modules/anpr/anpr.module.ts` (+ import `NotificationsModule`, + provider `VehicleControlAlertService`)
- `src/modules/notifications/entities/notification.entity.ts` (+ enum value)
> Tổng **2 net-new + 6 modified** (đếm cả 5 kể trên + entity). 0 migration, 0 endpoint mới, 0 DTO mới.

## 8. Test (mock repo/DataSource — KHÔNG DB)
### `VehicleControlListService.checkControlList`
- không match (findOne null) → trả `null`.
- match blocklist active → trả entity.
- match nhưng `active=false` → `findOne` (where có `active:true`) → không trả (giả lập bằng mock trả null khi where có active:true không khớp dữ liệu giả lập inactive).
- where luôn có `deletedAt: IsNull()`, `active: true`; `order: {listType:'ASC'}` — assert đúng option truyền vào `repo.findOne`.

### `VehicleControlAlertService.evaluate`
- không match → KHÔNG gọi `createNotification`.
- match blocklist → `createNotification` gọi 1 lần, `priority: HIGH`, `notificationType: 'vehicle_control_list_match'`, `recipientUserIds` đúng danh sách mock.
- match watchlist → `priority: NORMAL`, subject/content khác blocklist.
- throttle: gọi `evaluate` 2 lần liên tiếp cùng plate (trong window) → `createNotification` chỉ 1 lần; plate khác → không bị throttle chéo.
- throttle window hết hạn (mock `Date.now`/jest fake timer nhảy qua) → gọi lại → `createNotification` lần 2.
- recipient rỗng (`resolveRecipients` trả `[]`) → KHÔNG gọi `createNotification`, KHÔNG throw.
- NotThrow: `checkControlList` throw / `createNotification` throw → `evaluate` KHÔNG throw (resolve về `undefined`), chỉ log.
- payload KHÔNG chứa field cấm/nhạy cảm (mirror SEC-02) — không có `imageBase64` trong context truyền vào nên tự động đúng, vẫn assert `payloadJson` chỉ có field khai báo.

### `VehicleResolveService` (cập nhật, giữ 12 test cũ xanh + thêm mới)
- Cập nhật `beforeEach`: `alertMock = { evaluate: jest.fn().mockResolvedValue(undefined) }`; `service = new VehicleResolveService(dsMock as DataSource, alertMock)`.
- Test mới: `evaluate` được gọi với `(plateNumber, {channelId, direction})` đúng cho CẢ matched lẫn unmatched.
- Test mới: `alertMock.evaluate` throw (reject) → `onVehicleEvent` vẫn KHÔNG throw (NotThrow kép — dù `evaluate` tự NotThrow, test này chứng minh outer try/catch cũng chịu được nếu có sai sót tương lai).
- **Bắt buộc chạy lại 12 test cũ, xác nhận xanh 100%** (regression gate).

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint file mới/sửa 0 warning mới; `npx jest src/modules/anpr src/modules/notifications` xanh toàn bộ (UC1-UC8 KHÔNG hồi quy, đặc biệt 12 test `vehicle-resolve.service.spec.ts` cũ + test mới UC9); coverage ≥80% file mới/method mới; DI-proof: review `anpr.module.ts` diff (thêm `NotificationsModule` import — đã xác nhận không circular ở RECON) + full `tsc` build.
- **Owed (ghi, KHÔNG chạy)**: Bước 3 trỏ `VehicleControlAlertService` sang `security_alerts` · sửa bug `role_code='admin'` ở `StrangerAlertService` (ngoài scope) · Swagger UI thật · email channel cho cảnh báo control-list.

## 10. Kỷ luật
- **KHÔNG migration** (không đổi DB schema, chỉ thêm enum TypeScript-side).
- **KHÔNG endpoint HTTP mới** — đây là internal wiring giữa các service.
- **ARCH-01**: `checkControlList` (pure) tách biệt `VehicleControlAlertService` (alert sink, sẽ đổi ở Bước 3) — KHÔNG gộp 2 trách nhiệm vào 1 hàm.
- **Regression-critical**: PHẢI cập nhật `vehicle-resolve.service.spec.ts` cùng lúc với đổi constructor `VehicleResolveService`, nếu không 12 test cũ vỡ ngay.
- KHÔNG tự sửa bug `role_code='admin'` ở `StrangerAlertService` (ngoài scope UC9).
- KHÔNG tự thiết kế `security_alerts`/alert rules (CLAUDE.md §5.5 quy tắc 7).

> **STOP.** Plan-only (viết cùng lượt với spec). Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
