# VCC-001 — tasks.md (UC9 ANPR/SAVP: đối chiếu control-list + cảnh báo)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-22 | Tạo tasks VCC-001: T0 verify → T1 checkControlList → T1b test → T2 VehicleControlAlertService → T2b test → T3 wiring VehicleResolveService (BREAKING — cập nhật spec cũ) → T3b test → T4 enum notification → T5 wiring module → T-GATE. Viết cùng lượt với spec/plan. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. T3 là điểm rủi ro hồi quy cao nhất (đổi constructor `VehicleResolveService`) — PHẢI làm T3b trước khi coi T3 xong.

## Thứ tự
T0 → T1 → T1b → T2 → T2b → T3 → T3b → T4 → T5 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `VehicleControlListService` có `repo` field private đúng tên; `VehicleResolveService` constructor hiện chỉ 1 tham số (`dataSource`) và test hiện tại (`vehicle-resolve.service.spec.ts`) khởi tạo trực tiếp `new VehicleResolveService(dsMock)` — 12 test sẽ vỡ nếu không cập nhật cùng lúc; `NotificationsModule` export `NotificationsService`, không import ngược `AnprModule`; `ConfigModule` là global; `NotificationType` enum hiện có field nào (để chèn field mới đúng chỗ, không đụng field cũ).
- **AC**: dán xác nhận đủ 5 mục; thiếu/path sai → **DỪNG báo Thiếu Chủ**.

## T1 — `checkControlList` (code) — plan §2
- Thêm method vào `VehicleControlListService`: `checkControlList(plateNumber): Promise<VehicleControlListEntity | null>` — `repo.findOne({where:{plateNumber, deletedAt:IsNull(), active:true}, order:{listType:'ASC'}})`. Comment giải thích ưu tiên blocklist khi cả 2 active.
- KHÔNG normalize lại plate trong hàm (comment DATA-01).
- **AC**: method mới, KHÔNG đụng `create/list/getDetail/update/softDelete` hiện có (UC8).

## T1b — Test `checkControlList` (mock repo) — plan §8
- không match → null.
- match → trả entity, assert `where` đúng (`plateNumber`, `deletedAt` IsNull, `active:true`) và `order:{listType:'ASC'}`.
- **AC**: assert rõ where/order options truyền đúng vào `repo.findOne`.

## T2 — `VehicleControlAlertService` (code, file mới) — plan §3
- Constructor: `VehicleControlListService`, `NotificationsService`, `ConfigService`, `DataSource`.
- `evaluate(plateNumber, context)`: check match → throttle (Map in-memory, default 300s qua `ConfigService`) → resolve recipients (role `MANAGER/BUSINESS_ADMIN/SYSTEM_ADMIN`) → build subject/content/priority theo `listType` → `notificationsService.createNotification(...)`. Toàn bộ bọc try/catch NotThrow.
- **AC**: `evaluate` không bao giờ throw (kể cả khi mock các dependency throw); throttle KHÔNG update mốc khi bị chặn.

## T2b — Test `VehicleControlAlertService` (mock 4 dependency) — plan §8
- không match → không `createNotification`.
- blocklist match → `createNotification` 1 lần, `priority:'high'`, đúng `notificationType`.
- watchlist match → `priority:'normal'`, subject/content khác.
- throttle: 2 lần liên tiếp cùng plate trong window → chỉ 1 `createNotification`; plate khác → không throttle chéo; qua khỏi window (fake timer/mock Date) → gọi lại được.
- recipient rỗng → không `createNotification`, không throw.
- NotThrow: mock `checkControlList`/`createNotification` reject → `evaluate` vẫn resolve (KHÔNG throw).
- **AC**: toàn bộ nhánh xanh, đặc biệt throttle + NotThrow.

