# GAP-001 — plan.md (UC-116 Gate Access / SAVP: ghép cặp gate_access_logs)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | **[VERIFY]** Verify thật trên RDS chung: seed 20 log lệch cặp (migration `20260723000004-SeedGateAccessDemoLogsForVerify.ts`), chạy `pairPendingLogs()` thật qua script tsx (KHÔNG mock) — kết quả khớp 100% thiết kế (5 cặp user_id + 2 cặp fallback plate_number ghép đúng, 2 log EX1 + 1 log EX2 đúng vẫn "Chưa hoàn tất"/không ghép, case FIFO BR1 ghép đúng ứng viên gần nhất, bỏ lại ứng viên xa hơn). Phát hiện + sửa 1 bug thật: migration `20260723000001` dùng `ON CONFLICT (config_key)` nhưng bảng `system_configs` THẬT trên RDS không có unique constraint trên cột này (khác `database_v3_2_compact_39_tables.sql` — chỉ là tài liệu thiết kế) → đổi sang `WHERE NOT EXISTS`. | §6 migration, §0 RECON |
| 2026-07-23 | Tạo plan GAP-001 cùng lượt với spec (OQ đã chốt trước). Module `gate-access` mới hoàn toàn. 2 migration (schema-config seed + không có DDL bảng nghiệp vụ mới). Wiring cron vào `SchedulerService` có sẵn. | Toàn bộ |

> Spec: [spec.md](./spec.md). Plan KHÔNG mở lại quyết định đã chốt ở spec §1/§2.
>
> ⚠️ **Bài học từ verify thật (2026-07-23)**: file thiết kế `.sql`/`.md` (vd `database_v3_2_compact_39_tables.sql`) có thể LỆCH với schema THẬT đang chạy trên RDS (đã gặp: cột `system_configs.config_key` không có unique constraint như tài liệu ghi). Trước khi dùng `ON CONFLICT` trong migration mới, PHẢI tự query `pg_constraint`/`pg_indexes` xác nhận trên DB thật, KHÔNG tin tài liệu thiết kế 100%.

## 0. RECON bổ sung (đọc CODE THẬT, xác nhận đủ để code)

- `GateAccessLogEntity` **chưa** được `TypeOrmModule.forFeature` ở bất kỳ module nào ngoài `zones.module.ts` — module `gate-access` mới PHẢI tự `forFeature([GateAccessLogEntity])`, import class từ `../zones/entities/gate-access-log.entity.js` (cross-module entity import, mirror cách `gate-access-log.entity.ts` tự import `UserEntity`/`IoTDeviceEntity` từ module khác).
- `SystemConfigEntity` nằm ở `src/modules/administration/entities/system-config.entity.ts`, chưa export sẵn qua `AdministrationModule` cho module ngoài dùng trực tiếp `@InjectRepository` — cách an toàn nhất (mirror `checkin-alert.service.ts`) là inject `DataSource` rồi `dataSource.getRepository(SystemConfigEntity)`, KHÔNG cần import `AdministrationModule`.
- `SchedulerService` ở `src/modules/scheduler/scheduler.service.ts`, đăng ký trong `SchedulerModule` (cần xác nhận `scheduler.module.ts` import những service nào — sẽ thêm `GateAccessPairingService` vào constructor + `imports` module `gate-access` nếu `SchedulerModule` cần).
- Migration mới nhất trong repo: `20260722000008`. UC-116 dùng timestamp **`20260723000001`** (seed `system_configs`).
- 4 role lõi xác nhận tồn tại: `SYSTEM_ADMIN`, `BUSINESS_ADMIN`, `MANAGER`, `EMPLOYEE` — KHÔNG cần cho UC-116 (không có endpoint HTTP, không seed permission).
- `@nestjs/schedule` đã cấu hình sẵn (cron khác đang chạy) — KHÔNG cần thêm `ScheduleModule.forRoot()`.

## 1. Quyết định đã chốt (từ spec §1/§2)
Xem spec §1 (ghép theo user_id/fallback plate_number, giờ đóng cửa qua system_configs) + §2 (không tạo synthetic log, ghép đối xứng 2 chiều, chỉ cron, quét toàn bộ không lọc zone_type). Constitution đầy đủ ở spec §6. Plan này KHÔNG mở lại.

## 2. Entity — KHÔNG đổi
`GateAccessLogEntity` và `SystemConfigEntity` giữ nguyên 100%. KHÔNG thêm cột, KHÔNG migration schema DDL bảng nghiệp vụ.

