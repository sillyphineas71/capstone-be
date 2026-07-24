# GAP-001 — tasks.md (UC-106 Zones: ghép cặp vào–ra)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-23 | Tạo tasks GAP-001 sau plan DUYỆT + bổ sung `FOR UPDATE SKIP LOCKED`: T0 verify (có cửa dừng `setOnLocked`) → T1 migration `UQ_gate_logs_paired` → T2/T2b service `GateLogPairingService` (transaction + SKIP LOCKED, **0 deletedAt**) → T3/T3b cron `gate-log-pairing` (thuần thêm vào `SchedulerService`) → T4 wiring (`scheduler.module.ts` +`ZonesModule`, `zones.module.ts` export service) → T-GATE. ⚠ UC ĐẦU TIÊN: cron + migration schema thật + bảng rỗng (test 100% mock). | Toàn bộ |

> Map: [spec.md](./spec.md), [plan.md](./plan.md). Mỗi task 1 AC. Code vs test tách. **KHÔNG** mở lại 7 QĐ nền (spec §8), 11 OQ đã chốt, plan §9. **KHÔNG** sửa `GateAccessLogService`/`ZonesService`/`ZonesController`/`ZonesAuditRepository`/entity/`app.module.ts`/`data-source.ts`/module `anpr`, **KHÔNG đụng 9 cron job cũ**. **KHÔNG** `deletedAt`/soft-delete. Migration schema **chỉ** 1 partial unique index (không cột/bảng/CHECK/index `plate_number`). **KHÔNG** route/permission (OQ-10). **KHÔNG** audit.

## Thứ tự
T0 → T1 → T2 → T2b → T3 → T3b → T4 → T-GATE.

> **Phụ thuộc**: migration (T1) độc lập nhưng **cùng commit** (index là safety-net) · service (T2) trước cron (T3 inject) · service + cron trước wiring (T4) · `zones.module.ts` export service (T4) trước khi `SchedulerModule` inject được (T4).
>
> **KHÔNG có task route/permission/audit** (OQ-10, read-only-side không áp — UC-106 tự động, không HTTP).

---

## T0 — RECON-verify (xác nhận trước khi code) — plan §0
Chốt chặn trước dòng code đầu. Dán xác nhận từng mục kèm bằng chứng. **Thiếu / sai path / lệch hiện trạng → DỪNG, báo Thiếu Chủ, KHÔNG bịa, KHÔNG tự sửa.**