## T3 — Wiring `VehicleResolveService` (code, BREAKING) — plan §4
- Thêm tham số constructor `vehicleControlAlertService: VehicleControlAlertService`.
- Trong `onVehicleEvent`, sau khi tính `direction`, TRƯỚC INSERT: `await this.vehicleControlAlertService.evaluate(evt.plateNumber, {channelId: evt.channelId, direction})`.
- **AC**: gọi đúng vị trí (trước INSERT), gọi cho CẢ matched lẫn unmatched (không có `if` bọc quanh).

## T3b — Cập nhật test `VehicleResolveService` (BẮT BUỘC, quyết định gate) — plan §8
- Cập nhật `beforeEach`: thêm `alertMock = {evaluate: jest.fn().mockResolvedValue(undefined)}`, đổi `service = new VehicleResolveService(dsMock as DataSource, alertMock)`.
- Chạy lại **toàn bộ 12 test cũ** — PHẢI xanh 100% (không đổi assertion cũ, chỉ đổi setup).
- Thêm test mới: `evaluate` gọi đúng `(plateNumber, {channelId, direction})` cho matched VÀ unmatched; `alertMock.evaluate` reject → `onVehicleEvent` vẫn không throw.
- **AC**: 12 test cũ xanh + ≥2 test mới xanh. Nếu bất kỳ test cũ nào đỏ → DỪNG, sửa lại T3/T3b trước khi đi tiếp (KHÔNG được sửa test cũ để "cho qua" — chỉ được thêm mock, không đổi assertion nghiệp vụ).

## T4 — Enum `NotificationType` (code) — plan §5
- Thêm `VEHICLE_CONTROL_LIST_MATCH = 'vehicle_control_list_match'` vào `notification.entity.ts`, đặt cạnh `UNKNOWN_FACE_ALERT`, comment ngắn "UC9 ANPR control-list alert".
- **AC**: KHÔNG đổi/xóa giá trị enum cũ nào; build vẫn pass (không có nơi nào dùng exhaustive switch trên enum này mà thiếu case mới — kiểm tra nhanh bằng `tsc`).

## T5 — Wiring `anpr.module.ts` (code) — plan §6
- `imports`: thêm `NotificationsModule`.
- `providers`: thêm `VehicleControlAlertService`.
- **AC**: `VehicleResolveService` (đã có sẵn trong providers) resolve được `VehicleControlAlertService` qua DI; `tsc` build pass.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint file mới/sửa 0 warning mới; `npx jest src/modules/anpr src/modules/notifications` xanh toàn bộ (đặc biệt 12 test `vehicle-resolve.service.spec.ts` cũ KHÔNG hồi quy); coverage ≥80% file/method mới; review diff `anpr.module.ts` xác nhận không circular (NotificationsModule không import ngược AnprModule).
- In: code đầy đủ 2 net-new + 6 modified + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: Bước 3 trỏ sang `security_alerts` · bug `role_code='admin'` StrangerAlertService (ngoài scope) · Swagger UI thật · email channel cảnh báo.
- **AC**: bảng gate đầy đủ + báo cáo: điểm nối đúng `VehicleResolveService` (KHÔNG phải default handler) ✓ · checkControlList ưu tiên blocklist khi cả 2 active ✓ · watchlist cũng cảnh báo priority khác ✓ · throttle theo plate hoạt động đúng ✓ · NotThrow toàn chuỗi ✓ · 12 test UC5 cũ không hồi quy ✓ · coverage ✓. STOP.

## Map task → scope UC9
- T0 → verify RECON đủ để code (đặc biệt rủi ro breaking-constructor)
- T1/T1b → `checkControlList` (pure lookup, ưu tiên blocklist)
- T2/T2b → `VehicleControlAlertService` (throttle + recipient + notification, NotThrow)
- T3/T3b → wiring `VehicleResolveService` (điểm nối thật) — regression-critical
- T4 → enum `NotificationType` mới
- T5 → wiring module (`NotificationsModule` import + provider)
- T-GATE → gate + STOP + Owed (Bước 3 · bug ngoài scope · Swagger · email)