## 3. Module mới — `gate-access`
```
src/modules/gate-access/gate-access.module.ts
```
- `imports: [TypeOrmModule.forFeature([GateAccessLogEntity])]` (import entity từ `../zones/entities/gate-access-log.entity.js`).
- `providers: [GateAccessPairingService]`.
- `controllers: []` (UC-116 không có route HTTP).
- `exports: [GateAccessPairingService]` — để `SchedulerModule` inject được.

## 4. Service — `GateAccessPairingService` (file mới)
```
src/modules/gate-access/services/gate-access-pairing.service.ts
```
- Constructor: `@InjectRepository(GateAccessLogEntity) private readonly repo: Repository<GateAccessLogEntity>`, `private readonly dataSource: DataSource` (đọc `system_configs`).
- `async pairPendingLogs(): Promise<{scanned: number; paired: number; unmatched: number}>`:
  1. `const closingHour = await this.loadClosingHour();` (dùng cho log observability, KHÔNG chặn logic ghép).
  2. `const outLogs = await this.repo.find({where: {direction: 'out', pairedLogId: IsNull()}, order: {accessTime: 'ASC'}});`
  3. `let paired = 0, unmatched = 0;`
  4. `for (const out of outLogs) { const candidate = await this.findInCandidate(out); if (candidate) { await this.pairTwo(candidate, out); paired++; } else { unmatched++; } }`
  5. Trả `{scanned: outLogs.length, paired, unmatched}`.
- `private async findInCandidate(out: GateAccessLogEntity): Promise<GateAccessLogEntity | null>`:
  - `const windowStart = new Date(out.accessTime.getTime() - 24*60*60*1000);`
  - Nếu `out.userId` khác null: `this.repo.findOne({where: {userId: out.userId, direction: 'in', pairedLogId: IsNull(), accessTime: Between(windowStart, out.accessTime)}, order: {accessTime: 'DESC'}})`.
  - Ngược lại (userId NULL): tương tự nhưng `where: {plateNumber: out.plateNumber, ...}` — **guard**: nếu `out.plateNumber` cũng NULL thì return `null` ngay (không query — không có tiêu chí nào để ghép).
- `private async pairTwo(inLog: GateAccessLogEntity, outLog: GateAccessLogEntity): Promise<void>`:
  - `const durationSeconds = Math.round((outLog.accessTime.getTime() - inLog.accessTime.getTime()) / 1000);`
  - Dùng `this.dataSource.transaction(async (manager) => { await manager.update(GateAccessLogEntity, inLog.id, {pairedLogId: outLog.id, durationSeconds}); await manager.update(GateAccessLogEntity, outLog.id, {pairedLogId: inLog.id, durationSeconds}); });` — 2 UPDATE trong 1 transaction (DATA-02).
- `private async loadClosingHour(): Promise<string>`:
  - `const configs = await this.dataSource.getRepository(SystemConfigEntity).find({where: {configGroup: 'gate_access', isActive: true}});`
  - `const found = configs.find((c) => c.configKey === 'gate_access.closing_hour_local');`
  - `return found?.configValue ?? '22:00';` (validate format `HH:mm` bằng regex đơn giản, sai format → fallback default, log warning).

## 5. Migration seed `system_configs` (mới, cùng commit)
```
src/database/migrations/20260723000001-SeedGateAccessClosingHourConfig.ts
```
- `up()`: `INSERT INTO system_configs (config_key, config_value, value_type, config_group, description, is_active) VALUES ('gate_access.closing_hour_local', '22:00', 'string', 'gate_access', 'Giờ đóng cửa quy định dùng để coi phiên ra/vào cổng thiếu "Ra" là Chưa hoàn tất (UC-116)', true) ON CONFLICT (config_key) DO NOTHING;` — **kiểm tra trước**: `system_configs.config_key` có unique constraint không (nếu KHÔNG có, phải dùng `WHERE NOT EXISTS` pattern như permission seed thay vì `ON CONFLICT`) — xác nhận ở T0.
- `down()`: `DELETE FROM system_configs WHERE config_key = 'gate_access.closing_hour_local';`