1. **Baseline test module `zones`**: `npx jest src/modules/zones` — **kỳ vọng 13 suite / 166 test**. Lệch → ghi nhận và báo **trước khi** code. Con số đối chiếu không hồi quy ở T-GATE.
2. ⭐ **`SKIP LOCKED` dùng được (CỬA DỪNG)**: xác nhận TypeORM version hiện tại có `QueryBuilder.setOnLocked('skip_locked')` (đọc `node_modules/typeorm` types hoặc `package.json` version + docs) **HOẶC** xác nhận đường raw query `qr.manager.query('... FOR UPDATE SKIP LOCKED', params)` khả thi. **KHÔNG có cả hai → DỪNG, báo cáo.** ⚠ **CẤM** tự quay về `FOR UPDATE` trần (mất chống dồn ứ, plan §9(j)).
3. **`GateAccessLogEntity`** ([gate-access-log.entity.ts](../../../../src/modules/zones/entities/gate-access-log.entity.ts)): xác nhận **KHÔNG có `@DeleteDateColumn`**; tên property `accessTime`, `direction`, `userId`, `pairedLogId`, `durationSeconds`, `zoneId`, `plateNumber`.
4. **`SchedulerService`** ([scheduler.service.ts](../../../../src/modules/scheduler/scheduler.service.ts)): dán **1 job mẫu đầy đủ** (vd `device-offline-detect` [:124-132] — gate env + try/catch + log summary) để mirror. Xác nhận **9 job hiện có** kèm tên chính xác: `face-sync`, `face-reconcile`, `device-offline-detect`, `no-show-check`, `auto-release`, `early-vacancy`, `ivss-sync`, `notification-reminder`, `checkin-alert` (để chứng minh không đụng ở T3).
5. **`scheduler.module.ts`** ([scheduler.module.ts:24-32](../../../../src/modules/scheduler/scheduler.module.ts)): `imports` hiện tại (5 domain module + `ScheduleModule.forRoot()` + `ConfigModule`); xác nhận **chưa có** `ZonesModule`.
6. **Mẫu transaction** `queryRunner` ([zones.service.ts:131-154](../../../../src/modules/zones/services/zones.service.ts)): `createQueryRunner → connect → startTransaction → try{commit}catch{rollback;throw}finally{release()}`.
7. **`isUniqueViolation`**: tìm hàm nhận diện `23505` — ANPR có ([vehicle-registration.service.ts:212-218](../../../../src/modules/anpr/services/vehicle-registration.service.ts)) nhưng ở module `anpr` (CẤM import). Kiểm `zones` đã có chưa (UC-90 `zoneCodeConflict`/`isUniqueViolation`?); nếu chưa → **viết lại** hàm private nhỏ trong `GateLogPairingService` (KHÔNG import từ `anpr`).
8. **Migration cuối thực tế**: đếm `src/database/migrations/` — kỳ vọng cuối `20260722000007` ⇒ UC-106 lấy **`20260722000008`**. Đã có `...0008*` → lấy số kế tiếp, **ghi rõ**.
9. **`ConfigService.get<number>`** ([face-attendance.service.ts:170](../../../../src/modules/face-access/services/face-attendance.service.ts)): tiền lệ `get<number>('X', default)` để đọc `GATE_PAIRING_WINDOW_HOURS`/`GATE_PAIRING_BUFFER_HOURS`.

- **AC**: dán xác nhận đủ **9 mục**; mục 1 ghi baseline; mục 2 kết luận `SKIP LOCKED` dùng được/không (không → DỪNG); mục 7 chốt tái dùng hay viết lại `isUniqueViolation`; mục 8 chốt timestamp.

## T1 — Migration schema `UQ_gate_logs_paired` (code) — plan §5, QĐ-4 (ngoại lệ)
File net-new **`src/database/migrations/20260722000008-AddGateLogsPairedUniqueIndex.ts`** (timestamp chốt T0), class `AddGateLogsPairedUniqueIndex20260722000008`.
- **Đặt trong `migrations/`, KHÔNG `src/database/seeds/`.**
- Mirror [20260721000001-CreateZonesTable.ts:32-35,51](../../../../src/database/migrations/20260721000001-CreateZonesTable.ts), viết TAY:
  ```
  up():   CREATE UNIQUE INDEX "UQ_gate_logs_paired"
            ON "gate_access_logs" ("paired_log_id") WHERE "paired_log_id" IS NOT NULL
  down(): DROP INDEX "UQ_gate_logs_paired"
  ```
- ⚠ Ghi rõ trong JSDoc: index này **FAIL nếu DB đang có 2 bản trùng `paired_log_id`** — bảng hiện **rỗng** nên local an toàn; người áp lên RDS phải kiểm `SELECT paired_log_id, count(*) ... GROUP BY paired_log_id HAVING count(*)>1` trước.
- **KHÔNG** cột/bảng/CHECK/index khác (OQ-7 không index `plate_number`).
- **AC**: đúng tên/vị trí; partial unique index đúng cột + `WHERE paired_log_id IS NOT NULL`; `down()` DROP; JSDoc cảnh báo FAIL-nếu-trùng; chỉ tạo file, KHÔNG chạy `migration:run`.

## T2 — Service `GateLogPairingService` (code) — plan §2/§3, §2 prompt (SKIP LOCKED)
File net-new `src/modules/zones/services/gate-log-pairing.service.ts`. `@Injectable`, `constructor(private readonly dataSource: DataSource, private readonly configService: ConfigService)`. Đọc ở constructor: `windowH = get<number>('GATE_PAIRING_WINDOW_HOURS', 24)`, `bufferH = get<number>('GATE_PAIRING_BUFFER_HOURS', 1)`; hằng `BATCH = 300`.

