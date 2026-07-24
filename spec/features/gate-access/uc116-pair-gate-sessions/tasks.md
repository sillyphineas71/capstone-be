# GAP-001 — tasks.md (UC-116 Gate Access / SAVP: ghép cặp gate_access_logs)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks GAP-001: T0 verify → T1 module → T2 service (pairPendingLogs/findInCandidate/pairTwo/loadClosingHour) → T2b test → T3 migration config → T4 wiring SchedulerService → T-GATE. Viết cùng lượt với spec/plan do OQ đã chốt trước. | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. KHÔNG có route HTTP ở UC-116 (system/cron-only).

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T4 → T-GATE.

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
- Xác nhận đọc CODE THẬT: `GateAccessLogEntity` field đầy đủ (`zoneId/deviceId/eventId/userId/vehicleRegistrationId/plateNumber/direction/accessTime/pairedLogId/durationSeconds/metadataJson/createdAt`), entity CHƯA `forFeature` ở module nào ngoài `zones`; `SystemConfigEntity` field (`configKey/configValue/valueType/configGroup/isActive`); `system_configs.config_key` CÓ hay KHÔNG unique constraint (quyết định `ON CONFLICT` hay `WHERE NOT EXISTS` cho migration T3); `SchedulerService`/`SchedulerModule` cấu trúc hiện tại (constructor params, imports); migration mới nhất `20260722000008` (không trùng `20260723000001`).
- **AC**: dán xác nhận đủ 5 mục; thiếu/path sai/không rõ unique constraint → **DỪNG báo Thiếu Chủ**, không bịa.

## T1 — Module `gate-access` (code) — plan §3
- `src/modules/gate-access/gate-access.module.ts`: `TypeOrmModule.forFeature([GateAccessLogEntity])` (import từ `zones/entities`), `providers: [GateAccessPairingService]`, `exports: [GateAccessPairingService]`.
- **AC**: module compile độc lập, KHÔNG import `AuthModule`/`IotModule` (không cần — UC-116 không có guard/route).

## T2 — Service `GateAccessPairingService` (code) — plan §4
- `pairPendingLogs()`: quét `direction='out' AND pairedLogId IS NULL`, với mỗi log gọi `findInCandidate` → có → `pairTwo` (transaction 2 UPDATE) → đếm `paired`; không có → đếm `unmatched`. Trả `{scanned, paired, unmatched}`.
- `findInCandidate(out)`: `userId` có giá trị → query `in` cùng `userId` trong cửa sổ 24h trước, `ORDER BY accessTime DESC LIMIT 1`; `userId` NULL → fallback `plateNumber` (guard: `plateNumber` cũng NULL → return `null` ngay, KHÔNG query).
- `pairTwo(inLog, outLog)`: tính `durationSeconds`, `dataSource.transaction` UPDATE cả 2 dòng (`pairedLogId` chéo + `durationSeconds` giống nhau).
- `loadClosingHour()`: đọc `system_configs` group `gate_access`, key `gate_access.closing_hour_local`, default `'22:00'`, validate format `HH:mm` (regex), sai → fallback + log warning.
- **AC**: 4 method (1 public `pairPendingLogs` + 3 private); KHÔNG có method INSERT `gate_access_logs`; `pairTwo` LUÔN trong transaction.

## T2b — Service test (mock repo + mock DataSource) — plan §8
- `pairPendingLogs`: ghép thành công cập nhật đúng cả 2 dòng; không ứng viên → `unmatched++`, KHÔNG gọi update.
- `findInCandidate`: đúng nhánh `userId`/`plateNumber`/cả hai NULL (return null, KHÔNG query DB — assert `repo.findOne` KHÔNG bị gọi).
- Nhiều ứng viên → chọn đúng gần nhất (FIFO).
- `loadClosingHour`: có dòng hợp lệ / thiếu dòng / sai format — 3 case đủ.
- **AC**: toàn bộ nhánh xanh; assert rõ transaction có đúng 2 lệnh UPDATE khi ghép thành công.

## T3 — Migration seed `system_configs` (code) — plan §5
- `src/database/migrations/20260723000001-SeedGateAccessClosingHourConfig.ts`: insert 1 dòng `gate_access.closing_hour_local='22:00'` idempotent (cách chính xác theo unique constraint xác nhận ở T0). `down()` xóa đúng dòng này.
- **AC**: `up()` chạy 2 lần không lỗi/không trùng dòng; `down()` chỉ xóa đúng key này, KHÔNG đụng config khác.

## T4 — Wiring `SchedulerService` (code) — plan §6
- Thêm field `gateAccessPairingEnabled` (đọc `SCHEDULER_GATE_ACCESS_PAIRING_ENABLED`, default `false`), constructor param `GateAccessPairingService`, method `pairGateAccessLogs` (`@Cron(EVERY_5_MINUTES)`, gate 2 flag, try/catch log).
- `scheduler.module.ts`: thêm `GateAccessModule` vào `imports` nếu cần.
- **AC**: `AppModule` compile được (DI-proof), job cron cũ KHÔNG hồi quy (test cũ của `SchedulerService` vẫn xanh), job mới early-return khi flag tắt.

## T-GATE — (STOP, KHÔNG commit) — plan §9
- build=0; eslint file mới/touched 0 warning mới; `npx jest src/modules/gate-access src/modules/scheduler` xanh; coverage **≥80%** file mới; DI-proof compile `AppModule`. **KHÔNG live, KHÔNG DB thật, KHÔNG commit.**
- In: code đầy đủ 3 file mới + 2 file modified + jest + coverage + báo cáo gate.
- **Owed (ghi, KHÔNG chạy)**: index `plate_number WHERE paired_log_id IS NULL` · điểm gọi trực tiếp từ Hải · batch/phân trang · API sửa giờ đóng cửa riêng.
- **AC**: bảng gate đầy đủ + báo cáo: ghép ưu tiên user_id/fallback plate_number ✓ · ghép đối xứng 2 dòng trong 1 transaction ✓ · KHÔNG INSERT log mới ✓ · giờ đóng cửa đọc từ system_configs (KHÔNG hard-code) ✓ · cron gate đúng 2 flag ✓ · lỗi cron bị nuốt + log, KHÔNG crash tiến trình ✓ · coverage ✓ · DI-proof ✓. STOP.

## Map task → scope UC-116
- T0 → verify RECON đủ để code
- T1 → module `gate-access`
- T2/T2b → service ghép cặp (pairPendingLogs/findInCandidate/pairTwo/loadClosingHour)
- T3 → migration seed config giờ đóng cửa
- T4 → wiring cron `SchedulerService`
- T-GATE → gate + STOP + Owed