## 6. Wiring `SchedulerService` (modified)
```
src/modules/scheduler/scheduler.service.ts
src/modules/scheduler/scheduler.module.ts (nếu cần import GateAccessModule)
```
- Thêm field `private readonly gateAccessPairingEnabled: boolean;` đọc từ `SCHEDULER_GATE_ACCESS_PAIRING_ENABLED` (default `false`).
- Thêm constructor param `private readonly gateAccessPairingService: GateAccessPairingService`.
- Thêm method:
```ts
@Cron(CronExpression.EVERY_5_MINUTES, { name: 'gate-access-pairing' })
async pairGateAccessLogs(): Promise<void> {
  if (!this.schedulerEnabled || !this.gateAccessPairingEnabled) return;
  try {
    const r = await this.gateAccessPairingService.pairPendingLogs();
    this.logger.log(
      `[Scheduler] gate-access-pairing: scanned=${r.scanned} paired=${r.paired} unmatched=${r.unmatched}`,
    );
  } catch (e) {
    this.logger.error(
      `[Scheduler] gate-access-pairing failed: ${e instanceof Error ? e.message : 'unknown'}`,
    );
  }
}
```
- `scheduler.module.ts`: thêm `GateAccessModule` vào `imports` nếu `GateAccessPairingService` chưa được export tới scope global.

## 7. File list
### Net-new (5 file)
- `src/modules/gate-access/gate-access.module.ts`
- `src/modules/gate-access/services/gate-access-pairing.service.ts` (+ `.spec.ts`)
- `src/database/migrations/20260723000001-SeedGateAccessClosingHourConfig.ts`
### Modified (2 file)
- `src/modules/scheduler/scheduler.service.ts`: thêm field + constructor param + method `pairGateAccessLogs`.
- `src/modules/scheduler/scheduler.module.ts`: thêm `GateAccessModule` vào `imports` (nếu cần).
> Tổng **5 net-new + 2 modified**. 0 thay đổi entity. 1 migration (seed config, KHÔNG DDL bảng nghiệp vụ).

## 8. Test (mock repo — KHÔNG DB)
- `pairPendingLogs`: có 1 `out` log + 1 `in` log cùng `userId`, `in` trong 24h trước → ghép thành công, cả 2 dòng có `pairedLogId` chéo + `durationSeconds` giống nhau; assert transaction dùng đúng 2 `manager.update`.
- `findInCandidate`: `userId` có giá trị → query theo `userId`, KHÔNG động tới `plateNumber`; `userId` NULL + `plateNumber` có giá trị → query theo `plateNumber`; `userId` NULL + `plateNumber` NULL → return `null` NGAY, KHÔNG query DB (assert `repo.findOne` không bị gọi).
- Không có ứng viên trong 24h → `unmatched` tăng, KHÔNG gọi `update`.
- Nhiều ứng viên `in` khớp → chọn đúng ứng viên GẦN NHẤT (FIFO, `ORDER BY accessTime DESC LIMIT 1`, BR1).
- `loadClosingHour`: có dòng config hợp lệ → trả đúng giá trị; thiếu dòng → default `'22:00'`; giá trị sai format (`'25:99'` hoặc rỗng) → fallback default + log warning.
- Coverage **≥80%** file mới.

## 9. Gate (STOP, KHÔNG commit)
- build=0; eslint file mới 0 warning mới; `npx jest src/modules/gate-access src/modules/scheduler` xanh (job cron cũ KHÔNG hồi quy); coverage ≥80% file mới; DI-proof compile `AppModule` (0 circular/UnknownDependencies sau khi thêm `GateAccessModule`). **KHÔNG live, KHÔNG DB thật.**
- **Owed (ghi, KHÔNG chạy)**: index `plate_number WHERE paired_log_id IS NULL` · điểm gọi trực tiếp từ Hải · batch/phân trang khi log lớn · API sửa giờ đóng cửa riêng.

## 10. Kỷ luật
- **DATA-01/02**: KHÔNG INSERT `gate_access_logs` mới; 2 UPDATE luôn trong 1 transaction.
- **ARCH-01/02**: business logic trong `GateAccessPairingService`, KHÔNG đụng `zones` module, `SchedulerService` chỉ gọi + log.
- KHÔNG tự code UC-117/UC-114 ở đây — 2 feature riêng, xem `../uc117-gate-access-history/`, `../uc114-vehicle-traffic-stats/`.

> **STOP.** Plan-only (viết cùng lượt với spec do OQ đã chốt trước). Chờ Thiếu Chủ duyệt plan + spec → sang code theo tasks.md. KHÔNG tự code.