> ⚠⚠ **TUYỆT ĐỐI KHÔNG** `deletedAt`/`IsNull()` (bảng append-only, không có cột). **KHÔNG** đụng `GateAccessLogService` (QĐ-7). Khoá dùng **`FOR UPDATE SKIP LOCKED`** (§2 prompt), KHÔNG `FOR UPDATE` trần.

- **`pairBatch(): Promise<{scanned; paired; skipped}>`**: `scanFrom = now - (windowH+bufferH)h`; lấy lô `leave` (`direction='leave'`, `pairedLogId IS NULL`, `userId IS NOT NULL`, `accessTime >= scanFrom`, `ORDER BY accessTime ASC LIMIT 300`); for mỗi bản gọi lõi ghép (mỗi bản 1 transaction); đếm scanned/paired/skipped.
- **`pairForLeaveLog(leaveId, manager?): Promise<'paired'|'skipped'>`**: public, UC-105 gọi; `manager ?? this.dataSource.manager` (ARCH-01) — có `manager` thì KHÔNG tự commit/release; không thì tự quản. Đề xuất tách lõi `pairOneWithManager(manager, leaveId)`.
- **Lõi ghép** (8 bước plan §2): (1) load+khoá `L` `FOR UPDATE SKIP LOCKED` — không lấy được → skipped; đã ghép → skipped; (2) tìm+khoá `E` LIFO `ORDER BY access_time DESC LIMIT 1 FOR UPDATE SKIP LOCKED`, `user_id=L.userId`, `access_time < L`, `>= L - windowH`, KHÔNG cùng-zone; (3) không có E → skipped; (4) `duration = Math.floor((L-E)/1000)`; (5) UPDATE **hai bản** (`paired_log_id` hai chiều + `duration_seconds` cả hai); (6) commit → paired; (7) `23505` → rollback+skipped, KHÔNG ném; lỗi khác → rollback+throw; (8) `finally release()` mọi nhánh (nếu tự tạo qr).
- `private isUniqueViolation(e)` — theo T0 mục 7 (tái dùng zones hoặc viết mới; KHÔNG import anpr).
- **AC**: đọc 2 env + BATCH; 2 method public; lõi đúng 8 bước; **cả 2 khoá dùng `SKIP LOCKED`**; UPDATE 2 bản hai chiều + duration cả hai; `23505` rollback-bỏ-qua không ném; `finally release()` mọi nhánh; **0 `deletedAt`**; 0 đụng `GateAccessLogService`.

## T2b — Test service — plan §7
File net-new `gate-log-pairing.service.spec.ts` (mock `DataSource.createQueryRunner` → `{connect, startTransaction, commitTransaction, rollbackTransaction, release, manager:{query}}` jest.fn; mock `configService.get`):
- **Ghép thành công**: `enter`+`leave` khớp user trong cửa sổ → **2 UPDATE** (L và E), `paired_log_id` hai chiều, `duration_seconds` **bằng nhau + đúng** `floor((leave-enter)/1000)`, `commitTransaction` gọi.
- **LIFO**: 3 `enter` (8:00/13:00/16:00) + `leave@17:00` → query có `ORDER BY access_time DESC LIMIT 1` (chọn 16:00).
- **Thứ tự lô `leave` tăng dần**: query lô có `ORDER BY access_time ASC`.
- **`SKIP LOCKED`**: query khoá (cả `L` lẫn `E`) chứa `SKIP LOCKED` (hoặc `setOnLocked('skip_locked')` được gọi).
- **Không ứng viên** → 0 UPDATE, return skipped, KHÔNG throw.
- **Ngoài cửa sổ**: điều kiện `access_time >= L.accessTime - window` có mặt.
- **`user_id` NULL**: lô có `user_id IS NOT NULL`.
- **`23505`**: UPDATE ném `{driverError:{code:'23505'}}` → `rollbackTransaction` gọi, `commitTransaction` KHÔNG, return skipped, **KHÔNG ném ra ngoài**.
- **`finally release()`**: `release` gọi ở nhánh thành công / không-ứng-viên / `23505` / lỗi khác.
- **Cửa sổ quét**: query lô có `access_time >= scanFrom`.
- **Lô 300**: query có `LIMIT 300`.
- **Idempotent**: `L.pairedLogId` đã set → skip, 0 UPDATE.
- ⭐ **KHÔNG `deletedAt`**: assert KHÔNG câu query nào chứa chuỗi `deleted`.
- **AC**: các case xanh; case SKIP LOCKED + `23505`-không-ném + finally-release + KHÔNG-deletedAt bắt buộc; coverage `GateLogPairingService` ≥80%.

## T3 — Cron job (sửa `scheduler.service.ts`) — plan §4, §1.1 (THUẦN THÊM MỚI)
File **Modified**: `src/modules/scheduler/scheduler.service.ts`. **Đúng 3 thay đổi**:
1. **1 inject**: thêm `private readonly gateLogPairingService: GateLogPairingService` vào constructor (+ import class).
2. **1 cờ env**: field `private readonly gatePairingEnabled: boolean;` + `this.gatePairingEnabled = this.configService.get<boolean>('SCHEDULER_GATE_PAIRING_ENABLED', false)` + thêm vào log init.
3. **1 job**:
   ```
   @Cron(CronExpression.EVERY_5_MINUTES, { name: 'gate-log-pairing' })
   async gateLogPairing(): Promise<void> {
     if (!this.schedulerEnabled || !this.gatePairingEnabled) return;
     try {
       const r = await this.gateLogPairingService.pairBatch();
       this.logger.log(`[Scheduler] gate-log-pairing: scanned=${r.scanned} paired=${r.paired} skipped=${r.skipped}`);
     } catch (e) {
       this.logger.error(`[Scheduler] gate-log-pairing failed: ${e instanceof Error ? e.message : 'unknown'}`);
     }
   }
   ```
- ⚠ **TUYỆT ĐỐI KHÔNG đụng 9 job cũ**: `face-sync`, `face-reconcile`, `device-offline-detect`, `no-show-check`, `auto-release`, `early-vacancy`, `ivss-sync`, `notification-reminder`, `checkin-alert`. Không đổi thứ tự, không refactor, không "dọn dẹp".
- **AC**: đúng 1 inject + 1 cờ + 1 job; job gate `schedulerEnabled && gatePairingEnabled`, try/catch không ném, log summary; 9 job cũ giữ nguyên byte-for-byte (git diff chỉ thêm).

## T3b — Test cron — plan §7
- T0 kiểm **có `scheduler.service.spec.ts` không**. **Nếu có**: thêm mock `GateLogPairingService` provider (dựng mock — được phép) + case: job tắt (env OFF) → `pairBatch` KHÔNG gọi; bật → gọi 1 lần; `pairBatch` ném → `logger.error`, job KHÔNG reject. **KHÔNG đổi assert test job cũ**. **Nếu không có**: ghi rõ "scheduler chưa có spec" và verify bằng metadata `@Cron` (Reflect) hoặc để DI-proof + test service phủ; nêu ở T-GATE.
- **AC**: nếu có spec — 3 case + không hồi quy job cũ; nếu không — ghi rõ cách verify thay thế.

## T4 — Module wiring (code) — plan §4/§6, cạnh `scheduler → zones`
- **`zones.module.ts`** (Modified): thêm `GateLogPairingService` vào `providers` **VÀ `exports`** (để `SchedulerModule` inject được). Giữ nguyên `imports`/`controllers`/phần còn lại của `providers`/`exports`.
- **`scheduler.module.ts`** (Modified): thêm **đúng 1** entry `ZonesModule` vào `imports` (+ import class). Giữ nguyên 5 domain module + `ScheduleModule.forRoot()` + `ConfigModule` + `providers`/`exports`.
- ⚠ Cạnh `scheduler → zones` **một chiều**: `zones` **KHÔNG** import `scheduler`; `SchedulerModule` là orchestrator tầng trên (đã import 5 domain module) ⇒ không circular.
- **AC**: `zones.module.ts` có `GateLogPairingService` trong **cả** `providers` và `exports`; `scheduler.module.ts` có `ZonesModule` trong `imports`; phần còn lại 2 file không đổi; 0 import ngược `zones → scheduler`.

## T-GATE — (STOP, KHÔNG commit) — plan §8
- `npm run build` = **0 error**.
- eslint **chỉ file đã chạm** = **0 rule mới** (**KHÔNG `npm run lint` trần**). File có lỗi nền → chứng minh pre-existing bằng `git show HEAD:<file>`.
- `npx jest src/modules/zones` **xanh** — **166 test cũ không hồi quy**, đối chiếu baseline T0. Module `scheduler` có test → chạy `npx jest src/modules/scheduler` và đối chiếu. Test cũ fail → **DỪNG, báo cáo, KHÔNG sửa test cho qua**.
- Coverage `GateLogPairingService` **≥80%**.
- **DI-proof**: `AppModule` compile **preview mode** — 0 `UnknownDependenciesException`, **0 circular** (cạnh mới `scheduler → zones` — bắt buộc chạy). Throwaway xoá sạch.
- **KHÔNG** `migration:run` (kể cả local) · **KHÔNG** RDS · **KHÔNG** live smoke · **KHÔNG** commit/stash/checkout.
- In: danh sách file + kết quả jest (tách cũ/mới) + coverage + DI-proof.
- **Bàn giao**: (a) migration `20260722000008` phải chạy trước khi job hoạt động đúng — thiếu index thì mất lớp chống race (`SKIP LOCKED` giảm va chạm nhưng unique index mới là chốt cuối), code vẫn chạy nhưng có thể ghép trùng; (b) job **mặc định TẮT** — bật bằng `SCHEDULER_ENABLED=true` + `SCHEDULER_GATE_PAIRING_ENABLED=true`; (c) bảng `gate_access_logs` **rỗng** (writer UC-105 chưa xây) ⇒ job chạy luôn `{scanned:0}`.
- **Owed**: không phân biệt "còn trong khuôn viên" vs "quên quét ra" · xe chưa đăng ký (`user_id` NULL) không ghép — cần index `plate_number` khi làm (UC sau) · không API gỡ cặp, ghép nhầm sửa DB tay · `SchedulerService` không chống chồng lấn ở tầng framework (UC-106 tự chống bằng `SKIP LOCKED` + unique index) · **toàn bộ test là mock, chưa verify được bằng dữ liệu thật cho tới UC-105** · ánh xạ số hiệu UC · Project Overview FE-18 · global exception filter · Swagger · 5 file `spec/global/` rỗng.
- **AC**: bảng gate + tick: migration partial unique index đúng ✓ · service 8 bước, **cả 2 khoá SKIP LOCKED** ✓ · UPDATE 2 bản hai chiều + duration cả hai ✓ · `23505` rollback-bỏ-qua không ném ✓ · `finally release()` mọi nhánh ✓ · **0 `deletedAt`** (test assert) ✓ · cron thuần thêm, 9 job cũ nguyên ✓ · wiring `zones` export + `scheduler` import ZonesModule, 0 circular ✓ · 0 route/permission ✓ · 166 test cũ không hồi quy ✓ · coverage ✓. **STOP.**

## Map task → scope UC-106
- **T0** → baseline 166 · **cửa dừng SKIP LOCKED** · entity KHÔNG DeleteDateColumn · 9 job cũ · scheduler.module chưa có ZonesModule · mẫu transaction · isUniqueViolation · timestamp `...0008` · ConfigService.get<number>
- **T1** → migration partial unique index `UQ_gate_logs_paired` (ngoại lệ schema)
- **T2/T2b** → `GateLogPairingService` (pairBatch + pairForLeaveLog, 8 bước, SKIP LOCKED, hai chiều, **0 deletedAt**) + test 23505/finally/window
- **T3/T3b** → cron `gate-log-pairing` thuần thêm (9 job cũ nguyên) + test env-toggle
- **T4** → wiring: `zones.module` export service, `scheduler.module` import ZonesModule (một chiều)
- **T-GATE** → gate + 166 không hồi quy + DI-proof circular + STOP + bàn giao (migration+env+bảng rỗng) + Owed
